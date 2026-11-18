// The eight-job arc. Mission 1 (Hot Cargo) and jobs 6-8 (Searchlight, Dead Water, Rooftop Getaway)
// are playable end to end; jobs 2-5 still ship as briefings with their objectives written out, so
// the story reads complete in the game and in the screenshots.
// A mission is a small ordered list of stages; each stage has an objective line, a marker and a
// predicate the runner polls, so adding a mission is data, not new control flow.

import * as THREE from 'three';

export const MISSIONS = [
  {
    id: 1,
    name: 'Hot Cargo',
    tag: 'Job 01 · Courier',
    contact: 'Riva',
    body: 'A courier car is idling on the marina lot with a crate of bootleg chips in the trunk. The harbour crew is still asleep. Move it across the bay and drop it three times before they wake up.',
    goal: 'Steal the courier car, then hit all three drops before the timer runs out.',
    reward: 1500,
    timeLimit: 105,
    playable: true,
    stages: [
      { id: 'pickup', text: 'Steal the courier car parked on the marina lot', marker: 'courier' },
      { id: 'drop1', text: 'Drop 1 of 3 — the south blocks', marker: 'drop0' },
      { id: 'drop2', text: 'Drop 2 of 3 — the east piers', marker: 'drop1' },
      { id: 'drop3', text: 'Drop 3 of 3 — the marina arch', marker: 'drop2' },
    ],
  },
  {
    id: 2,
    name: 'Green Light',
    tag: 'Job 02 · Getaway',
    contact: 'Riva',
    body: 'The chips were clean, so the crew wants a driver for a jewellery run. Sit outside the store with the engine warm, take the bag man aboard, and lose the cruiser that picks you up.',
    goal: 'Wait at the jewellery store, pick up the runner, then shake the cruiser before the bridge.',
    reward: 2600,
    playable: false,
    stages: [
      { id: 'wait', text: 'Park outside Kowalski & Sons and keep the engine running', marker: 'store' },
      { id: 'pickup', text: 'Pick up the runner from the alley', marker: 'alley' },
      { id: 'shake', text: 'Lose the cruiser before the bay bridge', marker: 'bridge' },
    ],
  },
  {
    id: 3,
    name: 'Undertow',
    tag: 'Job 03 · Muscle',
    contact: 'Mako',
    body: 'A dock crew is skimming the take. Mako wants a message delivered in person, and he does not care whether the dockside guards are armed. They are.',
    goal: 'Drive to the docks, clear the two guards, and bring the ledger back to the marina.',
    reward: 3800,
    playable: false,
    stages: [
      { id: 'drive', text: 'Drive to the container docks on the north pier', marker: 'docks' },
      { id: 'fight', text: 'Deal with the two dockside guards', marker: 'docks' },
      { id: 'return', text: 'Bring the ledger back to the marina hideout', marker: 'hideout' },
    ],
  },
  {
    id: 4,
    name: 'Low Tide',
    tag: 'Job 04 · Setup',
    contact: 'Mako',
    body: 'The harbour heist needs eyes inside. Tail the night manager from the casino to the marina without being spotted, then photograph the loading schedule on his desk.',
    goal: 'Follow the night manager at a distance, photograph the schedule, and get out unseen.',
    reward: 5200,
    playable: false,
    stages: [
      { id: 'tail', text: 'Tail the night manager from the casino', marker: 'casino' },
      { id: 'photo', text: 'Photograph the loading schedule in the marina office', marker: 'office' },
      { id: 'escape', text: 'Leave the marina without raising a star', marker: 'pier' },
    ],
  },
  {
    id: 5,
    name: 'High Water',
    tag: 'Job 05 · Heist',
    contact: 'Riva',
    body: 'One container, one night, one window. The crew takes the harbour vault while you keep the bay police busy on the far side of the bridge. Everyone gets wet, nobody gets caught.',
    goal: 'Run the decoy chase across the bridge, survive five stars, and reach the extraction at Pier 9.',
    reward: 9000,
    playable: false,
    stages: [
      { id: 'decoy', text: 'Draw the bay police onto the bridge', marker: 'bridge' },
      { id: 'survive', text: 'Survive the pursuit — keep the crew’s window open', marker: 'bridge' },
      { id: 'extract', text: 'Reach the extraction boat at Pier 9', marker: 'pier' },
    ],
  },
  {
    id: 6,
    name: 'Searchlight',
    tag: 'Job 06 · Escape',
    contact: 'Riva',
    body: 'The bridge decoy worked too well. Bay PD parks an air unit over the marina, and its searchlight owns every alley you might use. Riva wants the heat dragged north, the beam killed under the arch, and the car left cold at the hideout.',
    goal: 'Take the heat to three stars, break the searchlight under the marina arch, and ditch the car at the hideout.',
    reward: 7200,
    playable: true,
    stages: [
      { id: 'bait', text: 'Hold the air unit over the marina for six seconds', marker: 'marina', kind: 'heat', wanted: 3, hold: 6 },
      { id: 'blind', text: 'Kill the searchlight under the marina arch', marker: 'arch' },
      { id: 'ditch', text: 'Ditch the car at the marina hideout and go quiet', marker: 'hideout' },
    ],
  },
  {
    id: 7,
    name: 'Dead Water',
    tag: 'Job 07 · Heist',
    contact: 'Mako',
    body: 'The harbour vault is not in a bank. It is a container on the north docks, and the manifest calls it machine parts. Mako needs the gantry crane, one clear minute of gate time, and a driver who does not stall at the weighbridge.',
    goal: 'Stage the crew at the container docks, crack the vault container, and run it to the extraction at Pier 9.',
    reward: 11000,
    playable: true,
    stages: [
      { id: 'stage', text: 'Stage the crew at the container docks', marker: 'docks' },
      { id: 'crack', text: 'Hold the dock gate under two stars of heat', marker: 'crane', kind: 'heat', wanted: 2, hold: 5 },
      { id: 'run', text: 'Run the container to the extraction at Pier 9', marker: 'pier' },
    ],
  },
  {
    id: 8,
    name: 'Rooftop Getaway',
    tag: 'Job 08 · Finale',
    contact: 'Riva',
    body: 'Every crew in the bay wants a cut of the harbour take, and the meet is on a roof because nobody trusts a room. Take the service ramp to the roof garage, pull the air unit away from the handoff, then vanish under the arch before the searchlight swings back.',
    goal: 'Reach the roof garage, pull the helicopter off the meet at three stars, then go dark under the marina arch.',
    reward: 15000,
    playable: true,
    stages: [
      { id: 'roof', text: 'Take the service ramp to the roof garage', marker: 'roof' },
      { id: 'draw', text: 'Pull the air unit off the meet — hold three stars', marker: 'helipad', kind: 'heat', wanted: 3, hold: 6 },
      { id: 'vanish', text: 'Go dark under the marina arch before the searchlight returns', marker: 'arch', kind: 'cool', wanted: 1 },
    ],
  },
];

