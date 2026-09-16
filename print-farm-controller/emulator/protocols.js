import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const TEST_FRAME_JPEG = readFileSync(new URL('./assets/test-frame.jpg', import.meta.url));
const BAMBU_TLS = Object.freeze({
  key: readFileSync(new URL('./assets/bambu-simulator-key.pem', import.meta.url)),
  cert: readFileSync(new URL('./assets/bambu-simulator-cert.pem', import.meta.url))
});
const MJPEG_BOUNDARY = 'printfleetemulator';

function sendJson(response, status, body) {
  const content = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': content.length,
    'access-control-allow-origin': '*'
  });
  response.end(content);
}

async function readBodyPrefix(request, captureBytes = 256 * 1024) {
  const chunks = [];
  let captured = 0;
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (captured < captureBytes) {
      const take = Math.min(chunk.length, captureBytes - captured);
      chunks.push(chunk.subarray(0, take));
      captured += take;
    }
  }
  return { prefix: Buffer.concat(chunks), total };
}

function multipartFilename(prefix) {
  const match = prefix.toString('latin1').match(/filename="([^"]+)"/i);
  return match ? match[1].replace(/[/\\]/g, '_') : null;
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  for (const socket of server.emulatorSockets || []) socket.destroy();
  return new Promise((resolve) => server.close(() => resolve()));
}

async function applyFault(printer, protocol, label, response) {
  const result = await printer.beforeRequest(protocol, label);
  if (!result) return false;
  if (result.raw !== undefined) {
    response.writeHead(result.status || 200, { 'content-type': 'application/json' });
    response.end(result.raw);
  } else {
    sendJson(response, result.status || 500, result.body || { error: { message: 'Simulated failure' } });
  }
  return true;
}

function moonrakerState(printer) {
  if (printer.status === 'printing') return 'printing';
  if (printer.status === 'paused') return 'paused';
  if (printer.status === 'completed') return 'complete';
  if (printer.status === 'cancelled') return 'cancelled';
  if (printer.status === 'failed') return 'error';
  return 'standby';
}

function moonrakerObjects(printer) {
  const material = printer.tools.map((tool) => tool.filament.material || '');
  const colors = printer.tools.map((tool) => `${String(tool.filament.color || '#FFFFFF').replace('#', '')}FF`);
  const status = {
    webhooks: { state: printer.status === 'failed' ? 'error' : 'ready', state_message: printer.statusMessage },
    print_stats: {
      state: moonrakerState(printer),
      filename: printer.fileName || '',
      print_duration: printer.elapsedSeconds,
      total_duration: printer.elapsedSeconds,
      message: printer.statusMessage,
      info: { current_layer: printer.currentLayer, total_layer: printer.totalLayers }
    },
    virtual_sdcard: { progress: printer.progress / 100, is_active: printer.status === 'printing' },
    display_status: { progress: printer.progress / 100, message: printer.statusMessage },
    heater_bed: { temperature: printer.bed.actual, target: printer.bed.target },
    toolhead: { extruder: 'extruder', position: [0, 0, printer.currentLayer * 0.2, 0] },
    'temperature_sensor cavity': { temperature: printer.chamber.actual },
    'fan_generic cavity_fan': { speed: printer.fans.chamber / 100 },
    purifier: {
      inner_fan: { speed: printer.fans.internal / 100 },
      exhaust_fan: { speed: printer.fans.external / 100 },
      inner_fan_rpm: Math.round(printer.fans.internal * 30)
    },
    filament_detect: {
      state: printer.tools.map(() => 0),
      info: printer.tools.map((tool) => ({
        VENDOR: tool.filament.vendor || 'Simulator',
        MAIN_TYPE: tool.filament.material || '',
        SUB_TYPE: tool.filament.materialVariant || '',
        ARGB_COLOR: Number.parseInt(`FF${String(tool.filament.color || '#FFFFFF').replace('#', '')}`, 16)
      }))
    },
    print_task_config: {
      filament_vendor: printer.tools.map((tool) => tool.filament.vendor || 'Simulator'),
      filament_type: material,
      filament_sub_type: printer.tools.map((tool) => tool.filament.materialVariant || ''),
      filament_color_rgba: colors,
      filament_official: printer.tools.map((tool) => Boolean(tool.filament.officialFilament)),
      filament_exist: printer.tools.map((tool) => Boolean(tool.filament.present)),
      filament_edit: printer.tools.map((tool) => tool.filament.colorEditable !== false),
      time_lapse_camera: false,
      auto_replenish_filament: false,
      replenish_ignore_color: false,
      filament_entangle_detect: true,
      filament_entangle_sen: 'medium'
    },
    extruder_offset_calibration: { calibration_step: 'idle', bed_plate_check: false, is_prehoming: false }
  };
  printer.tools.forEach((tool, index) => {
    const heater = index === 0 ? 'extruder' : `extruder${index}`;
    status[heater] = {
      temperature: tool.actual,
      target: tool.target,
      nozzle_diameter: tool.nozzleDiameter,
      nozzle_volume_type: tool.nozzleVolumeType,
      extruder_offset: tool.offset
    };
    status[`filament_motion_sensor e${index}_filament`] = {
      enabled: true,
      filament_detected: Boolean(tool.filament.present)
    };
  });
  return status;
}

