// One interface for the UI, whether this browser is running the game (host) or
// watching someone else's (client).

import { Engine, DEFAULT_SETTINGS } from '../game/engine.js';
import { chooseBotMove, pickBotName } from '../game/ai.js';
import { NetHost, NetClient, randomCode } from './net.js';

class Emitter {
  constructor() { this.handlers = {}; }
  on(name, fn) {
    (this.handlers[name] = this.handlers[name] || []).push(fn);
    return this;
  }
  emit(name, ...args) {
    for (const fn of this.handlers[name] || []) {
      try { fn(...args); } catch (err) { console.error('[session]', name, err); }
    }
  }
}

const MAX_CHAT = 60;

/**
 * The host asks every peer to say something every few seconds, and gives up on
 * one that has not answered in four beats.
 *
 * A link can die without either end being told: a laptop lid closes, a phone
 * changes network, ICE quietly gives up. The connection object still reads as
 * open, so the host went on believing somebody was there and, if it was their
 * turn, waited on them forever. Asking is the only way to know.
 *
 * The probe is host-driven on purpose. A background tab's timers are throttled
 * to a crawl, so a guest pinging on its own clock looks dead even when it is
 * fine -- but it still answers a message the moment one arrives.
 */
const HEARTBEAT_MS = 4000;
const PEER_QUIET_MS = 16000;

/**
 * A guest may send this many messages per window before the rest are dropped.
 * Well clear of normal play -- a fast turn is a handful of messages and the
 * heartbeat reply is one every four seconds.
 */
const MSG_BUDGET = 80;
const MSG_WINDOW = 2000;

export class HostSession extends Emitter {
  constructor(name, settings) {
    super();
    this.isHost = true;
    this.localId = 'host';
    this.name = name;
    this.engine = new Engine({ ...DEFAULT_SETTINGS, ...settings });
    this.net = new NetHost();
    this.chat = [];
    this.code = null;
    this.pending = new Map();
    // A player's seat is keyed by the id their browser remembers, not by the
    // peer id, which changes every time they reconnect. These two maps are the
    // bridge between the two.
    this.playerOf = new Map();   // peerId  -> playerId
    this.peerOf = new Map();     // playerId -> peerId
    this.lastSeen = new Map();   // peerId  -> ms, when they last said anything
    this.budget = new Map();     // peerId  -> { n, until }
    this.timer = null;
    this.beat = null;
    this.botSeq = 0;
    this.ping = 0;      // the host is the host; nothing to wait for
    this.botDeadline = 0;
    this.botKey = '';

    this.engine.onSfx = (sfx) => {
      this.net.broadcast({ t: 'sfx', name: sfx });
      this.emit('sfx', sfx);
    };
  }

  async start(preferredCode) {
    this.engine.addPlayer(this.localId, this.name, true);
    this.code = await this.net.start(preferredCode || randomCode());

    this.net.on('connect', (peerId) => {
      this.pending.set(peerId, Date.now());
      this.lastSeen.set(peerId, Date.now());
    });
    this.net.on('message', (peerId, msg) => this.onMessage(peerId, msg));
    this.net.on('disconnect', (peerId) => this.dropPeer(peerId));
    this.net.on('error', (err) => this.emit('error', err.message || String(err)));
    this.net.on('warn', (err) => console.warn('[host]', err));
    this.net.on('relisten', () => this.pushChat(null, 'The room is open again.', 'system'));

    this.timer = setInterval(() => {
      let changed = this.sweep();
      if (this.engine.tick()) changed = true;
      if (this.runBot()) changed = true;
      if (changed) this.broadcast();
    }, 250);

    // Ask everyone to speak up, so a link that has quietly died can be told
    // apart from a guest who is simply thinking.
    this.beat = setInterval(() => {
      this.net.broadcast({ t: 'ping', at: Date.now() });
    }, HEARTBEAT_MS);

    this.broadcast();
    return this.code;
  }

  /** Is this peer both connected and still answering? */
  isLive(peerId) {
    if (!peerId) return false;
    if (this.net.isOpen && !this.net.isOpen(peerId)) return false;
    const seen = this.lastSeen.get(peerId);
    return !!seen && Date.now() - seen < PEER_QUIET_MS;
  }

  /**
   * A peer is gone -- because the channel closed, or because it stopped
   * answering. Their seat stays warm; the engine plays their turns out for
   * them after a grace period so the table is never held up.
   */
  dropPeer(peerId, quiet = false) {
    const pid = this.playerOf.get(peerId);
    this.playerOf.delete(peerId);
    if (pid && this.peerOf.get(pid) === peerId) this.peerOf.delete(pid);
    this.pending.delete(peerId);
    this.lastSeen.delete(peerId);
    this.budget.delete(peerId);
    const p = pid && this.engine.state.players[pid];
    if (p && !quiet) {
      this.pushChat(null, p.name + ' has left the trail.', 'system');
      this.emit('sfx', 'leave');
      this.net.broadcast({ t: 'sfx', name: 'leave' });
    }
    // Mid-game their seat is kept warm; they can come back to it.
    if (pid) this.engine.setConnected(pid, false);
    this.broadcast();
  }

