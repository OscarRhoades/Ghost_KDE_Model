import { Matrix4, Quaternion, Vector3 } from 'three';
import { P2 } from '../engine/geom';
import { aboutPivot, rotAboutLine, rotFromPairs, smooth, v3, window01 } from '../engine/mat';
import {
  Face,
  FoldRecord,
  Step,
  StepBuilder,
  faceSector,
  initialSheet,
} from '../engine/model';

// Paper landmarks (unit square, colored side up).
const C: P2 = { x: 0.5, y: 0.5 };
const c1: P2 = { x: 0, y: 0 };
const c2: P2 = { x: 1, y: 0 };
const c3: P2 = { x: 1, y: 1 };
const c4: P2 = { x: 0, y: 1 };
const m12: P2 = { x: 0.5, y: 0 };
const m23: P2 = { x: 1, y: 0.5 };
const m34: P2 = { x: 0.5, y: 1 };
const m41: P2 = { x: 0, y: 0.5 };

/** Where the kite creases meet the book creases: distance 1 - √2/2 from the center. */
const T = 1 - Math.SQRT1_2;
const P8: P2 = { x: 0.5 - T, y: 0.5 }; // on C–m41 (between sectors 8 and 7)
const P1: P2 = { x: 0.5, y: 0.5 - T }; // on C–m12 (sectors 1 | 2)
const P4: P2 = { x: 0.5 + T, y: 0.5 }; // on C–m23 (sectors 4 | 3)
const P5: P2 = { x: 0.5, y: 0.5 + T }; // on C–m34 (sectors 5 | 6)

const inSec = (...secs: number[]) => (f: Face) => secs.includes(faceSector(f));
const UP = v3(0, 1, 0);

/** Signed side of world point w relative to the xy line a→b. */
const sideXY = (a: Vector3, b: Vector3, w: Vector3) => (b.x - a.x) * (w.y - a.y) - (b.y - a.y) * (w.x - a.x);

function turnOver(b: StepBuilder) {
  // Arrow: the right-most point of the model swings around the vertical axis.
  let best: { f: Face; p: P2; x: number } | null = null;
  for (const f of b.faces) {
    for (const p of f.poly) {
      const w = new Vector3(p.x, p.y, 0).applyMatrix4(b.now(f));
      if (!best || w.x > best.x + 1e-9 || (Math.abs(w.x - best.x) < 1e-9 && Math.abs(w.y) < 0.05)) {
        best = { f, p, x: w.x };
      }
    }
  }
  b.phase(
    2.2,
    () => {
      for (const f of b.faces) b.setZ(f, -b.zNow(f));
      if (best) b.handle(best.f, best.p);
    },
    { global: (s) => new Matrix4().makeRotationY(Math.PI * s) },
  );
}

function kite(b: StepBuilder, secs: [number, number], P: P2, mid: P2, corner: P2): FoldRecord {
  const c = b.W(corner);
  return b.fold({ a: c, b: b.W(P), side: b.W(mid), sel: inSec(...secs), kind: 'valley' });
}

// ---------------------------------------------------------------------------
// Collapse into the square (preliminary) base.
//
// Phase 1 is the symmetric "umbrella" motion: the four corner rays drop toward
// the axis while the mid-edge rays follow, keeping every 45° sector rigid.
// Phase 2 swings the mid-edge rays together in pairs while the whole model is
// laid flat, facing the viewer.

