// Authoritative game engine. The host runs it; everyone else sends intents and
// renders the view they are handed back.
//
// A turn is three beats: draft a tile-and-token pair from the display, place
// the tile, place the token. The engine keeps the turn in one of those beats so
// a client can never skip a step or act out of order.

import {
  HABITATS, ANIMALS, DISPLAY_SIZE, NATURE_SUPPLY,
  buildTileDeck, buildStarters, buildTokenBag, turnsForPlayers,
} from './tiles.js';
import {
  startingEnvironment, placeTile, canPlaceTile, canPlaceToken,
  openHexes, openTokenHexes, hexKey,
} from './board.js';
import { scoreGame } from './scoring.js';
import { makeRng, randomSeed } from '../util/rng.js';

export const PLAYER_COLOURS = [
  '#e4a33c', '#4f93c4', '#c45b4f', '#6f9f5c', '#9b7bc4', '#d78fb0',
];

export const DEFAULT_SETTINGS = {
  turnsEach: 0,          // 0 = derive from the player count
  turnSeconds: 0,        // 0 = untimed
  botSkill: 'ranger',    // novice | ranger | naturalist
  cullThree: true,       // may a player clear three matching tokens for free
};

const MAX_LOG = 140;

/** "an elk", "an eagle", "a coyote" -- the log reads aloud, so it should scan. */
const article = (word) => ('aeiou'.includes(String(word)[0]) ? 'an' : 'a');

