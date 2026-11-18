// Menus: the title screen (New Game / Continue / Demo / Controls), the mission briefing card,
// pause, a controls sheet and the end card. It is pure DOM plumbing; main.js owns the state and
// passes callbacks in. The briefing card carries the whole arc: an eight-row job board down the
// left picks any job, and the card beside it draws the selected job's body, objective and stage
// rail, so the story reads complete at a glance.

import { MISSIONS } from './missions.js';

const $ = (id) => document.getElementById(id);

export function createMenu(handlers) {
  const menu = $('menu');
  const briefing = $('briefing');
  const pause = $('pause');
  const controls = $('controls');
  const endcard = $('endcard');
  const overlays = [menu, briefing, pause, controls, endcard];
  const continueNote = $('has-save');
  const briefSteps = $('briefing-steps');
  const jobList = $('job-list');
  let jobRows = [];
  let controlsReturn = menu;
  let briefingReturn = menu;

  function show(overlay) {
    for (const item of overlays) item.hidden = item !== overlay;
  }

  function hideAll() {
    for (const item of overlays) item.hidden = true;
  }

  function bind(id, handler) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', (event) => {
      event.preventDefault();
      handler();
    });
  }

  bind('btn-new', () => handlers.onNew?.());
  bind('btn-continue', () => handlers.onContinue?.());
  bind('btn-demo', () => handlers.onDemo?.());
  bind('btn-controls', () => {
    controlsReturn = menu;
    show(controls);
  });
  bind('btn-controls-back', () => show(controlsReturn));
  bind('btn-briefing-go', () => handlers.onBriefingGo?.());
  bind('btn-briefing-later', () => show(briefingReturn));
  bind('btn-resume', () => handlers.onResume?.());
  bind('btn-pause-controls', () => {
    controlsReturn = pause;
    show(controls);
  });
  bind('btn-quit', () => handlers.onQuit?.());
  bind('btn-end-continue', () => handlers.onEndContinue?.());
  bind('btn-end-retry', () => handlers.onEndRetry?.());

  return {
    hideAll,
    showTitle(hasSave, note) {
      continueNote.textContent = note ?? (hasSave ? 'Saved game found' : 'No save yet');
      $('btn-continue').disabled = !hasSave;
      briefingReturn = menu;
      show(menu);
    },
    isTitle() {
      return !menu.hidden;
    },
    // The briefing's eight-row job board. The selected job is the one the card is showing.
    setJobs(jobs, selectedId) {
      if (!jobList) return;
      jobList.replaceChildren();
      jobRows = (jobs ?? []).map((job) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'job-row';
        row.dataset.id = String(job.id);
        row.setAttribute('aria-pressed', String(job.id === selectedId));
        if (job.id === selectedId) row.classList.add('is-active');
        const num = document.createElement('i');
        num.textContent = String(job.id).padStart(2, '0');
        const name = document.createElement('span');
        name.className = 'job-name';
        name.textContent = job.name;
        const meta = document.createElement('em');
        meta.textContent = job.tag?.split('·')[1]?.trim() ?? '';
        row.append(num, name, meta);
        row.addEventListener('click', () => handlers.onPickJob?.(job.id - 1));
        jobList.appendChild(row);
        return row;
      });
    },
    showBriefing(mission, { wide = false, from = 'title' } = {}) {
      if (!mission) return;
      // Keep the board in one place: every briefing draw re-paints the eight rows and marks the
      // selected job, so the card and the list can never disagree.
      this.setJobs(MISSIONS, mission.id);
      briefingReturn = from === 'title' ? menu : from === 'end' ? endcard : menu;
      $('briefing-tag').textContent = mission.tag ?? 'Mission briefing';
      $('briefing-title').textContent = mission.name;
      $('briefing-body').textContent = mission.body;
      $('briefing-contact').textContent = mission.contact ?? 'Riva';
      $('briefing-goal').textContent = mission.goal;
      const limit = mission.timeLimit
        ? ` · timer ${Math.floor(mission.timeLimit / 60)}:${String(mission.timeLimit % 60).padStart(2, '0')}`
        : '';
      $('briefing-reward').textContent = mission.playable
        ? `Reward $${mission.reward.toLocaleString('en-US')}${limit}`
        : `Reward $${mission.reward.toLocaleString('en-US')} · outline job (briefing only in this build)`;
      const go = $('btn-briefing-go');
      go.firstChild.textContent = mission.playable ? "Let's ride " : 'Close ';
      go.querySelector('small').textContent = mission.playable ? 'Enter' : 'Esc';
      const later = $('btn-briefing-later');
      if (later) later.hidden = !mission.playable && from === 'title';
      // Progress rail: one chip per stage, numbered, so every job shows its shape.
      if (briefSteps) {
        briefSteps.replaceChildren();
        (mission.stages ?? []).forEach((stage, index) => {
          const chip = document.createElement('li');
          chip.className = 'brief-step';
          const num = document.createElement('i');
          num.textContent = String(index + 1).padStart(2, '0');
          const text = document.createElement('span');
          text.textContent = stage.text;
          chip.append(num, text);
          briefSteps.appendChild(chip);
        });
      }
      briefing.classList.toggle('overlay-wide', wide);
      briefing.classList.toggle('shot-briefing', false);
      show(briefing);
    },
    hideBriefing() {
      briefing.hidden = true;
    },
    showPause() {
      show(pause);
    },
    hidePause() {
      pause.hidden = true;
    },
    showControls() {
      controlsReturn = menu;
      show(controls);
    },
    showEnd({ kicker, title, copy, retry = true }) {
      $('end-kicker').textContent = kicker;
      $('end-title').textContent = title;
      $('end-copy').textContent = copy;
      $('btn-end-retry').hidden = !retry;
      show(endcard);
    },
    hideEnd() {
      endcard.hidden = true;
    },
    shotBriefing({ left = true } = {}) {
      briefing.classList.toggle('shot-briefing', left);
      show(briefing);
    },
    pauseVisible() {
      return !pause.hidden;
    },
    briefingVisible() {
      return !briefing.hidden;
    },
    anyOpen() {
      return overlays.some((overlay) => !overlay.hidden);
    },
  };
}
