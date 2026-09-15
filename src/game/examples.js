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

  // Both scoring eagles have company, and the trout between them gives each of
  // them a second neighbour. One neighbour could be read as a limit -- players
  // have read it that way -- so the picture shows two.
  eagle: {
    caption: 'An eagle may border as many other animals as it likes. Only another eagle spoils it.',
    cells: [
      solid(0, 0, 'marsh', 'eagle', '✓'),
      solid(0, 1, 'river', 'trout'),
      solid(0, 2, 'peak', 'eagle', '✓'),
      solid(1, 0, 'prairie', 'bighorn'),
      solid(1, 1, 'aspen', 'elk'),
      solid(2, 0, 'aspen', 'eagle', '✗'),
      solid(2, 1, 'marsh', 'eagle'),
    ],
  },

  // One of the neighbours is another coyote, because it counts: the rule is
  // "different animals adjacent", and a coyote is an animal.
  coyote: {
    caption: 'Five different animals around it, five points — another coyote counts too.',
    cells: [
      solid(0, 0, 'prairie', 'coyote', '✓'),
      solid(-1, 0, 'peak', 'bighorn'),
      solid(-1, 1, 'aspen', 'elk'),
      solid(0, 1, 'river', 'trout'),
      solid(1, 0, 'marsh', 'eagle'),
      solid(0, -1, 'prairie', 'coyote'),
      filler(1, -1, 2),
    ],
  },
};

// Pair each habitat with one that does not look like it, or the split is
// invisible and the diagram teaches nothing.
const PARTNER = { peak: 'aspen', aspen: 'river', prairie: 'peak', marsh: 'prairie', river: 'marsh' };

/**
 * A different lesson about corridors for each habitat, so that hovering all
 * five teaches five things rather than the same thing in five colours.
 *
 * `expect` is the sorted run lengths the rules should find, and the tests hold
 * each diagram to it.
 */
export function habitatExampleData(habitat) {
  const other = PARTNER[habitat] || HABITATS.find((h) => h !== habitat);
  // A split tile is painted with its first habitat on edges 0-2 and its second
  // on 3-5, then turned; rot carries that turn so a diagram can draw the halves
  // where the edges actually are.
  const split = (q, r, rot, extra = {}) => ({
    q,
    r,
    habitats: [habitat, other],
    rot,
    edges: rotateEdges([habitat, habitat, habitat, other, other, other], rot),
    ...extra,
  });
  const whole = (q, r, extra = {}) => ({ q, r, habitat, ...extra });
  const gap = (q, r) => ({ q, r, habitat: other, dimTile: true });

  switch (habitat) {
    // A half covers three edges in a row, so a run through split tiles has to
    // bend. This is the shape that surprises people.
    case 'peak':
      return {
        habitat,
        expect: { peak: [4, 1] },
        caption: 'A half covers three edges in a row, so a run of split tiles has to bend.',
        cells: [
          split(0, 0, 5, { joins: [5], mark: '1' }),
          split(0, 1, 1, { joins: [2, 1], mark: '2' }),
          split(1, 0, 3, { joins: [4, 5], mark: '3' }),
          split(1, 1, 2, { joins: [2], mark: '4' }),
          split(1, 2, 2, { mark: '✗' }),
        ],
      };

    // Whole tiles show one habitat on all six edges, so they can run straight.
    case 'aspen':
      return {
        habitat,
        expect: { aspen: [4, 1] },
        caption: 'A whole tile shows the same habitat all round, so a run of them can go straight.',
        cells: [
          whole(0, 0, { joins: [5], mark: '1' }),
          whole(0, 1, { joins: [2, 5], mark: '2' }),
          whole(0, 2, { joins: [2, 5], mark: '3' }),
          whole(0, 3, { joins: [2], mark: '4' }),
          split(0, 4, 3, { mark: '✗' }),
        ],
      };

    // Unlike a trout run, a corridor is happy to fork.
    case 'prairie':
      return {
        habitat,
        expect: { prairie: [4] },
        caption: 'A corridor may branch. Every tile joined to it counts, fork or no fork.',
        cells: [
          whole(0, 0, { joins: [5], mark: '1' }),
          whole(0, 1, { joins: [2, 5, 1], mark: '2' }),
          whole(0, 2, { joins: [2], mark: '3' }),
          whole(1, 0, { joins: [4], mark: '4' }),
        ],
      };

    // Only the longest run of a habitat is worth anything.
    case 'marsh':
      return {
        habitat,
        expect: { marsh: [3, 2] },
        caption: 'Only your longest run of a habitat scores. The pair on its own is wasted.',
        cells: [
          whole(0, 0, { joins: [5], mark: '1' }),
          whole(0, 1, { joins: [2, 5], mark: '2' }),
          whole(0, 2, { joins: [2], mark: '3' }),
          gap(1, 0),
          gap(1, 1),
          whole(2, 0, { joins: [5], mark: '✗' }),
          whole(2, 1, { joins: [2], mark: '✗' }),
        ],
      };

    // One tile, two corridors: a split tile is working both halves at once.
    default:
      return {
        habitat,
        expect: { river: [2, 1], [PARTNER.river]: [2, 1] },
        caption: 'A split tile is in two corridors at once — one for each of its halves.',
        cells: [
          split(0, 0, 0, { joins: [0], joinsB: [4], mark: '✓' }),
          split(1, 0, 3, { joins: [3] }),
          split(-1, 1, 2, { joinsB: [1] }),
        ],
      };
  }
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