function filterMoonrakerObjects(all, url) {
  const requested = [...url.searchParams.keys()];
  if (!requested.length) return all;
  const selected = {};
  for (const key of requested) if (Object.prototype.hasOwnProperty.call(all, key)) selected[key] = all[key];
  return selected;
}

function applyGcode(printer, script) {
  for (const line of String(script || '').split(/\r?\n/)) {
    const heater = line.match(/SET_HEATER_TEMPERATURE\s+HEATER=(\S+)\s+TARGET=([\d.]+)/i);
    if (heater) {
      if (heater[1] === 'heater_bed') printer.bed.target = Number(heater[2]);
      else {
        const index = heater[1] === 'extruder' ? 0 : Number(heater[1].replace('extruder', ''));
        if (printer.tools[index]) printer.tools[index].target = Number(heater[2]);
      }
    }
    const m104 = line.match(/^M104\s+S([\d.]+)/i);
    if (m104) printer.tools[0].target = Number(m104[1]);
    const fan = line.match(/SET_FAN_SPEED\s+FAN=cavity_fan\s+SPEED=([\d.]+)/i);
    if (fan) printer.fans.chamber = Number(fan[1]) * 100;
    const purifier = line.match(/SET_PURIFIER\s+FAN=(inner|exhaust)\s+SPEED=([\d.]+)/i);
    if (purifier) printer.fans[purifier[1] === 'inner' ? 'internal' : 'external'] = Number(purifier[2]) * 100;
    const filamentTool = line.match(/SET_PRINT_FILAMENT_CONFIG.*CONFIG_EXTRUDER='?(\d+)'?/i);
    const filamentType = line.match(/FILAMENT_TYPE='?([^'\s]+)'?/i);
    const filamentVendor = line.match(/VENDOR='?([^'\s]+)'?/i);
    const filamentSubtype = line.match(/FILAMENT_SUBTYPE='?([^']+?)'?(?:\s+[A-Z_]+=|$)/i);
    if (filamentTool && printer.tools[Number(filamentTool[1])] && filamentType) {
      const filament = printer.tools[Number(filamentTool[1])].filament;
      filament.material = filamentType[1];
      if (filamentVendor) filament.vendor = filamentVendor[1];
      if (filamentSubtype) filament.materialVariant = filamentSubtype[1];
      filament.officialFilament = false;
      filament.colorEditable = true;
    }
    const color = line.match(/SET_PRINT_FILAMENT_CONFIG.*CONFIG_EXTRUDER='?(\d+)'?.*FILAMENT_COLOR_RGBA='?([0-9A-F]{8})'?/i);
    if (color && printer.tools[Number(color[1])]) printer.tools[Number(color[1])].filament.color = `#${color[2].slice(0, 6).toUpperCase()}`;
  }
  printer.emitChange();
}