function collapse(b: StepBuilder) {
  const W0 = new Matrix4().makeRotationY(Math.PI); // local collapse frame -> world (paper is white side up)
  const r = Math.SQRT1_2;
  const L = new Matrix4().makeBasis(v3(r, 0, -r), v3(-r, 0, -r), v3(0, 1, 0)); // flattened frame -> world
  const qW0 = new Quaternion().setFromRotationMatrix(W0);
  const qL = new Quaternion().setFromRotationMatrix(L);
  const finalC = v3(0, Math.SQRT2 / 4, 0);
  const dir = (p: number, phi: number) => v3(Math.sin(p) * Math.cos(phi), Math.sin(p) * Math.sin(phi), -Math.cos(p));
  const deg = Math.PI / 180;
  const order: Record<number, number> = { 8: 3, 1: 3, 7: 2, 2: 2, 6: 1, 3: 1, 5: 0, 4: 0 };

  b.phase(4.5, () => {
    for (const f of b.faces) {
      const corner = f.poly.find((p) => Math.abs(Math.hypot(p.x - 0.5, p.y - 0.5) - Math.SQRT1_2) < 1e-6)!;
      const mid = f.poly.find((p) => Math.abs(Math.hypot(p.x - 0.5, p.y - 0.5) - 0.5) < 1e-6)!;
      const eC = v3(corner.x - 0.5, corner.y - 0.5).normalize();
      const eM = v3(mid.x - 0.5, mid.y - 0.5).normalize();
      const phC = Math.atan2(eC.y, eC.x);
      const phM = Math.atan2(eM.y, eM.x);
      // mids on the x axis (0°/180°) swing -45°, those on the y axis +45°
      const onX = Math.abs(Math.sin(phM)) < 0.5;
      const dPhi = (onX ? -45 : 45) * deg;
      b.addMotion([f], (_f, s) => {
        const s1 = smooth(window01(s, 0, 0.55));
        const s2 = smooth(window01(s, 0.55, 1));
        let dC: Vector3;
        let dM: Vector3;
        if (s2 <= 0) {
          const a = (Math.PI / 2) * (1 - s1);
          const A = Math.sin(a) * r;
          const B = Math.cos(a);
          const R = Math.hypot(A, B);
          const bb = Math.atan2(A, B) + Math.acos(Math.min(1, r / R));
          dC = dir(a, phC);
          dM = dir(bb, phM);
        } else {
          dC = v3(0, 0, -1);
          dM = dir(Math.PI / 4, phM + dPhi * s2);
        }
        const Rl = rotFromPairs(eC, eM, dC, dM);
        const q = qW0.clone().slerp(qL, s2);
        const G = new Matrix4().makeRotationFromQuaternion(q);
        const t = finalC.clone().multiplyScalar(s2);
        return new Matrix4()
          .makeTranslation(t.x, t.y, t.z)
          .multiply(G)
          .multiply(Rl)
          .multiply(new Matrix4().makeTranslation(-0.5, -0.5, 0));
      });
      b.setZ(f, order[faceSector(f)]);
      if (faceSector(f) === 1 || faceSector(f) === 5) b.handle(f, { x: corner.x * 0.9 + 0.05, y: corner.y * 0.9 + 0.05 });
    }
  });
}

// ---------------------------------------------------------------------------
// Petal fold: the bottom point of the front layer swings up along the
// horizontal crease while the sides fold in. Each side is a 4-crease vertex
// (a spherical linkage) solved exactly for the side flaps.

interface PetalSide {
  outer: number; // sector lifted with the petal (ends up under it)
  inner: number; // sector that folds to the center line
  P: P2;
  mid: P2;
}

export interface PetalRecord {
  central: Set<number>;
  outer: Set<number>;
}

