// Colorado -- application shell: renderer, loop, input, and the glue between
// the network session and everything on screen.

import * as THREE from 'three';

import { World, HORIZON_COLOUR } from './render/scene.js';
import { BoardView, boardOrigin } from './render/boardview.js';
import { DraftView } from './render/draftview.js';
import { BoardCamera } from './render/camera.js';
import { audio } from './audio/audio.js';
import { HostSession, ClientSession } from './net/session.js';
import { normaliseCode } from './net/net.js';
import { settings, saveSettings, qualityOf, openSettingsModal } from './ui/settings.js';
import { Hud, openHelp } from './ui/hud.js';
import { Menu, savedName } from './ui/menu.js';
import {
  $, el, toast, banner, clearBanner, setScreen, openModal, closeModal, isModalOpen,
  initTooltips, showTipAt, hideTip, moveTipTo,
} from './ui/dom.js';
import { describeHex } from './ui/hexinfo.js';
import { canPlaceTile, openTokenHexes, openHexes } from './game/board.js';
import { ANIMAL_INFO, HABITAT_INFO } from './game/tiles.js';

const app = {
  renderer: null,
  world: null,
  board: null,
  draft: null,
  cam: null,
  session: null,
  view: null,
  mode: null,            // { kind: 'nature' | 'cull', tile, token, picked:Set }
  rot: 0,
  hoverHex: null,
  watching: null,        // whose board the camera is looking at
  raycaster: new THREE.Raycaster(),
  ndc: new THREE.Vector2(),
  lastFrame: 0,
  lastRender: 0,
  fps: 0,
  fpsAccum: 0,
  fpsFrames: 0,
};

// ---------------------------------------------------------------------------
async function boot() {
  await waitForFonts();
  buildRenderer();

  app.world = new World(qualityOf());
  app.world.setShadows(settings.shadows);
  app.board = new BoardView(app.world.scene, qualityOf());
  app.draft = new DraftView();
  app.cam = new BoardCamera(new THREE.Vector3(0, 0, 0));
  app.cam.minDist = 10;
  app.cam.maxDist = 160;
  app.cam.frameBias = -2.0;     // lift the board clear of the draft strip
  menuCamera(true);
  app.cam.shouldIgnore = (e) => !!draftHit(e);
  app.cam.onClick = (e) => onWorldClick(e);

  app.hud = new Hud({
    onLeave: () => confirmLeave(),
    onChat: (text) => app.session && app.session.say(text),
    onFocusSelf: () => focusOn(app.view && app.view.you ? app.view.you.id : null, { refit: true }),
    onWatch: (id) => focusOn(id),
    onRotate: () => rotateHeld(),
    onSkipToken: () => send({ t: 'skipToken' }),
    onNatureMode: () => setMode({ kind: 'nature', tile: null, token: null }),
    onCullMode: () => setMode({ kind: 'cull', picked: new Set() }),
    onQuickCull: () => send({ t: 'cull', indices: app.view.matching }),
    onConfirmCull: () => {
      if (!app.mode || !app.mode.picked.size) return;
      send({ t: 'cull', indices: Array.from(app.mode.picked) });
    },
    onCancelMode: () => setMode(null),
    onBackToLobby: () => app.session && app.session.backToLobby(),
  });

  app.menu = new Menu({
    onHost: (name) => hostGame(name),
    onJoin: (code, name) => joinGame(code, name),
    onStart: () => app.session && app.session.startGame(),
    onLeave: () => confirmLeave(),
    onChat: (text) => app.session && app.session.say(text),
    onSetting: (k, v) => app.session && app.session.setSettings({ [k]: v }),
    onKick: (id) => app.session && app.session.kick(id),
    onAddBot: () => {
      if (!app.session) return;
      const res = app.session.addBot();
      if (res && res.error) toast(res.error, 'bad');
      else audio.play('join');
    },
    onOpenSettings: () => openSettings(),
  });

  $('#btn-settings').addEventListener('click', () => openSettings());
  initTooltips();
  bindInput();
  onResize();
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => { app.lastFrame = performance.now(); });

  setScreen('title');
  requestAnimationFrame(loop);
  openInvite();

  const loading = $('#loading');
  loading.classList.add('gone');
  setTimeout(() => loading.remove(), 800);
}