function createMoonrakerServer(printer) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (await applyFault(printer, 'moonraker', `${request.method} ${url.pathname}`, response)) return;

    if (url.pathname === '/printer/info') {
      sendJson(response, 200, { result: { state: 'ready', state_message: '', hostname: printer.name, software_version: 'simulator-0.13.0' } });
      return;
    }
    if (url.pathname === '/printer/objects/query') {
      sendJson(response, 200, { result: { eventtime: Date.now() / 1000, status: filterMoonrakerObjects(moonrakerObjects(printer), url) } });
      return;
    }
    if (url.pathname === '/printer/objects/list') {
      sendJson(response, 200, { result: { objects: Object.keys(moonrakerObjects(printer)) } });
      return;
    }
    if (url.pathname === '/server/files/list') {
      const files = printer.faults.failVerification ? [] : [...printer.files.values()].map((file) => ({ path: file.path, size: file.size, modified: file.modified, permissions: 'rw' }));
      sendJson(response, 200, { result: { files, disk_usage: { total: 32e9, used: 1e9, free: 31e9 }, root_info: { name: 'gcodes', permissions: 'rw' } } });
      return;
    }
    if (url.pathname === '/server/history/list') {
      sendJson(response, 200, { result: { count: printer.history.length, jobs: printer.history } });
      return;
    }
    if (url.pathname === '/server/files/metadata') {
      const filename = String(url.searchParams.get('filename') || '');
      sendJson(response, 200, { result: { filename, size: printer.files.get(filename)?.size || 0, slicer: 'Printer Emulator', referenced_tools: [0], filament_type: 'PLA', filament_colors: ['#FF6B35'], nozzle_diameter: [0.4] } });
      return;
    }
    if (url.pathname.startsWith('/server/files/gcodes/')) {
      const filename = decodeURIComponent(url.pathname.slice('/server/files/gcodes/'.length));
      const file = printer.files.get(filename);
      if (!file) return sendJson(response, 404, { error: { message: 'File not found' } });
      const content = Buffer.from(file.content || '; simulated G-code\nG28\n');
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': content.length });
      response.end(content);
      return;
    }
    if (url.pathname === '/server/files/upload' && request.method === 'POST') {
      const body = await readBodyPrefix(request);
      const filename = multipartFilename(body.prefix) || `upload-${Date.now()}.gcode`;
      printer.addFile(filename, { size: body.total, content: '; uploaded to Printer Emulator\nG28\n' });
      sendJson(response, 200, { result: { item: { path: filename, root: 'gcodes' }, print_started: false, print_queued: false } });
      return;
    }
    if (url.pathname === '/printer/gcode/script' && request.method === 'POST') {
      applyGcode(printer, url.searchParams.get('script'));
      sendJson(response, 200, { result: 'ok' });
      return;
    }
    if (url.pathname === '/printer/print/start' && request.method === 'POST') {
      printer.startPrint(url.searchParams.get('filename'));
      sendJson(response, 200, { result: 'ok' });
      return;
    }
    const actions = {
      '/printer/print/pause': 'pause',
      '/printer/print/resume': 'resume',
      '/printer/print/cancel': 'cancel'
    };
    if (actions[url.pathname] && request.method === 'POST') {
      printer.action(actions[url.pathname]);
      sendJson(response, 200, { result: 'ok' });
      return;
    }
    if (url.pathname === '/server/webcams/list') {
      sendJson(response, 200, { result: { webcams: [{ name: 'Simulated camera', enabled: !printer.faults.cameraUnavailable, stream_url: '/server/files/camera/monitor.jpg' }] } });
      return;
    }
    if (url.pathname === '/server/files/camera/monitor.jpg') {
      if (printer.faults.cameraUnavailable) return sendJson(response, 503, { error: { message: 'Simulated camera unavailable' } });
      response.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': TEST_FRAME_JPEG.length, 'cache-control': 'no-store' });
      response.end(TEST_FRAME_JPEG);
      return;
    }
    if (url.pathname === '/access/api_key') {
      sendJson(response, 200, { result: 'simulator-api-key' });
      return;
    }
    sendJson(response, 404, { error: { message: `Unsupported simulated Moonraker endpoint: ${url.pathname}` } });
  });
  server.emulatorSockets = new Set();
  server.on('upgrade', (request, socket) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const key = String(request.headers['sec-websocket-key'] || '');
    if (url.pathname !== '/websocket' || !key || !printer.online) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WEBSOCKET_GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '', ''
    ].join('\r\n'));
    server.emulatorSockets.add(socket);
    printer.log('moonraker-websocket', 'Camera monitor connection opened');
    socket.on('data', (buffer) => {
      // The production camera source only needs the successful upgrade before
      // sending camera.start_monitor. Keep frames protocol-valid by accepting
      // them without echoing unsolicited Moonraker notifications.
      if ((buffer[0] & 0x0f) === 0x8) socket.end();
    });
    socket.on('error', () => {});
    socket.on('close', () => server.emulatorSockets.delete(socket));
  });
  return server;
}