// The static marker each job's briefing points at, so the "Close" button on an outline job can
// still drop a mission marker in the world instead of doing nothing at all.
export const BRIEFING_MARKERS = { 2: 'store', 3: 'docks', 4: 'casino', 5: 'bridge', 6: 'marina', 7: 'docks', 8: 'roof' };

function ringMesh(color, radius, height) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.12, 8, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = height;
  return ring;
}

export function createMissions(scene, city, options = {}) {
  const state = {
    active: null,
    index: 0,
    stage: 0,
    timer: 0,
    timeLimit: 0,
    deliveries: 0,
    failed: false,
    completed: [],
    marker: null,
    markerPos: null,
    markerLabel: '',
    briefingOpen: false,
    elapsed: 0,
    holdTimer: 0,
  };

  const markerGroup = new THREE.Group();
  scene.add(markerGroup);
  const ring = ringMesh(0xffc25c, 4.2, 0.12);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.4, 24, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc25c, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = 12;
  markerGroup.add(ring, beam);
  markerGroup.visible = false;

  const courierSpot = options.courier ?? { x: 3.4, z: 96, heading: Math.PI };
  const stops = city?.map?.stops ?? {};
  const targetPositions = {
    courier: { x: courierSpot.x, z: courierSpot.z },
    drop0: city.map.drops[0],
    drop1: city.map.drops[1],
    drop2: city.map.drops[2],
    hideout: city.map.hideout,
    guard: stops.guards ?? { x: 108, z: -104 },
    exit: stops.pier ?? { x: 84, z: (city.map.waterZ ?? 150) + 20 },
  };
  // Jobs 2-5 are briefings, but their markers still resolve from the city's own story stops, so a
  // briefing always points at a real place: the store, the alley, the bridge, the office, the pier.
  for (const [key, point] of Object.entries(stops)) {
    if (point && Number.isFinite(point.x) && Number.isFinite(point.z)) targetPositions[key] = point;
  }
  // The round-four jobs name their own stops: a marina crossroads for the air-unit bait, the arch
  // where the searchlight dies, the roof garage and its helipad, and the docks gantry crane. Every
  // point sits on a road line so the ring and the minimap blip are always drivable to.
  Object.assign(targetPositions, {
    marina: { x: 0, z: 128 },
    arch: { x: -64, z: 96 },
    roof: { x: 64, z: 96 },
    helipad: { x: 128, z: 64 },
    crane: { x: 128, z: -128 },
  });

  function setMarker(key, label) {
    const point = targetPositions[key];
    if (!point) {
      markerGroup.visible = false;
      state.markerPos = null;
      state.markerLabel = '';
      return;
    }
    markerGroup.visible = true;
    markerGroup.position.set(point.x, 0, point.z);
    state.markerPos = { x: point.x, z: point.z };
    state.markerLabel = label ?? key;
  }

  function begin(index, ctx) {
    const mission = MISSIONS[index];
    if (!mission) return null;
    state.active = mission;
    state.index = index;
    state.stage = 0;
    state.timeLimit = mission.timeLimit ?? 0;
    state.timer = mission.timeLimit ?? 0;
    state.deliveries = 0;
    state.failed = false;
    state.elapsed = 0;
    state.holdTimer = 0;
    state.completed = [];
    const stage = mission.stages[0];
    setMarker(stage.marker, stage.text);
    if (ctx?.onBegin) ctx.onBegin(mission, stage);
    return mission;
  }

  function completeStage(ctx) {
    if (!state.active) return;
    const done = state.active;
    const finished = done.stages[state.stage];
    if (finished && !state.completed.includes(finished.id)) state.completed.push(finished.id);
    state.stage += 1;
    state.holdTimer = 0;
    const stage = state.active.stages[state.stage];
    if (!stage) {
      state.active = null;
      state.markerPos = null;
      markerGroup.visible = false;
      if (ctx?.onComplete) ctx.onComplete(done);
      return;
    }
    setMarker(stage.marker, stage.text);
    if (ctx?.onStage) ctx.onStage(state.active, stage);
  }

  function forceStage(index, ctx) {
    if (!state.active) return;
    const clamped = Math.max(0, Math.min(state.active.stages.length - 1, index));
    const stage = state.active.stages[clamped];
    if (!stage) return;
    state.stage = clamped;
    state.holdTimer = 0;
    state.completed = state.active.stages.slice(0, state.stage).map((s) => s.id);
    state.deliveries = state.completed.filter((id) => id.startsWith('drop')).length;
    setMarker(stage.marker, stage.text);
    if (ctx?.onStage) ctx.onStage(state.active, stage);
  }

  function fail(ctx) {
    if (!state.active) return;
    state.failed = true;
    if (ctx?.onFail) ctx.onFail(state.active);
  }

  // A briefing for any job in the arc, with the state the menu needs to draw the progress rail.
  function briefingFor(index) {
    const mission = MISSIONS[index];
    if (!mission) return null;
    return {
      ...mission,
      marker: BRIEFING_MARKERS[mission.id] ?? mission.stages?.[0]?.marker ?? null,
      done: state.completedHistory?.includes?.(mission.id) ?? false,
    };
  }

  function update(dt, ctx) {
    if (!state.active) return;
    const player = ctx.player;
    const stage = state.active.stages[state.stage];
    if (!stage) return;
    state.elapsed += dt;

    if (state.timeLimit) {
      state.timer = Math.max(0, state.timer - dt);
      if (state.timer <= 0) {
        fail(ctx);
        return;
      }
    }

    if (stage.id === 'pickup') {
      const car = ctx.courierCar;
      if (player.inCar && player.inCar === car) {
        completeStage(ctx);
      }
      return;
    }

    if (stage.id.startsWith('drop')) {
      const point = targetPositions[stage.marker];
      if (!point) return;
      const inCar = Boolean(player.inCar);
      const distance = Math.hypot(player.x - point.x, player.z - point.z);
      if (inCar && distance < 7.5) {
        state.deliveries += 1;
        if (ctx.onDelivery) ctx.onDelivery(state.deliveries, state.active.stages.length - 1);
        completeStage(ctx);
      }
      return;
    }

    // Pursuit stages: hold a heat level (baiting the air unit) or drop below one (going dark).
    // Reuses the police module's wanted count through the context, so no new chase bookkeeping.
    // A heat stage must be *held* for stage.hold seconds of simulated time, so the chase is real
    // rather than a one-tick trigger; a cool stage completes the moment the stars fall.
    if (stage.kind === 'heat' || stage.kind === 'cool') {
      const wanted = ctx.wanted ? ctx.wanted() : 0;
      let met = stage.kind === 'heat' ? wanted >= (stage.wanted ?? 3) : wanted <= (stage.wanted ?? 1);
      // Going dark is a place as well as a heat level: the arch is where the searchlight loses you.
      if (met && stage.kind === 'cool' && state.markerPos) {
        met = Math.hypot(player.x - state.markerPos.x, player.z - state.markerPos.z) < 14;
      }
      if (!met) {
        state.holdTimer = 0;
        return;
      }
      state.holdTimer += dt;
      if (state.holdTimer >= (stage.hold ?? 0)) completeStage(ctx);
      return;
    }

    // Generic reach-the-marker stages (the outline jobs use these if they are ever made playable).
    if (state.markerPos) {
      const distance = Math.hypot(player.x - state.markerPos.x, player.z - state.markerPos.z);
      if (distance < 6) completeStage(ctx);
    }
  }

  return {
    state,
    missions: MISSIONS,
    begin,
    update,
    fail,
    completeStage,
    forceStage,
    setMarker,
    briefingFor,
    courierPoint: { x: courierSpot.x, z: courierSpot.z, heading: courierSpot.heading ?? Math.PI },
    markerGroup,
    ring,
    targetPositions,
    objectiveText() {
      if (!state.active) return '';
      const stage = state.active.stages[state.stage];
      return stage ? stage.text : '';
    },
    // "Drop 2 of 3" style progress for the objective card; empty when the stage is not counted.
    progressText() {
      if (!state.active) return '';
      const total = state.active.stages.length;
      if (total <= 1) return '';
      const drops = state.active.stages.filter((s) => s.id.startsWith('drop')).length;
      if (drops) return `${Math.min(state.deliveries, drops)}/${drops} drops`;
      return `Step ${Math.min(state.stage + 1, total)} of ${total}`;
    },
    timerText() {
      if (!state.active || !state.timeLimit) return '';
      const seconds = Math.max(0, Math.ceil(state.timer));
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    },
    stageInfo() {
      if (!state.active) return null;
      return {
        index: state.stage,
        total: state.active.stages.length,
        stage: state.active.stages[state.stage] ?? null,
        elapsed: state.elapsed,
      };
    },
    markerInfo() {
      return state.markerPos ? { x: state.markerPos.x, z: state.markerPos.z, label: state.markerLabel } : null;
    },
    animate(elapsed) {
      if (!markerGroup.visible) return;
      ring.rotation.z = elapsed * 0.9;
      ring.position.y = 0.2 + Math.sin(elapsed * 2) * 0.12;
      beam.material.opacity = 0.1 + Math.sin(elapsed * 2.4) * 0.05;
    },
  };
}
