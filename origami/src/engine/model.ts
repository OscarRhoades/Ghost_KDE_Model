import { Matrix4, Vector3 } from 'three';
import {
  P2,
  area,
  bbox,
  bboxOverlap,
  centroid,
  overlapArea,
  pointInConvex,
  segmentOverlap,
  side,
  splitConvex,
  sub2,
} from './geom';
import { normalOf, rotAboutLine } from './mat';

export { normalOf };

/** World-space separation between stacked layers (paper is 1×1). */
export const LAYER_GAP = 0.0018;

/**
 * A facet of paper bounded by creases. Its polygon lives in paper coordinates
 * (unit square, colored side facing +z); `M[k]` places it in the world at
 * phase boundary k of the step it belongs to.
 */
export interface Face {
  id: number;
  poly: P2[];
  M: Matrix4[];
  /** Stacking key per boundary: among overlapping faces, higher is in front. */
  z: number[];
  /** Integer render layer per boundary, derived from `z` and overlaps. */
  layer: number[];
  /**
   * Render offset per boundary that separates stacked layers. Flat states use
   * layer × gap along +z; otherwise the offset rides along with the face.
   */
  off: Vector3[];
  /** [self, parent, grandparent, ...] — survives later splits. */
  anc: number[];
}

export type PoseFn = (f: Face, s: number, M0: Matrix4) => Matrix4;

export interface Motion {
  ids: Set<number>;
  pose: PoseFn;
}

export interface Handle {
  faceId: number;
  point: P2;
}

export type FoldKind = 'valley' | 'mountain';

export interface AxisMark {
  a: Vector3;
  b: Vector3;
  kind: FoldKind;
}

export interface Phase {
  duration: number;
  motions: Motion[];
  /** Whole-model rigid motion (e.g. turning the paper over). */
  global?: (s: number) => Matrix4;
  /** Bake the global motion into the faces at the end of the phase. */
  bake: boolean;
  handles: Handle[];
  axes: AxisMark[];
  /** Filled in by `finish`: motion index per final face (-1 = static). */
  motionOf: number[];
  /** Filled in by `finish`: sampled arrow paths (world space). */
  arrows: Vector3[][];
}

export interface Crease {
  a: P2;
  b: P2;
  /** Signed fold angle at the end of the step; valley (seen from colored side) > 0. */
  angle: number;
  /** Fold state changed during the step. */
  active: boolean;
}

export interface Step {
  title: string;
  text: string;
  faces: Face[];
  phases: Phase[];
  creases: Crease[];
}

export interface FoldRecord {
  moved: Set<number>;
  a: Vector3;
  u: Vector3;
  angle: number;
  zBefore: Map<number, number>;
}

// ---------------------------------------------------------------------------

const hasAnc = (f: Face, ids: Set<number>) => f.anc.some((id) => ids.has(id));

export function lookupByAnc<T>(f: Face, m: Map<number, T>): T | undefined {
  for (const id of f.anc) {
    const v = m.get(id);
    if (v !== undefined) return v;
  }
  return undefined;
}

export const SQRT2 = Math.SQRT2;
export const PAPER_CENTER: P2 = { x: 0.5, y: 0.5 };

/** Which of the 8 paper sectors (1..8) around the center a paper point lies in. */
export function sectorOf(p: P2): number {
  let ang = (Math.atan2(p.y - 0.5, p.x - 0.5) * 180) / Math.PI;
  if (ang < 0) ang += 360;
  // S1 = 225..270, S2 = 270..315, ..., S8 = 180..225
  const k = Math.floor(((ang - 225 + 360) % 360) / 45);
  return k + 1;
}

export const faceSector = (f: Face) => sectorOf(centroid(f.poly));

export function worldPoly(f: Face, M: Matrix4): Vector3[] {
  return f.poly.map((p) => new Vector3(p.x, p.y, 0).applyMatrix4(M));
}

