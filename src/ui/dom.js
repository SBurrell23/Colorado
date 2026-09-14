// Small DOM helpers plus the toast and modal plumbing shared by every screen.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  // Firefox ignores -webkit-user-drag, and a dragged image leaves the browser's
  // own drop badge stuck to the cursor.
  if (tag === 'img') node.draggable = false;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function show(node, on = true) {
  node.classList.toggle('hidden', !on);
}

// --- toasts ---------------------------------------------------------------
let toastRoot = null;
export function toast(text, kind = '', ms = 2600) {
  if (!toastRoot) toastRoot = $('#toasts');
  if (!toastRoot) return;
  const t = el('div', { class: 'toast ' + kind, text });
  toastRoot.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 320);
  }, ms);
}

// --- banner ---------------------------------------------------------------
export function banner(text, dark = false, ms = 2600) {
  const b = $('#banner');
  if (!b) return;
  b.textContent = text;
  b.className = 'banner' + (dark ? ' dark' : '');
  // Restart the entry animation even if the banner is already showing.
  b.style.animation = 'none';
  void b.offsetWidth;
  b.style.animation = '';
  clearTimeout(b._timer);
  b._timer = setTimeout(() => b.classList.add('hidden'), ms);
}

/** Pull a banner early -- e.g. "Your move" once the turn has moved on. */
export function clearBanner() {
  const b = $('#banner');
  if (!b) return;
  clearTimeout(b._timer);
  b.classList.add('hidden');
}

// --- modal ----------------------------------------------------------------
const modal = {
  root: null,
  onClose: null,
};

function ensureModal() {
  if (modal.root) return;
  modal.root = $('#modal-root');
  $('#modal-close').addEventListener('click', () => closeModal());
  modal.root.querySelector('.modal-backdrop').addEventListener('click', () => {
    if (modal.dismissable) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.open && modal.dismissable) closeModal();
  });
}

export function openModal({ title, body, actions = [], dismissable = true, onClose = null, wide = false }) {
  ensureModal();
  modal.root.querySelector('.modal').classList.toggle('wide', !!wide);
  modal.dismissable = dismissable;
  modal.onClose = onClose;
  $('#modal-title').textContent = title || '';
  const bodyNode = clear($('#modal-body'));
  if (typeof body === 'string') bodyNode.innerHTML = body;
  else if (body) bodyNode.appendChild(body);

  const act = clear($('#modal-actions'));
  for (const a of actions) {
    act.appendChild(el('button', {
      class: a.primary ? 'big-btn primary' : 'ghost-btn',
      text: a.label,
      onclick: () => {
        if (a.onClick) a.onClick();
        if (a.close !== false) closeModal();
      },
    }));
  }
  // A sheet you only ever read needs no footer; the corner cross is enough.
  show(act, actions.length > 0);
  show($('#modal-close'), dismissable);
  modal.root.classList.remove('hidden');
  modal.open = true;
}

export function closeModal() {
  if (!modal.root) return;
  modal.root.classList.add('hidden');
  modal.open = false;
  if (modal.onClose) {
    const fn = modal.onClose;
    modal.onClose = null;
    fn();
  }
}

export function isModalOpen() {
  return !!modal.open;
}

export function setScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  show($('#hud'), name === 'game');
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// --- tooltips --------------------------------------------------------------
// A single themed bubble shared by every [data-tip] element, so the browser's
// own slow, unstyled title popup is never needed.
let tipNode = null;
let tipTarget = null;
let tipAt = null;   // set when the tooltip follows a point instead of an element

function placeTip() {
  if (!tipNode) return;
  if (tipAt) {
    const t = tipNode.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - t.width - 8, tipAt.x + 16));
    let top = tipAt.y + 20;
    if (top + t.height > window.innerHeight - 8) top = Math.max(8, tipAt.y - t.height - 14);
    tipNode.style.left = Math.round(left) + 'px';
    tipNode.style.top = Math.round(top) + 'px';
    tipNode.classList.remove('above');
    tipNode.style.setProperty('--tip-arrow', '-20px');
    return;
  }
  if (!tipTarget) return;
  const r = tipTarget.getBoundingClientRect();
  const t = tipNode.getBoundingClientRect();
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(8, Math.min(window.innerWidth - t.width - 8, left));
  let top = r.bottom + 9;
  let below = true;
  if (top + t.height > window.innerHeight - 8) {
    top = r.top - t.height - 9;
    below = false;
  }
  tipNode.style.left = Math.round(left) + 'px';
  tipNode.style.top = Math.round(top) + 'px';
  tipNode.classList.toggle('above', !below);
  tipNode.style.setProperty('--tip-arrow', Math.round(r.left + r.width / 2 - left) + 'px');
}

function fillTip(text, title, body) {
  clear(tipNode);
  if (title) tipNode.appendChild(el('strong', { text: title }));
  if (text) tipNode.appendChild(el('span', { text }));
  if (body) tipNode.appendChild(body);
  tipNode.classList.toggle('rich', !!body);
}

/**
 * @param body optional element shown under the text -- a diagram, say.
 */
export function showTip(target, text, title, body) {
  if (!tipNode) tipNode = $('#tooltip');
  if (!tipNode || (!text && !body)) return;
  tipTarget = target;
  tipAt = null;
  fillTip(text, title, body);
  tipNode.classList.remove('hidden', 'at-point');
  placeTip();
}

/** A tooltip pinned to a point rather than an element -- for the 3-D board. */
export function showTipAt(x, y, text, title, body) {
  if (!tipNode) tipNode = $('#tooltip');
  if (!tipNode || (!text && !body)) return;
  tipTarget = null;
  tipAt = { x, y };
  fillTip(text, title, body);
  tipNode.classList.remove('hidden');
  tipNode.classList.add('at-point');
  placeTip();
}

export function hideTip() {
  if (!tipNode) return;
  tipNode.classList.add('hidden');
  tipTarget = null;
  tipAt = null;
}

/** Slide a point-anchored tooltip along with the cursor, content untouched. */
export function moveTipTo(x, y) {
  if (!tipNode || !tipAt || tipNode.classList.contains('hidden')) return;
  tipAt = { x, y };
  placeTip();
}

// Elements whose tooltip carries a diagram register a builder here; it is
// called on hover so the drawing is only done once somebody looks.
const tipBodies = new WeakMap();
export function setTipBody(element, build) {
  tipBodies.set(element, (() => {
    let made = null;
    return () => (made || (made = build()));
  })());
}

export function initTooltips() {
  tipNode = $('#tooltip');
  const over = (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) {
      if (tipTarget) hideTip();
      return;
    }
    if (t === tipTarget) return;
    showTip(t, t.dataset.tip, t.dataset.tipTitle, tipBodies.get(t) ? tipBodies.get(t)() : null);
  };
  document.addEventListener('pointermove', over);
  document.addEventListener('pointerdown', () => hideTip());
  window.addEventListener('scroll', () => hideTip(), true);
  window.addEventListener('blur', () => hideTip());
}
