import { Matrix4, Quaternion, Vector3 } from 'three';

export const v3 = (x: number, y: number, z = 0) => new Vector3(x, y, z);

/** Rotation by `angle` about the line through `a` with unit direction `u`. */
export function rotAboutLine(a: Vector3, u: Vector3, angle: number): Matrix4 {
  const R = new Matrix4().makeRotationAxis(u, angle);
  const T = new Matrix4().makeTranslation(a.x, a.y, a.z);
  const Ti = new Matrix4().makeTranslation(-a.x, -a.y, -a.z);
  return T.multiply(R).multiply(Ti);
}

/**
 * Proper rotation taking the (non-parallel) pair (v1, v2) onto (w1, w2).
 * The pairs must enclose the same angle.
 */
export function rotFromPairs(v1: Vector3, v2: Vector3, w1: Vector3, w2: Vector3): Matrix4 {
  const frame = (a: Vector3, b: Vector3) => {
    const e1 = a.clone().normalize();
    const e2 = b.clone().sub(e1.clone().multiplyScalar(b.dot(e1))).normalize();
    const e3 = e1.clone().cross(e2);
    return new Matrix4().makeBasis(e1, e2, e3);
  };
  const F = frame(v1, v2);
  const G = frame(w1, w2);
  return G.multiply(F.transpose());
}

/** Rotation `R` about pivot `p`: x -> R (x - p) + p. */
export function aboutPivot(R: Matrix4, p: Vector3): Matrix4 {
  const T = new Matrix4().makeTranslation(p.x, p.y, p.z);
  const Ti = new Matrix4().makeTranslation(-p.x, -p.y, -p.z);
  return T.multiply(R).multiply(Ti);
}

export function rotationOnly(M: Matrix4): Matrix4 {
  return new Matrix4().extractRotation(M);
}

export function normalOf(M: Matrix4): Vector3 {
  return new Vector3(0, 0, 1).applyMatrix4(rotationOnly(M)).normalize();
}

/** Interpolate between two rigid transforms (slerp rotation, lerp translation). */
export function lerpRigid(A: Matrix4, B: Matrix4, s: number): Matrix4 {
  const pa = new Vector3();
  const pb = new Vector3();
  const qa = new Quaternion();
  const qb = new Quaternion();
  const sc = new Vector3();
  A.decompose(pa, qa, sc);
  B.decompose(pb, qb, sc);
  const q = qa.clone().slerp(qb, s);
  const p = pa.clone().lerp(pb, s);
  return new Matrix4().compose(p, q, new Vector3(1, 1, 1));
}

export const smooth = (s: number) => {
  const x = Math.min(1, Math.max(0, s));
  return x * x * (3 - 2 * x);
};

export const clamp01 = (s: number) => Math.min(1, Math.max(0, s));

/** Map s in [a,b] to [0,1] with clamping. */
export const window01 = (s: number, a: number, b: number) => clamp01((s - a) / (b - a));
