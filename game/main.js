// NEON BAY — main.js
// Boot, state machine and every wire between the modules. The renderer, city, player, HUD,
// combat and missions are core: if any of them fails the page still shows a readable error card.
// Traffic, pedestrians, police and audio load through dynamic import() and are guarded one by
// one, so ?core=1 (or window.NEONBAY_CORE_ONLY) drops the optional half without blanking the
// page. All layout comes from a fixed seed; nothing in the game calls Math.random().

import * as THREE from 'three';
import { createCity } from './city.js';
import { createPlayer } from './player.js';
import { createVehicle, resolveCarPair } from './vehicle.js';
import { createCombat } from './combat.js';
import { createHud } from './hud.js';
import { createMenu } from './menu.js';
import { createMissions, MISSIONS, BRIEFING_MARKERS } from './missions.js';
import { createRng } from './rng.js';
import { readSave, writeSave } from './save.js';

const TAU = Math.PI * 2;
const params = new URLSearchParams(window.location.search);
const SEED = params.get('seed') ?? '1';
const SHOT = params.get('shot');
const CORE_ONLY = params.get('core') === '1' || window.NEONBAY_CORE_ONLY === true;
const RENDER_SCALE = params.get('hq') === '1' ? 1 : 0.8;
const HARNESS_FRAMES = 200;
const WARMUP_FRAMES = 8;
const MAX_FRAME_MS = 20;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
function angleTo(a, b) {
  let d = (b - a + Math.PI) % TAU;
  if (d < 0) d += TAU;
  return d - Math.PI;
}
function turnToward(current, target, step) {
  const d = angleTo(current, target);
  return current + clamp(d, -step, step);
}
function fmtClock(minutes) {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return [Math.floor(m / 60), m % 60];
}
function fmtTimer(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function isTyping(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function fatal(message) {
  const boot = document.getElementById('boot-error');
  if (boot) {
    boot.hidden = false;
    boot.textContent = `NEON BAY could not start: ${message}`;
  }
  const screen = document.getElementById('boot-screen');
  if (screen) screen.hidden = true;
  document.body.classList.add('boot-failed');
}

// ---------------------------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------------------------
const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
} catch (error) {
  fatal(`WebGL unavailable (${error.message})`);
  throw error;
}
renderer.setPixelRatio(RENDER_SCALE);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = false;
renderer.domElement.setAttribute('aria-label', 'NEON BAY game canvas');
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.3, 760);
camera.position.set(0, 12, 130);

// ---------------------------------------------------------------------------------------------
// Core world
// ---------------------------------------------------------------------------------------------
const city = createCity(scene, SEED);
const player = createPlayer(scene);
player.x = city.map.start.x;
player.z = city.map.start.z;
player.heading = city.map.start.heading;
player.mesh.rotation.y = player.heading;

// Boot card copy: name the exact build that is loading, so ?core=1 is visible before any module
// resolves and a slow optional half has something truthful to say while it loads.
const bootNote = document.getElementById('boot-note');
if (bootNote) {
  bootNote.textContent = CORE_ONLY
    ? 'Core build · city, coupe, HUD and mission 1. Optional systems are off.'
    : 'Building the city grid, the marina and the neon.';
}

const hud = createHud();
hud.bakeMap(city);
const combat = createCombat(scene);
const missions = createMissions(scene, city, { seed: SEED, courier: { x: 7.4, z: 102, heading: Math.PI * 0.92 } });

const world = {
  cars: [],
  parked: [],
  courier: null,
  traffic: null,
  peds: null,
  police: null,
  audio: null,
  failures: [],
  demo: false,
  staged: false,
  shotView: null,
  freeze: false,
};

// The air unit's searchlight rig: one SpotLight plus a visible cone, both hung off the heli's
// `spot` anchor. They light up only when the sky is actually dark, so the cone never reads by day.
const HELI_BEAM = { angle: 0.26, length: 78, intensity: 1500, distance: 150 };
const heliFx = {
  attachedSpot: null,
  light: null,
  target: null,
  beam: null,
  pool: null,
};
const DOWN = new THREE.Vector3(0, -1, 0);
const beamOrigin = new THREE.Vector3();
const beamDir = new THREE.Vector3();