export class Engine {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.rng = makeRng(randomSeed());
    this.state = {
      phase: 'lobby',
      players: {},
      order: [],
      turnIndex: 0,
      turnPhase: 'draft',
      pending: null,
      display: [],
      deckCount: 0,
      bagCount: 0,
      natureLeft: NATURE_SUPPLY,
      turnsEach: 20,
      turnNumber: 0,
      log: [],
      result: null,
      turnEndsAt: null,
      culledThisTurn: false,
    };
    this.deck = [];
    this.bag = [];
    this.onSfx = () => {};
  }

  // -- players ------------------------------------------------------------
  addPlayer(id, name, isHost = false, isBot = false) {
    const s = this.state;
    if (s.players[id]) {
      s.players[id].connected = true;
      return s.players[id];
    }
    const used = new Set(Object.values(s.players).map((p) => p.colour));
    const colour = PLAYER_COLOURS.find((c) => !used.has(c)) || '#cccccc';
    const p = {
      id,
      name: (name || 'Ranger').slice(0, 16),
      colour,
      isHost,
      isBot,
      connected: true,
      env: {},
      nature: 0,
      turnsTaken: 0,
    };
    s.players[id] = p;
    s.order.push(id);
    return p;
  }

  setConnected(id, connected) {
    const p = this.state.players[id];
    if (!p) return;
    p.connected = connected;
    if (!connected && this.state.phase === 'lobby') this.removePlayer(id);
  }

  removePlayer(id) {
    delete this.state.players[id];
    this.state.order = this.state.order.filter((x) => x !== id);
  }

  rename(id, name) {
    const p = this.state.players[id];
    if (p) p.name = (name || 'Ranger').slice(0, 16);
  }

  get playerCount() {
    return this.state.order.length;
  }

  log(text, kind = 'info', extra = {}) {
    this.state.log.push({ t: Date.now(), text, kind, ...extra });
    if (this.state.log.length > MAX_LOG) this.state.log.shift();
  }

  // -- setup --------------------------------------------------------------
  startGame() {
    const s = this.state;
    const n = this.playerCount;
    if (n < 1) return { error: 'Nobody is here yet.' };
    if (n > 6) return { error: 'Six rangers at most.' };

    this.deck = buildTileDeck(this.rng);
    this.bag = buildTokenBag(this.rng);
    const starters = buildStarters(this.rng);

    s.turnsEach = this.settings.turnsEach > 0
      ? this.settings.turnsEach
      : turnsForPlayers(n, this.deck.length);

    s.order.forEach((id, i) => {
      const p = s.players[id];
      p.env = startingEnvironment(starters[i % starters.length]);
      p.nature = 0;
      p.turnsTaken = 0;
    });

    s.display = [];
    for (let i = 0; i < DISPLAY_SIZE; i++) {
      s.display.push({ tile: this.deck.shift() || null, token: this.bag.shift() || null });
    }
    s.natureLeft = NATURE_SUPPLY;
    s.turnIndex = Math.floor(this.rng() * n);
    s.turnNumber = 1;
    s.turnPhase = 'draft';
    s.pending = null;
    s.result = null;
    s.log = [];
    s.phase = 'playing';
    this.log('The season opens. ' + s.turnsEach + ' turns each.', 'round');
    this.beginTurn();
    return { ok: true };
  }

  returnToLobby() {
    const s = this.state;
    s.phase = 'lobby';
    s.display = [];
    s.pending = null;
    s.result = null;
    s.log = [];
    s.turnNumber = 0;
    for (const id of s.order) {
      const p = s.players[id];
      p.env = {};
      p.nature = 0;
      p.turnsTaken = 0;
    }
  }

  // -- turn plumbing ------------------------------------------------------
  currentPlayerId() {
    return this.state.order[this.state.turnIndex];
  }

  beginTurn() {
    const s = this.state;
    if (s.phase !== 'playing') return;
    s.turnPhase = 'draft';
    s.pending = null;
    s.culledThisTurn = false;
    this.resolveOverpopulation();
    s.turnEndsAt = this.settings.turnSeconds > 0
      ? Date.now() + this.settings.turnSeconds * 1000
      : null;
  }

  advanceTurn() {
    const s = this.state;
    const p = s.players[this.currentPlayerId()];
    if (p) p.turnsTaken += 1;

    const done = s.order.every((id) => s.players[id].turnsTaken >= s.turnsEach);
    if (done) {
      this.finish();
      return;
    }
    s.turnIndex = (s.turnIndex + 1) % s.order.length;
    if (s.turnIndex === 0) s.turnNumber += 1;
    this.beginTurn();
  }

  /**
   * Four of a kind clears itself, free and automatic, however many times in a
   * row it happens.
   */
  resolveOverpopulation() {
    const s = this.state;
    let guard = 0;
    while (guard++ < 12) {
      const tokens = s.display.map((d) => d.token).filter(Boolean);
      if (tokens.length < DISPLAY_SIZE) return;
      if (!tokens.every((t) => t === tokens[0])) return;
      this.log('Four ' + tokens[0] + ' at once — the valley clears them out.', 'cull');
      this.cullIndices([0, 1, 2, 3]);
      this.onSfx('cull');
    }
  }

  cullIndices(indices) {
    const s = this.state;
    for (const i of indices) {
      const slot = s.display[i];
      if (!slot || !slot.token) continue;
      this.bag.push(slot.token);
      slot.token = null;
    }
    // Shuffle what went back in, then deal replacements.
    this.bag = this.bag
      .map((v) => ({ v, k: this.rng() }))
      .sort((a, b) => a.k - b.k)
      .map((o) => o.v);
    for (const i of indices) {
      const slot = s.display[i];
      if (slot && !slot.token) slot.token = this.bag.shift() || null;
    }
  }

  /** How many of the four on offer share the commonest animal. */
  matchingTokenIndices() {
    const counts = {};
    this.state.display.forEach((d, i) => {
      if (!d.token) return;
      (counts[d.token] = counts[d.token] || []).push(i);
    });
    let best = [];
    for (const list of Object.values(counts)) {
      if (list.length > best.length) best = list;
    }
    return best;
  }

  // -- intents ------------------------------------------------------------
  handle(playerId, msg) {
    const s = this.state;
    if (s.phase === 'gameEnd') {
      if (msg.t === 'lobby' && s.players[playerId] && s.players[playerId].isHost) {
        this.returnToLobby();
        return { ok: true };
      }
      return { error: 'The season is over.' };
    }
    if (s.phase !== 'playing') return { error: 'Not in play.' };
    if (playerId !== this.currentPlayerId()) return { error: 'It is not your turn.' };
    const p = s.players[playerId];
    if (!p) return { error: 'Unknown ranger.' };

    switch (msg.t) {
      case 'cull':      return this.actCull(p, msg);
      case 'draft':     return this.actDraft(p, msg);
      case 'undraft':   return this.actUndraft(p);
      case 'placeTile': return this.actPlaceTile(p, msg);
      case 'placeToken':return this.actPlaceToken(p, msg);
      case 'skipToken': return this.actSkipToken(p);
      default:          return { error: 'Unknown move.' };
    }
  }

  actCull(p, msg) {
    const s = this.state;
    if (s.turnPhase !== 'draft') return { error: 'Too late to clear tokens.' };
    const indices = (msg.indices || []).filter((i) => i >= 0 && i < DISPLAY_SIZE);
    if (!indices.length) return { error: 'Nothing chosen to clear.' };

    const matching = this.matchingTokenIndices();
    const isFreeThree = this.settings.cullThree
      && !s.culledThisTurn
      && matching.length === 3
      && indices.length === 3
      && indices.every((i) => matching.includes(i));

    if (isFreeThree) {
      s.culledThisTurn = true;
      this.log(p.name + ' clears three matching tokens.', 'cull', { by: p.id });
    } else {
      if (p.nature < 1) return { error: 'That needs a nature token.' };
      p.nature -= 1;
      s.natureLeft = Math.min(NATURE_SUPPLY, s.natureLeft + 1);
      this.log(p.name + ' spends a nature token to clear tokens.', 'cull', { by: p.id });
    }
    this.cullIndices(indices);
    this.resolveOverpopulation();
    this.onSfx('cull');
    return { ok: true };
  }

  actDraft(p, msg) {
    const s = this.state;
    if (s.turnPhase !== 'draft') return { error: 'Already drafted.' };

    let tileIdx = msg.tileIndex;
    let tokenIdx = msg.tokenIndex;
    if (msg.index !== undefined) {
      tileIdx = msg.index;
      tokenIdx = msg.index;
    }
    if (!(tileIdx >= 0 && tileIdx < DISPLAY_SIZE)) return { error: 'No such tile.' };
    if (!(tokenIdx >= 0 && tokenIdx < DISPLAY_SIZE)) return { error: 'No such token.' };

    const tile = s.display[tileIdx].tile;
    const token = s.display[tokenIdx].token;
    if (!tile) return { error: 'That slot is empty.' };

    if (tileIdx !== tokenIdx) {
      if (p.nature < 1) return { error: 'Taking a mismatched pair needs a nature token.' };
      p.nature -= 1;
      s.natureLeft = Math.min(NATURE_SUPPLY, s.natureLeft + 1);
      this.log(p.name + ' spends a nature token to pick freely.', 'nature', { by: p.id });
      this.onSfx('nature');
    }

    s.display[tileIdx].tile = null;
    if (token) s.display[tokenIdx].token = null;
    s.pending = { tile, token, tileIdx, tokenIdx, spent: tileIdx !== tokenIdx };
    s.turnPhase = 'tile';
    this.onSfx('draft');
    return { ok: true };
  }

  /**
   * Put an untouched pair back on offer. Nothing has happened to the board
   * yet, so this is a clean undo -- including the nature token if picking a
   * mismatched pair is what cost one.
   */
  actUndraft(p) {
    const s = this.state;
    if (s.turnPhase !== 'tile' || !s.pending) return { error: 'Nothing to put back.' };
    const { tile, token, tileIdx, tokenIdx, spent } = s.pending;
    s.display[tileIdx].tile = tile;
    if (token) s.display[tokenIdx].token = token;
    if (spent && s.natureLeft > 0) {
      p.nature += 1;
      s.natureLeft -= 1;
    }
    s.pending = null;
    s.turnPhase = 'draft';
    this.onSfx('draft');
    return { ok: true };
  }

  actPlaceTile(p, msg) {
    const s = this.state;
    if (s.turnPhase !== 'tile') return { error: 'No tile in hand.' };
    const { q, r } = msg;
    const rot = ((msg.rot | 0) % 6 + 6) % 6;
    if (!canPlaceTile(p.env, q, r)) return { error: 'A tile must touch your land.' };

    placeTile(p.env, q, r, s.pending.tile, rot);
    this.log(p.name + ' lays a tile.', 'tile', { by: p.id });
    this.onSfx('tile');

    // With no token drawn, or nowhere to put it, the turn ends here.
    const token = s.pending.token;
    if (!token || !openTokenHexes(p.env, token).length) {
      if (token) {
        this.bag.push(token);
        this.log('No room for the ' + token + ' — it goes back to the wild.', 'skip', { by: p.id });
      }
      this.finishTurn(p);
      return { ok: true };
    }
    s.turnPhase = 'token';
    return { ok: true };
  }

  actPlaceToken(p, msg) {
    const s = this.state;
    if (s.turnPhase !== 'token') return { error: 'No token in hand.' };
    const token = s.pending.token;
    const { q, r } = msg;
    if (!canPlaceToken(p.env, q, r, token)) return { error: 'That animal will not settle there.' };

    const hex = p.env[hexKey(q, r)];
    hex.token = token;
    this.log(p.name + ' settles ' + article(token) + ' ' + token + '.', 'token', { by: p.id });
    this.onSfx('token');

    if (hex.keystone && s.natureLeft > 0) {
      p.nature += 1;
      s.natureLeft -= 1;
      this.log(p.name + ' earns a nature token.', 'nature', { by: p.id });
      this.onSfx('nature');
    }
    this.finishTurn(p);
    return { ok: true };
  }

  /**
   * Decline to settle the animal and put it back in the bag.
   *
   * Several of the scoring rules punish a crowd -- a third bighorn spoils a
   * pair, a second eagle on a ridge scores nothing, one trout too many forks a
   * run -- so being made to place an animal you do not want would be a way to
   * lose points against your will. You may always wave it on.
   */
  actSkipToken(p) {
    const s = this.state;
    if (s.turnPhase !== 'token') return { error: 'No animal in hand.' };
    const token = s.pending && s.pending.token;
    if (token) {
      this.bag.push(token);
      this.log(p.name + ' waves ' + article(token) + ' ' + token + ' on into the wild.', 'skip', { by: p.id });
    }
    this.onSfx('cull');
    this.finishTurn(p);
    return { ok: true };
  }

  finishTurn(p) {
    const s = this.state;
    const { tileIdx, tokenIdx } = s.pending || {};
    s.pending = null;
    // Refill the slots that were emptied.
    for (const i of new Set([tileIdx, tokenIdx])) {
      const slot = s.display[i];
      if (!slot) continue;
      if (!slot.tile) slot.tile = this.deck.shift() || null;
      if (!slot.token) slot.token = this.bag.shift() || null;
    }
    this.advanceTurn();
  }

  /** Time is up: draft the first pair and put both wherever they will go. */
  tick() {
    const s = this.state;
    if (s.phase !== 'playing' || !s.turnEndsAt) return false;
    if (Date.now() < s.turnEndsAt) return false;
    const p = s.players[this.currentPlayerId()];
    if (!p) return false;
    this.log(p.name + ' runs out of daylight.', 'timeout', { by: p.id });

    if (s.turnPhase === 'draft') {
      const idx = s.display.findIndex((d) => d.tile);
      if (idx < 0) { this.finish(); return true; }
      this.actDraft(p, { index: idx });
    }
    if (s.turnPhase === 'tile') {
      const spots = openHexes(p.env);
      this.actPlaceTile(p, { ...spots[0], rot: 0 });
    }
    if (s.turnPhase === 'token') {
      const spots = openTokenHexes(p.env, s.pending.token);
      if (spots.length) this.actPlaceToken(p, spots[0]);
      else this.finishTurn(p);
    }
    return true;
  }

  finish() {
    const s = this.state;
    s.phase = 'gameEnd';
    s.turnEndsAt = null;
    const scored = scoreGame(s.order.map((id) => ({
      id,
      env: s.players[id].env,
      nature: s.players[id].nature,
    })));
    const ranked = scored.rows.slice().sort((a, b) => b.total - a.total);
    const top = ranked.length ? ranked[0].total : 0;
    s.result = {
      ...scored,
      ranked: ranked.map((r) => ({ ...r, name: s.players[r.id].name })),
      winners: ranked.filter((r) => r.total === top).map((r) => r.id),
    };
    this.log('The season closes. The tally is in.', 'round');
    this.onSfx('finish');
  }

  // -- views --------------------------------------------------------------
  viewFor(playerId) {
    const s = this.state;
    const me = s.players[playerId];
    return {
      phase: s.phase,
      settings: this.settings,
      hostId: s.order.find((id) => s.players[id].isHost) || null,
      order: s.order.slice(),
      turnIndex: s.turnIndex,
      turnNumber: s.turnNumber,
      turnsEach: s.turnsEach,
      currentPlayerId: s.phase === 'playing' ? this.currentPlayerId() : null,
      turnPhase: s.turnPhase,
      turnEndsAt: s.turnEndsAt,
      pending: s.pending
        ? { tile: s.pending.tile, token: s.pending.token }
        : null,
      display: s.display.map((d) => ({ tile: d.tile, token: d.token })),
      deckCount: this.deck.length,
      bagCount: this.bag.length,
      natureLeft: s.natureLeft,
      matching: this.matchingTokenIndices(),
      culledThisTurn: s.culledThisTurn,
      log: s.log.slice(-40),
      result: s.result,
      you: me ? { id: me.id, nature: me.nature, isHost: me.isHost } : null,
      players: s.order.map((id) => {
        const p = s.players[id];
        return {
          id: p.id,
          name: p.name,
          colour: p.colour,
          isHost: p.isHost,
          isBot: !!p.isBot,
          connected: p.connected,
          nature: p.nature,
          turnsTaken: p.turnsTaken,
          env: p.env,
        };
      }),
    };
  }
}

export { HABITATS, ANIMALS };
