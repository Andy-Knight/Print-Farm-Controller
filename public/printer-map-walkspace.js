const obstacles = new Set(['bench', 'rack', 'shelf', 'rectangle', 'computer', 'controller', 'chair', 'stool', 'plant-pot', 'window', 'bin']);
const front = [[0, 1], [-1, 0], [0, -1], [1, 0]];

export function centreOf({ x, y, width, height }) {
  return { x:x + width / 2, y:y + height / 2 };
}

export function computerSeat(computer, seats, step) {
  const centre = centreOf(computer);
  const [dx, dy] = front[(computer.rotation || 0) / 90];
  const across = (dx ? computer.height : computer.width) / 2;
  const depth = (dx ? computer.width : computer.height) / 2;
  let closest = null;
  let shortest = Infinity;
  for (const seat of seats) {
    const position = centreOf(seat);
    const x = position.x - centre.x;
    const y = position.y - centre.y;
    const forward = x * dx + y * dy;
    const lateral = Math.abs(x * dy - y * dx);
    const seatDepth = (dx ? seat.width : seat.height) / 2;
    const gap = forward - depth - seatDepth;
    const extendsPastKeyboard = forward + seatDepth > depth;
    if (forward <= 0 || !extendsPastKeyboard || gap > step * 4 || lateral > across) continue;
    const distance = Math.hypot(forward, lateral);
    if (distance < shortest) {
      shortest = distance;
      closest = seat;
    }
  }
  return closest;
}

export function createWalkspace({ width, height, step, items, printers, walls, doors }) {
  const cell = step / 2;
  // Half the 36px walking sprite at 15px per grid step.
  const furnitureClearance = step * 1.2;
  const columns = Math.floor(width / cell);
  const rows = Math.floor(height / cell);
  const blocked = new Uint8Array(columns * rows);
  const wallBlocked = new Uint8Array(blocked.length);
  const point = id => ({ x:(id % columns + .5) * cell, y:(Math.floor(id / columns) + .5) * cell });
  const cellAt = (x, y) => {
    const col = Math.floor(x / cell);
    const row = Math.floor(y / cell);
    return col >= 0 && col < columns && row >= 0 && row < rows ? row * columns + col : -1;
  };

  function fill(grid, rect, skip = () => false) {
    for (let row = Math.max(0, Math.floor(rect.y / cell)); row < Math.min(rows, Math.ceil((rect.y + rect.height) / cell)); row++) {
      for (let col = Math.max(0, Math.floor(rect.x / cell)); col < Math.min(columns, Math.ceil((rect.x + rect.width) / cell)); col++) {
        const id = row * columns + col;
        const { x, y } = point(id);
        if (x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height && !skip(x, y)) grid[id] = 1;
      }
    }
  }

  for (const wall of walls) {
    const { vertical, from, to, centre } = wall;
    const openings = doors.filter(door => door.vertical === vertical && door.centre === centre);
    const rect = vertical
      ? { x:centre - cell, y:from - cell / 2, width:2 * cell, height:to - from + cell }
      : { x:from - cell / 2, y:centre - cell, width:to - from + cell, height:2 * cell };
    fill(wallBlocked, rect, (x, y) => openings.some(door => {
      const along = vertical ? y : x;
      return along > door.start + cell / 2 && along < door.end - cell / 2;
    }));
  }
  blocked.set(wallBlocked);
  // Route the character's centre far enough from furniture for the walking sprite to clear it.
  for (const rect of [...items.filter(item => obstacles.has(item.type)), ...printers]) {
    fill(blocked, {
      x:rect.x - furnitureClearance, y:rect.y - furnitureClearance,
      width:rect.width + 2 * furnitureClearance, height:rect.height + 2 * furnitureClearance
    });
  }

  function approaches(rect, [dx, dy] = [0, 1], maxGap = step * 5) {
    const { x, y } = centreOf(rect);
    const sides = [[dx, dy], [-dy, dx], [dy, -dx], [-dx, -dy]];
    const targets = new Set();
    for (const [sx, sy] of sides) {
      const depth = (sx ? rect.width : rect.height) / 2;
      const span = (sx ? rect.height : rect.width) / 2;
      const edge = Math.max(0, span - cell / 2);
      for (const offset of [0, -span / 2, span / 2, -edge, edge]) {
        for (let gap = cell / 2; gap <= maxGap + furnitureClearance; gap += cell) {
          const id = cellAt(x + sx * (depth + gap) - sy * offset, y + sy * (depth + gap) + sx * offset);
          if (id < 0 || wallBlocked[id]) break;
          if (!blocked[id]) {
            targets.add(id);
            break;
          }
        }
      }
    }
    return [...targets];
  }

  function route(from, targets) {
    if (!targets.length) return null;
    if (!from) return [point(targets[0])];
    let start = cellAt(from.x, from.y);
    if (start < 0 || blocked[start]) {
      [start] = approaches({ ...from, width:0, height:0 })
        .sort((a, b) => distance(point(a), from) - distance(point(b), from));
      if (start === undefined) return null;
    }
    const ends = new Set(targets);
    const previous = new Int32Array(blocked.length).fill(-1);
    const pending = new Int32Array(blocked.length);
    pending[0] = previous[start] = start;
    let size = 1;
    for (let head = 0; head < size; head++) {
      const id = pending[head];
      if (ends.has(id)) {
        const path = [];
        let direction = 0;
        for (let next = id; next !== start;) {
          const parent = previous[next];
          if (next - parent !== direction) path.push(point(next));
          direction = next - parent;
          next = parent;
        }
        return [point(start), ...path.reverse()];
      }
      const neighbours = [
        id % columns > 0 ? id - 1 : -1,
        id % columns < columns - 1 ? id + 1 : -1,
        id - columns,
        id + columns
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || neighbour >= blocked.length || blocked[neighbour] || previous[neighbour] !== -1) continue;
        previous[neighbour] = id;
        pending[size++] = neighbour;
      }
    }
    return null;
  }

  function doorApproaches(door) {
    const offset = (door.start + door.end) / 2;
    const threshold = door.vertical ? { x:door.centre, y:offset } : { x:offset, y:door.centre };
    const limit = door.vertical ? width : height;
    const sides = door.centre <= step ? [1] : door.centre >= limit - step ? [-1] : [-1, 1];
    return sides.flatMap(side => {
      const dx = door.vertical ? side * step : 0;
      const dy = door.vertical ? 0 : side * step;
      const id = cellAt(threshold.x + dx, threshold.y + dy);
      const outside = { x:threshold.x - dx, y:threshold.y - dy };
      if (id < 0 || blocked[id] || blocked[cellAt(outside.x, outside.y)]) return [];
      return [{ id, itemId:door.itemId, sweep:door.sweep, inside:point(id), threshold, outside }];
    });
  }

  function clearFlight(from, to) {
    const steps = Math.ceil(distance(from, to) / (cell / 2));
    for (let i = 0; i <= steps; i++) {
      const fraction = steps ? i / steps : 0;
      const id = cellAt(from.x + (to.x - from.x) * fraction, from.y + (to.y - from.y) * fraction);
      if (id < 0 || wallBlocked[id]) return false;
    }
    return true;
  }

  return { route, approaches, doorApproaches, cellAt, clearFlight };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function deskFront(computer) {
  return front[(computer.rotation || 0) / 90];
}
