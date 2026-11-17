// NEON BAY's city: a deterministic six-by-six grid of blocks between asphalt roads, wrapped by a
// harbour, a pier and a skyline of blinking towers. Everything here is built from boxes, plans
// and instanced window lights, so it costs no texture downloads and rebuilds identically from
// the same seed. It also publishes the road map traffic, police and the minimap read.

import * as THREE from 'three';
import { createRng } from './rng.js';

export const CITY_SPEC = {
  spacing: 64,
  roadHalf: 8,
  lines: 7,
  half: 200,
  blockHalf: 16,
  sidewalkHalf: 24,
  waterZ: 196,
};

export const PALETTE = {
  skyTop: 0x0a0718,
  skyHorizon: 0x2a1338,
  fog: 0x140b24,
  asphalt: 0x14121e,
  sidewalk: 0x2b2740,
  curb: 0x39344f,
  building: [0x1b1a2d, 0x211d33, 0x1a2230, 0x241f38, 0x191b28],
  neon: [0xff3ea5, 0x35e7ff, 0xffc25c, 0x57f2a4, 0xa06bff],
  window: [0xffc25c, 0xffe6b4, 0x9fe8ff, 0xff9ad0, 0xcfd9ff],
  water: 0x081028,
  night: 0x05040c,
};

const SIGN_WORDS = [
  ['NEON BAY', '#ff3ea5'], ['HOTEL', '#35e7ff'], ['RAMEN 24H', '#ffc25c'],
  ['MARINA', '#57f2a4'], ['CLUB 88', '#a06bff'], ['PAWN', '#ffc25c'],
  ['MOTEL', '#ff3ea5'], ['ARCADE', '#35e7ff'], ['BAY LIQUOR', '#57f2a4'],
  ['DINER', '#ffc25c'], ['PIER 9', '#35e7ff'], ['CASINO', '#ff3ea5'],
];

function makeSignTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0716';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.strokeRect(9, 9, 494, 110);
  ctx.font = 'bold 62px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function makeSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#05030d');
  gradient.addColorStop(0.42, '#170a2c');
  gradient.addColorStop(0.68, '#3a1246');
  gradient.addColorStop(0.86, '#6b1f52');
  gradient.addColorStop(1, '#2a0f30');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createCity(scene, seed) {
  const rng = createRng(`city:${seed}`);
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  const spec = CITY_SPEC;
  const signTextures = SIGN_WORDS.map(([word, color]) => ({ texture: makeSignTexture(word, color), color }));
  const glow = glowTexture();
  const colliders = [];
  const blocks = [];
  const roads = [];
  const landmarks = [];
  const windowMatrices = [];
  const windowColors = [];
  const lampPositions = [];
  const parkedSpots = [];
  const allSigns = [];

  // ---- sky dome, moon and stars -------------------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(620, 24, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false }),
  );
  sky.name = 'sky';
  group.add(sky);

  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(17, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff2d6, fog: false }),
  );
  moon.position.set(-180, 120, -420);
  moon.lookAt(0, 30, 0);
  group.add(moon);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xffd9a0, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
  }));
  moonHalo.scale.set(130, 130, 1);
  moonHalo.position.copy(moon.position);
  group.add(moonHalo);

  const starGeo = new THREE.BufferGeometry();
  const starPositions = new Float32Array(360 * 3);
  for (let index = 0; index < 360; index += 1) {
    const theta = rng.range(0, Math.PI * 2);
    const phi = rng.range(0.06, 0.52);
    const radius = 540;
    starPositions[index * 3] = Math.cos(theta) * Math.cos(phi) * radius;
    starPositions[index * 3 + 1] = Math.sin(phi) * radius;
    starPositions[index * 3 + 2] = Math.sin(theta) * Math.cos(phi) * radius;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xd8d4ff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false,
  }));
  group.add(stars);

  // ---- ground, water, harbour ---------------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(spec.half * 2 + 120, spec.half * 2 + 120),
    new THREE.MeshLambertMaterial({ color: 0x0d0b16 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  group.add(ground);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 760),
    new THREE.MeshLambertMaterial({ color: PALETTE.water, emissive: 0x050a22, emissiveIntensity: 1 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.35, spec.waterZ + 380);
  group.add(water);

  for (let index = 0; index < 26; index += 1) {
    const streak = new THREE.Mesh(
      new THREE.PlaneGeometry(rng.range(8, 42), 0.55),
      new THREE.MeshBasicMaterial({ color: rng.pick([0x2f6f9c, 0xff3ea5, 0x35e7ff]), transparent: true, opacity: rng.range(0.15, 0.5) }),
    );
    streak.rotation.x = -Math.PI / 2;
    streak.position.set(rng.range(-320, 320), 0.02, rng.range(spec.waterZ + 6, spec.waterZ + 220));
    group.add(streak);
  }

  // A pier reaching into the bay, with lamps and crates.
  const pier = new THREE.Mesh(new THREE.BoxGeometry(130, 1.2, 34), new THREE.MeshLambertMaterial({ color: 0x2c2438 }));
  pier.position.set(84, 0.2, spec.waterZ + 20);
  group.add(pier);
  for (let index = 0; index < 7; index += 1) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.4, 0.4), new THREE.MeshLambertMaterial({ color: 0x181622 }));
    lamp.position.set(84 + (index - 3) * 17, 3.2, spec.waterZ + 34);
    group.add(lamp);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    bulb.position.set(84 + (index - 3) * 17, 6.1, spec.waterZ + 34);
    group.add(bulb);
  }
  landmarks.push({ name: 'Pier 9', x: 84, z: spec.waterZ + 20 });

  // ---- the bay bridge, the container docks and the story storefronts -------------------------
  // The bridge crosses the channel east of the marina: two lit decks and a row of pylons, so the
  // briefing vista has a landmark to frame and the finale's "decoy chase" has somewhere to happen.
  const bridgeZ = spec.waterZ + 12;
  for (const side of [-1, 1]) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(150, 1.6, 12), new THREE.MeshLambertMaterial({ color: 0x37304a }));
    deck.position.set(-150, 9, bridgeZ + side * 26);
    group.add(deck);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(150, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: 0x35e7ff, toneMapped: false }));
    rail.position.set(-150, 10.1, bridgeZ + side * 26 + 5.9);
    group.add(rail);
  }
  for (let index = 0; index < 6; index += 1) {
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 34, 8), new THREE.MeshLambertMaterial({ color: 0x241f33 }));
    pylon.position.set(-90 - index * 24, 17, bridgeZ);
    group.add(pylon);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.44, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffc25c, toneMapped: false }));
    cap.position.set(-90 - index * 24, 34.4, bridgeZ);
    group.add(cap);
  }
  landmarks.push({ name: 'Bay Bridge', x: -150, z: bridgeZ });

  // Container stacks on the north dock: the heist's cargo, and a strong silhouette for the map.
  const boxGeoDock = new THREE.BoxGeometry(9, 8, 4.4);
  const containerColors = [0xff3ea5, 0x2f8bff, 0x57f2a4, 0xffc25c];
  for (let index = 0; index < 14; index += 1) {
    const container = new THREE.Mesh(boxGeoDock, new THREE.MeshLambertMaterial({ color: containerColors[index % containerColors.length] }));
    container.position.set(96 + (index % 5) * 10.5, 4 + Math.floor(index / 5) * 8.2, -118 + Math.floor(index / 5) * 1.2);
    container.rotation.y = rng.range(-0.04, 0.04);
    group.add(container);
  }
  landmarks.push({ name: 'Container Docks', x: 110, z: -118 });

  // Storefront blades the story names: jewellery, casino and the marina office.
  const storySigns = [
    { word: 'KOWALSKI & SONS', color: '#ffc25c', x: -64, z: 32, rot: Math.PI * 0.5 },
    { word: 'CASINO 88', color: '#ff3ea5', x: 64, z: -64, rot: -Math.PI * 0.5 },
    { word: 'MARINA OFFICE', color: '#35e7ff', x: -64, z: -64, rot: Math.PI * 0.5 },
  ];
  for (const item of storySigns) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 2.75),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(item.word, item.color), transparent: true, toneMapped: false }),
    );
    sign.position.set(item.x, 7.4, item.z);
    sign.rotation.y = item.rot;
    group.add(sign);
    allSigns.push(sign);
    landmarks.push({ name: item.word, x: item.x, z: item.z });
  }

  // ---- roads and sidewalks -------------------------------------------------------------------
  const roadMat = new THREE.MeshLambertMaterial({ color: PALETTE.asphalt });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xc9c2a0 });
  const dashGeo = new THREE.BoxGeometry(0.28, 0.02, 3.2);
  const dashCount = spec.lines * 2 * 22;
  const dashes = new THREE.InstancedMesh(dashGeo, lineMat, dashCount);
  const dummy = new THREE.Object3D();
  let dashIndex = 0;
  const roadLines = [];
  for (let index = 0; index < spec.lines; index += 1) {
    const pos = (index - (spec.lines - 1) / 2) * spec.spacing;
    roadLines.push(pos);
  }

  for (const line of roadLines) {
    const across = new THREE.Mesh(new THREE.PlaneGeometry(spec.half * 2, spec.roadHalf * 2), roadMat);
    across.rotation.x = -Math.PI / 2;
    across.position.set(0, 0.01, line);
    group.add(across);
    const along = new THREE.Mesh(new THREE.PlaneGeometry(spec.roadHalf * 2, spec.half * 2), roadMat);
    along.rotation.x = -Math.PI / 2;
    along.position.set(line, 0.012, 0);
    group.add(along);
    roads.push({ axis: 'x', pos: line });
    roads.push({ axis: 'z', pos: line });

    for (let step = -spec.half; step < spec.half; step += 12) {
      if (roadLines.some((other) => Math.abs(other - step) < 9)) continue;
      dummy.position.set(step + 3, 0.03, line);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      if (dashIndex < dashCount) dashes.setMatrixAt(dashIndex, dummy.matrix);
      dashIndex += 1;
      dummy.position.set(line, 0.032, step + 3);
      dummy.rotation.set(0, Math.PI / 2, 0);
      dummy.updateMatrix();
      if (dashIndex < dashCount) dashes.setMatrixAt(dashIndex, dummy.matrix);
      dashIndex += 1;
    }
  }
  dashes.count = Math.min(dashIndex, dashCount);
  dashes.instanceMatrix.needsUpdate = true;
  group.add(dashes);

  const sidewalkMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
  const curbMat = new THREE.MeshLambertMaterial({ color: PALETTE.curb });
  const crossMat = new THREE.MeshBasicMaterial({ color: 0xbfb9a6 });

  for (let gx = 0; gx < spec.lines - 1; gx += 1) {
    for (let gz = 0; gz < spec.lines - 1; gz += 1) {
      const centerX = roadLines[gx] + spec.spacing / 2;
      const centerZ = roadLines[gz] + spec.spacing / 2;
      const size = spec.spacing - spec.roadHalf * 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(size, 0.18, size), sidewalkMat);
      slab.position.set(centerX, 0.09, centerZ);
      group.add(slab);
      const plot = new THREE.Mesh(new THREE.BoxGeometry(size - 14, 0.19, size - 14), curbMat);
      plot.position.set(centerX, 0.1, centerZ);
      group.add(plot);
      blocks.push({ x: centerX, z: centerZ, half: spec.blockHalf, sidewalkHalf: spec.sidewalkHalf });
    }
  }

  // Crosswalks on every intersection arm.
  const crossGeo = new THREE.BoxGeometry(6.4, 0.03, 1.1);
  const crosses = new THREE.InstancedMesh(crossGeo, crossMat, roadLines.length * roadLines.length * 16);
  let crossIndex = 0;
  for (const x of roadLines) {
    for (const z of roadLines) {
      for (let stripe = 0; stripe < 4; stripe += 1) {
        const offset = (stripe - 1.5) * 1.6;
        for (const sign of [-1, 1]) {
          dummy.position.set(x + offset, 0.035, z + sign * 10.5);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          crosses.setMatrixAt(crossIndex++, dummy.matrix);
          dummy.position.set(x + sign * 10.5, 0.036, z + offset);
          dummy.rotation.set(0, Math.PI / 2, 0);
          dummy.updateMatrix();
          crosses.setMatrixAt(crossIndex++, dummy.matrix);
        }
      }
    }
  }
  crosses.count = Math.min(crossIndex, roadLines.length * roadLines.length * 16);
  group.add(crosses);

  // ---- buildings -----------------------------------------------------------------------------
  // Every building body, roof, antenna and beacon is instances of one box/cylinder/sphere, so the
  // whole skyline is six draw calls and the rest of the city stays cheap on a software rasteriser.
  const buildingInstances = [];
  const roofInstances = [];
  const antennaInstances = [];
  const beaconInstances = [];

  function addBuilding(cx, cz, width, depth, height, materialIndex) {
    const bodyColor = new THREE.Color(PALETTE.building[materialIndex % PALETTE.building.length]);
    bodyColor.multiplyScalar(rng.range(0.78, 1.25));
    buildingInstances.push({ x: cx, z: cz, w: width, h: height, d: depth, color: bodyColor });
    roofInstances.push({ x: cx, y: height + 0.4, z: cz, w: width + 0.6, h: 0.8, d: depth + 0.6 });

    colliders.push({
      minX: cx - width / 2 - 0.4, maxX: cx + width / 2 + 0.4,
      minZ: cz - depth / 2 - 0.4, maxZ: cz + depth / 2 + 0.4, height,
    });

    // Window grid on all four faces as one instanced draw call later.
    const rows = Math.max(2, Math.floor((height - 4) / 3.4));
    const litChance = rng.range(0.18, 0.55);
    const faces = [
      { nx: 0, nz: 1, len: width, offset: depth / 2 + 0.06 },
      { nx: 0, nz: -1, len: width, offset: depth / 2 + 0.06 },
      { nx: 1, nz: 0, len: depth, offset: width / 2 + 0.06 },
      { nx: -1, nz: 0, len: depth, offset: width / 2 + 0.06 },
    ];
    for (const face of faces) {
      const perRow = Math.max(2, Math.floor(face.len / 2.8));
      for (let row = 0; row < rows; row += 1) {
        const y = 4.2 + row * 3.4;
        if (y > height - 1.6) break;
        for (let col = 0; col < perRow; col += 1) {
          const offset = (col - (perRow - 1) / 2) * 2.6;
          const lit = rng.next() < litChance;
          if (!lit) continue;
          dummy.position.set(
            cx + face.nx * face.offset + (face.nx === 0 ? offset : 0),
            y,
            cz + face.nz * face.offset + (face.nz === 0 ? offset : 0),
          );
          dummy.scale.set(face.nx === 0 ? 1.5 : 0.12, 1.05, face.nz === 0 ? 1.5 : 0.12);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          windowMatrices.push(dummy.matrix.clone());
          const tint = new THREE.Color(rng.pick(PALETTE.window));
          tint.multiplyScalar(rng.range(0.55, 1));
          windowColors.push(tint);
        }
      }
    }
    dummy.scale.set(1, 1, 1);

    // A handful of buildings get a rooftop antenna with a red aircraft lamp.
    if (height > 26 && rng.chance(0.45)) {
      antennaInstances.push({ x: cx, y: height + 4.6, z: cz });
      beaconInstances.push({ x: cx, y: height + 8.8, z: cz });
    }

    // Vertical neon signs bolted to the facade.
    if (rng.chance(0.34)) {
      const sign = rng.pick(signTextures);
      const side = rng.chance(0.5) ? 1 : -1;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 2.6),
        new THREE.MeshBasicMaterial({ map: sign.texture, transparent: true, toneMapped: false }),
      );
      plane.position.set(cx + side * (width / 2 + 0.14), Math.min(height - 4, rng.range(9, 20)), cz + rng.range(-depth / 4, depth / 4));
      plane.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(plane);
      allSigns.push(plane);

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow, color: new THREE.Color(sign.color), transparent: true, opacity: 0.4, depthWrite: false,
      }));
      halo.scale.set(15, 6, 1);
      halo.position.copy(plane.position);
      halo.position.x += side * 0.4;
      group.add(halo);
    }

    // Corner blade sign listing the building's trade.
    if (rng.chance(0.16)) {
      const sign = rng.pick(signTextures);
      const blade = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 0.8),
        new THREE.MeshBasicMaterial({ map: sign.texture, transparent: true, toneMapped: false }),
      );
      blade.position.set(cx + width / 2 - 1.4, height * 0.55, cz + depth / 2 + 0.1);
      group.add(blade);
      allSigns.push(blade);
    }
  }

  for (const block of blocks) {
    const split = rng.next();
    const plot = block.half;
    if (split < 0.34) {
      const height = rng.range(16, 42);
      addBuilding(block.x + rng.range(-2, 2), block.z + rng.range(-2, 2), rng.range(20, 30), rng.range(20, 30), height, rng.int(0, 4));
    } else if (split < 0.72) {
      const horizontal = rng.chance(0.5);
      for (const side of [-1, 1]) {
        const w = horizontal ? rng.range(18, 26) : rng.range(11, 15);
        const d = horizontal ? rng.range(11, 15) : rng.range(18, 26);
        addBuilding(
          block.x + (horizontal ? 0 : side * plot * 0.42) + rng.range(-1, 1),
          block.z + (horizontal ? side * plot * 0.42 : 0) + rng.range(-1, 1),
          w, d, rng.range(11, 34), rng.int(0, 4),
        );
      }
    } else {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          addBuilding(
            block.x + sx * plot * 0.42 + rng.range(-1, 1),
            block.z + sz * plot * 0.42 + rng.range(-1, 1),
            rng.range(11, 15), rng.range(11, 15), rng.range(9, 28), rng.int(0, 4),
          );
        }
      }
    }
  }

  // The two landmarks: Bay Tower (tall, crown of light) and the Neon Arch over the main drag.
  const towerX = 32;
  const towerZ = -96;
  addBuilding(towerX, towerZ, 26, 26, 74, 1);
  for (let ring = 0; ring < 4; ring += 1) {
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(28 - ring * 3, 0.7, 28 - ring * 3),
      new THREE.MeshBasicMaterial({ color: ring % 2 ? 0xff3ea5 : 0x35e7ff, transparent: true, opacity: 0.85 }),
    );
    crown.position.set(towerX, 60 + ring * 3.4, towerZ);
    group.add(crown);
  }
  landmarks.push({ name: 'Bay Tower', x: towerX, z: towerZ });
  parkedSpots.push({ x: towerX + 20, z: towerZ + 20, heading: 0 });

  const archX = 0;
  const archZ = 32;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, 13, 1.2), new THREE.MeshLambertMaterial({ color: 0x221e33 }));
    post.position.set(archX + side * 16, 6.5, archZ);
    group.add(post);
    colliders.push({ minX: archX + side * 16 - 0.9, maxX: archX + side * 16 + 0.9, minZ: archZ - 0.9, maxZ: archZ + 0.9, height: 13 });
  }
  const archTop = new THREE.Mesh(new THREE.BoxGeometry(34, 1.4, 1.4), new THREE.MeshBasicMaterial({ color: 0xff3ea5 }));
  archTop.position.set(archX, 13, archZ);
  group.add(archTop);
  const archSign = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 4.2),
    new THREE.MeshBasicMaterial({ map: makeSignTexture('NEON BAY', '#ff3ea5'), transparent: true, toneMapped: false }),
  );
  archSign.position.set(archX, 15.4, archZ + 0.2);
  archSign.rotation.y = Math.PI;
  group.add(archSign);
  const archSignBack = archSign.clone();
  archSignBack.rotation.y = 0;
  archSignBack.position.z = archZ - 0.2;
  group.add(archSignBack);
  landmarks.push({ name: 'Neon Arch', x: archX, z: archZ });

  // ---- building, roof, antenna and beacon instances -------------------------------------------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildings = new THREE.InstancedMesh(
    boxGeo,
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    Math.max(1, buildingInstances.length),
  );
  const buildingColors = new Float32Array(Math.max(1, buildingInstances.length) * 3);
  buildingInstances.forEach((item, index) => {
    dummy.position.set(item.x, item.h / 2, item.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(item.w, item.h, item.d);
    dummy.updateMatrix();
    buildings.setMatrixAt(index, dummy.matrix);
    buildingColors[index * 3] = item.color.r;
    buildingColors[index * 3 + 1] = item.color.g;
    buildingColors[index * 3 + 2] = item.color.b;
  });
  buildings.instanceColor = new THREE.InstancedBufferAttribute(buildingColors, 3);
  buildings.instanceMatrix.needsUpdate = true;
  buildings.count = buildingInstances.length;
  group.add(buildings);

  const roofs = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x14121f }), Math.max(1, roofInstances.length));
  roofInstances.forEach((item, index) => {
    dummy.position.set(item.x, item.y, item.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(item.w, item.h, item.d);
    dummy.updateMatrix();
    roofs.setMatrixAt(index, dummy.matrix);
  });
  roofs.instanceMatrix.needsUpdate = true;
  roofs.count = roofInstances.length;
  group.add(roofs);

  const masts = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.18, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x2b2738 }),
    Math.max(1, antennaInstances.length),
  );
  antennaInstances.forEach((item, index) => {
    dummy.position.set(item.x, item.y, item.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    masts.setMatrixAt(index, dummy.matrix);
  });
  masts.instanceMatrix.needsUpdate = true;
  masts.count = antennaInstances.length;
  group.add(masts);

  const beacons = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.34, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xff4d6d }),
    Math.max(1, beaconInstances.length),
  );
  beaconInstances.forEach((item, index) => {
    dummy.position.set(item.x, item.y, item.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    beacons.setMatrixAt(index, dummy.matrix);
  });
  beacons.instanceMatrix.needsUpdate = true;
  beacons.count = beaconInstances.length;
  group.add(beacons);
  dummy.scale.set(1, 1, 1);

  // ---- window instances (one draw call for the whole city) ------------------------------------
  const windowGeo = new THREE.PlaneGeometry(1, 1);
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const windows = new THREE.InstancedMesh(windowGeo, windowMat, Math.max(1, windowMatrices.length));
  const colorArray = new Float32Array(Math.max(1, windowColors.length) * 3);
  for (let index = 0; index < windowMatrices.length; index += 1) {
    windows.setMatrixAt(index, windowMatrices[index]);
    colorArray[index * 3] = windowColors[index].r;
    colorArray[index * 3 + 1] = windowColors[index].g;
    colorArray[index * 3 + 2] = windowColors[index].b;
  }
  windows.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
  windows.instanceMatrix.needsUpdate = true;
  windows.count = windowMatrices.length;
  group.add(windows);

  // ---- streetlights --------------------------------------------------------------------------
  for (const block of blocks.slice(0, 30)) {
    for (const corner of [[-1, -1], [1, 1]]) {
      lampPositions.push({
        x: block.x + corner[0] * (block.sidewalkHalf - 1.6),
        z: block.z + corner[1] * (block.sidewalkHalf - 1.6),
      });
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.14, 0.2, 8.4, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x24202f });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampPositions.length);
  const bulbGeo = new THREE.SphereGeometry(0.42, 8, 8);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampPositions.length);
  const lampGlow = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicMaterial({ map: glow, color: 0xffbe73, transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending }),
    lampPositions.length,
  );
  lampPositions.forEach((lamp, index) => {
    dummy.position.set(lamp.x, 4.2, lamp.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(index, dummy.matrix);
    dummy.position.set(lamp.x, 8.5, lamp.z);
    dummy.updateMatrix();
    bulbs.setMatrixAt(index, dummy.matrix);
    dummy.position.set(lamp.x, 8.5, lamp.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    lampGlow.setMatrixAt(index, dummy.matrix);
  });
  dummy.rotation.set(0, 0, 0);
  group.add(poles, bulbs, lampGlow);

  // Six real point lights near the middle of town for pooling light on the asphalt.
  const lightSpots = [
    [0, 32], [64, 0], [-64, 0], [0, -64], [32, 96], [-96, 64],
  ];
  const streetLights = [];
  for (const [x, z] of lightSpots) {
    const light = new THREE.PointLight(0xffb36b, 22, 58, 2);
    light.position.set(x, 8.2, z);
    group.add(light);
    streetLights.push(light);
  }

  const hemi = new THREE.HemisphereLight(0x584a8c, 0x0b0913, 1.15);
  scene.add(hemi);
  const moonLight = new THREE.DirectionalLight(0x9aa4ff, 0.85);
  moonLight.position.set(-80, 110, -60);
  scene.add(moonLight);
  const pinkFill = new THREE.DirectionalLight(0xff3ea5, 0.22);
  pinkFill.position.set(120, 40, 90);
  scene.add(pinkFill);

  scene.fog = new THREE.FogExp2(PALETTE.fog, 0.0032);
  scene.background = new THREE.Color(PALETTE.night);

  // ---- parked cars along the curbs (static props, stealable) ---------------------------------
  for (const block of blocks) {
    if (!rng.chance(0.5)) continue;
    const side = rng.pick([-1, 1]);
    const lane = spec.roadHalf + 2.6;
    if (rng.chance(0.5)) {
      parkedSpots.push({ x: block.x + rng.range(-12, 12), z: block.z + side * (block.sidewalkHalf + lane), heading: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
    } else {
      parkedSpots.push({ x: block.x + side * (block.sidewalkHalf + lane), z: block.z + rng.range(-12, 12), heading: side > 0 ? Math.PI : 0 });
    }
  }

  // ---- distant skyline silhouettes -----------------------------------------------------------
  const skyline = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x120d20 }), 46);
  const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.5, 3), new THREE.MeshBasicMaterial({ color: 0xff3ea5 }), 46);
  let capCount = 0;
  for (let index = 0; index < 46; index += 1) {
    const angle = rng.range(0, Math.PI * 2);
    const distance = rng.range(260, 460);
    const height = rng.range(16, 84);
    const width = rng.range(10, 26);
    const depth = rng.range(10, 26);
    dummy.position.set(Math.cos(angle) * distance, height / 2 - 2, Math.sin(angle) * distance * 0.8);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(width, height, depth);
    dummy.updateMatrix();
    skyline.setMatrixAt(index, dummy.matrix);
    if (rng.chance(0.5)) {
      dummy.position.y = height - 1.5;
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      caps.setMatrixAt(capCount, dummy.matrix);
      capCount += 1;
    }
  }
  skyline.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  caps.count = capCount;
  dummy.scale.set(1, 1, 1);
  group.add(skyline, caps);

  const map = {
    half: spec.half,
    roadLines,
    spacing: spec.spacing,
    blockHalf: spec.blockHalf,
    blocks: blocks.map((b) => ({ x: b.x, z: b.z, half: b.sidewalkHalf })),
    waterZ: spec.waterZ,
    landmarks,
    hideout: { x: -64 + 20.5, z: 32 + 25, name: 'Hideout' },
    drops: [
      { x: 0 + 3.4, z: -96 - 20, name: 'Drop A' },
      { x: 96 + 3.4, z: 0 + 22, name: 'Drop B' },
      { x: 64 - 3.4, z: 128 - 20, name: 'Drop C' },
    ],
    start: { x: 0 + 3.2, z: 96, heading: Math.PI },
    // Story stops missions 2-5 describe in their briefings, so the city and the script agree.
    stops: {
      store: { x: -64, z: 32 },
      alley: { x: -52, z: 44 },
      docks: { x: 110, z: -118 },
      casino: { x: 64, z: -64 },
      office: { x: -64, z: -64 },
      bridge: { x: -150, z: spec.waterZ + 12 },
      pier: { x: 84, z: spec.waterZ + 20 },
    },
  };

  return {
    group,
    lights: { hemi, moon: moonLight, pink: pinkFill, street: streetLights, bulbs, lampGlow, windows },
    spec,
    colliders,
    blocks,
    roads,
    roadLines,
    map,
    parkedSpots,
    landmarks,
    signs: allSigns,
    bounds: spec.half - 6,
    isOnRoad(x, z) {
      return roadLines.some((line) => Math.abs(x - line) <= spec.roadHalf) || roadLines.some((line) => Math.abs(z - line) <= spec.roadHalf);
    },
    nearestRoad(x, z) {
      let best = { axis: 'z', pos: 0, distance: Infinity };
      for (const line of roadLines) {
        const dx = Math.abs(x - line);
        const dz = Math.abs(z - line);
        if (dx < best.distance) best = { axis: 'z', pos: line, distance: dx };
        if (dz < best.distance) best = { axis: 'x', pos: line, distance: dz };
      }
      return best;
    },
    collides(x, z, radius = 0.5) {
      for (const box of colliders) {
        if (x + radius > box.minX && x - radius < box.maxX && z + radius > box.minZ && z - radius < box.maxZ) return box;
      }
      return null;
    },
    sidewalkPoint(index) {
      const block = blocks[Math.abs(index) % blocks.length];
      const t = rng.range(0, 1);
      const half = block.sidewalkHalf - 2.4;
      if (t < 0.5) return { x: block.x + rng.range(-half, half), z: block.z + (rng.chance(0.5) ? half : -half) };
      return { x: block.x + (rng.chance(0.5) ? half : -half), z: block.z + rng.range(-half, half) };
    },
  };
}