/**
 * An invite link carries the code in the query string. Fill it in, and if this
 * browser already knows whose it is, walk straight through the door.
 */
function openInvite() {
  let code = null;
  try {
    code = normaliseCode(new URLSearchParams(location.search).get('game') || '');
  } catch (err) { /* no URL API worth worrying about */ }
  if (!code) return;
  // Leave the address bar clean, so a reload does not re-join a finished game.
  try { history.replaceState(null, '', location.pathname); } catch (err) { /* ignore */ }

  const input = $('#code-input');
  if (input) input.value = code;
  const name = savedName();
  if (name.trim()) {
    joinGame(code, name.trim());
  } else {
    app.menu.setStatus('Invited to game ' + code + ' — put a name in and join.');
    const nameInput = $('#name-input');
    if (nameInput) nameInput.focus();
  }
}

function waitForFonts() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all([
    document.fonts.load('400 40px "Alfa Slab One"'),
    document.fonts.load('700 30px Inter'),
  ]).catch(() => {});
}

function buildRenderer() {
  const old = document.getElementById('gl');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  if (old) old.replaceWith(canvas);
  else document.body.prepend(canvas);

  if (app.renderer) app.renderer.dispose();
  const r = new THREE.WebGLRenderer({
    canvas, antialias: settings.antialias, alpha: false,
    powerPreference: 'high-performance', stencil: false,
  });
  r.autoClear = false;
  r.setClearColor(HORIZON_COLOUR, 1);
  r.shadowMap.enabled = settings.shadows;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 0.95;
  app.renderer = r;
  applyResolution();
}

function applyResolution() {
  const base = Math.min(window.devicePixelRatio || 1, 2);
  app.renderer.setPixelRatio(Math.max(0.4, Math.min(3, base * settings.resolution)));
  app.renderer.setSize(window.innerWidth, window.innerHeight, false);
}

// ---------------------------------------------------------------------------
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - app.lastFrame) / 1000 || 0);
  app.lastFrame = now;
  if (settings.fpsCap > 0 && now - app.lastRender < 1000 / settings.fpsCap - 1.2) return;
  const rdt = Math.min(0.1, (now - app.lastRender) / 1000 || dt);
  app.lastRender = now;

  frame(rdt);

  app.fpsAccum += rdt;
  app.fpsFrames += 1;
  if (app.fpsAccum >= 0.5) {
    app.fps = Math.round(app.fpsFrames / app.fpsAccum);
    app.fpsAccum = 0;
    app.fpsFrames = 0;
    updateFpsCounter();
  }
}

/** Advance and draw one frame. Split out so it can be driven by hand. */
function frame(dt) {
  app.world.update(dt, app.cam.camera);
  app.board.update(dt);
  app.draft.update(dt);
  syncFraming();
  app.cam.update(dt);
  if (app.hud) app.hud.updateTimer();

  const r = app.renderer;
  r.clear();
  r.render(app.world.scene, app.cam.camera);
  r.clearDepth();
  r.render(app.draft.scene, app.draft.camera);
}

let fpsNode = null;
function updateFpsCounter() {
  if (!settings.showFps) {
    if (fpsNode) { fpsNode.remove(); fpsNode = null; }
    return;
  }
  if (!fpsNode) {
    fpsNode = document.createElement('div');
    Object.assign(fpsNode.style, {
      position: 'fixed', bottom: '6px', right: '10px', zIndex: 50,
      font: '12px ui-monospace, monospace', color: 'rgba(232,198,90,0.75)',
      pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)',
    });
    document.body.appendChild(fpsNode);
  }
  // Frame rate always; the trip to the host as well when there is one to make.
  const parts = [app.fps + ' fps'];
  const s = app.session;
  if (s && !s.isHost) parts.push(s.ping === null ? '— ms' : s.ping + ' ms');
  fpsNode.textContent = parts.join('  ·  ');
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  applyResolution();
  app.cam.resize(w, h);
  app.draft.resize(w, h);
  document.documentElement.style.setProperty('--draft-h', Math.round(app.draft.stripHeight) + 'px');
  syncFraming();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const canvasRect = () => app.renderer.domElement.getBoundingClientRect();