  /**
   * Once a beat: hang up on anyone who has gone quiet, and on anyone who
   * knocked but never introduced themselves.
   */
  sweep() {
    const now = Date.now();
    let changed = false;
    for (const [peerId, seen] of [...this.lastSeen]) {
      if (now - seen < PEER_QUIET_MS) continue;
      this.net.kick(peerId);
      this.dropPeer(peerId);
      changed = true;
    }
    for (const [peerId, at] of [...this.pending]) {
      if (now - at < PEER_QUIET_MS) continue;
      this.net.kick(peerId);
      this.dropPeer(peerId, true);
      changed = true;
    }
    return changed;
  }

  /** One guest must not be able to drown the host in messages. */
  overBudget(peerId) {
    const now = Date.now();
    let b = this.budget.get(peerId);
    if (!b || now > b.until) {
      b = { n: 0, until: now + MSG_WINDOW };
      this.budget.set(peerId, b);
    }
    b.n += 1;
    return b.n > MSG_BUDGET;
  }

  onMessage(peerId, msg) {
    if (!msg || typeof msg !== 'object') return;
    // Anything at all counts as a sign of life, including the heartbeat reply.
    this.lastSeen.set(peerId, Date.now());
    if (this.overBudget(peerId)) return;
    const s = this.engine.state;

    if (msg.t === 'hello') {
      const deny = (reason) => {
        this.net.send(peerId, { t: 'denied', reason });
        setTimeout(() => this.net.kick(peerId), 500);
      };

      // A second hello down a channel that already has a seat is a rename and
      // nothing else. Letting it claim a fresh seat left the first one behind
      // with nobody behind it -- a ghost the table would wait on forever.
      const held = this.playerOf.get(peerId);
      if (held && s.players[held]) {
        if (msg.name) this.engine.rename(held, msg.name);
        this.broadcast();
        return;
      }

      const wanted = typeof msg.clientId === 'string' && /^[a-z0-9]{6,40}$/.test(msg.clientId)
        ? msg.clientId : null;

      // Coming back to a seat you already hold. It is yours unless somebody is
      // demonstrably still sitting in it -- two tabs with the same stored id
      // must not fight over one, but a seat whose channel has quietly died is
      // not occupied, whatever the engine still believes.
      let id = null;
      const seat = wanted ? s.players[wanted] : null;
      if (seat && !seat.isBot) {
        const holder = this.peerOf.get(wanted);
        const occupied = holder && holder !== peerId && this.isLive(holder);
        if (!occupied) {
          if (holder && holder !== peerId) {
            // Whatever was in the seat is not answering; hang up on it first.
            this.net.kick(holder);
            this.dropPeer(holder, true);
          }
          id = wanted;
        } else if (s.phase !== 'lobby') {
          return deny('Someone is already playing from that seat.');
        }
      }

      if (id) {
        this.engine.setConnected(id, true);
        if (msg.name) this.engine.rename(id, msg.name);
        this.pushChat(null, s.players[id].name + ' is back on the trail.', 'system');
      } else {
        if (s.phase !== 'lobby') return deny('That game is already under way.');
        if (this.engine.playerCount >= 6) return deny('The party is full.');
        id = wanted && !s.players[wanted] ? wanted : peerId;
        this.engine.addPlayer(id, msg.name, false);
        this.pushChat(null, (msg.name || 'A ranger') + ' joins the party.', 'system');
      }

      this.playerOf.set(peerId, id);
      this.peerOf.set(id, peerId);
      this.pending.delete(peerId);
      this.emit('sfx', 'join');
      this.net.broadcast({ t: 'sfx', name: 'join' });
      this.broadcast();
      return;
    }

    // A ping needs no seat: it is answered for anyone still handshaking too.
    if (msg.t === 'ping') {
      this.net.send(peerId, { t: 'pong', at: msg.at });
      return;
    }
    // The reply to our own heartbeat. Noting that they spoke is the whole
    // point of it, and that is already done above.
    if (msg.t === 'pong') return;

    // Everything else has to come from a seat we know about.
    const pid = this.playerOf.get(peerId);
    if (!pid || !s.players[pid]) return;

    if (msg.t === 'chat') {
      this.pushChat(s.players[pid], String(msg.text || '').slice(0, 200), 'player');
      this.broadcast();
      return;
    }
    if (msg.t === 'rename') {
      this.engine.rename(pid, msg.name);
      this.broadcast();
      return;
    }
    if (msg.t === 'intent') {
      if (!msg.action || typeof msg.action !== 'object') return;
      const res = this.engine.handle(pid, msg.action);
      if (res && res.error) this.net.send(peerId, { t: 'reject', reason: res.error });
      else this.broadcast();
    }
  }