// A radial white-to-transparent disc for the searchlight's ground pool.
function glowPoolTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function attachHeliFx(spot) {
  const light = new THREE.SpotLight(0xdff2ff, HELI_BEAM.intensity, HELI_BEAM.distance, HELI_BEAM.angle, 0.55, 2);
  light.visible = false;
  spot.add(light);

  const target = new THREE.Object3D();
  target.position.set(0, 0, 8);
  scene.add(target);
  light.target = target;

  // An open cone with its apex at the lamp: additive, unlit, and short of the ground plane so the
  // shaft reads as light rather than as geometry.
  const radius = Math.tan(HELI_BEAM.angle) * HELI_BEAM.length;
  const geometry = new THREE.ConeGeometry(radius, HELI_BEAM.length, 24, 1, true);
  geometry.translate(0, -HELI_BEAM.length / 2, 0);
  const material = new THREE.MeshBasicMaterial({
    color: 0xcfeaff,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  const beam = new THREE.Mesh(geometry, material);
  beam.name = 'heli-beam';
  beam.visible = false;
  beam.frustumCulled = false;
  scene.add(beam);

  // A soft pool where the shaft lands, so the light reads on the road even on a bright neon block.
  const poolGeo = new THREE.PlaneGeometry(26, 26);
  poolGeo.rotateX(-Math.PI / 2);
  const pool = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({
    map: glowPoolTexture(),
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  }));
  pool.name = 'heli-pool';
  pool.visible = false;
  scene.add(pool);

  heliFx.attachedSpot = spot;
  heliFx.light = light;
  heliFx.target = target;
  heliFx.beam = beam;
  heliFx.pool = pool;
}

// Runs every rendered frame, not just simulated ones, so the searchlight follows the player even
// when the world is frozen for a capture. Rotor angles come from game.simTime, so a frozen shot
// renders the same blades every run.
function updateHeliFx() {
  const heli = world.police?.state.heli ?? null;
  hud.setAirSupport(Boolean(heli));
  world.audio?.rotorLoop?.(Boolean(heli));
  if (!heli) {
    if (heliFx.light) heliFx.light.visible = false;
    if (heliFx.beam) heliFx.beam.visible = false;
    if (heliFx.pool) heliFx.pool.visible = false;
    return;
  }
  if (heliFx.attachedSpot !== heli.spot) attachHeliFx(heli.spot);

  heli.rotor.rotation.y = (game.simTime * 26) % TAU;
  heli.tailRotor.rotation.x = (game.simTime * 41) % TAU;

  const aim = player.inCar ?? player;
  const night = game.night > 0.5;
  heliFx.light.visible = night;
  heliFx.beam.visible = night;
  heliFx.pool.visible = night;
  if (!night) return;

  heliFx.target.position.set(aim.x, 0.9, aim.z);
  heliFx.target.updateMatrixWorld();
  heli.spot.getWorldPosition(beamOrigin);
  beamDir.set(aim.x - beamOrigin.x, 0.9 - beamOrigin.y, aim.z - beamOrigin.z).normalize();
  heliFx.beam.position.copy(beamOrigin);
  heliFx.beam.quaternion.setFromUnitVectors(DOWN, beamDir);
  heliFx.pool.position.set(aim.x, 0.06, aim.z);
}

function makeCourier() {
  const spot = missions.courierPoint;
  const car = createVehicle(scene, city, {
    type: 'van',
    color: 0xffc25c,
    x: spot.x,
    z: spot.z,
    heading: spot.heading,
  });
  car.driver = { courier: true };
  car.label = 'Courier van';
  car.stolen = false;
  world.courier = car;
  world.cars.push(car);
  return car;
}

function makeParked() {
  const rng = createRng(`parked:${SEED}`);
  const spots = city.parkedSpots.slice(0, 9);
  for (const spot of spots) {
    const type = rng.pick(['sedan', 'coupe', 'taxi', 'van']);
    const car = createVehicle(scene, city, {
      type,
      colorIndex: rng.int(0, 7),
      x: spot.x,
      z: spot.z,
      heading: spot.heading,
    });
    car.driver = null;
    car.label = 'Parked car';
    world.parked.push(car);
    world.cars.push(car);
  }
}

// ---------------------------------------------------------------------------------------------
// Optional subsystems: dynamic imports so one bad module never blanks the page.
// ---------------------------------------------------------------------------------------------
async function loadOptional() {
  if (CORE_ONLY) {
    // Core-only: the optional half is off by design, not broken, so the HUD stays clean.
    hud.clearError();
    return;
  }
  try {
    const module = await import('./traffic.js');
    world.traffic = module.createTraffic(scene, city, { seed: SEED, count: 14 });
    for (const car of world.traffic.cars) world.cars.push(car);
  } catch (error) {
    world.failures.push(`traffic: ${error.message}`);
  }
  try {
    const module = await import('./peds.js');
    world.peds = module.createPeds(scene, city, { seed: SEED, count: 24 });
  } catch (error) {
    world.failures.push(`pedestrians: ${error.message}`);
  }
  try {
    const module = await import('./police.js');
    world.police = module.createPolice(scene, city, { maxUnits: 4 });
    wirePolice();
  } catch (error) {
    world.failures.push(`police: ${error.message}`);
  }
  try {
    const module = await import('./audio.js');
    world.audio = module.createAudio();
  } catch (error) {
    world.failures.push(`audio: ${error.message}`);
  }
  if (world.failures.length === 0) hud.clearError();
  else hud.error(`Optional module failed · ${world.failures.join(' · ')}`);
}

function wirePolice() {
  const police = world.police;
  if (!police) return;
  police.state.onCrime = (kind, amount) => {
    const stars = Number.isFinite(amount) ? amount : undefined;
    if (kind === 'cop') hud.toast('Officer down · wanted level up', 'warn');
    void stars;
  };
}

// ---------------------------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------------------------
const game = {
  mode: 'title', // title | briefing | playing | paused | end
  started: false,
  frames: 0,
  simTime: 0,
  clock: 21 * 60 + 40,
  missionIndex: 0,
  missionsDone: [],
  cash: 0,
  standbyObjective: null,
  endKind: null,
  endMission: null,
  shake: 0,
  hurt: 0,
  hint: '',
  district: 'Beachfront',
  pointerLocked: false,
  titleYaw: 0.6,
  shotName: SHOT,
  demo: false,
  demoTimer: 0,
  demoTurn: 0,
  demoRestart: 0,
  wantedFallback: 0,
  night: 0,
};

const cam = {
  yaw: player.heading,
  pitch: 0.26,
  distance: 5.8,
};
const keys = Object.create(null);
const fx = createRng(`fx:${SEED}`);
const mouse = { down: false };

// ---------------------------------------------------------------------------------------------
// Menu handlers
// ---------------------------------------------------------------------------------------------
const menu = createMenu({
  onNew: () => startNewGame(),
  onContinue: () => continueGame(),
  onDemo: () => startDemo(),
  onBriefingGo: () => acceptBriefing(),
  onPickJob: (index) => pickJob(index),
  onBriefingLater: () => backToTitle(),
  onResume: () => resumeGame(),
  onQuit: () => quitToTitle(),
  onEndContinue: () => endContinue(),
  onEndRetry: () => endRetry(),
});

function saveGame(nextMission = game.missionIndex) {
  // Save where the body actually is: on foot that is the player, in a car that is the car, so
  // Continue drops you back at the wheel instead of at a stale pavement position.
  const at = player.inCar ?? player;
  writeSave({
    cash: game.cash,
    mission: nextMission,
    missionsDone: game.missionsDone,
    x: at.x,
    z: at.z,
    wanted: world.police?.state.wanted ?? 0,
    time: game.clock,
    savedAt: Math.round(game.simTime),
  });
}

function applyProgress() {
  player.cash = game.cash;
  player.health = 100;
  player.armor = 0;
  player.down = false;
  player.inCar = null;
  player.mesh.visible = true;
  player.mesh.rotation.z = 0;
  player.y = 0;
}

function resetWorld() {
  game.started = true;
  game.demo = false;
  game.demoTimer = 0;
  game.demoTurn = 0;
  world.staged = false;
  world.shotView = null;
  world.freeze = false;
  game.mode = 'playing';
  game.cash = 0;
  game.missionIndex = 0;
  game.missionsDone = [];
  game.clock = 21 * 60 + 40;
  game.endKind = null;
  game.endMission = null;
  player.cash = 0;
  player.health = 100;
  player.armor = 0;
  player.ammo = 12;
  player.reserve = 60;
  player.down = false;
  player.deathTime = 0;
  player.inCar = null;
  player.mesh.visible = true;
  player.mesh.rotation.z = 0;
  player.x = city.map.start.x;
  player.z = city.map.start.z;
  player.y = 0;
  player.heading = city.map.start.heading;
  player.setArmed(true);
  cam.yaw = player.heading;
  cam.pitch = 0.26;
  if (world.courier) {
    world.courier.dead = false;
    world.courier.health = 100;
    placeCar(world.courier, missions.courierPoint.x, missions.courierPoint.z, missions.courierPoint.heading, 0);
    world.courier.driver = { courier: true };
    world.courier.stolen = false;
  }
  world.police?.clear();
  world.peds?.reset?.();
  menu.hideAll();
  if (!world.courier) makeCourier();
  missions.begin(0, missionCtx());
  syncObjective();
  hud.toast('Hot Cargo · steal the courier van', 'good');
}

function startNewGame() {
  resetWorld();
  game.mode = 'briefing';
  menu.showBriefing(MISSIONS[0]);
  hud.setObjective('', '');
}

function acceptBriefing() {
  const mission = MISSIONS[game.missionIndex] ?? MISSIONS[0];
  menu.hideBriefing();
  if (!mission.playable) {
    // Outline jobs still drop their real marker into the world and post a standing objective, so
    // closing the briefing leaves the player in the bay with the story pointing somewhere.
    // Never resetWorld() here: it would wipe the cash and arc progress the last job just earned.
    if (!game.started) {
      game.started = true;
      player.cash = game.cash;
      player.mesh.visible = !player.inCar;
    }
    game.missionIndex = clamp(MISSIONS.indexOf(mission), 0, MISSIONS.length - 1);
    // Outline jobs are briefings, not simulations: no timer, no auto-complete, but a real marker
    // and a standing objective so the world still points at the next stop.
    missions.state.active = null;
    missions.setMarker(BRIEFING_MARKERS[mission.id] ?? mission.stages[0]?.marker, mission.stages[0]?.text);
    game.standbyObjective = { name: mission.name, goal: mission.goal };
    game.mode = 'playing';
    syncObjective();
    hud.toast(`${mission.name} · outline job — marker set, the full cut is next`, 'warn');
    return;
  }
  startMission(game.missionIndex);
}

// The briefing's job board: picking a row swaps the card to that job and makes it the next accept.
function pickJob(index) {
  if (!MISSIONS[index]) return;
  game.missionIndex = index;
  game.mode = 'briefing';
  menu.showBriefing(MISSIONS[index]);
}

function backToTitle() {
  menu.showTitle(Boolean(readSave()));
  game.mode = 'title';
  game.started = false;
  hideBriefingCamera();
}

function startMission(index) {
  game.started = true;
  game.missionIndex = index;
  game.mode = 'playing';
  menu.hideAll();
  const mission = MISSIONS[index];
  if (!mission) return;
  if (index === 0 && !world.courier) makeCourier();
  player.cash = game.cash;
  player.health = Math.max(35, player.health);
  player.down = false;
  player.inCar = null;
  player.mesh.visible = true;
  player.x = city.map.start.x;
  player.z = city.map.start.z;
  player.heading = city.map.start.heading;
  player.setArmed(true);
  cam.yaw = player.heading;
  missions.begin(index, missionCtx());
  // Outline jobs hold a standing objective instead of running a timer.
  game.standbyObjective = mission.playable ? null : { name: mission.name, goal: mission.goal };
  syncObjective();
  hud.toast(`${mission.name} · ${mission.stages[0].text}`, 'good');
}

function continueGame() {
  const save = readSave();
  if (!save) {
    startNewGame();
    return;
  }
  resetWorld();
  game.cash = save.cash;
  game.missionIndex = clamp(save.mission, 0, MISSIONS.length - 1);
  game.missionsDone = save.missionsDone;
  game.clock = save.time || 21 * 60 + 40;
  player.cash = save.cash;
  player.x = save.x;
  player.z = save.z;
  if (world.police && save.wanted > 0) world.police.state.wanted = save.wanted;
  menu.hideAll();
  startMission(game.missionIndex);
  hud.toast(`Save loaded · $${game.cash.toLocaleString('en-US')}`, 'good');
}

function resumeGame() {
  if (game.mode !== 'paused') return;
  game.mode = 'playing';
  menu.hidePause();
}

function pauseGame() {
  if (game.mode !== 'playing') return;
  game.mode = 'paused';
  menu.showPause();
  saveGame();
}

function quitToTitle() {
  saveGame();
  menu.hideAll();
  menu.showTitle(true);
  game.mode = 'title';
  game.started = false;
  if (document.pointerLockElement) document.exitPointerLock();
}

function endContinue() {
  menu.hideEnd();
  if (game.endKind === 'mission') {
    saveGame(game.missionIndex);
    const nextIndex = clamp(game.missionIndex, 0, MISSIONS.length - 1);
    const next = MISSIONS[nextIndex];
    if (next) {
      game.missionIndex = nextIndex;
      game.standbyObjective = null;
      game.mode = 'briefing';
      game.started = false;
      menu.showBriefing(next);
      return;
    }
  }
  if (game.endKind === 'fail' || game.endKind === 'busted') {
    respawn();
    return;
  }
  game.mode = 'playing';
}

function endRetry() {
  menu.hideEnd();
  respawn();
  if (game.endMission != null) startMission(game.endMission);
}

function respawn() {
  world.police?.clear();
  player.health = 100;
  player.armor = 0;
  player.down = false;
  player.deathTime = 0;
  player.inCar = null;
  player.mesh.visible = true;
  player.mesh.rotation.z = 0;
  player.y = 0;
  player.x = city.map.start.x;
  player.z = city.map.start.z;
  player.heading = city.map.start.heading;
  cam.yaw = player.heading;
  game.mode = 'playing';
  game.started = true;
  hud.vignette(0);
  hud.toast('Back on the marina lot', '');
}

// ---------------------------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------------------------
function missionCtx() {
  return {
    player,
    courierCar: world.courier,
    city,
    // Pursuit stages read the live star count instead of tracking their own chase state.
    wanted: () => world.police?.state.wanted ?? game.wantedFallback,
    onBegin: (mission, stage) => {
      seedChase(stage);
      syncObjective();
    },
    onStage: (mission, stage) => {
      seedChase(stage);
      hud.toast(stage.text, 'good');
      syncObjective();
    },
    onDelivery: (count, total) => {
      audio('pickup');
      hud.toast(`Drop ${count} of ${total} · cargo clean`, 'good');
      game.cash += 120;
      player.cash = game.cash;
    },
    onComplete: (mission) => {
      if (!mission) return;
      game.cash += mission.reward ?? 0;
      player.cash = game.cash;
      game.missionsDone = [...new Set([...game.missionsDone, mission.id])];
      game.missionIndex = Math.min(MISSIONS.length - 1, (mission.id ?? 1));
      game.endKind = 'mission';
      game.endMission = (mission.id ?? 1) - 1;
      audio('complete');
      saveGame(mission.id);
  // A completed job's drop markers and beacon must leave the world; the next briefing owns the
  // marker from here.
  missions.state.active = null;
  missions.markerGroup.visible = false;
  game.standbyObjective = null;
  hud.setObjective('', '');
      menu.showEnd({
        kicker: 'Job complete',
        title: `${mission.name} delivered`,
        copy: `$${(mission.reward ?? 0).toLocaleString('en-US')} wired to your account. Next job: ${MISSIONS[game.missionIndex]?.name ?? 'free roam'}.`,
        retry: false,
      });
      game.mode = 'end';
    },
    onFail: (mission) => {
      game.endKind = 'fail';
      game.endMission = (mission.id ?? 1) - 1;
      audio('fail');
      menu.showEnd({
        kicker: 'Job failed',
        title: 'The timer ran dry',
        copy: 'The harbour crew woke up. Retry the run and keep the van moving.',
        retry: true,
      });
      game.mode = 'end';
    },
  };
}

// A pursuit stage starts with the heat already on the player: the air unit is over the marina
// before job 6 opens, and the dock alarm brings the cruisers for job 7.
function seedChase(stage) {
  if (stage?.kind === 'heat' && world.police) {
    world.police.setWanted(stage.wanted ?? 3);
    game.wantedFallback = world.police.state.wanted;
  }
}

function syncObjective() {
  const mission = missions.state.active;
  if (!mission) {
    if (game.standbyObjective) {
      hud.setObjective(game.standbyObjective.name, game.standbyObjective.goal, '');
    } else {
      hud.setObjective('', '');
    }
    return;
  }
  const text = missions.objectiveText();
  const timer = mission.timeLimit ? fmtTimer(missions.state.timer) : '';
  hud.setObjective(mission.name, text, timer, missions.progressText?.() ?? '');
}

// ---------------------------------------------------------------------------------------------
// Audio helpers
// ---------------------------------------------------------------------------------------------
function audio(kind) {
  const kit = world.audio;
  if (!kit) return;
  try {
    if (kind === 'pickup') kit.hit?.();
    else if (kind === 'complete') { kit.hit?.(); kit.horn?.(); }
    else if (kind === 'fail') kit.melee?.();
    else if (kind === 'crash') kit.melee?.();
    else if (kind === 'shot') kit.shot?.();
  } catch {
    /* audio is optional */
  }
}

// ---------------------------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------------------------
function cameraTarget() {
  return player.inCar ?? player;
}

function updateCamera(dt) {
  if (world.shotView) {
    camera.position.copy(world.shotView.pos);
    camera.lookAt(world.shotView.look);
    return;
  }
  if (game.mode === 'title' || game.mode === 'briefing') {
    game.titleYaw = (game.titleYaw + dt * 0.05) % TAU;
    const radius = game.mode === 'briefing' ? 210 : 168;
    const height = game.mode === 'briefing' ? 58 : 44;
    camera.position.set(Math.sin(game.titleYaw) * radius, height, Math.cos(game.titleYaw) * radius);
    camera.lookAt(0, game.mode === 'briefing' ? 16 : 10, 0);
    return;
  }

  const target = cameraTarget();
  const inCar = Boolean(player.inCar);
  if (inCar) cam.yaw = turnToward(cam.yaw, player.inCar.heading, dt * 3.4);
  if (keys.ArrowLeft) cam.yaw -= dt * 2.0;
  if (keys.ArrowRight) cam.yaw += dt * 2.0;
  if (keys.ArrowUp) cam.pitch = clamp(cam.pitch + dt * 1.2, -0.12, 0.72);
  if (keys.ArrowDown) cam.pitch = clamp(cam.pitch - dt * 1.2, -0.12, 0.72);

  const desired = inCar ? 8.4 : 5.8;
  cam.distance = lerp(cam.distance, desired, Math.min(1, dt * 5));
  let distance = cam.distance;
  const cosPitch = Math.cos(cam.pitch);
  for (let step = 1; step <= 7; step += 1) {
    const t = (distance * step) / 7;
    const px = target.x - Math.sin(cam.yaw) * cosPitch * t;
    const pz = target.z - Math.cos(cam.yaw) * cosPitch * t;
    if (city.collides(px, pz, 0.55)) {
      distance = Math.max(2.2, t - 0.9);
      break;
    }
  }
  const height = (inCar ? 2.55 : 1.65) + Math.sin(cam.pitch) * distance;
  const shake = game.shake > 0 ? game.shake : 0;
  const sx = shake > 0 ? Math.sin(game.simTime * 61) * shake * 0.55 : 0;
  const sy = shake > 0 ? Math.cos(game.simTime * 47) * shake * 0.4 : 0;
  camera.position.set(
    target.x - Math.sin(cam.yaw) * cosPitch * distance + sx,
    height + sy,
    target.z - Math.cos(cam.yaw) * cosPitch * distance + sx * 0.4,
  );
  const lookAhead = inCar ? 6.5 : 4.2;
  camera.lookAt(target.x + Math.sin(cam.yaw) * lookAhead, height * 0.62, target.z + Math.cos(cam.yaw) * lookAhead);
}

// ---------------------------------------------------------------------------------------------
// Player on foot
// ---------------------------------------------------------------------------------------------
function walkable(x, z, radius = 0.46) {
  if (Math.abs(x) > city.bounds || Math.abs(z) > city.bounds) return false;
  if (z > city.spec.waterZ - 8) return false;
  return !city.collides(x, z, radius);
}

function tryMove(actor, dx, dz, radius = 0.46) {
  const nx = actor.x + dx;
  if (walkable(nx, actor.z, radius)) actor.x = nx;
  const nz = actor.z + dz;
  if (walkable(actor.x, nz, radius)) actor.z = nz;
}

function nearestCar(maxDistance = 5.2) {
  let best = null;
  let bestDistance = maxDistance;
  for (const car of world.cars) {
    if (car.dead || car === player.inCar) continue;
    const distance = Math.hypot(car.x - player.x, car.z - player.z);
    if (distance < bestDistance) {
      best = car;
      bestDistance = distance;
    }
  }
  return best;
}

function updateOnFoot(dt) {
  const ix = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  const iz = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
  const sprint = keys.Shift;
  const speed = sprint ? 7.0 : 3.5;
  let moving = false;

  if (ix !== 0 || iz !== 0) {
    const fx = Math.sin(cam.yaw);
    const fz = Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw);
    const rz = -Math.sin(cam.yaw);
    let dx = fx * iz + rx * ix;
    let dz = fz * iz + rz * ix;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    const targetHeading = Math.atan2(dx, dz);
    player.heading = turnToward(player.heading, targetHeading, dt * 11);
    tryMove(player, dx * speed * dt, dz * speed * dt, 0.46);
    player.speed = speed;
    moving = true;
  } else {
    player.speed = 0;
  }

  // Jump + gravity.
  if (keys.Space && player.y <= 0.01 && !player.down) {
    player.vy = 6.4;
    player.y = 0.02;
    audio('jump');
  }
  if (player.y > 0 || player.vy !== 0) {
    player.vy -= 20 * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) {
      player.y = 0;
      player.vy = 0;
    }
  }

  // Cars are solid to a walking player.
  for (const car of world.cars) {
    if (car.dead) continue;
    const dx = player.x - car.x;
    const dz = player.z - car.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.001 && distance < 1.9) {
      const push = (1.9 - distance) / distance;
      tryMove(player, dx * push, dz * push, 0.35);
    }
  }

  // Somebody's car clips you.
  if (world.peds) {
    for (const car of world.cars) {
      if (car === player.inCar || car.dead) continue;
      if (Math.abs(car.speed) < 6) continue;
      if (Math.hypot(car.x - player.x, car.z - player.z) < 2.1) {
        hurtPlayer(9 + Math.abs(car.speed) * 0.5, car);
        car.speed *= 0.35;
        if (world.police) world.police.crime(null, player, 'ram');
        break;
      }
    }
  }

  player.mesh.position.set(player.x, player.y, player.z);
  if (moving) player.mesh.rotation.y = player.heading;
  player.mesh.userData.pose(dt, player.speed, { airborne: player.y > 0.05, aim: mouse.down ? 1 : 0, dead: player.down, deathTime: player.deathTime });
}

