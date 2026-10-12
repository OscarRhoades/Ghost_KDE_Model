import { buildCrane } from './crane/steps';
import { stepDuration } from './engine/model';
import { renderCreasePattern } from './view/cp';
import { PaperView } from './view/scene';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const steps = buildCrane();
const view = new PaperView($('viewport'));

const ui = {
  counter: $('counter'),
  title: $('title'),
  text: $('text'),
  list: $('steps'),
  cp: document.getElementById('cp') as unknown as SVGSVGElement,
  play: $<HTMLButtonElement>('play'),
  prev: $<HTMLButtonElement>('prev'),
  next: $<HTMLButtonElement>('next'),
  scrub: $<HTMLInputElement>('scrub'),
  speed: $<HTMLSelectElement>('speed'),
};

const state = { index: 0, t: 0, playing: false, speed: 1 };

const items = steps.map((st, i) => {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.innerHTML = `<span class="n">${i}</span><span></span>`;
  (b.lastChild as HTMLElement).textContent = st.title;
  b.addEventListener('click', () => go(i, true));
  li.appendChild(b);
  ui.list.appendChild(li);
  return li;
});

function go(i: number, autoplay: boolean) {
  state.index = Math.max(0, Math.min(steps.length - 1, i));
  const st = steps[state.index];
  state.t = 0;
  state.playing = autoplay && st.phases.length > 0;
  view.setStep(st);
  ui.counter.textContent = state.index === 0 ? 'Getting started' : `Step ${state.index} of ${steps.length - 1}`;
  ui.title.textContent = st.title;
  ui.text.textContent = st.text;
  renderCreasePattern(ui.cp, st);
  items.forEach((li, k) => {
    li.classList.toggle('current', k === state.index);
    li.classList.toggle('done', k < state.index);
  });
  revealInList(items[state.index]);
  ui.prev.disabled = state.index === 0;
  ui.next.disabled = state.index === steps.length - 1;
  try {
    history.replaceState(null, '', `#${state.index}`);
  } catch {
    /* sandboxed */
  }
  sync();
}

/** Keep the current step visible inside the list without scrolling the page. */
function revealInList(li: HTMLElement) {
  const list = ui.list;
  if (list.scrollHeight <= list.clientHeight + 1) return;
  const top = li.offsetTop - list.offsetTop;
  if (top < list.scrollTop) list.scrollTop = top - 8;
  else if (top + li.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + li.offsetHeight - list.clientHeight + 8;
}

function sync() {
  const st = steps[state.index];
  const done = state.t >= 1 || st.phases.length === 0;
  ui.play.dataset.state = state.playing ? 'playing' : done && st.phases.length ? 'done' : 'paused';
  ui.play.setAttribute('aria-label', state.playing ? 'Pause' : done ? 'Replay step' : 'Play');
  ui.play.disabled = st.phases.length === 0;
  ui.scrub.disabled = st.phases.length === 0;
  ui.scrub.value = String(Math.round((st.phases.length ? state.t : 1) * 1000));
}

function togglePlay() {
  const st = steps[state.index];
  if (!st.phases.length) return go(state.index + 1, true);
  if (state.playing) state.playing = false;
  else {
    if (state.t >= 1) state.t = 0;
    state.playing = true;
  }
  sync();
}

ui.play.addEventListener('click', togglePlay);
ui.prev.addEventListener('click', () => go(state.index - 1, false));
ui.next.addEventListener('click', () => go(state.index + 1, true));
ui.scrub.addEventListener('input', () => {
  state.t = Number(ui.scrub.value) / 1000;
  state.playing = false;
  sync();
});
ui.speed.addEventListener('change', () => (state.speed = Number(ui.speed.value)));
$('reset-view').addEventListener('click', () => view.resetView());
const bindOpt = (id: string, key: 'arrows' | 'foldLines' | 'creaseLines') =>
  $<HTMLInputElement>(id).addEventListener('change', (e) => (view.opts[key] = (e.target as HTMLInputElement).checked));
bindOpt('opt-arrows', 'arrows');
bindOpt('opt-lines', 'foldLines');
bindOpt('opt-creases', 'creaseLines');

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
  if (tag === 'SELECT') return;
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    go(state.index + 1, true);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    go(state.index - 1, false);
  } else if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  }
});

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const st = steps[state.index];
  if (state.playing) {
    const dur = stepDuration(st);
    state.t = dur > 0 ? state.t + (dt * state.speed) / dur : 1;
    if (state.t >= 1) {
      state.t = 1;
      state.playing = false;
    }
    sync();
  }
  view.update(state.t, state.playing);
  view.render();
  requestAnimationFrame(frame);
}

const fromHash = Number(location.hash.slice(1));
go(Number.isFinite(fromHash) ? fromHash : 0, false);
// Deep-linked steps open at their finished state.
if (state.index > 0) {
  state.t = 1;
  sync();
}
requestAnimationFrame(frame);

// Handy for debugging and automated screenshots.
Object.assign(window, { origami: { steps, view, state, go, sync } });
