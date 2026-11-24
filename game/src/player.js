// player.js — W3 (player + cars + combat), ISLA BRASA 3D
// Low-poly humanoid, camera-relative WASD movement, run, jump,
// enter/exit cars (E), interact (F), walk/run limb-swing animation,
// outfit colour swaps for the clothes shop.
// Built from the design spec only. No code copied from any other repo.
import * as THREE from 'three';
import * as Config from './config.js';

// --- outfit colour map (clothes shop: default + 4 buyable outfits) ---
const OUTFITS = Config.OUTFITS ?? {
  default: { shirt: 0x2e86c1, pants: 0x2c3e50, sleeves: 0x2e86c1, shoes: 0x1a1a1a, hair: 0x2b1d12 },
  street:  { shirt: 0xe74c3c, pants: 0x34495e, sleeves: 0xe74c3c, shoes: 0xf5f5f5, hair: 0x111111 },
  suit:    { shirt: 0x1c1c1c, pants: 0x1c1c1c, sleeves: 0x1c1c1c, shoes: 0x000000, hair: 0x3a2a1a },
  beach:   { shirt: 0x1abc9c, pants: 0xe8d27a, sleeves: 0x1abc9c, shoes: 0x8b5a2b, hair: 0x6b4a1f },
  biker:   { shirt: 0x111111, pants: 0x2f3542, sleeves: 0x111111, shoes: 0x222222, hair: 0x000000 },
};

const WALK_SPEED = Config.PLAYER_WALK_SPEED ?? 5;
const RUN_SPEED = Config.PLAYER_RUN_SPEED ?? 9;
const JUMP_SPEED = Config.PLAYER_JUMP_SPEED ?? 7.5;
const GRAVITY = Config.GRAVITY ?? 20;

// Read a key from the many shapes ctx.input may take:
// a Set of codes, an object of code->bool, or single-letter keys.
function keyDown(input, ...codes) {
  if (!input) return false;
  const keys = input.keys;
  if (keys) {
    if (typeof keys.has === 'function') {
      for (const c of codes) if (keys.has(c)) return true;
    } else {
      for (const c of codes) {
        if (keys[c]) return true;
        const letter = c.replace(/^Key/, '');
        if (keys[letter] || keys[letter.toLowerCase()]) return true;
      }
    }
  }
  for (const c of codes) if (input[c]) return true;
  return false;
}

// Normalise a world building entry to an AABB { minX, maxX, minZ, maxZ }.
// Supports {minX,maxX,minZ,maxZ}, {x,z,w,d} / {x,z,halfW,halfD}, {x,z,width,depth}.
export function buildingAABB(b) {
  if (b.minX !== undefined) {
    return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
  }
  const hw = (b.halfW ?? b.w ?? b.width ?? 2) / (b.w !== undefined || b.width !== undefined ? 2 : 1);
  const hd = (b.halfD ?? b.d ?? b.depth ?? 2) / (b.d !== undefined || b.depth !== undefined ? 2 : 1);
  const cx = b.x ?? b.cx ?? 0;
  const cz = b.z ?? b.cz ?? 0;
  return { minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd };
}

// Circle-vs-AABB push-out for a position vector; radius r. Returns true if pushed.
export function pushOutOfBuildings(pos, buildings, r) {
  if (!buildings) return false;
  let pushed = false;
  for (const b of buildings) {
    const box = buildingAABB(b);
    if (pos.x > box.minX - r && pos.x < box.maxX + r &&
        pos.z > box.minZ - r && pos.z < box.maxZ + r) {
      const dxl = pos.x - (box.minX - r);
      const dxr = (box.maxX + r) - pos.x;
      const dzl = pos.z - (box.minZ - r);
      const dzr = (box.maxZ + r) - pos.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) pos.x = box.minX - r;
      else if (m === dxr) pos.x = box.maxX + r;
      else if (m === dzl) pos.z = box.minZ - r;
      else pos.z = box.maxZ + r;
      pushed = true;
    }
  }
  return pushed;
}

function makeLimb(mat, w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  // Pivot at the top of the limb so rotation.x swings it naturally.
  m.geometry.translate(0, -h / 2, 0);
  return m;
}

