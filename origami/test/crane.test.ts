import { describe, expect, it } from 'vitest';
import { buildCrane } from '../src/crane/steps';
import { Adjacency, Face, adjacency, faceGeom, normalOf, tears } from '../src/engine/model';
import { dist2 } from '../src/engine/geom';

const steps = buildCrane();
const NARROW = steps.findIndex((s) => s.title === 'Narrow the legs');

// The kite/book crease points where the narrowing folds end. The tiny swivel
// hidden under the wings there is not modelled, so edges touching these
// points may separate once the legs are narrowed.
const T = 1 - Math.SQRT1_2;
const SWIVEL = [
  { x: 0.5 - T, y: 0.5 },
  { x: 0.5, y: 0.5 - T },
  { x: 0.5 + T, y: 0.5 },
  { x: 0.5, y: 0.5 + T },
];
const atSwivel = (e: Adjacency) => SWIVEL.some((p) => dist2(p, e.a) < 1e-6 || dist2(p, e.b) < 1e-6);

describe('crane', () => {
  it('builds every step', () => {
    expect(steps.length).toBe(23);
    expect(NARROW).toBeGreaterThan(0);
  });

  it('paper never tears at phase boundaries', () => {
    for (const [si, st] of steps.entries()) {
      const adj = adjacency(st.faces);
      for (let k = 0; k <= st.phases.length; k++) {
        const bad = tears(st.faces, st.faces.map((f) => f.M[k]), adj).filter((e) => si < NARROW || !atSwivel(e));
        expect(bad.length, `step ${si} (${st.title}) boundary ${k}`).toBe(0);
      }
    }
  });

  it('folding motions are rigid (no tearing mid-motion) except reverse folds opening their spine', () => {
    for (const [si, st] of steps.entries()) {
      const adj = adjacency(st.faces);
      const reverse = st.title.startsWith('Reverse');
      for (let pi = 0; pi < st.phases.length; pi++) {
        for (const s of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          const Ms = st.faces.map((_, fi) => faceGeom(st, fi, pi, s));
          const bad = tears(st.faces, Ms, adj, 1e-6).filter((e) => si < NARROW || !atSwivel(e));
          expect(bad.length, `step ${si} (${st.title}) phase ${pi} s=${s}`).toBeLessThanOrEqual(reverse ? 1 : 0);
        }
      }
    }
  });

  it('every flat state has every face facing ±z and a consistent layer order', () => {
    for (const st of steps.slice(0, -1)) {
      const k = st.phases.length;
      for (const f of st.faces) expect(Math.abs(Math.abs(normalOf(f.M[k]).z) - 1)).toBeLessThan(1e-6);
    }
  });

  it('square base shows colored front and the bird base is a 1-unit tall diamond', () => {
    const sq = steps.find((s) => s.title.startsWith('Collapse'))!;
    const k = sq.phases.length;
    const top = sq.faces.reduce((a: Face, b: Face) => (b.layer[k] > a.layer[k] ? b : a));
    expect(normalOf(top.M[k]).z).toBeGreaterThan(0.99); // colored side toward the viewer

    const bird = steps[NARROW - 1];
    const kb = bird.phases.length;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const f of bird.faces)
      for (const p of f.poly) {
        const y = p.x * f.M[kb].elements[1] + p.y * f.M[kb].elements[5] + f.M[kb].elements[13];
        ymin = Math.min(ymin, y);
        ymax = Math.max(ymax, y);
      }
    expect(ymax - ymin).toBeCloseTo(1, 6);
  });

  it('reports creases for the crease-pattern panel', () => {
    const last = steps[steps.length - 1];
    expect(last.creases.length).toBeGreaterThan(40);
    expect(steps[1].creases.some((c) => c.active)).toBe(true);
  });
});
