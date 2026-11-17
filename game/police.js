// The Neon Bay Police Department: wanted stars from 0 to 5, patrol cars that spawn behind the
// player and chase, foot officers that bail out and run you down, and a hideout that wipes the
// heat. Wanted decays only when you break line of sight and stay hidden for a while, so the stars
// in a screenshot mean the chase is really on.

import * as THREE from 'three';
import { createVehicle } from './vehicle.js';
import { createHumanoid } from './player.js';

const STAR_CRIMES = {
  steal: 1,
  ped: 2,
  cop: 3,
  ram: 1,
};

function lampGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createPolice(scene, city, options = {}) {
  const glow = lampGlowTexture();
  const state = {
    onCrime: null,
    wanted: 0,
    decay: 0,
    hiddenFor: 0,
    lineOfSight: false,
    lastCrime: 0,
    units: [],
    officers: [],
    spawnCooldown: 0,
    arrested: false,
    bustedTimer: 0,
  };

  const maxUnits = options.maxUnits ?? 4;

  // Set the stars directly (demo mode, save load, shot staging) and re-arm the pursuit.
  function setWanted(level) {
    state.wanted = Math.max(0, Math.min(5, Math.round(level)));
    state.decay = 0;
    state.hiddenFor = 0;
    if (state.wanted === 0) clear();
  }

  function crime(amount, player, kind = 'steal') {
    if (player.down) return;
    const base = STAR_CRIMES[kind] ?? 1;
    state.wanted = Math.min(5, Math.max(state.wanted, amount ?? base));
    state.decay = 0;
    state.hiddenFor = 0;
    state.lastCrime = 0.1;
    state.spawnCooldown = Math.min(state.spawnCooldown, 0.35);
  }

  function spawnUnit(player, offsetAngle = 0, offsetDistance = 62) {
    const angle = offsetAngle + Math.PI * 0.75;
    let x = player.x + Math.cos(angle) * offsetDistance;
    let z = player.z + Math.sin(angle) * offsetDistance;
    x = Math.max(-city.bounds + 12, Math.min(city.bounds - 12, x));
    z = Math.max(-city.bounds + 12, Math.min(150, z));
    if (city.collides(x, z, 2)) {
      x = player.x + 26;
      z = player.z + 8;
    }
    const car = createVehicle(scene, city, { type: 'police', x, z, heading: Math.atan2(player.x - x, player.z - z) });
    car.driver = { police: true };
    car.speed = 4;
    car.ai = { chase: true, ram: 0, stuck: 0 };
    car.sync();
    state.units.push(car);
    return car;
  }

  function spawnOfficer(x, z, heading = 0) {
    const mesh = createHumanoid({ coat: 0x2b3a66, trousers: 0x1c2338, skin: 0xd9a074, hair: 0x1c1420 });
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const officer = {
      kind: 'officer',
      x,
      z,
      heading,
      speed: 0,
      health: 100,
      down: false,
      deathTime: 0,
      mesh,
      fireTimer: 0.6,
      hurt(amount, source = 'bullet') {
        this.health -= amount;
        if (this.health <= 0 && !this.down) {
          this.down = true;
          this.deathTime = 0;
          if (source === 'bullet' && state.onCrime) state.onCrime('cop', 4);
        }
      },
      sync(dt) {
        mesh.position.set(this.x, 0, this.z);
        if (!this.down) mesh.rotation.y = this.heading;
        mesh.userData.pose(dt, this.speed, { deathTime: this.deathTime });
      },
    };
    state.officers.push(officer);
    return officer;
  }

  function clear() {
    state.wanted = 0;
    state.decay = 0;
    state.hiddenFor = 0;
    state.bustedTimer = 0;
    state.spawnCooldown = 0;
    for (const unit of state.units) {
      unit.dead = true;
      unit.mesh.visible = false;
    }
    for (const officer of state.officers) {
      officer.down = true;
      officer.mesh.visible = false;
    }
    state.units = [];
    state.officers = [];
  }

  function hasLineOfSight(player, viewer) {
    const distance = Math.hypot(player.x - viewer.x, player.z - viewer.z);
    if (distance > 62) return false;
    const steps = Math.ceil(distance / 6);
    for (let step = 1; step < steps; step += 1) {
      const t = step / steps;
      if (city.collides(viewer.x + (player.x - viewer.x) * t, viewer.z + (player.z - viewer.z) * t, 0.2)) return false;
    }
    return true;
  }

  function update(dt, ctx) {
    const player = ctx.player;
    state.lastCrime = Math.max(0, state.lastCrime - dt);
    state.spawnCooldown = Math.max(0, state.spawnCooldown - dt);

    const activeViewers = state.units.filter((u) => !u.dead).concat(state.officers.filter((o) => !o.down));
    state.lineOfSight = state.wanted > 0 && activeViewers.some((viewer) => hasLineOfSight(player, viewer));

    // Baseline line of sight: any patrol within 55m that is not blocked sees you.
    if (state.wanted > 0) {
      if (state.lineOfSight) {
        state.hiddenFor = 0;
        state.decay = 0;
      } else {
        state.hiddenFor += dt;
        if (state.hiddenFor > 4.5) state.decay += dt;
        if (state.decay > 1) {
          state.decay = 0;
          state.wanted = Math.max(0, state.wanted - 1);
          if (state.wanted === 0) clear();
        }
      }
    }

    if (state.units.some((unit) => unit.dead)) state.units = state.units.filter((unit) => !unit.dead);
    if (state.officers.some((officer) => officer.down && officer.deathTime > 12)) {
      state.officers = state.officers.filter((officer) => !(officer.down && officer.deathTime > 12));
    }

    // Spawn pursuit to match the wanted level.
    const desired = Math.min(maxUnits, Math.max(0, state.wanted));
    const alive = state.units.filter((u) => !u.dead).length;
    if (alive < desired && state.spawnCooldown <= 0 && !player.down) {
      spawnUnit(player, alive * 0.7, 70 + alive * 12);
      state.spawnCooldown = 3.2;
    }

    // Chase driving: steer at the player, ram when close, and brake if right on top of them.
    for (const unit of state.units) {
      if (unit.dead) continue;
      const ai = unit.ai;
      const dx = player.x - unit.x;
      const dz = player.z - unit.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 220) {
        unit.dead = true;
        unit.mesh.visible = false;
        continue;
      }
      const desiredHeading = Math.atan2(dx, dz);
      let delta = desiredHeading - unit.heading;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      unit.heading += Math.max(-2.7 * dt, Math.min(2.7 * dt, delta));

      let targetSpeed = distance > 22 ? 24 : distance > 9 ? 15 : 7;
      if (distance < 3.2) targetSpeed = 2;
      const blocked = city.collides(unit.x + Math.sin(unit.heading) * 3, unit.z + Math.cos(unit.heading) * 3, 1.4);
      if (blocked) {
        targetSpeed = 3;
        ai.stuck += dt;
        if (ai.stuck > 1.2) {
          unit.heading += 0.9;
          ai.stuck = 0;
        }
      } else {
        ai.stuck = 0;
      }
      unit.speed += Math.max(-22 * dt, Math.min(11 * dt, targetSpeed - unit.speed));
      const forward = unit.forward();
      const nx = unit.x + forward.x * unit.speed * dt;
      const nz = unit.z + forward.z * unit.speed * dt;
      if (!city.collides(nx, nz, 1.2)) {
        unit.x = nx;
        unit.z = nz;
      } else {
        unit.speed *= 0.4;
      }
      unit.wheelSpin += unit.speed * dt * 1.4;

      // Ram the player's car: shove it and take a small hit for the drama.
      const target = player.inCar ?? player;
      const ramDistance = Math.hypot(target.x - unit.x, target.z - unit.z);
      if (ramDistance < 3.4 && Math.abs(unit.speed) > 6) {
        if (player.inCar) {
          player.inCar.speed += 5;
          player.inCar.damage(4);
          if (ctx.onRam) ctx.onRam(unit);
        } else if (ctx.onPlayerHit) {
          ctx.onPlayerHit(unit, 0.6, 9);
        }
        unit.speed *= 0.5;
      }
      unit.sync();

    }

    // Keep two officers on foot for any wanted level above zero, near the action.
    const aliveOfficers = state.officers.filter((o) => !o.down).length;
    if (state.wanted > 0 && aliveOfficers < 2 && state.spawnCooldown <= 0 && !player.down) {
      const angle = (aliveOfficers + 1) * 2.1;
      spawnOfficer(
        Math.max(-city.bounds, Math.min(city.bounds, player.x + Math.cos(angle) * 24)),
        Math.max(-city.bounds, Math.min(150, player.z + Math.sin(angle) * 24)),
        angle,
      );
    }

    for (const officer of state.officers) {
      if (officer.down) {
        officer.deathTime += dt;
        officer.sync(dt);
        continue;
      }
      const dx = player.x - officer.x;
      const dz = player.z - officer.z;
      const distance = Math.hypot(dx, dz);
      officer.heading = Math.atan2(dx, dz);
      if (distance > 3.4) {
        officer.speed = Math.min(5.4, officer.speed + dt * 9);
        const nx = officer.x + Math.sin(officer.heading) * officer.speed * dt;
        const nz = officer.z + Math.cos(officer.heading) * officer.speed * dt;
        if (!city.collides(nx, nz, 0.4)) {
          officer.x = nx;
          officer.z = nz;
        }
      } else {
        officer.speed = 0;
        if (!player.down && state.wanted > 0) {
          state.bustedTimer += dt;
          if (state.bustedTimer > 1.4) {
            state.bustedTimer = 0;
            if (ctx.onBusted) ctx.onBusted();
          }
        }
      }
      officer.fireTimer -= dt;
      if (distance < 15 && distance > 4 && officer.fireTimer <= 0) {
        officer.fireTimer = 0.9 + (officer.health % 40) / 100;
        if (ctx.onOfficerShot) ctx.onOfficerShot(officer, 5);
      }
      officer.sync(dt);
    }
  }

  return {
    state,
    crime,
    clear,
    setWanted,
    update,
    spawnUnit,
    spawnOfficer,
    pursued() {
      return state.units.filter((u) => !u.dead).length + state.officers.filter((o) => !o.down).length;
    },
  };
}
