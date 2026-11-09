import { paperPlaneShape } from './printer-map-artwork.js';
import { centreOf, computerSeat, createWalkspace, deskFront } from './printer-map-walkspace.js';

const blueOvershirt = `<svg viewBox="0 0 44 52" focusable="false">
  <ellipse class="map-person-shadow" cx="22" cy="34" rx="17" ry="16"/>
  <g class="map-person-standing">
    <g class="map-person-legs-resting">
      <path class="map-person-leg" d="m16 31-3 13m15-13 3 16"/>
      <path class="map-person-shoe" d="m13 42-1 5m19-2 1 4"/>
    </g>
    <g class="map-person-legs-walking">
      <g transform="translate(13 32)">
        <path class="map-person-leg" d="M0 0v16"/>
        <path class="map-person-shoe" d="M0 13v5"/>
      </g>
      <g class="map-person-right" transform="translate(31 32)">
        <path class="map-person-leg" d="M0 0v16"/>
        <path class="map-person-shoe" d="M0 13v5"/>
      </g>
    </g>
    <g transform="translate(10 22)">
      <g class="map-person-arm-swing">
        <path class="map-person-arm" d="M0 0-4.5 1.5-8 0"/>
        <path class="map-person-hand" d="M-8 0h-1.4"/>
      </g>
    </g>
    <g transform="translate(34 22) scale(-1 1)">
      <g class="map-person-arm-swing map-person-right">
        <path class="map-person-arm" d="M0 0-4.5 1.5-8 0"/>
        <path class="map-person-hand" d="M-8 0h-1.4"/>
      </g>
    </g>
  </g>
  <g class="map-person-legs-seated">
    <path class="map-person-leg" d="M17 34 13 14 12 9M27 34l4-20 1-5"/>
    <path class="map-person-shoe" d="M12 9 11 4m21 5 1-5"/>
  </g>
  <g class="map-person-seated">
    <path class="map-person-arm" d="m11 24-4-13m26 13 4-13"/>
    <path class="map-person-hand" d="M7 11V8m30 3V8"/>
  </g>
  <path class="map-person-shirt" d="M8 24q0-7 9-8h10q9 1 9 8l-2 12q-2 5-12 5t-12-5Z"/>
  <path class="map-person-shirt-seam" d="M22 23v16"/>
  <ellipse class="map-person-skin" cx="22" cy="14" rx="8" ry="9"/>
  <ellipse class="map-person-skin" cx="22" cy="5" rx="2" ry="2"/>
  <ellipse class="map-person-hair" cx="22" cy="15.5" rx="7" ry="7"/>
  <g class="map-person-carry">
    <path class="map-person-arm" d="M10 22 7 12 12 0M34 22 37 12 32 0"/>
    <g class="map-person-part">
      <path d="M13-10h18v8l-3 4H13z"/>
      <path d="M13-10h18l-3 4H13zm15 4v8" fill="none"/>
    </g>
    <path class="map-person-hand" d="M12 0h3"/>
    <path class="map-person-hand" d="M29 0h3"/>
  </g>
  <g class="map-person-throwing">
    <path class="map-person-arm" d="m11 24-4-10"/>
    <path class="map-person-hand" d="M7 14v-3"/>
    <g class="map-person-throw-arm">
      <path class="map-person-arm" d="M34 22 39 13 35 7"/>
      <path class="map-person-hand" d="m35 7-1-2"/>
    </g>
  </g>
</svg>`;

const heading = (from, to) => Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 90;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const walkingSpeed = 80;
const stepLength = 24;

function crossingsBetween(from, to, doors) {
  return doors.flatMap(door => {
    const axis = door.vertical ? 'x' : 'y';
    const along = door.vertical ? 'y' : 'x';
    const change = to[axis] - from[axis];
    if (!change) return [];
    const at = (door.centre - from[axis]) / change;
    if (at <= 0 || at >= 1) return [];
    const offset = from[along] + (to[along] - from[along]) * at;
    return offset > door.start && offset < door.end ? [{ door, at }] : [];
  }).sort((a, b) => a.at - b.at);
}