export function init(ctx) {
  const scene = ctx.scene;

  const skinMat = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
  const shirtMat = new THREE.MeshLambertMaterial({ color: OUTFITS.default.shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: OUTFITS.default.pants });
  const sleeveMat = new THREE.MeshLambertMaterial({ color: OUTFITS.default.sleeves });
  const shoeMat = new THREE.MeshLambertMaterial({ color: OUTFITS.default.shoes });
  const hairMat = new THREE.MeshLambertMaterial({ color: OUTFITS.default.hair });

  const mesh = new THREE.Group();
  mesh.name = 'player';

  // Torso: capsule body.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.45, 4, 10), shirtMat);
  torso.position.y = 1.05;
  mesh.add(torso);

  // Head + hair cap.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), skinMat);
  head.position.y = 1.72;
  mesh.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
  hair.position.y = 1.75;
  mesh.add(hair);

  // Arms (pivot at shoulder, y ~1.42) and legs (pivot at hip, y ~0.82).
  const armL = makeLimb(sleeveMat, 0.16, 0.62, 0.16);
  armL.position.set(-0.42, 1.42, 0);
  mesh.add(armL);
  const armR = makeLimb(sleeveMat, 0.16, 0.62, 0.16);
  armR.position.set(0.42, 1.42, 0);
  mesh.add(armR);
  // Hands.
  const handGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  const handL = new THREE.Mesh(handGeo, skinMat);
  handL.position.y = -0.66;
  armL.add(handL);
  const handR = new THREE.Mesh(handGeo, skinMat);
  handR.position.y = -0.66;
  armR.add(handR);

  const legL = makeLimb(pantsMat, 0.2, 0.78, 0.2);
  legL.position.set(-0.16, 0.82, 0);
  mesh.add(legL);
  const legR = makeLimb(pantsMat, 0.2, 0.78, 0.2);
  legR.position.set(0.16, 0.82, 0);
  mesh.add(legR);
  // Shoes.
  const shoeGeo = new THREE.BoxGeometry(0.2, 0.1, 0.32);
  const shoeL = new THREE.Mesh(shoeGeo, shoeMat);
  shoeL.position.set(0, -0.8, 0.05);
  legL.add(shoeL);
  const shoeR = new THREE.Mesh(shoeGeo, shoeMat);
  shoeR.position.set(0, -0.8, 0.05);
  legR.add(shoeR);

  // Start at the plaza / spawn point.
  const spawn = Config.PLAYER_SPAWN ?? { x: 0, z: 8 };
  mesh.position.set(spawn.x, 0, spawn.z);
  scene.add(mesh);

  const player = {
    mesh,
    pos: mesh.position, // THREE.Vector3, same reference as mesh.position
    speed: 0,
    inCar: false,
    outfit: 'default',
    _vy: 0,
    _grounded: true,
    _walkPhase: 0,
    _vel: new THREE.Vector3(),
    _camYaw: null,
    _prevE: false,
    _prevF: false,
    _prevSpace: false,
    _mats: { shirt: shirtMat, pants: pantsMat, sleeves: sleeveMat, shoes: shoeMat, hair: hairMat },

    enterCar(car) {
      if (!car) return false;
      this.inCar = true;
      this._car = car;
      mesh.visible = false;
      this._vel.set(0, 0, 0);
      if (ctx.cars) ctx.cars.current = car;
      return true;
    },

    exitCar() {
      const car = this._car || (ctx.cars && ctx.cars.current);
      if (!car) { this.inCar = false; mesh.visible = true; return false; }
      // Step out on the driver's side (left of the car's forward axis).
      const fwd = new THREE.Vector3(Math.sin(car.heading || 0), 0, Math.cos(car.heading || 0));
      const left = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const p = car.pos || car.mesh.position;
      mesh.position.set(p.x + left.x * 2.2, 0, p.z + left.z * 2.2);
      mesh.visible = true;
      this.inCar = false;
      this._car = null;
      if (ctx.cars) ctx.cars.current = null;
      return true;
    },

    setOutfit(name) {
      const o = OUTFITS[name];
      if (!o) return false;
      this.outfit = name;
      this._mats.shirt.color.setHex(o.shirt);
      this._mats.pants.color.setHex(o.pants);
      this._mats.sleeves.color.setHex(o.sleeves);
      this._mats.shoes.color.setHex(o.shoes);
      this._mats.hair.color.setHex(o.hair);
      if (ctx.state) ctx.state.outfit = name;
      return true;
    },
  };

  ctx.player = player;
  return player;
}

