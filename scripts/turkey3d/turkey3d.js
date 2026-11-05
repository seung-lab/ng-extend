/**
 * The Thanksgiving turkey's 3D part (Ames 2026-11-02), built into
 * static/thanksgiving/turkey3d.js. Pyr only loads that file in Thanksgiving
 * week (src/util/turkey.ts), so three.js never weighs on the rest of the year.
 *
 * The model and its rig come from Ames's game (amyleesterling/
 * cocos-pooping-unicorn-game, turkey.js and assets/turkey.glb): the model
 * has no bones, so bones are added by hand and each vertex is given to the
 * body, head, wings, tail fan or feet by where it sits.
 *
 * Rebuild after a change: see scripts/turkey3d/build.mjs.
 */
import {
  Bone, Clock, DirectionalLight, Float32BufferAttribute, Group, HemisphereLight, MathUtils,
  PerspectiveCamera, Scene, Skeleton, SkinnedMesh, SRGBColorSpace, Uint16BufferAttribute, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const S = 1.5 / 0.929687977, ground = -0.464843988;
const smooth = (a, b, x) => MathUtils.smoothstep(x, a, b);
const at = (x, y, z, rest) => {
  const v = { x: x * S, y: (y - ground) * S, z: z * S };
  return rest ? [v.x - rest[0], v.y - rest[1], v.z - rest[2]] : [v.x, v.y, v.z];
};

function rig(gltf) {
  const root = new Group(), base = new Bone();
  root.add(base);
  const bones = [base];
  const bone = (parent, p) => { const b = new Bone(); b.position.set(p[0], p[1], p[2]); parent.add(b); bones.push(b); return b; };
  const rest = at(0, -0.2, 0);
  const body = bone(base, rest), head = bone(body, at(0, 0, 0.07, rest));
  const left = bone(body, at(-0.2, -0.13, 0.03, rest)), right = bone(body, at(0.2, -0.13, 0.03, rest));
  const tail = bone(body, at(0, -0.25, -0.23, rest));
  const feet = [bone(body, at(-0.1, -0.38, 0.04, rest)), bone(body, at(0.1, -0.38, 0.04, rest))];
  const footRest = feet.map(b => b.position.clone());
  const skeleton = new Skeleton(bones);
  gltf.scene.updateMatrixWorld(true);
  let meshes = 0;
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld); g.scale(S, S, S); g.translate(0, -ground * S, 0);
    const pos = g.attributes.position, ix = new Uint16Array(pos.count * 4), w = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / S, y = pos.getY(i) / S + ground, z = pos.getZ(i) / S;
      const fan = 1 - smooth(-0.235, -0.17, z), face = (1 - fan) * smooth(-0.06, 0.075, y);
      const foot = (1 - fan) * (1 - face) * (1 - smooth(-0.37, -0.285, y));
      const wing = (1 - fan) * (1 - face) * (1 - foot) * smooth(0.12, 0.23, Math.abs(x)) * (1 - smooth(-0.07, 0.025, y));
      const values = [[1, Math.max(0, 1 - fan - face - foot - wing)], [2, face], [5, fan], [x < 0 ? 3 : 4, wing], [x < 0 ? 6 : 7, foot]]
        .sort((a, b) => b[1] - a[1]);
      const total = values.slice(0, 4).reduce((s, a) => s + a[1], 0);
      for (let j = 0; j < 4; j++) { ix[i * 4 + j] = values[j][0]; w[i * 4 + j] = values[j][1] / total; }
    }
    g.setAttribute('skinIndex', new Uint16BufferAttribute(ix, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(w, 4));
    const m = new SkinnedMesh(g, o.material.clone());
    m.frustumCulled = false;
    root.add(m); root.updateMatrixWorld(true); m.bind(skeleton);
    meshes++;
  });
  if (!meshes) throw Error('The turkey has no mesh.');

  // A reaction: 'hop' (clicked) flaps and hops; 'gobble' flaps, fans the
  // tail and bobs the head with both feet on the ground.
  let reactionAt = -100, kind = 'hop', phase = 0;
  function react(time, k) { reactionAt = time; kind = k; }
  /** walking: 0 (standing) to 1 (full stride); yaw: the way it faces. */
  function update(time, dt, walking, yaw) {
    root.rotation.y += Math.atan2(Math.sin(yaw - root.rotation.y), Math.cos(yaw - root.rotation.y)) * (1 - Math.exp(-6 * dt));
    phase += walking * dt * 11;
    const len = kind === 'gobble' ? 2.2 : 1.2, age = time - reactionAt;
    const reaction = age >= 0 && age < len ? Math.sin((age / len) * Math.PI) : 0;
    const hop = kind === 'hop' ? reaction * Math.abs(Math.sin(age * 7)) * 0.16 : 0;
    const bob = Math.abs(Math.sin(phase)) * 0.025 * walking;
    body.position.set(rest[0], rest[1] + bob + hop, rest[2]);
    body.rotation.z = Math.sin(phase) * 0.045 * walking;
    feet.forEach((foot, i) => {
      foot.position.copy(footRest[i]);
      foot.position.y += Math.max(0, Math.sin(phase + i * Math.PI)) * 0.1 * walking - bob;
      // A lifted foot swings forward (the game's had it swinging back).
      foot.position.z -= Math.cos(phase + i * Math.PI) * 0.055 * walking;
    });
    left.rotation.z = -reaction * (0.15 + Math.abs(Math.sin(age * 16)) * 0.35);
    right.rotation.z = -left.rotation.z;
    const fanOut = kind === 'gobble' ? reaction * 0.25 : 0;
    tail.rotation.x = -fanOut;
    tail.scale.setScalar(1 + fanOut * 0.35);
    tail.rotation.y = Math.sin(time * 1.7) * 0.035 + reaction * Math.sin(age * 12) * 0.075;
    // The gobble: quick nods of the head, forward and back.
    const nod = kind === 'gobble' ? reaction * Math.sin(age * 26) * 0.22 : 0;
    head.rotation.set(Math.sin(time * 2.1) * 0.018 + nod, 0, Math.sin(time * 1.3) * 0.025);
    root.updateMatrixWorld(true);
  }
  return { root, update, react };
}

/**
 * Draws the turkey into `canvas` (sized by the caller). Resolves once the
 * model is loaded. frame(walking, yaw) draws one frame.
 */
export async function createTurkey(canvas, url) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  scene.add(new HemisphereLight(0xfff4e0, 0x6a5a80, 2.2));
  const sun = new DirectionalLight(0xffffff, 2.4); sun.position.set(2, 4, 5); scene.add(sun);
  const rim = new DirectionalLight(0x9fd8ff, 1.2); rim.position.set(-3, 2, -4); scene.add(rim);
  const camera = new PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 1.8, 6.2); camera.lookAt(0, 1.33, 0);
  const gltf = await new GLTFLoader().loadAsync(url);
  const t = rig(gltf);
  scene.add(t.root);
  const clock = new Clock();
  let time = 0;
  return {
    resize(w, h, dpr) { renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    frame(walking, yaw) {
      const dt = Math.min(0.05, clock.getDelta());
      time += dt;
      t.update(time, dt, walking, yaw);
      renderer.render(scene, camera);
    },
    face(yaw) { t.root.rotation.y = yaw; },
    hop() { t.react(time, 'hop'); },
    gobble() { t.react(time, 'gobble'); },
    dispose() { renderer.dispose(); renderer.forceContextLoss(); },
  };
}

window.PyrTurkey3d = { createTurkey };
