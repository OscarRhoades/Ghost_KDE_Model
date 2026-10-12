import {
  AmbientLight,
  BackSide,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  FrontSide,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LAYER_GAP, Step, faceWorld, locate } from '../engine/model';
import { smooth } from '../engine/mat';

export interface ViewOptions {
  arrows: boolean;
  foldLines: boolean;
  creaseLines: boolean;
}

const COLORS = {
  front: '#c8463d',
  back: '#f4efe4',
  edge: '#2a2522',
  arrow: '#1f6feb',
  valley: '#1f6feb',
  mountain: '#d0342c',
};

interface FaceMeshes {
  front: Mesh;
  back: Mesh;
  edge: LineLoop;
}

export class PaperView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  private paper = new Group();
  private overlay = new Group();
  private meshes: FaceMeshes[] = [];
  private arrowGroups: Group[][] = [];
  private axisGroups: Group[][] = [];
  private step: Step | null = null;
  private frontMat: MeshStandardMaterial;
  private backMat: MeshStandardMaterial;
  private edgeMat: LineBasicMaterial;
  private arrowMat: MeshBasicMaterial;
  opts: ViewOptions = { arrows: true, foldLines: true, creaseLines: true };

  constructor(private host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(35, 1, 0.01, 50);
    this.resetView();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 0.05, 0);
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 8;

    this.scene.add(new HemisphereLight(0xffffff, 0xd9cfc2, 1.6));
    this.scene.add(new AmbientLight(0xffffff, 0.35));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(1.5, 2.5, 4);
    this.scene.add(key);
    const rim = new DirectionalLight(0xffffff, 0.9);
    rim.position.set(-2, -1, -3.5);
    this.scene.add(rim);

    this.frontMat = new MeshStandardMaterial({
      color: new Color(COLORS.front),
      roughness: 0.82,
      metalness: 0,
      side: FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.backMat = new MeshStandardMaterial({
      color: new Color(COLORS.back),
      roughness: 0.9,
      metalness: 0,
      side: BackSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.edgeMat = new LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.38 });
    this.arrowMat = new MeshBasicMaterial({ color: COLORS.arrow, transparent: true, opacity: 0.95, depthTest: false });

    this.scene.add(this.paper);
    this.scene.add(this.overlay);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  resetView() {
    this.camera.position.set(0, 0.05, 2.7);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0.05, 0);
    if (this.controls) {
      this.controls.target.set(0, 0.05, 0);
      this.controls.update();
    }
  }

  setColors(front: string, back: string) {
    this.frontMat.color.set(front);
    this.backMat.color.set(back);
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the 1×1 sheet comfortably in frame on narrow screens
    this.camera.fov = w / h < 0.9 ? 35 / Math.max(0.55, w / h / 0.9) : 35;
    this.camera.updateProjectionMatrix();
  }

  setStep(step: Step) {
    if (this.step === step) return;
    this.step = step;
    for (const m of this.meshes) {
      m.front.geometry.dispose();
      m.edge.geometry.dispose();
    }
    this.paper.clear();
    for (const g of this.overlay.children) disposeTree(g);
    this.overlay.clear();
    this.meshes = step.faces.map((f) => {
      const geo = new BufferGeometry();
      const pos: number[] = [];
      for (let i = 1; i + 1 < f.poly.length; i++) {
        for (const p of [f.poly[0], f.poly[i], f.poly[i + 1]]) pos.push(p.x, p.y, 0);
      }
      geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const eg = new BufferGeometry();
      eg.setAttribute('position', new Float32BufferAttribute(f.poly.flatMap((p) => [p.x, p.y, 0]), 3));
      const front = new Mesh(geo, this.frontMat);
      const back = new Mesh(geo, this.backMat);
      const edge = new LineLoop(eg, this.edgeMat);
      for (const o of [front, back, edge]) {
        o.matrixAutoUpdate = false;
        this.paper.add(o);
      }
      return { front, back, edge };
    });

    // Arrows and fold lines per phase.
    this.arrowGroups = step.phases.map((ph) =>
      ph.arrows.map((pts) => {
        const g = makeArrow(pts, this.arrowMat);
        this.overlay.add(g);
        return g;
      }),
    );
    this.axisGroups = step.phases.map((ph, pi) =>
      ph.axes.map((ax) => {
        const top = Math.max(...step.faces.map((f) => f.layer[pi])) * LAYER_GAP + 0.004;
        const a = ax.a.clone().setZ(ax.a.z + top);
        const b = ax.b.clone().setZ(ax.b.z + top);
        const geo = new BufferGeometry().setFromPoints([a, b]);
        const mat = new LineDashedMaterial({
          color: ax.kind === 'valley' ? COLORS.valley : COLORS.mountain,
          dashSize: ax.kind === 'valley' ? 0.03 : 0.05,
          gapSize: ax.kind === 'valley' ? 0.022 : 0.016,
          transparent: true,
          depthTest: false,
          linewidth: 2,
        });
        const line = new Line(geo, mat);
        line.computeLineDistances();
        const g = new Group();
        g.add(line);
        this.overlay.add(g);
        return g;
      }),
    );
  }

  /** Pose the paper for normalized step time t ∈ [0, 1]. */
  update(t: number, playing: boolean) {
    const step = this.step;
    if (!step) return;
    const { pi, s } = locate(step, t);
    const e = smooth(s);
    step.faces.forEach((f, fi) => {
      const M = pi < 0 ? f.M[0].clone() : faceWorld(step, fi, pi, e);
      if (pi < 0) M.premultiply(new Matrix4().makeTranslation(f.off[0].x, f.off[0].y, f.off[0].z));
      const m = this.meshes[fi];
      for (const o of [m.front, m.back, m.edge]) {
        o.matrix.copy(M);
        o.matrixWorldNeedsUpdate = true;
      }
      m.edge.visible = this.opts.creaseLines;
    });

    const fade = playing ? (s < 0.8 ? 1 : Math.max(0, (1 - s) / 0.2)) : s >= 1 ? 0 : 1;
    this.arrowGroups.forEach((gs, i) =>
      gs.forEach((g) => (g.visible = this.opts.arrows && i === pi && fade > 0.01)),
    );
    this.arrowMat.opacity = 0.95 * fade;
    this.axisGroups.forEach((gs, i) =>
      gs.forEach((g) => {
        g.visible = this.opts.foldLines && i === pi && fade > 0.01;
        g.children.forEach((c) => (((c as Line).material as LineDashedMaterial).opacity = fade));
      }),
    );
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

/**
 * Diagram-style arrow: a curved arc in the plane of the model from where the
 * handle starts to where it lands (true 3D paths look like straight lines
 * when the fold axis lies in the screen plane).
 */
function makeArrow(pts: Vector3[], mat: MeshBasicMaterial): Group {
  const g = new Group();
  const a = pts[0];
  const b = pts[pts.length - 1];
  const chord = new Vector3(b.x - a.x, b.y - a.y, 0);
  const L = chord.length();
  let path: Vector3[];
  if (L < 0.04) {
    path = pts.map((p) => p.clone().add(new Vector3(0, 0, 0.012)));
  } else {
    const z = Math.max(a.z, b.z) + 0.015;
    const mid = new Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, z);
    const n = new Vector3(-chord.y, chord.x, 0).normalize();
    // bulge away from the model's center so the arrow sits beside the paper
    if (n.dot(new Vector3(mid.x, mid.y - 0.05, 0)) < 0) n.negate();
    if (Math.abs(n.dot(new Vector3(mid.x, mid.y - 0.05, 0))) < 1e-3 && n.y > 0) n.negate();
    const ctrl = mid.clone().add(n.multiplyScalar(0.55 * L * 0.5));
    const A = new Vector3(a.x, a.y, z);
    const B = new Vector3(b.x, b.y, z);
    path = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const p = A.clone()
        .multiplyScalar((1 - t) * (1 - t))
        .add(ctrl.clone().multiplyScalar(2 * t * (1 - t)))
        .add(B.clone().multiplyScalar(t * t));
      path.push(p);
    }
  }
  const curve = new CatmullRomCurve3(path);
  const len = curve.getLength();
  if (len < 0.02) return g;
  const head = Math.min(0.055, len * 0.3);
  const tEnd = 1 - head / len;
  const body = new CatmullRomCurve3(curve.getSpacedPoints(60).filter((_, i) => i / 60 <= tEnd));
  g.add(new Mesh(new TubeGeometry(body, 64, 0.006, 8, false), mat));
  const tip = curve.getPointAt(1);
  const base = curve.getPointAt(tEnd);
  const cone = new Mesh(new ConeGeometry(0.021, head, 16), mat);
  const dir = tip.clone().sub(base).normalize();
  cone.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir));
  cone.position.copy(base.clone().add(tip).multiplyScalar(0.5));
  g.add(cone);
  g.children.forEach((c) => (c.renderOrder = 10));
  return g;
}

function disposeTree(o: { traverse: (cb: (x: any) => void) => void }) {
  o.traverse((x) => {
    if (x.geometry) x.geometry.dispose();
    if (x.material && x.material instanceof LineDashedMaterial) x.material.dispose();
  });
}
