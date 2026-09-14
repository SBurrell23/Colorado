// A player's environment: the growing patch of hexes in front of them, plus
// the queries the rules need to ask of it.

import { HEX_DIRS, hexKey, parseHexKey, neighbours, opposite } from './hex.js';
import { placedEdges } from './tiles.js';

/**
 * A placed tile:
 *   { tileId, habitats, wildlife, keystone, rot, edges, token }
 * `edges` is already rotated, so nothing downstream has to remember to.
 */
export function placeTile(env, q, r, tile, rot) {
  env[hexKey(q, r)] = {
    tileId: tile.id,
    habitats: tile.habitats.slice(),
    wildlife: tile.wildlife.slice(),
    keystone: tile.keystone,
    rot,
    edges: placedEdges(tile, rot),
    token: null,
  };
}

export function startingEnvironment(starter) {
  const env = {};
  for (const s of starter.tiles) placeTile(env, s.q, s.r, s.tile, s.rot);
  return env;
}

/** Every empty hex touching at least one placed tile. */
export function openHexes(env) {
  const seen = new Set();
  const out = [];
  for (const k of Object.keys(env)) {
    const { q, r } = parseHexKey(k);
    for (const n of neighbours(q, r)) {
      const nk = hexKey(n.q, n.r);
      if (env[nk] || seen.has(nk)) continue;
      seen.add(nk);
      out.push(n);
    }
  }
  return out;
}

export function canPlaceTile(env, q, r) {
  if (env[hexKey(q, r)]) return false;
  return neighbours(q, r).some((n) => env[hexKey(n.q, n.r)]);
}

/** Hexes that show this animal and have no token on them yet. */
export function openTokenHexes(env, animal) {
  const out = [];
  for (const [k, t] of Object.entries(env)) {
    if (t.token) continue;
    if (!t.wildlife.includes(animal)) continue;
    out.push({ ...parseHexKey(k), keystone: t.keystone });
  }
  return out;
}

export function canPlaceToken(env, q, r, animal) {
  const t = env[hexKey(q, r)];
  return !!t && !t.token && t.wildlife.includes(animal);
}

// ---------------------------------------------------------------------------
// Habitat corridors
// ---------------------------------------------------------------------------
/**
 * Two neighbouring tiles belong to the same corridor of a habitat when BOTH
 * of the edges they press together show that habitat. A split tile can sit in
 * two different corridors at once, one per half.
 */
export function corridorSizes(env, habitat) {
  const members = Object.keys(env).filter((k) => env[k].edges.includes(habitat));
  const seen = new Set();
  const sizes = [];

  for (const start of members) {
    if (seen.has(start)) continue;
    let size = 0;
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const k = queue.pop();
      size += 1;
      const { q, r } = parseHexKey(k);
      const tile = env[k];
      for (let dir = 0; dir < 6; dir++) {
        if (tile.edges[dir] !== habitat) continue;
        const [dq, dr] = HEX_DIRS[dir];
        const nk = hexKey(q + dq, r + dr);
        const nb = env[nk];
        if (!nb || seen.has(nk)) continue;
        if (nb.edges[opposite(dir)] !== habitat) continue;
        seen.add(nk);
        queue.push(nk);
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

export function largestCorridor(env, habitat) {
  const sizes = corridorSizes(env, habitat);
  return sizes.length ? sizes[0] : 0;
}

// ---------------------------------------------------------------------------
// Wildlife layout helpers, shared by the scoring rules
// ---------------------------------------------------------------------------
/** Every hex holding this animal's token. */
export function animalHexes(env, animal) {
  return Object.entries(env)
    .filter(([, t]) => t.token === animal)
    .map(([k]) => parseHexKey(k));
}

/** Connected groups of one animal's tokens. */
export function animalGroups(env, animal) {
  const set = new Set(Object.keys(env).filter((k) => env[k].token === animal));
  const seen = new Set();
  const groups = [];
  for (const start of set) {
    if (seen.has(start)) continue;
    const group = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const k = queue.pop();
      group.push(k);
      const { q, r } = parseHexKey(k);
      for (const n of neighbours(q, r)) {
        const nk = hexKey(n.q, n.r);
        if (set.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          queue.push(nk);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

/** How many of this animal sit next to the given hex. */
export function sameNeighbourCount(env, q, r, animal) {
  return neighbours(q, r).filter((n) => {
    const t = env[hexKey(n.q, n.r)];
    return t && t.token === animal;
  }).length;
}

/** The distinct animals living around a hex. */
export function neighbourAnimals(env, q, r) {
  const kinds = new Set();
  for (const n of neighbours(q, r)) {
    const t = env[hexKey(n.q, n.r)];
    if (t && t.token) kinds.add(t.token);
  }
  return kinds;
}

export function tileCount(env) {
  return Object.keys(env).length;
}

export function tokenCount(env) {
  return Object.values(env).filter((t) => t.token).length;
}

export { hexKey, parseHexKey };
