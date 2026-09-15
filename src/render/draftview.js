// The four tile-and-token pairs on offer, drawn as an orthographic overlay
// across the bottom of the screen. Once a pair is drafted the same strip shows
// what you are holding.

import * as THREE from 'three';
import { makeTileTexture, makeTokenTexture, makeNatureTokenTexture } from './tileart.js';

const tileCache = new Map();
function tileTex(tile) {
  const key = tile.habitats.join('/') + '|' + tile.wildlife.join('/');
  if (tileCache.has(key)) return tileCache.get(key);
  const t = new THREE.CanvasTexture(makeTileTexture(tile));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  tileCache.set(key, t);
  return t;
}

const tokenCache = new Map();
function tokenTex(animal) {
  if (tokenCache.has(animal)) return tokenCache.get(animal);
  const t = new THREE.CanvasTexture(
    animal === 'nature' ? makeNatureTokenTexture() : makeTokenTexture(animal),
  );
  t.colorSpace = THREE.SRGBColorSpace;
  tokenCache.set(animal, t);
  return t;
}

// How far past each shape its halo reaches, as a multiple of that shape's own
// width. The hexagon needs more: its halo is spread around a much longer
// perimeter than the token's, so at equal settings it reads as the fainter of
// the two even though it is the bigger piece.
const GLOW_HEX = 1.4;
const GLOW_ROUND = 1.3;
const GLOW_HEX_BOOST = 1.5;

let glowTex = null;
/**
 * A halo the shape of the tile it sits behind, tinted per player. A round
 * gradient was the obvious thing and the wrong one: it bloomed well past the
 * corners and read as fog rather than as an edge.
 */
function glowTexture() {
  if (glowTex) return glowTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  // Sized so the hexagon lands exactly on the tile's own edge once the plane
  // is scaled up; the blur is all that shows beyond it.
  const r = (S / 2) / GLOW_HEX;
  ctx.filter = 'blur(' + Math.round(S * 0.032) + 'px)';
  ctx.fillStyle = '#ffffff';
  const hex = () => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 2;   // a corner straight up, as the tiles are
      const x = S / 2 + Math.cos(a) * r;
      const y = S / 2 - Math.sin(a) * r;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  // Twice over, so the band just outside the tile edge saturates instead of
  // trailing away into the blur.
  hex();
  hex();
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

let glowRoundTex = null;
/** The same halo for the animal token, which is a disc rather than a hex. */
function glowRoundTexture() {
  if (glowRoundTex) return glowRoundTex;
  const S = 192;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(' + Math.round(S * 0.045) + 'px)';
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, (S / 2) / GLOW_ROUND, 0, Math.PI * 2);
  ctx.fill();
  glowRoundTex = new THREE.CanvasTexture(c);
  return glowRoundTex;
}

function glowPlane(tex) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0,
    }),
  );
  mesh.visible = false;
  return mesh;
}

function plane(tex, tint) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.02, depthWrite: false,
      toneMapped: false, color: tint || 0xffffff,
    }),
  );
}

