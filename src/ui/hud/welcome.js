// ---------- welcome screen ----------
import { G } from '../../sim/state.js';
import { clearSave } from '../../sim/save.js';
import { startTutorial, skipTutorial } from '../../sim/tutorial.js';
import { showTip } from './toasts.js';
import { registerModal } from './modal.js';

// stylised scene: sun→solar, wind, hydro, storage feeding a city + e-transport
const WELCOME_SVG = `
<svg viewBox="0 0 640 240" xmlns="http://www.w3.org/2000/svg" style="width:100%;border-radius:10px;display:block">
  <defs>
    <linearGradient id="wsky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b3a5c"/><stop offset="0.55" stop-color="#3a7ca8"/><stop offset="1" stop-color="#8ec9e8"/>
    </linearGradient>
    <linearGradient id="wgrass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6fae5c"/><stop offset="1" stop-color="#4a7d3e"/>
    </linearGradient>
  </defs>
  <rect width="640" height="240" fill="url(#wsky)"/>
  <circle cx="80" cy="56" r="26" fill="#ffd95e"/>
  <g stroke="#ffd95e" stroke-width="3" opacity="0.8">
    <line x1="80" y1="14" x2="80" y2="26"/><line x1="80" y1="86" x2="80" y2="98"/>
    <line x1="38" y1="56" x2="50" y2="56"/><line x1="110" y1="56" x2="122" y2="56"/>
    <line x1="50" y1="26" x2="59" y2="35"/><line x1="101" y1="77" x2="110" y2="86"/>
    <line x1="50" y1="86" x2="59" y2="77"/><line x1="101" y1="35" x2="110" y2="26"/>
  </g>
  <rect y="170" width="640" height="70" fill="url(#wgrass)"/>
  <!-- city skyline -->
  <g>
    <rect x="468" y="92" width="34" height="80" fill="#5a6b7d"/>
    <rect x="508" y="72" width="40" height="100" fill="#48586a"/>
    <rect x="554" y="104" width="30" height="68" fill="#62758a"/>
    <rect x="590" y="86" width="36" height="86" fill="#52647a"/>
    <g fill="#ffd97a">
      <rect x="514" y="80" width="7" height="8"/><rect x="528" y="80" width="7" height="8"/>
      <rect x="514" y="96" width="7" height="8"/><rect x="528" y="112" width="7" height="8"/>
      <rect x="474" y="100" width="6" height="7"/><rect x="486" y="116" width="6" height="7"/>
      <rect x="596" y="94" width="7" height="8"/><rect x="610" y="110" width="7" height="8"/>
      <rect x="560" y="112" width="6" height="7"/><rect x="572" y="128" width="6" height="7"/>
    </g>
  </g>
  <!-- wind turbines -->
  <g stroke="#eef2f5" stroke-width="5" stroke-linecap="round">
    <line x1="180" y1="170" x2="180" y2="84"/><line x1="252" y1="170" x2="252" y2="104"/>
  </g>
  <g fill="#f4f7f9">
    <g transform="translate(180,84)"><path d="M0 0 L8 -52 L-8 -52 Z"/><path d="M0 0 L8 -52 L-8 -52 Z" transform="rotate(120)"/><path d="M0 0 L8 -52 L-8 -52 Z" transform="rotate(240)"/><circle r="6" fill="#dfe5ea"/></g>
    <g transform="translate(252,104) rotate(40)"><path d="M0 0 L6 -40 L-6 -40 Z"/><path d="M0 0 L6 -40 L-6 -40 Z" transform="rotate(120)"/><path d="M0 0 L6 -40 L-6 -40 Z" transform="rotate(240)"/><circle r="5" fill="#dfe5ea"/></g>
  </g>
  <!-- solar farm -->
  <g transform="translate(50,150)">
    <g transform="skewX(-18)">
      <rect x="0" y="0" width="54" height="22" rx="2" fill="#16335f" stroke="#c3cad2" stroke-width="2"/>
      <line x1="18" y1="0" x2="18" y2="22" stroke="#3b6db0" stroke-width="1.5"/>
      <line x1="36" y1="0" x2="36" y2="22" stroke="#3b6db0" stroke-width="1.5"/>
    </g>
    <g transform="translate(64,0) skewX(-18)">
      <rect x="0" y="0" width="54" height="22" rx="2" fill="#16335f" stroke="#c3cad2" stroke-width="2"/>
      <line x1="18" y1="0" x2="18" y2="22" stroke="#3b6db0" stroke-width="1.5"/>
      <line x1="36" y1="0" x2="36" y2="22" stroke="#3b6db0" stroke-width="1.5"/>
    </g>
  </g>
  <!-- battery -->
  <g transform="translate(300,142)">
    <rect width="46" height="28" rx="4" fill="#dfe5ea"/><rect x="46" y="9" width="5" height="10" rx="2" fill="#dfe5ea"/>
    <rect x="4" y="4" width="24" height="20" rx="2" fill="#7ed87e"/>
    <text x="14" y="19" font-size="14" font-weight="700" fill="#19405c">⚡</text>
  </g>
  <!-- power line: plants → city -->
  <path d="M 130 160 C 220 120 360 120 470 140" fill="none" stroke="#ffd95e" stroke-width="3" stroke-dasharray="7 6" opacity="0.9"/>
  <!-- road + e-bus & truck -->
  <rect y="196" width="640" height="26" fill="#3c4043"/>
  <g stroke="#e8edf2" stroke-width="2" stroke-dasharray="14 12"><line x1="0" y1="209" x2="640" y2="209"/></g>
  <g transform="translate(360,184)">
    <rect width="64" height="24" rx="5" fill="#2a78c2"/><rect x="6" y="5" width="52" height="9" rx="2" fill="#bfe3ff"/>
    <circle cx="14" cy="26" r="6" fill="#16191c"/><circle cx="50" cy="26" r="6" fill="#16191c"/>
  </g>
  <g transform="translate(120,186)">
    <rect width="26" height="20" rx="3" fill="#2e7d4f"/><rect x="28" y="2" width="38" height="18" rx="2" fill="#e8e4da"/>
    <circle cx="12" cy="22" r="5.5" fill="#16191c"/><circle cx="36" cy="22" r="5.5" fill="#16191c"/><circle cx="56" cy="22" r="5.5" fill="#16191c"/>
  </g>
  <!-- rail + train -->
  <rect y="228" width="640" height="4" fill="#6e6a62"/>
  <g transform="translate(470,206)">
    <rect width="90" height="20" rx="5" fill="#c8453c"/><rect x="8" y="4" width="74" height="7" rx="2" fill="#18242f"/>
    <line x1="20" y1="0" x2="26" y2="-10" stroke="#3a4046" stroke-width="2"/>
    <circle cx="16" cy="22" r="5" fill="#16191c"/><circle cx="40" cy="22" r="5" fill="#16191c"/><circle cx="74" cy="22" r="5" fill="#16191c"/>
  </g>
</svg>`;

