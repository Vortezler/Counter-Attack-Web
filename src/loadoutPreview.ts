/**
 * The lobby's Loadout stage: a small studio scene that shows the chosen agent, knife or
 * weapon on a turntable (drag to turn it), plus still thumbnails for the pickers. Loaded on
 * demand when the Loadout tab first opens, so the lobby itself stays free of Three.js.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { dressed, releaseTree } from "./render";
import { hold, humanoid, muzzleOf, pose } from "./characters";
import { loadGunModels } from "./gunModels";
import type { Look, Side } from "./cosmetics";

export type Subject =
  | { kind: "agent"; team: Side; look: Look; weapon: string }
  | { kind: "weapon"; id: string; look: Look };

const IDLE = { moving: false, crouched: false, pitch: -0.12, kickPitch: 0, kickYaw: 0 };

function studio(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene(),
    pmrem = new THREE.PMREMGenerator(renderer),
    env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xe4eef2, 0x3a3428, 1.25));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.6);
  key.position.set(2.4, 4, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -1.6;
  key.shadow.camera.right = key.shadow.camera.top = 1.6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const rim = new THREE.DirectionalLight(0xbfe8ff, 2.2);
  rim.position.set(-3, 2.2, -3.2);
  const fill = new THREE.DirectionalLight(0xc5f16a, 0.45);
  fill.position.set(-2.5, 0.6, 2.5);
  scene.add(key, rim, fill);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.ShadowMaterial({ opacity: 0.38 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  return { scene, env, floor };
}
function makeRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, keep = false) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: keep });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.1;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.setClearColor(0x000000, 0);
  return r;
}
/** Builds the subject in a fresh group, standing on (or floating over) the floor at the origin. */
function build(subject: Subject) {
  const group = new THREE.Group();
  if (subject.kind === "agent") {
    const m = humanoid(subject.team, subject.look.agent),
      item = dressed(subject.weapon, subject.look);
    item.userData.muzzle = muzzleOf(item);
    m.held.add(item);
    hold(m, subject.weapon);
    pose(m, undefined, 0, 0, IDLE, 1);
    group.add(m.root);
    group.userData.agent = m;
    m.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    return group;
  }
  const item = dressed(subject.id, subject.look),
    holder = new THREE.Group();
  holder.add(item);
  // Side-on: the barrel (or blade) points left, the top of the weapon up.
  holder.rotation.y = -Math.PI / 2;
  if (subject.id === "knife") holder.rotation.z = 0;
  item.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  group.add(holder);
  const box = new THREE.Box3().setFromObject(group),
    size = box.getSize(new THREE.Vector3()),
    longest = Math.max(size.x, size.y, size.z) || 1,
    // Small things are scaled up to fill the stage.
    scale = subject.id === "knife" ? 0.95 / longest : Math.min(1.6, 1.25 / longest);
  holder.position.sub(box.getCenter(new THREE.Vector3()));
  group.scale.setScalar(scale);
  group.position.y = 0.55;
  return group;
}
function frameCamera(camera: THREE.PerspectiveCamera, subject: Subject, portrait = false) {
  if (subject.kind === "agent") {
    if (portrait) {
      camera.position.set(0.32, 1.55, -0.95);
      camera.lookAt(0, 1.45, 0);
    } else {
      camera.position.set(0.9, 1.25, -3.0);
      camera.lookAt(0, 0.95, 0);
    }
  } else {
    camera.position.set(0, 0.75, -1.85);
    camera.lookAt(0, 0.55, 0);
  }
}

export class LoadoutStage {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private env: THREE.Texture;
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
  private subject: THREE.Group | null = null;
  private current: Subject | null = null;
  /** The shown subject as JSON: looks share objects with the live loadout, so compare copies. */
  private currentKey = "";
  private yaw = 0.5;
  private spin = 0.35;
  private dragging = false;
  private lastX = 0;
  private raf = 0;
  private clock = 0;
  private last = 0;
  private abort = new AbortController();
  private thumbs: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; env: THREE.Texture; canvas: HTMLCanvasElement } | null = null;
  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = makeRenderer(canvas);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const s = studio(this.renderer);
    this.scene = s.scene;
    this.env = s.env;
    const { signal } = this.abort;
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        this.dragging = true;
        this.lastX = e.clientX;
        canvas.setPointerCapture(e.pointerId);
      },
      { signal },
    );
    canvas.addEventListener(
      "pointermove",
      (e) => {
        if (!this.dragging) return;
        this.yaw += (e.clientX - this.lastX) * 0.012;
        this.lastX = e.clientX;
      },
      { signal },
    );
    const up = () => (this.dragging = false);
    canvas.addEventListener("pointerup", up, { signal });
    canvas.addEventListener("pointercancel", up, { signal });
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
      this.last = now;
      this.clock += dt;
      if (!this.dragging && !matchMedia("(prefers-reduced-motion: reduce)").matches) this.yaw += dt * this.spin;
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }
  /** Loads the textured gun models; the stage works without them, just plainer. */
  static async prepare(base: string) {
    await loadGunModels(base);
  }
  show(subject: Subject) {
    const key = JSON.stringify(subject);
    if (key === this.currentKey) return;
    this.currentKey = key;
    const kindChanged = this.current?.kind !== subject.kind || (this.current as { id?: string })?.id !== (subject as { id?: string }).id;
    this.current = subject;
    if (this.subject) {
      this.scene.remove(this.subject);
      releaseTree(this.subject);
    }
    this.subject = build(subject);
    this.scene.add(this.subject);
    frameCamera(this.camera, subject);
    if (kindChanged) this.yaw = subject.kind === "agent" ? 0.35 : 0.55;
    this.spin = subject.kind === "agent" ? 0.3 : 0.4;
  }
  private draw() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.subject) {
      this.subject.rotation.y = this.yaw;
      const m = this.subject.userData.agent;
      // A slow breath for agents; weapons bob a few millimetres.
      if (m) pose(m, undefined, this.clock, 0, { ...IDLE, pitch: -0.12 + Math.sin(this.clock * 1.4) * 0.03 }, 1 / 60);
      else this.subject.position.y = 0.55 + Math.sin(this.clock * 1.6) * 0.012;
    }
    this.renderer.render(this.scene, this.camera);
  }
  /** A still of `subject` as a data URL, for picker cards. */
  thumbnail(subject: Subject, w = 220, h = 160) {
    if (!this.thumbs) {
      const canvas = document.createElement("canvas"),
        renderer = makeRenderer(canvas, true),
        s = studio(renderer);
      s.floor.visible = false;
      this.thumbs = { renderer, scene: s.scene, env: s.env, canvas };
    }
    const t = this.thumbs,
      cam = new THREE.PerspectiveCamera(subject.kind === "agent" ? 30 : 26, w / h, 0.05, 30);
    t.renderer.setPixelRatio(1);
    t.renderer.setSize(w, h, false);
    const g = build(subject);
    g.rotation.y = subject.kind === "agent" ? 0.42 : 0.3;
    t.scene.add(g);
    frameCamera(cam, subject, subject.kind === "agent");
    t.renderer.render(t.scene, cam);
    const url = t.canvas.toDataURL("image/png");
    t.scene.remove(g);
    releaseTree(g);
    return url;
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    if (this.subject) releaseTree(this.subject);
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.thumbs) {
      this.thumbs.env.dispose();
      this.thumbs.renderer.dispose();
      this.thumbs.renderer.forceContextLoss();
    }
  }
}
