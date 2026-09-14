// Player-local preferences: sound levels and graphics quality, kept in
// localStorage so a returning ranger finds their setup as they left it.

import { el, clear, openModal } from './dom.js';

const STORE_KEY = 'colorado.settings.v3';

export const DEFAULTS = {
  // sound
  master: 0.8,
  sfx: 0.85,
  music: 0.45,
  muted: false,
  // graphics
  preset: 'balanced',
  fpsCap: 60,
  antialias: true,
  resolution: 1,
  shadows: true,
  treeCount: 3200,
  clouds: true,
  fogFar: 420,
  showFps: false,
};

export const PRESETS = {
  low:      { fpsCap: 30, antialias: false, resolution: 0.7, shadows: false, treeCount: 900,  clouds: false, fogFar: 260 },
  balanced: { fpsCap: 60, antialias: true,  resolution: 1,   shadows: true,  treeCount: 3200, clouds: true,  fogFar: 420 },
  high:     { fpsCap: 120, antialias: true, resolution: 1.3, shadows: true,  treeCount: 4800, clouds: true,  fogFar: 520 },
  ultra:    { fpsCap: 0,  antialias: true,  resolution: 2,   shadows: true,  treeCount: 7000, clouds: true,  fogFar: 620 },
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    return { ...DEFAULTS };
  }
}

export const settings = load();

export function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (err) { /* private mode */ }
}

export function qualityOf(s = settings) {
  return {
    shadows: s.shadows,
    treeCount: s.treeCount,
    clouds: s.clouds,
    fogFar: s.fogFar,
    antialias: s.antialias,
    resolution: s.resolution,
    fpsCap: s.fpsCap,
  };
}

function matchPreset(s) {
  for (const [name, p] of Object.entries(PRESETS)) {
    if (Object.entries(p).every(([k, v]) => s[k] === v)) return name;
  }
  return 'custom';
}

function row(label, hint, control) {
  return el('div', { class: 'opt-row' }, [
    el('label', { text: label }),
    el('div', { class: 'opt-controls' }, [].concat(control)),
    hint ? el('span', { class: 'hint', text: hint }) : null,
  ]);
}

function slider(key, min, max, step, format, onChange) {
  const val = el('span', { class: 'val', text: format(settings[key]) });
  const input = el('input', {
    type: 'range', min, max, step, value: settings[key],
    oninput: (e) => {
      settings[key] = parseFloat(e.target.value);
      val.textContent = format(settings[key]);
      onChange(key);
    },
  });
  return [input, val];
}

function toggle(key, onChange) {
  return el('label', { class: 'switch' }, [
    el('input', {
      type: 'checkbox', checked: settings[key],
      onchange: (e) => { settings[key] = e.target.checked; onChange(key); },
    }),
    el('span', { text: settings[key] ? 'On' : 'Off' }),
  ]);
}

function select(key, options, onChange, parse = Number) {
  return el('select', {
    onchange: (e) => { settings[key] = parse(e.target.value); onChange(key); },
  }, options.map(([value, label]) => el('option', {
    value, text: label, selected: String(settings[key]) === String(value),
  })));
}

export function openSettingsModal(onChange) {
  const apply = (key) => {
    settings.preset = matchPreset(settings);
    saveSettings();
    onChange(key);
    if (presetSelect) presetSelect.value = settings.preset;
    refreshSwitchLabels();
  };

  let presetSelect = null;
  const body = el('div', { class: 'settings-grid' });

  body.appendChild(el('h3', { text: 'Sound' }));
  body.appendChild(row('Master volume', null, slider('master', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', apply)));
  body.appendChild(row('Effects', 'Every one synthesised live.',
    slider('sfx', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', apply)));
  body.appendChild(row('Ambience', 'The background music, with wind and birds under it.',
    slider('music', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', apply)));
  body.appendChild(row('Mute everything', null, toggle('muted', apply)));

  body.appendChild(el('h3', { text: 'Graphics' }));
  presetSelect = el('select', {
    onchange: (e) => {
      const name = e.target.value;
      if (name !== 'custom') {
        Object.assign(settings, PRESETS[name]);
        settings.preset = name;
        saveSettings();
        onChange('preset');
        rebuild();
      }
    },
  }, [['low', 'Low'], ['balanced', 'Balanced'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']]
    .map(([v, l]) => el('option', { value: v, text: l, selected: matchPreset(settings) === v })));
  body.appendChild(row('Quality preset', null, presetSelect));

  body.appendChild(row('Frame rate cap', 'Lower caps save battery.',
    select('fpsCap', [[30, '30 fps'], [45, '45 fps'], [60, '60 fps'], [120, '120 fps'], [0, 'Unlimited']], apply)));
  body.appendChild(row('Anti-aliasing', 'Smooths jagged edges.', toggle('antialias', apply)));
  body.appendChild(row('Resolution scale', 'Below 100% renders smaller and upscales.',
    slider('resolution', 0.5, 2, 0.1, (v) => Math.round(v * 100) + '%', apply)));
  body.appendChild(row('Shadows', null, toggle('shadows', apply)));
  body.appendChild(row('Forest density', 'Instanced — thousands of trees cost three draw calls.',
    slider('treeCount', 0, 8000, 200, (v) => String(Math.round(v)), apply)));
  body.appendChild(row('Clouds', null, toggle('clouds', apply)));
  body.appendChild(row('View distance', null, slider('fogFar', 200, 700, 20, (v) => Math.round(v) + 'm', apply)));
  body.appendChild(row('Show FPS counter', null, toggle('showFps', apply)));

  function refreshSwitchLabels() {
    body.querySelectorAll('.switch').forEach((sw) => {
      sw.querySelector('span').textContent = sw.querySelector('input').checked ? 'On' : 'Off';
    });
  }
  function rebuild() {
    clear(body);
    openSettingsModal(onChange);
  }

  openModal({
    title: 'Settings',
    wide: true,
    body,
    actions: [
      {
        label: 'Restore defaults',
        close: false,
        onClick: () => {
          Object.assign(settings, DEFAULTS);
          saveSettings();
          onChange('preset');
          rebuild();
        },
      },
      { label: 'Done', primary: true },
    ],
  });
}