export function showWelcome(hasSaveFlag) {
  const el = document.createElement('div');
  el.id = 'welcome';
  el.className = 'modal-overlay';
  el.innerHTML = `<div id="welcome-card" class="modal-card">
    ${WELCOME_SVG}
    <h1>🌍 Transport Eco Tycoon</h1>
    <p class="wlead">You run this region's <b>transport company</b> — and its <b>100% renewable power grid</b>.</p>
    <div class="wgrid">
      <div>☀️🌬💧 <b>Generate</b> clean power with solar, wind & hydro — and sell every MWh to cities and industry.</div>
      <div>🔋🫧 <b>Store</b> the surplus: batteries for the evening, hydrogen for dark, windless weeks.</div>
      <div>🚌🚚🚆 <b>Move</b> people & goods with e-buses, e-trucks and electric trains — they all run on your grid.</div>
      <div>🎯 <b>Grow</b>: follow the Objectives, research better tech and keep your cities happy.</div>
    </div>
    <p class="wcontrols dim">🖱 Right-drag: move map · Middle-drag: rotate · Wheel: zoom · WASD: pan · V: passenger demand · Space: pause</p>
    <div class="wbtns">
      ${hasSaveFlag
        ? '<button id="w-continue" class="wprimary">▶ Continue game</button><button id="w-new">↺ Start new game</button>'
        : '<button id="w-tutorial" class="wprimary">🎓 Start the tutorial <span class="wsub">recommended · ~5 min · pays €90k</span></button><button id="w-start">▶ Free play <span class="wsub">I know tycoon games</span></button>'}
    </div>
  </div>`;
  document.body.appendChild(el);
  // the modal stack owns pause + speed restore (D-B): closing restores the
  // prior speed (not a hardcoded 1×), and suppresses keybinds while shown.
  let withTutorial = false;
  const close = registerModal(el, {
    pause: true,
    onClose: () => {
      if (hasSaveFlag) return;
      if (withTutorial) startTutorial();
      else { skipTutorial(); showTip('welcome'); }
    },
  });
  const start = wt => { withTutorial = wt; close(); };
  const bs = el.querySelector('#w-start'), bt = el.querySelector('#w-tutorial'),
    bc = el.querySelector('#w-continue'), bn = el.querySelector('#w-new');
  if (bs) bs.onclick = () => start(false);
  if (bt) bt.onclick = () => start(true);
  if (bc) bc.onclick = () => start(false);
  if (bn) bn.onclick = () => {
    if (!confirm('Delete the saved game and start over?')) return;
    clearSave();
    location.reload();
  };
}
