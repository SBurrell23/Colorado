// Computer-controlled rangers.
//
// A bot is handed the same view a human gets and nothing else. Everything in
// Colorado is open information except the order of the token bag, so the bot
// has no secret to peek at -- it simply has to play well, which it does by
// simulating each candidate move and measuring what it is actually worth in
// end-of-game points.

import { HABITATS, ANIMALS, DISPLAY_SIZE } from './tiles.js';
import {
  placeTile, canPlaceTile, openHexes, openTokenHexes, largestCorridor, hexKey,
} from './board.js';
import { WILDLIFE_SCORERS } from './scoring.js';
import { neighbours } from './hex.js';

export const BOT_NAMES = [
  'Rosalie', 'Cutler', 'Wren', 'Silas', 'Juniper', 'Hollis',
  'Maribel', 'Ansel', 'Della', 'Foster', 'Odessa', 'Barnaby',
];

export const BOT_SKILLS = {
  novice:     { blunder: 0.40, horizon: 6,  natureGate: 5.0, label: 'Novice' },
  ranger:     { blunder: 0.14, horizon: 12, natureGate: 3.0, label: 'Ranger' },
  naturalist: { blunder: 0.02, horizon: 24, natureGate: 1.8, label: 'Naturalist' },
};

export function pickBotName(taken) {
  const free = BOT_NAMES.filter((n) => !taken.includes(n));
  const pool = free.length ? free : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------------------
function cloneEnv(env) {
  const out = {};
  for (const [k, t] of Object.entries(env)) {
    out[k] = { ...t, habitats: t.habitats.slice(), wildlife: t.wildlife.slice(), edges: t.edges.slice() };
  }
  return out;
}

function corridorTotal(env) {
  let sum = 0;
  for (const h of HABITATS) sum += largestCorridor(env, h);
  return sum;
}

function wildlifeTotal(env) {
  let sum = 0;
  for (const a of ANIMALS) sum += WILDLIFE_SCORERS[a](env);
  return sum;
}

/** Hexes worth trying first: the ones with the most neighbours already down. */
function rankedOpenHexes(env, limit) {
  const spots = openHexes(env).map((h) => ({
    ...h,
    touching: neighbours(h.q, h.r).filter((n) => env[hexKey(n.q, n.r)]).length,
  }));
  spots.sort((a, b) => b.touching - a.touching);
  return limit ? spots.slice(0, limit) : spots;
}

/**
 * What a tile is worth here: corridor growth, plus a little credit for the
 * animals it would make room for, minus a nudge against sprawl.
 */
function scoreTilePlacement(env, tile, q, r, rot, appetite) {
  const before = corridorTotal(env);
  const test = cloneEnv(env);
  placeTile(test, q, r, tile, rot);
  let score = (corridorTotal(test) - before) * 3.2;

  // Open slots matter more for animals the board is hungry for.
  for (const a of tile.wildlife) score += 0.5 + (appetite[a] || 0) * 0.8;

  // A keystone is a standing offer of a nature token.
  if (tile.keystone) score += 1.4;

  // Keep the patch compact; stragglers are hard to build corridors from.
  const touching = neighbours(q, r).filter((n) => env[hexKey(n.q, n.r)]).length;
  score += touching * 0.35;
  return score;
}

function bestTilePlacement(env, tile, appetite, horizon) {
  let best = null;
  for (const spot of rankedOpenHexes(env, horizon)) {
    for (let rot = 0; rot < 6; rot++) {
      // A single-habitat tile plays the same whichever way up it goes.
      if (tile.habitats.length === 1 && rot > 0) break;
      const score = scoreTilePlacement(env, tile, spot.q, spot.r, rot, appetite);
      if (!best || score > best.score) best = { score, q: spot.q, r: spot.r, rot };
    }
  }
  return best;
}

/** What settling this animal here would actually add to the final tally. */
function scoreTokenPlacement(env, animal, q, r) {
  const scorer = WILDLIFE_SCORERS[animal];
  const before = scorer(env);
  const test = cloneEnv(env);
  const hex = test[hexKey(q, r)];
  hex.token = animal;
  let score = scorer(test) - before;
  if (hex.keystone) score += 1.6;       // the nature token, plus its flexibility
  // Settling a hex that several other animals wanted has a cost.
  score -= (hex.wildlife.length - 1) * 0.25;
  return score;
}

function bestTokenPlacement(env, animal) {
  let best = null;
  for (const spot of openTokenHexes(env, animal)) {
    const score = scoreTokenPlacement(env, animal, spot.q, spot.r);
    if (!best || score > best.score) best = { score, q: spot.q, r: spot.r };
  }
  return best;
}

/** Which animals this environment is short of somewhere to put. */
function boardAppetite(env) {
  const appetite = {};
  for (const a of ANIMALS) {
    const open = openTokenHexes(env, a).length;
    appetite[a] = open === 0 ? 1.2 : open <= 2 ? 0.6 : 0;
  }
  return appetite;
}

// ---------------------------------------------------------------------------
/**
 * @param view  the bot's own player view
 * @param opts  { skill, rng }
 * @returns an intent ready for Engine.handle, or null if there is nothing to do
 */
export function chooseBotMove(view, opts = {}) {
  const skill = BOT_SKILLS[opts.skill] || BOT_SKILLS.ranger;
  const rng = opts.rng || Math.random;
  const me = view.players.find((p) => p.id === view.currentPlayerId);
  if (!me) return null;
  const env = me.env;

  if (view.turnPhase === 'tile') {
    const tile = view.pending && view.pending.tile;
    if (!tile) return null;
    const appetite = boardAppetite(env);
    const options = [];
    for (const spot of rankedOpenHexes(env, skill.horizon)) {
      for (let rot = 0; rot < 6; rot++) {
        if (tile.habitats.length === 1 && rot > 0) break;
        options.push({
          score: scoreTilePlacement(env, tile, spot.q, spot.r, rot, appetite) + rng() * 0.4,
          q: spot.q, r: spot.r, rot,
        });
      }
    }
    if (!options.length) return null;
    options.sort((a, b) => b.score - a.score);
    const pick = rng() < skill.blunder && options.length > 1
      ? options[1 + Math.floor(rng() * Math.min(4, options.length - 1))]
      : options[0];
    return { t: 'placeTile', q: pick.q, r: pick.r, rot: pick.rot };
  }

  if (view.turnPhase === 'token') {
    const animal = view.pending && view.pending.token;
    if (!animal) return null;
    const spots = openTokenHexes(env, animal);
    if (!spots.length) return null;
    const options = spots.map((s) => ({
      score: scoreTokenPlacement(env, animal, s.q, s.r) + rng() * 0.3,
      q: s.q, r: s.r,
    }));
    options.sort((a, b) => b.score - a.score);
    const pick = rng() < skill.blunder && options.length > 1
      ? options[1 + Math.floor(rng() * Math.min(3, options.length - 1))]
      : options[0];
    return { t: 'placeToken', q: pick.q, r: pick.r };
  }

  // --- drafting ------------------------------------------------------------
  const appetite = boardAppetite(env);
  const value = (tileIdx, tokenIdx) => {
    const tile = view.display[tileIdx] && view.display[tileIdx].tile;
    if (!tile) return null;
    const token = view.display[tokenIdx] && view.display[tokenIdx].token;
    const tileBest = bestTilePlacement(env, tile, appetite, skill.horizon);
    if (!tileBest) return null;
    let score = tileBest.score;
    if (token) {
      // Judge the token against the board as it will be once the tile is down.
      const after = cloneEnv(env);
      placeTile(after, tileBest.q, tileBest.r, tile, tileBest.rot);
      const tokenBest = bestTokenPlacement(after, token);
      score += tokenBest ? tokenBest.score * 2.2 : -1.5;
    }
    return score;
  };

  // A free clear of three matching tokens, when the display is poor.
  if (view.settings.cullThree && !view.culledThisTurn && view.matching.length === 3) {
    const straight = [0, 1, 2, 3]
      .map((i) => value(i, i))
      .filter((v) => v !== null);
    const bestNow = straight.length ? Math.max(...straight) : -99;
    if (bestNow < 2.5) return { t: 'cull', indices: view.matching };
  }

  const paired = [];
  for (let i = 0; i < DISPLAY_SIZE; i++) {
    const v = value(i, i);
    if (v !== null) paired.push({ score: v + rng() * 0.5, tileIndex: i, tokenIndex: i });
  }
  if (!paired.length) return null;
  paired.sort((a, b) => b.score - a.score);

  // Spending a nature token has to buy a clearly better turn than the best
  // straight pair, or it is not worth the point it costs.
  if (me.nature > 0) {
    let bestMix = null;
    for (let ti = 0; ti < DISPLAY_SIZE; ti++) {
      for (let ki = 0; ki < DISPLAY_SIZE; ki++) {
        if (ti === ki) continue;
        const v = value(ti, ki);
        if (v === null) continue;
        if (!bestMix || v > bestMix.score) bestMix = { score: v, tileIndex: ti, tokenIndex: ki };
      }
    }
    if (bestMix && bestMix.score > paired[0].score + skill.natureGate) {
      return { t: 'draft', tileIndex: bestMix.tileIndex, tokenIndex: bestMix.tokenIndex };
    }
  }

  const pick = rng() < skill.blunder && paired.length > 1
    ? paired[1 + Math.floor(rng() * (paired.length - 1))]
    : paired[0];
  return { t: 'draft', index: pick.tileIndex };
}

export { wildlifeTotal, corridorTotal };
