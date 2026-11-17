// The wheelman and everyone who walks. createHumanoid builds one low-poly person (torso, head,
// jointed arms and legs) so the player, pedestrians and cops share a silhouette; createPlayer
// adds the third-person controller: walk, run, jump, enter/exit a car, and a pistol in hand.
//
// The rig exposes one pose function that every actor calls: speed drives the stride, `aim`
// raises the pistol arm, `dead` tips the body over, and a `recoil` pulse kicks the shoulder back
// so shots read from behind the character. `pose()` is idempotent, so paused frames keep still.

import * as THREE from 'three';

const SKIN = [0xf2c9a0, 0xd9a074, 0xa9764f, 0x7d5236, 0x5b3a28];
const HAIR = [0x1c1420, 0x3a2418, 0x6b4a2a, 0xd9c48a, 0x2a2a3a];
const COATS = [0xff3ea5, 0x35e7ff, 0x57f2a4, 0xffc25c, 0xa06bff, 0x3a3450, 0x22202e];

function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

export function createHumanoid(options = {}) {
  const rng = options.rng;
  const skin = options.skin ?? (rng ? rng.pick(SKIN) : SKIN[0]);
  const coat = options.coat ?? (rng ? rng.pick(COATS) : 0xff3ea5);
  const trousers = options.trousers ?? (rng ? rng.pick([0x1a1824, 0x232236, 0x2c2a40, 0x3b3550]) : 0x232236);
  const hair = options.hair ?? (rng ? rng.pick(HAIR) : HAIR[0]);

  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: coat });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const legMat = new THREE.MeshLambertMaterial({ color: trousers });
  const hairMat = new THREE.MeshLambertMaterial({ color: hair });
  const shoeMat = new THREE.MeshLambertMaterial({ color: 0x0d0c12 });

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  group.add(hips);

  const torso = new THREE.Mesh(box(0.52, 0.62, 0.28), bodyMat);
  torso.position.y = 0.34;
  hips.add(torso);

  const collar = new THREE.Mesh(box(0.34, 0.12, 0.24), new THREE.MeshLambertMaterial({ color: 0x12111a }));
  collar.position.y = 0.63;
  hips.add(collar);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 8), skinMat);
  head.position.y = 0.76;
  head.scale.set(1, 1.08, 0.95);
  hips.add(head);

  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.158, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.58), hairMat);
  hairCap.position.set(0, 0.79, -0.006);
  hips.add(hairCap);

  function limb(width, length, depth, material) {
    const joint = new THREE.Group();
    const part = new THREE.Mesh(box(width, length, depth), material);
    part.position.y = -length / 2;
    joint.add(part);
    return { joint, part };
  }

  const armL = limb(0.14, 0.56, 0.15, bodyMat);
  armL.joint.position.set(-0.32, 0.58, 0);
  hips.add(armL.joint);
  const armR = limb(0.14, 0.56, 0.15, bodyMat);
  armR.joint.position.set(0.32, 0.58, 0);
  hips.add(armR.joint);

  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), skinMat);
  handL.position.set(0, -0.6, 0);
  armL.joint.add(handL);
  const handR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), skinMat);
  handR.position.set(0, -0.6, 0);
  armR.joint.add(handR);

  const legL = limb(0.18, 0.84, 0.2, legMat);
  legL.joint.position.set(-0.14, 0, 0);
  hips.add(legL.joint);
  const legR = limb(0.18, 0.84, 0.2, legMat);
  legR.joint.position.set(0.14, 0, 0);
  hips.add(legR.joint);

  for (const leg of [legL, legR]) {
    const shoe = new THREE.Mesh(box(0.2, 0.12, 0.32), shoeMat);
    shoe.position.set(0, -0.88, 0.05);
    leg.joint.add(shoe);
  }

  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(box(0.075, 0.13, 0.34), new THREE.MeshLambertMaterial({ color: 0x1b1b25 }));
  gun.add(gunBody);
  const gunGrip = new THREE.Mesh(box(0.07, 0.16, 0.09), new THREE.MeshLambertMaterial({ color: 0x2c2a36 }));
  gunGrip.position.set(0, -0.12, -0.06);
  gun.add(gunGrip);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, -0.24);
  gun.add(muzzle);
  gun.position.set(0, -0.58, -0.05);
  gun.rotation.x = Math.PI / 2;
  gun.visible = false;
  armR.joint.add(gun);

  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd98a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  flash.scale.set(0.7, 0.7, 1);
  flash.position.set(0, 0, -0.32);
  gun.add(flash);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.36, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  group.add(shadow);

  let phase = 0;
  const state = { armed: false, dead: false, aim: 0 };

  group.userData.rig = { hips, armL, armR, legL, legR, head, gun, flash, shadow, torso, state };

  group.userData.pose = function pose(dt, speed, opts = {}) {
    if (state.dead) {
      // Fall sideways from the hip, not around the feet, and settle instead of sinking forever.
      const fall = Math.min(1, (opts.deathTime ?? 1) * 2.2);
      group.rotation.z = (Math.PI / 2) * fall;
      group.position.y = -0.32 * fall;
      armL.joint.rotation.x = -0.4;
      armR.joint.rotation.x = -0.4;
      return;
    }
    state.dead = Boolean(opts.dead);
    const run = Math.min(1, speed / 6);
    phase += dt * (2.2 + speed * 1.05);
    const swing = Math.sin(phase) * (0.28 + run * 0.55);
    const other = Math.sin(phase + Math.PI) * (0.28 + run * 0.55);
    legL.joint.rotation.x = swing;
    legR.joint.rotation.x = other;
    if (state.armed) {
      const aim = opts.aim ?? 0;
      const recoil = opts.recoil ?? 0;
      armR.joint.rotation.x = -Math.PI / 2 + Math.sin(phase) * 0.05 - aim * 0.22 + recoil * 0.4;
      armR.joint.rotation.z = -0.06 - aim * 0.05;
      armL.joint.rotation.x = -swing * 0.55 * (1 - aim * 0.8);
    } else {
      armL.joint.rotation.x = other * 0.9;
      armR.joint.rotation.x = swing * 0.9;
    }
    hips.position.y = 0.92 + (opts.airborne ? 0.02 : Math.abs(Math.sin(phase)) * 0.035 * run);
    torso.rotation.x = run * 0.09;
    head.rotation.y = Math.sin(phase * 0.35) * 0.12 * (1 - run);
  };

  group.userData.setArmed = function setArmed(armed) {
    state.armed = armed;
    gun.visible = armed;
  };

  group.userData.muzzle = muzzle;
  group.userData.flash = flash;

  return group;
}

