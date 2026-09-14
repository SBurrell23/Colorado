// The in-game overlay: whose turn it is, what you are being asked to do, the
// field notes, the scoring reference and the final tally.

import { $, el, clear, show, openModal, escapeHtml, hideTip } from './dom.js';
import { HABITATS, ANIMALS, HABITAT_INFO, ANIMAL_INFO } from '../game/tiles.js';
import { RULE_TEXT, RULE_TABLE, HABITAT_BONUS } from '../game/scoring.js';
import { animalGlyph, habitatSwatch } from '../render/tileart.js';

export class Hud {
  constructor(handlers) {
    this.h = handlers;
    this.view = null;
    this.mode = null;         // the current interaction mode from main.js
    this.lastLogLen = -1;
    this.lastChatLen = -1;
    this.activeTab = 'log';
    this.watching = null;
    this.bind();
  }

  bind() {
    $('#btn-leave').addEventListener('click', () => this.h.onLeave());
    $('#btn-camera').addEventListener('click', () => this.h.onFocusSelf());
    $('#btn-help').addEventListener('click', () => openHelp());
    $('#btn-rules').addEventListener('click', () => openScoring());
    $('#log-collapse').addEventListener('click', () => {
      const p = $('#log-panel');
      p.classList.toggle('collapsed');
      $('#log-collapse').textContent = p.classList.contains('collapsed') ? '▸' : '▾';
    });
    // A phone has no room for the field notes and the board at once, so the
    // notes start folded away; the toast still announces anything important.
    if (window.matchMedia('(max-width: 640px)').matches) {
      $('#log-panel').classList.add('collapsed');
      $('#log-collapse').textContent = '▸';
    }

    for (const tab of document.querySelectorAll('#log-panel .tab')) {
      tab.addEventListener('click', () => {
        this.activeTab = tab.dataset.tab;
        document.querySelectorAll('#log-panel .tab').forEach((t) => t.classList.toggle('active', t === tab));
        show($('#log-list'), this.activeTab === 'log');
        show($('#chat-list'), this.activeTab === 'chat');
        show($('#chat-form'), this.activeTab === 'chat');
        if (this.activeTab === 'chat') $('#chat-input').focus();
      });
    }
    $('#chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#chat-input');
      const text = input.value.trim();
      if (text) this.h.onChat(text);
      input.value = '';
    });
  }

  setMode(mode) {
    hideTip();
    this.mode = mode;
    this.renderPrompt();
  }

  setWatching(playerId) {
    this.watching = playerId;
    this.renderPlayers();
  }

  update(view) {
    const prev = this.view;
    this.view = view;
    this.renderTop();
    this.renderPlayers();
    this.renderLog();
    this.renderChat();
    this.renderPrompt();
    if (view.phase === 'gameEnd' && (!prev || prev.phase !== 'gameEnd')) this.showResult(view);
  }

  renderTop() {
    const v = this.view;
    const done = v.players.length
      ? Math.min(...v.players.map((p) => p.turnsTaken)) + 1
      : 1;
    $('#round-label').textContent = 'Turn ' + Math.min(done, v.turnsEach) + ' of ' + v.turnsEach;

    const cur = v.players.find((p) => p.id === v.currentPlayerId);
    const line = $('#turn-line');
    if (v.phase !== 'playing') {
      line.textContent = v.phase === 'gameEnd' ? 'The season is over' : 'Waiting…';
      line.style.color = '';
    } else if (cur && v.you && cur.id === v.you.id) {
      line.textContent = 'Your turn';
      line.style.color = '#f7e6ae';
    } else if (cur) {
      line.textContent = cur.name + (cur.isBot ? ' is deciding…' : ' is thinking…');
      line.style.color = cur.colour;
    }

    const nature = $('#nature-badge');
    nature.textContent = v.you ? v.you.nature : 0;
    $('#deck-count').textContent = 'Stack ' + v.deckCount;
  }

  updateTimer() {
    const v = this.view;
    const wrap = $('#timer-wrap');
    if (!v || !v.turnEndsAt || v.phase !== 'playing') { show(wrap, false); return; }
    show(wrap, true);
    const total = (v.settings.turnSeconds || 1) * 1000;
    const pct = Math.max(0, Math.min(1, (v.turnEndsAt - Date.now()) / total));
    const bar = $('#timer-bar');
    bar.style.width = (pct * 100).toFixed(1) + '%';
    bar.classList.toggle('urgent', pct < 0.25);
  }

  renderPlayers() {
    const v = this.view;
    if (!v) return;
    const list = clear($('#player-list'));
    for (const p of v.players) {
      const classes = ['clickable'];
      if (p.id === v.currentPlayerId) classes.push('current');
      if (v.you && p.id === v.you.id) classes.push('me');
      if (p.id === this.watching) classes.push('watching');
      if (!p.connected) classes.push('offline');
      if (p.isBot) classes.push('bot');

      const tiles = Object.keys(p.env || {}).length;
      const li = el('li', {
        class: classes.join(' '),
        'data-tip-title': p.name + "'s board",
        'data-tip': 'Click to look it over. ' + tiles + ' tiles down, '
          + p.turnsTaken + ' of ' + v.turnsEach + ' turns taken.',
        onclick: () => this.h.onWatch(p.id),
      }, [
        el('span', { class: 'dot', style: { background: p.colour, color: p.colour } }),
        el('span', { class: 'pname', text: p.name }),
        el('span', { class: 'p-right' }, [
          el('span', { class: 'p-nature', text: '♣' + p.nature }),
          el('span', { text: tiles + ' tiles' }),
        ]),
      ]);
      list.appendChild(li);
    }
  }

  renderPrompt() {
    const v = this.view;
    const bar = $('#action-bar');
    if (!v || v.phase !== 'playing' || !v.you) { show(bar, false); return; }
    const mine = v.currentPlayerId === v.you.id;
    show(bar, mine);
    if (!mine) return;

    const prompt = $('#action-prompt');
    const buttons = clear($('#action-buttons'));
    const m = this.mode || {};

    if (v.turnPhase === 'draft') {
      if (m.kind === 'nature') {
        prompt.innerHTML = '<strong>Nature token</strong> — pick any tile, then any animal.';
        buttons.appendChild(el('button', {
          class: 'ghost-btn', text: 'Cancel', onclick: () => this.h.onCancelMode(),
        }));
      } else if (m.kind === 'cull') {
        prompt.innerHTML = '<strong>Clearing</strong> — choose the animals to send back to the bag.';
        buttons.appendChild(el('button', {
          class: 'big-btn rust', text: 'Clear ' + (m.picked || 0),
          disabled: !m.picked, onclick: () => this.h.onConfirmCull(),
        }));
        buttons.appendChild(el('button', {
          class: 'ghost-btn', text: 'Cancel', onclick: () => this.h.onCancelMode(),
        }));
      } else {
        prompt.innerHTML = 'Take a tile and the animal beside it.';
        const freeThree = v.settings.cullThree && !v.culledThisTurn && v.matching.length === 3;
        if (freeThree) {
          buttons.appendChild(el('button', {
            class: 'big-btn rust', text: 'Clear the three matching',
            'data-tip': 'Three of the same animal are on offer. You may send them back to the bag '
              + 'for nothing, once per turn.',
            onclick: () => this.h.onQuickCull(),
          }));
        }
        buttons.appendChild(el('button', {
          class: 'ghost-btn', text: 'Use a nature token', disabled: v.you.nature < 1,
          'data-tip': v.you.nature < 1 ? 'You have none to spend.'
            : 'Take any tile with any animal, instead of the pair on offer.',
          onclick: () => this.h.onNatureMode(),
        }));
        if (!freeThree) {
          buttons.appendChild(el('button', {
            class: 'ghost-btn', text: 'Clear tokens', disabled: v.you.nature < 1,
            'data-tip': 'Spend a nature token to send any of the four animals back to the bag.',
            onclick: () => this.h.onCullMode(),
          }));
        }
      }
      return;
    }

    if (v.turnPhase === 'tile') {
      prompt.innerHTML = 'Lay the tile on your board — it must touch what you already have.';
      buttons.appendChild(el('button', {
        class: 'ghost-btn', onclick: () => this.h.onRotate(),
      }, ['Turn it', el('kbd', { text: 'R' })]));
      return;
    }

    if (v.turnPhase === 'token') {
      const a = v.pending && v.pending.token;
      prompt.innerHTML = 'Settle the <strong>' + escapeHtml(a ? ANIMAL_INFO[a].name : 'animal')
        + '</strong> on a tile showing its mark.';
    }
  }

  renderLog() {
    const v = this.view;
    if (!v.log || v.log.length === this.lastLogLen) return;
    this.lastLogLen = v.log.length;
    const list = clear($('#log-list'));
    for (const entry of v.log) {
      list.appendChild(el('div', { class: 'log-line ' + (entry.kind || ''), text: entry.text }));
    }
    list.scrollTop = list.scrollHeight;
  }

  renderChat() {
    const chat = this.view.chat || [];
    if (chat.length === this.lastChatLen) return;
    this.lastChatLen = chat.length;
    const list = clear($('#chat-list'));
    for (const m of chat) list.appendChild(chatLine(m));
    list.scrollTop = list.scrollHeight;
  }

  showResult(v) {
    const r = v.result;
    if (!r) return;
    const byId = Object.fromEntries(v.players.map((p) => [p.id, p]));
    const body = el('div');

    const winners = r.winners.map((id) => byId[id].name);
    body.appendChild(el('p', {
      text: winners.length > 1
        ? 'Dead level: ' + winners.join(' and ') + ' share the high country.'
        : winners[0] + ' takes it, with the best-kept corner of Colorado.',
    }));

    const head = el('tr', {}, [
      el('th', { text: 'Ranger' }),
      ...ANIMALS.map((a) => el('th', {
        'data-tip-title': ANIMAL_INFO[a].name, 'data-tip': RULE_TEXT[a],
      }, [el('img', { src: animalGlyph(a, 44), alt: ANIMAL_INFO[a].name })])),
      el('th', { text: 'Habitat' }),
      el('th', { text: '♣' }),
      el('th', { text: 'Total' }),
    ]);

    const rows = r.ranked.map((row) => el('tr', { class: r.winners.includes(row.id) ? 'win' : '' }, [
      el('td', {}, [
        el('span', { class: 'dot', style: { background: byId[row.id].colour, display: 'inline-block', marginRight: '7px' } }),
        byId[row.id].name,
      ]),
      ...ANIMALS.map((a) => el('td', { text: String(row.wildlife[a]) })),
      el('td', {
        'data-tip-title': 'Habitat corridors',
        'data-tip': HABITATS.map((h) => HABITAT_INFO[h].short + ' ' + row.habitat[h].size
          + (row.habitat[h].bonus ? ' (+' + row.habitat[h].bonus + ')' : '')).join(', '),
        text: String(row.habitatTotal),
      }),
      el('td', { text: String(row.nature) }),
      el('td', { class: 'total', text: String(row.total) }),
    ]));

    body.appendChild(el('table', { class: 'score-table' }, [
      el('thead', {}, [head]),
      el('tbody', {}, rows),
    ]));
    body.appendChild(el('p', { class: 'muted', text: 'Hover a column for the rule behind it.' }));

    const isHost = v.you && v.you.isHost;
    openModal({
      title: 'The Season’s Tally',
      body,
      wide: true,
      actions: isHost
        ? [
            { label: 'Back to the trailhead', primary: true, onClick: () => this.h.onBackToLobby() },
            { label: 'Leave', onClick: () => this.h.onLeave() },
          ]
        : [{ label: 'Leave', onClick: () => this.h.onLeave() }],
    });
  }
}