function flashForgeStatus(printer) {
  if (printer.status === 'idle') return 'ready';
  if (printer.status === 'cancelled') return printer.faults.stuckCancel ? 'CANCEL' : 'cancelled';
  if (printer.status === 'failed') return 'error';
  return printer.status;
}

function flashForgeDetail(printer) {
  const tool = printer.tools[0];
  return {
    status: flashForgeStatus(printer),
    name: printer.name,
    firmwareVersion: '3.1.3-simulator',
    pid: 35,
    printFileName: printer.fileName || '',
    printProgress: printer.progress,
    printLayer: printer.currentLayer,
    targetPrintLayer: printer.totalLayers,
    estimatedTime: printer.remainingSeconds,
    printDuration: printer.elapsedSeconds,
    rightTemp: tool.actual,
    rightTargetTemp: tool.target,
    rightFilamentType: tool.filament.material,
    platTemp: printer.bed.actual,
    platTargetTemp: printer.bed.target,
    coolingFanSpeed: printer.fans.cooling,
    chamberFanSpeed: printer.fans.chamber,
    cameraStreamUrl: printer.faults.cameraUnavailable ? '' : `http://${printer.host}:${printer.ports.cameraPort}/?action=stream`
  };
}

function createFlashForgeHttpServer(printer) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (await applyFault(printer, 'flashforge-http', `${request.method} ${url.pathname}`, response)) return;
    if (request.method !== 'POST') return sendJson(response, 405, { code: 1, message: 'POST required' });

    if (url.pathname === '/uploadGcode') {
      const body = await readBodyPrefix(request);
      const filename = multipartFilename(body.prefix) || `upload-${Date.now()}.gcode`;
      printer.addFile(filename, { size: body.total, content: '; uploaded to Printer Emulator\nG28\n' });
      sendJson(response, 200, { code: 0, message: 'success' });
      return;
    }
    const body = await readBodyPrefix(request, 1024 * 1024);
    let data = {};
    try { data = body.prefix.length ? JSON.parse(body.prefix.toString('utf8')) : {}; } catch {}
    if (data.serialNumber && data.serialNumber !== printer.serialNumber) return sendJson(response, 200, { code: 2, message: 'Invalid serial number' });
    if (data.checkCode && data.checkCode !== printer.checkCode) return sendJson(response, 200, { code: 3, message: 'Invalid check code' });

    if (url.pathname === '/detail') return sendJson(response, 200, { code: 0, detail: flashForgeDetail(printer) });
    if (url.pathname === '/gcodeList') {
      const files = printer.faults.failVerification ? [] : [...printer.files.keys()].slice(-10).reverse();
      return sendJson(response, 200, { code: 0, gcodeList: files });
    }
    if (url.pathname === '/printGcode') {
      printer.startPrint(data.fileName);
      return sendJson(response, 200, { code: 0, message: 'success' });
    }
    if (url.pathname === '/control') {
      const command = data.payload?.cmd;
      const args = data.payload?.args || {};
      if (command === 'jobCtl_cmd') printer.action({ pause: 'pause', continue: 'resume', cancel: 'cancel' }[args.action] || args.action);
      else if (command === 'temperatureCtl_cmd') {
        if (args.rightNozzle !== undefined) printer.tools[0].target = Number(args.rightNozzle);
        if (args.platform !== undefined) printer.bed.target = Number(args.platform);
      } else if (command === 'printerCtl_cmd') {
        if (args.coolingFan !== undefined) printer.fans.cooling = Number(args.coolingFan);
        if (args.chamberFan !== undefined) printer.fans.chamber = Number(args.chamberFan);
      } else if (command === 'circulateCtl_cmd') {
        if (args.internal !== undefined) printer.fans.internal = args.internal === 'open' ? 100 : 0;
        if (args.external !== undefined) printer.fans.external = args.external === 'open' ? 100 : 0;
      }
      printer.emitChange();
      return sendJson(response, 200, { code: 0, message: 'success' });
    }
    sendJson(response, 404, { code: 1, message: `Unsupported simulated FlashForge endpoint: ${url.pathname}` });
  });
}

