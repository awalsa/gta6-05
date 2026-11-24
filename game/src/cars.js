// cars.js — W3 (player + cars + combat), ISLA BRASA 3D
// Low-poly drivable cars: box body + cabin box + 4 cylinder wheels.
// 4 types with different speed/handling. W/S accelerate/brake/reverse,
// A/D steer, camera follows behind the car, AABB building push-out,
// rain grip 0.75, deep water blocks cars.
// Built from the design spec only. No code copied from any other repo.
import * as THREE from 'three';
import * as Config from './config.js';
import { buildingAABB } from './player.js';

// Prices from config when present (garage inventory lives in state.carsOwned).
// The garage UI (economy.js) sells runner/cruiser/gt/phantom; the shop sells
// motorbike/boat — all six are drivable types here, so a bought vehicle always
// has a mesh, stats and a price in this module.
const CAR_PRICES = Config.CAR_PRICES ?? { sedan: 2800, coupe: 5000, truck: 8000, sport: 12000, runner: 2800, cruiser: 5000, gt: 8000, phantom: 12000, motorbike: 1500, boat: 4500 };

// Per-type handling: topSpeed (units/s), accel, steer rate, toughness.
const CAR_STATS = Config.CAR_STATS ?? {
  sedan: { topSpeed: 28, accel: 13, steer: 1.9, tough: 1.0, color: 0x8fa3b8, cabin: 0x2c3e50 },
  coupe: { topSpeed: 34, accel: 16, steer: 2.1, tough: 0.9, color: 0xc0392b, cabin: 0x1a1a1a },
  truck: { topSpeed: 22, accel: 9, steer: 1.4, tough: 2.0, color: 0x27ae60, cabin: 0x145a32 },
  sport: { topSpeed: 40, accel: 19, steer: 2.3, tough: 0.8, color: 0xf1c40f, cabin: 0x111111 },
  // Garage cars (economy.js CARS): same prices, distinct looks/speeds.
  runner: { topSpeed: 22, accel: 11, steer: 1.8, tough: 1.0, color: 0x7a9ab8, cabin: 0x2c3e50 },
  cruiser: { topSpeed: 27, accel: 13, steer: 1.9, tough: 1.0, color: 0x5a7ab5, cabin: 0x1a1a1a },
  gt: { topSpeed: 33, accel: 16, steer: 2.2, tough: 0.9, color: 0xd84a4a, cabin: 0x111111 },
  phantom: { topSpeed: 40, accel: 19, steer: 2.3, tough: 0.8, color: 0x1a1a1e, cabin: 0x000000 },
  // Shop vehicles: motorbike (fast, nimble) and boat (drives on the water).
  motorbike: { topSpeed: 38, accel: 18, steer: 2.6, tough: 0.6, color: 0x222222, cabin: 0x8b0000 },
  boat: { topSpeed: 30, accel: 12, steer: 1.8, tough: 1.2, color: 0xe8e8e8, cabin: 0x4a7ab5 },
};

const CAR_NAMES = { sedan: 'Sedan', coupe: 'Coupe', truck: 'Truck', sport: 'Sport', runner: 'Brasa Runner', cruiser: 'Vela Cruiser', gt: 'Coral GT', phantom: 'Isla Phantom', motorbike: 'Motorbike', boat: 'Brasa Boat' };

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

function tryParticles(ctx, kind, pos, opts) {
  const p = ctx && ctx.particles;
  if (!p) return;
  try {
    if (typeof p.burst === 'function') p.burst(pos, kind, opts);
    else if (typeof p.spawn === 'function') p.spawn(kind, pos, opts);
    else if (typeof p.emit === 'function') p.emit(kind, pos, opts);
  } catch (e) { /* particles are best-effort decoration */ }
}

