// End-of-game scoring: one rule card per animal, plus habitat corridors and
// leftover nature tokens.
//
// The five wildlife rules mirror Cascadia's "A" cards one for one, so the
// scoring tables are the ones players already know; only the animals differ.

import { HABITATS, ANIMALS, ANIMAL_INFO } from './tiles.js';
import { HEX_AXES, HEX_DIRS, hexKey, parseHexKey } from './hex.js';
import {
  largestCorridor, animalGroups, animalHexes, sameNeighbourCount, neighbourAnimals,
} from './board.js';

export const HABITAT_BONUS = 2;          // to the biggest corridor; 1 each if tied
export const SOLO_BONUS_AT = 7;          // solo play earns the bonus at this size

// --- the five rule cards ----------------------------------------------------
const BIGHORN_PAIRS = [0, 4, 11, 19, 27];                    // by number of pairs
const ELK_LINE = [0, 2, 5, 9, 13];                           // by line length, max 4
const TROUT_RUN = [0, 2, 5, 8, 12, 16, 20, 25];              // by run length, 7+ caps
const EAGLE_ALONE = [0, 2, 5, 8, 11, 14, 18, 22, 26];        // by number of lone eagles

export const RULE_TEXT = {
  bighorn: 'Rams square off in twos. Score for every pair of exactly two neighbouring '
    + 'bighorn — a lone ram or a crowd of three scores nothing.',
  elk: 'Elk move in file. Score each straight line of elk; longer lines are worth far '
    + 'more, up to four.',
  trout: 'Trout run the river single file. Score each connected run, but only if no '
    + 'trout in it touches more than two others.',
  eagle: 'Eagles will not share a ridge. Score only the eagles with no other eagle '
    + 'beside them.',
  coyote: 'Coyotes go where the going is good. Each coyote scores one for every '
    + 'different animal on the six hexes around it (another coyote counts).',
};

export const RULE_TABLE = {
  bighorn: BIGHORN_PAIRS.map((v, i) => ({ label: i + (i === 1 ? ' pair' : ' pairs'), value: v })).slice(1),
  elk: ELK_LINE.map((v, i) => ({ label: 'line of ' + i, value: v })).slice(1),
  trout: TROUT_RUN.map((v, i) => ({ label: 'run of ' + i + (i === 7 ? '+' : ''), value: v })).slice(1),
  eagle: EAGLE_ALONE.map((v, i) => ({ label: i + ' alone', value: v })).slice(1),
  coyote: [{ label: 'per neighbouring kind', value: 1 }],
};

// --- bighorn: pairs of exactly two -----------------------------------------
export function scoreBighorn(env) {
  const pairs = animalGroups(env, 'bighorn').filter((g) => g.length === 2).length;
  return BIGHORN_PAIRS[Math.min(pairs, BIGHORN_PAIRS.length - 1)]
    + Math.max(0, pairs - (BIGHORN_PAIRS.length - 1)) * 8;
}

// --- elk: straight lines ----------------------------------------------------
/**
 * Elk are partitioned into straight lines and each elk counted once, so the
 * player wants the best possible split. Because longer lines pay more than the
 * elk they consume, this searches exactly rather than taking the greedy answer:
 * fix the first unassigned elk, try every line through it, recurse.
 */
export function scoreElk(env) {
  const hexes = animalHexes(env, 'elk');
  if (!hexes.length) return 0;
  const keys = hexes.map((h) => hexKey(h.q, h.r));
  const index = new Map(keys.map((k, i) => [k, i]));
  const n = keys.length;

  // Every straight line of 1..4 elk, as bitmasks.
  const lines = [];
  for (let i = 0; i < n; i++) {
    lines.push({ mask: 1 << i, len: 1 });
    const { q, r } = parseHexKey(keys[i]);
    for (const [dirA] of HEX_AXES) {
      const [dq, dr] = HEX_DIRS[dirA];
      let mask = 1 << i;
      let cq = q;
      let cr = r;
      for (let len = 2; len <= 4; len++) {
        cq += dq;
        cr += dr;
        const idx = index.get(hexKey(cq, cr));
        if (idx === undefined) break;
        mask |= 1 << idx;
        lines.push({ mask, len });
      }
    }
  }

  const memo = new Map();
  const best = (used) => {
    if (used === (1 << n) - 1) return 0;
    if (memo.has(used)) return memo.get(used);
    let first = 0;
    while (used & (1 << first)) first += 1;
    let top = 0;
    for (const line of lines) {
      if (!(line.mask & (1 << first))) continue;
      if (line.mask & used) continue;
      const score = ELK_LINE[line.len] + best(used | line.mask);
      if (score > top) top = score;
    }
    memo.set(used, top);
    return top;
  };
  return best(0);
}

