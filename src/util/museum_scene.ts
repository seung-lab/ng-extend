// WebGL scene for the Achievement Museum, built on three.js.
//
// The CSS 3D museum flickered during movement because the DOM compositor
// re-rasterizes every transformed plane as its projected scale changes.
// Here the whole room is one WebGL canvas: textures upload once, motion is
// pure matrix math, and nothing re-rasters. The Vue component keeps all
// input, curation, and persistence logic and drives this scene through a
// small API: setCamera, setPose, pickArtifact, render.

import * as THREE from 'three';
import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js';
import type {MuseumWireframe} from './museum_mesh';

export interface SceneArtifact {
  key: string;
  name: string;
  subtitle: string;
  desc: string;
  img: string;
  imgHi: string;
  kind: 'building' | 'exploration' | 'special';
}

export interface ScenePose {
  x: number;
  z: number;
  s: number;
}

export interface SceneOpts {
  roomW: number;
  roomD: number;
  wallH: number;
  floorY: number;
  userName: string;
  statsRows: {label: string; value: string}[];
}

const BEAM_BLUE = 0x35b5ff;
const KIND_COLORS: Record<string, number> = {
  building: 0xffbe5a,
  exploration: 0x50e6d2,
  special: 0xce93d8,
};

interface ArtifactNodes {
  group: THREE.Group;
  badge: THREE.Sprite;
  badgeMat: THREE.SpriteMaterial;
  plaque: THREE.Sprite;
  plaqueMat: THREE.SpriteMaterial;
  disc: THREE.Group;
  beam: THREE.Mesh;
  baseScale: number;
  bobPhase: number;
  hiLoaded: boolean;
  hiLoading: boolean;
  art: SceneArtifact;
  selected: boolean;
}