function petal(b: StepBuilder, centralSecs: [number, number], sides: [PetalSide, PetalSide], corner: P2): PetalRecord {
  const rec: PetalRecord = { central: new Set(), outer: new Set() };
  b.phase(4.2, () => {
    const c = b.W(corner);
    const PL = b.W(sides[0].P);
    const PR = b.W(sides[1].P);
    const hdir = PR.clone().sub(PL).normalize();
    const below = (w: Vector3) => Math.sign(sideXY(PL, PR, w)) === Math.sign(sideXY(PL, PR, c));
    // inside the kite region = same side of each kite line as the center line
    const centerPt = PL.clone().add(PR).multiplyScalar(0.5);
    const insideKite = (w: Vector3, P: Vector3) => Math.sign(sideXY(c, P, w)) === Math.sign(sideXY(c, P, centerPt));

    const central = b.faces.filter(
      (f) => centralSecs.includes(faceSector(f)) && below(b.wc(f)) && insideKite(b.wc(f), PL) && insideKite(b.wc(f), PR),
    );
    if (!central.length) throw new Error('petal: no central faces');
    // valley sign for the central flap
    const cr = b.wc(central[0]).sub(PL);
    cr.sub(hdir.clone().multiplyScalar(cr.dot(hdir)));
    const sgnC = hdir.clone().cross(cr).z > 0 ? 1 : -1;
    const theta = (s: number) => Math.PI * s;
    const Rc = (s: number) => new Matrix4().makeRotationAxis(hdir, sgnC * theta(s));
    b.addMotion(central, (_f, s, M0) => rotAboutLine(PL, hdir, sgnC * theta(s)).multiply(M0));
    central.forEach((f) => rec.central.add(f.id));
    b.mark(PL, hdir, central, 'valley');

    const top = Math.max(...b.faces.map((f) => b.zNow(f)));
    for (const f of central) b.setZ(f, top + 5);

    for (const sd of sides) {
      const V = b.W(sd.P);
      const midW = b.W(sd.mid);
      const outerF = b.faces.filter((f) => faceSector(f) === sd.outer && below(b.wc(f)) && !insideKite(b.wc(f), V));
      const innerF = b.faces.filter((f) => faceSector(f) === sd.inner && below(b.wc(f)) && !insideKite(b.wc(f), V));
      if (!outerF.length || !innerF.length) throw new Error('petal: missing side flaps');
      const dK = c.clone().sub(V).normalize();
      const dB = midW.clone().sub(V).normalize();
      const cosA = dK.dot(dB);
      const sinA = Math.sqrt(1 - cosA * cosA);
      const uu = dB.clone().sub(dK.clone().multiplyScalar(cosA)).normalize();
      // rotation sense about dK that lifts the side flap toward the viewer
      const sig = new Vector3().copy(dB).applyAxisAngle(dK, 0.01).z > 0 ? 1 : -1;
      const ww = dK.clone().cross(uu).multiplyScalar(sig);
      const phiOf = (s: number) => {
        const th = theta(s);
        if (th < 1e-6) return 0;
        if (Math.PI - th < 1e-6) return Math.PI;
        const k8 = dK.clone().applyMatrix4(Rc(s));
        const A = sinA * uu.dot(k8);
        const B = sinA * ww.dot(k8);
        const Cc = cosA * (1 - dK.dot(k8));
        const R = Math.hypot(A, B);
        const base = Math.atan2(B, A);
        const off = Math.acos(Math.max(-1, Math.min(1, Cc / R)));
        const wrap = (x: number) => {
          let y = x;
          while (y < -Math.PI / 2) y += 2 * Math.PI;
          while (y > (3 * Math.PI) / 2) y -= 2 * Math.PI;
          return y;
        };
        const cands = [wrap(base + off), wrap(base - off)];
        return cands.reduce((p, q) => (Math.abs(q - th) < Math.abs(p - th) ? q : p));
      };
      b.addMotion(innerF, (_f, s, M0) => rotAboutLine(V, dK, sig * phiOf(s)).multiply(M0));
      b.addMotion(outerF, (_f, s, M0) => {
        const k8 = dK.clone().applyMatrix4(Rc(s));
        const bb = dB.clone().applyAxisAngle(dK, sig * phiOf(s));
        return aboutPivot(rotFromPairs(dK, dB, k8, bb), V).multiply(M0);
      });
      outerF.forEach((f) => rec.outer.add(f.id));
      for (const f of outerF) b.setZ(f, top + 2 + (b.zNow(f) - top) * 1e-3);
      for (const f of innerF) b.setZ(f, top + 10 + (b.zNow(f) - top) * 1e-3);
      const hf = outerF.find((f) => f.poly.some((p) => Math.hypot(p.x - sd.mid.x, p.y - sd.mid.y) < 1e-6));
      if (hf) b.handle(hf, { x: sd.mid.x * 0.85 + C.x * 0.15, y: sd.mid.y * 0.85 + C.y * 0.15 });
    }
    const hc = central.find((f) => f.poly.some((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < 1e-6));
    if (hc) b.handle(hc, { x: corner.x * 0.9 + C.x * 0.1, y: corner.y * 0.9 + C.y * 0.1 });
  });
  return rec;
}

// ---------------------------------------------------------------------------

function narrow(b: StepBuilder, sec: number, P: P2, corner: P2, petalOnTop: PetalRecord) {
  const c = b.W(corner, inSec(sec));
  const PW = b.W(P);
  const d = PW.clone().sub(c).normalize().add(UP).normalize();
  return b.fold({
    a: c,
    b: c.clone().add(d),
    side: PW,
    sel: (f) => faceSector(f) === sec && b.wc(f).y < PW.y - 1e-9,
    kind: 'valley',
    // the top of the narrowed flap slides under the wing flap
    under: (f) => f.anc.some((id) => petalOnTop.central.has(id)),
  });
}

interface ReverseRecord {
  F: Set<number>;
  B: Set<number>;
  a: Vector3;
  u: Vector3;
}

/**
 * Inside reverse fold of a two-sided flap about the line (a, u). Both halves
 * end up mirrored across the line, tucked between the surrounding layers.
 * The animation swings the halves apart (front toward the viewer, back away)
 * so they never pass through each other.
 */
function reverseFold(
  b: StepBuilder,
  candidates: (f: Face) => boolean,
  a: Vector3,
  u: Vector3,
  tipPoint: Vector3,
  isFront: (f: Face) => boolean,
  frontBody: (f: Face) => boolean,
): ReverseRecord {
  const rec: ReverseRecord = { F: new Set(), B: new Set(), a, u };
  b.phase(3.2, () => {
    const bpt = a.clone().add(u);
    const pieces = b.split(candidates, a, bpt);
    const want = Math.sign(sideXY(a, bpt, tipPoint));
    const tip = pieces.filter((f) => Math.sign(sideXY(a, bpt, b.wc(f))) === want);
    const F = tip.filter(isFront);
    const B = tip.filter((f) => !isFront(f));
    if (!F.length || !B.length) throw new Error('reverse fold: missing a half');
    b.rotate(F, a, u, 'valley', Math.PI, { mark: true });
    b.rotate(B, a, u, 'mountain', Math.PI, { arrow: false, mark: false });
    // Front half slides in beneath the front layers; the back half beneath both.
    const fIds = new Set(F.map((f) => f.id));
    b.stack(F, 'between', { under: frontBody });
    b.stack(B, 'between', { under: (f) => frontBody(f) || f.anc.some((id) => fIds.has(id)) });
    F.forEach((f) => rec.F.add(f.id));
    B.forEach((f) => rec.B.add(f.id));
  });
  return rec;
}

// ---------------------------------------------------------------------------

export function buildCrane(): Step[] {
  const ids = { next: 1 };
  let faces = initialSheet(ids);
  const steps: Step[] = [];
  const add = (title: string, text: string, body: (b: StepBuilder) => void) => {
    const b = new StepBuilder(faces, ids);
    body(b);
    const st = b.finish(title, text);
    steps.push(st);
    faces = st.faces;
  };
  const all = () => true;

  add(
    'Start',
    'Begin with a square sheet, colored side up. Drag to orbit the model, scroll to zoom. Use Next (or →) to step through the folds.',
    () => {},
  );

  add('Diagonal precrease', 'Valley-fold in half along the diagonal, crease sharply, then unfold.', (b) => {
    let r!: FoldRecord;
    b.phase(1.8, () => {
      r = b.fold({ a: b.W(c2), b: b.W(c4), side: b.W({ x: 0.1, y: 0.1 }), sel: all, kind: 'valley' });
    });
    b.phase(1.4, () => b.unfold(r));
  });

  add('Other diagonal', 'Valley-fold along the other diagonal and unfold.', (b) => {
    let r!: FoldRecord;
    b.phase(1.8, () => {
      r = b.fold({ a: b.W(c1), b: b.W(c3), side: b.W({ x: 0.9, y: 0.1 }), sel: all, kind: 'valley' });
    });
    b.phase(1.4, () => b.unfold(r));
  });

  add('Turn over', 'Turn the paper over so the white side faces you.', (b) => turnOver(b));

  add('Book fold', 'Valley-fold in half edge to edge, then unfold.', (b) => {
    let r!: FoldRecord;
    b.phase(1.8, () => {
      r = b.fold({ a: b.W(m41), b: b.W(m23), side: b.W({ x: 0.5, y: 0.1 }), sel: all, kind: 'valley' });
    });
    b.phase(1.4, () => b.unfold(r));
  });

  add('Other book fold', 'Valley-fold in half the other way and unfold. The paper now has all eight radial creases.', (b) => {
    let r!: FoldRecord;
    b.phase(1.8, () => {
      r = b.fold({ a: b.W(m12), b: b.W(m34), side: b.W({ x: 0.1, y: 0.5 }), sel: all, kind: 'valley' });
    });
    b.phase(1.4, () => b.unfold(r));
  });

  add(
    'Collapse to square base',
    'Bring the four corners together: the diagonals fold one way and the edge-to-edge creases the other. Flatten into the square (preliminary) base with the open end down.',
    (b) => collapse(b),
  );

  let k1L!: FoldRecord;
  let k1R!: FoldRecord;
  add('Kite folds', 'Fold the lower edges of the front flaps to the center line.', (b) => {
    b.phase(2.2, () => {
      k1L = kite(b, [8, 7], P8, m41, c1);
      k1R = kite(b, [1, 2], P1, m12, c1);
    });
  });

  let top1!: FoldRecord;
  add('Fold the top down', 'Fold the top triangle down over the flaps and crease firmly.', (b) => {
    b.phase(2, () => {
      top1 = b.fold({ a: b.W(P8), b: b.W(P1), side: b.W(C), sel: all, kind: 'valley' });
    });
  });

  add('Unfold', 'Unfold the top triangle, then the two side flaps. These creases guide the petal fold.', (b) => {
    b.phase(1.6, () => b.unfold(top1));
    b.phase(1.8, () => {
      b.unfold(k1L);
      b.unfold(k1R);
    });
  });

  let petal1!: PetalRecord;
  add(
    'Petal fold',
    'Lift the bottom corner of the front layer up along the horizontal crease. The sides swing in along the creases and meet at the center. Flatten.',
    (b) => {
      petal1 = petal(
        b,
        [8, 1],
        [
          { outer: 8, inner: 7, P: P8, mid: m41 },
          { outer: 1, inner: 2, P: P1, mid: m12 },
        ],
        c1,
      );
    },
  );

  add('Turn over', 'Turn the model over.', (b) => turnOver(b));

  let k2L!: FoldRecord;
  let k2R!: FoldRecord;
  add('Kite folds', 'Repeat on this side: fold the lower edges to the center line. (The horizontal crease is already there.)', (b) => {
    b.phase(2.2, () => {
      k2L = kite(b, [4, 3], P4, m23, c3);
      k2R = kite(b, [5, 6], P5, m34, c3);
    });
  });

  add('Unfold', 'Unfold the two flaps.', (b) => {
    b.phase(1.8, () => {
      b.unfold(k2L);
      b.unfold(k2R);
    });
  });

  let petal2!: PetalRecord;
  add('Petal fold', 'Petal-fold this side too. This is the bird base.', (b) => {
    petal2 = petal(
      b,
      [4, 5],
      [
        { outer: 4, inner: 3, P: P4, mid: m23 },
        { outer: 5, inner: 6, P: P5, mid: m34 },
      ],
      c3,
    );
  });

  add('Narrow the legs', 'Fold the lower edges of the front layer to the center line.', (b) => {
    b.phase(2.2, () => {
      narrow(b, 3, P4, c2, petal2);
      narrow(b, 6, P5, c4, petal2);
    });
  });

  add('Turn over', 'Turn the model over.', (b) => turnOver(b));

  add('Narrow the legs', 'Repeat on this side.', (b) => {
    b.phase(2.2, () => {
      narrow(b, 7, P8, c4, petal1);
      narrow(b, 2, P1, c2, petal1);
    });
  });

  // The two thin lower flaps become the neck (left) and tail (right).
  const FRONT_SECS = [8, 1, 7, 2];
  const front = (f: Face) => FRONT_SECS.includes(faceSector(f));

  let neck!: ReverseRecord;
  let neckTip!: Vector3;
  const legFold = (b: StepBuilder, secF: number, secB: number, dirX: number): ReverseRecord => {
    const P = b.W(P8, inSec(8));
    const ang = (15 * Math.PI) / 180;
    const a = v3(0, P.y - 0.045, 0);
    const u = v3(dirX * Math.cos(ang), -Math.sin(ang), 0);
    const tip = b.W(secF === 7 ? c4 : c2, inSec(secF));
    return reverseFold(
      b,
      (f) => (faceSector(f) === secF || faceSector(f) === secB) && b.wc(f).x * dirX > 0 && b.wc(f).y < P.y,
      a,
      u,
      tip,
      (f) => faceSector(f) === secF,
      front,
    );
  };

  add('Reverse-fold the neck', 'Inside-reverse-fold the left flap up between the layers to form the neck.', (b) => {
    neck = legFold(b, 7, 6, -1);
  });
  add('Reverse-fold the tail', 'Inside-reverse-fold the right flap up the same way to form the tail.', (b) => {
    legFold(b, 2, 3, 1);
  });

  add('Reverse-fold the head', 'Inside-reverse-fold the tip of the neck down to form the head.', (b) => {
    const neckIds = new Set([...neck.F, ...neck.B]);
    const inNeck = (f: Face) => f.anc.some((id) => neckIds.has(id));
    const inF = (f: Face) => f.anc.some((id) => neck.F.has(id));
    neckTip = b.W(c4, inNeck);
    const un = neckTip.clone().sub(neck.a).setZ(0).normalize();
    const H = neckTip.clone().sub(un.clone().multiplyScalar(0.13));
    const uh = un.clone().applyAxisAngle(v3(0, 0, 1), (62 * Math.PI) / 180);
    reverseFold(b, inNeck, H, uh, neckTip, inF, front);
  });

  let wingF!: FoldRecord;
  let wingB!: FoldRecord;
  add('Fold the wings down', 'Fold the front wing down, and the back wing down behind.', (b) => {
    // the wings hinge on the line between the two side points
    const yw = b.W(P8, inSec(8)).y;
    const a = v3(-1, yw, 0);
    const bb = v3(1, yw, 0);
    const wing = (r: PetalRecord) => {
      const ids2 = new Set([...r.central, ...r.outer]);
      return (f: Face) => f.anc.some((id) => ids2.has(id));
    };
    b.phase(2.4, () => {
      wingF = b.fold({ a, b: bb, side: v3(0, yw + 0.3, 0), sel: wing(petal1), kind: 'valley' });
      wingB = b.fold({ a, b: bb, side: v3(0, yw + 0.3, 0), sel: wing(petal2), kind: 'mountain' });
    });
  });

  add('Shape the crane', 'Open the wings out to the sides. Your crane is done — orbit around it!', (b) => {
    b.phase(
      2.6,
      () => {
        b.unfold(wingF, 0.5);
        b.unfold(wingB, 0.5, { arrow: false });
      },
      {
        // turn the finished crane to a three-quarter view from slightly above
        global: (s) =>
          new Matrix4()
            .makeRotationX((22 * Math.PI) / 180 * smooth(s))
            .multiply(new Matrix4().makeRotationY((-38 * Math.PI) / 180 * smooth(s))),
        bake: false,
      },
    );
  });

  return steps;
}
