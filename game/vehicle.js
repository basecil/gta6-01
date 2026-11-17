// Cars: arcade physics and the low-poly body kit that makes them read at a glance. A car is a
// point on the road with a heading, a signed speed and a steering angle; the model is boxes,
// cylinders and emissive strips built here so every car in the bay shares the same code.
//
// Every car carries its own damage state: a hit flashes the shell, low health sags the body on
// its springs, and a dead car keeps its wreck on the road (no lights) instead of vanishing.
// `dispose()` unlinks the mesh so a mission retry does not leak objects into the scene.

import * as THREE from 'three';

export const CAR_TYPES = {
  coupe: { length: 4.3, width: 1.86, height: 1.24, mass: 1.0, maxSpeed: 34 },
  sedan: { length: 4.6, width: 1.92, height: 1.34, mass: 1.1, maxSpeed: 31 },
  taxi: { length: 4.6, width: 1.92, height: 1.36, mass: 1.1, maxSpeed: 30 },
  van: { length: 5.4, width: 2.16, height: 2.1, mass: 1.5, maxSpeed: 26 },
  police: { length: 4.6, width: 1.94, height: 1.38, mass: 1.15, maxSpeed: 36 },
};

const BODY_COLORS = [0xff3ea5, 0x35e7ff, 0x4d7bff, 0xf2f0ff, 0x2b2b3d, 0xffc25c, 0x57f2a4, 0xb46bff];

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

let sharedGlow = null;
function glow() {
  if (!sharedGlow) sharedGlow = glowTexture();
  return sharedGlow;
}

const geometryCache = new Map();
function box(w, h, d) {
  const key = `${w}:${h}:${d}`;
  if (!geometryCache.has(key)) geometryCache.set(key, new THREE.BoxGeometry(w, h, d));
  return geometryCache.get(key);
}