// ---------------------------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------------------------
function updateDriving(dt) {
  const car = player.inCar;
  if (!car) return;
  if (car.dead) {
    exitCar(true);
    hurtPlayer(20, car);
    return;
  }
  const throttle = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
  const steer = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  car.update(dt, {
    throttle,
    steer,
    handbrake: Boolean(keys.Space),
    boost: Boolean(keys.Shift) && throttle > 0,
  });

  // The player's body rides inside the car and the camera follows the car.
  player.x = car.x;
  player.z = car.z;
  player.y = 0;
  player.speed = car.speed;
  player.heading = car.heading;
  player.mesh.visible = false;

  if (Math.abs(car.speed) > 26 && Math.abs(car.steer) > 0.5) {
    game.shake = Math.max(game.shake, 0.08);
  }

  // Running over pedestrians: a real crime, and the reason the stars climb.
  if (world.peds && Math.abs(car.speed) > 5) {
    for (const ped of world.peds.peds) {
      if (ped.down) continue;
      if (Math.hypot(ped.x - car.x, ped.z - car.z) < 2.2) {
        ped.hurt(70);
        world.peds.scare({ x: car.x, z: car.z }, 34, 1.4);
        world.police?.crime(null, player, 'ped');
        hud.toast('Pedestrian hit · wanted level up', 'warn');
        car.speed *= 0.7;
        break;
      }
    }
  }
}