export function update(dt, ctx) {
  const player = ctx.player;
  if (!player) return;
  const input = ctx.input || {};
  const camera = ctx.camera;
  const mesh = player.mesh;

  // --- E: enter / exit car (edge-triggered) ---
  const eDown = keyDown(input, 'KeyE');
  if (eDown && !player._prevE) {
    if (player.inCar) {
      player.exitCar();
    } else if (ctx.cars && ctx.cars.getNearbyCar) {
      const car = ctx.cars.getNearbyCar(player.pos);
      if (car) player.enterCar(car);
    }
  }
  player._prevE = eDown;

  // In a car, cars.js drive() owns movement and the camera.
  if (player.inCar) return;

  // --- F: interact (edge-triggered). Dialogue / NPC module hooks ctx.onInteract. ---
  const fDown = keyDown(input, 'KeyF');
  if (fDown && !player._prevF) {
    // Fists punching is owned by combat.js; only fire the interact hook when
    // the player is not about to punch (combat decides that itself).
    if (typeof ctx.onInteract === 'function') ctx.onInteract(player.pos);
  }
  player._prevF = fDown;

  // --- Camera-relative movement ---
  const fwd = new THREE.Vector3();
  if (camera) camera.getWorldDirection(fwd);
  else fwd.set(0, 0, -1);
  fwd.y = 0;
  if (fwd.lengthSq() < 0.001) fwd.set(0, 0, -1);
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

  const move = new THREE.Vector3();
  if (keyDown(input, 'KeyW', 'ArrowUp')) move.add(fwd);
  if (keyDown(input, 'KeyS', 'ArrowDown')) move.sub(fwd);
  if (keyDown(input, 'KeyD', 'ArrowRight')) move.add(right);
  if (keyDown(input, 'KeyA', 'ArrowLeft')) move.sub(right);

  const running = keyDown(input, 'ShiftLeft', 'ShiftRight');
  const targetSpeed = move.lengthSq() > 0 ? (running ? RUN_SPEED : WALK_SPEED) : 0;
  if (move.lengthSq() > 0) move.normalize();

  // Smooth acceleration toward the target velocity.
  const accel = 40;
  player._vel.x += (move.x * targetSpeed - player._vel.x) * Math.min(1, accel * dt / Math.max(targetSpeed, 1) + 8 * dt);
  player._vel.z += (move.z * targetSpeed - player._vel.z) * Math.min(1, accel * dt / Math.max(targetSpeed, 1) + 8 * dt);
  player.speed = Math.hypot(player._vel.x, player._vel.z);

  mesh.position.x += player._vel.x * dt;
  mesh.position.z += player._vel.z * dt;

  // Building collision (circle push-out, radius 0.5).
  if (ctx.world && ctx.world.buildings) pushOutOfBuildings(mesh.position, ctx.world.buildings, 0.5);

  // --- Jump (Space, edge-triggered, only when grounded) ---
  const spaceDown = keyDown(input, 'Space');
  if (spaceDown && !player._prevSpace && player._grounded) {
    player._vy = JUMP_SPEED;
    player._grounded = false;
  }
  player._prevSpace = spaceDown;

  // Gravity.
  if (!player._grounded || player._vy !== 0) {
    player._vy -= GRAVITY * dt;
    mesh.position.y += player._vy * dt;
    if (mesh.position.y <= 0) {
      mesh.position.y = 0;
      player._vy = 0;
      player._grounded = true;
    }
  }

  // Face the movement direction.
  if (player.speed > 0.5) {
    const targetYaw = Math.atan2(player._vel.x, player._vel.z);
    let d = targetYaw - mesh.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    mesh.rotation.y += d * Math.min(1, 12 * dt);
  }

  // --- Walk / run limb-swing animation ---
  const swing = player.speed > 0.5 ? (running ? 0.85 : 0.55) : 0;
  player._walkPhase += dt * player.speed * 1.6;
  const s = Math.sin(player._walkPhase) * swing;
  // Limbs are children of the group in build order:
  // 0 torso, 1 head, 2 hair, 3 armL, 4 armR, 5 legL, 6 legR.
  const armL = mesh.children[3];
  const armR = mesh.children[4];
  const legL = mesh.children[5];
  const legR = mesh.children[6];
  if (armL && armR && legL && legR) {
    legL.rotation.x = s;
    legR.rotation.x = -s;
    armL.rotation.x = -s * 0.8;
    armR.rotation.x = s * 0.8;
    // Slight torso bob while moving; idle breathing when still.
    const torso = mesh.children[0];
    if (torso) torso.position.y = 1.05 + Math.abs(Math.cos(player._walkPhase)) * 0.04 * (swing / 0.85);
  }

  // --- Third-person camera follow (skipped if another module owns the camera) ---
  if (camera && ctx.cameraControl !== 'external') {
    // Mouse-look delta, if the input layer provides one.
    const lookDX = input.lookDX || input.mouseDX || 0;
    if (player._camYaw === null) player._camYaw = mesh.rotation.y + Math.PI;
    if (lookDX) player._camYaw -= lookDX * 0.004;
    // Auto-follow behind the player's facing when moving.
    if (player.speed > 0.5 && !lookDX) {
      const targetYaw = mesh.rotation.y + Math.PI;
      let d = targetYaw - player._camYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      player._camYaw += d * Math.min(1, 2.5 * dt);
    }
    const camDist = 7;
    const camHeight = 3.4;
    const cx = mesh.position.x + Math.sin(player._camYaw) * camDist;
    const cz = mesh.position.z + Math.cos(player._camYaw) * camDist;
    camera.position.set(cx, mesh.position.y + camHeight, cz);
    camera.lookAt(mesh.position.x, mesh.position.y + 1.4, mesh.position.z);
  }
}

export { OUTFITS };
