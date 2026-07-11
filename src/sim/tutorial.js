// Guided onboarding tutorial (ADR 29): a sequence of hands-on steps that
// walks a new player through the core loop — camera, grid, first solar +
// battery, first bus line, first fares — each completed by DOING the thing
// (detected from live game state, quest-style), never by gating the sandbox.
// Pure logic — the card UI and element highlighting live in src/ui/tutorial.js.
// `highlight`/`flags` keys are semantic ids the UI maps to DOM selectors.
import { G, emit } from './state.js';

const busStops = () => G.stations.filter(s => s.stype === 'bus').length;
const routesWithStops = () => G.routes.filter(r => r.stops.length >= 2).length;
const paxCarried = () => G.stats.paxLocal + G.stats.paxInter;
const solarFarms = () => G.plants.filter(p => p.type === 'solar').length;

// baselines let every check count only what the player builds AFTER the
// tutorial starts (the starter grid already contains solar and batteries)
function baseline() {
  return {
    solar: solarFarms(), batteryCap: G.batteryCapMWh, busStops: busStops(),
    routes2: routesWithStops(), vehicles: G.vehicles.length, pax: paxCarried(),
  };
}

export const TUTORIAL_STEPS = [
  {
    id: 'look', title: '🧭 Take the controls', reward: 5000,
    text: 'Welcome, Director! This region runs on 100% renewable power — and YOU own both the grid and the transport company. First, get a feel for your land: 8 cities, farms, mines and a river.',
    task: 'Move the camera — hold the RIGHT mouse button and drag (or use WASD). Zoom with the mouse wheel.',
    check: t => !!t.flags.cameraMoved,
  },
  {
    id: 'dashboard', title: '📊 Meet your grid', reward: 5000, highlight: 'tab:dashboard',
    text: 'The ⚡ number in the top bar is your grid right now: supply / demand in MW. Your inherited solar, wind and hydro plants are already selling every served MWh to the cities — that\'s income around the clock.',
    task: 'Open the 📊 Dashboard tab on the right edge and take a look at the live power chart.',
    check: t => !!t.flags['tab:dashboard'],
  },
  {
    id: 'solar', title: '☀️ Build a solar farm', reward: 10000, highlight: 'tool:solar',
    text: 'Cities grow and industries are hungry — your grid must grow too. Solar is the cheapest electricity in history… but it follows the sun: full power at noon, nothing at night.',
    task: 'Pick ☀️ Solar Farm from the toolbar (bottom) and place it on open grass.',
    check: t => solarFarms() > t.base.solar,
  },
  {
    id: 'battery', title: '🔋 Bank the sunshine', reward: 10000, highlight: 'tool:battery',
    text: 'Here\'s the catch: demand peaks in the EVENING, right when solar fades. A grid battery soaks up the noon surplus and sells it back at the peak — the daily heartbeat of every renewable grid.',
    task: 'Build a 🔋 Battery Storage anywhere on open ground.',
    check: t => G.batteryCapMWh > t.base.batteryCap,
  },
  {
    id: 'stops', title: '🚏 Open for passengers', reward: 5000, highlight: 'tool:busStop',
    where: () => G.cities.slice(0, 1).map(c => ({ i: c.ci, j: c.cj, name: c.name })),
    text: 'Now for the transport business: people in every city are waiting for a ride across town. A bus stop picks up everyone within 7 tiles.',
    task: 'Build TWO 🚏 Bus Stops in the SAME city, a few blocks apart — each next to a road. 📍 flies you to a city.',
    check: t => busStops() >= t.base.busStops + 2,
  },
  {
    id: 'route', title: '🗺 Draw the line', reward: 5000, highlight: 'tab:routes',
    text: 'Stops don\'t help until a line connects them. Routes are your timetable: vehicles loop along their stops forever, earning a fare for every delivered passenger.',
    task: 'Open the 🚌 Routes tab → "+ New Route" → click BOTH your bus stops on the map → ✔ Done.',
    check: t => routesWithStops() > t.base.routes2,
  },
  {
    id: 'bus', title: '🚌 Roll out the fleet', reward: 5000, highlight: 'tab:routes',
    text: 'Time to put wheels on the line. Your e-bus charges its 400 kWh pack at the stops — from YOUR grid. Transport and energy are one business here.',
    task: 'Buy an 🚌 E-Bus on your new route (Routes tab, "+ 🚌" button on the route card).',
    check: t => G.vehicles.length > t.base.vehicles,
  },
  {
    id: 'pax', title: '🧍 First riders', reward: 15000, highlight: 'speeds',
    text: 'Your bus is rolling! Watch it pick people up — every delivered passenger pays a fare, and happy, well-connected cities GROW: more people, more riders, more power sold.',
    task: 'Carry 5 passengers. Tip: fast-forward time with ▶▶▶ in the top bar (or key 3).',
    check: t => paxCarried() >= t.base.pax + 5,
  },
  {
    id: 'objectives', title: '🎯 Your road ahead', reward: 5000, highlight: 'quests',
    text: 'You know the controls — now build an empire. The Objectives panel is your career ladder: freight chains, an electric railway, hydrogen storage… each pays a big cash reward. The 💡 advisor and the 📚 Learn tab explain the energy science as it happens.',
    task: 'Click an objective in the 🎯 panel (top left) to read what\'s next.',
    check: t => !!t.flags.questOpened,
  },
];
export const TUTORIAL_BONUS = 25000;

export function initTutorialState() {
  // absent on fresh state; restore() fills it for loaded saves
  G.tutorial = G.tutorial || { active: false, done: false, step: 0, flags: {}, base: null };
}

export function startTutorial() {
  initTutorialState();
  Object.assign(G.tutorial, { active: true, done: false, step: 0, flags: {}, base: baseline() });
  emit('tutorialStep', 0);
}

// silent — the caller decides whether to announce anything
export function skipTutorial() {
  initTutorialState();
  Object.assign(G.tutorial, { active: false, done: true });
  emit('tutorialDone', { skipped: true });
}

// UI layers report things the sim can't see (camera moved, tab opened, …)
export function notifyTutorial(flag) {
  if (G.tutorial && G.tutorial.active) G.tutorial.flags[flag] = true;
}

// poll the current step (UI calls it ~2×/s, like checkQuests). Advances at
// most one step per call so a player who rushed ahead gets a visible cascade.
export function checkTutorial() {
  const t = G.tutorial;
  if (!t || !t.active) return;
  const s = TUTORIAL_STEPS[t.step];
  if (!s || !s.check(t)) return;
  G.money += s.reward;
  t.step++;
  if (t.step >= TUTORIAL_STEPS.length) {
    t.active = false;
    t.done = true;
    G.money += TUTORIAL_BONUS;
    emit('toast', {
      title: '🎓🎉 Tutorial complete — you\'re in charge now!',
      text: `Graduation bonus €${TUTORIAL_BONUS.toLocaleString()}. Follow the 🎯 Objectives, listen to the 💡 advisor, and grow the cleanest grid on the map. Good luck, Director!`,
    });
    emit('tutorialDone', {});
  } else {
    const next = TUTORIAL_STEPS[t.step];
    emit('toast', {
      title: `✅ ${s.title} — done!`,
      text: `Reward €${s.reward.toLocaleString()}. Next up: ${next.title}`,
    });
    emit('tutorialStep', t.step);
  }
}
