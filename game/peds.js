// Pedestrians: people walking the sidewalks with a small wander loop, plus the shared NPC damage
// model that pedestrians, drivers and cops use. Gunfire or a speeding car within earshot sends
// them sprinting away from the scare point for a few seconds; a hit drops them and they stay down.
//
// setDensity() thins the crowd for the harness and small screens without re-seeding it, and
// reset() puts every body back on its block so a retried mission starts with a full street.

import { createRng } from './rng.js';
import { createHumanoid } from './player.js';

function createPed(scene, rng, block, index) {
  const mesh = createHumanoid({ rng });
  const half = block.half - 3.2;
  const x = block.x + rng.range(-half, half);
  const z = block.z + (rng.chance(0.5) ? half : -half);
  const target = { x: block.x + rng.range(-half, half), z: block.z + (rng.chance(0.5) ? half : -half) };
  const ped = {
    kind: 'ped',
    id: `ped-${index}`,
    index,
    x,
    z,
    y: 0,
    heading: rng.range(0, Math.PI * 2),
    speed: 0,
    walkSpeed: rng.range(1.1, 1.7),
    target,
    block,
    mesh,
    health: 60,
    alive: true,
    down: false,
    deathTime: 0,
    panic: 0,
    sync(dt) {
      mesh.position.set(this.x, this.y, this.z);
      if (!this.down) mesh.rotation.y = this.heading;
      this.phase += dt * (1.6 + this.speed * 1.9);
      mesh.userData.pose(dt, this.speed, { deathTime: this.deathTime });
    },
    fleeFrom(point, amount = 1) {
      this.panic = Math.max(this.panic, 2.6 * amount);
      const dx = this.x - point.x;
      const dz = this.z - point.z;
      const distance = Math.hypot(dx, dz) || 1;
      this.target = {
        x: this.x + (dx / distance) * 22 + rng.range(-4, 4),
        z: this.z + (dz / distance) * 22 + rng.range(-4, 4),
      };
    },
    hurt(amount) {
      if (this.down) return false;
      this.health -= amount;
      this.panic = 3.5;
      this.fleeFrom({ x: this.x, z: this.z - 1 });
      if (this.health <= 0) {
        this.down = true;
        this.alive = false;
        this.deathTime = 0;
        return true;
      }
      return false;
    },
  };
  scene.add(mesh);
  return ped;
}

export function createPeds(scene, city, options = {}) {
  const rng = createRng(`peds:${options.seed ?? 1}`);
  const count = options.count ?? 34;
  const peds = [];
  for (let index = 0; index < count; index += 1) {
    const block = city.blocks[index % city.blocks.length];
    peds.push(createPed(scene, rng, block, index));
  }

  function scare(point, radius = 26, amount = 1) {
    for (const ped of peds) {
      if (ped.down) continue;
      if (Math.hypot(ped.x - point.x, ped.z - point.z) < radius) ped.fleeFrom(point, amount);
    }
  }

  function setDensity(scale) {
    const keep = Math.max(0, Math.min(1, scale));
    for (const ped of peds) {
      ped.mesh.visible = (ped.index % 10) < Math.round(keep * 10);
    }
  }

  function reset() {
    for (const ped of peds) {
      ped.health = 60;
      ped.down = false;
      ped.alive = true;
      ped.deathTime = 0;
      ped.panic = 0;
      ped.speed = 0;
      ped.mesh.visible = true;
      ped.mesh.rotation.z = 0;
      ped.mesh.position.set(ped.x, 0, ped.z);
      ped.mesh.userData.rig.state.dead = false;
    }
  }

  function update(dt, ctx) {
    for (const ped of peds) {
      if (ped.down) {
        ped.deathTime += dt;
        ped.sync(dt);
        continue;
      }
      if (ped.panic > 0) ped.panic = Math.max(0, ped.panic - dt);
      if (ped.panic > 0) {
        const dx = ped.target.x - ped.x;
        const dz = ped.target.z - ped.z;
        const distance = Math.hypot(dx, dz) || 1;
        if (distance < 2) {
          ped.target = { x: ped.x + (dx / distance) * 26, z: ped.z + (dz / distance) * 26 };
        }
        ped.heading += (Math.atan2(dx, dz) - ped.heading + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        ped.speed = Math.min(5.8, ped.speed + dt * 9);
        const nx = ped.x + (dx / distance) * ped.speed * dt;
        const nz = ped.z + (dz / distance) * ped.speed * dt;
        if (!city.collides(nx, nz, 0.4) && Math.abs(nx) < city.bounds && Math.abs(nz) < city.bounds) {
          ped.x = nx;
          ped.z = nz;
        } else {
          ped.heading += Math.PI * 0.5;
        }
      } else {
        const dx = ped.target.x - ped.x;
        const dz = ped.target.z - ped.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 1.6) {
          const half = ped.block.half - 3.2;
          ped.target = {
            x: ped.block.x + rng.range(-half, half),
            z: ped.block.z + rng.range(-half, half),
          };
        } else {
          const desired = Math.atan2(dx, dz);
          ped.heading += Math.atan2(Math.sin(desired - ped.heading), Math.cos(desired - ped.heading)) * Math.min(1, dt * 3);
          ped.speed += (ped.walkSpeed - ped.speed) * Math.min(1, dt * 4);
          const nx = ped.x + Math.sin(ped.heading) * ped.speed * dt;
          const nz = ped.z + Math.cos(ped.heading) * ped.speed * dt;
          if (!city.collides(nx, nz, 0.4)) {
            ped.x = nx;
            ped.z = nz;
          } else {
            ped.target = { x: ped.block.x, z: ped.block.z };
          }
        }
      }

      // React to a speeding car that passes close.
      for (const car of ctx.cars ?? []) {
        if (Math.abs(car.speed) < 7) continue;
        if (Math.hypot(car.x - ped.x, car.z - ped.z) < 4.6) {
          ped.fleeFrom({ x: car.x, z: car.z }, 0.6);
          break;
        }
      }

      ped.sync(dt);
    }
  }

  return { peds, scare, update, setDensity, reset, count: peds.length };
}
