// combat.js — W3 (player + cars + combat), ISLA BRASA 3D
// Weapons (fists, pistol, SMG, shotgun, rifle + sniper/RPG once bought),
// mouse-click shooting on foot, F punch, low-poly thug enemies with
// HP bars (canvas sprite above the head). Hitting an NPC/police raises
// state.wanted (the police module reads it). Muzzle flash + shot sound
// go through ctx.particles / ctx.audio when present (guarded).
// Built from the design spec only. No code copied from any other repo.
import * as THREE from 'three';
import * as Config from './config.js';

// damage / range (units) / rate (seconds between shots) / spread (radians).
const WEAPON_STATS = Config.WEAPON_STATS ?? {
  fists:   { damage: 15,  range: 2.2,  rate: 0.5,  spread: 0,    auto: false, name: 'Fists' },
  pistol:  { damage: 25,  range: 40,   rate: 0.35, spread: 0.02, auto: false, name: 'Pistol' },
  smg:     { damage: 12,  range: 30,   rate: 0.09, spread: 0.06, auto: true,  name: 'SMG' },
  shotgun: { damage: 45,  range: 18,   rate: 0.9,  spread: 0.22, auto: false, name: 'Shotgun' },
  rifle:   { damage: 40,  range: 60,   rate: 0.15, spread: 0.01, auto: true,  name: 'Rifle' },
  sniper:  { damage: 100, range: 120,  rate: 1.2,  spread: 0,    auto: false, name: 'Sniper' },
  rpg:     { damage: 150, range: 60,   rate: 1.5,  spread: 0,    auto: false, name: 'RPG', explosive: true },
};

const BASE_WEAPONS = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];
const SHOP_WEAPONS = ['sniper', 'rpg']; // usable only if in state.weaponsOwned

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

function playSound(ctx, name) {
  const a = ctx && ctx.audio;
  if (!a) return;
  try {
    if (typeof a.play === 'function') a.play(name);
    else if (typeof a[name] === 'function') a[name]();
    else if (typeof a.sfx === 'function') a.sfx(name);
  } catch (e) { /* audio is best-effort */ }
}

function emitParticles(ctx, kind, pos, opts) {
  const p = ctx && ctx.particles;
  if (!p) return;
  try {
    if (typeof p.burst === 'function') p.burst(pos, kind, opts);
    else if (typeof p.spawn === 'function') p.spawn(kind, pos, opts);
    else if (typeof p.emit === 'function') p.emit(kind, pos, opts);
  } catch (e) { /* particles are best-effort decoration */ }
}

// Aim direction: camera forward on foot, car forward while driving.
function aimDirection(ctx) {
  const dir = new THREE.Vector3();
  if (ctx.camera) ctx.camera.getWorldDirection(dir);
  else if (ctx.player) dir.set(Math.sin(ctx.player.mesh.rotation.y), 0, Math.cos(ctx.player.mesh.rotation.y));
  else dir.set(0, 0, -1);
  dir.y = 0;
  if (dir.lengthSq() < 0.001) dir.set(0, 0, -1);
  return dir.normalize();
}

function aimOrigin(ctx) {
  if (ctx.player && ctx.player.pos) {
    return new THREE.Vector3(ctx.player.pos.x, ctx.player.pos.y + 1.4, ctx.player.pos.z);
  }
  return new THREE.Vector3(0, 1.4, 0);
}

// --- Enemy HP bar: a canvas sprite floating above the head. ---
function makeHpBar() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 10;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(1.4, 0.22, 1);
  sprite.position.y = 2.35;
  return { canvas, tex, sprite };
}

function drawHpBar(bar, frac) {
  const c = bar.canvas.getContext('2d');
  c.clearRect(0, 0, 64, 10);
  c.fillStyle = 'rgba(0,0,0,0.7)';
  c.fillRect(0, 0, 64, 10);
  c.fillStyle = frac > 0.5 ? '#2ecc71' : frac > 0.25 ? '#f1c40f' : '#e74c3c';
  c.fillRect(1, 1, Math.max(0, 62 * frac), 8);
  bar.tex.needsUpdate = true;
}

function buildThugMesh() {
  const group = new THREE.Group();
  group.name = 'thug';
  const shirtMat = new THREE.MeshLambertMaterial({ color: 0x7f8c8d });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xc68642 });
  const capMat = new THREE.MeshLambertMaterial({ color: 0x8e44ad });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.45, 4, 10), shirtMat);
  torso.position.y = 1.05;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skinMat);
  head.position.y = 1.72;
  group.add(head);
  // Cap / bandana so thugs read as thugs, not civilians.
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.28, 0.12, 12), capMat);
  cap.position.y = 1.9;
  group.add(cap);
  const armGeo = new THREE.BoxGeometry(0.16, 0.62, 0.16);
  const armL = new THREE.Mesh(armGeo, shirtMat);
  armL.position.set(-0.42, 1.15, 0);
  group.add(armL);
  const armR = new THREE.Mesh(armGeo, shirtMat);
  armR.position.set(0.42, 1.15, 0);
  group.add(armR);
  const legGeo = new THREE.BoxGeometry(0.2, 0.78, 0.2);
  const legL = new THREE.Mesh(legGeo, pantsMat);
  legL.position.set(-0.16, 0.41, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, pantsMat);
  legR.position.set(0.16, 0.41, 0);
  group.add(legR);
  return group;
}

