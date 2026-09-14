// Little worked examples, drawn the same way up as the board itself.
//
// These hang off the tooltips in the How to Play sheet: reading "score each
// straight line of elk" is one thing, seeing four elk in a row with a tick
// beside them is another. Everything here shares the board's orientation, so a
// shape learned in the diagram is the shape you go looking for in the meadow.

import { createCanvas, drawAnimal } from './tileart.js';
import { HABITAT_INFO, ANIMAL_INFO } from '../game/tiles.js';
import { ANIMAL_EXAMPLES, habitatExampleData } from '../game/examples.js';

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
function halfPath(ctx, cx, cy, size, which, rot) {
  ctx.beginPath();
  HALVES[which].forEach((deg, i) => {
    const [x, y] = at(cx, cy, size, deg - rot * 60);
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
  const LINE_H = 17;
  let w = Math.ceil(maxX - minX + pad * 2);
  let caption = [];
  if (opts.caption) {
    // The caption wraps rather than stretching the canvas: a diagram wide
    // enough to hold one long sentence gets scaled down in the tooltip until
    // the sentence is unreadable anyway.
    const m = createCanvas(8, 8).getContext('2d');
    m.font = CAPTION_FONT;
    const limit = Math.max(w, 300);
    let cur = '';
    for (const word of opts.caption.split(' ')) {
      const next = cur ? cur + ' ' + word : word;
      if (cur && m.measureText(next).width > limit) {
        caption.push(cur);
        cur = word;
      } else {
        cur = next;
      }
    }
    if (cur) caption.push(cur);
    w = Math.max(w, ...caption.map((l) => Math.ceil(m.measureText(l).width) + 18));
  }
  const h = Math.ceil(maxY - minY + pad * 2) + caption.length * LINE_H + (caption.length ? 8 : 0);
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const ox = (w - (maxX - minX)) / 2 - minX;
  const oy = pad - minY;

  ctx.lineJoin = 'round';
  for (const { c: cell, p } of pts) {
    const cx = p.x + ox;
    const cy = p.y + oy;

    ctx.save();
    ctx.globalAlpha = cell.dim ? 0.34 : (cell.dimTile ? 0.5 : 1);
    const rot = cell.rot || 0;
    const paint = (which, habitat) => {
      const hi = HABITAT_INFO[habitat];
      const g = ctx.createLinearGradient(0, cy - size, 0, cy + size);
      g.addColorStop(0, hi.colour);
      g.addColorStop(1, hi.deep);
      ctx.save();
      if (which === null) hexPath(ctx, cx, cy, size);
      else halfPath(ctx, cx, cy, size, which, rot);
      ctx.clip();
      ctx.fillStyle = g;
      ctx.fillRect(cx - size * 1.2, cy - size * 1.2, size * 2.4, size * 2.4);
      ctx.restore();
    };

    if (cell.habitats) {
      // The halves are turned with the tile, exactly as the real art is, so
      // the colour on an edge is the habitat that edge actually offers.
      paint(0, cell.habitats[0]);
      paint(1, cell.habitats[1]);
      // The seam, so the two halves read as one tile rather than two.
      const [ax, ay] = at(cx, cy, size, 60 - rot * 60);
      const [bx, by] = at(cx, cy, size, -120 - rot * 60);
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
    // is the join, not the tile, that makes a corridor. joinsB is a second
    // corridor in another habitat running through the same tile.
    const bar = (dir, colour) => {
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
      ctx.strokeStyle = colour;
      ctx.lineWidth = size * 0.17;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };
    for (const dir of cell.joins || []) bar(dir, '#f7e6ae');
    for (const dir of cell.joinsB || []) bar(dir, '#caa6ff');

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

    // Marks go on a chip inside the tile they belong to. Hung off the corner
    // they used to be ambiguous between neighbours, and the outermost ones ran
    // off the edge of the canvas.
    if (cell.mark) {
      const mx = cx + size * 0.3;
      const my = cy - size * 0.46;
      const rad = size * 0.27;
      const bad = cell.mark === '✗';
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,17,13,0.88)';
      ctx.fill();
      ctx.strokeStyle = bad ? '#ff9a86' : '#8ce08a';
      ctx.lineWidth = Math.max(1.4, size * 0.07);
      ctx.stroke();
      ctx.font = '700 ' + Math.round(size * (cell.mark.length > 1 ? 0.3 : 0.38)) + 'px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = bad ? '#ff9a86' : '#8ce08a';
      ctx.fillText(cell.mark, mx, my + size * 0.015);
      ctx.restore();
    }
  }

  if (caption.length) {
    ctx.font = CAPTION_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e8c65a';
    caption.forEach((lineText, i) => {
      ctx.fillText(lineText, w / 2, h - 7 - (caption.length - 1 - i) * LINE_H);
    });
  }
  return c;
}

/** Worked example for one animal's scoring rule. */
export function animalExample(animal) {
  const ex = ANIMAL_EXAMPLES[animal];
  if (!ex) return makeDiagram([{ q: 0, r: 0, habitat: 'prairie' }]);
  return makeDiagram(ex.cells, { caption: ex.caption });
}

/** Worked example of a corridor -- a different lesson for each habitat. */
export function habitatExample(habitat) {
  const data = habitatExampleData(habitat);
  return makeDiagram(data.cells, { caption: data.caption });
}
