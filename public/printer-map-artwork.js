const materials = {
  rim:['rim-light', 'rim-dark'],
  leaf:['leaf-light', 'leaf-dark'],
  leafMuted:['leaf-mid', 'leaf-dark'],
  fabric:['fabric-light', 'fabric-dark'],
  timber:['wood-light', 'wood-dark'],
  metal:['metal-light', 'metal-dark'],
  graphite:['graphite-light', 'graphite-dark']
};

function gradients(id, names) {
  return `<defs>${names.map(name => {
    const [light, dark] = materials[name];
    return `<linearGradient id="${id}-${name}" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="var(--art-${light})"/><stop offset="1" stop-color="var(--art-${dark})"/>
    </linearGradient>`;
  }).join('')}</defs>`;
}

function rubberPlant(id) {
  const leaves = [[-18,20,8], [54,18,8], [121,19,7], [195,17,8], [269,20,8], [316,13,6]];
  return `${gradients(id, ['rim', 'leaf', 'leafMuted'])}
    <circle cx="25" cy="26" r="18" fill="var(--art-shadow)"/>
    <circle cx="24" cy="24" r="17" fill="url(#${id}-rim)" stroke="var(--art-rim-dark)"/>
    <circle cx="24" cy="24" r="14" fill="var(--art-soil)"/>
    ${leaves.map(([angle, length, width], index) => `
      <g transform="translate(${index % 2 ? 25 : 23} 24) rotate(${angle})">
        <path d="M0 0C-${width} -${length * .35} -${width} -${length * .75} 0 -${length}
          C${width} -${length * .75} ${width} -${length * .35} 0 0Z"
          fill="url(#${id}-${index % 2 ? 'leaf' : 'leafMuted'})" stroke="var(--art-leaf-dark)" stroke-width=".55"/>
        <path d="M0 -1V-${length - 2}" stroke="var(--art-leaf-vein)" stroke-width=".55"/>
      </g>`).join('')}
    <circle cx="24" cy="24" r="1.5" fill="var(--art-leaf-mid)"/>`;
}

function taskChair(id) {
  const casters = [0, 72, 144, 216, 288].map(angle => `
    <g transform="rotate(${angle})">
      <path d="M0 -17V0" stroke="var(--art-metal-light)" stroke-width="2.3"/>
      <rect x="-2" y="-18" width="4" height="3.6" rx="1" fill="var(--art-metal-dark)" stroke="var(--art-edge)"/>
    </g>`).join('');
  return `${gradients(id, ['fabric'])}
    <g transform="scale(1 1.25)">
      <ellipse cx="25" cy="29" rx="19" ry="19" fill="var(--art-shadow)"/>
      <g transform="translate(24 29)">${casters}</g>
      <g fill="url(#${id}-fabric)" stroke="var(--art-edge)">
        <rect x="11" y="17" width="26" height="23" rx="6"/>
        <rect x="9" y="4" width="30" height="10" rx="4"/>
      </g>
      <rect x="14" y="20" width="20" height="17" rx="4" fill="url(#${id}-fabric)" stroke="var(--art-fabric-dark)"/>
      <g fill="var(--art-metal-dark)" stroke="var(--art-edge)">
        <rect x="6.5" y="18" width="4.5" height="16" rx="1.8"/>
        <rect x="37" y="18" width="4.5" height="16" rx="1.8"/>
      </g>
      <path d="M7.5 20V31M38 20V31" stroke="var(--art-metal-light)" stroke-width=".5"/>
      <path d="M12 8Q24 5.5 36 8" stroke="var(--art-fabric-light)" stroke-width=".8"/>
    </g>`;
}

function timberStool(id) {
  const legs = [11, 131, 251].map(angle => `<rect transform="rotate(${angle})" x="-2.2" y="-21"
    width="4.4" height="12" rx="1.3" fill="var(--art-wood-dark)" stroke="var(--art-wood-grain)"/>`).join('');
  return `${gradients(id, ['timber'])}
    <ellipse cx="25" cy="26" rx="20" ry="19" fill="var(--art-shadow)"/>
    <g transform="translate(24 24)">${legs}</g>
    <circle cx="24" cy="24" r="14.7" fill="url(#${id}-timber)" stroke="var(--art-wood-dark)"/>
    <path d="M16 15Q23 17 31 15M13 19Q23 21 35 19M12 23Q23 25 36 23
      M12 27Q23 29 36 27M14 31Q23 33 34 31M18 35Q23 36 30 35"
      stroke="var(--art-wood-grain)" stroke-width=".6"/>`;
}

