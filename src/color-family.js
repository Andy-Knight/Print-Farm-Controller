const COLOR_FAMILY_DEFINITIONS = [
  ['black', 'Black', '#111111'],
  ['white', 'White', '#FFFFFF'],
  ['grey', 'Grey', '#808080'],
  ['red', 'Red', '#FF0000'],
  ['orange', 'Orange', '#FF6600'],
  ['yellow', 'Yellow', '#FFD400'],
  ['green', 'Green', '#00A651'],
  ['cyan', 'Cyan', '#00B7EB'],
  ['blue', 'Blue', '#0066FF'],
  ['purple', 'Purple', '#8000FF'],
  ['pink', 'Pink', '#FF69B4'],
  ['brown', 'Brown', '#8B4513']
];

export const COLOR_FAMILY_OPTIONS = Object.freeze(COLOR_FAMILY_DEFINITIONS.map(([value, label, representative]) => Object.freeze({
  value,
  label,
  representative
})));

const COLOR_FAMILY_VALUES = new Set(COLOR_FAMILY_OPTIONS.map((item) => item.value));

export function normalizeColor(value) {
  const text = String(value || '').trim().replace(/^0x/i, '').replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{8}$/.test(text)) return `#${text.slice(2)}`;
  if (/^[0-9A-F]{6}$/.test(text)) return `#${text}`;
  return null;
}

export function normalizeColorFamily(value) {
  const family = String(value || '').trim().toLowerCase();
  return COLOR_FAMILY_VALUES.has(family) ? family : null;
}

export function representativeColor(family) {
  const normalized = normalizeColorFamily(family);
  return COLOR_FAMILY_OPTIONS.find((item) => item.value === normalized)?.representative || null;
}

function rgbFromColor(value) {
  const color = normalizeColor(value);
  if (!color) return null;
  return {
    r:Number.parseInt(color.slice(1, 3), 16),
    g:Number.parseInt(color.slice(3, 5), 16),
    b:Number.parseInt(color.slice(5, 7), 16)
  };
}

export function colorFamily(value) {
  const rgb = rgbFromColor(value);
  if (!rgb) return null;
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => channel / 255);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  if (Math.max(rgb.r, rgb.g, rgb.b) < 32 && saturation < 0.5) return 'black';
  if (Math.min(rgb.r, rgb.g, rgb.b) > 235 && Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) < 18) return 'white';
  if (delta < (16 / 255) || saturation < 0.12) return lightness > 0.92 ? 'white' : 'grey';

  let hue;
  if (max === channels[0]) hue = 60 * (((channels[1] - channels[2]) / delta) % 6);
  else if (max === channels[1]) hue = 60 * (((channels[2] - channels[0]) / delta) + 2);
  else hue = 60 * (((channels[0] - channels[1]) / delta) + 4);
  if (hue < 0) hue += 360;

  if (hue >= 15 && hue < 50 && lightness < 0.45) return 'brown';
  if ((hue >= 330 || hue < 15) && lightness >= 0.75) return 'pink';
  if (hue >= 345 || hue < 15) return 'red';
  if (hue < 45) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 200) return 'cyan';
  if (hue < 260) return 'blue';
  if (hue < 315) return 'purple';
  if (hue < 345) return 'pink';
  return null;
}

export function resolveColorFamily({ color = null, family = null } = {}) {
  return normalizeColorFamily(family) || colorFamily(color);
}

function colorLab(value) {
  const rgb = rgbFromColor(value);
  if (!rgb) return null;
  const linear = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
  const y = (linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722);
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
  const f = (channel) => channel > 0.008856 ? Math.cbrt(channel) : (7.787 * channel) + (16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l:(116 * fy) - 16, a:500 * (fx - fy), b:200 * (fy - fz) };
}

export function colorDistance(left, right) {
  const a = colorLab(left);
  const b = colorLab(right);
  if (!a || !b) return null;
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

export function colorsCompatible(requiredColor, currentColor, { requiredFamily = null, currentFamily = null } = {}) {
  const required = resolveColorFamily({ color:requiredColor, family:requiredFamily });
  const current = resolveColorFamily({ color:currentColor, family:currentFamily });
  return Boolean(required && current && required === current);
}

export function colorMatchScore(requiredColor, currentColor, { requiredFamily = null, currentFamily = null } = {}) {
  const required = resolveColorFamily({ color:requiredColor, family:requiredFamily });
  const current = resolveColorFamily({ color:currentColor, family:currentFamily });
  if (!required) return 0;
  if (!current || required !== current) return Number.POSITIVE_INFINITY;
  const normalizedRequired = normalizeColor(requiredColor);
  const normalizedCurrent = normalizeColor(currentColor);
  if (!normalizedRequired || !normalizedCurrent) return 0;
  return colorDistance(normalizedRequired, normalizedCurrent) ?? 0;
}