export function init(ctx) {
  const combat = {
    weapons: [...BASE_WEAPONS], // + sniper/rpg once bought (refreshed in update)
    current: 'fists',
    enemies: [],
    _cooldown: 0,
    _prevMouse: false,
    _prevF: false,
    _flash: null,
    _flashT: 0,

    // Small muzzle-flash quad shown briefly at the gun tip.
    _showFlash(origin, dir) {
      if (!this._flash) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95 });
        this._flash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), mat);
        ctx.scene.add(this._flash);
      }
      this._flash.position.copy(origin).addScaledVector(dir, 1.0);
      this._flash.position.y = origin.y;
      this._flash.lookAt(ctx.camera ? ctx.camera.position : origin);
      this._flash.visible = true;
      this._flashT = 0.06;
    },

    _refreshWeapons() {
      const owned = (ctx.state && ctx.state.weaponsOwned) || [];
      const list = [...BASE_WEAPONS];
      for (const w of SHOP_WEAPONS) if (owned.includes(w)) list.push(w);
      this.weapons = list;
      if (!list.includes(this.current)) this.current = 'fists';
    },

    selectWeapon(name) {
      this._refreshWeapons();
      if (!this.weapons.includes(name)) return false;
      this.current = name;
      if (ctx.state) ctx.state.weapon = name;
      return true;
    },

    // Best target: nearest living enemy inside range and inside the aim cone.
    _pickTarget(origin, dir, range, maxAngle) {
      let best = null;
      let bestScore = Infinity;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const to = new THREE.Vector3(e.pos.x - origin.x, 0, e.pos.z - origin.z);
        const dist = to.length();
        if (dist > range) continue;
        to.normalize();
        const angle = Math.acos(Math.max(-1, Math.min(1, to.dot(dir))));
        if (angle > maxAngle) continue;
        const score = dist + angle * 10;
        if (score < bestScore) { bestScore = score; best = e; }
      }
      return best;
    },

    shoot() {
      if (this._cooldown > 0) return false;
      if (ctx.player && ctx.player.inCar) return false; // no drive-by shooting
      const stats = WEAPON_STATS[this.current] || WEAPON_STATS.fists;
      this._cooldown = stats.rate;

      const origin = aimOrigin(ctx);
      const dir = aimDirection(ctx);

      // Fists = punch: melee range, no muzzle flash.
      if (this.current === 'fists') return this.punch();

      // Muzzle flash + shot sound (guarded: audio/particles may be absent).
      this._showFlash(origin, dir);
      emitParticles(ctx, 'muzzle', origin.clone().addScaledVector(dir, 1.0), { count: 6 });
      playSound(ctx, this.current === 'shotgun' ? 'shotgun' : this.current === 'rpg' ? 'rpg' : 'gunshot');
      // Record the shot so nearby pedestrians flee (pedestrians.js reads
      // state.lastGunshot: { x, y, z, t } with t in seconds).
      if (ctx.state) {
        ctx.state.lastGunshot = {
          x: origin.x,
          y: typeof origin.y === 'number' ? origin.y : 0,
          z: origin.z,
          t: (typeof performance !== 'undefined' ? performance.now() : 0) / 1000,
        };
      }

      const cone = stats.spread > 0.1 ? 0.35 : stats.spread > 0.03 ? 0.18 : 0.08;
      const target = this._pickTarget(origin, dir, stats.range, cone);
      if (target) {
        this.damageEnemy(target, stats.damage);
        // Hit spark at the target.
        emitParticles(ctx, 'hit', new THREE.Vector3(target.pos.x, 1.4, target.pos.z), { count: 5 });
        if (stats.explosive) {
          emitParticles(ctx, 'explosion', new THREE.Vector3(target.pos.x, 1.0, target.pos.z), { count: 30 });
          playSound(ctx, 'explosion');
        }
        return true;
      }
      return true; // shot fired, nothing hit
    },

    punch() {
      if (this._cooldown > 0 && this.current === 'fists') {
        // Punch uses the same cooldown; shoot() already set it for fists.
      }
      const stats = WEAPON_STATS.fists;
      if (this.current !== 'fists') {
        // Non-fists punch (F when an enemy is close): light damage, own cooldown.
        if (this._cooldown > 0) return false;
        this._cooldown = 0.4;
      }
      const origin = aimOrigin(ctx);
      const dir = aimDirection(ctx);
      const target = this._pickTarget(origin, dir, stats.range, 0.9);
      if (target) {
        this.damageEnemy(target, stats.damage);
        playSound(ctx, 'punch');
        return true;
      }
      playSound(ctx, 'swing');
      return false;
    },

    spawnEnemy(x, z, hp = 100) {
      const mesh = buildThugMesh();
      mesh.position.set(x, 0, z);
      ctx.scene.add(mesh);
      const bar = makeHpBar();
      mesh.add(bar.sprite);
      drawHpBar(bar, 1);
      const enemy = {
        mesh,
        pos: mesh.position, // THREE.Vector3, same reference as mesh.position
        hp,
        maxHp: hp,
        alive: true,
        bar,
        wantedCounted: false,
        _phase: Math.random() * Math.PI * 2,
      };
      this.enemies.push(enemy);
      return enemy;
    },

    // Batch spawner the missions module calls for 'clear' steps:
    // spawnEnemies(count, center, opts) / spawnWave(...) — center is a
    // THREE.Vector3 (missions.landmarkPos) or an [x, z] array. Returns the
    // spawned enemies so missions can track them.
    spawnEnemies(count = 1, center, opts) {
      const out = [];
      const cx = center ? (typeof center.x === 'number' ? center.x : center[0] || 0) : 0;
      const cz = center ? (typeof center.z === 'number' ? center.z : center[1] || 0) : 0;
      const n = Math.max(1, Math.floor(count) || 1);
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2;
        out.push(this.spawnEnemy(cx + Math.cos(angle) * 6, cz + Math.sin(angle) * 6));
      }
      return out;
    },

    spawnWave(count, center, opts) {
      return this.spawnEnemies(count, center, opts);
    },

    damageEnemy(e, amount) {
      if (!e || !e.alive) return false;
      e.hp -= amount;
      drawHpBar(e.bar, Math.max(0, e.hp / e.maxHp));
      // Hitting an NPC/police raises the wanted level (police module reads it).
      if (!e.wantedCounted) {
        e.wantedCounted = true;
        if (ctx.state) {
          ctx.state.wanted = Math.min(5, (ctx.state.wanted || 0) + 1);
        }
      }
      if (e.hp <= 0) {
        e.alive = false;
        emitParticles(ctx, 'explosion', new THREE.Vector3(e.pos.x, 1.0, e.pos.z), { count: 12 });
        playSound(ctx, 'enemyDown');
        ctx.scene.remove(e.mesh);
        const i = this.enemies.indexOf(e);
        if (i >= 0) this.enemies.splice(i, 1);
        // Missions listen for kills via state (missions module polls enemies).
        if (ctx.state) ctx.state.kills = (ctx.state.kills || 0) + 1;
        return true; // killed
      }
      return false; // damaged, still alive
    },
  };

  combat._refreshWeapons();
  ctx.combat = combat;
  return combat;
}

