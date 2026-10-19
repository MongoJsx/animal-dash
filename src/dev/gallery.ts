// Dev page (prop-gallery.html): every obstacle kind × biome rendered by the
// real ObstacleView, with its collision boxes drawn as red wireframes, so
// models can be checked against what the player actually collides with.
// ?kind=wall shows one kind; ?t=1.3 sets the time used for moving parts.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { laneX } from '../config.ts';
import { ObstacleView } from '../render/obstacleView.ts';
import { loadProps } from '../render/props.ts';
import type { BiomeId } from '../world/biomes.ts';
import { hitBoxes, type Box, type Kind, type Obstacle } from '../world/obstacles.ts';

const SETS: Record<string, BiomeId[]> = {
  classic: ['village', 'forest', 'candy', 'harbor', 'snow'],
  asia: ['th_city', 'cn_town', 'jp_sakura', 'jp_snow'],
};
const BIOMES: BiomeId[] = SETS[new URLSearchParams(location.search).get('set') ?? 'classic'] ?? SETS.classic;
const KINDS: { kind: Kind; length: number }[] = [
  { kind: 'lowbar', length: 0.6 }, { kind: 'highbar', length: 0.6 }, { kind: 'wall', length: 1.6 },
  { kind: 'hay', length: 1.4 }, { kind: 'oncoming', length: 3.2 },
  { kind: 'rolling', length: 1.2 }, { kind: 'shifter', length: 1.4 }, { kind: 'pendulum', length: 1.4 },
  { kind: 'spikes', length: 2.4 }, { kind: 'drop', length: 1.6 }, { kind: 'sweeper', length: 7.4 }, { kind: 'bounce', length: 1.5 },
];

const params = new URLSearchParams(location.search);
const only = params.get('kind');
const T = Number(params.get('t') ?? 2.0);
const variant = Number(params.get('v') ?? 0);
const kinds = KINDS.filter((k) => !only || k.kind === only);

await loadProps();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe7ee);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8d7b68, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(5, 10, 8);
scene.add(sun);

const COL = 9;
const ROW = 20;
const wire = new THREE.LineBasicMaterial({ color: 0xe63946 });
const boxes: Box[] = [];
let id = variant;
kinds.forEach(({ kind, length }, r) => {
  BIOMES.forEach((biome, c) => {
    const o: Obstacle = {
      id: id++, row: 0, kind, lane: 0, d: 0, length, biome, phase: 0.1,
      period: 2.4, speed: 0, hit: false, cleared: false, triggerT: kind === 'drop' ? T - 1.9 : -1,
    };
    const g = new THREE.Group();
    g.position.set(c * COL - laneX(0), 0, -r * ROW);
    const v = new ObstacleView(o);
    v.update(T, 0);
    g.add(v.root);
    boxes.length = 0;
    hitBoxes(o, T, boxes);
    for (const b of boxes) {
      const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.d1 - b.d0));
      const line = new THREE.LineSegments(geo, wire);
      line.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, -(b.d0 + b.d1) / 2);
      g.add(line);
    }
    // Lane guide: the three lanes this obstacle sits in.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, Math.max(4, length + 3)), new THREE.MeshBasicMaterial({ color: c % 2 ? 0xc9d3dc : 0xd3dce4 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.01, -length / 2);
    g.add(floor);
    scene.add(g);
  });
});

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 1000);
const midX = (BIOMES.length - 1) * COL / 2;
const depth = (kinds.length - 1) * ROW;
camera.position.set(midX, only ? 9 : 40 + depth * 0.6, only ? 16 : 30);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(midX, 1, only ? -2 : -depth / 2);
controls.update();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
Object.assign(window, { __ready: true });
