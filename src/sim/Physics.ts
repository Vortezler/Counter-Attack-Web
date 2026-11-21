import R from "@dimforge/rapier3d-compat";
import type { MapDef, Vec3 } from "../world";
import { DT, GRAVITY, U, type Group } from "./rules";
const groups = (member: number, mask: number) => (member << 16) | mask;
const WORLD = groups(1, 0xffff),
  MOVE = groups(2, 3),
  HIT = groups(4, 8),
  UTILITY = groups(16, 1);
let initialized: Promise<void> | undefined;
export const initPhysics = () => (initialized ??= R.init());
export interface Body {
  collider: R.Collider;
  hitboxes: R.Collider[];
  crouch: boolean;
}
export class Physics {
  world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
  controller = this.world.createCharacterController(0.012);
  materials = new Map<number, string>();
  victims = new Map<number, { id: number; group: Group }>();
  private standingShape = new R.Capsule(20 * U, 16 * U);
  constructor(map: MapDef) {
    this.world.timestep = DT;
    this.controller.enableAutostep(18 * U, 0.2, false);
    this.controller.enableSnapToGround(0.2);
    this.controller.setMaxSlopeClimbAngle((45.57 * Math.PI) / 180);
    for (const b of map.boxes) {
      const c = this.world.createCollider(
        R.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2)
          .setTranslation(b.x, b.y, b.z)
          .setCollisionGroups(WORLD),
      );
      this.materials.set(c.handle, b.mat);
    }
    for (const r of map.ramps) {
      const verts: number[] = [];
      for (const x of [-1, 1])
        for (const z of [-1, 1]) {
          const high =
            r.up === "N"
              ? z < 0
              : r.up === "S"
                ? z > 0
                : r.up === "E"
                  ? x > 0
                  : x < 0;
          verts.push((x * r.w) / 2, 0, (z * r.d) / 2);
          if (high) verts.push((x * r.w) / 2, r.h, (z * r.d) / 2);
        }
      const desc = R.ColliderDesc.convexHull(new Float32Array(verts));
      if (desc) {
        const c = this.world.createCollider(
          desc.setTranslation(r.x, r.y, r.z).setCollisionGroups(WORLD),
        );
        this.materials.set(c.handle, r.mat);
      }
    }
    this.world.step();
  }
  createPlayer(id: number, pos: Vec3): Body {
    const collider = this.world.createCollider(
      R.ColliderDesc.capsule(20 * U, 16 * U).setCollisionGroups(MOVE),
    );
    const hitboxes: R.Collider[] = [];
    const parts: [Group, R.ColliderDesc][] = [
      ["head", R.ColliderDesc.ball(0.18)],
      ["chest", R.ColliderDesc.cuboid(0.23, 0.21, 0.17)],
      ["stomach", R.ColliderDesc.cuboid(0.21, 0.17, 0.16)],
      ["leg", R.ColliderDesc.capsule(0.2, 0.11)],
      ["leg", R.ColliderDesc.capsule(0.2, 0.11)],
      ["arm", R.ColliderDesc.capsule(0.15, 0.09)],
      ["arm", R.ColliderDesc.capsule(0.15, 0.09)],
    ];
    for (const [group, desc] of parts) {
      const hit = this.world.createCollider(
        desc.setSensor(true).setCollisionGroups(HIT),
      );
      hitboxes.push(hit);
      this.victims.set(hit.handle, { id, group });
    }
    const body = { collider, hitboxes, crouch: false };
    this.place(body, pos, 0);
    return body;
  }
  enable(b: Body, enabled: boolean) {
    b.collider.setEnabled(enabled);
    for (const h of b.hitboxes) h.setEnabled(enabled);
  }
  place(b: Body, p: Vec3, yaw: number) {
    const scale = b.crouch ? 0.75 : 1;
    const levels = [1.61, 1.27, 0.91, 0.43, 0.43, 1.16, 1.16],
      offsets = [0, 0, 0, -0.13, 0.13, -0.29, 0.29];
    b.collider.setTranslation({
      x: p.x,
      y: p.y + (b.crouch ? 27 : 36) * U,
      z: p.z,
    });
    const cos = Math.cos(yaw),
      sin = Math.sin(yaw);
    b.hitboxes.forEach((h, i) =>
      h.setTranslation({
        x: p.x + cos * offsets[i],
        y: p.y + levels[i] * scale,
        z: p.z + sin * offsets[i],
      }),
    );
  }
  move(b: Body, p: Vec3, yaw: number, crouch: boolean, delta: Vec3) {
    if (
      crouch !== b.crouch &&
      (crouch ||
        !this.world.intersectionWithShape(
          { x: p.x, y: p.y + 36 * U + 0.012, z: p.z },
          { x: 0, y: 0, z: 0, w: 1 },
          this.standingShape,
          undefined,
          MOVE,
          b.collider,
        ))
    ) {
      b.crouch = crouch;
      b.collider.setHalfHeight((crouch ? 11 : 20) * U);
      this.place(b, p, yaw);
    }
    this.controller.computeColliderMovement(b.collider, delta, undefined, MOVE);
    const d = this.controller.computedMovement();
    p.x += d.x;
    p.y += d.y;
    p.z += d.z;
    this.place(b, p, yaw);
    return this.controller.computedGrounded();
  }
  ray(o: Vec3, d: Vec3, max: number) {
    return this.world.castRay(
      new R.Ray(o, d),
      max,
      true,
      undefined,
      groups(8, 1),
    );
  }
  trace(o: Vec3, d: Vec3, max: number, ignore: Set<number>) {
    return this.world.castRayAndGetNormal(
      new R.Ray(o, d),
      max,
      true,
      undefined,
      groups(8, 5),
      undefined,
      undefined,
      (c) => {
        const v = this.victims.get(c.handle);
        return !v || !ignore.has(v.id);
      },
    );
  }
  thickness(c: R.Collider, entry: Vec3, d: Vec3) {
    const limit = 128 * U + 0.001;
    const end = {
      x: entry.x + d.x * limit,
      y: entry.y + d.y * limit,
      z: entry.z + d.z * limit,
    };
    if (c.containsPoint(end)) return Infinity;
    const dist = c.castRay(
      new R.Ray(end, { x: -d.x, y: -d.y, z: -d.z }),
      limit,
      false,
    );
    return dist < 0 ? Infinity : Math.max(0, limit - dist);
  }
  grenade(p: Vec3, v: Vec3) {
    const b = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setLinvel(v.x, v.y, v.z)
        .setLinearDamping(0.1)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      R.ColliderDesc.ball(0.07)
        .setRestitution(0.4)
        .setFriction(0.6)
        .setCollisionGroups(UTILITY),
      b,
    );
    return b;
  }
  free() {
    this.world.free();
  }
}