function buildCarMesh(type, color, police) {
  const spec = CAR_TYPES[type] ?? CAR_TYPES.coupe;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x1a1824 });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x0e1a2c, emissive: 0x081524, emissiveIntensity: 0.8 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8, toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2f52, toneMapped: false });

  const L = spec.length;
  const W = spec.width;
  const H = spec.height;

  const lower = new THREE.Mesh(box(W, 0.52, L), bodyMat);
  lower.position.y = 0.58;
  group.add(lower);

  const hood = new THREE.Mesh(box(W - 0.12, 0.30, L * 0.30), bodyMat);
  hood.position.set(0, 0.86, L * 0.31);
  group.add(hood);

  const cabinHeight = type === 'van' ? 1.1 : 0.52;
  const cabin = new THREE.Mesh(box(W - 0.22, cabinHeight, L * (type === 'van' ? 0.62 : 0.46)), glassMat);
  cabin.position.set(0, 0.86 + cabinHeight / 2, type === 'van' ? L * 0.02 : -L * 0.05);
  group.add(cabin);

  const roof = new THREE.Mesh(box(W - 0.16, 0.16, L * (type === 'van' ? 0.64 : 0.48)), bodyMat);
  roof.position.set(0, 0.86 + cabinHeight + 0.06, cabin.position.z);
  group.add(roof);

  const bumperFront = new THREE.Mesh(box(W + 0.04, 0.22, 0.3), trimMat);
  bumperFront.position.set(0, 0.42, L / 2 - 0.08);
  group.add(bumperFront);
  const bumperBack = bumperFront.clone();
  bumperBack.position.z = -L / 2 + 0.08;
  group.add(bumperBack);

  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(box(0.42, 0.17, 0.08), lightMat);
    head.position.set(side * (W / 2 - 0.36), 0.72, L / 2 + 0.01);
    group.add(head);
    const tail = new THREE.Mesh(box(0.46, 0.16, 0.08), tailMat);
    tail.position.set(side * (W / 2 - 0.36), 0.74, -L / 2 - 0.01);
    group.add(tail);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0d0c14 });
  const rimMat = new THREE.MeshLambertMaterial({ color: 0x8a8fa8, emissive: 0x1a1d2a });
  const wheels = [];
  for (const zSign of [1, -1]) {
    for (const xSign of [1, -1]) {
      const wheel = new THREE.Group();
      const tyre = new THREE.Mesh(wheelGeo, wheelMat);
      tyre.rotation.z = Math.PI / 2;
      wheel.add(tyre);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 8), rimMat);
      rim.rotation.z = Math.PI / 2;
      rim.position.x = xSign * 0.01;
      wheel.add(rim);
      wheel.position.set(xSign * (W / 2 - 0.12), 0.36, zSign * (L / 2 - 0.92));
      group.add(wheel);
      wheels.push(wheel);
    }
  }

  if (police) {
    const stripe = new THREE.Mesh(box(W + 0.03, 0.2, L * 0.55), new THREE.MeshLambertMaterial({ color: 0x101018 }));
    stripe.position.set(0, 0.72, 0);
    group.add(stripe);
    const barBase = new THREE.Mesh(box(0.9, 0.08, 0.3), trimMat);
    barBase.position.set(0, 0.86 + cabinHeight + 0.14, 0.1);
    group.add(barBase);
    const red = new THREE.Mesh(box(0.4, 0.16, 0.26), new THREE.MeshBasicMaterial({ color: 0xff2f4d, toneMapped: false }));
    red.position.set(-0.24, 0.98 + cabinHeight, 0.1);
    group.add(red);
    const blue = new THREE.Mesh(box(0.4, 0.16, 0.26), new THREE.MeshBasicMaterial({ color: 0x2f8bff, toneMapped: false }));
    blue.position.set(0.24, 0.98 + cabinHeight, 0.1);
    group.add(blue);
    const barGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0xff2f4d, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    barGlow.scale.set(2.6, 1.2, 1);
    barGlow.position.set(0, 0.92 + cabinHeight, 0.1);
    group.add(barGlow);
    group.userData.bar = { red, blue, barGlow };
  }

  if (type === 'taxi') {
    const sign = new THREE.Mesh(box(0.72, 0.2, 0.3), new THREE.MeshBasicMaterial({ color: 0xffd166, toneMapped: false }));
    sign.position.set(0, 1.0 + cabinHeight, 0.1);
    group.add(sign);
  }

  const underglow = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 1.6, L + 1.6),
    new THREE.MeshBasicMaterial({ map: glow(), color, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = 0.04;
  group.add(underglow);

  const beam = new THREE.Mesh(
    new THREE.PlaneGeometry(5.4, 16),
    new THREE.MeshBasicMaterial({ map: glow(), color: 0xffe1ad, transparent: true, opacity: 0.24, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(0, 0.06, L / 2 + 7.4);
  group.add(beam);

  group.userData.wheels = wheels;
  group.userData.beam = beam;
  group.userData.tailMat = tailMat;
  group.userData.headMat = lightMat;
  group.userData.bodyMat = bodyMat;
  return group;
}

export function createVehicle(scene, city, options = {}) {
  const type = options.type ?? 'coupe';
  const spec = CAR_TYPES[type] ?? CAR_TYPES.coupe;
  const rngIndex = options.colorIndex ?? 0;
  const color = options.color ?? BODY_COLORS[rngIndex % BODY_COLORS.length];
  const police = type === 'police' || Boolean(options.police);
  const mesh = buildCarMesh(type, color, police);
  if (police && !mesh.userData.bar) {
    const bar = new THREE.Mesh(box(0.9, 0.2, 0.26), new THREE.MeshBasicMaterial({ color: 0xff2f4d, toneMapped: false }));
    bar.position.set(0, 1.6, 0);
    mesh.add(bar);
    mesh.userData.bar = { red: bar, blue: bar, barGlow: null };
  }
  scene.add(mesh);

  const car = {
    kind: 'car',
    type,
    police,
    color,
    mesh,
    x: options.x ?? 0,
    z: options.z ?? 0,
    heading: options.heading ?? 0,
    speed: 0,
    steer: 0,
    steering: 0,
    health: 100,
    dead: false,
    driver: null,
    ai: options.ai ?? null,
    wheelSpin: 0,
    brake: false,
    hitFlash: 0,
    spec,
    velocity: new THREE.Vector3(),
    forward() {
      return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
    },
    right() {
      return { x: Math.cos(this.heading), z: -Math.sin(this.heading) };
    },
    sync() {
      mesh.position.set(this.x, 0, this.z);
      mesh.rotation.y = this.heading;
      // A damaged car sits a little lower and leans; a wreck stays where it stopped.
      const sag = this.dead ? 0.16 : (1 - this.health / 100) * 0.06;
      mesh.position.y = sag;
      mesh.rotation.z = this.dead ? 0.06 : this.hitFlash > 0 ? Math.sin(this.hitFlash * 90) * 0.012 : 0;
      const tailMat = mesh.userData.tailMat;
      if (tailMat) tailMat.color.setHex(this.brake || (this.speed < 0.4 && this.driver) ? 0xff6a86 : 0xff2f52);
      const headMat = mesh.userData.headMat;
      if (headMat) headMat.color.setHex(this.dead ? 0x181820 : 0xfff0c8);
      const spin = this.wheelSpin;
      for (const wheel of mesh.userData.wheels) wheel.rotation.x = spin;
      if (mesh.userData.bar) {
        const pulse = Math.sin(this.hitFlash * 22) > 0;
        mesh.userData.bar.red.visible = pulse;
        mesh.userData.bar.blue.visible = !pulse;
        if (mesh.userData.bar.barGlow) mesh.userData.bar.barGlow.material.color.setHex(pulse ? 0xff2f4d : 0x2f8bff);
      }
    },
    update(dt, controls = {}) {
      if (this.dead) {
        this.speed = 0;
        return;
      }
      this.brake = false;
      const throttle = Math.max(-1, Math.min(1, controls.throttle ?? 0));
      const steerInput = Math.max(-1, Math.min(1, controls.steer ?? 0));
      const handbrake = Boolean(controls.handbrake);
      const boost = Boolean(controls.boost);

      const maxSpeed = this.spec.maxSpeed * (boost ? 1.26 : 1) * (this.health < 40 ? 0.82 : 1);
      const accel = 13 / this.spec.mass;
      const reverseAccel = 7 / this.spec.mass;

      if (throttle > 0) {
        this.speed += accel * throttle * dt * (this.speed > 0 ? 1 : 1.6);
      } else if (throttle < 0) {
        if (this.speed > 0.5) this.speed += throttle * 26 * dt;
        else this.speed += reverseAccel * throttle * dt;
      }

      const drag = handbrake ? 7.5 : 1.05;
      this.speed -= this.speed * drag * dt * 0.42;
      if (Math.abs(this.speed) < 0.06 && throttle === 0) this.speed = 0;
      this.speed = Math.max(-12, Math.min(maxSpeed, this.speed));

      const grip = handbrake ? 1.9 : 1.15;
      const speedFactor = Math.min(1, Math.abs(this.speed) / 7);
      this.steer += (steerInput - this.steer) * Math.min(1, dt * 9);
      const steerAmount = this.steer * grip * speedFactor * (this.speed < 0 ? -1 : 1);
      this.heading += steerAmount * 0.95 * dt * Math.min(1.6, Math.abs(this.speed) / 9 + 0.35);

      const forward = this.forward();
      const nx = this.x + forward.x * this.speed * dt;
      const nz = this.z + forward.z * this.speed * dt;

      const box = city.collides(nx, nz, 1.05);
      if (box) {
        // Damage comes from the impact speed, before the bounce reverses it.
        const impact = Math.abs(this.speed);
        this.speed *= -0.22;
        this.hitFlash = Math.max(this.hitFlash, 0.35);
        if (impact > 4) this.damage(impact * 0.7);
      } else {
        this.x = nx;
        this.z = nz;
      }

      const limit = city.bounds + 10;
      if (this.x > limit) { this.x = limit; this.speed *= -0.3; }
      if (this.x < -limit) { this.x = -limit; this.speed *= -0.3; }
      if (this.z > 188) { this.z = 188; this.speed *= -0.3; }
      if (this.z < -limit) { this.z = -limit; this.speed *= -0.3; }

      this.wheelSpin += this.speed * dt * 1.4;
      mesh.userData.beam.visible = this.speed >= -0.5;
      this.hitFlash = Math.max(0, this.hitFlash - dt);
    },
    hurt(amount) {
      this.damage(amount);
      if (this.driver && this.driver.flee) this.driver.flee = true;
    },
    // Truthful speed for the HUD and the radio's engine pitch.
    speedKmh() {
      return Math.abs(this.speed) * 3.6;
    },
    dispose() {
      scene.remove(mesh);
      mesh.traverse((child) => {
        if (child.isSprite && child.material) child.material.dispose();
      });
    },
    damage(amount) {
      this.health = Math.max(0, this.health - amount);
      this.hitFlash = Math.max(this.hitFlash, 0.4);
      if (this.health <= 0) {
        this.dead = true;
        this.speed = 0;
        mesh.rotation.z = 0.04;
        mesh.position.y = 0.05;
      }
    },
  };

  car.sync();
  return car;
}

// A cheap circle-vs-circle separation so cars do not sit inside one another.
export function resolveCarPair(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distance = Math.hypot(dx, dz);
  const minDistance = 2.6;
  if (distance > minDistance || distance < 0.0001) return false;
  const push = (minDistance - distance) / 2;
  const nx = dx / distance;
  const nz = dz / distance;
  if (!a.dead) { a.x -= nx * push; a.z -= nz * push; }
  if (!b.dead) { b.x += nx * push; b.z += nz * push; }
  const aAlong = a.forward().x * -nx + a.forward().z * -nz;
  const bAlong = b.forward().x * nx + b.forward().z * nz;
  if (aAlong > 0.3) { a.speed *= 0.6; a.hitFlash = 0.3; }
  if (bAlong > 0.3) { b.speed *= 0.6; b.hitFlash = 0.3; }
  return true;
}

export { BODY_COLORS };
