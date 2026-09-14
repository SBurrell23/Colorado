// Free-roaming board camera: drag the clouds to pan, right-drag to orbit,
// wheel to close in. Nothing is locked to a fixed viewpoint.

import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class BoardCamera {
  constructor(target) {
    // A 0.1 near plane against a 1200 far plane throws away most of the depth
    // buffer's precision on the first metre of nothing. The camera never gets
    // within ten units of the boards and the sky sphere is 700 out, so this
    // range costs nothing and is worth a hundredfold in precision.
    this.camera = new THREE.PerspectiveCamera(56, 1, 0.5, 1000);

    this.target = target.clone();
    this.goalTarget = target.clone();
    this.home = target.clone();
    this.homeDist = 40;
    this.homePitch = 0.6;

    this.dist = 30;
    this.goalDist = 30;
    // The hand covers the bottom of the screen, so the camera aims a little
    // below its focus point: that lifts the board into the clear upper area.
    this.frameBias = -3.2;
    this.yaw = -Math.PI * 0.5;      // looking east along the bridge
    this.goalYaw = this.yaw;
    this.pitch = 0.62;
    this.goalPitch = 0.62;

    this.minDist = 6;
    this.maxDist = 90;
    this.minPitch = 0.05;
    this.maxPitch = 1.44;

    this.keys = new Set();
    this.pointers = new Map();
    this.mode = null;
    this.moved = 0;
    this.downAt = 0;
    this.enabled = true;
    this.onClick = () => {};
    this.onHover = () => {};
    // Lets the hand UI claim a pointer before the camera starts dragging.
    this.shouldIgnore = () => false;
    this.pinchDist = 0;
    this.stripFraction = 0.3;   // share of the frame the draft strip eats

    this.bind();
    this.update(0);
  }

  bind() {
    // Listeners live on the document so that swapping the canvas (which an
    // anti-aliasing change requires) never orphans them. Only strokes that
    // begin on the canvas itself drive the camera; UI panels sit on top.
    const onCanvas = (e) => e.target && e.target.id === 'gl';
    document.addEventListener('pointerdown', (e) => { if (onCanvas(e)) this.onDown(e); });
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    document.addEventListener('wheel', (e) => { if (onCanvas(e)) this.onWheel(e); }, { passive: false });
    document.addEventListener('contextmenu', (e) => { if (onCanvas(e)) e.preventDefault(); });
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onDown(e) {
    if (!this.enabled) return;
    if (this.shouldIgnore(e)) { this.mode = null; this.last = null; return; }
    if (e.target.setPointerCapture) {
      try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.moved = 0;
    this.downAt = performance.now();
    this.mode = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'orbit' : 'pan';
    this.last = { x: e.clientX, y: e.clientY };
    if (this.pointers.size === 2) {
      const [a, b] = Array.from(this.pointers.values());
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.mode = 'pinch';
    }
  }

  onMove(e) {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    this.onHover(e);
    if (!this.enabled || !this.last || !this.mode) return;

    if (this.mode === 'pinch' && this.pointers.size === 2) {
      const [a, b] = Array.from(this.pointers.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist) this.goalDist = clamp(this.goalDist * (this.pinchDist / d), this.minDist, this.maxDist);
      this.pinchDist = d;
      return;
    }

    const dx = e.clientX - this.last.x;
    const dy = e.clientY - this.last.y;
    this.last = { x: e.clientX, y: e.clientY };
    this.moved += Math.abs(dx) + Math.abs(dy);

    if (this.mode === 'orbit') {
      this.goalYaw -= dx * 0.005;
      this.goalPitch = clamp(this.goalPitch + dy * 0.004, this.minPitch, this.maxPitch);
    } else {
      const speed = this.dist * 0.0016;
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.goalTarget.addScaledVector(right, -dx * speed);
      this.goalTarget.addScaledVector(fwd, -dy * speed);
      this.clampTarget();
    }
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (!this.mode) return;
    const quick = performance.now() - this.downAt < 450;
    if (this.mode === 'pan' && this.moved < 6 && quick) this.onClick(e);
    this.mode = this.pointers.size ? this.mode : null;
    if (!this.pointers.size) this.last = null;
  }

  onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.goalDist = clamp(this.goalDist * Math.pow(1.0016, step), this.minDist, this.maxDist);
  }

  clampTarget() {
    this.goalTarget.x = clamp(this.goalTarget.x, -130, 130);
    this.goalTarget.z = clamp(this.goalTarget.z, -110, 110);
    this.goalTarget.y = 0;
  }

  /** Remember where "reset view" should send us, and how far back to sit. */
  setHome(v, dist, pitch) {
    this.home.copy(v);
    if (dist != null) this.homeDist = dist;
    if (pitch != null) this.homePitch = pitch;
  }

  resetView(instant = false) {
    this.goalTarget.copy(this.home);
    this.goalDist = this.homeDist || 40;
    this.goalYaw = -Math.PI * 0.5;
    this.goalPitch = this.homePitch || 0.6;
    if (instant) {
      this.target.copy(this.goalTarget);
      this.dist = this.goalDist;
      this.yaw = this.goalYaw;
      this.pitch = this.goalPitch;
    }
  }

  focusOn(v) {
    this.goalTarget.set(v.x, 0, v.z);
    this.clampTarget();
  }

  /**
   * Distance at which a sphere of `radius` fills the frame, allowing for the
   * draft strip along the bottom and for portrait windows where width binds.
   */
  fitDistance(radius) {
    const vFov = (this.camera.fov * Math.PI) / 180;
    const usable = Math.max(0.42, 1 - this.stripFraction);
    const byHeight = radius / Math.tan((vFov * usable) / 2);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const byWidth = radius / Math.tan(hFov / 2);
    return Math.max(byHeight, byWidth);
  }

  resize(w, h) {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    // Keyboard nudges.
    const k = this.keys;
    const pan = this.dist * 0.9 * dt;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (k.has('KeyW') || k.has('ArrowUp')) this.goalTarget.addScaledVector(fwd, -pan);
    if (k.has('KeyS') || k.has('ArrowDown')) this.goalTarget.addScaledVector(fwd, pan);
    if (k.has('KeyA') || k.has('ArrowLeft')) this.goalTarget.addScaledVector(right, -pan);
    if (k.has('KeyD') || k.has('ArrowRight')) this.goalTarget.addScaledVector(right, pan);
    if (k.has('KeyQ')) this.goalYaw += dt * 1.1;
    if (k.has('KeyE')) this.goalYaw -= dt * 1.1;
    if (k.has('Equal') || k.has('NumpadAdd')) this.goalDist = clamp(this.goalDist * (1 - dt), this.minDist, this.maxDist);
    if (k.has('Minus') || k.has('NumpadSubtract')) this.goalDist = clamp(this.goalDist * (1 + dt), this.minDist, this.maxDist);
    if (k.size) this.clampTarget();

    const s = 1 - Math.pow(0.0015, dt);
    this.target.lerp(this.goalTarget, s);
    this.dist += (this.goalDist - this.dist) * s;
    this.yaw += (this.goalYaw - this.yaw) * s;
    this.pitch += (this.goalPitch - this.pitch) * s;

    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target.x, this.target.y + this.frameBias, this.target.z);
  }
}
