// PeerJS transport. The host owns the truth; clients are thin terminals that
// send intents and render whatever view they are handed.

// Namespaced to this game: the public PeerJS broker is shared with the whole
// world, and a four-character code is only unique inside its own prefix.
const ID_PREFIX = 'colorado-game-';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes

const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ],
  },
};

export function randomCode(len = 4) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

export function normaliseCode(text) {
  return (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function waitForPeerLib(timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    if (window.Peer) return resolve(window.Peer);
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (window.Peer) {
        clearInterval(iv);
        resolve(window.Peer);
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(iv);
        reject(new Error('The peer library could not be loaded. Check your connection.'));
      }
    }, 60);
  });
}

class Emitter {
  constructor() { this.handlers = {}; }
  on(name, fn) {
    (this.handlers[name] = this.handlers[name] || []).push(fn);
    return this;
  }
  emit(name, ...args) {
    for (const fn of this.handlers[name] || []) {
      try { fn(...args); } catch (err) { console.error('[net]', name, err); }
    }
  }
}

export class NetHost extends Emitter {
  constructor() {
    super();
    this.peer = null;
    this.code = null;
    this.conns = new Map();   // peerId -> DataConnection
    this.open = false;
  }

  async start(preferredCode) {
    const Peer = await waitForPeerLib();
    let attempts = 0;
    for (;;) {
      const code = attempts === 0 && preferredCode ? preferredCode : randomCode();
      try {
        await this.tryOpen(Peer, code);
        this.code = code;
        return code;
      } catch (err) {
        attempts += 1;
        if (err && err.type === 'unavailable-id' && attempts < 6) continue;
        throw err;
      }
    }
  }

  tryOpen(Peer, code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(ID_PREFIX + code, PEER_OPTIONS);
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        try { peer.destroy(); } catch (e) { /* already gone */ }
        reject(err);
      };
      peer.on('open', () => {
        if (settled) return;
        settled = true;
        this.peer = peer;
        this.open = true;
        this.attach(peer);
        resolve();
      });
      peer.on('error', fail);
      setTimeout(() => fail(new Error('Timed out opening the room.')), 20000);
    });
  }

  attach(peer) {
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        this.emit('connect', conn.peer);
      });
      conn.on('data', (data) => this.emit('message', conn.peer, data));
      conn.on('close', () => {
        this.conns.delete(conn.peer);
        this.emit('disconnect', conn.peer);
      });
      conn.on('error', () => {
        this.conns.delete(conn.peer);
        this.emit('disconnect', conn.peer);
      });
    });
    peer.on('error', (err) => {
      // A failed handshake with one guest must not tear down the room.
      if (err && (err.type === 'peer-unavailable' || err.type === 'network')) {
        this.emit('warn', err);
        return;
      }
      this.emit('error', err);
    });
    peer.on('disconnected', () => {
      this.emit('warn', new Error('Lost the signalling server; trying to reconnect.'));
      try { peer.reconnect(); } catch (e) { /* nothing more to do */ }
    });
  }

  send(peerId, msg) {
    const c = this.conns.get(peerId);
    if (c && c.open) {
      try { c.send(msg); } catch (err) { console.warn('[net] send failed', err); }
    }
  }

  broadcast(msg) {
    for (const [, c] of this.conns) {
      if (c.open) {
        try { c.send(msg); } catch (err) { console.warn('[net] broadcast failed', err); }
      }
    }
  }

  kick(peerId) {
    const c = this.conns.get(peerId);
    if (c) { try { c.close(); } catch (e) { /* ignore */ } }
    this.conns.delete(peerId);
  }

  destroy() {
    for (const [, c] of this.conns) { try { c.close(); } catch (e) { /* ignore */ } }
    this.conns.clear();
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } }
    this.peer = null;
    this.open = false;
  }
}

export class NetClient extends Emitter {
  constructor() {
    super();
    this.peer = null;
    this.conn = null;
    this.code = null;
  }

  async connect(code) {
    const Peer = await waitForPeerLib();
    this.code = code;
    return new Promise((resolve, reject) => {
      const peer = new Peer(PEER_OPTIONS);
      this.peer = peer;
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        try { peer.destroy(); } catch (e) { /* ignore */ }
        reject(err);
      };

      peer.on('open', () => {
        const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        conn.on('data', (data) => this.emit('message', data));
        conn.on('close', () => this.emit('close'));
        conn.on('error', (err) => fail(err));
        setTimeout(() => {
          if (!settled) fail(new Error('No room answered that code.'));
        }, 20000);
      });

      peer.on('error', (err) => {
        if (err && err.type === 'peer-unavailable') {
          fail(new Error('No room with that code is open.'));
        } else if (!settled) {
          fail(err);
        } else {
          this.emit('warn', err);
        }
      });
      peer.on('disconnected', () => {
        try { peer.reconnect(); } catch (e) { /* ignore */ }
      });
    });
  }

  send(msg) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(msg); } catch (err) { console.warn('[net] send failed', err); }
    }
  }

  destroy() {
    if (this.conn) { try { this.conn.close(); } catch (e) { /* ignore */ } }
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } }
    this.conn = null;
    this.peer = null;
  }
}