function buildCarMesh(type) {
  const stats = CAR_STATS[type] || CAR_STATS.sedan;
  const group = new THREE.Group();
  group.name = 'car-' + type;

  const bodyMat = new THREE.MeshLambertMaterial({ color: stats.color });
  const cabinMat = new THREE.MeshLambertMaterial({ color: stats.cabin });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });

  // Boat: hull + cabin + mast, no wheels — it drives on the water plane.
  if (type === 'boat') {
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 7.0), bodyMat);
    hull.position.y = 0.6;
    group.add(hull);
    const bow = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 1.4), bodyMat);
    bow.position.set(0, 0.6, 3.9);
    group.add(bow);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 2.4), cabinMat);
    cabin.position.set(0, 1.5, -0.6);
    group.add(cabin);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.5, 0.18), darkMat);
    mast.position.set(0, 3.2, 0.6);
    group.add(mast);
    group.userData.wheels = [];
    group.userData.bodyLen = 7.0;
    return group;
  }

  // Motorbike: narrow body, two wheels in line, fast and nimble.
  if (type === 'motorbike') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 2.4), bodyMat);
    body.position.y = 0.75;
    group.add(body);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.9), cabinMat);
    seat.position.set(0, 1.05, -0.5);
    group.add(seat);
    const bars = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), darkMat);
    bars.position.set(0, 1.1, 0.95);
    group.add(bars);
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.16, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheels = [];
    for (const wz of [1.0, -1.0]) {
      const wheel = new THREE.Mesh(wheelGeo, darkMat);
      wheel.position.set(0, 0.36, wz);
      group.add(wheel);
      wheels.push(wheel);
    }
    group.userData.wheels = wheels;
    group.userData.bodyLen = 2.4;
    return group;
  }

  const isTruck = type === 'truck';
  const isSport = type === 'sport';
  const bodyLen = isTruck ? 5.2 : 4.2;
  const bodyH = isSport ? 0.5 : 0.65;

  // Main body box.
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, bodyH, bodyLen), bodyMat);
  body.position.y = 0.55;
  group.add(body);

  if (isTruck) {
    // Open bed with side walls instead of a cabin.
    const bedWallGeo = new THREE.BoxGeometry(0.12, 0.5, 2.0);
    const wl = new THREE.Mesh(bedWallGeo, bodyMat);
    wl.position.set(-0.95, 0.95, -1.2);
    group.add(wl);
    const wr = new THREE.Mesh(bedWallGeo, bodyMat);
    wr.position.set(0.95, 0.95, -1.2);
    group.add(wr);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 1.3), cabinMat);
    cab.position.set(0, 1.1, 1.3);
    group.add(cab);
  } else {
    // Cabin box, slightly toward the rear.
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.1), cabinMat);
    cabin.position.set(0, 1.1, -0.2);
    group.add(cabin);
  }

  if (isSport) {
    // Rear spoiler.
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.4), darkMat);
    spoiler.position.set(0, 1.05, -2.0);
    group.add(spoiler);
    const strutGeo = new THREE.BoxGeometry(0.08, 0.3, 0.08);
    for (const sx of [-0.7, 0.7]) {
      const strut = new THREE.Mesh(strutGeo, darkMat);
      strut.position.set(sx, 0.9, -2.0);
      group.add(strut);
    }
  }

  // Headlights (emissive front) and taillights (red rear).
  const lightGeo = new THREE.BoxGeometry(0.35, 0.15, 0.06);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  for (const sx of [-0.65, 0.65]) {
    const h = new THREE.Mesh(lightGeo, headMat);
    h.position.set(sx, 0.6, bodyLen / 2 + 0.01);
    group.add(h);
    const t = new THREE.Mesh(lightGeo, tailMat);
    t.position.set(sx, 0.6, -bodyLen / 2 - 0.01);
    group.add(t);
  }

  // 4 cylinder wheels, axle along X (rotate cylinder Z by 90 deg).
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  const wheelY = 0.38;
  for (const [wx, wz] of [[-1.0, bodyLen / 2 - 0.9], [1.0, bodyLen / 2 - 0.9], [-1.0, -bodyLen / 2 + 0.9], [1.0, -bodyLen / 2 + 0.9]]) {
    const wheel = new THREE.Mesh(wheelGeo, darkMat);
    wheel.position.set(wx, wheelY, wz);
    group.add(wheel);
    wheels.push(wheel);
  }

  group.userData.wheels = wheels;
  group.userData.bodyLen = bodyLen;
  return group;
}

