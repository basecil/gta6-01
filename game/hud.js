// The HUD: vitals, cash, wanted stars, clock, district, objective and the minimap. It only reads
// numbers the game pushes in, and never touches the simulation. The minimap draws the city grid
// from the road lines once, then blits that to an offscreen canvas and stamps the blips on top, so
// it stays cheap at 60 Hz. Blip legend: cyan = you, red-blue = police, amber = mission, white =
// traffic, pink = the hideout.

const COLORS = {
  player: '#35e7ff',
  police: '#7fa8ff',
  policeHot: '#ff5f7a',
  mission: '#ffc25c',
  traffic: '#e7e1f5',
  hideout: '#ff3ea5',
  drop: '#57f2a4',
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const healthFill = $('health-fill');
  const armorFill = $('armor-fill');
  const healthNum = $('health-num');
  const armorNum = $('armor-num');
  const cashEl = $('cash');
  const starEls = [...document.querySelectorAll('#stars span')];
  const starsEl = $('stars');
  const clockEl = $('clock');
  const districtEl = $('district');
  const objectivePanel = $('objective-panel');
  const missionName = $('mission-name');
  const missionTimer = $('mission-timer');
  const missionProgress = $('mission-progress');
  const objectiveText = $('objective-text');
  const weaponName = $('weapon-name');
  const ammoEl = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const reloadNote = $('reload-note');
  const speedPanel = $('speed-panel');
  const speedValue = $('speed-value');
  const hintEl = $('hint');
  const toastEl = $('toast');
  const errorNote = $('error-note');
  const vignetteEl = $('vignette');
  const hitmarkerEl = $('hitmarker');
  const canvas = $('minimap');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;

  const offscreen = document.createElement('canvas');
  offscreen.width = size;
  offscreen.height = size;
  const off = offscreen.getContext('2d');
  let mapReady = false;
  let mapSpan = 128;

  const cache = {
    health: -1, armor: -1, cash: -1, stars: -1, clock: '', ammo: -1, reserve: -1,
    district: '', mission: '', objective: '', timer: '', progress: '', speed: -1, reload: '', hint: '', weapon: '',
    mode: '',
  };
  let hitFlash = 0;

  function setText(el, key, value) {
    if (cache[key] === value) return;
    cache[key] = value;
    el.textContent = value;
  }

  return {
    setVitals(health, armor) {
      const hp = Math.max(0, Math.round(health));
      if (cache.health !== hp) {
        cache.health = hp;
        healthFill.style.width = `${hp}%`;
        healthNum.textContent = hp;
      }
      const ar = Math.max(0, Math.round(armor));
      if (cache.armor !== ar) {
        cache.armor = ar;
        armorFill.style.width = `${ar}%`;
        armorNum.textContent = ar;
      }
    },
    setCash(cash) {
      const value = Math.round(cash);
      if (cache.cash === value) return;
      cache.cash = value;
      cashEl.textContent = `$${value.toLocaleString('en-US')}`;
    },
    setWanted(level) {
      const stars = Math.max(0, Math.min(5, Math.round(level)));
      if (cache.stars === stars) return;
      cache.stars = stars;
      starEls.forEach((el, index) => el.classList.toggle('on', index < stars));
      starsEl.classList.toggle('alert', stars >= 3);
    },
    setClock(hours, minutes) {
      const text = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      setText(clockEl, 'clock', text);
    },
    setDistrict(name) {
      setText(districtEl, 'district', name);
    },
    setAmmo(mag, reserve, reloading) {
      if (cache.ammo !== mag) { cache.ammo = mag; ammoMag.textContent = mag; }
      if (cache.reserve !== reserve) { cache.reserve = reserve; ammoReserve.textContent = ` / ${reserve}`; }
      ammoEl.classList.toggle('empty', mag === 0);
      setText(reloadNote, 'reload', reloading ? 'Reloading' : mag === 0 ? 'Press R' : '');
    },
    setWeapon(name) {
      setText(weaponName, 'weapon', name);
    },
    setObjective(name, text, timer, progress) {
      if (!text) {
        if (!objectivePanel.hidden) objectivePanel.hidden = true;
        return;
      }
      objectivePanel.hidden = false;
      setText(missionName, 'mission', name);
      setText(objectiveText, 'objective', text);
      const timerText = timer == null || timer === '' ? '' : String(timer);
      setText(missionTimer, 'timer', timerText);
      if (missionProgress) setText(missionProgress, 'progress', progress ?? '');
    },
    // A small crosshair pop at the reticle when a shot connects. Main passes combat.state.
    setHitmarker(amount) {
      if (!hitmarkerEl) return;
      const on = amount > 0;
      if (on !== (hitFlash > 0)) hitmarkerEl.classList.toggle('on', on);
      hitFlash = amount;
    },
    // The title/end screens hide the vitals' pulse but never the map: the map is the game's face.
    setMode(mode) {
      if (cache.mode === mode) return;
      cache.mode = mode;
      document.body.dataset.mode = mode;
    },
    setSpeed(speed) {
      if (speed == null) {
        if (!speedPanel.hidden) speedPanel.hidden = true;
        return;
      }
      speedPanel.hidden = false;
      const value = Math.round(Math.abs(speed) * 3.6);
      if (cache.speed !== value) {
        cache.speed = value;
        speedValue.textContent = value;
      }
    },
    setHint(text) {
      if (text === cache.hint) return;
      cache.hint = text;
      hintEl.hidden = !text;
      hintEl.textContent = text || '';
    },
    toast(text, kind = '') {
      const item = document.createElement('div');
      item.textContent = text;
      if (kind) item.className = kind;
      toastEl.appendChild(item);
      const remove = () => item.remove();
      if (typeof item.animate === 'function') {
        const animation = item.animate(
          [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
          { duration: 160, fill: 'both' },
        );
        void animation;
      }
      setTimeout(remove, 3600);
    },
    vignette(intensity) {
      vignetteEl.style.opacity = String(Math.max(0, Math.min(0.95, intensity)));
    },
    error(text) {
      errorNote.hidden = false;
      errorNote.textContent = text;
    },
    clearError() {
      errorNote.hidden = true;
      errorNote.textContent = '';
    },
    bakeMap(city) {
      const span = city.spec.half * 2 + 40;
      mapSpan = span;
      const scale = size / span;
      off.fillStyle = '#0a0814';
      off.fillRect(0, 0, size, size);
      const toX = (x) => (x + span / 2) * scale;
      const toY = (z) => (z + span / 2) * scale;
      // Blocks first, then roads as lighter strips.
      off.fillStyle = '#171327';
      for (const block of city.blocks) {
        const half = block.sidewalkHalf;
        off.fillRect(toX(block.x - half), toY(block.z - half), half * 2 * scale, half * 2 * scale);
      }
      off.strokeStyle = '#2b2745';
      off.lineWidth = Math.max(2, city.spec.roadHalf * 2 * scale);
      for (const line of city.roadLines) {
        off.beginPath();
        off.moveTo(toX(line), toY(-city.spec.half * 0 - span / 2));
        off.lineTo(toX(line), toY(span / 2));
        off.stroke();
        off.beginPath();
        off.moveTo(toX(-span / 2), toY(line));
        off.lineTo(toX(span / 2), toY(line));
        off.stroke();
      }
      off.fillStyle = '#081028';
      off.fillRect(0, toY(city.spec.waterZ - 2), size, size - toY(city.spec.waterZ - 2));
      off.strokeStyle = 'rgba(53,231,255,0.25)';
      off.lineWidth = 1;
      off.strokeRect(0.5, 0.5, size - 1, size - 1);
      mapReady = true;
    },
    drawMinimap(snapshot) {
      if (!mapReady) return;
      const span = mapSpan;
      // A zoomed minimap keeps the player centred: the baked city is scaled up and panned so the
      // player's dot stays at the middle of the dial while the view span shrinks.
      const viewSpan = Math.max(60, Math.min(span, snapshot.zoom ?? span));
      const px = (x) => ((x - snapshot.player.x) / viewSpan + 0.5) * size;
      const py = (z) => ((z - snapshot.player.z) / viewSpan + 0.5) * size;
      const zoom = span / viewSpan;
      const baseScale = size / span;

      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#0a0814';
      ctx.fillRect(0, 0, size, size);
      ctx.save();
      ctx.translate(px(snapshot.player.x), py(snapshot.player.z));
      ctx.scale(zoom, zoom);
      ctx.drawImage(offscreen, -size / 2, -size / 2);
      ctx.restore();

      // A faint ring marks the visible span so the map reads as a device, not a texture.
      ctx.strokeStyle = 'rgba(53,231,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      ctx.stroke();

      // Blips.
      if (snapshot.hideout && snapshot.showHideout) {
        ctx.fillStyle = COLORS.hideout;
        ctx.beginPath();
        ctx.arc(px(snapshot.hideout.x), py(snapshot.hideout.z), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const drop of snapshot.drops ?? []) {
        ctx.strokeStyle = COLORS.drop;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(px(drop.x), py(drop.z), 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const car of snapshot.traffic ?? []) {
        ctx.fillStyle = COLORS.traffic;
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        ctx.arc(px(car.x), py(car.z), 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const unit of snapshot.police ?? []) {
        ctx.fillStyle = unit.hot ? COLORS.policeHot : COLORS.police;
        ctx.beginPath();
        ctx.arc(px(unit.x), py(unit.z), 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // Wanted radius: a red arc growing with the heat, so the chase reads on the dial too.
      if (snapshot.wanted > 0) {
        ctx.strokeStyle = snapshot.wanted >= 3 ? 'rgba(255,95,122,0.5)' : 'rgba(255,194,92,0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, 12 + snapshot.wanted * 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (snapshot.marker) {
        ctx.fillStyle = COLORS.mission;
        ctx.beginPath();
        ctx.arc(px(snapshot.marker.x), py(snapshot.marker.z), 5.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1a1320';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      if (snapshot.player) {
        ctx.save();
        ctx.translate(px(snapshot.player.x), py(snapshot.player.z));
        ctx.rotate(-snapshot.player.heading + Math.PI);
        ctx.fillStyle = COLORS.player;
        ctx.shadowColor = COLORS.player;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(6, 6);
        ctx.lineTo(0, 3);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      // Compass lettering, always on so the map's orientation is unmistakable.
      ctx.fillStyle = 'rgba(245,240,255,0.82)';
      ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('N', size / 2, 12);
      if (snapshot.marker) {
        // Bearing + distance to the objective, bottom-left of the dial.
        const dx = snapshot.marker.x - snapshot.player.x;
        const dz = snapshot.marker.z - snapshot.player.z;
        const metres = Math.round(Math.hypot(dx, dz));
        ctx.textAlign = 'left';
        ctx.fillStyle = COLORS.mission;
        ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
        ctx.fillText(`OBJ ${metres}m`, 7, size - 8);
      }
      void baseScale;
    },
    hasMap() {
      return mapReady;
    },
  };
}