  pushChat(player, text, kind) {
    this.chat.push({
      id: Math.random().toString(36).slice(2),
      name: player ? player.name : null,
      colour: player ? player.colour : null,
      text,
      kind,
      t: Date.now(),
    });
    if (this.chat.length > MAX_CHAT) this.chat.shift();
  }

  broadcast() {
    for (const pid of this.engine.state.order) {
      const view = this.engine.viewFor(pid);
      view.chat = this.chat;
      view.code = this.code;
      if (pid === this.localId) {
        this.emit('view', view);
      } else {
        const peerId = this.peerOf.get(pid);
        if (peerId) this.net.send(peerId, { t: 'view', view });
      }
    }
    for (const [peerId] of this.pending) {
      const view = this.engine.viewFor(null);
      view.chat = this.chat;
      view.code = this.code;
      this.net.send(peerId, { t: 'view', view });
    }
  }

  // -- bots ----------------------------------------------------------------
  addBot() {
    if (this.engine.state.phase !== 'lobby') return { error: 'The game has already begun.' };
    if (this.engine.playerCount >= 6) return { error: 'The party is full.' };
    this.botSeq += 1;
    const taken = Object.values(this.engine.state.players).map((p) => p.name);
    const name = pickBotName(taken);
    this.engine.addPlayer('bot_' + this.botSeq, name, false, true);
    this.pushChat(null, name + ' shoulders a pack and joins in.', 'system');
    this.broadcast();
    return { ok: true };
  }

  removeBot(id) {
    const p = this.engine.state.players[id];
    if (!p || !p.isBot) return;
    this.engine.removePlayer(id);
    this.broadcast();
  }

  /**
   * A bot move per beat of the turn, each after a short pause, so a watching
   * human can follow the draft, the tile and the token as separate events.
   */
  runBot() {
    const s = this.engine.state;
    if (s.phase !== 'playing') { this.botDeadline = 0; return false; }
    const id = this.engine.currentPlayerId();
    const p = s.players[id];
    if (!p || !p.isBot) { this.botDeadline = 0; return false; }

    const key = id + ':' + s.turnNumber + ':' + s.turnPhase + ':' + (s.culledThisTurn ? 'c' : '');
    if (this.botKey !== key) {
      this.botKey = key;
      this.botDeadline = Date.now() + (s.turnPhase === 'draft' ? 700 : 450) + Math.random() * 500;
      return false;
    }
    if (Date.now() < this.botDeadline) return false;
    this.botDeadline = Infinity;

    let move = null;
    try {
      move = chooseBotMove(this.engine.viewFor(id), { skill: this.engine.settings.botSkill });
    } catch (err) {
      console.error('[bot]', err);
    }
    let res = move ? this.engine.handle(id, move) : { error: 'no move' };
    if (res && res.error) {
      // Never let a bot stall the table: fall back to the timer's own move.
      this.engine.state.turnEndsAt = 1;
      this.engine.tick();
    }
    return true;
  }

  // -- commands from the local UI -----------------------------------------
  intent(action) {
    const res = this.engine.handle(this.localId, action);
    if (res && res.error) this.emit('reject', res.error);
    else this.broadcast();
    return res;
  }

  say(text) {
    this.pushChat(this.engine.state.players[this.localId], String(text).slice(0, 200), 'player');
    this.broadcast();
  }

  setSettings(patch) {
    Object.assign(this.engine.settings, patch);
    this.broadcast();
  }

  startGame() {
    const res = this.engine.startGame();
    if (res.error) this.emit('reject', res.error);
    this.broadcast();
    return res;
  }

  /** Unstick a turn that is not going anywhere by itself. Host only. */
  forceTurn() {
    const res = this.engine.forceTurn();
    if (res.error) this.emit('reject', res.error);
    else this.broadcast();
    return res;
  }

  backToLobby() {
    this.engine.returnToLobby();
    this.broadcast();
  }

  kick(playerId) {
    if (playerId === this.localId) return;
    const p = this.engine.state.players[playerId];
    if (p && p.isBot) { this.removeBot(playerId); return; }
    const peerId = this.peerOf.get(playerId);
    if (peerId) {
      this.net.send(peerId, { t: 'denied', reason: 'The host has removed you.' });
      setTimeout(() => this.net.kick(peerId), 300);
      this.playerOf.delete(peerId);
      this.peerOf.delete(playerId);
      this.lastSeen.delete(peerId);
      this.budget.delete(peerId);
    }
    // removePlayer keeps the turn pointer on the seat that was playing, so
    // this cannot leave the game with nobody whose turn it is.
    this.engine.removePlayer(playerId);
    this.broadcast();
  }