export function update(dt, ctx) {
  const combat = ctx.combat;
  if (!combat) return;

  if (combat._cooldown > 0) combat._cooldown -= dt;
  if (combat._flash) {
    combat._flashT -= dt;
    if (combat._flashT <= 0) combat._flash.visible = false;
  }

  // Keep the weapon list in sync with shop purchases.
  combat._refreshWeapons();

  const input = ctx.input || {};
  const onFoot = !(ctx.player && ctx.player.inCar);

  // Mouse click to shoot (hold for auto weapons, click for semi-auto).
  const mouseDown = !!(input.mouseDown || input.clicked || input.fire || input.mouse0);
  const stats = WEAPON_STATS[combat.current] || WEAPON_STATS.fists;
  if (onFoot && mouseDown) {
    if (stats.auto) {
      if (combat._cooldown <= 0) combat.shoot();
    } else if (mouseDown && !combat._prevMouse) {
      combat.shoot();
    }
  }
  combat._prevMouse = mouseDown;

  // F: punch when fists are selected, or when an enemy is right next to you.
  const fDown = keyDown(input, 'KeyF');
  if (onFoot && fDown && !combat._prevF) {
    if (combat.current === 'fists') {
      combat._cooldown = 0; // let the punch through immediately
      combat.punch();
    } else {
      const origin = aimOrigin(ctx);
      const dir = aimDirection(ctx);
      const near = combat._pickTarget(origin, dir, WEAPON_STATS.fists.range, 0.9);
      if (near) combat.punch();
    }
  }
  combat._prevF = fDown;

  // Simple enemy behaviour: face the player and close in when nearby.
  const playerPos = ctx.player && ctx.player.pos;
  if (playerPos) {
    for (const e of combat.enemies) {
      if (!e.alive) continue;
      const dx = playerPos.x - e.pos.x;
      const dz = playerPos.z - e.pos.z;
      const dist = Math.hypot(dx, dz);
      e.mesh.rotation.y = Math.atan2(dx, dz);
      if (dist > 2.2 && dist < 25) {
        const step = 2.6 * dt;
        e.pos.x += (dx / dist) * step;
        e.pos.z += (dz / dist) * step;
        // Walk bob.
        e._phase += dt * 6;
        e.mesh.position.y = Math.abs(Math.sin(e._phase)) * 0.05;
      }
      // HP bar always faces the camera (sprites do this automatically).
    }
  }
}

export { WEAPON_STATS };
