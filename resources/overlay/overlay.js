const ring = document.getElementById('ring');
const ghost = document.getElementById('ghost');
const caption = document.getElementById('caption');
const ACTION_WORDS = {
  click: 'Click', double_click: 'Double-click', right_click: 'Right-click', type: 'Type',
  keyboard: 'Keyboard', scroll: 'Scroll', drag: 'Drag', look: 'Look',
};
let fadeTimer = null;

function clear() {
  clearTimeout(fadeTimer);
  for (const el of [ring, ghost, caption]) el.classList.remove('on', 'tap', 'fade', 'centre');
}

function placeCaption(target) {
  const pad = 18;
  const { innerWidth: W, innerHeight: H } = window;
  const box = caption.getBoundingClientRect();
  let left = target.x + target.width + pad;
  let top = target.y + target.height / 2 - box.height / 2;
  if (left + box.width > W - pad) left = target.x - box.width - pad;          // try the left side
  if (left < pad) {                                                             // otherwise below / above
    left = Math.min(Math.max(pad, target.x), W - box.width - pad);
    top = target.y + target.height + pad;
    if (top + box.height > H - pad) top = target.y - box.height - pad;
  }
  caption.style.left = `${left}px`;
  caption.style.top = `${Math.min(Math.max(pad, top), H - box.height - pad)}px`;
}

function show({ target, from, instruction, label, action, position, done }) {
  clear();
  caption.querySelector('.meta').textContent = done ? 'All done' : `Step ${position} · ${ACTION_WORDS[action] || 'Click'}`;
  const text = caption.querySelector('.text');
  text.textContent = instruction;
  if (label && !done) {
    const span = document.createElement('div');
    span.className = 'label';
    span.textContent = `→ ${label}`;
    text.appendChild(span);
  }

  if (!target) {
    caption.classList.add('centre', 'on');
    fadeTimer = setTimeout(() => caption.classList.add('fade'), done ? 4000 : 20000);
    return;
  }

  const ringPad = 6;
  Object.assign(ring.style, {
    left: `${target.x - ringPad}px`, top: `${target.y - ringPad}px`,
    width: `${target.width + ringPad * 2}px`, height: `${target.height + ringPad * 2}px`,
  });

  // Ghost cursor starts where the real mouse is, then glides to the target centre.
  ghost.style.transition = 'none';
  ghost.style.transform = `translate(${from.x}px, ${from.y}px)`;
  void ghost.getBoundingClientRect();
  ghost.style.transition = '';
  requestAnimationFrame(() => {
    ghost.classList.add('on', 'tap');
    ghost.style.transform = `translate(${target.x + target.width / 2 - 6}px, ${target.y + target.height / 2 - 4}px)`;
    ring.classList.add('on');
    caption.classList.add('on');
    placeCaption(target);
  });

  fadeTimer = setTimeout(() => [ring, ghost].forEach((el) => el.classList.add('fade')), 25000);
}

window.overlay.onShow(show);
window.overlay.onClear(clear);