// --- trout: runs that never branch -----------------------------------------
export function scoreTrout(env) {
  let total = 0;
  for (const group of animalGroups(env, 'trout')) {
    const branching = group.some((k) => {
      const { q, r } = parseHexKey(k);
      return sameNeighbourCount(env, q, r, 'trout') > 2;
    });
    if (branching) continue;      // a tangle is not a run
    total += TROUT_RUN[Math.min(group.length, TROUT_RUN.length - 1)];
  }
  return total;
}

// --- eagle: the solitary ones ----------------------------------------------
export function scoreEagle(env) {
  const alone = animalHexes(env, 'eagle')
    .filter((h) => sameNeighbourCount(env, h.q, h.r, 'eagle') === 0).length;
  return EAGLE_ALONE[Math.min(alone, EAGLE_ALONE.length - 1)]
    + Math.max(0, alone - (EAGLE_ALONE.length - 1)) * 4;
}

// --- coyote: variety of company --------------------------------------------
export function scoreCoyote(env) {
  return animalHexes(env, 'coyote')
    .reduce((sum, h) => sum + neighbourAnimals(env, h.q, h.r).size, 0);
}

export const WILDLIFE_SCORERS = {
  bighorn: scoreBighorn,
  elk: scoreElk,
  trout: scoreTrout,
  eagle: scoreEagle,
  coyote: scoreCoyote,
};

export function scoreWildlife(env) {
  const out = {};
  for (const a of ANIMALS) out[a] = WILDLIFE_SCORERS[a](env);
  return out;
}

// ---------------------------------------------------------------------------
// The whole table
// ---------------------------------------------------------------------------
/**
 * @param players [{ id, env, nature }]
 * @returns per-player breakdown plus the habitat bonus awards
 */
export function scoreGame(players) {
  const corridors = {};
  for (const h of HABITATS) {
    corridors[h] = players.map((p) => largestCorridor(p.env, h));
  }

  const bonuses = {};
  for (const h of HABITATS) {
    const sizes = corridors[h];
    const best = Math.max(...sizes, 0);
    if (players.length === 1) {
      bonuses[h] = sizes.map((s) => (s >= SOLO_BONUS_AT ? HABITAT_BONUS : 0));
    } else if (best <= 0) {
      bonuses[h] = sizes.map(() => 0);
    } else {
      const leaders = sizes.filter((s) => s === best).length;
      bonuses[h] = sizes.map((s) => (s === best ? (leaders > 1 ? 1 : HABITAT_BONUS) : 0));
    }
  }

  const rows = players.map((p, i) => {
    const wildlife = scoreWildlife(p.env);
    const habitat = {};
    let habitatTotal = 0;
    for (const h of HABITATS) {
      habitat[h] = { size: corridors[h][i], bonus: bonuses[h][i] };
      habitatTotal += corridors[h][i] + bonuses[h][i];
    }
    const wildlifeTotal = ANIMALS.reduce((s, a) => s + wildlife[a], 0);
    return {
      id: p.id,
      wildlife,
      wildlifeTotal,
      habitat,
      habitatTotal,
      nature: p.nature || 0,
      total: wildlifeTotal + habitatTotal + (p.nature || 0),
    };
  });

  return { rows, corridors, bonuses };
}

export { ANIMAL_INFO };