function enterNearestCar() {
  if (player.inCar || player.down) return;
  const car = nearestCar();
  if (!car) {
    hud.toast('No car within reach', '');
    return;
  }
  const wasStolen = Boolean(car.driver) && !car.driver.player;
  if (car === world.courier) {
    car.stolen = true;
    world.courier.driver = null;
  } else if (car.driver && !car.driver.player) {
    car.driver.flee = false;
    car.driver = null;
    if (world.peds) world.peds.scare({ x: car.x, z: car.z }, 16, 0.8);
  }
  car.driver = { player: true };
  player.inCar = car;
  player.mesh.visible = false;
  player.heading = car.heading;
  cam.yaw = car.heading;
  game.shake = Math.max(game.shake, 0.12);
  hud.toast(`Took the ${car.type}${wasStolen ? ' · grand theft auto' : ''}`, 'warn');
  audio('pickup');
  if (wasStolen && world.police) world.police.crime(null, player, 'steal');
}

function exitCar(forced = false) {
  const car = player.inCar;
  if (!car) return;
  const right = car.right();
  let x = car.x + right.x * 2.3;
  let z = car.z + right.z * 2.3;
  if (!walkable(x, z, 0.42)) {
    x = car.x - right.x * 2.3;
    z = car.z - right.z * 2.3;
  }
  if (!walkable(x, z, 0.42)) {
    x = car.x;
    z = car.z;
  }
  player.x = x;
  player.z = z;
  player.y = 0;
  player.heading = car.heading;
  player.inCar = null;
  player.mesh.visible = true;
  if (car.driver && car.driver.player) car.driver = null;
  cam.yaw = car.heading;
  if (!forced) hud.toast('On foot', '');
}

