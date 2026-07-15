// Tutorial card (top left, above the objectives) + pulsing highlight on the
// UI element each step points at. Step definitions and completion logic live
// in src/sim/tutorial.js — this file only renders state and reports what the
// sim can't see (camera movement) via notifyTutorial().
import { G, on, emit } from '../sim/state.js';
import {
  TUTORIAL_STEPS, initTutorialState, checkTutorial, skipTutorial, notifyTutorial,
} from '../sim/tutorial.js';
import { camera } from '../render/scene.js';

const $ = id => document.getElementById(id);

// semantic highlight keys (sim data) → DOM selectors (UI concern)
const HIGHLIGHT = {
  'tab:dashboard': '#tabbtns button[data-tab="dashboard"]',
  'tab:routes': '#tabbtns button[data-tab="routes"]',
  'tool:solar': '.tool[data-tool="solar"]',
  'tool:battery': '.tool[data-tool="battery"]',
  'tool:busStop': '.tool[data-tool="busStop"]',
  speeds: '#speeds',
  quests: '#quests',
};

export function initTutorialPanel() {
  initTutorialState();
  on('tutorialStep', renderTutorial);
  on('tutorialDone', renderTutorial);
  renderTutorial();
}

let tickTimer = 0, camPrev = null, camDist = 0;
export function updateTutorialPanel(dt) {
  const t = G.tutorial;
  if (!t || !t.active) return;
  // camera-move detection for the 'look' step: accumulate real movement so a
  // stray frame of damping can't complete it
  if (TUTORIAL_STEPS[t.step]?.id === 'look' && camera) {
    if (camPrev) camDist += camPrev.distanceTo(camera.position);
    camPrev = camera.position.clone();
    if (camDist > 40) notifyTutorial('cameraMoved');
  }
  tickTimer += dt;
  if (tickTimer < 0.5) return;
  tickTimer = 0;
  checkTutorial();
}

function setHighlight(key) {
  document.querySelectorAll('.tut-glow').forEach(el => el.classList.remove('tut-glow'));
  const sel = HIGHLIGHT[key];
  if (sel) document.querySelectorAll(sel).forEach(el => el.classList.add('tut-glow'));
}

function renderTutorial() {
  const el = $('tutorial'), t = G.tutorial;
  if (!t || !t.active) { el.style.display = 'none'; setHighlight(null); return; }
  const s = TUTORIAL_STEPS[t.step];
  el.style.display = 'block';
  setHighlight(s.highlight);
  const jump = s.where && s.where().length
    ? `<button class="quest-jump" id="tut-jump" title="Fly to the destination">📍</button>` : '';
  // step titles are authored as "<emoji> <text>" — split it into the WP6 icon
  // chip + plain title, same look as the WP5 route-card icon/reward tokens
  // (.icon-chip / .stat-badge / .meter, styles.css); no change to the data.
  const [icon, ...rest] = s.title.split(' ');
  el.innerHTML = `
    <div id="tut-head"><span class="icon-chip">${icon}</span> 🎓 Tutorial <span class="dim small">step ${t.step + 1} / ${TUTORIAL_STEPS.length}</span>
      <span class="tut-spacer"></span><span id="tut-skip" class="dim small" title="End the tutorial">skip ✕</span></div>
    <div class="meter"><i style="width:${(t.step / TUTORIAL_STEPS.length * 100).toFixed(0)}%"></i></div>
    <div class="tut-title">${rest.join(' ')}</div>
    <div class="small">${s.text}</div>
    <div class="tut-task">👉 ${s.task} ${jump}</div>
    <div class="tut-reward small">Reward: <span class="stat-badge pos">€${s.reward.toLocaleString()}</span>
      · finish all steps for a <span class="stat-badge pos">€25,000</span> graduation bonus</div>`;
  $('tut-skip').onclick = () => {
    if (confirm('End the tutorial? (You can always learn from the 💡 advisor and 📚 Learn tab.)')) skipTutorial();
  };
  const jb = $('tut-jump');
  if (jb) jb.onclick = () => {
    const targets = s.where();
    if (targets.length) emit('flyTo', targets[0]);
  };
}
