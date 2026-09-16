// Headless netcode harness. Run with: node tests/net.mjs
//
// The session layer is driven through a stand-in transport, so the awkward
// cases can actually be reached: a guest whose link dies without telling
// anyone, two tabs reaching for the same seat, a peer that knocks and never
// speaks, a channel that floods. None of these are reproducible by hand and
// every one of them used to end somebody's game.

// session.js remembers a browser's own id; give it somewhere to keep it.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

const { HostSession } = await import('../src/net/session.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}

/**
 * A NetHost that goes nowhere. `alive` is the set of peers whose channel is
 * genuinely still up, which is what lets a link be killed silently -- the way
 * a real one dies when a laptop lid closes.
 */
function fakeTransport(session) {
  const sent = [];
  const net = {
    handlers: {},
    alive: new Set(),
    on(n, fn) { (this.handlers[n] = this.handlers[n] || []).push(fn); return this; },
    emit(n, ...a) { for (const fn of this.handlers[n] || []) fn(...a); },
    async start(code) { return code; },
    isOpen(peerId) { return this.alive.has(peerId); },
    send(peerId, msg) { sent.push({ peerId, msg }); },
    broadcast(msg) { for (const p of this.alive) sent.push({ peerId: p, msg }); },
    kick(peerId) { this.alive.delete(peerId); },
    destroy() { this.alive.clear(); },
  };
  session.net = net;
  return { sent, net };
}

/** Bring a guest in through the front door. */
function join(net, peerId, name, clientId) {
  net.alive.add(peerId);
  net.emit('connect', peerId);
  net.emit('message', peerId, { t: 'hello', name, clientId });
}

async function host(settings) {
  const s = new HostSession('Host', settings || {});
  const t = fakeTransport(s);
  await s.start('TEST');
  return { s, ...t };
}

const stop = (s) => { clearInterval(s.timer); clearInterval(s.beat); };
const denials = (sent, peerId) => sent
  .filter((x) => x.peerId === peerId && x.msg && x.msg.t === 'denied')
  .map((x) => x.msg.reason);

// --- a link that dies without saying so -------------------------------------
// The commonest way to lose a guest is also the quietest: no close event, the
// connection still reads as open, and the host goes on waiting for somebody
// who is not there. When they came back they were told the game had already
// started -- locked out of their own seat, in a game that was waiting on them.
console.log('\na link that dies without saying so');
{
  const { s, sent, net } = await host();
  join(net, 'peerA', 'Guest', 'guestclient1');
  s.startGame();
  const seat = s.engine.state.order.find((id) => id !== 'host');
  check('the guest has a seat', seat === 'guestclient1', String(seat));

  // The channel dies. Nothing is announced; the host still believes they are here.
  net.alive.delete('peerA');
  check('the host still thinks they are connected', s.engine.state.players[seat].connected);

  // They come back on a fresh connection, same stored id.
  sent.length = 0;
  join(net, 'peerB', 'Guest', 'guestclient1');
  check('they are let back into their own seat', denials(sent, 'peerB').length === 0,
    denials(sent, 'peerB').join('; '));
  check('and it is the seat they left', s.peerOf.get(seat) === 'peerB');
  check('no second seat was made for them', s.engine.state.order.length === 2,
    JSON.stringify(s.engine.state.order));
  check('and they count as connected again', s.engine.state.players[seat].connected);
  stop(s);
}

// --- a seat somebody is genuinely still in ----------------------------------
console.log('\na seat somebody is genuinely still in');
{
  const { s, sent, net } = await host();
  join(net, 'peerA', 'Guest', 'sharedid1');
  s.startGame();
  sent.length = 0;
  // A second tab with the same stored id, while the first is alive and well.
  net.alive.add('peerB');
  net.emit('connect', 'peerB');
  net.emit('message', 'peerB', { t: 'hello', name: 'Guest', clientId: 'sharedid1' });
  check('the second tab is turned away', denials(sent, 'peerB').length === 1,
    denials(sent, 'peerB').join('; '));
  check('and told why', /already playing/i.test(denials(sent, 'peerB')[0] || ''));
  check('the first tab keeps the seat', s.peerOf.get('sharedid1') === 'peerA');
  stop(s);
}

// --- a guest who goes quiet -------------------------------------------------
console.log('\na guest who goes quiet');
{
  const { s, net } = await host();
  join(net, 'peerA', 'Guest', 'quietone1');
  s.startGame();
  const seat = 'quietone1';
  check('they start out live', s.isLive('peerA'));
  check('and the sweep leaves them alone', s.sweep() === false);

  s.lastSeen.set('peerA', Date.now() - 30000);
  check('once they stop answering they are not live', !s.isLive('peerA'));
  check('and the sweep hangs up on them', s.sweep() === true);
  check('their seat is marked away', !s.engine.state.players[seat].connected);
  check('but the seat is still there for them', !!s.engine.state.players[seat]);
  check('and the channel is closed', !net.alive.has('peerA'));
  stop(s);
}

// --- a peer that knocks and never speaks ------------------------------------
console.log('\na peer that knocks and never speaks');
{
  const { s, net } = await host();
  net.alive.add('ghost');
  net.emit('connect', 'ghost');
  check('it is waiting in the hall', s.pending.has('ghost'));
  s.pending.set('ghost', Date.now() - 30000);
  s.lastSeen.set('ghost', Date.now() - 30000);
  s.sweep();
  check('and is eventually shown out', !s.pending.has('ghost'));
  check('without ever taking a seat', s.engine.state.order.length === 1);
  stop(s);
}

// --- a second hello down a channel that already has a seat ------------------
// This used to mint a fresh seat and forget the old one, leaving a ranger at
// the table with nobody behind them -- and the table would wait on their turn
// for as long as anybody was willing to sit there.
console.log('\na second hello on the same channel');
{
  const { s, net } = await host();
  join(net, 'peerA', 'Guest', 'firstid01');
  net.emit('message', 'peerA', { t: 'hello', name: 'Renamed', clientId: 'otherid02' });
  check('no ghost seat was left behind', s.engine.state.order.length === 2,
    JSON.stringify(s.engine.state.order));
  check('the seat they had is the seat they have', s.playerOf.get('peerA') === 'firstid01');
  check('and it is taken as a rename', s.engine.state.players.firstid01.name === 'Renamed');

  net.emit('disconnect', 'peerA');
  const left = s.engine.state.order.filter((id) => id !== 'host');
  check('and when they go, nothing of them is left connected',
    left.every((id) => !s.engine.state.players[id].connected), JSON.stringify(left));
  stop(s);
}

// --- one channel must not be able to drown the host -------------------------
console.log('\na channel that floods');
{
  const { s, net } = await host();
  join(net, 'peerA', 'Guest', 'floodid01');
  const before = s.chat.length;
  for (let i = 0; i < 500; i++) {
    net.emit('message', 'peerA', { t: 'chat', text: 'spam ' + i });
  }
  const added = s.chat.length - before;
  check('the flood is cut off', added < 200, String(added));
  check('and the game is untouched', s.engine.state.phase === 'lobby');

  // A normal rate of play is never affected by it.
  const { s: s2, net: net2 } = await host();
  join(net2, 'peerB', 'Guest', 'normalid1');
  let refused = 0;
  for (let i = 0; i < 30; i++) {
    if (s2.overBudget('peerB')) refused++;
  }
  check('ordinary play is well inside the budget', refused === 0, String(refused));
  stop(s);
  stop(s2);
}

// --- the host hanging up on somebody mid-game -------------------------------
// Removing a seat used to leave the turn pointer dangling. The host's own
// moderation button could end the game for everyone with no way back.
console.log('\nthe host removing a ranger mid-game');
{
  const { s, net } = await host();
  join(net, 'peerA', 'A', 'playerid01');
  join(net, 'peerB', 'B', 'playerid02');
  s.startGame();
  s.engine.state.turnIndex = 2;         // the last seat is up
  const onTurn = s.engine.currentPlayerId();
  s.kick('playerid01');                 // a seat ahead of the pointer goes
  check('somebody is still on turn', !!s.engine.currentPlayerId());
  check('and it is the same ranger', s.engine.currentPlayerId() === onTurn);
  check('their move is accepted', !s.engine.handle(onTurn, { t: 'draft', index: 0 }).error);
  check('nothing of the kicked ranger is left', !s.peerOf.has('playerid01')
    && !s.lastSeen.has('peerA'));
  stop(s);
}

// --- the table never waits forever ------------------------------------------
// Everything above is about one hole; this is the promise they add up to. A
// game that has begun stays playable for whoever is still at it, and reaches a
// tally, whatever happens to the people who are not.
console.log('\na game that has begun always ends');
{
  const scripts = [
    'everyone drops at once',
    'the host removes them one by one',
    'they drop and come back and drop again',
  ];
  for (const script of scripts) {
    const { s, net } = await host({ dropGraceSeconds: 1 });
    join(net, 'peerA', 'A', 'endgameid1');
    join(net, 'peerB', 'B', 'endgameid2');
    s.startGame();

    if (script === 'everyone drops at once') {
      net.emit('disconnect', 'peerA');
      net.emit('disconnect', 'peerB');
    } else if (script === 'the host removes them one by one') {
      s.kick('endgameid1');
      s.kick('endgameid2');
    } else {
      net.emit('disconnect', 'peerA');
      join(net, 'peerC', 'A', 'endgameid1');
      net.emit('disconnect', 'peerC');
      net.emit('disconnect', 'peerB');
    }

    // The host is still here and still playing. Everybody else is not, so
    // their turns have to go by on their own or the host waits forever.
    let guard = 0;
    let nobody = false;
    while (s.engine.state.phase === 'playing' && guard++ < 3000) {
      const cur = s.engine.currentPlayerId();
      if (!cur) { nobody = true; break; }
      if (cur === s.localId) {
        s.forceTurn();                       // the host taking their own turn
      } else {
        const p = s.engine.state.players[cur];
        p.offlineSince = Date.now() - 60000;      // wind the grace period on
        s.engine.state.turnStartedAt = 0;
        if (!s.engine.tick()) { nobody = true; break; }
      }
    }
    check('"' + script + '" never leaves the table with nobody on turn', !nobody);
    check('"' + script + '" still reaches a tally',
      s.engine.state.phase === 'gameEnd',
      s.engine.state.phase + ' after ' + guard);
    stop(s);
  }
}

console.log('\n' + (failures ? failures + ' FAILURES' : 'all checks passed'));
process.exit(failures ? 1 : 0);