function draftHit(e) {
  if (!app.view || app.view.phase !== 'playing') return null;
  if (!e || e.target.id !== 'gl') return null;
  if (!myTurn()) return null;
  return app.draft.hitTest(e.clientX, e.clientY, canvasRect());
}

function updateNdc(e) {
  const rect = canvasRect();
  app.ndc.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  app.raycaster.setFromCamera(app.ndc, app.cam.camera);
}

function bindInput() {
  document.addEventListener('pointerdown', (e) => {
    if (e.target.id !== 'gl') return;
    audio.init();
    const hit = draftHit(e);
    if (hit) {
      e.preventDefault();
      onDraftClick(hit);
    }
  });

  document.addEventListener('pointermove', (e) => {
    if (!app.view) return;
    const over = e.target.id === 'gl' && myTurn()
      ? app.draft.hitTest(e.clientX, e.clientY, canvasRect())
      : null;
    app.draft.setHover(over);
    boardTooltip(e, over);

    if (!over && app.view.turnPhase === 'tile' && myTurn()) {
      updateNdc(e);
      const hex = app.board.pick(app.raycaster);
      const mine = app.view.you.id;
      if (hex && hex.playerId === mine) {
        app.hoverHex = hex;
        const env = myEnv();
        const ok = canPlaceTile(env, hex.q, hex.r);
        app.board.setGhost(mine, app.view.pending.tile, hex.q, hex.r, app.rot, ok);
      } else {
        app.hoverHex = null;
        app.board.setGhost(null);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'Escape') {
      if (isModalOpen()) return;
      if (app.mode) { setMode(null); return; }
      // Changed your mind about the pair you took? Put it back.
      if (myTurn() && app.view.turnPhase === 'tile') {
        app.board.setGhost(null);
        app.hoverHex = null;
        send({ t: 'undraft' });
        return;
      }
      openSettings();
      return;
    }
    if (isModalOpen()) return;

    if (e.key === 'r' || e.key === 'R') {
      if (app.view && app.view.turnPhase === 'tile' && myTurn()) rotateHeld();
      else focusOn(app.view && app.view.you ? app.view.you.id : null, { refit: true });
      return;
    }
    if (e.key === 'h' || e.key === 'H') { openHelp(); return; }
    if (e.key === 'Enter' && app.view && app.view.phase !== 'lobby') {
      const tab = document.querySelector('#log-panel .tab[data-tab="chat"]');
      if (tab) tab.click();
      const input = $('#chat-input');
      if (input) input.focus();
      return;
    }
    if (/^[1-4]$/.test(e.key) && app.view && app.view.turnPhase === 'draft' && myTurn() && !app.mode) {
      onDraftClick({ slot: Number(e.key) - 1, part: 'tile' });
    }
  });
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
const myTurn = () => !!(app.view && app.view.phase === 'playing' && app.view.you
  && app.view.currentPlayerId === app.view.you.id);

function myEnv() {
  const me = app.view.players.find((p) => p.id === app.view.you.id);
  return me ? me.env : {};
}

function setMode(mode) {
  app.mode = mode;
  app.draft.setSelection(mode && mode.kind === 'nature'
    ? { tile: mode.tile, token: mode.token }
    : { tile: null, token: null });
  app.draft.setCulling(mode && mode.kind === 'cull' ? mode.picked : new Set());
  app.hud.setMode(mode ? { kind: mode.kind, picked: mode.picked ? mode.picked.size : 0 } : null);
}

function onDraftClick(hit) {
  if (!myTurn()) { toast('Wait for your turn.', 'bad', 1500); audio.play('error'); return; }
  const v = app.view;
  if (v.turnPhase !== 'draft') return;
  const slot = v.display[hit.slot];
  if (!slot) return;

  if (app.mode && app.mode.kind === 'cull') {
    if (!slot.token) return;
    if (app.mode.picked.has(hit.slot)) app.mode.picked.delete(hit.slot);
    else app.mode.picked.add(hit.slot);
    audio.play('click');
    setMode(app.mode);
    return;
  }

  if (app.mode && app.mode.kind === 'nature') {
    if (hit.part === 'tile') {
      if (!slot.tile) return;
      app.mode.tile = hit.slot;
    } else {
      if (!slot.token) return;
      app.mode.token = hit.slot;
    }
    audio.play('select');
    setMode(app.mode);
    if (app.mode.tile !== null && app.mode.token !== null) {
      send({ t: 'draft', tileIndex: app.mode.tile, tokenIndex: app.mode.token });
    }
    return;
  }

  if (!slot.tile) { toast('Nothing left in that slot.', 'bad'); return; }
  send({ t: 'draft', index: hit.slot });
}

function rotateHeld() {
  if (!app.view || app.view.turnPhase !== 'tile' || !myTurn()) return;
  app.rot = (app.rot + 1) % 6;
  audio.play('rotate');
  if (app.hoverHex) {
    const ok = canPlaceTile(myEnv(), app.hoverHex.q, app.hoverHex.r);
    app.board.setGhost(app.view.you.id, app.view.pending.tile, app.hoverHex.q, app.hoverHex.r, app.rot, ok);
  }
}

function onWorldClick(e) {
  const v = app.view;
  if (!v || v.phase !== 'playing') return;
  updateNdc(e);
  const hex = app.board.pick(app.raycaster);
  if (!hex) return;

  // Clicking somebody else's land just takes you over to look at it.
  if (!myTurn() || hex.playerId !== v.you.id) {
    focusOn(hex.playerId);
    return;
  }

  if (v.turnPhase === 'tile') {
    if (!canPlaceTile(myEnv(), hex.q, hex.r)) {
      toast('A tile has to touch your land.', 'bad');
      audio.play('error');
      return;
    }
    send({ t: 'placeTile', q: hex.q, r: hex.r, rot: app.rot });
    return;
  }

  if (v.turnPhase === 'token') {
    const animal = v.pending.token;
    const spots = openTokenHexes(myEnv(), animal);
    if (!spots.some((s) => s.q === hex.q && s.r === hex.r)) {
      toast('The ' + ANIMAL_INFO[animal].short + ' will not settle there.', 'bad');
      audio.play('error');
      return;
    }
    send({ t: 'placeToken', q: hex.q, r: hex.r });
  }
}

/**
 * Hovering a laid tile explains what it is doing: which corridors it is part
 * of, how the animal on it is faring, where there is still room to build. It
 * reads every player's land, not just your own.
 */
let tipHexKey = null;
function boardTooltip(e, overStrip) {
  const v = app.view;
  if (!v || v.phase !== 'playing' || e.target.id !== 'gl' || app.mode) {
    if (tipHexKey) { tipHexKey = null; hideTip(); }
    return;
  }

  // Over the strip: say what the pair on offer actually is.
  if (overStrip) {
    const held = v.turnPhase !== 'draft' && v.pending ? [v.pending] : v.display;
    const slot = held[overStrip.slot];
    if (!slot || !slot.tile) { if (tipHexKey) { tipHexKey = null; hideTip(); } return; }
    const key = 'slot:' + overStrip.slot + ':' + slot.tile.habitats.join('') + (slot.token || '');
    if (key === tipHexKey) { moveTipTo(e.clientX, e.clientY); return; }
    tipHexKey = key;
    const lines = [
      'Shows ' + slot.tile.wildlife.map((a) => ANIMAL_INFO[a].short.toLowerCase()).join(', ') + '.',
    ];
    if (slot.tile.keystone) lines.push('Keystone — settle that animal on it for a nature token.');
    if (slot.token) lines.push('Comes with ' + ANIMAL_INFO[slot.token].name.toLowerCase() + '.');
    showTipAt(e.clientX, e.clientY, null,
      slot.tile.habitats.map((h) => HABITAT_INFO[h].short).join(' / '),
      el('div', { class: 'tip-lines' }, lines.map((t) => el('div', { text: t }))));
    return;
  }
  updateNdc(e);
  const hex = app.board.pick(app.raycaster);
  // While you are holding a tile or a token, your own board belongs to the
  // ghost preview; a tooltip over the top of it would only be in the way.
  const busyHere = hex && myTurn() && v.turnPhase !== 'draft' && hex.playerId === v.you.id;
  const player = hex && !busyHere && v.players.find((p) => p.id === hex.playerId);
  const info = player && describeHex(player, hex.q, hex.r);
  if (!info) {
    if (tipHexKey) { tipHexKey = null; hideTip(); }
    return;
  }
  const key = hex.playerId + ':' + hex.q + ',' + hex.r;
  if (key === tipHexKey) {
    moveTipTo(e.clientX, e.clientY);
    return;
  }
  tipHexKey = key;
  showTipAt(e.clientX, e.clientY, null, player.name + ' · ' + info.title,
    el('div', { class: 'tip-lines' }, info.lines.map((t) => el('div', { text: t }))));
}

function send(action) {
  if (!app.session) return;
  app.session.intent(action);
  setMode(null);
}

/**
 * Keep the camera aware of how much of the frame the draft strip covers, so
 * the tableau is centred in the clear area rather than behind the tiles.
 */
// How the board view sits when you ask for it back: well up and well out.
const BOARD_VIEW_PITCH = 0.66;
const BOARD_VIEW_ZOOM = 1.32;

function syncFraming() {
  const h = Math.max(1, window.innerHeight);
  if (!app.view || app.view.phase !== 'playing') {
    app.cam.stripFraction = 0;
    return;
  }
  // On a phone the HUD panels go full width and box the view in from above and
  // below; on a wide screen they sit in the corners and only the draft strip
  // matters. Either way, work out the band of screen that is actually clear.
  const wide = (el) => el && el.getBoundingClientRect().width > window.innerWidth * 0.6;
  let top = 0;
  let bottom = h - app.draft.stripHeight;
  const panel = $('#turn-panel');
  if (wide(panel)) top = panel.getBoundingClientRect().bottom;
  const log = $('#log-panel');
  if (wide(log)) bottom = Math.min(bottom, log.getBoundingClientRect().top);

  const band = Math.max(h * 0.28, bottom - top);
  app.cam.stripFraction = Math.min(0.62, 1 - band / h);
  const vFov = (app.cam.camera.fov * Math.PI) / 180;
  const worldPerPixel = (2 * app.cam.dist * Math.tan(vFov / 2)) / h;
  // Aim at the middle of that band rather than the middle of the screen.
  app.cam.frameBias = ((top + bottom) / 2 - h / 2) * worldPerPixel;
}

/**
 * Look at a player's land.
 *
 * Going to somebody else's board only slides the camera across: whatever
 * height and angle you had chosen is yours, and having it snap back every time
 * you glanced at a neighbour was maddening. Only a deliberate "back to my
 * board" refits the framing.
 */
function focusOn(playerId, { refit = false } = {}) {
  if (!playerId || !app.view) return;
  const p = app.view.players.find((x) => x.id === playerId);
  if (!p) return;
  app.watching = playerId;
  app.hud.setWatching(playerId);
  const centre = app.board.focusOf(playerId, p.env);
  // Far enough back to hold the whole tableau with meadow to spare, looking
  // well down on it: this is the pose you want when you come back to your own
  // land to think, not a close three-quarter view of one corner of it.
  const half = app.cam.fitDistance(app.board.extentOf(playerId, p.env) + 2.6);
  const dist = Math.max(17, Math.min(64, half * BOARD_VIEW_ZOOM));
  syncFraming();
  app.cam.focusOn(centre);
  app.cam.setHome(centre, dist, BOARD_VIEW_PITCH);
  if (refit) {
    app.cam.goalDist = dist;
    app.cam.goalPitch = BOARD_VIEW_PITCH;
    app.cam.goalYaw = -Math.PI * 0.5;
  }
}

/** A low, scenic pose for the menus: meadow, trees and the range behind. */
function menuCamera(instant = false) {
  // Eye level in the meadow, tilted a shade up so the range keeps its sky.
  app.cam.frameBias = 2.2;
  app.cam.setHome(new THREE.Vector3(0, 0, -6), 62, 0.09);
  app.cam.goalTarget.set(0, 0, -6);
  app.cam.goalDist = 62;
  app.cam.goalPitch = 0.09;
  app.cam.goalYaw = -Math.PI * 0.5;
  if (instant) {
    app.cam.target.copy(app.cam.goalTarget);
    app.cam.dist = app.cam.goalDist;
    app.cam.pitch = app.cam.goalPitch;
    app.cam.yaw = app.cam.goalYaw;
  }
  app.cam.update(0);
}

// ---------------------------------------------------------------------------
// Session wiring
// ---------------------------------------------------------------------------
function attachSession(session) {
  app.session = session;
  session.on('view', (view) => onView(view));
  session.on('sfx', (name) => audio.play(name));
  session.on('reject', (reason) => {
    toast(reason, 'bad');
    audio.play('error');
    setMode(null);
  });
  session.on('error', (reason) => toast(reason, 'bad', 5000));
  session.on('denied', (reason) => {
    endSession();
    app.menu.showTitle();
    app.menu.setStatus(reason, true);
  });
  session.on('closed', () => {
    endSession();
    app.menu.showTitle();
    app.menu.setStatus('The game closed.', true);
    toast('The host closed the game.', 'bad', 5000);
  });
}

function onView(view) {
  const prev = app.view;
  app.view = view;

  if (view.phase === 'lobby') {
    app.board.clear();
    app.draft.clear();
    app.watching = null;
    menuCamera();
    app.menu.showLobby(view);
    return;
  }

  if (!prev || prev.phase === 'lobby') {
    setScreen('game');
    closeModal();
    app.board.sync(view);
    focusOn(view.you ? view.you.id : view.order[0], { refit: true });
    app.cam.resetView(true);
    app.cam.update(0);
  }

  app.board.sync(view);

  // The strip shows the four on offer, or the pair somebody is holding --
  // theirs as well as yours. Watching a ranger think is more interesting when
  // you can see the tile they are turning over.
  if (view.turnPhase !== 'draft' && view.pending) {
    app.draft.setContent('hand', [{ tile: view.pending.tile, token: view.pending.token }]);
  } else {
    app.draft.setContent('display', view.display);
  }
  app.draft.enabled = myTurn() && view.turnPhase === 'draft';
  document.documentElement.style.setProperty('--draft-h', Math.round(app.draft.stripHeight) + 'px');
  syncFraming();

  // Fresh turn: clear any half-finished choice and reset the tile's facing.
  if (!prev || prev.turnPhase !== view.turnPhase || prev.currentPlayerId !== view.currentPlayerId) {
    if (view.turnPhase !== 'draft' || !myTurn()) setMode(null);
    app.rot = 0;
    app.hoverHex = null;
    app.board.setGhost(null);
  }

  refreshMarkers();
  app.hud.update(view);

  if (prev && prev.currentPlayerId !== view.currentPlayerId && myTurn()) {
    audio.play('turn');
    banner('Your turn', false, 1300);
    focusOn(view.you.id);
  } else if (prev && prev.currentPlayerId !== view.currentPlayerId) {
    clearBanner();
  }

  if (view.phase === 'gameEnd' && (!prev || prev.phase !== 'gameEnd')) {
    banner('The season ends', false, 2600);
    app.board.clearMarkers();
    app.board.setGhost(null);
  }
}

function refreshMarkers() {
  const v = app.view;
  if (!v || !myTurn()) { app.board.clearMarkers(); return; }
  const me = v.you.id;
  if (v.turnPhase === 'tile') {
    app.board.setMarkers(me, openHexes(myEnv()), 'tile');
  } else if (v.turnPhase === 'token') {
    app.board.setMarkers(me, openTokenHexes(myEnv(), v.pending.token), 'token');
  } else {
    app.board.clearMarkers();
  }
}

async function hostGame(name) {
  audio.init();
  startAmbience();
  app.menu.setBusy(true, 'Opening a game…');
  const session = new HostSession(name, {});
  attachSession(session);
  try {
    const code = await session.start();
    app.menu.setBusy(false);
    app.menu.setStatus('');
    toast('Game ' + code + ' is open.', 'good');
  } catch (err) {
    app.session = null;
    app.menu.setBusy(false);
    app.menu.setStatus(friendlyNetError(err), true);
  }
}

async function joinGame(code, name) {
  audio.init();
  startAmbience();
  app.menu.setBusy(true, 'Looking for game ' + code + '…');
  const session = new ClientSession(name);
  attachSession(session);
  try {
    await session.start(code);
    app.menu.setBusy(false);
    app.menu.setStatus('');
  } catch (err) {
    app.session = null;
    app.menu.setBusy(false);
    app.menu.setStatus(friendlyNetError(err), true);
  }
}

function friendlyNetError(err) {
  const msg = (err && (err.message || err.type)) || String(err);
  if (/peer-unavailable|No room/i.test(msg)) return 'No game with that code is open.';
  if (/browser|webrtc/i.test(msg)) return 'This browser cannot make peer connections.';
  if (/network|server/i.test(msg)) return 'Could not reach the matchmaking server.';
  return msg;
}

function endSession() {
  if (app.session) {
    try { app.session.leave(); } catch (err) { /* already gone */ }
  }
  app.session = null;
  app.view = null;
  app.mode = null;
  app.watching = null;
  app.board.clear();
  app.draft.clear();
  menuCamera();
  closeModal();
}

function confirmLeave() {
  openModal({
    title: 'Head back down?',
    body: '<p>Leaving ends the game for you. If you are the host, it closes for everyone.</p>',
    actions: [
      { label: 'Stay' },
      { label: 'Leave', primary: true, onClick: () => { endSession(); app.menu.showTitle(); } },
    ],
  });
}

// ---------------------------------------------------------------------------
function startAmbience() {
  audio.applySettings({
    master: settings.master, sfx: settings.sfx, music: settings.music, muted: settings.muted,
  });
  audio.startMusic();
}

function openSettings() {
  openSettingsModal((changed) => {
    audio.applySettings({
      master: settings.master, sfx: settings.sfx, music: settings.music, muted: settings.muted,
    });
    if (changed === 'antialias' || changed === 'preset') rebuildRendererIfNeeded();
    applyResolution();
    app.renderer.shadowMap.enabled = settings.shadows;
    app.world.applyQuality(qualityOf());
    app.board.quality = qualityOf();
    updateFpsCounter();
    saveSettings();
  });
}

let lastAntialias = null;
function rebuildRendererIfNeeded() {
  if (lastAntialias === null) lastAntialias = settings.antialias;
  if (lastAntialias === settings.antialias) return;
  lastAntialias = settings.antialias;
  buildRenderer();
  app.renderer.shadowMap.enabled = settings.shadows;
  onResize();
}

// ---------------------------------------------------------------------------
boot().catch((err) => {
  console.error(err);
  const loading = $('#loading');
  if (loading) {
    loading.innerHTML = '<div class="loading-inner"><p style="max-width:32em;text-align:center;'
      + 'line-height:1.6;text-transform:none;letter-spacing:0">The trail washed out.<br>'
      + String(err && err.message ? err.message : err) + '</p></div>';
  }
});

app.frame = frame;
window.__co = app;
export { app, boardOrigin };
