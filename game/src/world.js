// world.js — Isla Brasa: low-poly 3D city (ground, roads, buildings,
// 12 landmarks, water, sky, props). ES module, Three.js.
// Shared contract: export init(ctx) and update(dt, ctx).
// ctx = { scene, camera, renderer, state, input, config }
// Attaches ctx.world = { landmarks, buildings, isOnRoad, isInWater,
//   getGroundY, ... } for collision / gameplay modules.
// World coords: x east, z south, y up, ground y = 0.
// World is 400 x 400 (x, z in [-200, 200]).

import * as THREE from 'three';
import { LANDMARKS, WORLD_SIZE } from './config.js';

// ---------------------------------------------------------------------------
// Constants / fallbacks (spec-exact landmark coords; used only if config.js
// is missing an entry — the config values win whenever present).
// ---------------------------------------------------------------------------

const SIZE = typeof WORLD_SIZE === 'number' && WORLD_SIZE > 0 ? WORLD_SIZE : 400;
const HALF = SIZE / 2;

const FALLBACK_LANDMARKS = {
  plazaTower:  { id: 'plazaTower',  name: 'Plaza Tower',       x: 0,    z: 0 },
  feriaMarket: { id: 'feriaMarket', name: 'Feria Market',      x: 0,    z: -80 },
  oldPier:     { id: 'oldPier',     name: 'Old Pier',          x: -160, z: 170 },
  marinaDocks: { id: 'marinaDocks', name: 'Marina Docks',      x: -120, z: 175 },
  brasaGarage: { id: 'brasaGarage', name: 'Brasa Garage',      x: 80,   z: -40 },
  rookArcade:  { id: 'rookArcade',  name: 'Rook Arcade',       x: 40,   z: 80 },
  coralCasino: { id: 'coralCasino', name: 'Coral Room Casino', x: 120,  z: 120 },
  coastTunnel: { id: 'coastTunnel', name: 'Coast Tunnel',      x: -80,  z: -160 },
  motelVela:   { id: 'motelVela',   name: 'Motel Vela',        x: -40,  z: 40 },
  underpass:   { id: 'underpass',   name: 'Underpass',         x: 0,    z: 150 },
  oldChurch:   { id: 'oldChurch',   name: 'Old Church',        x: -120, z: -120 },
  beachfront:  { id: 'beachfront',  name: 'Beachfront',        x: 160,  z: 170 },
};

function normalizeLandmarks(src) {
  const out = {};
  if (Array.isArray(src)) {
    for (const l of src) {
      if (l && l.id) {
        out[l.id] = {
          id: l.id,
          name: l.name || l.id,
          x: typeof l.x === 'number' ? l.x : 0,
          z: typeof l.z === 'number' ? l.z : 0,
        };
      }
    }
  } else if (src && typeof src === 'object') {
    for (const [id, v] of Object.entries(src)) {
      if (!v || typeof v !== 'object') continue;
      out[id] = {
        id,
        name: v.name || id,
        x: typeof v.x === 'number' ? v.x : (Array.isArray(v) ? v[0] : 0),
        z: typeof v.z === 'number' ? v.z : (Array.isArray(v) ? v[1] : 0),
      };
    }
  }
  // Spec-exact fallback for any landmark the config does not define.
  for (const [id, v] of Object.entries(FALLBACK_LANDMARKS)) {
    if (!out[id]) out[id] = { ...v };
  }
  return out;
}

// Road grid lines (every 40 units) and road width, per spec.
const ROAD_LINES = [];
for (let v = -160; v <= 160; v += 40) ROAD_LINES.push(v);
const ROAD_WIDTH = 8;
const ROAD_HALF = ROAD_WIDTH / 2;

