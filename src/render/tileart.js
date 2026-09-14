// Every pixel in the game is drawn here at runtime: habitat hexes, animal
// silhouettes, wildlife tokens and the nature token. Nothing is loaded.

import { HABITAT_INFO, ANIMAL_INFO } from '../game/tiles.js';
import { ANIMAL_PAINTERS } from './animals.js';

export function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// A tile's six edges face these world angles; corners sit between them.
export const EDGE_ANGLES = [30, -30, -90, -150, 150, 90];
const RAD = (deg) => (deg * Math.PI) / 180;

/**
 * World angle to canvas point.
 *
 * three.js maps a cylinder's cap UVs with u taken from the vertex's world z
 * and v from its world x, so the canvas's own axes are not world x/z: canvas
 * +x runs along world +z, and canvas up runs along world +x. Getting this
 * wrong rotates the painted hexagon thirty degrees off the prism beneath it.
 */
function pt(S, angleDeg, radius) {
  return [
    S / 2 + Math.sin(RAD(angleDeg)) * radius,
    S / 2 - Math.cos(RAD(angleDeg)) * radius,
  ];
}

export function hexCorners(S, radius) {
  return [0, 60, 120, 180, 240, 300].map((a) => pt(S, a, radius));
}

function hexPath(ctx, S, radius) {
  const corners = hexCorners(S, radius);
  ctx.beginPath();
  corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function halfPath(ctx, S, radius, which) {
  // Edges 0,1,2 sit on the -120..60 side; edges 3,4,5 on the other.
  const angles = which === 0 ? [60, 0, -60, -120] : [-120, 180, 120, 60];
  ctx.beginPath();
  angles.forEach((a, i) => {
    const [x, y] = pt(S, a, radius);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
}

function grain(ctx, w, h, amount) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Habitat fills. Each is drawn clipped to its half (or the whole hex).
// ---------------------------------------------------------------------------
function fillBase(ctx, S, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
}

const HABITAT_PAINTERS = {
  peak(ctx, S) {
    fillBase(ctx, S, '#cdd7e3', '#8e9cae');
    // Ridgelines marching across, snow on the tops.
    for (let row = 0; row < 3; row++) {
      const baseY = S * (0.44 + row * 0.19);
      const h = S * (0.26 - row * 0.05);
      const w = S * (0.3 - row * 0.04);
      ctx.fillStyle = ['#6d7d92', '#8492a5', '#9aa7b8'][row];
      for (let i = -2; i <= 3; i++) {
        const x = S * 0.08 + i * w * 0.92 + (row % 2) * w * 0.4;
        ctx.beginPath();
        ctx.moveTo(x - w * 0.5, baseY);
        ctx.lineTo(x, baseY - h);
        ctx.lineTo(x + w * 0.5, baseY);
        ctx.closePath();
        ctx.fill();
        if (row === 0) {
          ctx.fillStyle = '#f4f8fc';
          ctx.beginPath();
          ctx.moveTo(x - w * 0.17, baseY - h * 0.62);
          ctx.lineTo(x, baseY - h);
          ctx.lineTo(x + w * 0.17, baseY - h * 0.62);
          ctx.lineTo(x + w * 0.05, baseY - h * 0.72);
          ctx.lineTo(x - w * 0.04, baseY - h * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#6d7d92';
        }
      }
    }
  },

  aspen(ctx, S) {
    fillBase(ctx, S, '#f0d688', '#c9a43f');
    // Slim white trunks with dark eyes, gold canopy above.
    for (let i = 0; i < 11; i++) {
      const x = S * (0.08 + (i * 0.085) % 0.86) + (i % 2) * S * 0.02;
      const top = S * (0.16 + (i % 3) * 0.07);
      const w = S * 0.035;
      ctx.fillStyle = '#f6f1e4';
      ctx.fillRect(x, top, w, S * 0.78 - top);
      ctx.fillStyle = 'rgba(90,76,52,0.55)';
      ctx.fillRect(x + w * 0.72, top, w * 0.28, S * 0.78 - top);
      ctx.fillStyle = '#5c4b32';
      for (let e = 0; e < 3; e++) {
        ctx.fillRect(x + w * 0.1, top + S * (0.12 + e * 0.17) + (i % 4) * S * 0.02, w * 0.5, S * 0.018);
      }
    }
    ctx.save();
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * S;
      const y = Math.random() * S * 0.5;
      ctx.fillStyle = ['#ffe27a', '#f3c74d', '#e0aa34'][i % 3];
      ctx.beginPath();
      ctx.ellipse(x, y, S * 0.045, S * 0.032, Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  prairie(ctx, S) {
    fillBase(ctx, S, '#e6d29a', '#bb9c58');
    ctx.strokeStyle = 'rgba(130,104,52,0.55)';
    ctx.lineWidth = S * 0.012;
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * S;
      const y = S * (0.25 + Math.random() * 0.72);
      const h = S * (0.04 + Math.random() * 0.07);
      const lean = (Math.random() - 0.5) * S * 0.045;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + lean * 0.5, y - h * 0.6, x + lean, y - h);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(238,222,176,0.5)';
    for (let i = 0; i < 8; i++) {
      const x = Math.random() * S;
      const y = S * (0.3 + Math.random() * 0.6);
      ctx.beginPath();
      ctx.ellipse(x, y, S * 0.1, S * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  marsh(ctx, S) {
    fillBase(ctx, S, '#9cc180', '#4f7345');
    // Standing water between the sedge.
    ctx.fillStyle = 'rgba(96,144,150,0.55)';
    for (let i = 0; i < 6; i++) {
      const x = Math.random() * S;
      const y = S * (0.35 + Math.random() * 0.55);
      ctx.beginPath();
      ctx.ellipse(x, y, S * (0.08 + Math.random() * 0.09), S * 0.04, Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(48,72,42,0.75)';
    ctx.lineWidth = S * 0.016;
    ctx.lineCap = 'round';
    for (let i = 0; i < 34; i++) {
      const x = Math.random() * S;
      const y = S * (0.3 + Math.random() * 0.68);
      const h = S * (0.1 + Math.random() * 0.12);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + S * 0.02, y - h * 0.6, x + S * 0.01, y - h);
      ctx.stroke();
      ctx.fillStyle = '#6b4f2c';
      ctx.beginPath();
      ctx.ellipse(x + S * 0.01, y - h, S * 0.013, S * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  river(ctx, S) {
    fillBase(ctx, S, '#8ecbe2', '#3f7e9f');
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = S * 0.02;
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const y = S * (0.16 + i * 0.085);
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= S; x += S * 0.1) {
        ctx.lineTo(x, y + Math.sin((x / S) * Math.PI * 3 + i) * S * 0.025);
      }
      ctx.stroke();
    }
    // A few river stones breaking the surface.
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * S;
      const y = S * (0.2 + Math.random() * 0.7);
      const r = S * (0.025 + Math.random() * 0.03);
      ctx.fillStyle = '#8b9099';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.72, Math.random(), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.2, y - r * 0.22, r * 0.4, r * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

// ---------------------------------------------------------------------------
// Animal silhouettes live in animals.js -- bold filled shapes, because that is
// all that survives being shrunk to a badge on a hex. Re-exported here so the
// rest of the render layer has one place to ask for artwork.
// ---------------------------------------------------------------------------
export { ANIMAL_PAINTERS };

export function drawAnimal(ctx, animal, cx, cy, R, opts = {}) {
  const info = ANIMAL_INFO[animal];
  ctx.save();
  ctx.translate(cx, cy);
  ANIMAL_PAINTERS[animal](ctx, R, opts.fill || info.colour, opts.line || info.deep);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The hex tile itself.
// ---------------------------------------------------------------------------
export function makeTileTexture(tile, S = 384) {
  const c = createCanvas(S, S);
  const ctx = c.getContext('2d');
  const R = S * 0.5;

  ctx.save();
  hexPath(ctx, S, R);
  ctx.clip();

  if (tile.habitats.length === 1) {
    HABITAT_PAINTERS[tile.habitats[0]](ctx, S);
  } else {
    tile.habitats.forEach((h, i) => {
      ctx.save();
      halfPath(ctx, S, R, i);
      ctx.clip();
      HABITAT_PAINTERS[h](ctx, S);
      ctx.restore();
    });
    // Soften the seam between the two halves.
    ctx.save();
    const [ax, ay] = pt(S, 60, R);
    const [bx, by] = pt(S, -120, R);
    ctx.strokeStyle = 'rgba(60,48,34,0.22)';
    ctx.lineWidth = S * 0.02;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.restore();
  }

  // Vignette so the middle reads and the rim settles down.
  const vg = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.55);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(38,28,16,0.3)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();

  drawWildlifeSlots(ctx, S, tile);

  // Rim.
  ctx.save();
  hexPath(ctx, S, R * 0.985);
  ctx.strokeStyle = 'rgba(54,40,24,0.55)';
  ctx.lineWidth = S * 0.022;
  ctx.stroke();
  hexPath(ctx, S, R * 0.94);
  ctx.strokeStyle = 'rgba(255,247,228,0.22)';
  ctx.lineWidth = S * 0.012;
  ctx.stroke();
  ctx.restore();

  grain(ctx, S, S, 12);
  return c;
}

/**
 * The animals a tile is offering, as small enamel badges in the middle. They
 * are kept deliberately small so the habitat art either side still reads.
 */
function drawWildlifeSlots(ctx, S, tile) {
  const n = tile.wildlife.length;
  const cx = S / 2;
  const cy = S / 2;
  const rB = n === 1 ? S * 0.148 : n === 2 ? S * 0.118 : S * 0.108;
  const spots = n === 1
    ? [[0, 0]]
    : n === 2
      ? [[-1.12, 0], [1.12, 0]]
      : [[0, -1.24], [-1.12, 0.68], [1.12, 0.68]];

  // One soft shadow beneath the whole cluster keeps the badges sitting on the
  // land rather than floating above it.
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#241a0e';
  ctx.filter = 'blur(' + (S * 0.02).toFixed(1) + 'px)';
  for (const [dx, dy] of spots) {
    ctx.beginPath();
    ctx.arc(cx + dx * rB + S * 0.008, cy + dy * rB + S * 0.014, rB * 1.02, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  tile.wildlife.forEach((a, i) => {
    const info = ANIMAL_INFO[a];
    const x = cx + spots[i][0] * rB;
    const y = cy + spots[i][1] * rB;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, rB, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x, y - rB * 0.42, 0, x, y, rB);
    g.addColorStop(0, '#fdf8ec');
    g.addColorStop(0.74, '#f0e6d0');
    g.addColorStop(1, '#d8caac');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = info.deep;
    ctx.lineWidth = rB * 0.19;
    ctx.stroke();
    ctx.restore();

    drawAnimal(ctx, a, x, y, rB * 0.64);
  });

  if (tile.keystone) {
    // A keystone is a promise of a nature token; ring it in gold.
    const x = cx + spots[0][0] * rB;
    const y = cy + spots[0][1] * rB;
    ctx.save();
    ctx.strokeStyle = '#e0aa3c';
    ctx.lineWidth = S * 0.017;
    ctx.beginPath();
    ctx.arc(x, y, rB * 1.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,240,198,0.62)';
    ctx.lineWidth = S * 0.007;
    ctx.beginPath();
    ctx.arc(x, y, rB * 1.44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Tokens.
// ---------------------------------------------------------------------------
export function makeTokenTexture(animal, S = 192) {
  const c = createCanvas(S, S);
  const ctx = c.getContext('2d');
  const info = ANIMAL_INFO[animal];
  const R = S * 0.425;

  ctx.beginPath();
  ctx.arc(S / 2, S / 2, R, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(S / 2, S * 0.34, 0, S / 2, S / 2, R);
  g.addColorStop(0, '#fbf5e7');
  g.addColorStop(0.72, '#ecdfc6');
  g.addColorStop(1, '#cbb894');
  ctx.fillStyle = g;
  ctx.fill();
  // A broad rim in the animal's own colour: on a busy tile the ring is what
  // you read first, from any distance.
  ctx.strokeStyle = info.colour;
  ctx.lineWidth = S * 0.11;
  ctx.stroke();
  ctx.strokeStyle = info.deep;
  ctx.lineWidth = S * 0.035;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, R * 1.045, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, R * 0.9, 0, Math.PI * 2);
  ctx.stroke();

  drawAnimal(ctx, animal, S / 2, S / 2, S * 0.3);
  grain(ctx, S, S, 8);
  return c;
}

export function makeNatureTokenTexture(S = 192) {
  const c = createCanvas(S, S);
  const ctx = c.getContext('2d');
  const R = S * 0.46;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, R, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(S / 2, S * 0.32, 0, S / 2, S / 2, R);
  g.addColorStop(0, '#8fd08a');
  g.addColorStop(0.7, '#4f9a55');
  g.addColorStop(1, '#2f6b3c');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#24512d';
  ctx.lineWidth = S * 0.05;
  ctx.stroke();

  // A pine, because every nature token in Colorado is a tree.
  ctx.save();
  ctx.translate(S / 2, S * 0.56);
  ctx.fillStyle = '#25532f';
  ctx.strokeStyle = '#173a20';
  ctx.lineWidth = S * 0.022;
  ctx.fillRect(-S * 0.028, S * 0.02, S * 0.056, S * 0.14);
  ctx.strokeRect(-S * 0.028, S * 0.02, S * 0.056, S * 0.14);
  ctx.fillStyle = '#e9f5e4';
  ctx.strokeStyle = '#1d472a';
  for (let i = 0; i < 3; i++) {
    const w = S * (0.2 - i * 0.045);
    const y = S * (0.04 - i * 0.11);
    ctx.beginPath();
    ctx.moveTo(-w, y);
    ctx.lineTo(0, y - S * 0.16);
    ctx.lineTo(w, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  grain(ctx, S, S, 8);
  return c;
}

// ---------------------------------------------------------------------------
// Small images for the HUD.
// ---------------------------------------------------------------------------
const glyphCache = {};
export function animalGlyph(animal, size = 72) {
  const k = animal + ':' + size;
  if (glyphCache[k]) return glyphCache[k];
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  drawAnimal(ctx, animal, size / 2, size / 2, size * 0.32);
  glyphCache[k] = c.toDataURL();
  return glyphCache[k];
}

const swatchCache = {};
export function habitatSwatch(habitat, size = 48) {
  const k = habitat + ':' + size;
  if (swatchCache[k]) return swatchCache[k];
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2);
  ctx.clip();
  HABITAT_PAINTERS[habitat](ctx, size);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(40,30,18,0.6)';
  ctx.lineWidth = size * 0.06;
  ctx.stroke();
  swatchCache[k] = c.toDataURL();
  return swatchCache[k];
}

export { HABITAT_INFO, ANIMAL_INFO };