export function chatLine(m) {
  if (m.kind === 'system') return el('div', { class: 'chat-line system', text: m.text });
  return el('div', { class: 'chat-line' }, [
    el('span', { class: 'who', style: { color: m.colour || '#fff' }, text: m.name + ': ' }),
    m.text,
  ]);
}

// ---------------------------------------------------------------------------
export function openScoring() {
  const body = el('div');
  body.appendChild(el('p', {
    class: 'muted',
    text: 'Every animal scores by its own habits. Nothing is counted until the season ends.',
  }));
  body.appendChild(el('div', { class: 'rule-list' }, ANIMALS.map((a) => el('div', { class: 'rule-row' }, [
    el('img', { src: animalGlyph(a, 96), alt: '' }),
    el('div', {}, [
      el('div', { class: 'rule-name', text: ANIMAL_INFO[a].name }),
      el('div', { class: 'rule-text', text: RULE_TEXT[a] }),
      el('div', { class: 'rule-table' }, RULE_TABLE[a].map((t) => el('span', { class: 'rule-chip' }, [
        t.label + ' ', el('b', { text: String(t.value) }),
      ]))),
    ]),
  ]))));

  body.appendChild(el('h3', { text: 'Habitat corridors' }));
  body.appendChild(el('p', {
    text: 'For each habitat, count the tiles in your largest unbroken run of it — two tiles join '
      + 'only where both of the edges they press together show that habitat. You score one point '
      + 'per tile, and the longest run of each habitat takes a further '
      + HABITAT_BONUS + ' points (one each if it is a tie).',
  }));
  body.appendChild(el('div', { class: 'rule-table' }, HABITATS.map((h) => el('span', { class: 'rule-chip' }, [
    el('img', { src: habitatSwatch(h, 36), alt: '', style: { width: '16px', height: '16px', verticalAlign: '-3px', marginRight: '5px' } }),
    HABITAT_INFO[h].name,
  ]))));

  body.appendChild(el('h3', { text: 'Nature tokens' }));
  body.appendChild(el('p', {
    text: 'Settle an animal on a keystone tile — one showing a single animal — and you earn a '
      + 'nature token. Spend it to take any tile with any animal, or to send unwanted animals '
      + 'back to the bag. Any you still hold at the end are worth a point apiece.',
  }));

  openModal({ title: 'Scoring', body, wide: true, actions: [{ label: 'Close', primary: true }] });
}