function createFlashForgeTcpServer(printer) {
  return net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines.map((item) => item.trim()).filter(Boolean)) {
        printer.log('flashforge-tcp', line);
        if (!printer.online) return socket.destroy();
        if (/~M601/.test(line)) socket.write('CMD M601 Received.\nControl Success\nok\n');
        else if (/~M661/.test(line)) {
          const files = printer.faults.failVerification ? [] : [...printer.files.keys()];
          socket.write(`CMD M661 Received.\ninfo_list.size: ${files.length}\n${files.map((file) => `::/data/${file}`).join('\n')}\nok\n`);
        } else if (/~M602/.test(line)) {
          socket.end('CMD M602 Received.\nok\n');
        } else socket.write(`CMD ${line.replace(/^~/, '')} Received.\nok\n`);
      }
    });
  });
}

function createCameraServer(printer) {
  return http.createServer((request, response) => {
    printer.log('camera', `${request.method} ${request.url}`);
    if (!printer.online || printer.faults.cameraUnavailable) return sendJson(response, 503, { error: 'Simulated camera unavailable' });
    response.writeHead(200, {
      'content-type': `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      connection: 'keep-alive'
    });
    const writeFrame = () => {
      if (response.destroyed || response.writableEnded) return;
      response.write(`--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${TEST_FRAME_JPEG.length}\r\n\r\n`);
      response.write(TEST_FRAME_JPEG);
      response.write('\r\n');
    };
    writeFrame();
    const timer = setInterval(writeFrame, 1000);
    timer.unref?.();
    request.once('close', () => clearInterval(timer));
    response.once('close', () => clearInterval(timer));
  });
}

function mqttLength(value) {
  const bytes = [];
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);
  return Buffer.from(bytes);
}

function mqttPacket(typeAndFlags, payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([typeAndFlags]), mqttLength(payload.length), payload]);
}

function mqttString(value) {
  const body = Buffer.from(String(value));
  const size = Buffer.alloc(2);
  size.writeUInt16BE(body.length);
  return Buffer.concat([size, body]);
}

function mqttReadString(buffer, offset) {
  if (offset + 2 > buffer.length) return null;
  const size = buffer.readUInt16BE(offset);
  if (offset + 2 + size > buffer.length) return null;
  return { value: buffer.subarray(offset + 2, offset + 2 + size).toString(), next: offset + 2 + size };
}

function bambuState(printer) {
  return {
    idle: 'IDLE',
    printing: 'RUNNING',
    paused: 'PAUSE',
    completed: 'FINISH',
    cancelled: 'FAILED',
    failed: 'FAILED'
  }[printer.status] || 'IDLE';
}

function bambuStatus(printer, sequenceId = '0') {
  const tool = printer.tools[0];
  return {
    print: {
      command: 'push_status',
      sequence_id: String(sequenceId),
      msg: printer.statusMessage || '',
      gcode_state: bambuState(printer),
      gcode_file: printer.fileName || '',
      subtask_name: printer.fileName || '',
      mc_percent: Math.round(printer.progress),
      mc_remaining_time: Math.ceil(printer.remainingSeconds / 60),
      mc_print_stage: printer.status === 'printing' ? '2' : '0',
      layer_num: printer.currentLayer,
      total_layer_num: printer.totalLayers,
      nozzle_temper: tool.actual,
      nozzle_target_temper: tool.target,
      bed_temper: printer.bed.actual,
      bed_target_temper: printer.bed.target,
      chamber_temper: printer.chamber.actual,
      cooling_fan_speed: String(Math.round(printer.fans.cooling * 15)),
      big_fan1_speed: String(Math.round(printer.fans.chamber * 15)),
      big_fan2_speed: String(Math.round(printer.fans.external * 15)),
      spd_lvl: 2,
      spd_mag: 100,
      wifi_signal: '-42dBm',
      lights_report: [{ node: 'chamber_light', mode: 'off' }],
      home_flag: 0,
      hw_switch_state: 1,
      ams_status: 0,
      upgrade_state: { sequence_id: 0, progress: '', status: 'IDLE' }
    }
  };
}

function applyBambuCommand(printer, body) {
  const command = body?.print?.command || body?.system?.command;
  const payload = body?.print || body?.system || {};
  if (command === 'pause') printer.action('pause');
  else if (command === 'resume') printer.action('resume');
  else if (command === 'stop') printer.action('cancel');
  else if (command === 'project_file') {
    const urlName = String(payload.url || '').split('/').pop();
    printer.startPrint(payload.subtask_name || payload.file || urlName || 'uploaded.3mf');
  } else if (command === 'gcode_file') {
    printer.startPrint(payload.param || payload.file || 'uploaded.gcode');
  } else if (command === 'pushall') {
    // The status response is published by the caller.
  } else if (command === 'ledctrl') {
    printer.chamberLight = payload.led_mode === 'on';
    printer.emitChange();
  }
  return command;
}

function createBambuMqttServer(printer) {
  const clients = new Set();
  const reportTopic = `device/${printer.serialNumber}/report`;
  const requestTopic = `device/${printer.serialNumber}/request`;
  const publishStatus = (client, sequenceId = '0') => {
    if (!client.authorized || !client.subscribed || client.destroyed) return;
    const body = Buffer.from(JSON.stringify(bambuStatus(printer, sequenceId)));
    client.write(mqttPacket(0x30, Buffer.concat([mqttString(reportTopic), body])));
  };
  const server = tls.createServer(BAMBU_TLS, (socket) => {
    clients.add(socket);
    socket.authorized = false;
    socket.subscribed = false;
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2) {
        let multiplier = 1;
        let remaining = 0;
        let cursor = 1;
        let byte;
        do {
          if (cursor >= pending.length) return;
          byte = pending[cursor++];
          remaining += (byte & 0x7f) * multiplier;
          multiplier *= 128;
        } while (byte & 0x80);
        if (pending.length < cursor + remaining) return;
        const header = pending[0];
        const payload = pending.subarray(cursor, cursor + remaining);
        pending = pending.subarray(cursor + remaining);
        const type = header >> 4;
        if (type === 1) {
          const protocol = mqttReadString(payload, 0);
          if (!protocol || protocol.next + 4 > payload.length) return socket.destroy();
          const level = payload[protocol.next];
          const flags = payload[protocol.next + 1];
          let position = protocol.next + 4;
          if (level === 5) {
            const propertySize = payload[position++] || 0;
            position += propertySize;
          }
          const clientId = mqttReadString(payload, position);
          if (!clientId) return socket.destroy();
          position = clientId.next;
          if (flags & 0x04) {
            const willTopic = mqttReadString(payload, position);
            const willPayload = willTopic && mqttReadString(payload, willTopic.next);
            if (!willPayload) return socket.destroy();
            position = willPayload.next;
          }
          let username = null;
          let password = null;
          if (flags & 0x80) { username = mqttReadString(payload, position); position = username?.next || position; }
          if (flags & 0x40) password = mqttReadString(payload, position);
          socket.authorized = username?.value === 'bblp' && password?.value === printer.checkCode;
          printer.log('bambu-mqtt', `CONNECT ${clientId.value}`);
          socket.write(mqttPacket(0x20, Buffer.from([0, socket.authorized ? 0 : 4])));
          if (!socket.authorized) socket.end();
        } else if (!socket.authorized) {
          socket.destroy();
        } else if (type === 8) {
          const packetId = payload.subarray(0, 2);
          const topic = mqttReadString(payload, 2);
          socket.subscribed = topic?.value === reportTopic || topic?.value === `device/${printer.serialNumber}/#`;
          socket.write(mqttPacket(0x90, Buffer.concat([packetId, Buffer.from([socket.subscribed ? 0 : 0x80])])));
          printer.log('bambu-mqtt', `SUBSCRIBE ${topic?.value || ''}`);
          publishStatus(socket);
        } else if (type === 3) {
          const topic = mqttReadString(payload, 0);
          if (!topic) continue;
          let position = topic.next;
          if (((header >> 1) & 0x03) > 0) position += 2;
          let body = {};
          try { body = JSON.parse(payload.subarray(position).toString()); } catch {}
          printer.log('bambu-mqtt', `PUBLISH ${topic.value}`, body);
          if (topic.value === requestTopic) {
            applyBambuCommand(printer, body);
            publishStatus(socket, body?.print?.sequence_id || body?.system?.sequence_id);
          }
        } else if (type === 12) socket.write(mqttPacket(0xd0));
        else if (type === 14) socket.end();
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => clients.delete(socket));
  });
  server.emulatorSockets = clients;
  const onChange = () => {
    for (const client of clients) publishStatus(client);
  };
  printer.on('change', onChange);
  server.once('close', () => printer.off('change', onChange));
  return server;
}

