// Little worked examples, drawn the same way up as the board itself.
//
// These hang off the tooltips in the How to Play sheet: reading "score each
// straight line of elk" is one thing, seeing four elk in a row with a tick
// beside them is another. Everything here shares the board's orientation, so a
// shape learned in the diagram is the shape you go looking for in the meadow.

import { createCanvas, drawAnimal } from './tileart.js';
import { HABITAT_INFO, ANIMAL_INFO } from '../game/tiles.js';

// The board is seen with world +x up the screen and +z across it, so a hex at
// axial (q, r) lands here. Same maths as hexToWorld, in canvas axes.
function centreOf(q, r, size) {
  return {
    x: size * Math.sqrt(3) * (r + q / 2),
    y: -size * 1.5 * q,
  };
}

// A world angle drawn in these canvas axes: world +x is up, world +z is right.
const at = (cx, cy, size, worldDeg) => [
  cx + Math.sin((worldDeg * Math.PI) / 180) * size,
  cy - Math.cos((worldDeg * Math.PI) / 180) * size,
];

function hexPath(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const [x, y] = at(cx, cy, size, i * 60);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// Half 0 carries edges 0-2, half 1 edges 3-5 -- the same split the real tiles
// use, so a diagram of a split tile is a picture of an actual tile.
const HALVES = [[60, 0, -60, -120], [-120, 180, 120, 60]];
function halfPath(ctx, cx, cy, size, which) {
  ctx.beginPath();
  HALVES[which].forEach((deg, i) => {
    const [x, y] = at(cx, cy, size, deg);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
}

/**
 * @param cells  [{ q, r, habitat, animal, dim, mark }]
 * @param opts   { size, caption }
 */
export function makeDiagram(cells, opts = {}) {
  const size = opts.size || 26;
  const pad = size * 0.7;

  const pts = cells.map((c) => ({ c, p: centreOf(c.q, c.r, size) }));
  const xs = pts.map((o) => o.p.x);
  const ys = pts.map((o) => o.p.y);
  const minX = Math.min(...xs) - size;
  const maxX = Math.max(...xs) + size;
  const minY = Math.min(...ys) - size;
  const maxY = Math.max(...ys) + size;

  const CAPTION_FONT = '600 13px Inter, system-ui, sans-serif';
  let w = Math.ceil(maxX - minX + pad * 2);
  if (opts.caption) {
    // The caption is often wider than the hexes it explains, and a clipped
    // sentence is worse than no sentence.
    const m = createCanvas(8, 8).getContext('2d');
    m.font = CAPTION_FONT;
    w = Math.max(w, Math.ceil(m.measureText(opts.caption).width) + 18);
  }
  const h = Math.ceil(maxY - minY + pad * 2) + (opts.caption ? 22 : 0);
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const ox = (w - (maxX - minX)) / 2 - minX;
  const oy = pad - minY;

  ctx.lineJoin = 'round';
  for (const { c: cell, p } of pts) {
    const cx = p.x + ox;
    const cy = p.y + oy;

    ctx.save();
    ctx.globalAlpha = cell.dim ? 0.34 : 1;
    const paint = (which, habitat) => {
      const hi = HABITAT_INFO[habitat];
      const g = ctx.createLinearGradient(0, cy - size, 0, cy + size);
      g.addColorStop(0, hi.colour);
      g.addColorStop(1, hi.deep);
      ctx.save();
      if (which === null) hexPath(ctx, cx, cy, size);
      else halfPath(ctx, cx, cy, size, which);
      ctx.clip();
      ctx.fillStyle = g;
      ctx.fillRect(cx - size * 1.2, cy - size * 1.2, size * 2.4, size * 2.4);
      ctx.restore();
    };

    if (cell.edges) {
      paint(0, cell.edges[0]);
      paint(1, cell.edges[3]);
      // The seam, so the two halves read as one tile rather than two.
      const [ax, ay] = at(cx, cy, size, 60);
      const [bx, by] = at(cx, cy, size, -120);
      ctx.strokeStyle = 'rgba(28,38,30,0.4)';
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    } else {
      paint(null, cell.habitat);
    }

    hexPath(ctx, cx, cy, size);
    ctx.strokeStyle = 'rgba(24,34,28,0.75)';
    ctx.lineWidth = Math.max(1.5, size * 0.07);
    ctx.stroke();

    // A bright bar laid across every edge where two tiles actually join. It
    // is the join, not the tile, that makes a corridor.
    for (const dir of cell.joins || []) {
      const mid = 30 - dir * 60;
      const [ax, ay] = at(cx, cy, size * 0.97, mid + 30);
      const [bx, by] = at(cx, cy, size * 0.97, mid - 30);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(12,20,16,0.55)';
      ctx.lineWidth = size * 0.28;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.strokeStyle = '#f7e6ae';
      ctx.lineWidth = size * 0.17;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    if (cell.animal) {
      const a = ANIMAL_INFO[cell.animal];
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.52, 0, Math.PI * 2);
      ctx.fillStyle = '#f6efdd';
      ctx.fill();
      ctx.strokeStyle = a.deep;
      ctx.lineWidth = size * 0.1;
      ctx.stroke();
      drawAnimal(ctx, cell.animal, cx, cy, size * 0.33);
    }
    ctx.restore();

    if (cell.mark) {
      ctx.save();
      ctx.font = '700 ' + Math.round(size * 0.66) + 'px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const good = cell.mark === '✓';
      ctx.strokeStyle = 'rgba(12,20,16,0.85)';
      ctx.lineWidth = size * 0.16;
      ctx.strokeText(cell.mark, cx + size * 0.62, cy - size * 0.62);
      ctx.fillStyle = good ? '#8ce08a' : '#ff9a86';
      ctx.fillText(cell.mark, cx + size * 0.62, cy - size * 0.62);
      ctx.restore();
    }
  }

  if (opts.caption) {
    ctx.font = CAPTION_FONT;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8c65a';
    ctx.fillText(opts.caption, w / 2, h - 7);
  }
  return c;
}

const line = (n, q0, r0, dq, dr, cell) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ q: q0 + dq * i, r: r0 + dr * i, ...cell(i) });
  return out;
};

