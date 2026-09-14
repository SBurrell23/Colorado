// The five Colorado animals, drawn as poster-style silhouettes.
//
// These end up roughly 50 device pixels across on a hex tile, so everything
// here is mass and outline: one bold shape per animal, built around the single
// feature that names it -- the ram's curl, the bull's rack, the trout's fork,
// the eagle's spread, the coyote's howl. No hairlines, no interior detail.
//
// Contract: the context arrives already translated so (0,0) is the badge
// centre. Everything stays inside radius R and is expressed as a multiple of
// it. `line` is the deep colour and carries the silhouette; `fill` is the
// lighter colour and appears only as small accents -- an eye, a muzzle, a
// throat patch.

const TAU = Math.PI * 2;
const RAD = (d) => (d * Math.PI) / 180;

/**
 * Trace a closed run of points. A 2-long entry is a move/line, a 4-long entry
 * is a quadratic (control point, then end point). The first entry is always a
 * move.
 */
function poly(ctx, pts) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) ctx.moveTo(p[0], p[1]);
    else if (p.length === 4) ctx.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
}

/** Fill a closed run of points given in units of R. */
function fillPoly(ctx, R, pts) {
  poly(ctx, pts.map((p) => p.map((v) => v * R)));
  ctx.fill();
}

function dot(ctx, R, x, y, r) {
  ctx.beginPath();
  ctx.arc(x * R, y * R, r * R, 0, TAU);
  ctx.fill();
}

function blob(ctx, R, x, y, rx, ry, rot) {
  ctx.beginPath();
  ctx.ellipse(x * R, y * R, rx * R, ry * R, RAD(rot || 0), 0, TAU);
  ctx.fill();
}

/**
 * A polyline thickened into a filled tapering slab -- antler beams and tines.
 * Filled rather than stroked so the width can shrink along the run.
 */
function taper(ctx, R, pts, w0, w1) {
  const n = pts.length;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const h = (w0 + (w1 - w0) * t) * 0.5 * R;
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const px = pts[i][0] * R;
    const py = pts[i][1] * R;
    left.push([px - dy * h, py + dx * h]);
    right.push([px + dy * h, py - dx * h]);
  }
  ctx.beginPath();
  left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
}

/**
 * Trace -- without painting -- a ram's horn: a tapering band swept around a
 * centre that itself drifts as it goes, so the curl spirals in eccentrically
 * and finishes its single turn beside the face rather than closing into a
 * ring. A closed ring reads as a snail shell; one open turn reads as a horn.
 *
 * Left unpainted so the caller can fill and stroke the one path. That outline
 * is what keeps the horn a mass of its own instead of merging into the head.
 */
function hornPath(ctx, R, c0, c1, a0, a1, r0, r1, w0, w1) {
  const steps = 72;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const e = t * Math.sqrt(t);   // taper bites late: heavy base, then a quick tip
    const a = RAD(a0 + (a1 - a0) * t);
    const cx = c0[0] + (c1[0] - c0[0]) * t;
    const cy = c0[1] + (c1[1] - c0[1]) * t;
    const r = r0 + (r1 - r0) * e;
    const h = (w0 + (w1 - w0) * e) * 0.5;
    const nx = Math.cos(a);
    const ny = -Math.sin(a);
    outer.push([(cx + nx * (r + h)) * R, (cy + ny * (r + h)) * R]);
    inner.push([(cx + nx * (r - h)) * R, (cy + ny * (r - h)) * R]);
  }
  ctx.beginPath();
  outer.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = steps; i >= 0; i--) ctx.lineTo(inner[i][0], inner[i][1]);
  ctx.closePath();
}