export function createPrinterMapPerson(canvas, { step, scale, getItemNode }) {
  const node = document.createElement('div');
  node.className = 'printer-map-person';
  node.style.setProperty('--person-stride-duration', `${2 * stepLength / walkingSpeed}s`);
  node.hidden = true;
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = blueOvershirt;
  canvas.append(node);
  const plane = document.createElement('div');
  plane.className = 'printer-map-plane';
  plane.hidden = true;
  plane.setAttribute('aria-hidden', 'true');
  plane.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${paperPlaneShape}</svg>`;
  canvas.append(plane);
  const sprite = getComputedStyle(node.firstElementChild);
  // Allow for the rotated sprite and the thickness of the door leaf.
  const doorClearance = Math.hypot(parseFloat(sprite.width), parseFloat(sprite.height)) / (2 * scale) + 2;
  const openDoors = new Map();

  let key = '';
  let generation = 0;
  let idleTimer;
  let movement;
  let flight;
  let running = false;
  let activeDesk;
  let deskAt;
  let motionEnabled = true;
  let position;
  let seatedApproach;
  let space;
  let desks = [];
  let doors = [];
  let targets = new Map();
  let shelves = [];
  let bins = [];
  const placedParts = new Set();
  let completions = new Map();
  let pending = [];

  function clearDesk() {
    activeDesk?.removeAttribute('data-workstation-active');
    activeDesk = null;
    deskAt = null;
  }

  function closeDoor(id) {
    openDoors.get(id)?.node?.removeAttribute('data-door-open');
    openDoors.delete(id);
  }

  function closeClearedDoors(point) {
    for (const [id, { sweep, crossing }] of openDoors) {
      if (crossing) continue;
      const dx = Math.max(sweep.left - point.x, point.x - sweep.right, 0);
      const dy = Math.max(sweep.top - point.y, point.y - sweep.bottom, 0);
      if (Math.hypot(dx, dy) > doorClearance) closeDoor(id);
    }
  }

  function stop() {
    if (!key) return;
    key = '';
    generation++;
    clearTimeout(idleTimer);
    movement?.cancel();
    movement = null;
    flight?.cancel();
    flight = null;
    plane.hidden = true;
    delete node.dataset.throwing;
    clearDesk();
    for (const id of openDoors.keys()) closeDoor(id);
    running = false;
    position = null;
    seatedApproach = null;
    pending = [];
    delete node.dataset.carrying;
    node.hidden = true;
    for (const part of placedParts) part.hidden = true;
    placedParts.clear();
  }

  function transform({ x, y }) {
    return `translate(${x * scale}px, ${y * scale}px)`;
  }

  function pose(value, from, to) {
    node.dataset.pose = value;
    if (from && to && distance(from, to) > .1) node.style.setProperty('--person-heading', `${heading(from, to)}deg`);
  }

  async function moveTo(point, token) {
    if (token !== generation) return false;
    const from = position;
    const length = from ? distance(from, point) * scale : 0;
    if (length > 1) {
      pose('walking', from, point);
      const animation = node.animate([{ transform:transform(from) }, { transform:transform(point) }],
        { duration:1000 * length / walkingSpeed, easing:'linear' });
      movement = animation;
      let frame;
      const checkDoors = () => {
        if (token !== generation || !openDoors.size) return;
        const progress = animation.effect.getComputedTiming().progress;
        if (progress !== null) {
          closeClearedDoors({
            x:from.x + (point.x - from.x) * progress,
            y:from.y + (point.y - from.y) * progress
          });
        }
        if (openDoors.size) frame = requestAnimationFrame(checkDoors);
      };
      if (openDoors.size) frame = requestAnimationFrame(checkDoors);
      try { await animation.finished; } catch { return false; } finally { cancelAnimationFrame(frame); }
      if (token !== generation) return false;
      movement = null;
    }
    position = point;
    node.style.transform = transform(point);
    node.hidden = false;
    closeClearedDoors(point);
    return true;
  }

  async function walk(points, token) {
    if (token !== generation) return false;
    clearDesk();
    seatedApproach = null;
    for (const point of points) {
      const from = position;
      const crossings = from ? crossingsBetween(from, point, doors) : [];
      if (crossings.length) {
        const pointAt = fraction => ({
          x:from.x + (point.x - from.x) * fraction,
          y:from.y + (point.y - from.y) * fraction
        });
        const margin = step / distance(from, point);
        let passed = 0;
        for (const [index, { door, at }] of crossings.entries()) {
          if (at <= passed) continue;
          if (!await moveTo(pointAt(Math.max(passed, at - margin)), token)) return false;
          const next = crossings[index + 1]?.at;
          passed = Math.min(1, at + margin, next === undefined ? 1 : (at + next) / 2);
          if (!await crossDoor(door, [pointAt(passed)], token)) return false;
        }
      }
      if (!await moveTo(point, token)) return false;
    }
    return token === generation;
  }

  function deskRoute(desk) {
    if (desk.seat) {
      const route = space.route(seatedApproach || position, space.approaches(desk.seat, deskFront(desk)));
      if (route) return { route:[...route, centreOf(desk.seat)], seated:true, desk };
    }
    const route = space.route(seatedApproach || position, space.approaches(desk, deskFront(desk)));
    return route && { route, seated:false, desk };
  }

  async function goToDesk(token, random) {
    const choices = [...desks];
    while (choices.length) {
      const [desk] = choices.splice(random ? Math.floor(Math.random() * choices.length) : 0, 1);
      const destination = deskRoute(desk);
      if (!destination) continue;
      if (!await walk(position ? destination.route : destination.route.slice(-1), token)) return;
      seatedApproach = destination.seated ? destination.route.at(-2) : null;
      delete node.dataset.carrying;
      pose(destination.seated ? 'seated' : 'standing', position, centreOf(desk));
      deskAt = desk;
      if (destination.seated && motionEnabled) {
        activeDesk = getItemNode(desk.id);
        activeDesk?.setAttribute('data-workstation-active', '');
      }
      return;
    }
    pose('standing');
  }

  async function collect(printerId, token) {
    const target = targets.get(printerId);
    if (!target) return;
    const route = space.route(seatedApproach || position, target.points);
    if (!route || !await walk(route, token)) return;
    pose('collecting', position, centreOf(target.printer));
    await wait(950);
    if (token !== generation) return;
    node.dataset.carrying = 'true';
    if (await dropAtShelf(token)) await goToDesk(token, true);
  }

  async function dropAtShelf(token) {
    const visit = shelfVisit(position, '[hidden]');
    if (!visit) return true;
    if (!await walk(visit.route, token)) return false;
    pose('dropping', position, centreOf(visit.shelf));
    await wait(650);
    if (token !== generation) return false;
    visit.part.hidden = false;
    placedParts.add(visit.part);
    delete node.dataset.carrying;
    return true;
  }

  function shelfVisit(from, partSelector) {
    const available = new Map();
    for (const { shelf, points } of shelves) {
      const part = getItemNode(shelf.id)?.querySelector(`.printer-map-shelf-parts > span${partSelector}`);
      if (!part) continue;
      for (const cell of points) {
        if (!available.has(cell)) available.set(cell, { shelf, part });
      }
    }
    const route = space.route(from, [...available.keys()]);
    if (!route) return null;
    const { x, y } = route.at(-1);
    return { route, ...available.get(space.cellAt(x, y)) };
  }

  function doorTrip(from) {
    const options = doors.flatMap(door => space.doorApproaches(door));
    const route = space.route(from, options.map(door => door.id));
    if (!route) return null;
    const inside = route.at(-1);
    const door = options.find(option => distance(option.inside, inside) === 0);
    return door && { route, door };
  }

  async function crossDoor(door, route, token, returning = false) {
    if (token !== generation) return false;
    let open = openDoors.get(door.itemId);
    if (open) {
      open.crossing = true;
    } else {
      open = { node:getItemNode(door.itemId), sweep:door.sweep, crossing:true };
      openDoors.set(door.itemId, open);
      open.node?.setAttribute('data-door-open', '');
      await wait(220);
    }
    if (token !== generation) return false;
    if (returning) node.hidden = false;
    try {
      for (const point of route) {
        if (!await moveTo(point, token)) return false;
      }
      return true;
    } finally {
      if (token === generation) {
        open.crossing = false;
        closeClearedDoors(position);
      }
    }
  }

  async function leaveRoom(token, trip) {
    const visit = placedParts.size ? shelfVisit(seatedApproach || position, ':not([hidden])') : null;
    const fromShelf = visit && doorTrip(visit.route.at(-1));
    if (fromShelf) {
      if (!await walk(visit.route, token)) return;
      pose('collecting', position, centreOf(visit.shelf));
      await wait(950);
      if (token !== generation) return;
      visit.part.hidden = true;
      placedParts.delete(visit.part);
      node.dataset.carrying = 'true';
      trip = fromShelf;
    }
    const { route, door } = trip;
    if (!await walk(route, token) || !await crossDoor(door, [door.threshold, door.outside], token)) return;
    node.hidden = true;
    delete node.dataset.carrying;
    for (const id of openDoors.keys()) closeDoor(id);
    await wait(4000);
    if (token !== generation) return;
    if (await crossDoor(door, [door.threshold, door.inside], token, true)) await goToDesk(token, true);
  }

  function paperTargets() {
    if (!deskAt) return [];
    return bins.flatMap(bin => {
      const to = centreOf(bin);
      const length = distance(position, to);
      if (length < step) return [];
      const dx = (to.x - position.x) / length;
      const dy = (to.y - position.y) / length;
      const from = {
        x:position.x + step * (dx - dy * .7),
        y:position.y + step * (dy + dx * .7)
      };
      const clear = [position, to].every(point => space.clearFlight(from, point)
        && crossingsBetween(from, point, doors).every(({ door }) => openDoors.has(door.itemId)));
      return clear ? [{ binId:bin.id, from, to }] : [];
    });
  }

  async function throwPaper({ binId, from, to }, token) {
    const facing = node.style.getPropertyValue('--person-heading');
    node.style.setProperty('--person-heading', `${heading(position, to)}deg`);
    node.dataset.throwing = '';
    try {
      await wait(260);
      if (token !== generation) return;
      const angle = heading(from, to);
      const tilt = `translate(-50%, -50%) rotate(${angle}deg)`;
      const mid = { x:(from.x + to.x) / 2, y:(from.y + to.y) / 2 };
      plane.hidden = false;
      flight = plane.animate([
        { transform:`${transform(from)} ${tilt}`, opacity:1 },
        { transform:`${transform(mid)} ${tilt} scale(1.12)`, opacity:1 },
        { transform:`${transform(to)} ${tilt} scale(.8)`, opacity:1 }
      ], { duration:Math.min(1400, Math.max(650, distance(from, to) * scale * 4)), easing:'ease-out' });
      try { await flight.finished; } catch { return; }
      if (token === generation) getItemNode(binId)?.setAttribute('data-paper-landed', '');
    } finally {
      if (token === generation) {
        flight = null;
        plane.hidden = true;
        delete node.dataset.throwing;
        node.style.setProperty('--person-heading', facing);
      }
    }
  }

  async function idleAction(token) {
    const trip = doors.length ? doorTrip(seatedApproach || position) : null;
    const throws = paperTargets();
    if (throws.length && (!trip || Math.random() < .5)) {
      return throwPaper(throws[Math.floor(Math.random() * throws.length)], token);
    }
    if (trip) return leaveRoom(token, trip);
  }

  async function run(task) {
    if (running || !key) return;
    clearTimeout(idleTimer);
    running = true;
    const token = generation;
    try {
      await task(token);
    } finally {
      if (token === generation) {
        running = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (running || !key || !position || !motionEnabled) return;
    if (pending.length) {
      const next = pending.shift();
      void run(token => collect(next, token));
    } else if (doors.length || (deskAt && bins.length)) {
      idleTimer = setTimeout(() => void run(idleAction), 60000 + Math.random() * 60000);
    }
  }

  function update({ map, tiles, printers, walls, doorways, width, height, motionEnabled:nextMotionEnabled }) {
    const items = map?.items || [];
    const computers = items.filter(item => item.type === 'computer');
    if (!map || !computers.length) {
      stop();
      return;
    }
    const nextKey = JSON.stringify([map.id, map.revision, width, height, printers, nextMotionEnabled]);
    const visible = new Set(printers.map(printer => printer.id));
    if (key !== nextKey) {
      stop();
      key = nextKey;
      motionEnabled = nextMotionEnabled;
      doors = [...doorways];
      space = createWalkspace({ width, height, step, items, printers, walls, doors });
      const seats = items.filter(item => item.type === 'chair' || item.type === 'stool');
      desks = computers.map(computer => ({ ...computer, seat:computerSeat(computer, seats, step) }));
      targets = new Map(printers.map(printer => [printer.id, { points:space.approaches(printer), printer }]));
      shelves = items.filter(item => item.type === 'shelf')
        .map(shelf => ({ shelf, points:space.approaches(shelf, [0, 1], step / 2) }));
      bins = items.filter(item => item.type === 'bin');
      completions = new Map(tiles.filter(tile => visible.has(tile.id)).map(tile => [tile.id, tile.completedAt || 0]));
      delete node.dataset.carrying;
      void run(token => goToDesk(token, false));
      return;
    }
    if (!motionEnabled) return;
    for (const tile of tiles) {
      if (!visible.has(tile.id)) continue;
      const latest = tile.completedAt || 0;
      const previous = completions.get(tile.id);
      if (position && previous !== undefined && latest > previous) pending.push(tile.id);
      completions.set(tile.id, Math.max(previous || 0, latest));
    }
    if (pending.length) schedule();
  }

  return { update, stop };
}
