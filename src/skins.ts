/**
 * Puts a finish on a weapon. The pattern is projected triplanar in the weapon's own frame
 * (barrel along -z), so it wraps the textured gun models and the procedural knives alike
 * without needing their UVs, and stays put as the weapon moves.
 *
 * The base texture still shows through: dark steel and polymer parts take the finish a little
 * darker than the furniture, worn spots reveal bare metal, glowing seams add emissive light and
 * holographic finishes tint their reflections by view angle. "Factory" adds no pattern but
 * gives bare steel a proper metallic sheen.
 */
import * as THREE from "three";
import { finishById, type Finish } from "./cosmetics";
import { paintFinish } from "./skinPatterns";

const textures = new Map<string, { map: THREE.Texture; aux: THREE.Texture }>();
function texturesFor(f: Finish) {
  let t = textures.get(f.id);
  if (!t) {
    const art = paintFinish(f, f.pattern === "fade" ? 256 : 512),
      map = new THREE.CanvasTexture(art.color),
      aux = new THREE.CanvasTexture(art.aux);
    map.colorSpace = THREE.SRGBColorSpace;
    for (const x of [map, aux]) {
      x.wrapS = x.wrapT = f.pattern === "fade" ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      x.anisotropy = 8;
      x.userData.shared = true;
    }
    t = { map, aux };
    textures.set(f.id, t);
  }
  return t;
}
let blank: THREE.Texture | null = null;
const emptyTexture = () => {
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    blank.needsUpdate = true;
    blank.userData.shared = true;
  }
  return blank;
};