const HABS = ['peak', 'aspen', 'prairie', 'marsh', 'river'];
const filler = (i) => HABS[(i * 2 + 1) % HABS.length];

/** Worked example for one animal's scoring rule. */
export function animalExample(animal) {
  switch (animal) {
    case 'bighorn':
      return makeDiagram([
        { q: 0, r: 0, habitat: 'peak', animal: 'bighorn', mark: '✓' },
        { q: 0, r: 1, habitat: 'peak', animal: 'bighorn' },
        { q: 1, r: 0, habitat: 'prairie' },
        { q: 1, r: 1, habitat: 'aspen', animal: 'bighorn', mark: '✗' },
        { q: 2, r: 1, habitat: 'marsh', animal: 'bighorn' },
        { q: 2, r: 2, habitat: 'river', animal: 'bighorn' },
      ], { caption: 'A pair scores. Three in a clump score nothing.' });

    case 'elk':
      return makeDiagram(
        line(4, 0, 0, 0, 1, (i) => ({ habitat: filler(i), animal: 'elk', mark: i === 0 ? '✓' : null }))
          .concat([{ q: 1, r: 1, habitat: 'prairie' }, { q: -1, r: 2, habitat: 'aspen' }]),
        { caption: 'A straight line of four — the best an elk line pays.' },
      );

    case 'trout':
      return makeDiagram([
        { q: 0, r: 0, habitat: 'river', animal: 'trout', mark: '✓' },
        { q: 0, r: 1, habitat: 'river', animal: 'trout' },
        { q: 1, r: 1, habitat: 'river', animal: 'trout' },
        { q: 1, r: 2, habitat: 'marsh', animal: 'trout' },
        { q: 2, r: 1, habitat: 'river', animal: 'trout', mark: '✗' },
        { q: -1, r: 1, habitat: 'peak' },
      ], { caption: 'A run of five — but a trout touching three others kills it.' });

    case 'eagle':
      return makeDiagram([
        { q: 0, r: 0, habitat: 'marsh', animal: 'eagle', mark: '✓' },
        { q: 0, r: 2, habitat: 'peak', animal: 'eagle', mark: '✓' },
        { q: 1, r: 0, habitat: 'prairie' },
        { q: 1, r: 1, habitat: 'river' },
        { q: 2, r: 0, habitat: 'aspen', animal: 'eagle', mark: '✗' },
        { q: 2, r: 1, habitat: 'marsh', animal: 'eagle' },
      ], { caption: 'Two eagles alone score. The pair beside each other does not.' });

    case 'coyote':
      return makeDiagram([
        { q: 0, r: 0, habitat: 'prairie', animal: 'coyote', mark: '✓' },
        { q: -1, r: 0, habitat: 'peak', animal: 'bighorn' },
        { q: -1, r: 1, habitat: 'aspen', animal: 'elk' },
        { q: 0, r: 1, habitat: 'river', animal: 'trout' },
        { q: 1, r: 0, habitat: 'marsh', animal: 'eagle' },
        { q: 1, r: -1, habitat: 'prairie' },
        { q: 0, r: -1, habitat: 'aspen' },
      ], { caption: 'Four different neighbours: four points for this coyote.' });

    default:
      return makeDiagram([{ q: 0, r: 0, habitat: 'prairie' }]);
  }
}

/**
 * Split tiles are where corridors are actually won and lost, so the example
 * is built out of them: a run of four that has to bend to keep the habitat on
 * both sides of every join, and a fifth tile that shows the habitat but is
 * met by the wrong half of its neighbour.
 *
 * A half covers three consecutive edges, so a corridor can never run straight
 * through a split tile along one axis -- it must turn. That is the whole
 * lesson, and it is far easier to see than to read.
 */
export function habitatExample(habitat) {
  const name = (HABITAT_INFO[habitat] || {}).short || 'Habitat';
  // Pair each habitat with one that does not look like it, or the split is
  // invisible and the diagram teaches nothing.
  const other = { peak: 'aspen', aspen: 'river', prairie: 'peak', marsh: 'prairie', river: 'aspen' }[habitat];
  // rot places the habitat on edges rot, rot+1, rot+2.
  const split = (rot) => {
    const edges = new Array(6);
    for (let i = 0; i < 6; i++) {
      const base = (i - rot + 6) % 6;
      edges[i] = base < 3 ? habitat : other;
    }
    return edges;
  };

  const low = name.toLowerCase();
  return makeDiagram([
    { q: 0, r: 0, edges: split(5), joins: [5] },
    { q: 0, r: 1, edges: split(1), joins: [2, 1] },
    { q: 1, r: 0, edges: split(3), joins: [4, 5] },
    { q: 1, r: 1, edges: split(2), joins: [2], mark: '✓' },
    { q: 1, r: 2, edges: split(2), mark: '✗' },
  ], { caption: 'A run of 4. The last tile shows ' + low + ' too, but the halves that meet do not.' });
}
