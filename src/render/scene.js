// The world the boards sit in: a high meadow under the Front Range.
//
// The mountains are painted into the sky panorama rather than built as
// geometry. Real peaks out at the horizon would show hard silhouette edges the
// fog cannot hide, and would need shifting every time the camera moved.

import * as THREE from 'three';
import { createCanvas } from './tileart.js';

export const HORIZON_COLOUR = 0xc9d8e6;

function canvasTexture(canvas, repeat, wrap = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.repeat.set(repeat, repeat);
  }
  t.anisotropy = 8;
  return t;
}

/** A 360-degree panorama: sky above, three ranges of peaks along the horizon. */
function makeSkyPanorama(w = 2048, h = 1024) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const horizon = h * 0.5;

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.00, '#1f4f86');
  g.addColorStop(0.18, '#3f78ac');
  g.addColorStop(0.32, '#7aa8ce');
  g.addColorStop(0.42, '#aecbe1');
  // No flat step anywhere near the horizon: the last stretch eases into the
  // fog colour so there is no band where the haze stops and the sky starts.
  g.addColorStop(0.50, '#c9d8e6');   // pinned to the scene fog colour
  g.addColorStop(1.00, '#c9d8e6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // High thin cloud.
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * w;
    const y = h * (0.06 + Math.random() * 0.26);
    const rw = w * (0.03 + Math.random() * 0.09);
    const rh = h * (0.008 + Math.random() * 0.016);
    const cg = ctx.createRadialGradient(x, y, 0, x, y, rw);
    cg.addColorStop(0, 'rgba(255,255,255,0.75)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cg;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, rh / rw);
    ctx.beginPath();
    ctx.arc(0, 0, rw, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Three ranges, farthest and haziest first. They are kept low deliberately:
  // the board camera looks down, so only a few degrees of sky are ever in
  // frame, and a taller range just gets its summits sliced off by the top of
  // the screen. At these heights the whole skyline fits.
  const ranges = [
    { top: 0.434, colour: '#9db3c8', jag: 0.016, step: 0.055, haze: 0.55 },
    { top: 0.449, colour: '#8398b1', jag: 0.020, step: 0.042, haze: 0.34 },
    { top: 0.464, colour: '#66798f', jag: 0.015, step: 0.031, haze: 0.16 },
  ];
  for (const range of ranges) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    let x = 0;
    let prev = h * range.top;
    while (x <= w) {
      const next = h * range.top + (Math.random() - 0.4) * h * range.jag;
      const midX = x + w * range.step * 0.5;
      ctx.lineTo(midX, Math.min(prev, next) - h * 0.004);
      x += w * range.step;
      ctx.lineTo(x, next);
      prev = next;
    }
    ctx.lineTo(w, horizon);
    ctx.closePath();
    ctx.fillStyle = range.colour;
    ctx.fill();

    // Snow on the tops of the nearest two.
    if (range.haze < 0.4) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(250,253,255,0.85)';
      let sx = 0;
      while (sx <= w) {
        const peak = h * range.top + (Math.random() - 0.4) * h * range.jag;
        ctx.beginPath();
        ctx.moveTo(sx, peak + h * 0.016);
        ctx.lineTo(sx + w * range.step * 0.5, peak - h * 0.006);
        ctx.lineTo(sx + w * range.step, peak + h * 0.016);
        ctx.lineTo(sx + w * range.step * 0.7, peak + h * 0.011);
        ctx.lineTo(sx + w * range.step * 0.5, peak + h * 0.019);
        ctx.lineTo(sx + w * range.step * 0.3, peak + h * 0.01);
        ctx.closePath();
        ctx.fill();
        sx += w * range.step;
      }
      ctx.restore();
    }

    // Haze pooling at the foot of the range.
    const hz = ctx.createLinearGradient(0, h * range.top, 0, horizon);
    hz.addColorStop(0, 'rgba(201,216,230,0)');
    hz.addColorStop(1, 'rgba(201,216,230,' + (0.55 + range.haze) + ')');
    ctx.fillStyle = hz;
    ctx.fillRect(0, h * range.top, w, horizon - h * range.top);
    ctx.restore();
  }

  // One last band of haze right along the horizon, unbroken all the way round.
  // Without it the skyline meets the fogged ground on a hard line; with it the
  // two dissolve into each other whichever way the camera is pointing.
  const rim = ctx.createLinearGradient(0, h * 0.438, 0, h * 0.512);
  rim.addColorStop(0.00, 'rgba(201,216,230,0)');
  rim.addColorStop(0.55, 'rgba(201,216,230,0.72)');
  rim.addColorStop(1.00, 'rgba(201,216,230,1)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, h * 0.438, w, h * 0.075);

  return c;
}

/** Dry meadow: bunch grass, scrub and bare earth. */
function makeGroundTexture(size = 1024) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9aa063';
  ctx.fillRect(0, 0, size, size);

  const blob = (x, y, r, colour, alpha) => {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const px = x + ox * size;
        const py = y + oy * size;
        if (px < -r || px > size + r || py < -r || py > size + r) continue;
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, colour.replace('$a', alpha));
        g.addColorStop(1, colour.replace('$a', '0'));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  for (let i = 0; i < 150; i++) {
    blob(Math.random() * size, Math.random() * size, size * (0.02 + Math.random() * 0.09),
      'rgba(122,132,74,$a)', (0.2 + Math.random() * 0.4).toFixed(2));
  }
  for (let i = 0; i < 120; i++) {
    blob(Math.random() * size, Math.random() * size, size * (0.015 + Math.random() * 0.06),
      'rgba(177,166,116,$a)', (0.2 + Math.random() * 0.4).toFixed(2));
  }
  for (let i = 0; i < 60; i++) {
    blob(Math.random() * size, Math.random() * size, size * (0.01 + Math.random() * 0.035),
      'rgba(139,113,80,$a)', (0.2 + Math.random() * 0.35).toFixed(2));
  }
  ctx.strokeStyle = 'rgba(86,94,52,0.35)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 7, y - 3 - Math.random() * 6);
    ctx.stroke();
  }
  return c;
}

