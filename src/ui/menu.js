// Title screen and trailhead lobby.

import { $, el, clear, show, setScreen, toast } from './dom.js';
import { chatLine, openHelp } from './hud.js';
import { normaliseCode } from '../net/net.js';
import { turnsForPlayers } from '../game/tiles.js';

const NAME_KEY = 'colorado.name';

export function savedName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch (err) { return ''; }
}
export function saveName(n) {
  try { localStorage.setItem(NAME_KEY, n); } catch (err) { /* ignore */ }
}

const LOBBY_OPTIONS = [
  {
    key: 'turnsEach',
    label: 'Turns each',
    hint: 'Automatic gives everyone as many turns as the stack will stretch to — twenty for up '
      + 'to four rangers, fewer for a bigger party.',
    type: 'select',
    options: [[0, 'Automatic'], [12, '12'], [14, '14'], [16, '16'], [18, '18'], [20, '20 (standard)']],
  },
  {
    key: 'turnSeconds',
    label: 'Turn timer',
    hint: 'When time runs out a turn is taken for you.',
    type: 'select',
    options: [[0, 'Untimed'], [30, '30 seconds'], [45, '45 seconds'], [60, '60 seconds'],
      [90, '90 seconds'], [120, '2 minutes']],
  },
  {
    key: 'botSkill',
    label: 'Ranger skill',
    hint: 'How carefully the computer-controlled rangers weigh up a move.',
    type: 'select',
    parse: String,
    options: [['novice', 'Novice'], ['ranger', 'Ranger'], ['naturalist', 'Naturalist']],
  },
  {
    key: 'cullThree',
    label: 'Clear three matching for free',
    hint: 'The standard rule. Turn it off and clearing always costs a nature token.',
    type: 'toggle',
  },
];

export class Menu {
  constructor(handlers) {
    this.h = handlers;
    this.view = null;
    this.lastChatLen = -1;
    this.bind();
  }

