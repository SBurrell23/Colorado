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
    this.timer = null;
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

    this.net.on('connect', (peerId) => this.pending.set(peerId, Date.now()));
    this.net.on('message', (peerId, msg) => this.onMessage(peerId, msg));
    this.net.on('disconnect', (peerId) => {
      const pid = this.playerOf.get(peerId);
      this.playerOf.delete(peerId);
      if (pid && this.peerOf.get(pid) === peerId) this.peerOf.delete(pid);
      const p = pid && this.engine.state.players[pid];
      if (p) {
        this.pushChat(null, p.name + ' has left the trail.', 'system');
        // Mid-game their seat is kept warm; they can come back to it.
        this.engine.setConnected(pid, false);
      }
      this.pending.delete(peerId);
      this.emit('sfx', 'leave');
      this.net.broadcast({ t: 'sfx', name: 'leave' });
      this.broadcast();
    });
    this.net.on('error', (err) => this.emit('error', err.message || String(err)));
    this.net.on('warn', (err) => console.warn('[host]', err));

    this.timer = setInterval(() => {
      let changed = this.engine.tick();
      if (this.runBot()) changed = true;
      if (changed) this.broadcast();
    }, 250);

    this.broadcast();
    return this.code;
  }

  onMessage(peerId, msg) {
    if (!msg || typeof msg !== 'object') return;
    const s = this.engine.state;

    if (msg.t === 'hello') {
      const deny = (reason) => {
        this.net.send(peerId, { t: 'denied', reason });
        setTimeout(() => this.net.kick(peerId), 500);
      };
      const wanted = typeof msg.clientId === 'string' && /^[a-z0-9]{6,40}$/.test(msg.clientId)
        ? msg.clientId : null;

      // Returning to a seat you already hold, unless somebody is still sitting
      // in it -- two tabs with the same stored id must not fight over one.
      let id = null;
      if (wanted && s.players[wanted] && !s.players[wanted].isBot && !s.players[wanted].connected) {
        id = wanted;
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
    }
    this.engine.removePlayer(playerId);
    this.broadcast();
  }

  leave() {
    if (this.timer) clearInterval(this.timer);
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
function clientId() {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id || !/^[a-z0-9]{6,40}$/.test(id)) {
      id = 'c' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch (err) {
    return null;   // private mode: fall back to a peer-keyed seat
  }
}

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
  }

  async start(code) {
    await this.net.connect(code);
    this.code = code;
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
        case 'sfx':    this.emit('sfx', msg.name); break;
        case 'reject': this.emit('reject', msg.reason); break;
        case 'denied': this.emit('denied', msg.reason); break;
        default: break;
      }
    });
    this.net.on('close', () => this.emit('closed'));
    this.net.on('warn', (err) => console.warn('[client]', err));
    this.net.send({ t: 'hello', name: this.name, clientId: this.clientId });

    const ping = () => this.net.send({ t: 'ping', at: Date.now() });
    ping();
    this.pinger = setInterval(ping, 3000);
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
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
    this.net.destroy();
  }
}