export function init(ctx) {
  const cars = {
    list: [],
    current: null,
    _exhaustT: 0,

    spawnCar(type, x, z, heading = 0) {
      if (!CAR_STATS[type]) type = 'sedan';
      const mesh = buildCarMesh(type);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = heading;
      ctx.scene.add(mesh);
      const car = {
        type,
        name: CAR_NAMES[type] || type,
        mesh,
        pos: mesh.position, // THREE.Vector3, same reference as mesh.position
        heading,
        speed: 0,
        stats: CAR_STATS[type],
        price: CAR_PRICES[type],
        // Garage upgrades (engine/armor/handling tiers 0-3), if any were bought.
        upgrades: { engine: 0, armor: 0, handling: 0 },
      };
      this.list.push(car);
      return car;
    },

    getNearbyCar(pos, maxDist = 4.5) {
      let best = null;
      let bestD = maxDist;
      for (const car of this.list) {
        const dx = car.pos.x - pos.x;
        const dz = car.pos.z - pos.z;
        const d = Math.hypot(dx, dz);
        if (d < bestD) { bestD = d; best = car; }
      }
      return best;
    },

    // Remove a car from the world (used by sell / mission cleanup).
    removeCar(car) {
      const i = this.list.indexOf(car);
      if (i >= 0) this.list.splice(i, 1);
      if (this.current === car) this.current = null;
      if (car && car.mesh) ctx.scene.remove(car.mesh);
    },

    drive(dt) {
      const car = this.current;
      if (!car || !ctx.player || !ctx.player.inCar) return;
      const input = ctx.input || {};
      const state = ctx.state || {};

      // Rain grip: steering + accel multiplied by 0.75 while raining.
      const grip = state.raining ? 0.75 : 1;
      const stats = car.stats;
      const engineBonus = 1 + (car.upgrades.engine || 0) * 0.12;
      const handlingBonus = 1 + (car.upgrades.handling || 0) * 0.1;
      const topSpeed = stats.topSpeed * engineBonus;
      const maxReverse = -10;

      const fwdIn = keyDown(input, 'KeyW', 'ArrowUp') ? 1 : 0;
      const backIn = keyDown(input, 'KeyS', 'ArrowDown') ? 1 : 0;
      const steerIn = (keyDown(input, 'KeyA', 'ArrowLeft') ? 1 : 0) -
                      (keyDown(input, 'KeyD', 'ArrowRight') ? 1 : 0);

      // Accelerate / brake / reverse.
      if (fwdIn) {
        car.speed += stats.accel * engineBonus * grip * dt;
      } else if (backIn) {
        if (car.speed > 0.5) car.speed -= stats.accel * 1.6 * grip * dt; // brake
        else car.speed -= stats.accel * 0.6 * grip * dt; // reverse
      } else {
        // Engine drag + rolling resistance.
        car.speed -= car.speed * 1.2 * dt;
        if (Math.abs(car.speed) < 0.05) car.speed = 0;
      }
      car.speed = Math.max(maxReverse, Math.min(topSpeed, car.speed));

      // Steering: stronger at low speed, direction flips in reverse.
      const speedFactor = Math.min(1, Math.abs(car.speed) / 8);
      const dirSign = car.speed >= 0 ? 1 : -1;
      car.heading += steerIn * stats.steer * handlingBonus * grip * speedFactor * dirSign * dt;
      car.mesh.rotation.y = car.heading;

      // Integrate.
      const prevX = car.pos.x;
      const prevZ = car.pos.z;
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      car.pos.x += fx * car.speed * dt;
      car.pos.z += fz * car.speed * dt;

      // Water rules: deep water blocks cars (revert and stop), but a boat
      // belongs on the water — it is blocked on LAND instead (revert and stop
      // when it leaves the water strip).
      if (ctx.world && typeof ctx.world.isInWater === 'function') {
        const inWater = ctx.world.isInWater(car.pos.x, car.pos.z);
        const boatOnLand = car.type === 'boat' && !inWater;
        const carInWater = car.type !== 'boat' && inWater;
        if (boatOnLand || carInWater) {
          car.pos.x = prevX;
          car.pos.z = prevZ;
          car.speed = 0;
        }
      }

      // Building collision: circle-vs-AABB push-out (radius ~1.4), speed halved.
      if (ctx.world && ctx.world.buildings) {
        for (const b of ctx.world.buildings) {
          const box = buildingAABB(b);
          const r = 1.4;
          if (car.pos.x > box.minX - r && car.pos.x < box.maxX + r &&
              car.pos.z > box.minZ - r && car.pos.z < box.maxZ + r) {
            const dxl = car.pos.x - (box.minX - r);
            const dxr = (box.maxX + r) - car.pos.x;
            const dzl = car.pos.z - (box.minZ - r);
            const dzr = (box.maxZ + r) - car.pos.z;
            const m = Math.min(dxl, dxr, dzl, dzr);
            if (m === dxl) car.pos.x = box.minX - r;
            else if (m === dxr) car.pos.x = box.maxX + r;
            else if (m === dzl) car.pos.z = box.minZ - r;
            else car.pos.z = box.maxZ + r;
            car.speed *= 0.5;
          }
        }
      }

      // Spin the wheels with road speed.
      const wheels = car.mesh.userData.wheels || [];
      for (const w of wheels) w.rotation.x += (car.speed / 0.38) * dt;

      // Exhaust smoke puffs while accelerating.
      this._exhaustT -= dt;
      if (fwdIn && this._exhaustT <= 0) {
        this._exhaustT = 0.12;
        tryParticles(ctx, 'exhaust', new THREE.Vector3(
          car.pos.x - fx * (car.mesh.userData.bodyLen / 2),
          0.5,
          car.pos.z - fz * (car.mesh.userData.bodyLen / 2)), { count: 1 });
      }

      // Camera follows behind the car.
      const camera = ctx.camera;
      if (camera && ctx.cameraControl !== 'external') {
        const camDist = 10;
        const camHeight = 4.2;
        camera.position.set(
          car.pos.x - fx * camDist,
          camHeight,
          car.pos.z - fz * camDist
        );
        camera.lookAt(car.pos.x + fx * 6, 1.2, car.pos.z + fz * 6);
      }
    },
  };

  ctx.cars = cars;

  // Spawn the player's owned cars near the garage, if state lists them.
  // (Garage placement: x = 30, z = -20 area; other modules may reposition.)
  const owned = (ctx.state && ctx.state.carsOwned) || [];
  const spawnSpots = [[30, -14], [34, -14], [30, -20], [34, -20]];
  owned.forEach((type, i) => {
    if (!CAR_STATS[type]) return;
    const spot = spawnSpots[i % spawnSpots.length];
    const car = cars.spawnCar(type, spot[0], spot[1], Math.PI);
    car._owned = true;
  });
  // Garage purchases (economy.js state.garage.owned) spawn near Brasa Garage
  // too, so a car bought in the garage overlay is actually drivable.
  syncGarageCars(ctx, cars);

  return cars;
}

