// particles.js — one-draw-call particle system for ISLA BRASA 3D.
// 400-particle ring buffer, single THREE.Points + one BufferGeometry.
// Used for muzzle flashes, exhaust smoke, pickup sparkles, explosion bursts.
// init(ctx) / update(dt, ctx). Attaches ctx.particles = { burst(pos, color, count, speed), update }.
import * as THREE from 'three';
import * as Config from './config.js';

const MAX = Config.PARTICLE_MAX ?? 400;

let ctxRef = null;
let points = null;
let positions = null;
let colors = null;
// Per-particle sim state (not GPU attributes — updated on CPU each frame).
let vel = null;
let life = null;
let maxLife = null;
let grav = null;
let baseColor = null;
let cursor = 0;

const tmpColor = new THREE.Color();

function spawnOne(x, y, z, color, speed, lifeTime, gravity) {
  const i = cursor;
  cursor = (cursor + 1) % MAX;
  positions[i * 3] = x;
  positions[i * 3 + 1] = y;
  positions[i * 3 + 2] = z;
  // Random direction on a sphere.
  const th = Math.random() * Math.PI * 2;
  const ph = Math.acos(2 * Math.random() - 1);
  const s = speed * (0.4 + Math.random() * 0.8);
  vel[i * 3] = Math.sin(ph) * Math.cos(th) * s;
  vel[i * 3 + 1] = Math.cos(ph) * s + speed * 0.25;
  vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s;
  life[i] = lifeTime * (0.6 + Math.random() * 0.7);
  maxLife[i] = life[i];
  grav[i] = gravity;
  tmpColor.set(color);
  baseColor[i * 3] = tmpColor.r;
  baseColor[i * 3 + 1] = tmpColor.g;
  baseColor[i * 3 + 2] = tmpColor.b;
}

function burst(pos, color, count, speed) {
  if (!pos) return;
  const n = Math.min(count || 12, MAX);
  const c = color ?? 0xffcc33;
  for (let k = 0; k < n; k++) {
    // Explosions / muzzle flashes rise then fall; smoke/sparkles float.
    spawnOne(pos.x, pos.y, pos.z, c, speed || 6, 0.7, 9);
  }
}

export function init(ctx) {
  ctxRef = ctx;
  positions = new Float32Array(MAX * 3);
  colors = new Float32Array(MAX * 3);
  vel = new Float32Array(MAX * 3);
  life = new Float32Array(MAX);
  maxLife = new Float32Array(MAX);
  grav = new Float32Array(MAX);
  baseColor = new Float32Array(MAX * 3);
  // Park all particles far below ground until spawned.
  for (let i = 0; i < MAX; i++) positions[i * 3 + 1] = -100;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.9, vertexColors: true, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.userData.isParticles = true;
  ctx.scene.add(points);

  ctx.particles = {
    burst,
    // Convenience wrappers so other modules read clearly:
    muzzle(pos) { burst(pos, 0xffd34d, 6, 9); },
    smoke(pos) { burst(pos, 0x888888, 3, 1.2); },
    sparkle(pos) { burst(pos, 0x7dffd4, 14, 3); },
    explosion(pos) { burst(pos, 0xff7722, 40, 14); },
    get count() { return MAX; },
  };
}

export function update(dt, ctx) {
  if (!points) return;
  const step = Math.min(dt, 0.05);
  for (let i = 0; i < MAX; i++) {
    if (life[i] <= 0) {
      colors[i * 3] = 0; colors[i * 3 + 1] = 0; colors[i * 3 + 2] = 0;
      continue;
    }
    life[i] -= step;
    if (life[i] <= 0) {
      positions[i * 3 + 1] = -100; // hide dead particle
      colors[i * 3] = 0; colors[i * 3 + 1] = 0; colors[i * 3 + 2] = 0;
      continue;
    }
    vel[i * 3 + 1] -= grav[i] * step;
    positions[i * 3] += vel[i * 3] * step;
    positions[i * 3 + 1] += vel[i * 3 + 1] * step;
    positions[i * 3 + 2] += vel[i * 3 + 2] * step;
    if (positions[i * 3 + 1] < 0.05) { positions[i * 3 + 1] = 0.05; vel[i * 3 + 1] = 0; }
    // Fade to black (additive blending => fades out).
    const f = life[i] / maxLife[i];
    colors[i * 3] = baseColor[i * 3] * f;
    colors[i * 3 + 1] = baseColor[i * 3 + 1] * f;
    colors[i * 3 + 2] = baseColor[i * 3 + 2] * f;
  }
  points.geometry.attributes.position.needsUpdate = true;
  points.geometry.attributes.color.needsUpdate = true;
}