// ---------------------------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------------------------
function hurtPlayer(amount, source) {
  if (player.down || game.mode === 'end') return;
  const before = player.health;
  player.hurt(amount);
  game.hurt = Math.max(game.hurt, 0.55);
  game.shake = Math.max(game.shake, 0.18);
  hud.vignette(0.42);
  if (player.health < before) audio('hit');
  if (player.health <= 0 && !player.down) player.down = true;
  void source;
}

function onBusted() {
  if (game.mode !== 'playing') return;
  world.police?.clear();
  game.endKind = 'busted';
  // endMission indexes MISSIONS for Retry; the active mission's id is 1-based.
  game.endMission = missions.state.active ? (missions.state.active.id ?? 1) - 1 : game.missionIndex;
  menu.showEnd({
    kicker: 'Busted',
    title: 'The bay PD got you',
    copy: 'They took a cut of your cash and dropped you back at the marina. The job is still open.',
    retry: true,
  });
  game.mode = 'end';
  player.cash = Math.max(0, player.cash - 250);
  game.cash = player.cash;
  hud.vignette(0);
}

// ---------------------------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------------------------
function actors() {
  const list = [];
  if (world.peds) list.push(...world.peds.peds);
  if (world.police) {
    list.push(...world.police.state.officers);
    list.push(...world.police.state.units);
  }
  for (const car of world.cars) {
    if (car === player.inCar) continue;
    list.push(car);
  }
  return list;
}

function aimDirection() {
  // Shots go where the camera looks: a chest-height point down the camera's heading, so the
  // hitscan is a flat line at body height instead of the camera's downward tilt.
  const px = player.x + Math.sin(cam.yaw) * 32;
  const pz = player.z + Math.cos(cam.yaw) * 32;
  const dx = px - player.x;
  const dy = 1.05 - 1.28;
  const dz = pz - player.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / length, y: dy / length, z: dz / length };
}

function firePistol() {
  if (game.mode !== 'playing' || player.down || player.inCar) return;
  if (player.reloadTimer > 0) return;
  if (player.fireCooldown > 0) return;
  if (player.ammo <= 0) {
    hud.toast('Empty · press R', 'warn');
    return;
  }
  player.ammo -= 1;
  player.fireCooldown = 0.24;
  const origin = { x: player.x, y: 1.28, z: player.z };
  const direction = aimDirection();
  const result = combat.fire(origin, direction, actors(), { city, damage: 34, range: 90 });
  audio('shot');
  if (world.peds) world.peds.scare({ x: player.x, z: player.z }, 34, 1);
  if (result.hit) {
    const hit = result.hit;
    if (hit.kind === 'ped') {
      world.police?.crime(null, player, 'ped');
      hud.toast('Civilian hit · wanted level up', 'warn');
    } else if (hit.kind === 'officer') {
      world.police?.crime(null, player, 'cop');
    } else if (hit.kind === 'car' && hit.police) {
      world.police?.crime(null, player, 'cop');
    }
  }
}

function reload() {
  if (game.mode !== 'playing' || player.down || player.inCar) return;
  if (player.reloadTimer > 0 || player.reserve <= 0 || player.ammo >= player.magazineSize) return;
  player.reloadTimer = 1.15;
  audio('reload');
}

function finishReload() {
  const need = player.magazineSize - player.ammo;
  const take = Math.min(need, player.reserve);
  player.ammo += take;
  player.reserve -= take;
}

function melee() {
  if (game.mode !== 'playing' || player.down || player.inCar || player.meleeCooldown > 0) return;
  player.meleeCooldown = 0.42;
  const hit = combat.melee({ x: player.x, z: player.z }, player.heading, actors());
  audio('melee');
  if (hit?.kind === 'ped') world.police?.crime(null, player, 'ped');
  if (hit?.kind === 'officer') world.police?.crime(null, player, 'cop');
}

// ---------------------------------------------------------------------------------------------
// Per-frame world update
// ---------------------------------------------------------------------------------------------
function updateWorld(dt) {
  game.simTime += dt;
  game.clock = (game.clock + dt * 0.55) % 1440;

  if (player.down) {
    player.deathTime += dt;
    player.mesh.visible = true;
    player.mesh.position.set(player.x, player.y, player.z);
    player.mesh.userData.pose(dt, 0, { dead: true, deathTime: player.deathTime });
    if (player.deathTime > 2.6) onBusted();
    if (world.police) world.police.update(dt, policeCtx());
    return;
  }

  if (game.demo) updateDemo(dt);
  else if (player.inCar) updateDriving(dt);
  else updateOnFoot(dt);

  if (world.traffic) {
    world.traffic.update(dt, {
      player,
      playerCar: player.inCar,
      cars: world.cars,
      onPlayerHit: (car) => hurtPlayer(8 + Math.abs(car.speed) * 0.4, car),
    });
  }
  if (world.peds) world.peds.update(dt, { cars: world.cars });
  if (world.police) world.police.update(dt, policeCtx());

  // Car-vs-car separation, then push every body into its transform.
  for (let i = 0; i < world.cars.length; i += 1) {
    const a = world.cars[i];
    if (a.dead) continue;
    for (let j = i + 1; j < world.cars.length; j += 1) {
      const b = world.cars[j];
      if (b.dead) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) > 3.2) continue;
      if (resolveCarPair(a, b) && (a === player.inCar || b === player.inCar)) {
        game.shake = Math.max(game.shake, 0.2);
        audio('crash');
      }
    }
    a.sync();
  }

  missions.update(dt, missionCtx());
  missions.animate(game.simTime);
  syncObjective();
  combat.update(dt);

  game.shake = Math.max(0, game.shake - dt * 1.7);
  game.hurt = Math.max(0, game.hurt - dt * 1.3);
  if (game.hurt <= 0) hud.vignette(0);
  else hud.vignette(0.18 + game.hurt * 0.35);

  if (player.reloadTimer > 0) {
    player.reloadTimer -= dt;
    if (player.reloadTimer <= 0) finishReload();
  }
  player.fireCooldown = Math.max(0, player.fireCooldown - dt);
  player.meleeCooldown = Math.max(0, player.meleeCooldown - dt);
}