// Keep the drivable fleet in sync with what the player owns: spawn any owned
// garage car that has no mesh yet (bought after boot), and remove the mesh of
// a car that was sold. Only touches cars flagged _owned by this module.
function syncGarageCars(ctx, cars) {
  if (!ctx || !ctx.state || !cars) return;
  const owned = new Set((ctx.state.carsOwned || []).filter((t) => CAR_STATS[t]));
  const garageOwned = (ctx.state.garage && ctx.state.garage.owned) || {};
  for (const t of Object.keys(garageOwned)) if (CAR_STATS[t]) owned.add(t);
  const spots = [[72, -32], [76, -32], [72, -48], [76, -48], [88, -32], [88, -48]];
  let i = 0;
  for (const type of owned) {
    if (cars.list.some((c) => c.type === type && c._owned)) continue;
    const spot = spots[i++ % spots.length];
    const car = cars.spawnCar(type, spot[0], spot[1], Math.PI);
    car._owned = true;
  }
  for (const car of [...cars.list]) {
    if (car._owned && !owned.has(car.type)) cars.removeCar(car);
  }
}

export function update(dt, ctx) {
  const cars = ctx.cars;
  if (!cars) return;
  // A garage purchase mid-session must become drivable without a reload.
  syncGarageCars(ctx, cars);
  // Driving only happens while the player is in a car; drive() guards that.
  cars.drive(dt);
}

export { CAR_PRICES, CAR_STATS };