function desktopWorkstation(id) {
  return `${gradients(id, ['metal'])}
    <defs>
      <linearGradient id="${id}-screen-light" gradientUnits="userSpaceOnUse" x1="0" y1="14" x2="0" y2="44">
        <stop stop-color="var(--art-screen-light)" stop-opacity=".66"/>
        <stop offset=".25" stop-color="var(--art-screen-light)" stop-opacity=".36"/>
        <stop offset=".57" stop-color="var(--art-screen-light)" stop-opacity=".22"/>
        <stop offset="1" stop-color="var(--art-screen-light)" stop-opacity="0"/>
      </linearGradient>
      <filter id="${id}-screen-soften" x="-4" y="9" width="56" height="39" filterUnits="userSpaceOnUse">
        <feGaussianBlur stdDeviation="1.2"/>
      </filter>
      <clipPath id="${id}-screen-front"><rect x="-4" y="14" width="56" height="34"/></clipPath>
    </defs>
    <g transform="scale(1.5 1)">
      <g stroke="var(--art-edge)">
        <rect x="17" y="16" width="14" height="4.2" rx="1" fill="var(--art-metal-dark)"/>
        <rect x="22.2" y="14" width="3.6" height="5.5" rx="1" fill="var(--art-metal-light)"/>
        <rect x="4.5" y="11" width="39" height="4" rx="1.5" fill="url(#${id}-metal)"/>
        <rect x="6" y="27" width="31" height="10.5" rx="1.3" fill="var(--art-metal-light)"/>
        <rect x="40" y="27" width="5.5" height="8" rx="2.6" fill="url(#${id}-metal)"/>
      </g>
      <g class="printer-map-workstation-glow" clip-path="url(#${id}-screen-front)">
        <path d="M6.5 13H41.5L48 44H0Z" fill="url(#${id}-screen-light)" filter="url(#${id}-screen-soften)"/>
      </g>
      <path class="printer-map-workstation-screen" d="M6.5 14H41.5" stroke="var(--art-screen-edge)" stroke-width=".65"/>
      <path d="M8 29.5H35M8 32.5H35M8 35.4H15M31 35.4H35"
        stroke="var(--art-edge)" stroke-width="1.85" stroke-linecap="butt" stroke-dasharray="2.15 .65"/>
      <path d="M17.5 35.4H28.5" stroke="var(--art-edge)" stroke-width="1.85" stroke-linecap="butt"/>
      <path d="M42.7 27.8V30.5" stroke="var(--art-edge)" stroke-width=".65"/>
    </g>`;
}

function controllerMiniPc(id) {
  return `${gradients(id, ['graphite'])}
    <rect x="2" y="3" width="57" height="42" rx="7" fill="var(--art-shadow)"/>
    <rect x="1" y="1" width="58" height="42" rx="7" fill="url(#${id}-graphite)" stroke="var(--art-graphite-edge)"/>
    <path d="M11 8H49" stroke="var(--art-graphite-dark)" stroke-width="5"
      stroke-dasharray="2 2" stroke-linecap="butt"/>
    <g class="printer-map-controller-mark" fill="var(--art-controller-mark)" transform="translate(18 12) scale(.2)">
      <polygon points="60,2 114,27 60,52 6,27"/>
      <polygon points="14,39 60,60 106,39 114,43 60,69 6,43"/>
      <polygon points="14,58 60,79 106,58 114,62 60,90 6,62"/>
    </g>
    <path d="M10 36H50" stroke="var(--art-metal-light)" stroke-width="4"
      stroke-dasharray="7 4" stroke-linecap="butt"/>`;
}

function butcherBlock(id) {
  const boardWidth = 58;
  const boardHeight = 12;
  const columns = 4;
  const rows = 6;
  const boards = [];
  for (let row = 0; row < rows; row++) {
    for (let column = -1; column < columns; column++) {
      const x = column * boardWidth + row % 3 * 19;
      const tone = (column + columns + row * 3) % columns;
      boards.push(`<g transform="translate(${x} ${row * boardHeight})">
        <rect width="57.4" height="11.6" fill="var(--bench-board-${tone})"/>
        <path d="M3 4Q20 2.5 36 4T55 4M7 8Q25 6.5 43 8" fill="none"
          stroke="var(--bench-grain)" stroke-opacity=".27" stroke-width=".6"/>
      </g>`);
    }
  }
  return `<svg class="printer-map-bench-finish" aria-hidden="true">
    <defs><pattern id="${id}" width="${boardWidth * columns}" height="${boardHeight * rows}" patternUnits="userSpaceOnUse">
      <rect width="${boardWidth * columns}" height="${boardHeight * rows}" fill="var(--bench-edge)"/>
      ${boards.join('')}
    </pattern></defs>
    <rect width="100%" height="100%" fill="url(#${id})"/>
    <rect y="100%" width="100%" height="3" transform="translate(0 -3)" fill="var(--bench-edge)"/>
  </svg>`;
}

const designs = {
  'plant-pot':{ size:[48, 48], draw:rubberPlant },
  chair:{ size:[48, 60], draw:taskChair },
  stool:{ size:[48, 48], draw:timberStool },
  computer:{ size:[72, 48], draw:desktopWorkstation },
  controller:{ size:[60, 45], draw:controllerMiniPc }
};
let nextArtworkId = 0;

export function printerMapFurnitureArtwork(type) {
  if (type === 'bench') return butcherBlock(`pfc-art-${++nextArtworkId}`);
  if (!Object.hasOwn(designs, type)) return '';
  const { size, draw } = designs[type];
  return `<svg class="printer-map-object-symbol printer-map-furniture" viewBox="0 0 ${size.join(' ')}"
    aria-hidden="true" fill="none" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round">
    <g>${draw(`pfc-art-${++nextArtworkId}`)}</g>
  </svg>`;
}

export function orientPrinterMapFurniture(svg, type, rotation) {
  const [width, height] = designs[type].size;
  const sideways = rotation % 180 !== 0;
  const offsets = [[0, 0], [height, 0], [width, height], [0, width]];
  svg.setAttribute('viewBox', `0 0 ${sideways ? height : width} ${sideways ? width : height}`);
  svg.firstElementChild.setAttribute('transform', `translate(${offsets[rotation / 90].join(' ')}) rotate(${rotation})`);
}