function createBambuCameraServer(printer) {
  const server = tls.createServer(BAMBU_TLS, (socket) => {
    let authenticated = false;
    let pending = Buffer.alloc(0);
    let timer = null;
    const sendFrame = () => {
      if (socket.destroyed || !authenticated) return;
      const header = Buffer.alloc(16);
      header.writeUInt32LE(TEST_FRAME_JPEG.length, 0);
      header.writeUInt32LE(0, 4);
      header.writeBigUInt64LE(BigInt(Date.now()) * 1000n, 8);
      socket.write(Buffer.concat([header, TEST_FRAME_JPEG]));
    };
    socket.on('data', (chunk) => {
      if (authenticated) return;
      pending = Buffer.concat([pending, chunk]);
      if (pending.length < 80) return;
      const magic = pending.readUInt32LE(0);
      const username = pending.subarray(16, 48).toString().replace(/\0.*$/, '');
      const password = pending.subarray(48, 80).toString().replace(/\0.*$/, '');
      if (magic !== 0x40 || username !== 'bblp' || password !== printer.checkCode || !printer.online || printer.faults.cameraUnavailable) {
        printer.log('bambu-camera', 'Camera authentication rejected');
        socket.destroy();
        return;
      }
      authenticated = true;
      printer.log('bambu-camera', 'Camera stream opened');
      sendFrame();
      timer = setInterval(sendFrame, 1000);
      timer.unref?.();
    });
    socket.on('error', () => {});
    socket.on('close', () => clearInterval(timer));
  });
  server.emulatorSockets = new Set();
  server.on('secureConnection', (socket) => {
    server.emulatorSockets.add(socket);
    socket.once('close', () => server.emulatorSockets.delete(socket));
  });
  return server;
}