export function createPlayer(scene) {
  const mesh = createHumanoid({ coat: 0x35e7ff, trousers: 0x1a1824, skin: SKIN[0], hair: HAIR[0] });
  mesh.name = 'player';
  scene.add(mesh);

  const player = {
    x: 0,
    z: 96,
    y: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    heading: Math.PI,
    walkPhase: 0,
    speed: 0,
    health: 100,
    armor: 0,
    maxHealth: 100,
    cash: 0,
    ammo: 12,
    reserve: 60,
    magazineSize: 12,
    fireCooldown: 0,
    meleeCooldown: 0,
    reloadTimer: 0,
    inCar: null,
    mesh,
    down: false,
    downTimer: 0,
    hurtTimer: 0,
    deathTime: 0,
    pose(dt) {
      const rig = mesh.userData;
      mesh.position.set(this.x, this.y, this.z);
      if (!this.inCar) mesh.rotation.y = this.heading;
      rig.pose(dt, this.speed, { airborne: this.y > 0.05, aim: 0, deathTime: this.deathTime });
      if (this.down) rig.pose(dt, 0, { deathTime: this.deathTime });
    },
    setArmed(armed) {
      mesh.userData.setArmed(armed);
    },
    // Put the body down at a spot and forget any death/exit state. Used by respawn, load and
    // the shot staging so a retry never leaves a tilted corpse or a hidden mesh behind.
    snapTo(x, z, heading = this.heading) {
      this.x = x;
      this.z = z;
      this.y = 0;
      this.vy = 0;
      this.vx = 0;
      this.vz = 0;
      this.heading = heading;
      this.speed = 0;
      this.down = false;
      this.deathTime = 0;
      this.inCar = null;
      this.mesh.visible = true;
      this.mesh.rotation.z = 0;
      this.mesh.position.set(x, 0, z);
      this.mesh.rotation.y = heading;
      this.mesh.userData.rig.state.dead = false;
    },
    // Face a world point (used when entering a car, so the camera does not whip around).
    faceToward(x, z) {
      this.heading = Math.atan2(x - this.x, z - this.z);
      this.mesh.rotation.y = this.heading;
    },
    hurt(amount) {
      if (this.down) return;
      let damage = amount;
      if (this.armor > 0) {
        const absorbed = Math.min(this.armor, damage * 0.7);
        this.armor -= absorbed;
        damage -= absorbed;
      }
      this.health = Math.max(0, this.health - damage);
      this.hurtTimer = 0.5;
      if (this.health <= 0) {
        this.down = true;
        this.deathTime = 0;
        this.inCar = null;
      }
    },
    heal(amount) {
      this.health = Math.min(this.maxHealth, this.health + amount);
    },
    addArmor(amount) {
      this.armor = Math.min(100, this.armor + amount);
    },
  };

  return player;
}