export class World {
  constructor(quality) {
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(HORIZON_COLOUR);
    this.scene.fog = new THREE.Fog(HORIZON_COLOUR, 34, quality.fogFar || 360);
    this.time = 0;
    this.trees = null;
    this.treeParts = null;
    this.litter = null;
    this.litterParts = null;
    this.clouds = [];

    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildTrees();
    this.buildClouds();
  }

  buildSky() {
    const tex = canvasTexture(makeSkyPanorama());
    // toneMapped:false so the painted horizon lands on exactly the fog colour;
    // three.js applies fog after tone mapping, so anything else leaves a seam.
    const mat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(700, 48, 32), mat);
    this.scene.add(this.sky);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xeaf2ff, 0x8a8256, 0.85);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d2, 1.5);
    this.sun.position.set(48, 70, 38);
    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.fill = new THREE.DirectionalLight(0xbfd4ef, 0.35);
    this.fill.position.set(-50, 30, -30);
    this.scene.add(this.fill);
  }

  setShadows(enabled) {
    this.sun.castShadow = enabled;
    if (enabled) {
      this.sun.shadow.mapSize.set(2048, 2048);
      const c = this.sun.shadow.camera;
      c.near = 20;
      c.far = 240;
      c.left = -70; c.right = 70; c.top = 70; c.bottom = -70;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.03;
      c.updateProjectionMatrix();
    }
  }

  buildGround() {
    const tex = canvasTexture(makeGroundTexture(1024), 60);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, color: 0xcfd2b8 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.4;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  /**
   * Pines and aspens ringing the meadow, well clear of where boards go.
   *
   * Everything is instanced -- three draw calls for the whole forest however
   * many trees there are -- so density is nearly free and the count can run
   * into the thousands without touching the frame budget.
   */
  buildTrees() {
    this.disposeTrees();
    const count = Math.round(this.quality.treeCount);
    if (!count) return;

    // The clearing has to hold six boards side by side, so it is an ellipse
    // rather than a circle: wider across than it is deep.
    const CLEAR_X = 78;
    const CLEAR_Z = 60;
    const FAR = 620;   // runs well past the fog, so the tree line dissolves

    const pines = [];
    const aspens = [];
    let guard = 0;
    while (pines.length + aspens.length < count && guard < count * 40) {
      guard++;
      const a = Math.random() * Math.PI * 2;
      // Square-root radius spreads trees evenly by area; the extra power pulls
      // the crowd in towards the tree line where it is actually seen.
      const t = Math.pow(Math.random(), 2.1);
      const ring = 1 + t * (FAR / CLEAR_X - 1);
      const x = Math.cos(a) * CLEAR_X * ring + (Math.random() - 0.5) * 9;
      const z = Math.sin(a) * CLEAR_Z * ring + (Math.random() - 0.5) * 9;
      if (Math.abs(x) < CLEAR_X * 0.94 && Math.abs(z) < CLEAR_Z * 0.94) continue;
      const s = 2.1 + Math.pow(Math.random(), 1.4) * 3.9;
      const rot = Math.random() * Math.PI * 2;
      (Math.random() < 0.22 ? aspens : pines).push({ x, z, s, rot });
    }

    const group = new THREE.Group();
    const dummy = new THREE.Object3D();
    const colour = new THREE.Color();

    const pineGeo = new THREE.ConeGeometry(1, 3.2, 7);
    const aspenGeo = new THREE.SphereGeometry(1, 7, 5);
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 5);
    const litMat = () => new THREE.MeshLambertMaterial({ vertexColors: false });

    const TIERS = 3;
    const pineMesh = new THREE.InstancedMesh(pineGeo, litMat(), pines.length * TIERS);
    const aspenMesh = new THREE.InstancedMesh(aspenGeo, litMat(), aspens.length);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, litMat(), pines.length + aspens.length);

    const PINE_GREENS = [0x2b4a31, 0x35593a, 0x213d2a, 0x3d6542];
    const ASPEN_GOLDS = [0xd8b73f, 0xe8c95a, 0xc9a33a];

    let pi = 0;
    let ti = 0;
    const setTrunk = (tree, height, radius, hex) => {
      dummy.position.set(tree.x, height / 2 - 0.4, tree.z);
      dummy.rotation.set(0, tree.rot, 0);
      dummy.scale.set(radius, height, radius);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(ti, dummy.matrix);
      trunkMesh.setColorAt(ti, colour.setHex(hex));
      ti++;
    };

    for (const tree of pines) {
      setTrunk(tree, tree.s * 1.1, tree.s * 0.42, 0x4d3a26);
      for (let tier = 0; tier < TIERS; tier++) {
        const ts = tree.s * (1 - tier * 0.22);
        dummy.position.set(tree.x, tree.s * 0.9 + tier * tree.s * 0.95 - 0.4, tree.z);
        dummy.rotation.set(0, tree.rot + tier * 0.4, 0);
        dummy.scale.set(ts * 0.62, ts, ts * 0.62);
        dummy.updateMatrix();
        pineMesh.setMatrixAt(pi, dummy.matrix);
        pineMesh.setColorAt(pi, colour.setHex(PINE_GREENS[(pi + tier) % PINE_GREENS.length]));
        pi++;
      }
    }

    aspens.forEach((tree, i) => {
      setTrunk(tree, tree.s * 1.5, tree.s * 0.3, 0xd9d2c0);
      dummy.position.set(tree.x, tree.s * 1.9 - 0.4, tree.z);
      dummy.rotation.set(0, tree.rot, 0);
      dummy.scale.set(tree.s * 0.78, tree.s * 1.15, tree.s * 0.78);
      dummy.updateMatrix();
      aspenMesh.setMatrixAt(i, dummy.matrix);
      aspenMesh.setColorAt(i, colour.setHex(ASPEN_GOLDS[i % ASPEN_GOLDS.length]));
    });

    for (const m of [pineMesh, aspenMesh, trunkMesh]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      // The forest never moves, so let three.js skip its per-frame culling
      // maths and keep it permanently in view.
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      if (m.count) group.add(m);
    }
    this.trees = group;
    this.treeParts = [pineMesh, aspenMesh, trunkMesh];
    this.scene.add(group);
    this.buildLitter();
  }

  /**
   * Rocks, deadfall and low scrub over the meadow floor, so the ground is not
   * a bare sheet of green. Instanced like the forest, and kept off every place
   * a board mat could land -- board origins always sit on a lattice of
   * multiples of BOARD_BACK/BOARD_ACROSS, so a single radius test clears the
   * lot whatever the player count turns out to be.
   */
  buildLitter() {
    this.disposeLitter();
    const count = Math.round(this.quality.treeCount * 0.55);
    if (!count) return;

    // Every possible board centre, for any layout from one player to nine.
    const seats = [];
    for (const x of [-40, -20, 0, 20, 40]) {
      for (const z of [-42, -21, 0, 21, 42]) seats.push([x, z]);
    }
    const onAMat = (x, z) => seats.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 19.5);

    const rocks = [];
    const shrubs = [];
    const sticks = [];
    let guard = 0;
    while (rocks.length + shrubs.length + sticks.length < count && guard < count * 25) {
      guard++;
      const a = Math.random() * Math.PI * 2;
      const rad = 14 + Math.pow(Math.random(), 0.75) * 300;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad * 0.92;
      if (onAMat(x, z)) continue;
      const item = { x, z, rot: Math.random() * Math.PI * 2, s: 0.5 + Math.random() * Math.random() * 2.4 };
      const roll = Math.random();
      (roll < 0.42 ? shrubs : roll < 0.76 ? rocks : sticks).push(item);
    }

    const group = new THREE.Group();
    const dummy = new THREE.Object3D();
    const colour = new THREE.Color();
    const mat = () => new THREE.MeshLambertMaterial({});

    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat(), rocks.length);
    const shrubMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat(), shrubs.length);
    const stickMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.13, 1, 5), mat(), sticks.length);

    const ROCK = [0x8d8b7e, 0x76766c, 0x9c9587, 0x6d6a60];
    const SCRUB = [0x5f7a45, 0x6e8a4e, 0x4e6a3c, 0x83924f];
    const WOOD = [0x6b5539, 0x7d6544, 0x554129];

    rocks.forEach((it, i) => {
      dummy.position.set(it.x, it.s * 0.24 - 0.42, it.z);
      dummy.rotation.set(Math.random() * 0.5, it.rot, Math.random() * 0.5);
      dummy.scale.set(it.s * 0.9, it.s * 0.55, it.s);
      dummy.updateMatrix();
      rockMesh.setMatrixAt(i, dummy.matrix);
      rockMesh.setColorAt(i, colour.setHex(ROCK[i % ROCK.length]));
    });

    shrubs.forEach((it, i) => {
      dummy.position.set(it.x, it.s * 0.34 - 0.42, it.z);
      dummy.rotation.set(0, it.rot, 0);
      dummy.scale.set(it.s * 0.95, it.s * 0.62, it.s * 0.95);
      dummy.updateMatrix();
      shrubMesh.setMatrixAt(i, dummy.matrix);
      shrubMesh.setColorAt(i, colour.setHex(SCRUB[i % SCRUB.length]));
    });

    sticks.forEach((it, i) => {
      // Lying flat, tipped a little so they do not look laid out in a row.
      dummy.position.set(it.x, 0.06 - 0.42 + it.s * 0.05, it.z);
      dummy.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 0.25, it.rot, 0);
      dummy.scale.set(it.s * 0.5, it.s * 2.4, it.s * 0.5);
      dummy.updateMatrix();
      stickMesh.setMatrixAt(i, dummy.matrix);
      stickMesh.setColorAt(i, colour.setHex(WOOD[i % WOOD.length]));
    });

    this.litterParts = [rockMesh, shrubMesh, stickMesh];
    for (const m of this.litterParts) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      if (m.count) group.add(m);
    }
    this.litter = group;
    this.scene.add(group);
  }

  disposeLitter() {
    if (!this.litter) return;
    this.scene.remove(this.litter);
    for (const m of this.litterParts || []) {
      m.geometry.dispose();
      m.material.dispose();
      m.dispose();
    }
    this.litter = null;
    this.litterParts = null;
  }

  disposeTrees() {
    this.disposeLitter();
    if (!this.trees) return;
    this.scene.remove(this.trees);
    for (const m of this.treeParts || []) {
      m.geometry.dispose();
      m.material.dispose();
      m.dispose();
    }
    this.trees = null;
    this.treeParts = null;
  }

  buildClouds() {
    for (const c of this.clouds) this.scene.remove(c);
    this.clouds = [];
    if (!this.quality.clouds) return;
    const map = canvasTexture(makePuff(256));
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map, transparent: true, depthWrite: false, opacity: 0.28 + Math.random() * 0.3,
      }));
      const a = Math.random() * Math.PI * 2;
      const ring = 150 + Math.random() * 220;
      s.position.set(Math.cos(a) * ring, 70 + Math.random() * 50, Math.sin(a) * ring);
      const sc = 55 + Math.random() * 80;
      s.scale.set(sc, sc * 0.42, 1);
      s.userData.drift = 0.5 + Math.random();
      this.clouds.push(s);
      this.scene.add(s);
    }
  }

  applyQuality(quality) {
    this.quality = quality;
    this.buildTrees();
    this.buildClouds();
    this.setShadows(quality.shadows);
    this.scene.fog.far = quality.fogFar || 360;
  }

  update(dt, camera) {
    this.time += dt;
    // The sky rides with the camera, which keeps the painted horizon exactly on
    // the fog line however far the view roams.
    if (camera) this.sky.position.copy(camera.position);
    for (const c of this.clouds) {
      c.position.x += c.userData.drift * dt * 0.8;
      if (c.position.x > 380) c.position.x = -380;
    }
  }
}

function makePuff(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 12; i++) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.4;
    const y = size / 2 + (Math.random() - 0.5) * size * 0.22;
    const r = size * (0.1 + Math.random() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Guarantee zero alpha at the quad's edge so a near cloud shows no border.
  ctx.globalCompositeOperation = 'destination-out';
  const cut = ctx.createRadialGradient(size / 2, size / 2, size * 0.34, size / 2, size / 2, size * 0.5);
  cut.addColorStop(0, 'rgba(0,0,0,0)');
  cut.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = cut;
  ctx.fillRect(0, 0, size, size);
  return c;
}