function createBambuFtpsServer(printer) {
  const server = tls.createServer(BAMBU_TLS, (socket) => {
    let authenticated = false;
    let username = '';
    let commandBuffer = '';
    let dataServer = null;
    let dataSocketPromise = null;
    socket.setEncoding('utf8');
    socket.write('220 Bambu Lab Printer Simulator FTP server ready\r\n');
    const closeData = () => {
      for (const connection of dataServer?.emulatorSockets || []) connection.destroy();
      dataServer?.close();
      dataServer = null;
      dataSocketPromise = null;
    };
    const openPassive = async () => {
      closeData();
      let accept;
      dataSocketPromise = new Promise((resolve) => { accept = resolve; });
      dataServer = tls.createServer(BAMBU_TLS, (connection) => accept(connection));
      dataServer.emulatorSockets = new Set();
      dataServer.on('secureConnection', (connection) => {
        dataServer.emulatorSockets.add(connection);
        connection.once('close', () => dataServer?.emulatorSockets?.delete(connection));
      });
      const port = await listen(dataServer, printer.host, 0);
      return port;
    };
    const transfer = async (operation) => {
      if (!dataSocketPromise) return socket.write('425 Use PASV or EPSV first\r\n');
      socket.write('150 Opening encrypted data connection\r\n');
      const dataSocket = await Promise.race([
        dataSocketPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('data timeout')), 5000))
      ]);
      await operation(dataSocket);
      dataSocket.end();
      socket.write('226 Transfer complete\r\n');
      closeData();
    };
    socket.on('data', (chunk) => {
      commandBuffer += chunk;
      const lines = commandBuffer.split(/\r?\n/);
      commandBuffer = lines.pop() || '';
      for (const line of lines.filter(Boolean)) {
        const [rawCommand, ...parts] = line.trim().split(' ');
        const command = rawCommand.toUpperCase();
        const argument = parts.join(' ').replace(/^\/+/, '');
        printer.log('bambu-ftps', `${command}${argument ? ` ${argument}` : ''}`);
        if (command === 'USER') { username = argument; socket.write('331 Password required\r\n'); }
        else if (command === 'PASS') {
          authenticated = username === 'bblp' && argument === printer.checkCode;
          socket.write(authenticated ? '230 Login successful\r\n' : '530 Login incorrect\r\n');
        } else if (!authenticated) socket.write('530 Please login\r\n');
        else if (command === 'SYST') socket.write('215 UNIX Type: L8\r\n');
        else if (command === 'FEAT') socket.write('211-Features\r\n EPSV\r\n PASV\r\n PBSZ\r\n PROT\r\n SIZE\r\n211 End\r\n');
        else if (['PBSZ', 'PROT', 'TYPE', 'CWD', 'OPTS'].includes(command)) socket.write('200 Command okay\r\n');
        else if (command === 'PWD') socket.write('257 "/" is current directory\r\n');
        else if (command === 'NOOP') socket.write('200 NOOP okay\r\n');
        else if (command === 'EPSV') openPassive().then((port) => socket.write(`229 Entering Extended Passive Mode (|||${port}|)\r\n`)).catch(() => socket.write('425 Cannot open data connection\r\n'));
        else if (command === 'PASV') openPassive().then((port) => socket.write(`227 Entering Passive Mode (127,0,0,1,${Math.floor(port / 256)},${port % 256})\r\n`)).catch(() => socket.write('425 Cannot open data connection\r\n'));
        else if (command === 'LIST' || command === 'MLSD') transfer(async (data) => {
          const listing = [...printer.files.values()].map((file) => command === 'MLSD'
            ? `type=file;size=${file.size};modify=20240101000000; ${file.path}`
            : `-rw-r--r-- 1 bblp bblp ${file.size} Jan 01 00:00 ${file.path}`).join('\r\n');
          data.write(`${listing}\r\n`);
        }).catch(() => socket.write('425 Data connection failed\r\n'));
        else if (command === 'SIZE') socket.write(printer.files.has(argument) ? `213 ${printer.files.get(argument).size}\r\n` : '550 File unavailable\r\n');
        else if (command === 'RETR') {
          const file = printer.files.get(argument);
          if (!file) socket.write('550 File unavailable\r\n');
          else transfer(async (data) => data.write(Buffer.from(file.content || ''))).catch(() => socket.write('425 Data connection failed\r\n'));
        } else if (command === 'STOR') transfer(async (data) => {
          const chunks = [];
          for await (const chunk of data) chunks.push(chunk);
          const content = Buffer.concat(chunks);
          printer.addFile(argument, { size: content.length, content });
        }).catch(() => socket.write('425 Data connection failed\r\n'));
        else if (command === 'DELE') { printer.removeFile(argument); socket.write('250 File deleted\r\n'); }
        else if (command === 'QUIT') socket.end('221 Goodbye\r\n');
        else socket.write('502 Command not implemented\r\n');
      }
    });
    socket.on('error', () => {});
    socket.on('close', closeData);
  });
  server.emulatorSockets = new Set();
  server.on('secureConnection', (socket) => {
    server.emulatorSockets.add(socket);
    socket.once('close', () => server.emulatorSockets.delete(socket));
  });
  return server;
}

