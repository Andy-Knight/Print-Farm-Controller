export const maxRackLevels = 6;
export const maxRackBays = 6;
export const defaultRackSize = { levels:1, bays:2 };

export function rackSlotKey(level, bay) {
  return `${level}:${bay}`;
}

export function rackBayBounds(rack, bay) {
  const vertical = rack.height > rack.width;
  const width = vertical ? rack.width : rack.width / rack.bays;
  const height = vertical ? rack.height / rack.bays : rack.height;
  return {
    x:rack.x + (vertical ? 0 : (bay - 1) * width),
    y:rack.y + (vertical ? (bay - 1) * height : 0),
    width, height
  };
}
