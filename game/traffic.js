// Traffic: AI cars that keep to their lane, turn at intersections and brake for whatever is in
// front of them. Each car drives a rectangular loop around four grid lines, with its own lane
// offset and direction, so traffic is alive without pathfinding and identical for a given seed.
// Braking is a short cone test; this is arcade traffic, meant to read at screenshot distance.
//
// Traffic is deliberately lossy: a car that stalls for too long is re-seeded onto a fresh corner
// of the grid rather than left blocking a lane for the whole session.

import { createRng } from './rng.js';
import { createVehicle } from './vehicle.js';

const LANE = 3.7;
const TYPES = ['sedan', 'coupe', 'taxi', 'van', 'sedan', 'coupe', 'taxi', 'sedan'];

// Right-hand traffic: which side of the road line a car keeps, given its axis and direction.
function laneOffset(axis, dir) {
  if (axis === 'x') return dir > 0 ? -LANE : LANE;
  return dir > 0 ? LANE : -LANE;
}

function loopRoute(x0, x1, z0, z1, clockwise) {
  // Corner coordinates with lane offsets applied to each approach and exit.
  const corners = clockwise
    ? [
      { x: x0, z: z0, inAxis: 'z', outAxis: 'x', inDir: 1, outDir: 1 },
      { x: x1, z: z0, inAxis: 'x', outAxis: 'z', inDir: 1, outDir: 1 },
      { x: x1, z: z1, inAxis: 'z', outAxis: 'x', inDir: 1, outDir: -1 },
      { x: x0, z: z1, inAxis: 'x', outAxis: 'z', inDir: -1, outDir: -1 },
    ]
    : [
      { x: x0, z: z0, inAxis: 'z', outAxis: 'x', inDir: -1, outDir: 1 },
      { x: x1, z: z0, inAxis: 'x', outAxis: 'z', inDir: 1, outDir: -1 },
      { x: x1, z: z1, inAxis: 'z', outAxis: 'x', inDir: -1, outDir: -1 },
      { x: x0, z: z1, inAxis: 'x', outAxis: 'z', inDir: 1, outDir: 1 },
    ];
  const points = [];
  for (const corner of corners) {
    const inOffset = laneOffset(corner.inAxis, corner.inDir);
    const outOffset = laneOffset(corner.outAxis, corner.outDir);
    // Approach, corner entry, corner apex, corner exit: the steering limiter rounds them.
    if (corner.inAxis === 'x') {
      const z = corner.z + inOffset;
      points.push({ x: corner.x - corner.inDir * 15, z });
      points.push({ x: corner.x - corner.inDir * 4, z });
      points.push({ x: corner.x, z: corner.z + outOffset });
      points.push({ x: corner.x + corner.outDir * 4, z: corner.z + outOffset });
      points.push({ x: corner.x + corner.outDir * 15, z: corner.z + outOffset });
    } else {
      const x = corner.x + inOffset;
      points.push({ x, z: corner.z - corner.inDir * 15 });
      points.push({ x, z: corner.z - corner.inDir * 4 });
      points.push({ x: corner.x + outOffset, z: corner.z });
      points.push({ x: corner.x + outOffset, z: corner.z + corner.outDir * 4 });
      points.push({ x: corner.x + outOffset, z: corner.z + corner.outDir * 15 });
    }
  }
  return points;
}

