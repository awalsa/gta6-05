// pedestrians.js — 16 pedestrians walking the sidewalks of ISLA BRASA 3D.
// Low-poly humanoids with simple wander AI along the road grid; they flee
// (run away) when the player attacks nearby (gunshots).
// init(ctx) / update(dt, ctx). Attaches ctx.pedestrians = { list, count: 16 }.
import * as THREE from 'three';
import * as Config from './config.js';

const COUNT = 16;
const GRID = Config.ROAD_SPACING ?? 60;
const EXTENT = (Config.WORLD_SIZE ?? 400) / 2 - 20;
const WALK_SPEED = 1.6;
const FLEE_SPEED = 6.5;
const FLEE_RADIUS = 28;

const SHIRT_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xecf0f1];
const PANTS_COLORS = [0x2c3e50, 0x34495e, 0x5d4037, 0x1a1a2e];

let ctxRef = null;
const list = [];

function makeHumanoid(shirtColor, pantsColor) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0ac69, roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 4, 8), shirt);
  body.position.y = 1.05;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skin);
  head.position.y = 1.78;
  g.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.16), pants);
  legL.position.set(-0.14, 0.28, 0);
  g.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.16), pants);
  legR.position.set(0.14, 0.28, 0);
  g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), shirt);
  armL.position.set(-0.42, 1.15, 0);
  g.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), shirt);
  armR.position.set(0.42, 1.15, 0);
  g.add(armR);
  g.userData.legL = legL;
  g.userData.legR = legR;
  g.userData.armL = armL;
  g.userData.armR = armR;
  return g;
}

function randomSidewalkPoint() {
  // Sidewalks run alongside the road grid: snap one axis to a road line
  // (+/- sidewalk offset) and randomise the other.
  const roads = [];
  for (let v = -EXTENT; v <= EXTENT; v += GRID) roads.push(v);
  const road = roads[Math.floor(Math.random() * roads.length)];
  const along = (Math.random() - 0.5) * EXTENT * 2;
  const off = (Math.random() < 0.5 ? -1 : 1) * (4.5 + Math.random() * 1.5);
  if (Math.random() < 0.5) return new THREE.Vector3(road + off, 0, along);
  return new THREE.Vector3(along, 0, road + off);
}

function playerPos(ctx) {
  const s = ctx.state || {};
  if (s.playerPos && typeof s.playerPos.x === 'number') return s.playerPos;
  if (ctx.player && ctx.player.position) return ctx.player.position;
  if (s.player && s.player.position) return s.player.position;
  return null;
}

function lastShotInfo(ctx) {
  const s = ctx.state || {};
  // Combat module records the most recent gunshot here (position + time).
  if (s.lastGunshot && typeof s.lastGunshot.x === 'number') return s.lastGunshot;
  return null;
}

export function init(ctx) {
  ctxRef = ctx;
  ctx.state = ctx.state || {};
  for (let i = 0; i < COUNT; i++) {
    const mesh = makeHumanoid(
      SHIRT_COLORS[i % SHIRT_COLORS.length],
      PANTS_COLORS[i % PANTS_COLORS.length]
    );
    const start = randomSidewalkPoint();
    mesh.position.copy(start);
    ctx.scene.add(mesh);
    list.push({
      mesh,
      target: randomSidewalkPoint(),
      speed: WALK_SPEED * (0.8 + Math.random() * 0.5),
      fleeing: false,
      walkPhase: Math.random() * Math.PI * 2,
      idleTimer: 0,
    });
  }
  ctx.pedestrians = { list, count: COUNT };
}

export function update(dt, ctx) {
  const pp = playerPos(ctx);
  const shot = lastShotInfo(ctx);
  const now = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
  const shotFresh = shot && typeof shot.t === 'number' ? (now - shot.t) < 4 : !!shot;

  for (const ped of list) {
    const m = ped.mesh;
    let dir = new THREE.Vector3();
    let speed = ped.speed;
    ped.fleeing = false;

    // Flee: a fresh gunshot nearby, or the player attacking right next to them.
    let threat = null;
    if (shotFresh && shot) {
      const d = m.position.distanceTo(new THREE.Vector3(shot.x, 0, shot.z));
      if (d < FLEE_RADIUS) threat = new THREE.Vector3(shot.x, 0, shot.z);
    }
    if (!threat && pp) {
      const d = m.position.distanceTo(new THREE.Vector3(pp.x, 0, pp.z));
      const attacking = ctx.state && (ctx.state.playerAttacking || ctx.state.playerFiring);
      if (attacking && d < 12) threat = new THREE.Vector3(pp.x, 0, pp.z);
    }
    if (threat) {
      dir.subVectors(m.position, threat).setY(0);
      if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
      dir.normalize();
      speed = FLEE_SPEED;
      ped.fleeing = true;
      // After fleeing a while, pick a fresh wander target.
      ped.target = randomSidewalkPoint();
    } else {
      // Wander: walk toward the current sidewalk waypoint.
      dir.subVectors(ped.target, m.position).setY(0);
      const dist = dir.length();
      if (dist < 1.5) {
        // Idle a beat, then pick a new waypoint.
        ped.idleTimer -= dt;
        if (ped.idleTimer <= 0) {
          ped.target = randomSidewalkPoint();
          ped.idleTimer = 0.5 + Math.random() * 2;
        }
        dir.set(0, 0, 0);
      } else {
        dir.normalize();
      }
    }

    if (dir.lengthSq() > 0) {
      m.position.addScaledVector(dir, speed * dt);
      m.position.x = THREE.MathUtils.clamp(m.position.x, -EXTENT, EXTENT);
      m.position.z = THREE.MathUtils.clamp(m.position.z, -EXTENT, EXTENT);
      m.rotation.y = Math.atan2(dir.x, dir.z);
      // Limb swing while moving.
      ped.walkPhase += dt * speed * 3.2;
      const swing = Math.sin(ped.walkPhase) * 0.55;
      m.userData.legL.rotation.x = swing;
      m.userData.legR.rotation.x = -swing;
      m.userData.armL.rotation.x = -swing * 0.7;
      m.userData.armR.rotation.x = swing * 0.7;
    } else {
      m.userData.legL.rotation.x *= 0.9;
      m.userData.legR.rotation.x *= 0.9;
      m.userData.armL.rotation.x *= 0.9;
      m.userData.armR.rotation.x *= 0.9;
    }
  }
}
