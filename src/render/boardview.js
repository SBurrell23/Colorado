// Every player's environment, laid out side by side in the meadow.

import * as THREE from 'three';
import { hexToWorld, worldToHex, hexKey, parseHexKey } from '../game/hex.js';
import { makeTileTexture, makeTokenTexture, createCanvas } from './tileart.js';

export const HEX_R = 1.65;          // centre to corner
export const TILE_H = 0.34;
// The default view looks along +x, so z runs across the screen and x runs away
// into the meadow: "across" spaces boards left-to-right, "back" pushes a row
// further from the camera.
export const BOARD_GAP_ACROSS = 42;
export const BOARD_GAP_BACK = 40;

const texCache = new Map();
function tileTexture(tile) {
  const key = tile.habitats.join('/') + '|' + tile.wildlife.join('/');
  if (texCache.has(key)) return texCache.get(key);
  const t = new THREE.CanvasTexture(makeTileTexture(tile));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

const tokenTexCache = new Map();
function tokenTexture(animal) {
  if (tokenTexCache.has(animal)) return tokenTexCache.get(animal);
  const t = new THREE.CanvasTexture(makeTokenTexture(animal));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  tokenTexCache.set(animal, t);
  return t;
}

/**
 * How many boards sit in each row, back row first. Three players get a
 * triangle rather than a rank of three -- it suits a game made of hexagons,
 * and it keeps everyone the same distance from everyone else. Past that it is
 * rows of at most three, fuller rows at the back.
 */
export function boardLayout(count) {
  const n = Math.max(1, count);
  if (n <= 2) return [n];
  if (n === 3) return [1, 2];
  const rows = Math.ceil(n / 3);
  const out = [];
  let left = n;
  for (let i = 0; i < rows; i++) {
    const take = Math.ceil(left / (rows - i));
    out.push(take);
    left -= take;
  }
  return out;
}

/** Where each player's board sits in the meadow. */
export function boardOrigin(index, count) {
  const rows = boardLayout(count);
  let i = index;
  let row = 0;
  while (row < rows.length - 1 && i >= rows[row]) {
    i -= rows[row];
    row += 1;
  }
  const inRow = rows[row];
  return new THREE.Vector3(
    ((rows.length - 1) / 2 - row) * BOARD_GAP_BACK,
    0,
    (i - (inRow - 1) / 2) * BOARD_GAP_ACROSS,
  );
}

function nameSprite(text, colour) {
  const w = 512;
  const h = 128;
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.font = '700 62px Inter, "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(32,26,16,0.85)';
  ctx.lineWidth = 12;
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = colour;
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  sprite.scale.set(9.2, 2.3, 1);
  return sprite;
}

export class BoardView {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.boards = new Map();     // playerId -> { group, origin, tiles:Map, label, plate }
    this.markers = new THREE.Group();
    this.root.add(this.markers);
    this.ghost = null;
    this.time = 0;

    // Hex prism with its corners where the art expects them.
    this.hexGeo = new THREE.CylinderGeometry(HEX_R, HEX_R * 0.97, TILE_H, 6, 1, false, Math.PI / 6);
    this.tokenGeo = new THREE.CylinderGeometry(HEX_R * 0.32, HEX_R * 0.32, 0.15, 20);
    this.sideMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 0.92 });
  }

  boardFor(playerId) {
    return this.boards.get(playerId);
  }

  /** World position of a hex on a given player's board. */
  hexWorld(playerId, q, r) {
    const board = this.boards.get(playerId);
    const local = hexToWorld(q, r, HEX_R);
    const origin = board ? board.origin : new THREE.Vector3();
    return new THREE.Vector3(origin.x + local.x, 0, origin.z + local.z);
  }

  ensureBoard(player, index, count) {
    let board = this.boards.get(player.id);
    if (board) {
      board.origin.copy(boardOrigin(index, count));
      board.group.position.copy(board.origin);
      return board;
    }
    const group = new THREE.Group();
    const origin = boardOrigin(index, count);
    group.position.copy(origin);

    // A worn mat under each board so the boards read as separate places.
    const plate = new THREE.Mesh(
      new THREE.CircleGeometry(16.5, 48),
      new THREE.MeshStandardMaterial({
        color: 0xa39b70, roughness: 1, transparent: true, opacity: 0.3,
      }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = -0.32;
    plate.receiveShadow = this.quality.shadows;
    group.add(plate);

    const label = nameSprite(player.name, player.colour);
    label.position.set(-14.6, 2.6, 0);
    group.add(label);

    // Invisible sheet used to turn a mouse ray into a hex on this board.
    const pick = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 70),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    pick.rotation.x = -Math.PI / 2;
    pick.position.y = TILE_H / 2;
    pick.userData.playerId = player.id;
    group.add(pick);

    this.root.add(group);
    board = { group, origin, tiles: new Map(), label, plate, pick, colour: player.colour };
    this.boards.set(player.id, board);
    return board;
  }

  makeTileMesh(tile, rot) {
    const top = new THREE.MeshStandardMaterial({
      map: tileTexture(tile), roughness: 0.78, metalness: 0.02,
    });
    // Cylinder material order: side, top, bottom.
    const mesh = new THREE.Mesh(this.hexGeo, [this.sideMat, top, this.sideMat]);
    mesh.castShadow = this.quality.shadows;
    mesh.receiveShadow = this.quality.shadows;
    mesh.rotation.y = rot * (Math.PI / 3);
    return mesh;
  }

  makeTokenMesh(animal) {
    const face = new THREE.MeshStandardMaterial({
      map: tokenTexture(animal), roughness: 0.6, metalness: 0.05,
    });
    const edge = new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.8 });
    const mesh = new THREE.Mesh(this.tokenGeo, [edge, face, edge]);
    mesh.castShadow = this.quality.shadows;
    return mesh;
  }

  /** Reconcile every board with the view. */
  sync(view) {
    const seenPlayers = new Set();
    view.players.forEach((player, i) => {
      seenPlayers.add(player.id);
      const board = this.ensureBoard(player, i, view.players.length);
      const seen = new Set();

      for (const [k, t] of Object.entries(player.env || {})) {
        seen.add(k);
        const { q, r } = parseHexKey(k);
        const sig = t.habitats.join('/') + '|' + t.wildlife.join('/') + '|' + t.rot + '|' + (t.token || '');
        const existing = board.tiles.get(k);
        if (existing && existing.sig === sig) continue;

        if (existing) {
          board.group.remove(existing.group);
          this.dispose(existing.group);
        }
        const g = new THREE.Group();
        const local = hexToWorld(q, r, HEX_R);
        g.position.set(local.x, 0, local.z);

        const tileMesh = this.makeTileMesh(
          { habitats: t.habitats, wildlife: t.wildlife, keystone: t.keystone }, t.rot,
        );
        g.add(tileMesh);

        if (t.token) {
          const token = this.makeTokenMesh(t.token);
          token.position.y = TILE_H / 2 + 0.09;
          g.add(token);
        }
        board.group.add(g);
        board.tiles.set(k, { group: g, sig, anim: existing ? 1 : 0, hasToken: !!t.token });
      }

      for (const [k, rec] of Array.from(board.tiles.entries())) {
        if (seen.has(k)) continue;
        board.tiles.delete(k);
        board.group.remove(rec.group);
        this.dispose(rec.group);
      }
    });

    for (const [id, board] of Array.from(this.boards.entries())) {
      if (seenPlayers.has(id)) continue;
      this.root.remove(board.group);
      this.dispose(board.group);
      this.boards.delete(id);
    }
  }

  dispose(obj) {
    obj.traverse((o) => {
      if (o.geometry && o.geometry !== this.hexGeo && o.geometry !== this.tokenGeo) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m !== this.sideMat) m.dispose();
      }
    });
  }

  // -- markers -------------------------------------------------------------
  clearMarkers() {
    while (this.markers.children.length) {
      const c = this.markers.children.pop();
      this.dispose(c);
    }
  }

  /** kind: 'tile' (amber) or 'token' (green) */
  setMarkers(playerId, hexes, kind) {
    this.clearMarkers();
    if (!hexes || !hexes.length) return;
    const colour = kind === 'token' ? 0x6fc06a : 0xe8b141;
    const board = this.boards.get(playerId);
    if (!board) return;
    for (const h of hexes) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(HEX_R * 0.6, HEX_R * 0.86, 6, 1),
        new THREE.MeshBasicMaterial({
          color: colour, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
          depthWrite: false, depthTest: false, fog: false, toneMapped: false,
        }),
      );
      // RingGeometry lays its corners on 0/60/...; laying the ring flat maps
      // those straight onto the tile's corners, so it needs no spin of its own.
      ring.rotation.x = -Math.PI / 2;
      const w = this.hexWorld(playerId, h.q, h.r);
      ring.position.set(w.x, TILE_H / 2 + 0.12, w.z);
      ring.userData.hex = h;
      this.markers.add(ring);
    }
  }

  // -- ghost ---------------------------------------------------------------
  setGhost(playerId, tile, q, r, rot, valid) {
    if (!tile || q === undefined) {
      if (this.ghost) {
        this.root.remove(this.ghost);
        this.dispose(this.ghost);
        this.ghost = null;
      }
      return;
    }
    const sig = tile.habitats.join('/') + '|' + tile.wildlife.join('/') + '|' + rot + '|' + valid;
    if (!this.ghost || this.ghost.userData.sig !== sig) {
      if (this.ghost) {
        this.root.remove(this.ghost);
        this.dispose(this.ghost);
      }
      const top = new THREE.MeshBasicMaterial({
        map: tileTexture(tile), transparent: true, opacity: 0.72,
        color: valid ? 0xffffff : 0xff8d7a, depthWrite: false, toneMapped: false,
      });
      const side = new THREE.MeshBasicMaterial({
        color: valid ? 0xd9c79c : 0xc06a58, transparent: true, opacity: 0.5, depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.hexGeo, [side, top, side]);
      mesh.rotation.y = rot * (Math.PI / 3);
      const g = new THREE.Group();
      g.add(mesh);
      g.userData.sig = sig;
      this.ghost = g;
      this.root.add(g);
    }
    const w = this.hexWorld(playerId, q, r);
    this.ghost.position.set(w.x, 0.7, w.z);
  }

  // -- picking -------------------------------------------------------------
  /** Which board and hex the ray lands on, if any. */
  pick(raycaster) {
    const planes = [];
    for (const [, board] of this.boards) planes.push(board.pick);
    const hit = raycaster.intersectObjects(planes, false)[0];
    if (!hit) return null;
    const playerId = hit.object.userData.playerId;
    const board = this.boards.get(playerId);
    const local = hit.point.clone().sub(board.origin);
    const { q, r } = worldToHex(local.x, local.z, HEX_R);
    return { playerId, q, r };
  }

  /** The middle of a player's board, for the camera to settle on. */
  focusOf(playerId, env) {
    const board = this.boards.get(playerId);
    if (!board) return new THREE.Vector3();
    const keys = Object.keys(env || {});
    if (!keys.length) return board.origin.clone();
    let sx = 0;
    let sz = 0;
    for (const k of keys) {
      const { q, r } = parseHexKey(k);
      const w = hexToWorld(q, r, HEX_R);
      sx += w.x;
      sz += w.z;
    }
    return new THREE.Vector3(board.origin.x + sx / keys.length, 0, board.origin.z + sz / keys.length);
  }

  /** How far the outermost tile sits from the tableau's centre, in world units. */
  extentOf(playerId, env) {
    const centre = this.focusOf(playerId, env);
    const board = this.boards.get(playerId);
    if (!board) return HEX_R;
    let far = 0;
    for (const k of Object.keys(env || {})) {
      const { q, r } = parseHexKey(k);
      const w = hexToWorld(q, r, HEX_R);
      far = Math.max(far, Math.hypot(board.origin.x + w.x - centre.x, board.origin.z + w.z - centre.z));
    }
    return far + HEX_R;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    for (const [, board] of this.boards) {
      for (const [, rec] of board.tiles) {
        if (rec.anim < 1) {
          rec.anim = Math.min(1, rec.anim + dt * 3);
          const e = 1 - Math.pow(1 - rec.anim, 3);
          rec.group.position.y = (1 - e) * 6;
          rec.group.scale.setScalar(0.7 + 0.3 * e);
          if (rec.anim >= 1) {
            rec.group.position.y = 0;
            rec.group.scale.setScalar(1);
          }
        }
      }
    }
    const pulse = 0.55 + 0.45 * Math.sin(t * 3.4);
    for (const m of this.markers.children) {
      m.material.opacity = 0.45 + 0.4 * pulse;
      m.position.y = TILE_H / 2 + 0.12 + pulse * 0.04;
    }
    if (this.ghost) this.ghost.position.y = 0.7 + Math.sin(t * 3) * 0.07;
  }

  clear() {
    for (const [, board] of this.boards) {
      this.root.remove(board.group);
      this.dispose(board.group);
    }
    this.boards.clear();
    this.clearMarkers();
    this.setGhost(null);
  }
}

export { hexKey };
