/**
 * Blood on hits: a burst of droplets that carries on along the bullet under gravity, a short
 * red mist at the wound, and a splat decal on the wall or floor behind the victim.
 */
import * as THREE from "three";
import type { Vec3 } from "./world";

const DROPS = 320,
  MISTS = 8,
  SPLATS = 72,
  FORWARD = new THREE.Vector3(0, 0, 1);

function splatTexture(seed: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  let n = seed;
  const rng = () => (n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296;
  const blob = (x: number, y: number, r: number, a: number) => {
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.beginPath();
    g.ellipse(x, y, r, r * (0.7 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
    g.fill();
  };
  // Core pool, then lobes, streaks thrown outward and fine satellite droplets.
  for (let i = 0; i < 9; i++)
    blob(64 + (rng() - 0.5) * 26, 64 + (rng() - 0.5) * 26, 10 + rng() * 14, 0.9);
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2,
      len = 26 + rng() * 30;
    for (let s = 0; s < 6; s++) {
      const d = 14 + (len * s) / 6;
      blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 5.5 - s * 0.75, 0.85);
    }
  }
  for (let i = 0; i < 46; i++) {
    const a = rng() * Math.PI * 2,
      d = 30 + rng() * 30;
    blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 0.8 + rng() * 2.4, 0.8);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BloodFx {
  private drops: THREE.InstancedMesh;
  private pos = new Float32Array(DROPS * 3);
  private vel = new Float32Array(DROPS * 3);
  private life = new Float32Array(DROPS);
  private nextDrop = 0;
  private mists: { sprite: THREE.Sprite; ttl: number; size: number }[] = [];
  private nextMist = 0;
  private splats: THREE.Mesh[] = [];
  private nextSplat = 0;
  private materials: THREE.MeshStandardMaterial[] = [];
  private seed = 1;
  private matrix = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private heading = new THREE.Vector3();
  constructor(
    scene: THREE.Scene,
    puff: THREE.Texture,
  ) {
    this.drops = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: 0x6a0b08 }),
      DROPS,
    );
    this.drops.frustumCulled = false;
    this.drops.count = DROPS;
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < DROPS; i++) this.drops.setMatrixAt(i, this.matrix);
    scene.add(this.drops);
    for (let i = 0; i < MISTS; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: puff,
          color: 0x8a1410,
          transparent: true,
          depthWrite: false,
          opacity: 0,
        }),
      );
      sprite.visible = false;
      scene.add(sprite);
      this.mists.push({ sprite, ttl: 0, size: 0 });
    }
    for (let i = 0; i < 3; i++)
      this.materials.push(
        new THREE.MeshStandardMaterial({
          map: splatTexture(17 + i * 101),
          color: 0x7c0f0b,
          roughness: 0.35,
          metalness: 0.05,
          transparent: true,
          alphaTest: 0.08,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        }),
      );
    const plane = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < SPLATS; i++) {
      const m = new THREE.Mesh(plane, this.materials[i % 3]);
      m.visible = false;
      m.receiveShadow = true;
      m.renderOrder = 1;
      scene.add(m);
      this.splats.push(m);
    }
  }
  private rng() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  /** One bullet or knife hit: `dir` is the travel direction; head hits bleed harder. */
  hit(at: Vec3, dir: Vec3, end?: Vec3, normal?: Vec3, head = false) {
    const count = head ? 22 : 13,
      speed = head ? 4.2 : 3;
    for (let k = 0; k < count; k++) {
      const i = this.nextDrop++ % DROPS,
        // A few droplets spit back out of the entry wound toward the shooter.
        back = k < 3 ? -0.35 : 1,
        v = speed * (0.4 + this.rng()) * back;
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set(
        [
          dir.x * v + (this.rng() - 0.5) * 1.6,
          dir.y * v + (this.rng() - 0.3) * 1.4,
          dir.z * v + (this.rng() - 0.5) * 1.6,
        ],
        i * 3,
      );
      this.life[i] = 0.3 + this.rng() * 0.35;
    }
    const mist = this.mists[this.nextMist++ % MISTS];
    mist.sprite.position.set(at.x + dir.x * 0.12, at.y + dir.y * 0.12, at.z + dir.z * 0.12);
    mist.ttl = 0.32;
    mist.size = head ? 0.75 : 0.5;
    mist.sprite.visible = true;
    if (end && normal) {
      const m = this.splats[this.nextSplat++ % SPLATS],
        size = (head ? 0.85 : 0.55) * (0.8 + this.rng() * 0.45);
      m.position.set(end.x + normal.x * 0.012, end.y + normal.y * 0.012, end.z + normal.z * 0.012);
      this.v.set(normal.x, normal.y, normal.z);
      m.lookAt(m.position.clone().add(this.v));
      m.rotateZ(this.rng() * Math.PI * 2);
      m.scale.set(size, size * (0.75 + this.rng() * 0.5), 1);
      m.visible = true;
    }
  }
  update(dt: number) {
    let live = false;
    for (let i = 0; i < DROPS; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= 9.8 * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      const r = this.life[i] > 0 ? 0.011 * Math.min(1, this.life[i] * 5) : 0;
      this.v.fromArray(this.pos, o);
      // Stretch each droplet along its velocity, like a streak caught mid-flight.
      this.s.set(r, r, r * 2.6);
      this.q.setFromUnitVectors(
        FORWARD,
        this.heading.fromArray(this.vel, o).normalize(),
      );
      this.drops.setMatrixAt(i, this.matrix.compose(this.v, this.q, this.s));
      live = true;
    }
    if (live) this.drops.instanceMatrix.needsUpdate = true;
    for (const m of this.mists) {
      if (m.ttl <= 0) continue;
      m.ttl -= dt;
      const k = Math.max(0, m.ttl / 0.32);
      m.sprite.visible = m.ttl > 0;
      m.sprite.scale.setScalar(m.size * (1.6 - k));
      (m.sprite.material as THREE.SpriteMaterial).opacity = 0.55 * k;
      m.sprite.position.y -= dt * 0.25;
    }
  }
}