export function createTraffic(scene, city, options = {}) {
  const rng = createRng(`traffic:${options.seed ?? 1}`);
  const count = options.count ?? 16;
  const lines = city.roadLines;
  const cars = [];
  const density = { scale: 1 };

  for (let index = 0; index < count; index += 1) {
    const a = rng.int(0, lines.length - 2);
    const b = rng.int(a + 1, Math.min(lines.length - 1, a + 2));
    const c = rng.int(0, lines.length - 2);
    const d = rng.int(c + 1, Math.min(lines.length - 1, c + 2));
    const route = loopRoute(lines[a], lines[b], lines[c], lines[d], rng.chance(0.5));
    const type = TYPES[index % TYPES.length];
    const car = createVehicle(scene, city, {
      type,
      colorIndex: rng.int(0, 7),
      x: route[0].x,
      z: route[0].z,
      heading: 0,
      ai: { route, waypoint: 1, cruise: type === 'van' ? 10 : rng.range(11, 17), stuck: 0 },
    });
    const next = route[1];
    car.heading = Math.atan2(next.x - car.x, next.z - car.z);
    car.speed = car.ai.cruise * 0.6;
    car.driver = { flee: false };
    car.sync();
    car.slot = index;
    cars.push(car);
  }

  function nearestAhead(car, others) {
    const forward = car.forward();
    let closest = Infinity;
    for (const other of others) {
      if (other === car || other.dead) continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const ahead = dx * forward.x + dz * forward.z;
      if (ahead < 0.5 || ahead > 15) continue;
      if (Math.abs(dx * forward.z - dz * forward.x) < 2.5) closest = Math.min(closest, ahead);
    }
    return closest;
  }

  // A stalled car blinks out and comes back on another corner after a while, so the grid never
  // clogs. The respawn draws from the loop's own rng, so a replay stays deterministic.
  function respawn(car) {
    const a = rng.int(0, lines.length - 2);
    const b = rng.int(a + 1, Math.min(lines.length - 1, a + 2));
    const c = rng.int(0, lines.length - 2);
    const d = rng.int(c + 1, Math.min(lines.length - 1, c + 2));
    car.ai.route = loopRoute(lines[a], lines[b], lines[c], lines[d], rng.chance(0.5));
    car.ai.waypoint = 1;
    car.ai.stuck = 0;
    car.x = car.ai.route[0].x;
    car.z = car.ai.route[0].z;
    car.speed = 0;
    car.hitFlash = 0;
    car.sync();
  }

  function update(dt, ctx) {
    const obstacles = cars.concat(ctx.cars ?? []);
    const player = ctx.player;
    for (const car of cars) {
      if (car.dead || !car.driver || car.driver.player) continue;
      car.mesh.visible = density.scale >= 1 || (car.slot ?? 0) % 4 < Math.round(density.scale * 4);
      const ai = car.ai;
      const waypoint = ai.route[ai.waypoint % ai.route.length];
      let dx = waypoint.x - car.x;
      let dz = waypoint.z - car.z;
      if (Math.hypot(dx, dz) < 4) {
        ai.waypoint = (ai.waypoint + 1) % ai.route.length;
        const next = ai.route[ai.waypoint];
        dx = next.x - car.x;
        dz = next.z - car.z;
      }
      const desired = Math.atan2(dx, dz);
      let delta = desired - car.heading;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const turnRate = Math.min(2.4, 0.9 + Math.abs(car.speed) * 0.055);
      car.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, delta));

      let target = ai.cruise * (Math.abs(delta) > 0.4 ? 0.5 : 1);
      const gap = nearestAhead(car, obstacles);
      if (ctx.playerCar) {
        const px = ctx.playerCar.x - car.x;
        const pz = ctx.playerCar.z - car.z;
        const forward = car.forward();
        const ahead = px * forward.x + pz * forward.z;
        if (ahead > 0.5 && ahead < 15 && Math.abs(px * forward.z - pz * forward.x) < 2.6) {
          target = Math.min(target, Math.max(0, (ahead - 3) * 1.5));
        }
      }
      if (player && !player.inCar && !player.down) {
        const px = player.x - car.x;
        const pz = player.z - car.z;
        const forward = car.forward();
        const ahead = px * forward.x + pz * forward.z;
        if (ahead > 0.4 && ahead < 12 && Math.abs(px * forward.z - pz * forward.x) < 2.2) {
          target = Math.min(target, Math.max(0, (ahead - 2.4) * 1.6));
        }
      }
      target = Math.min(target, Math.max(0, (gap - 3.4) * 1.7));
      if (gap < 3.4) target = 0;

      const rate = target > car.speed ? 7.5 : 15;
      car.speed += Math.max(-rate * dt, Math.min(rate * dt, target - car.speed));
      car.brake = car.speed < target - 0.5;
      const forward = car.forward();
      const nx = car.x + forward.x * car.speed * dt;
      const nz = car.z + forward.z * car.speed * dt;
      if (!city.collides(nx, nz, 1.1)) {
        car.x = nx;
        car.z = nz;
      } else {
        car.speed = 0;
        ai.stuck += dt;
        if (ai.stuck > 1.4) {
          car.heading += Math.PI * 0.6;
          ai.stuck = 0;
        }
        if (ai.stuck > 9) respawn(car);
      }
      car.wheelSpin += car.speed * dt * 1.4;
      car.sync();
    }

    // A car that reaches a walking player brakes hard; a close hit knocks them over.
    if (player && !player.inCar && !player.down && ctx.onPlayerHit) {
      for (const car of cars) {
        if (car.dead) continue;
        const distance = Math.hypot(player.x - car.x, player.z - car.z);
        if (distance < 2.2 && Math.abs(car.speed) > 5) {
          ctx.onPlayerHit(car, 0.8);
          car.speed *= 0.3;
        }
      }
    }
  }

  return {
    cars,
    update,
    setDensity(scale) {
      density.scale = Math.max(0, Math.min(1, scale));
    },
  };
}
