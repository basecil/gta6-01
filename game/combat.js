// Combat: a pistol hitscan and a melee swing against every damageable actor (peds, cops, drivers,
// and cars when you aim at them). A shot draws a tracer, flashes the muzzle and a light, and
// returns what it hit so the caller can react (wanted stars, mission flags). Everything is in 3D
// line tests against cheap cylinder bodies plus the city's own collider boxes, so a shot into a
// tower stops at the tower instead of painting a tracer through it.

import * as THREE from 'three';

const EYE_HEIGHT = 1.28;
const BODY_RADIUS = 0.62;
const HEAD_HEIGHT = 1.62;
const MAX_RANGE = 110;

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,220,140,0.55)');
  gradient.addColorStop(1, 'rgba(255,190,90,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// Slab test against a 2D box, kept local so combat does not need the city's internals.
function boxHit(origin, direction, box, maxT) {
  let tMin = 0;
  let tMax = maxT;
  const axes = [
    [origin.x, direction.x, box.minX, box.maxX],
    [origin.z, direction.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-6) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  // The city blocks are tall slabs: a shot under the roofline hits, one over it flies on.
  const y = origin.y + direction.y * tMin;
  if (y < 0 || y > (box.height ?? 26)) return null;
  return tMin;
}

export function createCombat(scene) {
  const tracerGeo = new THREE.BufferGeometry();
  const tracerPositions = new Float32Array(6);
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPositions, 3));
  const tracer = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.0 }));
  tracer.frustumCulled = false;
  scene.add(tracer);

  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xffc86b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flashSprite.scale.set(2.4, 2.4, 1);
  scene.add(flashSprite);

  const sparkPool = [];
  for (let index = 0; index < 18; index += 1) {
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xffc25c, transparent: true, opacity: 0.9 }),
    );
    spark.visible = false;
    scene.add(spark);
    sparkPool.push({ mesh: spark, life: 0, vx: 0, vy: 0, vz: 0 });
  }

  const state = {
    hitmarker: 0,
    lastHit: null,
    lastHeadshot: false,
    shots: 0,
    hits: 0,
    flash: 0,
    tracer: 0,
  };

  // Cheap vertical capsule: the actor is a column of `radius` around (x, z) between y 0.1 and
  // `height`. Returns the distance along the ray to the near surface, or null.
  function rayActor(origin, direction, target) {
    const isCar = target.kind === 'car';
    const radius = isCar ? (target.spec ? target.spec.width * 0.62 : 1.3) : BODY_RADIUS;
    const height = isCar ? 1.55 : target.kind === 'officer' ? 1.85 : 1.78;
    const px = target.x - origin.x;
    const pz = target.z - origin.z;
    const along = px * direction.x + pz * direction.z;
    const lateralSq = px * px + pz * pz - along * along;
    if (lateralSq > radius * radius) return null;
    const chord = Math.sqrt(Math.max(0, radius * radius - lateralSq));
    let t = along - chord;
    if (t < 0) t = along > 0 ? 0 : -1;
    if (t < 0) return null;
    const y = origin.y + direction.y * t;
    if (y < 0.05 || y > height) return null;
    const head = !isCar && target.kind !== 'car' && y > HEAD_HEIGHT;
    return { distance: t, target, head };
  }

  function muzzleFlash(position, scale = 1) {
    flashSprite.position.copy(position);
    flashSprite.scale.set(2.4 * scale, 2.4 * scale, 1);
    flashSprite.material.opacity = 1;
    state.flash = 0.055;
  }

  function sparks(point, count = 6, tint = 0xffc25c) {
    let spawned = 0;
    for (const spark of sparkPool) {
      if (spawned >= count) break;
      if (spark.life > 0) continue;
      spark.mesh.visible = true;
      spark.mesh.position.copy(point);
      spark.mesh.material.color.setHex(tint);
      spark.life = 0.3;
      spark.vx = Math.sin(spawned * 2.4 + state.shots) * 3.1;
      spark.vy = 1.4 + Math.cos(spawned * 1.7) * 1.9;
      spark.vz = Math.cos(spawned * 2.9) * 3.1;
      spawned += 1;
    }
  }

  function tracerFrom(origin, end) {
    tracerPositions[0] = origin.x;
    tracerPositions[1] = origin.y;
    tracerPositions[2] = origin.z;
    tracerPositions[3] = end.x;
    tracerPositions[4] = end.y;
    tracerPositions[5] = end.z;
    tracerGeo.attributes.position.needsUpdate = true;
    tracer.material.opacity = 0.85;
    state.tracer = 0.06;
  }

  return {
    state,
    EYE_HEIGHT,
    fire(origin, direction, actors, options = {}) {
      state.shots += 1;
      muzzleFlash(origin, options.scale ?? 1);
      let best = null;
      for (const actor of actors) {
        if (!actor || actor.dead || actor.down) continue;
        const hit = rayActor(origin, direction, actor);
        if (hit && (!best || hit.distance < best.distance)) best = hit;
      }
      const range = options.range ?? MAX_RANGE;
      // Buildings stop the bullet: the nearest collider along the ray wins if it is closer.
      let wall = null;
      const boxes = options.city?.colliders;
      if (boxes) {
        for (const box of boxes) {
          const t = boxHit(origin, direction, box, Math.min(range, best ? best.distance : range));
          if (t != null && (!wall || t < wall)) wall = t;
        }
      }
      const distance = wall != null ? wall : best ? best.distance : range;
      const end = {
        x: origin.x + direction.x * distance,
        y: origin.y + direction.y * distance,
        z: origin.z + direction.z * distance,
      };
      tracerFrom(origin, end);

      if (wall != null && (!best || wall < best.distance - 0.05)) {
        // Wall strike: dust/sparks, no damage.
        sparks(new THREE.Vector3(end.x, Math.max(0.3, Math.min(6, end.y)), end.z), 4, 0x9fb4ff);
        return { hit: null, point: end, wall: true };
      }
      if (!best) return { hit: null, point: end, wall: false };

      state.hits += 1;
      state.hitmarker = 0.24;
      state.lastHit = best.target;
      state.lastHeadshot = Boolean(best.head);
      sparks(new THREE.Vector3(end.x, end.y, end.z), best.head ? 10 : 7, best.head ? 0xff5f7a : 0xffc25c);
      const base = options.damage ?? 34;
      best.target.hurt(best.head ? Math.round(base * 2.2) : base, options.kind ?? 'bullet');
      return { hit: best.target, point: end, wall: false, head: Boolean(best.head) };
    },
    melee(origin, heading, actors) {
      const direction = { x: Math.sin(heading), y: 0, z: Math.cos(heading) };
      const reach = 2.1;
      let hit = null;
      for (const actor of actors) {
        if (!actor || actor.dead || actor.down || actor.kind === 'car') continue;
        const dx = actor.x - origin.x;
        const dz = actor.z - origin.z;
        const distance = Math.hypot(dx, dz);
        if (distance > reach + 0.5) continue;
        const facing = (dx * direction.x + dz * direction.z) / (distance || 1);
        if (facing < 0.25) continue;
        hit = actor;
        actor.hurt(45, 'melee');
        break;
      }
      if (hit) {
        state.hitmarker = 0.22;
        state.lastHit = hit;
        state.lastHeadshot = false;
        sparks(new THREE.Vector3(hit.x, 1.1, hit.z), 4);
      }
      return hit;
    },
    update(dt) {
      state.flash = Math.max(0, state.flash - dt);
      state.tracer = Math.max(0, state.tracer - dt);
      state.hitmarker = Math.max(0, state.hitmarker - dt);
      flashSprite.material.opacity = state.flash > 0 ? state.flash / 0.055 : 0;
      tracer.material.opacity = state.tracer > 0 ? 0.85 * (state.tracer / 0.06) : 0;
      for (const spark of sparkPool) {
        if (spark.life <= 0) continue;
        spark.life -= dt;
        spark.mesh.position.x += spark.vx * dt;
        spark.mesh.position.y += spark.vy * dt;
        spark.mesh.position.z += spark.vz * dt;
        spark.vy -= 9 * dt;
        spark.mesh.material.opacity = Math.max(0, spark.life / 0.3);
        if (spark.life <= 0) spark.mesh.visible = false;
      }
    },
    reset() {
      state.shots = 0;
      state.hits = 0;
      state.lastHit = null;
      state.hitmarker = 0;
      for (const spark of sparkPool) {
        spark.life = 0;
        spark.mesh.visible = false;
      }
    },
  };
}
