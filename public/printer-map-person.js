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
    <path class="map-person-arm map-person-left" d="m10 22-4 12"/>
    <path class="map-person-arm map-person-right" d="m34 22 4-6"/>
    <path class="map-person-hand map-person-left" d="m6 34-1 2"/>
    <path class="map-person-hand map-person-right" d="m38 16 1-2"/>
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
  <g class="map-person-part">
    <path d="m22 5 6-3 6 3v7l-6 3-6-3z"/>
    <path d="m22 5 6 3 6-3m-6 3v7" fill="none"/>
  </g>
</svg>`;

const heading = (from, to) => Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 90;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const walkingSpeed = 80;
const stepLength = 24;

export function createPrinterMapPerson(canvas, { step, scale, getItemNode }) {
  const node = document.createElement('div');
  node.className = 'printer-map-person';
  node.style.setProperty('--person-stride-duration', `${2 * stepLength / walkingSpeed}s`);
  node.hidden = true;
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = blueOvershirt;
  canvas.append(node);

  let key = '';
  let generation = 0;
  let idleTimer;
  let movement;
  let running = false;
  let activeDesk;
  let activeDoor;
  let motionEnabled = true;
  let position;
  let seatedApproach;
  let space;
  let desks = [];
  let doors = [];
  let targets = new Map();
  let shelves = [];
  const placedParts = new Set();
  let completions = new Map();
  let pending = [];

  function clearDesk() {
    activeDesk?.removeAttribute('data-workstation-active');
    activeDesk = null;
  }

  function closeDoor() {
    activeDoor?.removeAttribute('data-door-open');
    activeDoor = null;
  }

  function stop() {
    if (!key) return;
    key = '';
    generation++;
    clearTimeout(idleTimer);
    movement?.cancel();
    movement = null;
    clearDesk();
    closeDoor();
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

  async function walk(points, token) {
    if (token !== generation) return false;
    clearDesk();
    seatedApproach = null;
    for (const point of points) {
      if (token !== generation) return false;
      const length = position ? distance(position, point) * scale : 0;
      if (length > 1) {
        pose('walking', position, point);
        movement = node.animate([{ transform:transform(position) }, { transform:transform(point) }],
          { duration:1000 * length / walkingSpeed, easing:'linear' });
        try { await movement.finished; } catch { return false; }
        if (token !== generation) return false;
        movement = null;
      }
      position = point;
      node.style.transform = transform(point);
      node.hidden = false;
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
    activeDoor = getItemNode(door.itemId);
    activeDoor?.setAttribute('data-door-open', '');
    await wait(220);
    if (token !== generation) return false;
    if (returning) node.hidden = false;
    const crossed = await walk(route, token);
    if (token === generation) closeDoor();
    return crossed;
  }

  async function leaveRoom(token) {
    const from = seatedApproach || position;
    let trip = doorTrip(from);
    if (!trip) return;
    const visit = placedParts.size ? shelfVisit(from, ':not([hidden])') : null;
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
    await wait(4000);
    if (token !== generation) return;
    if (await crossDoor(door, [door.threshold, door.inside], token, true)) await goToDesk(token, true);
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
    } else if (doors.length) {
      idleTimer = setTimeout(() => void run(leaveRoom), 60000 + Math.random() * 60000);
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