const VERT_HEAD = /* glsl */ `
uniform mat4 finFrame;
varying vec3 vFinPos;
varying vec3 vFinNrm;
`;
const VERT_BODY = /* glsl */ `
vFinPos = (finFrame * vec4(transformed, 1.0)).xyz;
vFinNrm = normalize(mat3(finFrame) * objectNormal);
`;
const FRAG_HEAD = /* glsl */ `
uniform sampler2D finMap;
uniform sampler2D finAux;
uniform float finScale;
uniform float finCover;
uniform float finMetal;
uniform float finRough;
uniform float finGlow;
uniform float finSheen;
uniform float finWear;
uniform float finFade;
uniform float finFactory;
uniform vec2 finRange;
varying vec3 vFinPos;
varying vec3 vFinNrm;
float finCov;
float finBare;
float finSteel;
vec3 finColor;
vec4 finAuxS;
`;
// After the base colour (and any vertex colours) are known.
const FRAG_COLOR = /* glsl */ `
{
  vec3 w = abs(normalize(vFinNrm));
  w = pow(w, vec3(5.0));
  w /= (w.x + w.y + w.z + 1e-5);
  vec3 p = vFinPos * finScale;
  vec4 c;
  if (finFade > 0.5) {
    float u = clamp((finRange.y - vFinPos.z) / max(1e-4, finRange.y - finRange.x), 0.0, 1.0);
    c = texture2D(finMap, vec2(u, fract(0.5 + vFinPos.y * 3.0)));
    finAuxS = vec4(0.0);
  } else {
    c = texture2D(finMap, p.zy) * w.x + texture2D(finMap, p.zx) * w.y + texture2D(finMap, p.xy) * w.z;
    finAuxS = texture2D(finAux, p.zy) * w.x + texture2D(finAux, p.zx) * w.y + texture2D(finAux, p.xy) * w.z;
  }
  vec3 base = diffuseColor.rgb;
  float hi = max(base.r, max(base.g, base.b)), lo = min(base.r, min(base.g, base.b));
  float sat = (hi - lo) / (hi + 1e-4);
  // Neutral dark parts are steel or polymer; saturated ones are wood or painted furniture.
  finSteel = 1.0 - smoothstep(0.16, 0.38, sat);
  finBare = finAuxS.g * finWear * finCover;
  finCov = finCover * c.a * (1.0 - finBare);
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  float detail = clamp(0.8 + (lum - 0.06) * 1.6, 0.68, 1.2);
  finColor = c.rgb * mix(1.0, 0.8, finSteel * (1.0 - finFade)) * detail;
  diffuseColor.rgb = mix(base, finColor, finCov);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.52, 0.53, 0.54), finBare);
  if (finFactory > 0.5) {
    diffuseColor.rgb = mix(base, base * vec3(0.94, 1.0, 1.08) * 1.25, finSteel);
    // Red-stained furniture reads as oiled wood: warmer, with grain running along the gun.
    float wood = smoothstep(0.45, 0.75, sat) * step(base.g * 2.5, base.r);
    float grain = 0.82 + 0.18 * sin(vFinPos.z * 210.0 + sin(vFinPos.y * 70.0 + vFinPos.z * 9.0) * 2.6);
    vec3 oak = vec3(base.r * 0.95, base.r * 0.36, base.r * 0.1) * grain * 1.15;
    diffuseColor.rgb = mix(diffuseColor.rgb, oak, wood);
  }
}
`;
const FRAG_ROUGH = /* glsl */ `
roughnessFactor = mix(roughnessFactor, finRough, finCov);
roughnessFactor = mix(roughnessFactor, 0.38, finBare);
if (finFactory > 0.5) roughnessFactor = mix(roughnessFactor, 0.4, finSteel);
`;
const FRAG_METAL = /* glsl */ `
metalnessFactor = mix(metalnessFactor, finMetal, finCov);
metalnessFactor = mix(metalnessFactor, 1.0, finBare);
if (finFactory > 0.5) metalnessFactor = mix(metalnessFactor, 0.62, finSteel);
`;
const FRAG_LIGHT = /* glsl */ `
totalEmissiveRadiance += finColor * finAuxS.r * finGlow * finCov;
if (finSheen > 0.0) {
  vec3 V = normalize(vViewPosition);
  float fres = 1.0 - abs(dot(normal, V));
  float g = dot(finColor, vec3(0.333));
  float h = fract(g * 0.9 + fres * 1.2 + dot(normal, vec3(0.25, 0.55, 0.3)) * 0.5 + vFinPos.z * 1.4);
  vec3 rainbow = 0.6 + 0.4 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));
  // Chrome face-on; the colours bloom toward glancing angles, like a hologram.
  diffuseColor.rgb = mix(diffuseColor.rgb, rainbow * (0.55 + g * 0.45), finSheen * finCov * (0.28 + 0.6 * fres));
}
`;
/** One shared patch: uniforms come from each material, so every skinned weapon shares a program. */
function patch(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms) {
  const u = this.userData.fin as Record<string, THREE.IUniform>;
  Object.assign(shader.uniforms, u);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\n" + VERT_HEAD)
    .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERT_BODY);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\n" + FRAG_HEAD)
    .replace("#include <color_fragment>", "#include <color_fragment>\n" + FRAG_COLOR)
    .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n" + FRAG_ROUGH)
    .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n" + FRAG_METAL)
    .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + FRAG_LIGHT);
}
const cacheKey = () => "cs-web-finish-v1";
/** Gives `material` a copy that wears the finish; `frame` maps mesh space into weapon space. */
function skinned(material: THREE.Material, f: Finish, frame: THREE.Matrix4, range: THREE.Vector2) {
  const m = material.clone() as THREE.MeshStandardMaterial;
  const factory = f.pattern === "factory",
    tex = factory ? null : texturesFor(f);
  m.userData = {
    fin: {
      finFrame: { value: frame },
      finMap: { value: tex?.map ?? emptyTexture() },
      finAux: { value: tex?.aux ?? emptyTexture() },
      finScale: { value: f.scale },
      finCover: { value: factory ? 0 : 1 },
      finMetal: { value: f.metal },
      finRough: { value: f.rough },
      finGlow: { value: f.glow ?? 0 },
      finSheen: { value: f.sheen ?? 0 },
      finWear: { value: f.wear ?? 0 },
      finFade: { value: f.pattern === "fade" ? 1 : 0 },
      finFactory: { value: factory ? 1 : 0 },
      finRange: { value: range },
    },
    finish: f.id,
  };
  m.onBeforeCompile = patch;
  m.customProgramCacheKey = cacheKey;
  return m;
}
/** Copies the finish (if any) from one material onto a clone of it, e.g. for clipped copies. */
export function keepFinish(from: THREE.Material, to: THREE.Material) {
  if (!from.userData.fin) return;
  to.userData.fin = from.userData.fin;
  to.userData.finish = from.userData.finish;
  to.onBeforeCompile = patch;
  to.customProgramCacheKey = cacheKey;
}
/**
 * Applies finish `id` to the weapon under `root`. Knives skin only their blade flats; guns
 * skin everything. Factory on a knife changes nothing; on a gun it upgrades bare steel.
 */
export function applyFinish(root: THREE.Object3D, id: string, kind: "gun" | "knife") {
  const f = finishById.get(id) ?? finishById.get("factory")!;
  if (kind === "knife" && f.pattern === "factory") return;
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(),
    targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (kind === "gun" || m.userData.blade)) targets.push(m);
  });
  // The fade runs along the length of what it covers, muzzle (or tip) to stock (or tang).
  const box = new THREE.Box3();
  for (const m of targets) box.expandByObject(m);
  box.applyMatrix4(inverse);
  const range = new THREE.Vector2(box.min.z, box.max.z);
  for (const m of targets) {
    const frame = inverse.clone().multiply(m.matrixWorld);
    m.material = Array.isArray(m.material) ? m.material.map((x) => skinned(x, f, frame, range)) : skinned(m.material, f, frame, range);
  }
  root.userData.finish = f.id;
}