// ---------------------------------------------------------------------------
// Layering

function isFlat(faces: Face[], Ms: Matrix4[]): boolean {
  for (let i = 0; i < faces.length; i++) {
    const n = normalOf(Ms[i]);
    if (Math.abs(Math.abs(n.z) - 1) > 1e-6) return false;
    for (const q of worldPoly(faces[i], Ms[i])) if (Math.abs(q.z) > 1e-6) return false;
  }
  return true;
}

/**
 * Integer layers for a flat state: each face sits one above the highest
 * overlapping face with a lower stacking key. Returns null if not flat.
 */
export function computeLayers(faces: Face[], Ms: Matrix4[], zs: number[]): number[] | null {
  if (!isFlat(faces, Ms)) return null;
  const polys = faces.map((f, i) => {
    const w = worldPoly(f, Ms[i]).map((q) => ({ x: q.x, y: q.y }));
    return area(w) < 0 ? w.reverse() : w;
  });
  const boxes = polys.map((p) => bbox(p));
  const order = faces.map((_, i) => i).sort((a, b) => zs[a] - zs[b]);
  const layer = new Array<number>(faces.length).fill(0);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    let L = 0;
    for (let oj = 0; oj < oi; oj++) {
      const j = order[oj];
      if (zs[j] >= zs[i] - 1e-12) continue;
      if (layer[j] + 1 <= L) continue;
      if (!bboxOverlap(boxes[i], boxes[j], 1e-6)) continue;
      if (overlapArea(polys[i], polys[j]) > 1e-7) L = layer[j] + 1;
    }
    layer[i] = L;
  }
  return layer;
}

// ---------------------------------------------------------------------------
// Adjacency, creases, tears

export interface Adjacency {
  i: number;
  j: number;
  /** Shared segment in paper coordinates, oriented with face i on its left. */
  a: P2;
  b: P2;
}

export function adjacency(faces: Face[]): Adjacency[] {
  const boxes = faces.map((f) => bbox(f.poly));
  const out: Adjacency[] = [];
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      if (!bboxOverlap(boxes[i], boxes[j], -1e-6)) continue;
      const A = faces[i].poly;
      const B = faces[j].poly;
      for (let ei = 0; ei < A.length; ei++) {
        const a0 = A[ei];
        const a1 = A[(ei + 1) % A.length];
        for (let ej = 0; ej < B.length; ej++) {
          const ov = segmentOverlap(a0, a1, B[ej], B[(ej + 1) % B.length]);
          if (!ov) continue;
          // orient so face i is on the left
          const c = centroid(A);
          const d = sub2(ov[1], ov[0]);
          const [p, q] = side(ov[0], d, c) > 0 ? ov : [ov[1], ov[0]];
          out.push({ i, j, a: p, b: q });
        }
      }
    }
  }
  return out;
}

/** Signed fold angle across an adjacency (valley seen from the colored side > 0). */
export function foldAngle(adj: Adjacency, Ms: Matrix4[], layers: number[]): number {
  const MA = Ms[adj.i];
  const MB = Ms[adj.j];
  const nA = normalOf(MA);
  const nB = normalOf(MB);
  const e = new Vector3(adj.b.x, adj.b.y, 0)
    .applyMatrix4(MA)
    .sub(new Vector3(adj.a.x, adj.a.y, 0).applyMatrix4(MA))
    .normalize();
  const rho = Math.atan2(nA.clone().cross(nB).dot(e), nA.dot(nB));
  let ang = -rho;
  if (Math.abs(Math.abs(ang) - Math.PI) < 0.05) {
    const dl = layers[adj.j] - layers[adj.i];
    if (dl !== 0) {
      const valley = dl * nA.z > 0;
      ang = valley ? Math.PI : -Math.PI;
    }
  }
  return ang;
}

