// What a single hex is doing, in words, for the tooltip that follows the
// cursor around the board.
//
// Everything here is read-only and derived from the same helpers the scorer
// uses, so the tooltip cannot drift out of step with the tally at the end.

import { hexKey, parseHexKey, neighbours, HEX_AXES, HEX_DIRS, opposite } from '../game/hex.js';
import { HABITAT_INFO, ANIMAL_INFO } from '../game/tiles.js';
import { animalGroups, sameNeighbourCount, neighbourAnimals, corridorSizes } from '../game/board.js';

const listOf = (names) => (names.length < 2
  ? names.join('')
  : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);

/** The longest straight line of `animal` through this hex, in either sense. */
function longestLineThrough(env, q, r, animal) {
  let best = 1;
  for (const [a, b] of HEX_AXES) {
    let run = 1;
    for (const dir of [a, b]) {
      const [dq, dr] = HEX_DIRS[dir];
      let x = q + dq;
      let y = r + dr;
      while ((env[hexKey(x, y)] || {}).token === animal) {
        run += 1;
        x += dq;
        y += dr;
      }
    }
    best = Math.max(best, run);
  }
  return best;
}

/** The corridor this tile belongs to for one of its habitats. */
function corridorThrough(env, q, r, habitat) {
  const start = hexKey(q, r);
  if (!env[start] || !env[start].edges.includes(habitat)) return 0;
  const seen = new Set([start]);
  const queue = [start];
  let size = 0;
  while (queue.length) {
    const k = queue.pop();
    size += 1;
    const here = parseHexKey(k);
    const tile = env[k];
    for (let dir = 0; dir < 6; dir++) {
      if (tile.edges[dir] !== habitat) continue;
      const [dq, dr] = HEX_DIRS[dir];
      const nk = hexKey(here.q + dq, here.r + dr);
      const nb = env[nk];
      if (!nb || seen.has(nk)) continue;
      if (nb.edges[opposite(dir)] !== habitat) continue;
      seen.add(nk);
      queue.push(nk);
    }
  }
  return size;
}

/** How the settled animal is faring where it sits. */
function animalStanding(env, q, r, animal) {
  switch (animal) {
    case 'bighorn': {
      const group = animalGroups(env, 'bighorn').find((g) => g.includes(hexKey(q, r))) || [];
      if (group.length === 2) return 'Paired off — this pair scores.';
      if (group.length === 1) return 'On its own. A ram needs exactly one neighbour.';
      return 'In a clump of ' + group.length + ' — clumps of three or more score nothing.';
    }
    case 'elk': {
      const run = longestLineThrough(env, q, r, 'elk');
      if (run === 1) return 'Not in line with any other elk yet.';
      return 'In a straight line of ' + run + (run >= 4 ? ' — as long as a line pays.' : '.');
    }
    case 'trout': {
      const group = animalGroups(env, 'trout').find((g) => g.includes(hexKey(q, r))) || [];
      const forked = group.some((k) => {
        const h = parseHexKey(k);
        return sameNeighbourCount(env, h.q, h.r, 'trout') > 2;
      });
      if (forked) return 'This run of ' + group.length + ' has a fork in it, so it scores nothing.';
      return 'In a clean run of ' + group.length + '.';
    }
    case 'eagle': {
      const near = sameNeighbourCount(env, q, r, 'eagle');
      return near === 0
        ? 'No other eagle beside it — this one scores, whatever else is around it.'
        : 'Sharing a ridge with ' + near + ' other eagle' + (near === 1 ? '' : 's') + ', so it scores nothing.';
    }
    case 'coyote': {
      const kinds = Array.from(neighbourAnimals(env, q, r)).filter((a) => a !== 'coyote');
      return kinds.length
        ? 'Worth ' + kinds.length + ' — beside ' + listOf(kinds.map((a) => ANIMAL_INFO[a].short.toLowerCase())) + '.'
        : 'Nothing settled around it yet, so nothing to score.';
    }
    default:
      return '';
  }
}

/**
 * @returns { title, lines } for the hex, or null if there is no tile there.
 */
export function describeHex(player, q, r) {
  const env = player.env || {};
  const tile = env[hexKey(q, r)];
  if (!tile) return null;

  const habs = Array.from(new Set(tile.edges));
  const lines = [];

  for (const h of habs) {
    const size = corridorThrough(env, q, r, h);
    const best = (corridorSizes(env, h)[0]) || 0;
    lines.push(HABITAT_INFO[h].short + ': in a corridor of ' + size
      + (size === best && best > 1 ? ' — this player’s longest' : '') + '.');
  }

  if (tile.token) {
    lines.push(ANIMAL_INFO[tile.token].name + ' settled here. ' + animalStanding(env, q, r, tile.token));
  } else {
    const shows = tile.wildlife.map((a) => ANIMAL_INFO[a].short.toLowerCase());
    lines.push('Open to ' + listOf(shows) + '.');
    if (tile.keystone) lines.push('Keystone: settling that animal here earns a nature token.');
  }

  const empty = neighbours(q, r).filter((n) => !env[hexKey(n.q, n.r)]).length;
  if (empty) lines.push(empty + ' open side' + (empty === 1 ? '' : 's') + ' to build onto.');

  return {
    title: habs.map((h) => HABITAT_INFO[h].short).join(' / '),
    lines,
  };
}
