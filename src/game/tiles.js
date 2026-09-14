// The contents of the box: Colorado's five habitats, its five animals, the 85
// habitat tiles, the starter groups and the wildlife token supply.
//
// Structurally this is Cascadia — same tile count, same 1-or-2 habitats per
// tile, same 1-to-3 wildlife slots, same 20-per-animal token bag. Only the
// landscape and the animals living in it have moved to the Rockies.

import { shuffle } from '../util/rng.js';
import { rotateEdges } from './hex.js';

export const HABITATS = ['peak', 'aspen', 'prairie', 'marsh', 'river'];

export const HABITAT_INFO = {
  peak:    { name: 'Alpine Peak',   short: 'Peaks',   colour: '#b9c4d2', deep: '#7b8798' },
  aspen:   { name: 'Aspen Grove',   short: 'Aspen',   colour: '#f2a83c', deep: '#b06420' },
  prairie: { name: 'Shortgrass Prairie', short: 'Prairie', colour: '#d9c184', deep: '#a8894a' },
  marsh:   { name: 'Beaver Marsh',  short: 'Marsh',   colour: '#7fa86a', deep: '#4d7042' },
  river:   { name: 'Canyon River',  short: 'River',   colour: '#6fb0cc', deep: '#3d7a99' },
};

export const ANIMALS = ['bighorn', 'elk', 'trout', 'eagle', 'coyote'];

export const ANIMAL_INFO = {
  bighorn: { name: 'Bighorn Sheep', short: 'Bighorn', colour: '#c8a678', deep: '#7d6340' },
  elk:     { name: 'Elk',           short: 'Elk',     colour: '#b3763f', deep: '#6d4321' },
  trout:   { name: 'Rainbow Trout', short: 'Trout', colour: '#d4635c', deep: '#8a3630' },
  eagle:   { name: 'Golden Eagle',  short: 'Eagle',   colour: '#8d8f9c', deep: '#4a4c58' },
  coyote:  { name: 'Coyote',        short: 'Coyote',  colour: '#b9a893', deep: '#6e6153' },
};

export const TOKENS_PER_ANIMAL = 20;   // 100 wildlife tokens in the bag
export const DISPLAY_SIZE = 4;         // four tile-and-token pairs on offer
export const NATURE_SUPPLY = 20;

let counter = 0;
const nextId = (p) => p + (++counter);

/** Every unordered pair of the five habitats, in a stable order. */
function habitatPairs() {
  const out = [];
  for (let i = 0; i < HABITATS.length; i++) {
    for (let j = i + 1; j < HABITATS.length; j++) out.push([HABITATS[i], HABITATS[j]]);
  }
  return out;   // 10 pairs
}

function combinations(list, k) {
  if (k === 0) return [[]];
  const out = [];
  list.forEach((item, i) => {
    for (const rest of combinations(list.slice(i + 1), k - 1)) out.push([item, ...rest]);
  });
  return out;
}

export function makeTile(habitats, wildlife) {
  // A single-habitat tile shows that habitat on all six edges; a split tile is
  // halved down the middle, three edges each.
  const edges = habitats.length === 1
    ? new Array(6).fill(habitats[0])
    : [habitats[0], habitats[0], habitats[0], habitats[1], habitats[1], habitats[1]];
  return {
    id: nextId('t'),
    habitats: habitats.slice(),
    edges,
    wildlife: wildlife.slice(),
    keystone: wildlife.length === 1,
  };
}

/**
 * The 85-tile stack: 25 keystones (one per habitat-and-animal pairing) and 60
 * split tiles spread evenly over the ten habitat pairings. Each animal ends up
 * on 35 tiles, so no animal is easier to house than another.
 */
export function buildTileDeck(rng) {
  const tiles = [];

  for (const h of HABITATS) {
    for (const a of ANIMALS) tiles.push(makeTile([h], [a]));
  }

  const pairs = habitatPairs();
  const animalPairs = combinations(ANIMALS, 2);    // 10
  const animalTriples = combinations(ANIMALS, 3);  // 10
  pairs.forEach((hp, p) => {
    for (let k = 0; k < 3; k++) {
      tiles.push(makeTile(hp, animalPairs[(p + k * 3) % 10]));
      tiles.push(makeTile(hp, animalTriples[(p + k * 4) % 10]));
    }
  });

  return shuffle(tiles, rng);
}

/**
 * Starter groups: three tiles apiece, a three-animal single-habitat tile in
 * the middle with a two-animal split tile either side.
 */
export function buildStarters(rng) {
  const triples = combinations(ANIMALS, 3);
  const pairs = combinations(ANIMALS, 2);
  const hPairs = habitatPairs();
  const sets = HABITATS.map((h, i) => ({
    id: 'starter' + i,
    tiles: [
      { tile: makeTile([h], triples[(i * 2) % 10]), q: 0, r: 0, rot: 0 },
      { tile: makeTile(hPairs[(i * 3) % 10], pairs[(i * 2 + 1) % 10]), q: 1, r: 0, rot: i % 6 },
      { tile: makeTile(hPairs[(i * 3 + 5) % 10], pairs[(i * 2 + 4) % 10]), q: 0, r: 1, rot: (i + 2) % 6 },
    ],
  }));
  return shuffle(sets, rng);
}

export function buildTokenBag(rng) {
  const bag = [];
  for (const a of ANIMALS) {
    for (let i = 0; i < TOKENS_PER_ANIMAL; i++) bag.push(a);
  }
  return shuffle(bag, rng);
}

/** A placed tile's habitat on each of its six edges, after rotation. */
export function placedEdges(tile, rot) {
  return rotateEdges(tile.edges, rot);
}

export function tileHabitats(tile) {
  return tile.habitats;
}

/** How many turns each player gets, given the stack has to last. */
export function turnsForPlayers(playerCount, deckSize = 85) {
  return Math.max(8, Math.min(20, Math.floor((deckSize - DISPLAY_SIZE) / playerCount)));
}