/** Shared edges whose two faces disagree on where the edge is (paper torn). */
export function tears(faces: Face[], Ms: Matrix4[], adj = adjacency(faces), tol = 1e-6): Adjacency[] {
  return adj.filter((e) => {
    for (const p of [e.a, e.b]) {
      const q = new Vector3(p.x, p.y, 0);
      const wa = q.clone().applyMatrix4(Ms[e.i]);
      const wb = q.clone().applyMatrix4(Ms[e.j]);
      if (wa.distanceTo(wb) > tol) return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Step builder

export interface FoldOptions {
  a: Vector3;
  b: Vector3;
  /** Any world point on the side that moves. */
  side: Vector3;
  sel: (f: Face) => boolean;
  kind: FoldKind;
  angle?: number;
  /** Update stacking keys as a flat fold (default true when angle = π). */
  restack?: boolean;
  /** Tuck the folded flap beneath these faces instead of landing on top. */
  under?: (f: Face) => boolean;
  arrow?: boolean;
  mark?: boolean;
}

export type StackMode = 'top' | 'bottom' | 'between';

interface StackRequest {
  ids: Set<number>;
  mode: StackMode;
  under?: (f: Face) => boolean;
  reverse: boolean;
}

export class StepBuilder {
  faces: Face[];
  phases: Phase[] = [];
  private cur: Phase | null = null;
  private zUpd = new Map<number, number>();
  private stackReqs: StackRequest[] = [];
  /** Paper segments cut by splits during this step (new creases). */
  private cuts: [P2, P2][] = [];

  constructor(
    prev: Face[],
    private ids: { next: number },
  ) {
    // Snapshot the previous step's final boundary as this step's boundary 0.
    this.faces = prev.map((f) => {
      const k = f.M.length - 1;
      return {
        id: f.id,
        poly: f.poly,
        M: [f.M[k].clone()],
        z: [f.z[k]],
        layer: [f.layer[k]],
        off: [f.off[k].clone()],
        anc: f.anc,
      };
    });
  }

  /** Index of the boundary that the phase under construction starts from. */
  get k() {
    return this.phases.length - (this.cur ? 1 : 0);
  }

  now(f: Face): Matrix4 {
    return f.M[this.k];
  }

  zNow(f: Face): number {
    return f.z[this.k];
  }

  wc(f: Face): Vector3 {
    const c = centroid(f.poly);
    return new Vector3(c.x, c.y, 0).applyMatrix4(this.now(f));
  }

  /** World position (now) of a paper point, found on a face passing `filter`. */
  W(p: P2, filter: (f: Face) => boolean = () => true): Vector3 {
    const f = this.faces.find((g) => filter(g) && pointInConvex(g.poly, p, 1e-7));
    if (!f) throw new Error(`No face contains paper point (${p.x}, ${p.y})`);
    return new Vector3(p.x, p.y, 0).applyMatrix4(this.now(f));
  }

  descendants(ids: Set<number>): Face[] {
    return this.faces.filter((f) => hasAnc(f, ids));
  }

  phase(duration: number, body: () => void, opts: { global?: (s: number) => Matrix4; bake?: boolean } = {}) {
    if (this.cur) throw new Error('nested phase');
    this.cur = {
      duration,
      motions: [],
      global: opts.global,
      bake: opts.bake ?? !!opts.global,
      handles: [],
      axes: [],
      motionOf: [],
      arrows: [],
    };
    this.phases.push(this.cur);
    body();
    this.endPhase();
  }

  private endPhase() {
    const ph = this.cur!;
    const k = this.k;
    const Ms: Matrix4[] = [];
    const zs: number[] = [];
    for (const f of this.faces) {
      const m = ph.motions.find((mo) => hasAnc(f, mo.ids));
      let M = m ? m.pose(f, 1, f.M[k]) : f.M[k].clone();
      if (ph.global && ph.bake) M = ph.global(1).multiply(M);
      Ms.push(M);
      const z = lookupByAnc(f, this.zUpd);
      zs.push(z ?? f.z[k]);
    }
    for (const req of this.stackReqs) this.applyStack(req, Ms, zs);
    const flat = computeLayers(this.faces, Ms, zs);
    this.faces.forEach((f, i) => {
      f.M.push(Ms[i]);
      f.z.push(zs[i]);
      f.layer.push(flat ? flat[i] : f.layer[k]);
      f.off.push(flat ? new Vector3(0, 0, flat[i] * LAYER_GAP) : f.off[k].clone().applyMatrix4(relRot(f.M[k], Ms[i])));
    });
    this.zUpd.clear();
    this.stackReqs = [];
    this.cur = null;
  }

  /**
   * Request new stacking keys for a moving group, resolved at the end of the
   * phase against the faces its final footprint overlaps: on top of them,
   * beneath them, or beneath those passing `under` and above the rest.
   */
  stack(faces: Face[], mode: StackMode, opts: { under?: (f: Face) => boolean; reverse?: boolean } = {}) {
    this.need();
    this.stackReqs.push({ ids: new Set(faces.map((f) => f.id)), mode, under: opts.under, reverse: opts.reverse ?? true });
  }

  private applyStack(req: StackRequest, Ms: Matrix4[], zs: number[]) {
    const n = this.faces.length;
    const flat = (i: number) => {
      const w = worldPoly(this.faces[i], Ms[i]).map((q) => ({ x: q.x, y: q.y }));
      return area(w) < 0 ? w.reverse() : w;
    };
    const polys: (P2[] | null)[] = new Array(n).fill(null);
    const poly = (i: number) => (polys[i] ??= flat(i));
    const boxes: (ReturnType<typeof bbox> | null)[] = new Array(n).fill(null);
    const box = (i: number) => (boxes[i] ??= bbox(poly(i)));
    const overlaps = (i: number, j: number) =>
      bboxOverlap(box(i), box(j), 1e-6) && overlapArea(poly(i), poly(j)) > 1e-7;

    const mine: number[] = [];
    const others: number[] = [];
    this.faces.forEach((f, i) => (hasAnc(f, req.ids) ? mine : others).push(i));
    if (!mine.length) return;
    const touching = others.filter((j) => mine.some((i) => overlaps(i, j)));
    const isUnder = (j: number) => req.mode === 'between' && !!req.under?.(this.faces[j]);
    const below = touching.filter((j) => req.mode !== 'bottom' && !isUnder(j));
    const above = touching.filter((j) => req.mode === 'bottom' || isUnder(j));
    const m = mine.length;
    const allZ = zs;
    let lo = below.length ? Math.max(...below.map((j) => zs[j])) : -Infinity;
    let hi = above.length ? Math.min(...above.map((j) => zs[j])) : Infinity;
    if (!isFinite(lo) && !isFinite(hi)) {
      if (req.mode === 'bottom') {
        hi = Math.min(...allZ);
        lo = hi - m - 1;
      } else {
        lo = Math.max(...allZ);
        hi = lo + m + 1;
      }
    } else if (!isFinite(hi)) hi = lo + m + 1;
    else if (!isFinite(lo)) lo = hi - m - 1;
    if (hi <= lo + 1e-9) {
      // Make room: lift the faces that must stay above, and everything resting on them.
      const delta = lo - hi + m + 1;
      const lifted = new Set<number>(above);
      const queue = [...above];
      while (queue.length) {
        const x = queue.pop()!;
        for (const y of others) {
          if (lifted.has(y) || zs[y] < zs[x]) continue;
          if (overlaps(x, y)) {
            lifted.add(y);
            queue.push(y);
          }
        }
      }
      for (const y of lifted) zs[y] += delta;
      hi += delta;
    }
    const sorted = [...mine].sort((a, b) => (req.reverse ? zs[b] - zs[a] : zs[a] - zs[b]));
    sorted.forEach((i, r) => (zs[i] = lo + ((hi - lo) * (r + 1)) / (m + 1)));
  }

  private need(): Phase {
    if (!this.cur) throw new Error('operation outside of a phase');
    return this.cur;
  }

  setZ(f: Face, z: number) {
    this.zUpd.set(f.id, z);
  }

  /** Split faces passing `sel` along the world line a→b (must lie in their plane). */
  split(sel: (f: Face) => boolean, a: Vector3, b: Vector3): Face[] {
    const k = this.k;
    const pieces: Face[] = [];
    const out: Face[] = [];
    for (const f of this.faces) {
      if (!sel(f)) {
        out.push(f);
        continue;
      }
      const inv = f.M[k].clone().invert();
      const pa = a.clone().applyMatrix4(inv);
      const pb = b.clone().applyMatrix4(inv);
      if (Math.abs(pa.z) > 1e-6 || Math.abs(pb.z) > 1e-6) {
        throw new Error(`fold line is not in the plane of face ${f.id}`);
      }
      const o = { x: pa.x, y: pa.y };
      const d = { x: pb.x - pa.x, y: pb.y - pa.y };
      const [L, R] = splitConvex(f.poly, o, d, 1e-9);
      if (!L || !R) {
        out.push(f);
        pieces.push(f);
        continue;
      }
      const shared = L.filter((p) => R.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9));
      if (shared.length >= 2) this.cuts.push([shared[0], shared[1]]);
      for (const poly of [L, R]) {
        const id = this.ids.next++;
        const g: Face = {
          id,
          poly,
          M: f.M.map((m) => m.clone()),
          z: [...f.z],
          layer: [...f.layer],
          off: f.off.map((o) => o.clone()),
          anc: [id, ...f.anc],
        };
        out.push(g);
        pieces.push(g);
      }
    }
    this.faces = out;
    return pieces;
  }

  addMotion(faces: Face[], pose: PoseFn) {
    const ph = this.need();
    const ids = new Set(faces.map((f) => f.id));
    for (const m of ph.motions) for (const id of ids) if (m.ids.has(id)) throw new Error('face moved twice in one phase');
    ph.motions.push({ ids, pose });
  }

  handle(f: Face, point: P2) {
    this.need().handles.push({ faceId: f.id, point });
  }

  /** Arrow handle at the moving vertex farthest from a line. */
  farHandle(faces: Face[], a: Vector3, u: Vector3) {
    let best: { f: Face; p: P2; d: number } | null = null;
    for (const f of faces) {
      const c = centroid(f.poly);
      for (const p of f.poly) {
        const w = new Vector3(p.x, p.y, 0).applyMatrix4(this.now(f)).sub(a);
        const d = w.sub(u.clone().multiplyScalar(w.dot(u))).length();
        if (!best || d > best.d + 1e-9) best = { f, p: { x: p.x + (c.x - p.x) * 0.12, y: p.y + (c.y - p.y) * 0.12 }, d };
      }
    }
    if (best) this.handle(best.f, best.p);
  }

  mark(a: Vector3, u: Vector3, faces: Face[], kind: FoldKind) {
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const f of faces) {
      for (const p of f.poly) {
        const w = new Vector3(p.x, p.y, 0).applyMatrix4(this.now(f));
        const dist = w.clone().sub(a);
        const t = dist.dot(u);
        const perp = dist.sub(u.clone().multiplyScalar(t)).length();
        if (perp < 1e-6) {
          t0 = Math.min(t0, t);
          t1 = Math.max(t1, t);
        }
      }
    }
    if (!isFinite(t0)) return;
    const pad = 0.05;
    this.need().axes.push({
      a: a.clone().add(u.clone().multiplyScalar(t0 - pad)),
      b: a.clone().add(u.clone().multiplyScalar(t1 + pad)),
      kind,
    });
  }

  /**
   * Rotate a rigid group about a world line. `valley` swings it toward the
   * viewer (+z) first, `mountain` away. Returns the signed angle used.
   */
  rotate(
    faces: Face[],
    a: Vector3,
    u: Vector3,
    kind: FoldKind,
    angle = Math.PI,
    opts: { arrow?: boolean; mark?: boolean } = {},
  ): number {
    const c = this.wc(faces[0]);
    const r = c.clone().sub(a);
    r.sub(u.clone().multiplyScalar(r.dot(u)));
    const dz = u.clone().cross(r).z;
    const signed = ((kind === 'valley') === dz > 0 ? 1 : -1) * angle;
    const a0 = a.clone();
    const u0 = u.clone();
    this.addMotion(faces, (_f, s, M0) => rotAboutLine(a0, u0, signed * s).multiply(M0));
    if (opts.arrow ?? true) this.farHandle(faces, a0, u0);
    if (opts.mark ?? true) this.mark(a0, u0, faces, kind);
    return signed;
  }

  /** A flat (or partial) fold of the selected faces about a world line. */
  fold(o: FoldOptions): FoldRecord {
    const k = this.k;
    const pieces = this.split(o.sel, o.a, o.b);
    const u = o.b.clone().sub(o.a).normalize();
    const sideOf = (w: Vector3) => Math.sign(u.x * (w.y - o.a.y) - u.y * (w.x - o.a.x));
    const want = sideOf(o.side);
    if (want === 0) throw new Error('fold side point lies on the fold line');
    const moving = pieces.filter((f) => sideOf(this.wc(f)) === want);
    if (!moving.length) throw new Error('fold moves nothing');
    const a = o.a.clone();
    const angle = this.rotate(moving, a, u, o.kind, o.angle ?? Math.PI, { arrow: o.arrow, mark: o.mark });

    const zBefore = new Map<number, number>();
    for (const f of moving) zBefore.set(f.id, f.z[k]);
    if (o.restack ?? Math.abs(Math.abs(angle) - Math.PI) < 1e-9) {
      if (o.under) this.stack(moving, 'between', { under: o.under });
      else this.stack(moving, o.kind === 'valley' ? 'top' : 'bottom');
    }
    return { moved: new Set(moving.map((f) => f.id)), a, u, angle, zBefore };
  }

  /** Reverse a previous fold (fully, or a fraction of it). */
  unfold(rec: FoldRecord, fraction = 1, opts: { arrow?: boolean } = {}) {
    const moving = this.descendants(rec.moved);
    const angle = -rec.angle * fraction;
    this.addMotion(moving, (_f, s, M0) => rotAboutLine(rec.a, rec.u, angle * s).multiply(M0));
    if (fraction === 1) for (const f of moving) this.setZ(f, lookupByAnc(f, rec.zBefore)!);
    if (opts.arrow ?? true) this.farHandle(moving, rec.a, rec.u);
  }

  finish(title: string, text: string): Step {
    if (this.cur) throw new Error('unfinished phase');
    const step: Step = { title, text, faces: this.faces, phases: this.phases, creases: [] };
    step.phases.forEach((ph, pi) => {
      ph.motionOf = step.faces.map((f) => ph.motions.findIndex((m) => hasAnc(f, m.ids)));
      ph.arrows = ph.handles
        .map((h) => {
          const fi = step.faces.findIndex((f) => f.anc.includes(h.faceId) && pointInConvex(f.poly, h.point, 1e-7));
          if (fi < 0) return null;
          const pts: Vector3[] = [];
          const N = 40;
          for (let i = 0; i <= N; i++) {
            const M = faceWorld(step, fi, pi, i / N);
            pts.push(new Vector3(h.point.x, h.point.y, 0).applyMatrix4(M));
          }
          return pts;
        })
        .filter((x): x is Vector3[] => !!x);
    });
    step.creases = computeCreases(step, this.cuts);
    return step;
  }
}

// ---------------------------------------------------------------------------
// Evaluation

/** Rotation taking frame A to frame B (rotation parts only). */
function relRot(A: Matrix4, B: Matrix4): Matrix4 {
  return new Matrix4().extractRotation(B).multiply(new Matrix4().extractRotation(A).transpose());
}

/** World matrix of face `fi` at parameter s ∈ [0,1] of phase `pi` (s is already eased). */
export function faceWorld(step: Step, fi: number, pi: number, s: number): Matrix4 {
  const f = step.faces[fi];
  const ph = step.phases[pi];
  const mi = ph.motionOf[fi];
  const M0 = f.M[pi];
  let W = mi >= 0 ? ph.motions[mi].pose(f, s, M0) : M0.clone();
  // the layer offset rides along with the moving face and blends into the next state's offset
  const carried = f.off[pi].clone().applyMatrix4(relRot(M0, W));
  let off: Vector3;
  if (ph.global && ph.bake) {
    const G = ph.global(s);
    W = G.clone().multiply(W);
    off = carried.applyMatrix4(new Matrix4().extractRotation(G)).lerp(f.off[pi + 1], s);
  } else {
    off = carried.lerp(f.off[pi + 1], s);
    if (ph.global) {
      const G = ph.global(s);
      W = G.clone().multiply(W);
      off.applyMatrix4(new Matrix4().extractRotation(G));
    }
  }
  return new Matrix4().makeTranslation(off.x, off.y, off.z).multiply(W);
}

/** Geometry-only transform (no layer offsets), used for tests. */
export function faceGeom(step: Step, fi: number, pi: number, s: number): Matrix4 {
  const f = step.faces[fi];
  const ph = step.phases[pi];
  const mi = ph.motionOf[fi];
  const M = mi >= 0 ? ph.motions[mi].pose(f, s, f.M[pi]) : f.M[pi].clone();
  return ph.global ? ph.global(s).multiply(M) : M;
}

export function stepDuration(step: Step) {
  return step.phases.reduce((a, p) => a + p.duration, 0);
}

/** Locate (phase, local s) for a step-normalized time t. */
export function locate(step: Step, t: number): { pi: number; s: number } {
  const total = stepDuration(step);
  if (!step.phases.length || total === 0) return { pi: -1, s: 1 };
  let acc = 0;
  const T = Math.min(1, Math.max(0, t)) * total;
  for (let i = 0; i < step.phases.length; i++) {
    const d = step.phases[i].duration;
    if (T <= acc + d || i === step.phases.length - 1) {
      return { pi: i, s: d > 0 ? Math.min(1, Math.max(0, (T - acc) / d)) : 1 };
    }
    acc += d;
  }
  return { pi: step.phases.length - 1, s: 1 };
}

function computeCreases(step: Step, cuts: [P2, P2][]): Crease[] {
  const adj = adjacency(step.faces);
  const last = step.phases.length;
  const M0 = step.faces.map((f) => f.M[0]);
  const M1 = step.faces.map((f) => f.M[last]);
  const L0 = step.faces.map((f) => f.layer[0]);
  const L1 = step.faces.map((f) => f.layer[last]);
  return adj.map((e) => {
    const a0 = foldAngle(e, M0, L0);
    const a1 = foldAngle(e, M1, L1);
    const isNew = cuts.some(([p, q]) => segmentOverlap(p, q, e.a, e.b) !== null);
    return { a: e.a, b: e.b, angle: a1, active: isNew || Math.abs(a1 - a0) > 0.03 };
  });
}

export function initialSheet(ids: { next: number }): Face[] {
  const id = ids.next++;
  return [
    {
      id,
      poly: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      // paper (u, v) -> world (u - 0.5, v - 0.5, 0)
      M: [new Matrix4().makeTranslation(-0.5, -0.5, 0)],
      z: [0],
      layer: [0],
      off: [new Vector3()],
      anc: [id],
    },
  ];
}