export class MuseumScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private texLoader = new THREE.TextureLoader();
  private artifacts = new Map<string, ArtifactNodes>();
  private pickables: THREE.Object3D[] = [];
  private doorMesh: THREE.Mesh | null = null;
  private specimenGroup: THREE.Group | null = null;
  private specimenMat: LineMaterial | null = null;
  private opts: SceneOpts;
  private canvas: HTMLCanvasElement;
  private reducedMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: SceneOpts) {
    this.canvas = canvas;
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true});
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x02050c, 1);
    this.camera = new THREE.PerspectiveCamera(62, 1, 10, 16000);
    this.camera.rotation.order = 'YXZ';
    this.scene.fog = new THREE.FogExp2(0x02050c, 0.00026);
    this.resize();
    this.buildRoom();
    this.buildSky();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ── Room shell ─────────────────────────────────────────────────────────────
  private buildRoom() {
    const {roomW, roomD, wallH, floorY} = this.opts;
    const yFloor = -floorY;          // css +y down → three +y up
    const yTop = -floorY + wallH;
    const zMid = -roomD / 2;

    // Floor: repeating dot grid tile.
    const floorTex = canvasTexture(256, 256, ctx => {
      ctx.fillStyle = '#050b16';
      ctx.fillRect(0, 0, 256, 256);
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 9);
      g.addColorStop(0, 'rgba(90,200,255,0.55)');
      g.addColorStop(0.4, 'rgba(90,200,255,0.18)');
      g.addColorStop(1, 'rgba(90,200,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(128, 128, 9, 0, Math.PI * 2);
      ctx.fill();
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(roomW / 146, roomD / 146);
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(roomW, roomD),
        new THREE.MeshBasicMaterial({map: floorTex}));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, yFloor, zMid);
    this.scene.add(floor);

    // Center aisle glow.
    const aisleTex = canvasTexture(64, 8, ctx => {
      const g = ctx.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, 'rgba(53,181,255,0)');
      g.addColorStop(0.5, 'rgba(120,220,255,0.55)');
      g.addColorStop(1, 'rgba(53,181,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 8);
    });
    const aisle = new THREE.Mesh(
        new THREE.PlaneGeometry(230, roomD),
        additiveMat(aisleTex, 0.5));
    aisle.rotation.x = -Math.PI / 2;
    aisle.position.set(0, yFloor + 1, zMid);
    this.scene.add(aisle);

    // Walls: vertical gradient, brightest at the parapet.
    const wallTex = canvasTexture(8, 256, ctx => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#101f38');
      g.addColorStop(0.12, '#0a1526');
      g.addColorStop(1, '#040912');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 8, 256);
    });
    const wallMat = new THREE.MeshBasicMaterial({map: wallTex});
    const mkWall = (w: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, wallH), wallMat);
      m.position.set(x, (yFloor + yTop) / 2, z);
      m.rotation.y = ry;
      this.scene.add(m);
      // Parapet glow line.
      const glow = new THREE.Mesh(
          new THREE.PlaneGeometry(w, 7),
          new THREE.MeshBasicMaterial({
            color: BEAM_BLUE,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }));
      glow.position.set(x, yTop - 3, z);
      glow.rotation.y = ry;
      glow.translateZ(1.5);
      this.scene.add(glow);
    };
    mkWall(roomD, -roomW / 2, zMid, Math.PI / 2);
    mkWall(roomD, roomW / 2, zMid, -Math.PI / 2);
    mkWall(roomW, 0, -roomD, 0);
    mkWall(roomW, 0, 0, Math.PI);

    // Back wall inscription + career telemetry.
    const insTex = canvasTexture(1024, 512, ctx => {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(160,225,255,0.95)';
      ctx.shadowColor = 'rgba(53,181,255,0.9)';
      ctx.shadowBlur = 24;
      ctx.font = "700 64px Orbitron, sans-serif";
      ctx.fillText('HALL OF ACHIEVEMENTS', 512, 120);
      ctx.font = "500 22px Orbitron, sans-serif";
      ctx.fillStyle = 'rgba(120,190,235,0.7)';
      ctx.shadowBlur = 10;
      ctx.fillText(`EYEWIRE II · CURATOR: ${this.opts.userName.toUpperCase()}`, 512, 170);
      ctx.font = "500 15px Orbitron, sans-serif";
      ctx.fillStyle = 'rgba(140,215,250,0.55)';
      ctx.fillText('CAREER TELEMETRY', 512, 250);
      const rows = this.opts.statsRows;
      const span = 1024 / (rows.length + 1);
      rows.forEach((r, i) => {
        const x = span * (i + 1);
        ctx.font = "700 44px Orbitron, sans-serif";
        ctx.fillStyle = 'rgba(190,232,255,0.95)';
        ctx.shadowBlur = 18;
        ctx.fillText(r.value, x, 320);
        ctx.font = "500 12px Orbitron, sans-serif";
        ctx.fillStyle = 'rgba(130,200,240,0.7)';
        ctx.shadowBlur = 6;
        ctx.fillText(r.label, x, 348);
      });
    });
    const ins = new THREE.Mesh(
        new THREE.PlaneGeometry(2000, 1000), additiveMat(insTex, 0.95));
    ins.position.set(0, yFloor + 560, -roomD + 10);
    this.scene.add(ins);

    // Exit door on the entrance wall.
    const doorTex = canvasTexture(512, 640, ctx => {
      ctx.strokeStyle = 'rgba(120,220,255,0.8)';
      ctx.lineWidth = 5;
      roundedArch(ctx, 26, 26, 460, 610, 230);
      ctx.stroke();
      const g = ctx.createLinearGradient(0, 640, 0, 100);
      g.addColorStop(0, 'rgba(53,181,255,0.30)');
      g.addColorStop(1, 'rgba(53,181,255,0.02)');
      ctx.fillStyle = g;
      roundedArch(ctx, 26, 26, 460, 610, 230);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(190,235,255,0.95)';
      ctx.shadowColor = 'rgba(53,181,255,0.9)';
      ctx.shadowBlur = 20;
      ctx.font = "700 84px Orbitron, sans-serif";
      ctx.fillText('EXIT', 256, 300);
      ctx.font = "500 26px Orbitron, sans-serif";
      ctx.fillStyle = 'rgba(130,200,240,0.85)';
      ctx.shadowBlur = 10;
      ctx.fillText('BACK TO EYEWIRE 2', 256, 350);
    });
    this.doorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(380, 475),
        new THREE.MeshBasicMaterial({
          map: doorTex,
          transparent: true,
          depthWrite: false,
        }));
    this.doorMesh.position.set(0, yFloor + 240, -3);
    this.doorMesh.rotation.y = Math.PI;
    this.scene.add(this.doorMesh);
  }

  private buildSky() {
    const pts: number[] = [];
    for (let i = 0; i < 320; i++) {
      const r = 7000 + Math.random() * 1500;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.45;
      pts.push(
          r * Math.sin(phi) * Math.cos(theta),
          600 + r * Math.cos(phi) * 0.5,
          -3100 + r * Math.sin(phi) * Math.sin(theta));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0x9cd8ff,
      size: 7,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
      fog: false,
    }));
    this.scene.add(stars);
  }

  // ── Artifacts ──────────────────────────────────────────────────────────────
  setArtifacts(list: SceneArtifact[]) {
    for (const nodes of this.artifacts.values()) this.scene.remove(nodes.group);
    this.artifacts.clear();
    this.pickables = [];
    list.forEach((art, i) => {
      const group = new THREE.Group();
      const color = KIND_COLORS[art.kind] ?? BEAM_BLUE;

      const badgeMat = new THREE.SpriteMaterial({transparent: true, depthWrite: false});
      const badge = new THREE.Sprite(badgeMat);
      badge.center.set(0.5, 0.5);
      badge.position.y = 250;
      badge.scale.set(160, 160, 1);
      badge.userData.akey = art.key;
      badge.visible = false;
      this.texLoader.load(art.img, tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        badgeMat.map = tex;
        badgeMat.needsUpdate = true;
        badge.visible = true;
      });
      group.add(badge);

      const plaqueMat = new THREE.SpriteMaterial({transparent: true, depthWrite: false});
      const plaque = new THREE.Sprite(plaqueMat);
      plaque.position.y = 110;
      plaque.scale.set(300, 165, 1);
      plaque.userData.akey = art.key;
      plaqueMat.map = plaqueTexture(art, false);
      group.add(plaque);

      const disc = new THREE.Group();
      const ringMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      for (const [inner, outer, op] of [[86, 92, 0.5], [64, 68, 0.3], [0, 34, 0.35]] as const) {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(inner, outer, 48),
            ringMat.clone());
        (ring.material as THREE.MeshBasicMaterial).opacity = op;
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 2 + Math.random();
        disc.add(ring);
      }
      group.add(disc);

      const beam = new THREE.Mesh(
          new THREE.ConeGeometry(110, 530, 24, 1, true),
          new THREE.MeshBasicMaterial({
            color: art.kind === 'special' ? 0xce93d8 : BEAM_BLUE,
            transparent: true,
            opacity: 0.05,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }));
      beam.position.y = 265;
      group.add(beam);

      const nodes: ArtifactNodes = {
        group, badge, badgeMat, plaque, plaqueMat, disc, beam,
        baseScale: 1,
        bobPhase: (i % 9) * 0.7,
        hiLoaded: false,
        hiLoading: false,
        art,
        selected: false,
      };
      this.artifacts.set(art.key, nodes);
      this.pickables.push(badge, plaque);
      this.scene.add(group);
    });
  }

  setPose(key: string, pose: ScenePose) {
    const n = this.artifacts.get(key);
    if (!n) return;
    n.group.position.set(pose.x, -this.opts.floorY, pose.z);
    n.group.scale.setScalar(pose.s);
    n.baseScale = pose.s;
  }

  setSelected(key: string | null) {
    for (const [k, n] of this.artifacts) {
      const sel = k === key;
      if (sel !== n.selected) {
        n.selected = sel;
        n.plaqueMat.map = plaqueTexture(n.art, sel);
        n.plaqueMat.needsUpdate = true;
        n.beam.material = n.beam.material as THREE.MeshBasicMaterial;
        (n.beam.material as THREE.MeshBasicMaterial).opacity = sel ? 0.12 : 0.05;
      }
    }
  }

  /** Upgrade badges near the camera to full resolution art. */
  private maybeUpgrade(camX: number, camZ: number) {
    for (const n of this.artifacts.values()) {
      if (n.hiLoaded || n.hiLoading || !n.art.imgHi) continue;
      const dx = n.group.position.x - camX, dz = n.group.position.z - camZ;
      if (dx * dx + dz * dz < 1150 * 1150) {
        n.hiLoading = true;
        this.texLoader.load(n.art.imgHi, tex => {
          tex.colorSpace = THREE.SRGBColorSpace;
          n.badgeMat.map = tex;
          n.badgeMat.needsUpdate = true;
          n.hiLoaded = true;
        }, undefined, () => {
          n.hiLoading = false;
        });
      }
    }
  }

  // ── Specimen ───────────────────────────────────────────────────────────────
  setSpecimen(wf: MuseumWireframe, soma: {x: number; y: number; z: number}, maxRadius: number) {
    if (this.specimenGroup) this.scene.remove(this.specimenGroup);
    const scale = 3000 / maxRadius;
    const pos: number[] = [];
    const v = wf.verts;
    for (let i = 0; i + 1 < wf.edges.length; i += 2) {
      for (const idx of [wf.edges[i], wf.edges[i + 1]]) {
        pos.push(
            (v[idx * 3] - soma.x) * scale,
            (v[idx * 3 + 2] - soma.z) * scale * -1,
            (v[idx * 3 + 1] - soma.y) * scale);
      }
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    this.specimenMat = new LineMaterial({
      color: 0x9ce4ff,
      linewidth: 2.2,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.specimenMat.resolution.set(this.canvas.clientWidth, this.canvas.clientHeight);
    const lines = new LineSegments2(geo, this.specimenMat);
    const group = new THREE.Group();
    group.add(lines);
    group.rotation.x = 0.10;
    group.position.set(0, -this.opts.floorY + 1050, -1900);
    this.specimenGroup = group;
    this.scene.add(group);
  }

  // ── Picking ────────────────────────────────────────────────────────────────
  private ndc(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
        ((clientX - r.left) / r.width) * 2 - 1,
        -((clientY - r.top) / r.height) * 2 + 1);
  }

  pickArtifact(clientX: number, clientY: number): string | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    return hits.length ? (hits[0].object.userData.akey as string) : null;
  }

  pickDoor(clientX: number, clientY: number): boolean {
    if (!this.doorMesh) return false;
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    return this.raycaster.intersectObject(this.doorMesh, false).length > 0;
  }

  // ── Frame ──────────────────────────────────────────────────────────────────
  setCamera(x: number, z: number, yawDeg: number, pitchDeg: number) {
    this.camera.position.set(x, 0, z);
    this.camera.rotation.y = -yawDeg * Math.PI / 180;
    this.camera.rotation.x = pitchDeg * Math.PI / 180;
  }

  render(now: number) {
    if (this.disposed) return;
    if (!this.reducedMotion) {
      const t = now * 0.001;
      for (const n of this.artifacts.values()) {
        n.badge.position.y = 250 + Math.sin(t * 0.84 + n.bobPhase) * 6;
      }
      if (this.specimenGroup) {
        this.specimenGroup.rotation.y = now * 0.000006;
      }
    }
    this.maybeUpgrade(this.camera.position.x, this.camera.position.z);
    if (this.specimenMat) {
      this.specimenMat.resolution.set(this.canvas.clientWidth, this.canvas.clientHeight);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.renderer.dispose();
  }
}

// ── Texture helpers ──────────────────────────────────────────────────────────
function canvasTexture(
    w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function additiveMat(map: THREE.Texture, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function roundedArch(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arc(x + w / 2, y + r, w / 2, Math.PI, 0);
  ctx.lineTo(x + w, y + h);
}

const PLAQUE_CACHE = new Map<string, THREE.CanvasTexture>();

function plaqueTexture(art: SceneArtifact, selected: boolean): THREE.CanvasTexture {
  const cacheKey = `${art.key}:${selected ? 1 : 0}`;
  const cached = PLAQUE_CACHE.get(cacheKey);
  if (cached) return cached;
  const kindColor = art.kind === 'building' ? 'rgba(255,208,138,0.9)' :
      art.kind === 'exploration' ? 'rgba(144,255,242,0.9)' : 'rgba(226,180,235,0.95)';
  const tex = canvasTexture(512, 282, ctx => {
    ctx.fillStyle = selected ? 'rgba(14,30,58,0.92)' : 'rgba(8,18,38,0.88)';
    ctx.strokeStyle = selected ? 'rgba(140,230,255,0.95)' :
        art.kind === 'special' ? 'rgba(206,147,216,0.55)' : 'rgba(53,181,255,0.4)';
    ctx.lineWidth = selected ? 5 : 3;
    ctx.beginPath();
    (ctx as any).roundRect(8, 8, 496, 266, 14);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(190,235,255,0.96)';
    ctx.shadowColor = 'rgba(53,181,255,0.8)';
    ctx.shadowBlur = 12;
    ctx.font = "700 34px Orbitron, sans-serif";
    ctx.fillText(art.name.toUpperCase(), 256, 74, 470);
    ctx.font = "500 21px Orbitron, sans-serif";
    ctx.fillStyle = kindColor;
    ctx.shadowBlur = 6;
    ctx.fillText(art.subtitle, 256, 120, 470);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(170,200,225,0.8)';
    ctx.font = "23px 'Inter', -apple-system, sans-serif";
    wrapText(ctx, art.desc, 256, 168, 460, 30, 3);
  });
  PLAQUE_CACHE.set(cacheKey, tex);
  return tex;
}

function wrapText(
    ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
    maxW: number, lineH: number, maxLines: number) {
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (ctx.measureText(probe).width > maxW && line) {
      ctx.fillText(line, x, y + lines * lineH);
      lines++;
      if (lines >= maxLines) return;
      line = word;
    } else {
      line = probe;
    }
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineH);
}