  leave() {
    if (this.timer) clearInterval(this.timer);
    if (this.beat) clearInterval(this.beat);
    this.timer = null;
    this.beat = null;
    this.net.broadcast({ t: 'denied', reason: 'The host has closed the game.' });
    setTimeout(() => this.net.destroy(), 200);
  }
}

/**
 * A browser's own id, kept between visits. The host keys a seat by this rather
 * than by the peer id, so a guest whose connection drops mid-game can come
 * back to the board they were building instead of being told the game has
 * already started.
 */
const CLIENT_ID_KEY = 'colorado.clientId';
const makeClientId = () => 'c' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
let memoryClientId = null;

function clientId() {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id || !/^[a-z0-9]{6,40}$/.test(id)) {
      id = makeClientId();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch (err) {
    // Private mode. An id that lives as long as the page does is still worth
    // having: a fresh connection gets a fresh peer id, so without one even a
    // rejoin two seconds later would be turned away as a stranger.
    memoryClientId = memoryClientId || makeClientId();
    return memoryClientId;
  }
}

/** How hard a guest tries to get back in before giving up on the game. */
const REJOIN_TRIES = 8;

export class ClientSession extends Emitter {
  constructor(name) {
    super();
    this.isHost = false;
    this.name = name;
    this.net = new NetClient();
    this.localId = null;
    this.code = null;
    this.lastView = null;
    this.clientId = clientId();
    this.ping = null;   // milliseconds there and back, once we know
    this.pinger = null;
    this.retry = null;
    this.tries = 0;
    this.left = false;    // we walked away
    this.denied = false;  // the host showed us the door
  }

  async start(code) {
    this.code = code;
    await this.open();
  }

  /**
   * Open a channel to the room and introduce ourselves.
   *
   * Called again for every rejoin, so everything it sets up is bound to the
   * NetClient of the moment and nothing is left over from the last one.
   */
  async open() {
    await this.net.connect(this.code);
    this.net.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      switch (msg.t) {
        case 'view':
          this.lastView = msg.view;
          if (msg.view.you) this.localId = msg.view.you.id;
          this.emit('view', msg.view);
          break;
        case 'pong':
          // Smoothed, so the readout does not jump about on one slow packet.
          this.ping = this.ping === null
            ? Date.now() - msg.at
            : Math.round(this.ping * 0.6 + (Date.now() - msg.at) * 0.4);
          break;
        // The host checking we are still here. Answering the moment it
        // arrives is what keeps us alive to it even when this tab is in the
        // background and our own timers have been throttled to a crawl.
        case 'ping':   this.net.send({ t: 'pong', at: msg.at }); break;
        case 'sfx':    this.emit('sfx', msg.name); break;
        case 'reject': this.emit('reject', msg.reason); break;
        case 'denied':
          this.denied = true;   // being turned away is not something to retry
          this.emit('denied', msg.reason);
          break;
        default: break;
      }
    });
    this.net.on('close', () => this.rejoin());
    this.net.on('warn', (err) => console.warn('[client]', err));
    this.net.send({ t: 'hello', name: this.name, clientId: this.clientId });

    this.stopPinger();
    const ping = () => this.net.send({ t: 'ping', at: Date.now() });
    ping();
    this.pinger = setInterval(ping, 3000);
  }

  stopPinger() {
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
  }

  /**
   * The channel went away. Unless we left or were thrown out, try to get back
   * in: the host keeps a seat warm under our stored id, so a dropped guest
   * picks up the board they were building rather than losing the game.
   */
  rejoin() {
    if (this.left || this.denied || this.retry) return;
    this.stopPinger();
    this.tries += 1;
    if (this.tries > REJOIN_TRIES) {
      this.emit('closed');
      return;
    }
    this.emit('reconnecting', this.tries, REJOIN_TRIES);
    const wait = Math.min(6000, Math.round(600 * 1.8 ** (this.tries - 1)));
    this.retry = setTimeout(async () => {
      this.retry = null;
      if (this.left || this.denied) return;
      try { this.net.destroy(); } catch (err) { /* already gone */ }
      this.net = new NetClient();
      try {
        await this.open();
        this.tries = 0;
        this.emit('reconnected');
      } catch (err) {
        this.rejoin();
      }
    }, wait);
  }

  intent(action) { this.net.send({ t: 'intent', action }); }
  say(text) { this.net.send({ t: 'chat', text: String(text).slice(0, 200) }); }
  setSettings() { /* host only */ }
  startGame() { /* host only */ }
  addBot() { /* host only */ }
  removeBot() { /* host only */ }
  backToLobby() { /* host only */ }
  kick() { /* host only */ }
  forceTurn() { /* host only */ }
  leave() {
    this.left = true;
    this.stopPinger();
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.net.destroy();
  }
}