export class DraftView {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
    this.camera.position.z = 400;
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.width = 1;
    this.height = 1;
    this.slots = [];            // { group, tileMesh, tokenMesh, slot, cur, target }
    this.mode = 'display';
    this.hover = null;          // { slot, part }
    this.selected = { tile: null, token: null };
    // Which slots hold the pair somebody has taken but not yet laid, and whose.
    this.held = { tile: null, token: null, colour: '#ffffff', phase: null };
    this.culling = new Set();
    this.enabled = true;
    this.time = 0;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-10, -10);
    this.signature = '';
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
    this.layout();
  }

  get metrics() {
    const tile = Math.max(68, Math.min(this.width * 0.105, this.height * 0.2, 140));
    return { tile, token: tile * 0.55, gap: tile * 0.11 };
  }

  /** Pixels the strip occupies, so the HUD can keep clear of it. */
  get stripHeight() {
    const m = this.metrics;
    return m.tile + m.token + m.gap + 54;
  }

  /**
   * @param mode   kept for the signature key; the strip is always the display
   * @param slots  [{ tile, token }]
   */
  setContent(mode, slots) {
    const sigOf = (s) => (s.tile ? s.tile.habitats.join('') + s.tile.wildlife.join('') : '-')
      + ':' + (s.token || '-');
    const sig = mode + '|' + slots.map(sigOf).join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    this.mode = mode;

    // Reconcile slot by slot. Rebuilding the lot made every pair fly up from
    // the bottom of the screen each time one was replaced, which looked as
    // though the whole display had been redealt -- when in fact three of them
    // never moved and only the one just taken was refilled from the stack.
    const old = this.slots;
    const keep = new Set();
    this.slots = [];

    slots.forEach((slot, i) => {
      const prev = old[i];
      if (prev && prev.sig === sigOf(slot)) {
        keep.add(prev);
        this.slots.push(prev);
        return;
      }
      const group = new THREE.Group();
      const glow = glowPlane(glowTexture());
      glow.position.z = -1;
      group.add(glow);
      const glowToken = glowPlane(glowRoundTexture());
      glowToken.position.z = -1;
      group.add(glowToken);
      let tileMesh = null;
      let tokenMesh = null;
      if (slot.tile) {
        tileMesh = plane(tileTex(slot.tile));
        tileMesh.userData = { slot: i, part: 'tile' };
        group.add(tileMesh);
      }
      if (slot.token) {
        tokenMesh = plane(tokenTex(slot.token));
        tokenMesh.userData = { slot: i, part: 'token' };
        group.add(tokenMesh);
      }
      this.root.add(group);
      // A genuinely new pair rises into place; one that merely changed hands
      // stays where it was.
      const from = prev ? prev.cur : { x: 0, y: -this.height, lift: 0, scale: 1 };
      this.slots.push({
        group, tileMesh, tokenMesh, glow, glowToken, slot: i, sig: sigOf(slot),
        cur: { x: from.x, y: from.y, lift: from.lift, scale: from.scale },
      });
    });

    for (const s of old) {
      if (keep.has(s)) continue;
      this.root.remove(s.group);
      s.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.layout();
  }

  layout() {
    const m = this.metrics;
    const n = Math.max(1, this.slots.length);
    const spacing = Math.min(m.tile * 1.28, (this.width * 0.86) / n);
    const total = spacing * (n - 1);
    const baseY = -this.height / 2 + m.token + m.gap + m.tile * 0.5 + 26;
    this.slots.forEach((s, i) => {
      s.baseX = -total / 2 + i * spacing;
      s.baseY = baseY;
      s.m = m;
    });
  }

  setHover(hit) {
    this.hover = hit;
  }

  setSelection(sel) {
    this.selected = sel || { tile: null, token: null };
  }

  setCulling(set) {
    this.culling = set || new Set();
  }

  /**
   * @param held { tile, token, colour, phase } -- the slots a taken pair came
   *             from, so it can sit where it was rather than being blanked.
   */
  setHeld(held) {
    this.held = held || { tile: null, token: null, colour: '#ffffff', phase: null };
  }

  hitTest(clientX, clientY, rect) {
    if (!this.enabled || !this.slots.length) return null;
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [];
    for (const s of this.slots) {
      if (s.tileMesh) meshes.push(s.tileMesh);
      if (s.tokenMesh) meshes.push(s.tokenMesh);
    }
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    // Tokens sit in front of tiles, so prefer whichever is nearer the camera.
    let best = null;
    for (const h of hits) {
      const z = h.object.position.z + h.object.parent.position.z;
      if (!best || z > best.z) best = { z, data: h.object.userData };
    }
    return best ? { ...best.data } : null;
  }

  update(dt) {
    this.time += dt;
    const lerp = 1 - Math.pow(1e-8, dt);
    for (const s of this.slots) {
      const m = s.m || this.metrics;
      const hovered = this.hover && this.hover.slot === s.slot;
      const chosenTile = this.selected.tile === s.slot;
      const chosenToken = this.selected.token === s.slot;
      const culling = this.culling.has(s.slot);
      const heldTile = this.held.tile === s.slot;
      const heldToken = this.held.token === s.slot;
      const held = heldTile || heldToken;
      // A held pair rides higher than anything else and breathes, so it is
      // plain which one has been taken without the other three going away.
      const float = held ? 8 + Math.sin(this.time * 2.1) * 4 : 0;
      const lift = (held ? 34 : chosenTile || chosenToken || culling ? 26 : hovered ? 16 : 0) + float;
      const scale = held ? 1.14 : chosenTile || chosenToken ? 1.1 : hovered ? 1.06 : 1;

      s.cur.x += (s.baseX - s.cur.x) * lerp;
      s.cur.y += (s.baseY + lift - s.cur.y) * lerp;
      s.cur.scale += (scale - s.cur.scale) * lerp;
      s.group.position.set(s.cur.x, s.cur.y, held ? 30 : hovered ? 20 : 0);

      const tileSize = m.tile * s.cur.scale;
      const pulse = 0.72 + 0.24 * (0.5 + 0.5 * Math.sin(this.time * 2.6));
      if (s.glow) {
        s.glow.visible = heldTile && !!s.tileMesh;
        if (s.glow.visible) {
          s.glow.material.color.set(this.held.colour || '#ffffff');
          s.glow.material.opacity = Math.min(1, pulse * GLOW_HEX_BOOST);
          const g = tileSize * GLOW_HEX;
          s.glow.scale.set(g, g, 1);
        }
      }
      if (s.tileMesh) {
        // Once the tile is down, dim it where it lies: the animal is still in
        // hand, the tile is not.
        const laid = heldTile && this.held.phase === 'token';
        s.tileMesh.scale.set(tileSize, tileSize, 1);
        s.tileMesh.position.set(0, 0, 1);
        s.tileMesh.material.color.setHex(chosenTile ? 0xfff2d2 : 0xffffff);
        s.tileMesh.material.opacity = laid ? 0.42
          : this.selected.tile !== null && !chosenTile ? 0.62 : 1;
      }
      if (s.tokenMesh) {
        const ts = m.token * s.cur.scale;
        s.tokenMesh.scale.set(ts, ts, 1);
        s.tokenMesh.position.set(0, -(tileSize * 0.5 + m.gap + ts * 0.5) + tileSize * 0.02, 2);
        s.tokenMesh.material.color.setHex(
          culling ? 0xff9a8a : chosenToken ? 0xe6ffd8 : 0xffffff,
        );
        s.tokenMesh.material.opacity = this.selected.token !== null && !chosenToken ? 0.62 : 1;

        // The halo rides under the animal as well, so a held pair reads as one
        // thing rather than a lit tile with an unlit coin below it.
        if (s.glowToken) {
          s.glowToken.visible = heldToken;
          if (heldToken) {
            s.glowToken.material.color.set(this.held.colour || '#ffffff');
            s.glowToken.material.opacity = pulse;
            const gt = ts * GLOW_ROUND;
            s.glowToken.scale.set(gt, gt, 1);
            s.glowToken.position.set(0, s.tokenMesh.position.y, -1);
          }
        }
      } else if (s.glowToken) {
        s.glowToken.visible = false;
      }
    }
  }

  clear() {
    this.setContent('display', []);
  }
}
