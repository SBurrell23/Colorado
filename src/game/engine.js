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
  // How long a seat may sit empty before the table stops waiting on it. The
  // seat is still theirs -- they can come back to it -- but their turns get
  // played out for them meanwhile, so one dropped guest cannot end the game
  // for everybody else. 0 turns this off.
  dropGraceSeconds: 45,
};

const MAX_LOG = 140;

/**
 * Once a seat has been given up on, its turns are played out on a short beat
 * rather than the full grace period again -- otherwise a party of five would
 * spend the rest of the season waiting out the same timer.
 */
const AWAY_BEAT_MS = 1200;

/** A display slot index that arrived over the wire, or -1 if it is nonsense. */
function slotIndex(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < DISPLAY_SIZE ? n : -1;
}

/** A hex coordinate that arrived over the wire, or null if it is nonsense. */
function coord(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

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
      offlineSince: null,
      away: false,       // given up on: their turns are played out for them
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
    // Going quiet twice over must not restart the clock on the first drop.
    if (p.connected === connected) {
      if (!connected && !p.offlineSince) p.offlineSince = Date.now();
      return;
    }
    p.connected = connected;
    if (connected) {
      p.offlineSince = null;
      p.away = false;
    } else {
      p.offlineSince = Date.now();
    }
    if (!connected && this.state.phase === 'lobby') this.removePlayer(id);
  }

  /**
   * Take a seat out of the game.
   *
   * The turn pointer is an index into `order`, so pulling a seat out from
   * under it used to leave it pointing at a seat that was no longer there --
   * or past the end of the list entirely. Nobody was then the current player,
   * every move was refused as out of turn, and even the host's nudge had
   * nobody to nudge: the game was over without ever ending.
   */
  removePlayer(id) {
    const s = this.state;
    const idx = s.order.indexOf(id);
    delete s.players[id];
    if (idx < 0) return;
    const wasTheirTurn = s.phase === 'playing' && idx === s.turnIndex;
    // Whatever they were holding goes back on offer rather than out of the box.
    if (wasTheirTurn) this.returnPending();
    s.order.splice(idx, 1);

    if (!s.order.length) {
      s.turnIndex = 0;
      if (s.phase === 'playing') this.finish();
      return;
    }
    // A seat leaving ahead of the pointer shifts everyone after it down one;
    // the seat that was on turn has to stay on turn.
    if (idx < s.turnIndex) s.turnIndex -= 1;
    s.turnIndex = ((s.turnIndex % s.order.length) + s.order.length) % s.order.length;

    if (wasTheirTurn && s.phase === 'playing') {
      // Their turn goes with them. The next seat starts a clean one.
      if (this.everyoneDone()) this.finish();
      else this.beginTurn();
    }
  }

  /**
   * Put whatever is in hand back where it came from, with nobody to refund.
   * Used when a seat disappears mid-turn -- the tile and the token belong to
   * the game, not to the player who happened to be holding them.
   */
  returnPending() {
    const s = this.state;
    if (!s.pending) return;
    const { tile, token, tileIdx, tokenIdx } = s.pending;
    // At the token beat the tile is already down; only the animal is in hand.
    if (s.turnPhase === 'tile' && tile) {
      if (s.display[tileIdx] && !s.display[tileIdx].tile) s.display[tileIdx].tile = tile;
      else this.deck.unshift(tile);
    }
    if (token) {
      if (s.display[tokenIdx] && !s.display[tokenIdx].token) s.display[tokenIdx].token = token;
      else this.bag.push(token);
    }
    s.pending = null;
    s.turnPhase = 'draft';
  }

  rename(id, name) {
    const p = this.state.players[id];
    if (p) p.name = (name || 'Ranger').slice(0, 16);
  }

  get playerCount() {
    return this.state.order.length;
  }

  /**
   * Every entry carries a number that only ever goes up. Views send a window
   * of the tail, so the length of what arrives stops changing once the log is
   * longer than that window -- anything downstream that watches the length to
   * decide whether something happened would freeze. The number does not.
   */
  log(text, kind = 'info', extra = {}) {
    this.logSeq = (this.logSeq || 0) + 1;
    this.state.log.push({ n: this.logSeq, t: Date.now(), text, kind, ...extra });
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
      p.away = false;   // a fresh season gives everyone the benefit of the doubt
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
      p.away = false;
    }
  }

  // -- turn plumbing ------------------------------------------------------
  /**
   * Whoever is on turn. The pointer is kept inside the list here as well as
   * wherever it is moved, so that however it came to be out of range there is
   * always somebody whose turn it is and the game can always go on.
   */
  currentPlayerId() {
    const s = this.state;
    if (!s.order.length) return null;
    const i = s.turnIndex;
    if (!Number.isInteger(i) || i < 0 || i >= s.order.length) {
      s.turnIndex = Number.isFinite(i)
        ? ((Math.trunc(i) % s.order.length) + s.order.length) % s.order.length
        : 0;
    }
    return s.order[s.turnIndex];
  }

  /** Has every remaining seat had all the turns the season allows? */
  everyoneDone() {
    const s = this.state;
    return s.order.length > 0 && s.order.every((id) => s.players[id].turnsTaken >= s.turnsEach);
  }

  beginTurn() {
    const s = this.state;
    if (s.phase !== 'playing') return;
    // Nothing left to draft: the stack has run out and no turn can be played
    // from here, so the season closes rather than stopping dead on somebody
    // with no legal move.
    if (!s.display.some((d) => d && d.tile)) {
      this.log('The stack is empty — the season closes early.', 'round');
      this.finish();
      return;
    }
    s.turnPhase = 'draft';
    s.pending = null;
    s.culledThisTurn = false;
    this.resolveOverpopulation();
    s.turnStartedAt = Date.now();
    s.turnEndsAt = this.settings.turnSeconds > 0
      ? Date.now() + this.settings.turnSeconds * 1000
      : null;
  }

  advanceTurn() {
    const s = this.state;
    const p = s.players[this.currentPlayerId()];
    if (p) p.turnsTaken += 1;

    if (!s.order.length) { this.finish(); return; }
    if (this.everyoneDone()) {
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
    // Anything at all can arrive over the wire. A move the engine cannot read
    // is refused here rather than being allowed to throw halfway through a
    // rule and leave the game in a state no move can get it out of.
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
      return { error: 'Unknown move.' };
    }
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
    const raw = Array.isArray(msg.indices) ? msg.indices.slice(0, DISPLAY_SIZE) : [];
    const indices = [...new Set(raw.map(slotIndex))].filter((i) => i >= 0);
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
    // Changing your mind before anything has been laid: put the pair you are
    // holding back on offer and take the new one instead. Nothing has happened
    // to the board yet, so this costs nothing -- including any nature token
    // spent on a mismatched pair, which actUndraft refunds.
    if (s.turnPhase === 'tile' && s.pending) {
      const back = this.actUndraft(p);
      if (back.error) return back;
    }
    if (s.turnPhase !== 'draft') return { error: 'Already drafted.' };

    let tileIdx = slotIndex(msg.tileIndex);
    let tokenIdx = slotIndex(msg.tokenIndex);
    if (msg.index !== undefined) {
      tileIdx = slotIndex(msg.index);
      tokenIdx = tileIdx;
    }
    if (tileIdx < 0) return { error: 'No such tile.' };
    if (tokenIdx < 0) return { error: 'No such token.' };

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
    const q = coord(msg.q);
    const r = coord(msg.r);
    if (q === null || r === null) return { error: 'That is not a place on the map.' };
    const rot = ((msg.rot | 0) % 6 + 6) % 6;
    if (!s.pending || !s.pending.tile) return { error: 'No tile in hand.' };
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
    const token = s.pending && s.pending.token;
    const q = coord(msg.q);
    const r = coord(msg.r);
    if (q === null || r === null) return { error: 'That is not a place on the map.' };
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
      this.log(p.name + ' sends ' + article(token) + ' ' + token + ' back to the wild.', 'skip', { by: p.id });
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

  /**
   * Play the current turn out on its owner's behalf.
   *
   * Every beat is attempted and none of them is trusted: whatever happens, the
   * turn is over by the time this returns. A step that quietly failed used to
   * leave the turn where it was while the clock kept firing, which meant the
   * table waited on somebody who was never going to move -- and with the timer
   * off, which is the default, nothing was ever going to notice.
   */
  autoPlay(reason) {
    const s = this.state;
    if (s.phase !== 'playing') return false;
    if (!s.order.length) { this.finish(); return true; }
    const p = s.players[this.currentPlayerId()];
    // No such seat: the game cannot be played on from here, and pretending
    // there is nothing to do would leave it stuck forever. End it instead.
    if (!p) { this.finish(); return true; }
    const taken = p.turnsTaken;
    this.log(p.name + ' ' + reason, 'timeout', { by: p.id });

    if (s.turnPhase === 'draft') {
      const idx = s.display.findIndex((d) => d.tile);
      if (idx < 0) { this.finish(); return true; }
      this.actDraft(p, { index: idx });
    }
    if (s.turnPhase === 'tile') {
      const spot = openHexes(p.env).find((h) => canPlaceTile(p.env, h.q, h.r));
      if (spot) this.actPlaceTile(p, { q: spot.q, r: spot.r, rot: 0 });
    }
    if (s.turnPhase === 'token') {
      const token = s.pending && s.pending.token;
      const spots = token ? openTokenHexes(p.env, token) : [];
      if (spots.length) this.actPlaceToken(p, spots[0]);
      else this.actSkipToken(p);
    }
    // The backstop: if none of that moved the game on, end the turn anyway.
    if (s.phase === 'playing' && p.turnsTaken === taken) this.finishTurn(p);
    return true;
  }

  /**
   * The heartbeat. Two things can make a turn play itself: the clock running
   * out, and the ranger whose turn it is having gone off the trail.
   *
   * The second matters more than the first, because the timer is off by
   * default: without it, one guest closing their laptop mid-game left the
   * other four watching a board that would never move again.
   */
  tick() {
    const s = this.state;
    if (s.phase !== 'playing') return false;
    if (!s.order.length) { this.finish(); return true; }

    const p = s.players[this.currentPlayerId()];
    if (!p) return this.autoPlay('is no longer at the table.');

    const grace = Math.max(0, this.settings.dropGraceSeconds || 0) * 1000;
    if (grace && !p.connected && !p.isBot) {
      if (!p.offlineSince) p.offlineSince = Date.now();
      // The first turn after they vanish waits out the full grace period, in
      // case they are only changing trains. After that the table stops
      // holding its breath and their turns go by on a short beat.
      const since = p.away ? (s.turnStartedAt || 0) : p.offlineSince;
      const wait = p.away ? AWAY_BEAT_MS : grace;
      if (Date.now() - since >= wait) {
        p.away = true;
        return this.autoPlay('is off the trail — their turn is played out for them.');
      }
    }

    if (!s.turnEndsAt || Date.now() < s.turnEndsAt) return false;
    return this.autoPlay('runs out of daylight.');
  }

  /** The host pushing a turn along that is not going anywhere by itself. */
  forceTurn() {
    if (this.state.phase !== 'playing') return { error: 'No turn to play.' };
    this.autoPlay('cannot go on — their turn is played out for them.');
    return { ok: true };
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
      turnStartedAt: s.turnStartedAt || null,
      // The slots it came out of travel with it, so the display can show the
      // pair still sitting where it was, lifted, rather than blanking it.
      pending: s.pending
        ? {
          tile: s.pending.tile,
          token: s.pending.token,
          tileIdx: s.pending.tileIdx,
          tokenIdx: s.pending.tokenIdx,
        }
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
          away: !!p.away,
          nature: p.nature,
          turnsTaken: p.turnsTaken,
          env: p.env,
        };
      }),
    };
  }
}

export { HABITATS, ANIMALS };