export const ANIMAL_PAINTERS = {
  // Rocky Mountain ram in profile facing left. The head is the shape that has
  // to land first, so it is drawn heavy and whole -- deep brow, convex roman
  // nose, blunt muzzle, thick wedge of neck -- and the horn is laid over it
  // afterwards as one open turn in the pale colour, outlined so the two masses
  // stay apart instead of fusing into a single blob.
  bighorn(ctx, R, fill, line) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Head, muzzle and neck.
    ctx.fillStyle = line;
    fillPoly(ctx, R, [
      [-0.92, 0.10],
      [-0.96, -0.06, -0.86, -0.20],   // blunt nose, turning up off the lip
      [-0.64, -0.50, -0.34, -0.54],   // roman nose: the bridge bulges outward
      [-0.10, -0.56, 0.14, -0.40],    // brow and poll
      [0.20, -0.16, 0.12, 0.14],      // back of the skull
      [0.06, 0.44],                   // nape
      [0.18, 0.80],                   // wedge of neck, flaring as it drops
      [0.16, 0.90, -0.04, 0.90],
      [-0.30, 0.90],
      [-0.44, 0.86, -0.54, 0.70],
      [-0.56, 0.54, -0.62, 0.40],     // throat
      [-0.78, 0.28],                  // jaw
      [-0.92, 0.28, -0.95, 0.17],     // chin
    ]);

    // Ear, back of the skull, sitting in the open middle of the curl. Small,
    // but it is a second animal cue inside the one shape that could otherwise
    // be read as a ring.
    fillPoly(ctx, R, [
      [0.06, -0.04],
      [0.30, -0.02, 0.34, 0.14],
      [0.22, 0.20, 0.06, 0.16],
    ]);

    // Horn: one turn, no more. It starts on top of the skull behind the eye,
    // sweeps back over the poll, down behind the cheek and forward again, and
    // stops with the tip on the jaw. The curl sits behind the head rather than
    // over it, so the cream badge shows through the middle -- that hole is
    // what says horn instead of crescent. Pale with a deep outline so the two
    // masses stay apart.
    ctx.fillStyle = fill;
    ctx.strokeStyle = line;
    ctx.lineWidth = 0.08 * R;
    hornPath(ctx, R, [0.38, -0.06], [0.02, 0.12], 130, -150, 0.45, 0.26, 0.35, 0.07);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = fill;
    ctx.save();
    ctx.globalAlpha = 0.85;
    blob(ctx, R, -0.80, 0.06, 0.14, 0.105, -28);   // pale muzzle at the nose
    ctx.restore();
    dot(ctx, R, -0.50, -0.14, 0.085);              // eye, just ahead of the horn
    ctx.restore();
  },

  // Bull elk facing left under a wide six-point rack. The long straight muzzle
  // and the branching beams are what keep it away from the ram.
  elk(ctx, R, fill, line) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.fillStyle = line;

    const beam = (pts, tines) => {
      taper(ctx, R, pts, 0.15, 0.06);
      for (const t of tines) taper(ctx, R, t, 0.10, 0.04);
    };
    // Far beam, set back and slightly higher.
    beam(
      [[0.00, -0.12], [0.20, -0.44], [0.46, -0.52], [0.68, -0.44], [0.78, -0.44]],
      [
        [[0.14, -0.40], [0.10, -0.58], [0.06, -0.72]],
        [[0.34, -0.50], [0.34, -0.68], [0.32, -0.80]],
        [[0.56, -0.50], [0.62, -0.62], [0.66, -0.68]],
      ],
    );
    // Near beam.
    beam(
      [[-0.14, -0.16], [0.02, -0.52], [0.28, -0.66], [0.52, -0.62], [0.66, -0.56]],
      [
        [[-0.13, -0.18], [-0.34, -0.32], [-0.54, -0.38]],   // brow tine over the face
        [[-0.02, -0.44], [-0.10, -0.66], [-0.14, -0.82]],
        [[0.18, -0.62], [0.18, -0.78], [0.16, -0.88]],
        [[0.40, -0.66], [0.42, -0.76], [0.42, -0.82]],
      ],
    );

    // Ear, standing off the back of the skull.
    fillPoly(ctx, R, [[0.02, -0.04], [0.22, -0.22], [0.38, -0.18], [0.26, 0.02], [0.12, 0.06]]);

    // Head, long muzzle, heavy maned neck. The notch at the jaw angle is what
    // separates the muzzle from the throat.
    fillPoly(ctx, R, [
      [-0.80, 0.18],
      [-0.58, 0.08],
      [-0.36, -0.02],
      [-0.16, -0.14],
      [0.06, -0.08],
      [0.28, 0.22],
      [0.46, 0.60],
      [0.34, 0.86],
      [0.00, 0.92],
      [-0.22, 0.80],
      [-0.34, 0.62],
      [-0.48, 0.50],
      [-0.68, 0.46],
      [-0.82, 0.38],
      [-0.84, 0.26],
      [-0.80, 0.18],
    ]);

    ctx.fillStyle = fill;
    ctx.save();
    ctx.globalAlpha = 0.85;
    blob(ctx, R, -0.74, 0.28, 0.13, 0.10, -22);   // pale muzzle
    ctx.restore();
    dot(ctx, R, -0.36, 0.10, 0.075);
    ctx.restore();
  },

  // Cutthroat trout, nose left: pointed snout, swept dorsal, deeply forked
  // tail, and the red slash under the jaw that names the fish.
  trout(ctx, R, fill, line) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.fillStyle = line;

    // Fins first so they read as growing out of the body.
    fillPoly(ctx, R, [[-0.14, -0.27], [-0.04, -0.52], [0.12, -0.44], [0.18, -0.22]]);  // dorsal
    fillPoly(ctx, R, [[0.24, -0.20], [0.32, -0.33], [0.36, -0.16]]);                    // adipose
    fillPoly(ctx, R, [[-0.18, 0.30], [-0.12, 0.50], [0.04, 0.28]]);                     // pelvic
    fillPoly(ctx, R, [[0.14, 0.28], [0.20, 0.48], [0.34, 0.20]]);                       // anal
    fillPoly(ctx, R, [                                                                   // forked tail
      [0.38, -0.16],
      [0.84, -0.40],
      [0.58, 0.00],
      [0.84, 0.40],
      [0.38, 0.16],
    ]);

    // Body.
    fillPoly(ctx, R, [
      [-0.92, 0.04],
      [-0.60, -0.24, -0.16, -0.28],
      [0.14, -0.30, 0.42, -0.15],
      [0.42, 0.15],
      [0.14, 0.32, -0.16, 0.34],
      [-0.60, 0.30, -0.92, 0.04],
    ]);

    // Pectoral fin, on top of the body.
    fillPoly(ctx, R, [[-0.46, 0.18], [-0.36, 0.44], [-0.18, 0.24]]);

    ctx.fillStyle = fill;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = fill;
    ctx.lineWidth = 0.10 * R;
    ctx.beginPath();
    ctx.moveTo(-0.64 * R, 0.13 * R);
    ctx.lineTo(-0.44 * R, 0.22 * R);
    ctx.stroke();                                  // the cutthroat slash
    ctx.restore();
    dot(ctx, R, -0.64, -0.04, 0.078);              // eye
    ctx.save();
    ctx.globalAlpha = 0.8;
    dot(ctx, R, -0.26, -0.10, 0.05);
    dot(ctx, R, -0.04, -0.14, 0.05);
    dot(ctx, R, 0.18, -0.08, 0.05);
    ctx.restore();
    ctx.restore();
  },

  // Golden eagle head-on on the soar: a long, nearly level spread with notched
  // primaries, a modest fanned tail and a hooked head standing clear above the
  // shoulders. Wide-and-low is what keeps it off the bat.
  eagle(ctx, R, fill, line) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.fillStyle = line;

    const wing = (s) => fillPoly(ctx, R, [
      [0.09 * s, -0.10],
      [0.40 * s, -0.26, 0.66 * s, -0.28],   // leading edge, rising outboard
      [0.86 * s, -0.30, 0.92 * s, -0.20],   // wingtip
      [0.80 * s, -0.14],
      [0.90 * s, -0.06],                     // primary
      [0.76 * s, 0.00],
      [0.84 * s, 0.08],                      // primary
      [0.68 * s, 0.10],
      [0.74 * s, 0.20],                      // primary
      [0.40 * s, 0.18, 0.11 * s, 0.14],      // trailing edge
    ]);
    wing(-1);
    wing(1);

    // Body, then the fanned tail beneath it.
    blob(ctx, R, 0, -0.02, 0.10, 0.20, 0);
    fillPoly(ctx, R, [
      [-0.09, 0.10],
      [-0.31, 0.48],
      [0.00, 0.56],
      [0.31, 0.48],
      [0.09, 0.10],
    ]);

    // Head, turned a touch so the hooked beak shows.
    fillPoly(ctx, R, [
      [-0.10, -0.12],
      [-0.12, -0.34, 0.00, -0.42],
      [0.09, -0.41],
      [0.17, -0.34],
      [0.09, -0.30],
      [0.12, -0.20, 0.10, -0.12],
    ]);

    ctx.fillStyle = fill;
    ctx.save();
    ctx.globalAlpha = 0.8;
    blob(ctx, R, 0, -0.15, 0.085, 0.045, 0);   // the golden nape
    ctx.restore();
    ctx.restore();
  },

  // Coyote standing in profile, facing left: pricked ears, long level back and
  // the heavy brush of a tail hanging down behind. A whole animal rather than a
  // third head, so it can never be mistaken for the ram or the bull.
  coyote(ctx, R, fill, line) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.fillStyle = line;

    fillPoly(ctx, R, [
      [-0.88, -0.26],   // nose
      [-0.80, -0.40],
      [-0.64, -0.44],
      [-0.54, -0.44],   // stop
      [-0.60, -0.60],
      [-0.50, -0.80],   // near ear
      [-0.42, -0.58],
      [-0.32, -0.76],   // far ear
      [-0.26, -0.50],
      [-0.16, -0.30],   // nape
      [0.04, -0.26],    // withers
      [0.28, -0.30],
      [0.46, -0.28],    // rump
      [0.84, -0.26, 0.90, 0.14],    // the brush, hanging heavy behind the leg
      [0.86, 0.46, 0.60, 0.52],
      [0.60, 0.26, 0.50, 0.00],
      [0.46, 0.18],     // haunch
      [0.44, 0.42],
      [0.36, 0.56],     // hock
      [0.38, 0.72],     // hind foot
      [0.22, 0.72],
      [0.28, 0.48],
      [0.26, 0.28],
      [0.20, 0.18],
      [0.00, 0.22],     // belly
      [-0.05, 0.44],
      [-0.05, 0.72],    // fore foot
      [-0.24, 0.72],
      [-0.24, 0.42],
      [-0.32, 0.20],
      [-0.42, 0.02],    // chest
      [-0.56, -0.10],   // throat
      [-0.72, -0.20],
      [-0.86, -0.18],   // chin
      [-0.88, -0.26],
    ]);

    ctx.fillStyle = fill;
    ctx.save();
    ctx.globalAlpha = 0.6;
    blob(ctx, R, -0.48, -0.04, 0.075, 0.13, 20);   // pale throat
    ctx.restore();
    dot(ctx, R, -0.56, -0.32, 0.065);             // eye
    ctx.restore();
  },
};