export async function startProtocolEndpoints(printer) {
  const servers = [];
  try {
    if (printer.adapterType === 'snapmaker-u1') {
      const server = createMoonrakerServer(printer);
      printer.ports.httpPort = await listen(server, printer.host, Number(printer.ports.httpPort));
      servers.push(server);
    } else if (printer.adapterType === 'flashforge-ad5m') {
      const httpServer = createFlashForgeHttpServer(printer);
      printer.ports.httpPort = await listen(httpServer, printer.host, Number(printer.ports.httpPort));
      servers.push(httpServer);
      const tcpServer = createFlashForgeTcpServer(printer);
      printer.ports.tcpPort = await listen(tcpServer, printer.host, Number(printer.ports.tcpPort));
      servers.push(tcpServer);
      const cameraServer = createCameraServer(printer);
      printer.ports.cameraPort = await listen(cameraServer, printer.host, Number(printer.ports.cameraPort));
      servers.push(cameraServer);
    } else if (printer.adapterType === 'bambu-lab') {
      const mqttServer = createBambuMqttServer(printer);
      printer.ports.mqttPort = await listen(mqttServer, printer.host, Number(printer.ports.mqttPort));
      servers.push(mqttServer);
      const ftpsServer = createBambuFtpsServer(printer);
      printer.ports.ftpsPort = await listen(ftpsServer, printer.host, Number(printer.ports.ftpsPort));
      servers.push(ftpsServer);
      const cameraServer = createBambuCameraServer(printer);
      printer.ports.cameraPort = await listen(cameraServer, printer.host, Number(printer.ports.cameraPort));
      servers.push(cameraServer);
    } else {
      throw new Error(`No emulator protocol implementation for ${printer.adapterType}`);
    }
    printer.log('system', 'Protocol endpoints started', { ...printer.ports });
    return {
      async close() {
        await Promise.allSettled(servers.map(closeServer));
      }
    };
  } catch (error) {
    await Promise.allSettled(servers.map(closeServer));
    throw error;
  }
}
