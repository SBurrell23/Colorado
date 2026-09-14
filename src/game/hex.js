// Axial hex coordinates. Pointy-top hexes, so neighbours sit at 30, 90, 150,
// 210, 270 and 330 degrees and a tile's six edges line up with those directions.

/** Neighbour offsets, indexed 0..5. Edge i of a hex faces neighbour i. */
export const HEX_DIRS = [
  [1, 0],   // 0  east-south-east
  [1, -1],  // 1  east-north-east
  [0, -1],  // 2  north
  [-1, 0],  // 3  west-north-west
  [-1, 1],  // 4  west-south-west
  [0, 1],   // 5  south
];

export const opposite = (dir) => (dir + 3) % 6;

export const hexKey = (q, r) => q + ',' + r;

export function parseHexKey(k) {
  const [q, r] = k.split(',').map(Number);
  return { q, r };
}

export function neighbour(q, r, dir) {
  const [dq, dr] = HEX_DIRS[dir];
  return { q: q + dq, r: r + dr };
}

export function neighbours(q, r) {
  return HEX_DIRS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

/** Axial to world, on the XZ plane. `size` is the hex's centre-to-corner. */
export function hexToWorld(q, r, size) {
  return {
    x: size * 1.5 * q,
    z: size * Math.sqrt(3) * (r + q / 2),
  };
}

/** World back to the nearest hex, via cube rounding. */
export function worldToHex(x, z, size) {
  const q = (x * 2) / 3 / size;
  const r = z / (size * Math.sqrt(3)) - q / 2;
  return roundHex(q, r);
}

export function roundHex(q, r) {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/**
 * The three axes a straight line of hexes can run along, as direction pairs.
 * Used for scoring elk, which want to stand in a row.
 */
export const HEX_AXES = [[0, 3], [1, 4], [2, 5]];

/** Rotating a tile k steps moves the habitat on edge i round to edge i + k. */
export function rotateEdges(edges, rot) {
  const out = new Array(6);
  for (let i = 0; i < 6; i++) out[i] = edges[(i - rot + 6) % 6];
  return out;
}