// Deterministic pseudo-random from a seed (stable city layout).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, z) {
  let h = (Math.round(x) * 374761393 + Math.round(z) * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// Module state (filled by init, animated by update).
// ---------------------------------------------------------------------------

let elapsed = 0;
let waterMesh = null;
let waterMat = null;
let clouds = [];
let lampHeadMat = null;
let windowMat = null;
let dirLight = null;
let hemiLight = null;
let skyUniforms = null;
let sunMesh = null;

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

function flatPlane(w, d, color, y) {
  const geo = new THREE.PlaneGeometry(w, d);
  const mat = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

function box(w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

// ---------------------------------------------------------------------------
// init(ctx)
// ---------------------------------------------------------------------------

export function init(ctx) {
  const scene = ctx.scene;
  const landmarks = normalizeLandmarks(LANDMARKS);
  const landmarkList = Object.values(landmarks);

  // AABB list of every solid building (collision), in world coords.
  const buildings = [];
  function addAABB(minX, maxX, minZ, maxZ, height) {
    buildings.push({ minX, maxX, minZ, maxZ, height: height || 0 });
  }

  // -------------------------------------------------------------------------
  // Sky: gradient dome + sun + clouds.
  // -------------------------------------------------------------------------
  skyUniforms = {
    top: { value: new THREE.Color(0x2f6fd0) },
    bottom: { value: new THREE.Color(0xcfeef7) },
  };
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: skyUniforms,
    vertexShader:
      'varying vec3 vP; void main() { vP = position; ' +
      'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'varying vec3 vP; uniform vec3 top; uniform vec3 bottom; ' +
      'void main() { float h = normalize(vP).y * 0.5 + 0.5; ' +
      'gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), skyMat);
  scene.add(sky);

  // Sun disc (kept in sync with the directional light direction).
  sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(18, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, fog: false })
  );
  sunMesh.position.set(320, 420, 180);
  scene.add(sunMesh);

  // Low-poly clouds: flattened white blobs, drift in update().
  clouds = [];
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const cloudGeo = new THREE.SphereGeometry(1, 10, 8);
  const cloudSpots = [
    [-140, 90, -120, 26], [60, 100, -140, 32], [150, 85, -40, 22],
    [-60, 95, 90, 28], [120, 105, 140, 24], [-170, 80, 40, 20],
    [20, 110, 160, 30], [180, 90, -150, 22],
  ];
  for (const [cx, cy, cz, s] of cloudSpots) {
    const g = new THREE.Group();
    const puffs = [[0, 0, 0, 1], [s * 0.8, -s * 0.08, s * 0.2, 0.7], [-s * 0.8, -s * 0.05, -s * 0.15, 0.65]];
    for (const [px, py, pz, ps] of puffs) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      puff.scale.set(s * ps, s * ps * 0.45, s * ps * 0.7);
      puff.position.set(px, py, pz);
      g.add(puff);
    }
    g.position.set(cx, cy, cz);
    g.userData.speed = 1.2 + (hash2(cx, cz) % 100) / 100;
    scene.add(g);
    clouds.push(g);
  }

  // -------------------------------------------------------------------------
  // Lighting: hemisphere + directional, NO shadow maps (perf).
  // -------------------------------------------------------------------------
  hemiLight = new THREE.HemisphereLight(0xbfd9ff, 0x4a7a3a, 0.9);
  scene.add(hemiLight);
  dirLight = new THREE.DirectionalLight(0xfff2d8, 1.6);
  dirLight.position.set(140, 220, 90);
  scene.add(dirLight);

  // -------------------------------------------------------------------------
  // Ground: grass plane + beach sand strip.
  // -------------------------------------------------------------------------
  const ground = flatPlane(SIZE, SIZE, 0x69a03d, 0);
  scene.add(ground);
  // Sand along the south edge (beach), water sits over z >= 165.
  const sand = flatPlane(SIZE, 14, 0xe8d29a, 0.015);
  sand.position.z = 164;
  scene.add(sand);

  // -------------------------------------------------------------------------
  // Roads: light sidewalks under dark asphalt strips, plus centre dashes.
  // -------------------------------------------------------------------------
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: 0x9a9a92 });
  const asphaltMat = new THREE.MeshLambertMaterial({ color: 0x33343a });
  for (const v of ROAD_LINES) {
    // Vertical road (along z) at x = v.
    const swV = new THREE.Mesh(new THREE.PlaneGeometry(12, SIZE), sidewalkMat);
    swV.rotation.x = -Math.PI / 2;
    swV.position.set(v, 0.005, 0);
    scene.add(swV);
    const asV = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, SIZE), asphaltMat);
    asV.rotation.x = -Math.PI / 2;
    asV.position.set(v, 0.01, 0);
    asV.userData.isRoad = true; // weather.js darkens tagged roads when it rains
    scene.add(asV);
    // Horizontal road (along x) at z = v.
    const swH = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, 12), sidewalkMat);
    swH.rotation.x = -Math.PI / 2;
    swH.position.set(0, 0.006, v);
    scene.add(swH);
    const asH = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, ROAD_WIDTH), asphaltMat);
    asH.rotation.x = -Math.PI / 2;
    asH.position.set(0, 0.011, v);
    asH.userData.isRoad = true; // weather.js darkens tagged roads when it rains
    scene.add(asH);
  }
  // Centre dashes, one InstancedMesh for the whole grid.
  const dashGeo = new THREE.BoxGeometry(0.35, 0.05, 3);
  const dashMat = new THREE.MeshLambertMaterial({ color: 0xd8d8c8 });
  const dashSpots = [];
  const dummy = new THREE.Object3D();
  for (const v of ROAD_LINES) {
    for (let t = -190; t <= 190; t += 12) {
      const nearCross = ROAD_LINES.some((l) => Math.abs(t - l) < 7);
      if (nearCross) continue;
      if (t > 158) continue; // keep dashes off the beach/water
      dashSpots.push({ x: v, z: t, rotY: 0 });
      dashSpots.push({ x: t, z: v, rotY: Math.PI / 2 });
    }
  }
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashSpots.length);
  dashSpots.forEach((s, i) => {
    dummy.position.set(s.x, 0.03, s.z);
    dummy.rotation.set(0, s.rotY, 0);
    dummy.updateMatrix();
    dashes.setMatrixAt(i, dummy.matrix);
  });
  dashes.instanceMatrix.needsUpdate = true;
  scene.add(dashes);

  // -------------------------------------------------------------------------
  // Water plane: south strip z in [165, 200], blue, slightly transparent.
  // -------------------------------------------------------------------------
  waterMat = new THREE.MeshLambertMaterial({
    color: 0x1e6fd9,
    transparent: true,
    opacity: 0.72,
  });
  waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, 35), waterMat);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set(0, 0.06, 182.5);
  scene.add(waterMesh);

  // -------------------------------------------------------------------------
  // Procedural buildings: coloured boxes with emissive window strips.
  // One box per city block cell (32 x 32 between roads), 1-3 per block.
  // -------------------------------------------------------------------------
  const palette = [0xb5654a, 0x4a7ab5, 0xc9a227, 0x7a5a8a, 0x4a9a6a, 0x8a6a4a, 0x5a6a7a, 0xa34a5a, 0x3a8a8a, 0xd08a3a];
  const buildingMats = palette.map(
    (c) => new THREE.MeshLambertMaterial({ color: c })
  );
  windowMat = new THREE.MeshLambertMaterial({
    color: 0x222222,
    emissive: 0xffd27a,
    emissiveIntensity: 0.35,
  });
  const buildingSpecs = []; // {x, z, w, h, d, matIdx}

  const landmarkPts = landmarkList.map((l) => [l.x, l.z]);
  function nearLandmark(x, z, r) {
    return landmarkPts.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < r);
  }

  for (let bx = -180; bx <= 180; bx += 40) {
    for (let bz = -180; bz <= 180; bz += 40) {
      if (bz >= 150) continue; // beach / water zone: no city blocks
      if (nearLandmark(bx, bz, 30)) continue; // landmark plots stay clear
      const rng = mulberry32(hash2(bx, bz));
      const count = 1 + Math.floor(rng() * 3); // 1-3 buildings per block
      const distCentre = Math.hypot(bx, bz);
      for (let i = 0; i < count; i++) {
        const ox = (rng() - 0.5) * 16;
        const oz = (rng() - 0.5) * 16;
        const x = bx + ox;
        const z = bz + oz;
        if (nearLandmark(x, z, 24)) continue;
        const w = 8 + rng() * 8;
        const d = 8 + rng() * 8;
        // Taller near the centre, shorter toward the edges.
        const hMax = Math.max(8, 30 - distCentre * 0.07);
        const h = 6 + rng() * hMax;
        const matIdx = Math.floor(rng() * buildingMats.length);
        buildingSpecs.push({ x, z, w, h, d, matIdx });
        addAABB(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h);
      }
    }
  }

  // One mesh per building would be ~150 draw calls; group by material instead:
  // reuse the palette materials and share one BoxGeometry per building is still
  // a mesh each, so instead use one InstancedMesh per palette colour.
  const byMat = buildingMats.map(() => []);
  for (const s of buildingSpecs) byMat[s.matIdx].push(s);
  byMat.forEach((list, mi) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      buildingMats[mi],
      list.length
    );
    list.forEach((s, i) => {
      dummy.position.set(s.x, s.h / 2, s.z);
      dummy.scale.set(s.w, s.h, s.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  });

  // Emissive window strips: one thin box on the south face of each building,
  // single InstancedMesh (one draw call).
  const winInst = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 0.15),
    windowMat,
    buildingSpecs.length
  );
  buildingSpecs.forEach((s, i) => {
    const stripH = Math.max(1.2, s.h * 0.55);
    dummy.position.set(s.x, s.h * 0.55, s.z + s.d / 2 + 0.08);
    dummy.scale.set(s.w * 0.7, stripH, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    winInst.setMatrixAt(i, dummy.matrix);
  });
  winInst.instanceMatrix.needsUpdate = true;
  winInst.userData.isWindow = true; // daynight.js brightens tagged windows at night
  scene.add(winInst);

  // -------------------------------------------------------------------------
  // Landmarks (distinct meshes that read at a glance).
  // -------------------------------------------------------------------------
  const concreteMat = new THREE.MeshLambertMaterial({ color: 0xb8b8b0 });
  const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf2efe6 });
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
  const woodDarkMat = new THREE.MeshLambertMaterial({ color: 0x6a4a2a });
  const goldMat = new THREE.MeshLambertMaterial({
    color: 0xd8a820,
    emissive: 0x664400,
    emissiveIntensity: 0.4,
  });
  const glassMat = new THREE.MeshLambertMaterial({
    color: 0x2a4a6a,
    emissive: 0x113355,
    emissiveIntensity: 0.6,
  });
  const neonPinkMat = new THREE.MeshLambertMaterial({
    color: 0xff2a9a,
    emissive: 0xff2a9a,
    emissiveIntensity: 1.2,
  });
  const neonCyanMat = new THREE.MeshLambertMaterial({
    color: 0x22d8ff,
    emissive: 0x22d8ff,
    emissiveIntensity: 1.2,
  });
  const neonOrangeMat = new THREE.MeshLambertMaterial({
    color: 0xff7a22,
    emissive: 0xff7a22,
    emissiveIntensity: 1.2,
  });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1e });

  function landmarkBase(id, padColor, padW, padD) {
    const l = landmarks[id];
    const pad = flatPlane(padW, padD, padColor, 0.02);
    pad.position.x = l.x;
    pad.position.z = l.z;
    scene.add(pad);
    return l;
  }

  // 1. Plaza Tower [0,0] — tall tower + plaza paving.
  {
    const l = landmarkBase('plazaTower', 0xc8c8bd, 38, 38);
    const tower = box(14, 52, 14, glassMat, l.x, 26, l.z);
    scene.add(tower);
    const crown = box(16, 3, 16, neonCyanMat, l.x, 53.5, l.z);
    scene.add(crown);
    const base = box(20, 4, 20, concreteMat, l.x, 2, l.z);
    scene.add(base);
    addAABB(l.x - 10, l.x + 10, l.z - 10, l.z + 10, 52);
  }

  // 2. Feria Market [0,-80] — market stalls with striped awnings.
  {
    const l = landmarkBase('feriaMarket', 0xb8a888, 36, 30);
    const stallCols = [0xd84a4a, 0x4a9ad8, 0x4ad86a, 0xd8c84a];
    for (let i = 0; i < 6; i++) {
      const sx = l.x - 12 + (i % 3) * 12;
      const sz = l.z - 6 + Math.floor(i / 3) * 12;
      const stall = box(7, 3, 5, woodMat, sx, 1.5, sz);
      scene.add(stall);
      const awn = new THREE.Mesh(
        new THREE.BoxGeometry(8, 0.3, 6),
        new THREE.MeshLambertMaterial({ color: stallCols[i % stallCols.length] })
      );
      awn.position.set(sx, 3.6, sz);
      awn.rotation.x = 0.12;
      scene.add(awn);
      addAABB(sx - 3.5, sx + 3.5, sz - 2.5, sz + 2.5, 3.6);
    }
  }

  // 3. Old Pier [-160,170] — wooden deck over the water.
  {
    const l = landmarks.oldPier;
    const deck = box(10, 0.6, 36, woodMat, l.x, 0.6, l.z + 8);
    scene.add(deck);
    const rail = box(0.4, 1, 36, woodDarkMat, l.x - 5, 1.4, l.z + 8);
    scene.add(rail);
    const rail2 = box(0.4, 1, 36, woodDarkMat, l.x + 5, 1.4, l.z + 8);
    scene.add(rail2);
    for (let i = 0; i < 4; i++) {
      const post = box(0.8, 2.4, 0.8, woodDarkMat, l.x - 4, -0.4, l.z - 6 + i * 12);
      scene.add(post);
      const post2 = box(0.8, 2.4, 0.8, woodDarkMat, l.x + 4, -0.4, l.z - 6 + i * 12);
      scene.add(post2);
    }
    // Small hut at the pier root.
    const hut = box(6, 3.5, 5, woodDarkMat, l.x, 1.75, l.z - 12);
    scene.add(hut);
    addAABB(l.x - 3, l.x + 3, l.z - 14.5, l.z - 9.5, 3.5);
  }

  // 4. Marina Docks [-120,175] — docks + boats.
  {
    const l = landmarks.marinaDocks;
    for (let i = 0; i < 3; i++) {
      const dx = l.x - 14 + i * 14;
      const dock = box(5, 0.5, 22, woodMat, dx, 0.5, l.z + 4);
      scene.add(dock);
      // Boat: hull + cabin + mast.
      const hull = box(3.5, 1.4, 9, new THREE.MeshLambertMaterial({ color: [0xe8e8e8, 0xd84a4a, 0x4a7ab5][i] }), dx + 5, 0.7, l.z + 6);
      scene.add(hull);
      const cabin = box(2.2, 1.2, 3, whiteMat, dx + 5, 1.9, l.z + 5);
      scene.add(cabin);
      const mast = box(0.25, 6, 0.25, woodDarkMat, dx + 5, 4.5, l.z + 6);
      scene.add(mast);
    }
    const office = box(8, 4, 6, concreteMat, l.x, 2, l.z - 14);
    scene.add(office);
    addAABB(l.x - 4, l.x + 4, l.z - 17, l.z - 11, 4);
  }

  // 5. Brasa Garage [80,-40] — wide garage building + sign.
  {
    const l = landmarkBase('brasaGarage', 0x8a8a82, 34, 26);
    const hall = box(26, 9, 18, new THREE.MeshLambertMaterial({ color: 0x9a4a2a }), l.x, 4.5, l.z);
    scene.add(hall);
    const door = box(14, 6, 0.4, darkMat, l.x, 3, l.z + 9.2);
    scene.add(door);
    const sign = box(18, 2.5, 0.6, neonOrangeMat, l.x, 10.2, l.z + 9.2);
    scene.add(sign);
    addAABB(l.x - 13, l.x + 13, l.z - 9, l.z + 9, 9);
  }

  // 6. Rook Arcade [40,80] — neon arcade.
  {
    const l = landmarkBase('rookArcade', 0x7a7a72, 30, 24);
    const hall = box(20, 11, 14, new THREE.MeshLambertMaterial({ color: 0x3a2a5a }), l.x, 5.5, l.z);
    scene.add(hall);
    const stripe = box(20.5, 1.2, 0.5, neonPinkMat, l.x, 8, l.z + 7.2);
    scene.add(stripe);
    const stripe2 = box(20.5, 1.2, 0.5, neonCyanMat, l.x, 5.5, l.z + 7.2);
    scene.add(stripe2);
    const sign = box(10, 2.5, 0.6, neonPinkMat, l.x, 12.2, l.z + 7.2);
    scene.add(sign);
    addAABB(l.x - 10, l.x + 10, l.z - 7, l.z + 7, 11);
  }

  // 7. Coral Room Casino [120,120] — tall gold tower.
  {
    const l = landmarkBase('coralCasino', 0xc8b888, 36, 36);
    const tower = box(16, 42, 16, goldMat, l.x, 21, l.z);
    scene.add(tower);
    const crown = box(18, 2.5, 18, neonOrangeMat, l.x, 43, l.z);
    scene.add(crown);
    const win = box(12, 20, 0.4, glassMat, l.x, 16, l.z + 8.2);
    scene.add(win);
    const base = box(24, 5, 22, concreteMat, l.x, 2.5, l.z);
    scene.add(base);
    addAABB(l.x - 12, l.x + 12, l.z - 11, l.z + 11, 42);
  }

  // 8. Coast Tunnel [-80,-160] — tunnel mouth in a low hill.
  {
    const l = landmarks.coastTunnel;
    const hill = box(40, 14, 12, new THREE.MeshLambertMaterial({ color: 0x5a6a4a }), l.x, 7, l.z - 8);
    scene.add(hill);
    const mouth = box(12, 8, 1, darkMat, l.x, 4, l.z - 1.5);
    scene.add(mouth);
    const frame = box(15, 1.5, 1.5, concreteMat, l.x, 8.8, l.z - 1.5);
    scene.add(frame);
    const frameL = box(1.5, 9, 1.5, concreteMat, l.x - 7, 4.5, l.z - 1.5);
    scene.add(frameL);
    const frameR = box(1.5, 9, 1.5, concreteMat, l.x + 7, 4.5, l.z - 1.5);
    scene.add(frameR);
    addAABB(l.x - 20, l.x - 6, l.z - 14, l.z - 2, 14);
    addAABB(l.x + 6, l.x + 20, l.z - 14, l.z - 2, 14);
  }

  // 9. Motel Vela [-40,40] — long low block + sign pole.
  {
    const l = landmarkBase('motelVela', 0x9a9a8e, 40, 22);
    const block = box(30, 6, 10, new THREE.MeshLambertMaterial({ color: 0x7ab5a0 }), l.x, 3, l.z);
    scene.add(block);
    const roof = box(31, 0.5, 11, darkMat, l.x, 6.2, l.z);
    scene.add(roof);
    const pole = box(0.6, 12, 0.6, darkMat, l.x + 16, 6, l.z - 6);
    scene.add(pole);
    const sign = box(8, 3, 0.6, neonCyanMat, l.x + 16, 12.5, l.z - 6);
    scene.add(sign);
    addAABB(l.x - 15, l.x + 15, l.z - 5, l.z + 5, 6);
  }

  // 10. Underpass [0,150] — bridge deck over the north-south road.
  {
    const l = landmarks.underpass;
    const deck = box(34, 1.5, 10, concreteMat, l.x, 6, l.z);
    scene.add(deck);
    const wallL = box(1.5, 6, 10, concreteMat, l.x - 12, 3, l.z);
    scene.add(wallL);
    const wallR = box(1.5, 6, 10, concreteMat, l.x + 12, 3, l.z);
    scene.add(wallR);
    const rail = box(34, 0.8, 0.5, darkMat, l.x, 7.1, l.z - 5);
    scene.add(rail);
    addAABB(l.x - 12.8, l.x - 11.2, l.z - 5, l.z + 5, 6);
    addAABB(l.x + 11.2, l.x + 12.8, l.z - 5, l.z + 5, 6);
  }

  // 11. Old Church [-120,-120] — white box + spire + cross.
  {
    const l = landmarkBase('oldChurch', 0xc8c8b8, 30, 26);
    const nave = box(14, 10, 20, whiteMat, l.x, 5, l.z);
    scene.add(nave);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(11, 5, 4),
      new THREE.MeshLambertMaterial({ color: 0x8a2a2a })
    );
    roof.position.set(l.x, 12.5, l.z);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1, 1, 1.5);
    scene.add(roof);
    const spire = new THREE.Mesh(
      new THREE.ConeGeometry(2.5, 12, 4),
      new THREE.MeshLambertMaterial({ color: 0x8a2a2a })
    );
    spire.position.set(l.x, 15, l.z - 9);
    spire.rotation.y = Math.PI / 4;
    scene.add(spire);
    const crossV = box(0.3, 2, 0.3, goldMat, l.x, 22, l.z - 9);
    scene.add(crossV);
    const crossH = box(1.2, 0.3, 0.3, goldMat, l.x, 21.6, l.z - 9);
    scene.add(crossH);
    addAABB(l.x - 7, l.x + 7, l.z - 10, l.z + 10, 10);
  }

  // 12. Beachfront [160,170] — sand + umbrellas.
  {
    const l = landmarks.beachfront;
    const sandPatch = flatPlane(44, 16, 0xeed9a4, 0.02);
    sandPatch.position.set(l.x, 0.02, l.z - 6);
    scene.add(sandPatch);
    const umbrellaCols = [0xd84a4a, 0x4a9ad8, 0xd8c84a, 0x4ad86a];
    for (let i = 0; i < 5; i++) {
      const ux = l.x - 16 + i * 8;
      const uz = l.z - 8 + (i % 2) * 4;
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 3, 6),
        woodDarkMat
      );
      pole.position.set(ux, 1.5, uz);
      scene.add(pole);
      const canopy = new THREE.Mesh(
        new THREE.ConeGeometry(2.4, 1.2, 8),
        new THREE.MeshLambertMaterial({ color: umbrellaCols[i % umbrellaCols.length] })
      );
      canopy.position.set(ux, 3.4, uz);
      scene.add(canopy);
    }
  }

  // -------------------------------------------------------------------------
  // Props: street lamps, palm trees, parked cars, glowing crates.
  // -------------------------------------------------------------------------

  // Street lamps along the roads (instanced: poles + emissive heads).
  lampHeadMat = new THREE.MeshLambertMaterial({
    color: 0xfff2b0,
    emissive: 0xffe28a,
    emissiveIntensity: 0.6,
  });
  const lampSpots = [];
  for (const v of ROAD_LINES) {
    for (let t = -160; t <= 160; t += 40) {
      if (t > 150) continue;
      lampSpots.push({ x: v + 6.5, z: t });
      lampSpots.push({ x: t, z: v + 6.5 });
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 4.6, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length);
  const heads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.45, 8, 6),
    lampHeadMat,
    lampSpots.length
  );
  lampSpots.forEach((s, i) => {
    dummy.position.set(s.x, 2.3, s.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(s.x, 4.8, s.z);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  });
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  heads.userData.isLamp = true; // daynight.js brightens tagged lamps at night
  scene.add(poles);
  scene.add(heads);

  // Palm trees: instanced trunks + canopies, along the beach and plazas.
  const palmSpots = [];
  for (let x = -180; x <= 180; x += 24) {
    palmSpots.push({ x, z: 152 + (hash2(x, 1) % 5) });
  }
  palmSpots.push({ x: -24, z: 16 }, { x: 24, z: -16 }, { x: -16, z: -96 }, { x: 56, z: 64 }, { x: 104, z: 104 }, { x: -104, z: -104 });
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 6, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a34 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const canopyGeo = new THREE.ConeGeometry(2.6, 2.4, 7);
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x2a8a3a });
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, palmSpots.length);
  palmSpots.forEach((s, i) => {
    const lean = ((hash2(s.x, s.z) % 100) / 100 - 0.5) * 0.16;
    dummy.position.set(s.x, 3, s.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(lean, 0, lean);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(s.x, 7, s.z);
    dummy.rotation.set(0, (hash2(s.z, s.x) % 360) * Math.PI / 180, 0);
    dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);
  });
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  scene.add(trunks);
  scene.add(canopies);

  // Parked cars: simple low-poly cars (body + cabin + 4 wheels) along roads.
  const carCols = [0xd84a4a, 0x4a7ab5, 0xd8c84a, 0x4ad86a, 0xe8e8e8, 0x2a2a2e];
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 8);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const parkedSpots = [
    { x: 6.5, z: -40, rot: 0 }, { x: -6.5, z: 0, rot: Math.PI }, { x: 46.5, z: 40, rot: 0 },
    { x: -46.5, z: -80, rot: Math.PI }, { x: 86.5, z: 80, rot: 0 }, { x: -86.5, z: 120, rot: Math.PI },
    { x: 126.5, z: -40, rot: 0 }, { x: 6.5, z: 120, rot: Math.PI }, { x: -126.5, z: 40, rot: 0 },
    { x: 166.5, z: -120, rot: Math.PI }, { x: -166.5, z: -40, rot: 0 }, { x: 46.5, z: -120, rot: Math.PI },
  ];
  const parkedCars = [];
  parkedSpots.forEach((s, i) => {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: carCols[i % carCols.length] });
    const body = box(2, 0.7, 4.2, bodyMat, 0, 0.55, 0);
    g.add(body);
    const cabin = box(1.7, 0.6, 2.2, new THREE.MeshLambertMaterial({ color: 0x223344 }), 0, 1.2, -0.2);
    g.add(cabin);
    for (const [wx, wz] of [[-0.9, 1.4], [0.9, 1.4], [-0.9, -1.4], [0.9, -1.4]]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.35, wz);
      g.add(wheel);
    }
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.rot;
    scene.add(g);
    parkedCars.push(g);
  });

  // Glowing crates (mission pickups, used by the missions module).
  const crateMat = new THREE.MeshLambertMaterial({
    color: 0xff7a22,
    emissive: 0xff7a22,
    emissiveIntensity: 1.4,
  });
  const crateSpots = [
    [0, -60], [20, 20], [-60, -60], [100, -20], [60, 100],
    [140, 100], [-100, -100], [-60, 60], [100, 140], [-140, 140],
  ];
  const crates = [];
  for (const [cx, cz] of crateSpots) {
    const crate = box(1.4, 1.4, 1.4, crateMat, cx, 0.7, cz);
    scene.add(crate);
    crates.push({ mesh: crate, x: cx, z: cz, taken: false });
  }

  // -------------------------------------------------------------------------
  // Public contract on ctx.world.
  // -------------------------------------------------------------------------
  const world = {
    landmarks,
    landmarksList: landmarkList,
    buildings,
    buildingCount: buildingSpecs.length,
    roads: ROAD_LINES.slice(),
    roadWidth: ROAD_WIDTH,
    worldSize: SIZE,
    crates,
    parkedCars,
    lamps: lampSpots,
    // Light / sky handles for the day-night module.
    dirLight,
    hemiLight,
    sunMesh,
    skyUniforms,
    lampHeadMat,
    windowMat,
    waterMesh,
    waterMat,

    isOnRoad(x, z) {
      if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false;
      for (const v of ROAD_LINES) {
        if (Math.abs(x - v) <= ROAD_HALF || Math.abs(z - v) <= ROAD_HALF) return true;
      }
      return false;
    },
    isInWater(x, z) {
      return z >= 165 && z <= HALF && x >= -HALF && x <= HALF;
    },
    getGroundY(/* x, z */) {
      return 0; // flat city; pier deck / bridge are visual only
    },
    // Day/night hook: f = 0 (noon) .. 1 (midnight). Called by the day-night
    // module; keeps lamp/window glow and light levels in sync.
    setNightFactor(f) {
      const n = Math.max(0, Math.min(1, f));
      if (lampHeadMat) lampHeadMat.emissiveIntensity = 0.6 + n * 2.0;
      if (windowMat) windowMat.emissiveIntensity = 0.35 + n * 1.4;
      if (dirLight) dirLight.intensity = 1.6 - n * 1.3;
      if (hemiLight) hemiLight.intensity = 0.9 - n * 0.5;
      if (skyUniforms) {
        skyUniforms.top.value.setHex(n > 0.5 ? 0x0a1a3a : 0x2f6fd0);
        skyUniforms.bottom.value.setHex(n > 0.5 ? 0x1a2a4a : 0xcfeef7);
      }
    },
  };

  ctx.world = world;
  return world;
}

// ---------------------------------------------------------------------------
// update(dt, ctx) — most of the world is static; animate water + clouds only.
// ---------------------------------------------------------------------------

export function update(dt, ctx) {
  elapsed += dt;
  if (waterMesh) {
    waterMesh.position.y = 0.06 + Math.sin(elapsed * 0.8) * 0.02;
  }
  if (waterMat) {
    waterMat.opacity = 0.72 + Math.sin(elapsed * 0.8) * 0.04;
  }
  for (const cloud of clouds) {
    cloud.position.x += cloud.userData.speed * dt;
    if (cloud.position.x > HALF + 40) cloud.position.x = -HALF - 40;
  }
  // Gentle lamp shimmer (subtle; night brightness is owned by setNightFactor).
  if (lampHeadMat && ctx && ctx.state && typeof ctx.state.nightFactor === 'number') {
    lampHeadMat.emissiveIntensity =
      0.6 + ctx.state.nightFactor * 2.0 + Math.sin(elapsed * 2) * 0.05;
  }
}