const HELP_TABS = [
  {
    id: 'game',
    label: 'The game',
    html: `
      <p class="lead">You are putting together a corner of Colorado, hex by hex. Every turn you
      take one habitat tile and the animal standing beside it, lay the tile against your land and
      settle the animal somewhere it belongs. After twenty turns the season ends and the
      high country is scored.</p>

      <h4>A turn, in three beats</h4>
      <ul class="spaced">
        <li><b>Take a pair.</b> Four tiles are on offer, each with one animal beside it. Take a
          tile and you take that animal with it.</li>
        <li><b>Lay the tile</b> anywhere against your land. Turn it however you like — habitats do
          not have to match to be placed, only to join into a corridor.</li>
        <li><b>Settle the animal</b> on any tile of yours showing its mark and not already taken.
          If nowhere will have it, it goes back to the wild.</li>
      </ul>

      <h4>Nature tokens</h4>
      <ul class="spaced">
        <li>Settle an animal on a <b>keystone tile</b> — one showing a single animal — and take a
          nature token.</li>
        <li>Spend one to break the pairing and take <b>any tile with any animal</b>, or to send
          unwanted animals back to the bag.</li>
        <li>If all four animals on offer match they clear themselves. If exactly three match, you
          may clear them once a turn for nothing.</li>
      </ul>`,
  },
  {
    id: 'score',
    label: 'Scoring',
    html: `
      <p class="lead">Nothing scores until the end, so every tile is a bet on how the season
      finishes.</p>
      <h4>The animals</h4>
      <ul class="spaced">
        <li><b>Bighorn sheep</b> want to be in twos — a pair, never a crowd.</li>
        <li><b>Elk</b> want a straight line, and the longer the better.</li>
        <li><b>Cutthroat trout</b> want a run that never branches.</li>
        <li><b>Golden eagles</b> want a ridge to themselves.</li>
        <li><b>Coyotes</b> want variety — one point for each different animal beside them.</li>
      </ul>
      <h4>The land</h4>
      <ul class="spaced">
        <li>One point per tile in your longest run of each habitat, and a bonus to whoever has the
          longest run of each.</li>
        <li>Two tiles only join a corridor where <b>both touching edges</b> show that habitat, so
          which way round you lay a split tile matters.</li>
        <li>Every nature token still in hand is worth a point.</li>
      </ul>
      <p class="muted">The Scoring button in the corner has the exact tables at any time.</p>`,
  },
  {
    id: 'controls',
    label: 'Controls',
    html: `
      <div class="key-list">
        <div><span>Pan</span><kbd>drag</kbd></div>
        <div><span>Orbit</span><kbd>right-drag</kbd></div>
        <div><span>Zoom</span><kbd>wheel</kbd></div>
        <div><span>Pan</span><kbd>W A S D</kbd></div>
        <div><span>Turn the view</span><kbd>Q E</kbd></div>
        <div><span>Turn the held tile</span><kbd>R</kbd></div>
        <div><span>Back to your board</span><kbd>R</kbd></div>
        <div><span>Take pair 1 to 4</span><kbd>1 – 4</kbd></div>
        <div><span>Talk</span><kbd>Enter</kbd></div>
        <div><span>Help</span><kbd>H</kbd></div>
        <div><span>Cancel / settings</span><kbd>Esc</kbd></div>
      </div>
      <p class="muted">Click any ranger in the list to fly over and look at their board; click your
      own, or press <kbd>R</kbd>, to come back.</p>`,
  },
];

export function openHelp() {
  const body = el('div', { class: 'help' });
  const bar = el('div', { class: 'help-tabs' });
  const pane = el('div', { class: 'help-pane' });
  HELP_TABS.forEach((tab, i) => {
    const btn = el('button', {
      class: 'help-tab' + (i === 0 ? ' active' : ''),
      text: tab.label,
      onclick: () => {
        bar.querySelectorAll('.help-tab').forEach((b) => b.classList.toggle('active', b === btn));
        pane.innerHTML = tab.html;
      },
    });
    bar.appendChild(btn);
  });
  pane.innerHTML = HELP_TABS[0].html;
  body.appendChild(bar);
  body.appendChild(pane);
  openModal({ title: 'How to Play', body, wide: true, actions: [{ label: 'Close', primary: true }] });
}