function policeCtx() {
  return {
    player,
    freeze: world.freeze,
    onBusted,
    onRam: () => {
      game.shake = Math.max(game.shake, 0.22);
      audio('crash');
    },
    onPlayerHit: (unit, scale, damage) => hurtPlayer(damage ?? 6, unit),
    onOfficerShot: (officer) => {
      if (player.inCar) return;
      if (Math.hypot(officer.x - player.x, officer.z - player.z) > 16) return;
      hurtPlayer(4, officer);
      audio('shot');
    },
    onCrime: (kind, amount) => {
      if (kind === 'cop') hud.toast('Officer down · wanted level up', 'warn');
      void amount;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------------------------
function applyTimeOfDay() {
  // The city bakes its neon into emissive geometry; the clock just leans the sky and key lights
  // between dusk and deep night so a 19:48 shot and a 23:12 shot read differently.
  const minutes = ((game.clock % 1440) + 1440) % 1440;
  const night = clamp((minutes - 18 * 60) / (5 * 60), 0, 1);
  game.night = night;
  if (!city.lights) return;
  city.lights.hemi.intensity = 1.3 - night * 0.36;
  city.lights.moon.intensity = 0.92 - night * 0.26;
  city.lights.pink.intensity = 0.3 - night * 0.12;
  scene.fog.density = 0.0028 + night * 0.0012;
  renderer.toneMappingExposure = 1.1 - night * 0.12;
}

// Districts are real geography now: the tiling lives in city.js (DISTRICTS) and every point in
// the map resolves to exactly one of the five names. No more per-frame string heuristics.
function districtAt(x, z) {
  return city.districtAt(x, z);
}

function wantedLevel() {
  return world.police?.state.wanted ?? game.wantedFallback;
}

function updateHud() {
  const car = player.inCar;
  const police = world.police;
  const [hours, minutes] = fmtClock(game.clock);
  game.district = districtAt(car ? car.x : player.x, car ? car.z : player.z);

  hud.setVitals(player.health, player.armor);
  hud.setCash(player.cash);
  hud.setWanted(wantedLevel());
  hud.setClock(hours, minutes);
  hud.setDistrict(game.district);
  hud.setAmmo(player.ammo, player.reserve, player.reloadTimer > 0);
  hud.setWeapon('Pistol');
  hud.setSpeed(car ? car.speed : null);
  hud.setHitmarker(combat.state.hitmarker);
  hud.setMode(game.mode);
  updateModeBadge();

  if (game.mode === 'title' || game.mode === 'briefing' || game.mode === 'end') {
    hud.setObjective('', '');
  }

  // Contextual hint line.
  let hint = '';
  if (game.mode === 'playing' && !player.down) {
    if (car) {
      hint = 'E get out · Space handbrake · Shift boost';
    } else {
      const near = nearestCar();
      if (near === world.courier && missions.state.active?.stages[missions.state.stage]?.id === 'pickup') hint = 'E take the courier van';
      else if (near) hint = `E steal the ${near.type}`;
      const hideout = city.map.hideout;
      if (Math.hypot(player.x - hideout.x, player.z - hideout.z) < 20) hint = 'H lie low · clear the heat';
      if (wantedLevel() >= 3 && hideout && hint === '') hint = 'Break line of sight to lose the stars';
    }
  }
  hud.setHint(hint);
  game.hint = hint;

  const dropList = missions.state.active ? city.map.drops : [];
  const heli = police?.state.heli ?? null;
  const policeBlips = police
    ? police.state.units.filter((u) => !u.dead).map((u) => ({ x: u.x, z: u.z, hot: wantedLevel() >= 3 }))
        .concat(police.state.officers.filter((o) => !o.down).map((o) => ({ x: o.x, z: o.z, hot: wantedLevel() >= 3 })))
    : [];
  hud.drawMinimap({
    player: car ? { x: car.x, z: car.z, heading: car.heading } : { x: player.x, z: player.z, heading: player.heading },
    traffic: world.traffic ? world.traffic.cars.filter((c) => !c.dead) : [],
    police: policeBlips,
    marker: missions.state.active ? missions.markerInfo() : null,
    drops: dropList,
    heli: heli ? { x: heli.x, z: heli.z, heading: heli.mesh.rotation.y } : null,
    hideout: city.map.hideout,
    showHideout: true,
    district: game.district,
    zoom: car ? 190 : 150,
  });
}

// The badge names the two non-standard builds: DEMO while the attract loop drives, and the
// core-only fallback whenever ?core=1 (or window.NEONBAY_CORE_ONLY) turned the optional half off.
function updateModeBadge() {
  const badge = document.getElementById('mode-badge');
  if (!badge) return;
  const demo = game.demo && game.mode === 'playing';
  badge.hidden = !demo && !CORE_ONLY;
  badge.textContent = demo ? 'Demo · autopilot' : 'Core build';
  if (document.body.dataset.demo !== (demo ? '1' : '0')) document.body.dataset.demo = demo ? '1' : '0';
  if (document.body.dataset.core !== (CORE_ONLY ? '1' : '0')) document.body.dataset.core = CORE_ONLY ? '1' : '0';
}

// ---------------------------------------------------------------------------------------------
// Shot staging: ?shot=drive|chase|briefing|neon&seed=1
// ---------------------------------------------------------------------------------------------
function newCar(type, color, x, z, heading) {
  const car = createVehicle(scene, city, { type, color, x, z, heading });
  car.driver = null;
  car.label = 'Staged car';
  world.cars.push(car);
  return car;
}

function placeCar(car, x, z, heading, speed = 0) {
  car.x = x;
  car.z = z;
  car.heading = heading;
  car.speed = speed;
  car.sync();
}

function stagePlayersRide(type, color, x, z, heading) {
  const car = newCar(type, color, x, z, heading);
  car.driver = { player: true };
  player.inCar = car;
  player.x = x;
  player.z = z;
  player.heading = heading;
  player.mesh.visible = false;
  return car;
}

function stageTrafficAvenue(rows) {
  if (!world.traffic) return;
  const cars = world.traffic.cars;
  rows.forEach((row, index) => {
    const car = cars[index];
    if (!car) return;
    placeCar(car, row.x, row.z, row.heading, row.speed ?? 0);
    car.ai = { route: [{ x: row.x, z: row.z - 30 }, { x: row.x, z: row.z - 90 }], waypoint: 1, cruise: 0, stuck: 0 };
    car.driver = { stage: true };
  });
}

function stagePeds(spots) {
  if (!world.peds) return;
  spots.forEach((spot, index) => {
    const ped = world.peds.peds[index];
    if (!ped) return;
    ped.x = spot.x;
    ped.z = spot.z;
    ped.heading = spot.heading ?? 0;
    ped.speed = 0;
    ped.target = { x: spot.x, z: spot.z };
    ped.mesh.position.set(ped.x, 0, ped.z);
    ped.mesh.rotation.y = ped.heading;
    ped.mesh.userData.pose(0.016, 0, {});
  });
}

function hideAllPanels() {
  menu.hideAll();
  menu.hideBriefing();
  menu.hidePause();
  menu.hideEnd();
}

function hideBriefingCamera() {
  world.shotView = null;
}

function stageShot(name) {
  hideAllPanels();
  game.mode = 'playing';
  game.started = true;
  game.freeze = true;
  world.freeze = true;
  game.demo = false;
  game.wantedFallback = 0;
  player.setArmed(true);
  document.getElementById('reticle')?.classList.add('on');

  if (name === 'drive') {
    game.cash = 12480;
    player.cash = 12480;
    player.armor = 35;
    game.clock = 19 * 60 + 48;
    const car = stagePlayersRide('coupe', 0x35e7ff, 3.4, 146, Math.PI);
    car.speed = 15;
    car.steer = 0.04;
    stageTrafficAvenue([
      { x: 3.6, z: 122, heading: Math.PI, speed: 10 },
      { x: -3.7, z: 108, heading: 0, speed: 8 },
      { x: 3.6, z: 88, heading: Math.PI, speed: 11 },
      { x: -3.7, z: 74, heading: 0, speed: 9 },
    ]);
    stagePeds([
      { x: 11.5, z: 132, heading: 2.4 },
      { x: -11.2, z: 120, heading: 4.1 },
      { x: 12.2, z: 104, heading: 0.6 },
      { x: -12, z: 92, heading: 3.2 },
    ]);
    missions.state.active = null;
    missions.markerGroup.visible = false;
    hud.setObjective('', '');
    world.shotView = {
      pos: new THREE.Vector3(8.6, 4.4, 158),
      look: new THREE.Vector3(2.4, 1.15, 138),
    };
    hud.toast('Beachfront at dusk · coupe on the main drag', 'good');
  } else if (name === 'chase') {
    game.cash = 8450;
    player.cash = 8450;
    player.armor = 60;
    player.health = 82;
    game.clock = 22 * 60 + 6;
    player.x = 0;
    player.z = 64;
    player.heading = Math.PI;
    player.mesh.visible = true;
    player.mesh.position.set(player.x, 0, player.z);
    player.mesh.rotation.y = player.heading;
    player.mesh.userData.pose(0.016, 0, {});
    missions.begin(0, missionCtx());
    missions.forceStage(1);
    if (world.police) {
      world.police.setWanted(3);
      game.wantedFallback = 3;
      world.police.state.spawnCooldown = 8;
      const unit = world.police.spawnUnit(player, 0, 12);
      placeCar(unit, -4.2, 50.5, 0, 0);
      unit.lightPhase = 1.25;
      unit.sync();
      world.police.spawnOfficer(2.6, 58.5, Math.PI * 0.92);
      world.police.spawnOfficer(-6.2, 56.5, Math.PI * 0.78);
      // The world is frozen in a shot, so the orbit tick never runs: place the air unit by hand,
      // north-east of the player with its nose on them, and let the beam hang off its nose.
      world.police.syncHeli(player, -2.6);
    } else {
      // Core-only fallback still has to *read* as a chase: the stars and the ring live in the HUD,
      // the cruisers are the optional half.
      game.wantedFallback = 3;
    }
    stageTrafficAvenue([
      { x: 3.6, z: 46, heading: 0, speed: 9 },
      { x: -3.7, z: 90, heading: Math.PI, speed: 8 },
    ]);
    stagePeds([
      { x: 9.5, z: 60, heading: 4.4 },
      { x: -9.6, z: 64, heading: 1.7 },
      { x: 10.4, z: 68.5, heading: 3.1 },
      { x: -10.2, z: 55.5, heading: 0.2 },
    ]);
    missions.setMarker('drop0', 'Drop 1 of 3');
    syncObjective();
    world.shotView = {
      pos: new THREE.Vector3(0, 9, 108),
      look: new THREE.Vector3(-2, 24, 42),
    };
    hud.toast('On foot · 3 stars · bay PD on you', 'warn');
  } else if (name === 'briefing') {
    game.cash = 5210;
    player.cash = 5210;
    game.clock = 20 * 60 + 55;
    const car = newCar('coupe', 0xff3ea5, 2.5, 148, Math.PI);
    car.speed = 0;
    stagePeds([
      { x: 10.5, z: 150, heading: 2.2 },
      { x: 13, z: 145, heading: 5.1 },
      { x: -11, z: 152, heading: 3.3 },
    ]);
    game.mode = 'briefing';
    menu.showBriefing(MISSIONS[7]);
    document.getElementById('briefing')?.classList.add('shot-briefing');
    missions.state.active = null;
    hud.setObjective('', '');
    world.shotView = {
      pos: new THREE.Vector3(122, 46, 196),
      look: new THREE.Vector3(-6, 14, 30),
    };
  } else if (name === 'neon') {
    game.cash = 3375;
    player.cash = 3375;
    game.clock = 23 * 60 + 12;
    player.x = 9.5;
    player.z = 41;
    player.heading = Math.PI * 0.86;
    player.mesh.visible = true;
    player.mesh.position.set(player.x, 0, player.z);
    player.mesh.rotation.y = player.heading;
    player.mesh.userData.pose(0.016, 0, {});
    player.setArmed(false);
    const car = newCar('coupe', 0xff3ea5, 3.4, 33, 0);
    car.speed = 0;
    stagePeds([
      { x: 11.8, z: 36, heading: 0.4 },
      { x: -10.4, z: 38, heading: 3.6 },
      { x: 12.6, z: 46, heading: 5.2 },
      { x: -11.8, z: 45, heading: 1.1 },
      { x: -9.8, z: 31, heading: 2.7 },
      { x: 10.6, z: 29, heading: 4.9 },
    ]);
    stageTrafficAvenue([
      { x: -3.7, z: 58, heading: Math.PI, speed: 6 },
      { x: 3.6, z: 12, heading: 0, speed: 7 },
    ]);
    missions.state.active = null;
    hud.setObjective('', '');
    world.shotView = {
      pos: new THREE.Vector3(14.5, 3.5, 50),
      look: new THREE.Vector3(-2.5, 3.4, 29),
    };
    document.getElementById('reticle')?.classList.remove('on');
  } else {
    // Unknown shot name: fall back to the title flow rather than an empty page.
    world.freeze = false;
    game.freeze = false;
    backToTitle();
  }
  game.mode = name === 'briefing' ? 'briefing' : 'playing';
}

// ---------------------------------------------------------------------------------------------
// Demo mode (the title screen's DEMO MODE button): an attract loop. The courier van is stolen, the
// wanted level sits at three, a cruiser is behind you, and an autopilot drives the drops while the
// loop runs on its own. Touching any control hands the van back to the player, so the demo is a
// tutorial that never traps anyone. It restarts every 75 s so a cabinet left alone never goes quiet.
// ---------------------------------------------------------------------------------------------
function startDemo() {
  resetWorld();
  game.demo = true;
  game.demoTimer = 0;
  game.demoTurn = 0;
  game.demoRestart = 0;
  game.cash = 6000;
  player.cash = 6000;
  player.armor = 40;
  game.clock = 22 * 60 + 18;
  if (!world.courier) makeCourier();
  const van = world.courier;
  placeCar(van, missions.courierPoint.x, missions.courierPoint.z, missions.courierPoint.heading, 0);
  van.dead = false;
  van.health = 100;
  // The pickup marker is still the courier's own car; driving it off the lot means the first stage
  // must be forced past, or the demo would sit pointed at its own bumper.
  game.wantedFallback = 3;
  player.inCar = van;
  van.driver = { player: true };
  van.stolen = true;
  player.mesh.visible = false;
  player.x = van.x;
  player.z = van.z;
  player.heading = van.heading;
  cam.yaw = van.heading;
  missions.begin(0, missionCtx());
  missions.forceStage(1);
  if (world.police) {
    world.police.state.wanted = 3;
    world.police.state.spawnCooldown = 1.5;
    const unit = world.police.spawnUnit(player, 0.4, 16);
    placeCar(unit, van.x + 3.2, van.z + 12, van.heading, 10);
    world.police.spawnOfficer(van.x + 6, van.z - 8, Math.PI);
  }
  menu.hideAll();
  hud.toast('Demo · courier van, 3 stars, PD behind you', 'warn');
}

// The demo drives itself toward the current drop and leaves the police to the police module.
function updateDemo(dt) {
  if (!game.demo) return;
  game.demoTimer += dt;
  if (game.demoTimer > 75) {
    startDemo();
    return;
  }
  const car = player.inCar;
  if (!car || car.dead) {
    startDemo();
    return;
  }
  if (world.police && world.police.state.wanted < 2 && game.demoTimer > 4) {
    world.police.state.wanted = 3;
  }
  game.wantedFallback = world.police ? world.police.state.wanted : 3;
  const target = missions.markerInfo() ?? city.map.drops[0];
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const desired = Math.atan2(dx, dz);
  const delta = angleTo(car.heading, desired);
  // Steer only as hard as the car's grip allows; feather the throttle on sharp corners.
  const steer = clamp(delta * 1.6, -1, 1);
  const throttle = Math.abs(delta) > 1.1 ? 0.25 : 1;
  car.update(dt, { throttle, steer, handbrake: false, boost: Math.abs(delta) < 0.2 });
  player.x = car.x;
  player.z = car.z;
  player.heading = car.heading;
  player.speed = car.speed;
  player.mesh.visible = false;
  cam.yaw = turnToward(cam.yaw, car.heading, dt * 2.4);
  if (car.speed < 1.5 && game.demoTimer - game.demoTurn > 2.5) {
    // Wedged against a block: nudge the nose round and try again instead of idling all loop.
    car.heading += Math.PI * 0.55;
    game.demoTurn = game.demoTimer;
  }
  void game.demoRestart;
}

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------
function keyName(event) {
  if (event.code === 'Space') return 'Space';
  if (event.code.startsWith('Shift')) return 'Shift';
  if (event.code.startsWith('Arrow')) return event.code;
  if (event.code === 'Escape') return 'Escape';
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

window.addEventListener('keydown', (event) => {
  if (isTyping(event.target)) return;
  const key = keyName(event);
  // Any real keypress cancels the attract loop: the demo is a tutorial, never a cage.
  if (game.demo && ['w', 'a', 's', 'd', 'e', 'f', 'r', 'h', 'Space', 'Shift'].includes(key)) {
    game.demo = false;
    hud.toast('You have the wheel · demo off', 'good');
  }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) event.preventDefault();
  if (!keys[key]) {
    if (key === 'Escape') {
      if (game.mode === 'playing') pauseGame();
      else if (game.mode === 'paused') resumeGame();
      else if (game.mode === 'briefing') backToTitle();
    } else if (key === 'Enter' && game.mode === 'title') {
      startNewGame();
    } else if (key === 'e' && game.mode === 'playing') {
      if (player.inCar) {
        game.demo = false;
        exitCar();
      }
      else enterNearestCar();
    } else if (key === 'r' && game.mode === 'playing') {
      reload();
    } else if (key === 'f' && game.mode === 'playing') {
      melee();
    } else if (key === 'h' && game.mode === 'playing') {
      const hideout = city.map.hideout;
      if (Math.hypot(player.x - hideout.x, player.z - hideout.z) < 22) {
        world.police?.clear();
        hud.toast('Lying low · heat cleared', 'good');
      } else {
        hud.toast('The hideout is by the marina arch', '');
      }
    } else if (key === 'm') {
      const muted = world.audio?.toggleMute?.() ?? true;
      hud.toast(muted ? 'Audio muted' : 'Audio on', '');
    } else if (key === 'p' && game.mode === 'playing') {
      pauseGame();
    }
  }
  keys[key] = true;
});
window.addEventListener('keyup', (event) => {
  keys[keyName(event)] = false;
});
window.addEventListener('blur', () => {
  for (const key of Object.keys(keys)) keys[key] = false;
});

window.addEventListener('mousemove', (event) => {
  if (!game.pointerLocked && !mouse.down) return;
  if (game.mode !== 'playing') return;
  cam.yaw -= event.movementX * 0.0024;
  cam.pitch = clamp(cam.pitch - event.movementY * 0.0018, -0.12, 0.72);
});

renderer.domElement.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  mouse.down = true;
  if (game.mode !== 'playing') return;
  if (!game.pointerLocked && renderer.domElement.requestPointerLock) {
    try { renderer.domElement.requestPointerLock(); } catch { /* headless */ }
  }
  firePistol();
});
window.addEventListener('mouseup', () => { mouse.down = false; });
document.addEventListener('pointerlockchange', () => {
  game.pointerLocked = document.pointerLockElement === renderer.domElement;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

// ---------------------------------------------------------------------------------------------
// Boot + loop
// ---------------------------------------------------------------------------------------------
const perf = { frames: 0, samples: 0, sum: 0, max: 0, last: 0, overBudget: 0, ready: false };

let lastTime = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const startedAt = performance.now();
  const raw = lastTime ? (now - lastTime) / 1000 : 1 / 60;
  lastTime = now;
  const dt = clamp(raw, 0, 0.05);

  const simulating = game.mode === 'playing' && !game.freeze;
  if (simulating) updateWorld(dt);
  else if (game.mode === 'paused') {
    // Nothing moves while paused; the HUD stays drawn.
  }

  updateCamera(dt);
  applyTimeOfDay();
  updateHeliFx();
  missions.animate(game.simTime + raw);
  updateHud();
  if (world.police && world.police.state.wanted > 0) world.audio?.siren?.(true);
  else world.audio?.siren?.(false);

  renderer.render(scene, camera);

  perf.frames += 1;
  // READY means "one real frame has been drawn": the first render is the signal, not a frame
  // count, so a screenshot tool can wait on it even when the tab throttles rAF.
  if (!perf.ready) {
    perf.ready = true;
    window.__NEONBAY_READY__ = true;
    window.__NEONBAY_READY_FRAME__ = perf.frames;
    document.getElementById('boot-screen')?.setAttribute('hidden', '');
    document.getElementById('boot-screen')?.remove?.();
  }
  if (perf.frames > WARMUP_FRAMES) {
    // Measured as work, not as the gap between callbacks: a throttled rAF gap is not the game's
    // cost, and shader compilation is absorbed by the warmup frames before the budget applies.
    const ms = performance.now() - startedAt;
    perf.samples += 1;
    perf.sum += ms;
    if (ms > perf.max) perf.max = ms;
    if (ms >= MAX_FRAME_MS) perf.overBudget += 1;
  }
  window.__NEONBAY_FRAMES__ = perf.frames;
  window.__NEONBAY_MAXFRAME__ = Number(perf.max.toFixed(2));
  window.__NEONBAY_STATS__ = {
    frames: perf.frames,
    maxFrameMs: Number(perf.max.toFixed(2)),
    avgFrameMs: perf.samples ? Number((perf.sum / perf.samples).toFixed(2)) : 0,
    framesOverBudget: perf.overBudget,
    budgetMs: MAX_FRAME_MS,
    harnessFrames: HARNESS_FRAMES,
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    mode: game.mode,
    core: CORE_ONLY,
  };
  if (perf.frames === HARNESS_FRAMES) {
    // End of the harness window: publish the verdict once, in a form a test can assert on
    // without reading the whole stats object. `ok` is the contract the screenshot step waits for.
    window.__NEONBAY_HARNESS__ = {
      frames: perf.frames,
      maxFrameMs: Number(perf.max.toFixed(2)),
      avgFrameMs: perf.samples ? Number((perf.sum / perf.samples).toFixed(2)) : 0,
      overBudget: perf.overBudget,
      budgetMs: MAX_FRAME_MS,
      ok: perf.max < MAX_FRAME_MS,
    };
  }
}

async function boot() {
  makeParked();
  makeCourier();
  player.setArmed(true);
  await loadOptional();

  window.__NEONBAY__ = {
    game,
    world,
    player,
    city,
    camera,
    missions,
    hud,
    menu,
    combat,
    renderer,
    stats: () => window.__NEONBAY_STATS__,
    police: () => world.police,
    action(name) {
      if (name === 'demo') startDemo();
      else if (name === 'shot') stageShot(params.get('shot') ?? 'drive');
      else if (name === 'pause') pauseGame();
      else if (name === 'resume') resumeGame();
      else if (name === 'new') startNewGame();
    },
  };

  window.addEventListener('error', (event) => {
    hud.error(`Runtime error: ${event.message}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    hud.error(`Unhandled promise: ${event.reason?.message ?? event.reason}`);
  });

  if (SHOT) {
    try {
      stageShot(SHOT);
    } catch (error) {
      world.failures.push(`shot ${SHOT}: ${error.message}`);
      hud.error(`Shot staging failed · ${error.message}`);
      backToTitle();
    }
  } else {
    updateModeBadge();
    menu.showTitle(Boolean(readSave()));
    game.mode = 'title';
  }
  updateHud();
  requestAnimationFrame(frame);
}

boot().catch((error) => {
  fatal(error.message);
});