  bind() {
    const nameInput = $('#name-input');
    nameInput.value = savedName();
    nameInput.addEventListener('change', () => saveName(nameInput.value.trim()));

    const codeInput = $('#code-input');
    codeInput.addEventListener('input', () => { codeInput.value = normaliseCode(codeInput.value); });
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.tryJoin(); });

    $('#btn-host').addEventListener('click', () => this.h.onHost(this.playerName()));
    $('#btn-join').addEventListener('click', () => this.tryJoin());
    $('#btn-title-settings').addEventListener('click', () => this.h.onOpenSettings());
    $('#btn-title-help').addEventListener('click', () => openHelp());
    $('#btn-start').addEventListener('click', () => this.h.onStart());
    $('#btn-lobby-leave').addEventListener('click', () => this.h.onLeave());
    // The same two doors as the title screen -- people want to set their
    // volume and reread the rules while they are waiting for the last seat.
    $('#btn-lobby-settings').addEventListener('click', () => this.h.onOpenSettings());
    $('#btn-lobby-help').addEventListener('click', () => openHelp());
    $('#btn-copy-code').addEventListener('click', () => this.copyCode());
    $('#btn-copy-link').addEventListener('click', () => this.copyLink());

    $('#lobby-chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#lobby-chat-input');
      const text = input.value.trim();
      if (text) this.h.onChat(text);
      input.value = '';
    });

    const params = new URLSearchParams(location.search);
    const room = normaliseCode(params.get('game') || params.get('room') || '');
    if (room) {
      codeInput.value = room;
      this.setStatus('Game ' + room + ' is waiting — put in a name and join.');
    }
  }

  playerName() {
    const name = ($('#name-input').value.trim()) || 'Ranger';
    saveName(name);
    return name;
  }

  tryJoin() {
    const code = normaliseCode($('#code-input').value);
    if (code.length < 4) { this.setStatus('Codes are four letters.', true); return; }
    this.h.onJoin(code, this.playerName());
  }

  setStatus(text, isError = false) {
    const s = $('#title-status');
    s.textContent = text || '';
    s.classList.toggle('error', !!isError);
  }

  setLobbyStatus(text, isError = false) {
    const s = $('#lobby-status');
    s.textContent = text || '';
    s.classList.toggle('error', !!isError);
  }

  setBusy(busy, label) {
    $('#btn-host').disabled = busy;
    $('#btn-join').disabled = busy;
    if (busy && label) this.setStatus(label);
  }

  /** Just the code, for reading out loud or pasting into the join box. */
  copyCode() {
    const code = this.view && this.view.code;
    if (!code) return;
    this.copy(code, 'Code ' + code + ' copied.');
  }

  copyLink() {
    const code = this.view && this.view.code;
    if (!code) return;
    this.copy(location.origin + location.pathname + '?game=' + code, 'Invite link copied.');
  }

  copy(text, message) {
    const done = () => toast(message, 'good');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => this.fallbackCopy(text, done));
    } else this.fallbackCopy(text, done);
  }

  fallbackCopy(text, done) {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (err) { toast(text, '', 6000); }
    ta.remove();
  }

  showLobby(view) {
    setScreen('lobby');
    this.renderLobby(view);
  }

  renderLobby(view) {
    this.view = view;
    $('#room-code').textContent = view.code || '····';
    const isHost = view.you && view.you.isHost;

    const list = clear($('#lobby-list'));
    for (const p of view.players) {
      list.appendChild(el('li', { class: p.isBot ? 'is-bot' : '' }, [
        el('span', { class: 'dot', style: { background: p.colour, color: p.colour } }),
        el('span', { class: 'pname', text: p.name }),
        p.isBot ? el('span', { class: 'tag bot-tag', text: 'Ranger AI' }) : null,
        p.isHost ? el('span', { class: 'tag', text: 'Host' }) : null,
        view.you && p.id === view.you.id ? el('span', { class: 'tag', text: 'You' }) : null,
        isHost && (!view.you || p.id !== view.you.id)
          ? el('button', { class: 'ghost-btn kick-btn', text: 'Remove', onclick: () => this.h.onKick(p.id) })
          : null,
      ]));
    }
    $('#lobby-count').textContent = '(' + view.players.length + ')';

    const addWrap = clear($('#lobby-add-bot'));
    if (isHost) {
      const full = view.players.length >= 6;
      addWrap.appendChild(el('button', {
        class: 'ghost-btn add-bot-btn',
        disabled: full,
        'data-tip': full ? 'Six rangers at most.' : 'Add a computer-controlled ranger.',
        onclick: () => this.h.onAddBot(),
      }, ['+ Add a Ranger']));
      const bots = view.players.filter((p) => p.isBot).length;
      if (bots) {
        addWrap.appendChild(el('span', {
          class: 'hint',
          text: bots + (bots === 1 ? ' ranger will play' : ' rangers will play') + ' alongside you.',
        }));
      }
    }

    this.renderOptions(view, isHost);

    const chat = view.chat || [];
    if (chat.length !== this.lastChatLen) {
      this.lastChatLen = chat.length;
      const cl = clear($('#lobby-chat-list'));
      for (const m of chat) cl.appendChild(chatLine(m));
      cl.scrollTop = cl.scrollHeight;
    }

    const n = view.players.length;
    const start = $('#btn-start');
    show(start, !!isHost);
    start.disabled = n < 1;
    show($('#lobby-host-note'), !isHost);

    const turns = view.settings.turnsEach > 0 ? view.settings.turnsEach : turnsForPlayers(Math.max(1, n));
    this.setLobbyStatus(n === 1
      ? 'Solo against the tally — add a ranger or two for company. ' + turns + ' turns.'
      : n + ' rangers · ' + turns + ' turns each' + (isHost ? '' : ' · waiting for the host'));
  }

  renderOptions(view, isHost) {
    const wrap = clear($('#lobby-options'));
    for (const opt of LOBBY_OPTIONS) {
      const value = view.settings[opt.key];
      let control;
      if (opt.type === 'select') {
        const parse = opt.parse || Number;
        control = el('select', {
          disabled: !isHost,
          onchange: (e) => this.h.onSetting(opt.key, parse(e.target.value)),
        }, opt.options.map(([v, label]) => el('option', {
          value: v, text: label, selected: String(v) === String(value),
        })));
      } else {
        control = el('label', { class: 'switch' }, [
          el('input', {
            type: 'checkbox', checked: !!value, disabled: !isHost,
            onchange: (e) => this.h.onSetting(opt.key, e.target.checked),
          }),
          el('span', { text: value ? 'On' : 'Off' }),
        ]);
      }
      wrap.appendChild(el('div', { class: 'opt-row' }, [
        el('label', { text: opt.label }),
        el('div', { class: 'opt-controls' }, [control]),
        el('span', { class: 'hint', text: opt.hint }),
      ]));
    }
  }

  showTitle() {
    setScreen('title');
    this.setStatus('');
    this.setBusy(false);
    this.lastChatLen = -1;
  }
}
