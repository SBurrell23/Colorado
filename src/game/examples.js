// The worked examples used by the How to Play tooltips, as plain data.
//
// They live here, next to the rules, rather than in the renderer, so that
// tests/sim.mjs can build a real environment out of each one and run the
// actual scorer over it. An example that quietly stops agreeing with the rule
// it illustrates is worse than no example, and this is the only way to know.

import { HABITATS } from './tiles.js';
import { rotateEdges } from './hex.js';

/** A cell is { q, r, habitat | edges, animal?, mark?, dim? }. */
const solid = (q, r, habitat, animal, mark) => ({ q, r, habitat, animal, mark });

const FILL = ['peak', 'aspen', 'prairie', 'marsh', 'river'];
const filler = (q, r, i) => ({ q, r, habitat: FILL[i % FILL.length] });

export const ANIMAL_EXAMPLES = {
  // A pair scores; the chain of three beside it does not. The two groups are
  // kept apart -- an earlier version had them touching, which quietly made
  // every sheep on the diagram one group of five.
  bighorn: {
    caption: 'A pair scores. The three in a chain beside it score nothing.',
    cells: [
      solid(0, 0, 'peak', 'bighorn', '✓'),
      solid(0, 1, 'peak', 'bighorn'),
      filler(1, 0, 2),
      filler(1, 1, 3),
      solid(2, 0, 'marsh', 'bighorn'),
      solid(2, 1, 'marsh', 'bighorn'),
      solid(1, 2, 'river', 'bighorn', '✗'),
    ],
  },

  elk: {
    caption: 'A straight line of four — the best an elk line pays.',
    cells: [
      solid(0, 0, 'aspen', 'elk', '✓'),
      solid(0, 1, 'prairie', 'elk'),
      solid(0, 2, 'aspen', 'elk'),
      solid(0, 3, 'marsh', 'elk'),
      filler(1, 1, 0),
      filler(-1, 2, 4),
    ],
  },

  // Four in a clean chain, plus the fifth that would ruin it.
  trout: {
    caption: 'A clean run of four. The faded trout would fork it, and then none of them score.',
    cells: [
      solid(0, 0, 'river', 'trout', '✓'),
      solid(0, 1, 'river', 'trout'),
      solid(1, 1, 'river', 'trout'),
      solid(1, 2, 'marsh', 'trout'),
      filler(1, 0, 0),
      { q: 2, r: 1, habitat: 'river', animal: 'trout', mark: '✗', dim: true },
    ],
  },

  eagle: {
    caption: 'Two eagles alone score. The pair beside each other does not.',
    cells: [
      solid(0, 0, 'marsh', 'eagle', '✓'),
      solid(0, 2, 'peak', 'eagle', '✓'),
      filler(1, 0, 2),
      filler(1, 1, 4),
      solid(2, 0, 'aspen', 'eagle', '✗'),
      solid(2, 1, 'marsh', 'eagle'),
    ],
  },

  coyote: {
    caption: 'Four different neighbours: four points for this coyote.',
    cells: [
      solid(0, 0, 'prairie', 'coyote', '✓'),
      solid(-1, 0, 'peak', 'bighorn'),
      solid(-1, 1, 'aspen', 'elk'),
      solid(0, 1, 'river', 'trout'),
      solid(1, 0, 'marsh', 'eagle'),
      filler(1, -1, 2),
      filler(0, -1, 1),
    ],
  },
};

// Pair each habitat with one that does not look like it, or the split is
// invisible and the diagram teaches nothing.
const PARTNER = { peak: 'aspen', aspen: 'river', prairie: 'peak', marsh: 'prairie', river: 'aspen' };

/**
 * A corridor built out of split tiles.
 *
 * A habitat half covers three consecutive edges, so a corridor can never run
 * straight through a split tile along one axis -- it has to turn. That is the
 * whole lesson, and it is far easier to see than to read. The numbers walk you
 * along the run; the last tile shows the habitat but is met by the wrong half.
 */
export function habitatExampleData(habitat) {
  const other = PARTNER[habitat] || HABITATS.find((h) => h !== habitat);
  // A split tile is painted with its first habitat on edges 0-2 and its second
  // on 3-5, then turned; rot carries that turn so a diagram can draw the halves
  // where the edges actually are.
  const split = (rot) => ({
    habitats: [habitat, other],
    rot,
    edges: rotateEdges([habitat, habitat, habitat, other, other, other], rot),
  });
  return {
    habitat,
    cells: [
      { q: 0, r: 0, ...split(5), joins: [5], mark: '1' },
      { q: 0, r: 1, ...split(1), joins: [2, 1], mark: '2' },
      { q: 1, r: 0, ...split(3), joins: [4, 5], mark: '3' },
      { q: 1, r: 1, ...split(2), joins: [2], mark: '4' },
      { q: 1, r: 2, ...split(2), mark: '✗' },
    ],
  };
}

/** Turn a set of example cells into an environment the rules can be run on. */
export function exampleEnv(cells, { includeDim = false } = {}) {
  const env = {};
  for (const cell of cells) {
    if (cell.dim && !includeDim) continue;
    env[cell.q + ',' + cell.r] = {
      edges: cell.edges ? cell.edges.slice() : new Array(6).fill(cell.habitat),
      wildlife: cell.animal ? [cell.animal] : [],
      keystone: false,
      rot: 0,
      token: cell.animal || null,
    };
  }
  return env;
}
