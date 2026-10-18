/* widgets.js - Optional New Tab Widgets: Clock, Weather (Open-Meteo), Focus timer, To-do List & Notes */

const ShortcutWidgets = {
  KEY_PREFIX: 'shortcut_plus_widgets_',          // + profileId (per-profile config & data)
  WEATHER_CACHE_KEY: 'shortcut_plus_weather_cache', // global, keyed by rounded lat,lon
  WEATHER_TTL: 30 * 60 * 1000,
  WEATHER_POLL: 5 * 60 * 1000,
  SIDE_COLUMN_MIN_WIDTH: 1160, // below this the right column would collide with the search bar
  TODO_MAX_LEN: 500,
  NOTES_MAX_LEN: 20000,

  // Focus timer (Pomodoro). Timer state is timestamp-based so every new tab shows the same clock.
  FOCUS_MODES: {
    focus: { label: 'Focus', key: 'focusMin' },
    short: { label: 'Short break', key: 'shortMin' },
    long: { label: 'Long break', key: 'longMin' }
  },
  FOCUS_LIMITS: { focusMin: [1, 180], shortMin: [1, 60], longMin: [1, 90], longEvery: [2, 12], goal: [1, 24] },
  FOCUS_LATE_MS: 60 * 1000,   // a session that ended longer ago than this (no tab open) completes silently
  FOCUS_HIDDEN_STEP: 30000,   // title refresh cadence while the page/widget isn't visible

  DEFS: [
    { id: 'clock', title: 'Clock', icon: '\u{1F552}', desc: 'Time, date & greeting' },
    { id: 'weather', title: 'Weather', icon: '⛅', desc: 'Forecast by Open-Meteo' },
    { id: 'focus', title: 'Focus timer', icon: '⏱️', desc: 'Pomodoro sessions & a daily goal' },
    { id: 'todo', title: 'To-do', icon: '✅', desc: 'A quick task list' },
    { id: 'notes', title: 'Notes', icon: '\u{1F4DD}', desc: 'Autosaving scratchpad' }
  ],

  profileId: null,
  state: null,
  els: {},   // root, column, launcher, picker, switches
  cards: {}, // widget id -> { card, ctx }
  _inited: false,
  _saveTimer: null,
  _lastSavedJson: '',
  _pendingExternal: null,
  _mql: null,
  _resizeRaf: 0,
  _baseTitle: null,
  _titleSet: false,
  _audioCtx: null,
  _toastTimer: null,
  _focusResolving: false,

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  async init() {
    if (this._inited) return;
    if (typeof ShortcutStorage === 'undefined') {
      console.warn('[ShortcutWidgets] ShortcutStorage is not available; widgets disabled.');
      return;
    }
    this._inited = true;
    this._mql = window.matchMedia(`(min-width: ${this.SIDE_COLUMN_MIN_WIDTH}px)`);
    this.buildShell();
    this.bindGlobalEvents();
    await this.refresh();
  },

  // Re-read the active profile's widget config (call after profile switches)
  async refresh() {
    if (!this._inited) return this.init();
    await this.flushSave(); // pending note edits belong to the previous profile
    const profileId = await ShortcutStorage.getActiveProfileId();
    const raw = await ShortcutStorage._getStorageItem(this.KEY_PREFIX + profileId, null);
    this.profileId = profileId;
    this.state = this.normalize(raw);
    this._lastSavedJson = JSON.stringify(this.state);
    this._pendingExternal = null;
    this.renderAll();
    this.syncPicker();
  },

  defaultState() {
    return {
      enabled: { clock: false, weather: false, focus: false, todo: false, notes: false },
      collapsed: {},
      positions: {}, // id -> { x: vw, y: vh }; absent = default column slot
      clock: { hour24: null, seconds: false, greeting: true, date: true }, // hour24 null = follow locale
      weather: { location: null, unit: null },                 // unit null = follow locale
      focus: this.defaultFocus(),
      todos: [],
      notes: { text: '' }
    };
  },

  defaultFocus() {
    return {
      settings: { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, goal: 8, autoStart: false, muted: false, titleTimer: true },
      // status: idle | running (endsAt set) | paused (remaining set). duration = full length of the current session.
      timer: { mode: 'focus', status: 'idle', endsAt: null, remaining: null, duration: null, sessionId: null, cycle: 0 },
      stats: { date: '', sessions: 0, minutes: 0 }, // completed focus sessions for one local date
      lastAlertedSessionId: null                    // cross-tab chime dedupe
    };
  },

  normalizeFocus(raw) {
    const f = this.defaultFocus();
    if (!raw || typeof raw !== 'object') return f;
    const int = (v, [min, max], def) => {
      const n = typeof v === 'number' || typeof v === 'string' ? Math.round(Number(v)) : NaN;
      return Number.isFinite(n) ? this.clamp(n, min, max) : def;
    };
    const rs = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    for (const k of Object.keys(this.FOCUS_LIMITS)) f.settings[k] = int(rs[k], this.FOCUS_LIMITS[k], f.settings[k]);
    f.settings.autoStart = rs.autoStart === true;
    f.settings.muted = rs.muted === true;
    f.settings.titleTimer = rs.titleTimer !== false;

    const rt = raw.timer && typeof raw.timer === 'object' ? raw.timer : {};
    const t = f.timer;
    if (Object.prototype.hasOwnProperty.call(this.FOCUS_MODES, rt.mode)) t.mode = rt.mode;
    t.cycle = int(rt.cycle, [0, 12], 0);
    const dur = rt.duration;
    const validDur = typeof dur === 'number' && Number.isFinite(dur) && dur > 0 && dur <= 24 * 3600 * 1000;
    const sid = typeof rt.sessionId === 'string' && rt.sessionId ? rt.sessionId.slice(0, 64) : null;
    if (validDur && sid && rt.status === 'running' && typeof rt.endsAt === 'number' && Number.isFinite(rt.endsAt)) {
      Object.assign(t, { status: 'running', endsAt: rt.endsAt, duration: dur, sessionId: sid });
    } else if (validDur && sid && rt.status === 'paused' && typeof rt.remaining === 'number' && Number.isFinite(rt.remaining)) {
      Object.assign(t, { status: 'paused', remaining: this.clamp(rt.remaining, 0, dur), duration: dur, sessionId: sid });
    }

    const st = raw.stats;
    if (st && typeof st.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(st.date)) {
      f.stats = { date: st.date, sessions: int(st.sessions, [0, 999], 0), minutes: int(st.minutes, [0, 100000], 0) };
    }
    if (typeof raw.lastAlertedSessionId === 'string') f.lastAlertedSessionId = raw.lastAlertedSessionId.slice(0, 64);
    return f;
  },

  // Defensive merge of stored data onto defaults (storage may hold old or hand-edited data)
  normalize(raw) {
    const s = this.defaultState();
    if (!raw || typeof raw !== 'object') return s;
    for (const { id } of this.DEFS) {
      s.enabled[id] = !!(raw.enabled && raw.enabled[id]);
      if (raw.collapsed && raw.collapsed[id]) s.collapsed[id] = true;
      const p = raw.positions && raw.positions[id];
      if (p && Number.isFinite(+p.x) && Number.isFinite(+p.y)) s.positions[id] = { x: +p.x, y: +p.y };
    }
    if (raw.clock && typeof raw.clock === 'object') {
      s.clock.hour24 = typeof raw.clock.hour24 === 'boolean' ? raw.clock.hour24 : null;
      s.clock.seconds = !!raw.clock.seconds;
      s.clock.greeting = raw.clock.greeting !== false;
      s.clock.date = raw.clock.date !== false;
    }
    s.focus = this.normalizeFocus(raw.focus);
    if (raw.weather && typeof raw.weather === 'object') {
      const loc = raw.weather.location;
      if (loc && Number.isFinite(+loc.lat) && Number.isFinite(+loc.lon)) {
        s.weather.location = { name: String(loc.name || ''), region: String(loc.region || ''), lat: +loc.lat, lon: +loc.lon };
      }
      if (raw.weather.unit === 'c' || raw.weather.unit === 'f') s.weather.unit = raw.weather.unit;
    }
    if (Array.isArray(raw.todos)) {
      s.todos = raw.todos
        .filter(t => t && typeof t.text === 'string' && t.text.trim())
        .map(t => ({ id: String(t.id || this.uid()), text: t.text.slice(0, this.TODO_MAX_LEN), done: !!t.done }));
    }
    if (raw.notes && typeof raw.notes.text === 'string') s.notes.text = raw.notes.text.slice(0, this.NOTES_MAX_LEN);
    return s;
  },

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  // Read-merge-write under the focus lock so tabs can't clobber each other's newer data:
  // part 'focus' writes only the focus subtree into the stored object (other widgets may hold
  // a newer external edit that this tab deferred); any other save writes everything except
  // focus, keeping the stored timer (another tab may have advanced it).
  save(part = 'widgets') {
    if (part !== 'focus') {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (!this.state || !this.profileId) return Promise.resolve();
    const profileId = this.profileId;
    const local = JSON.parse(JSON.stringify(this.state));
    const write = () => this.writeMerged(profileId, local, part);
    const done = navigator.locks && typeof navigator.locks.request === 'function'
      ? navigator.locks.request(`shortcut-plus-focus-${profileId}`, write)
      : write();
    return done.then(() => {
      if (part === 'focus') return;
      const notes = this.cards.notes;
      if (notes && notes.ctx.onSaved) notes.ctx.onSaved();
    });
  },

  // Caller must hold the focus lock (or have no Web Locks support)
  async writeMerged(profileId, local, part) {
    const key = this.KEY_PREFIX + profileId;
    const stored = await ShortcutStorage._getStorageItem(key, null);
    let out = local;
    if (stored && typeof stored === 'object') {
      out = part === 'focus'
        ? Object.assign({}, stored, { focus: local.focus })
        : Object.assign({}, local, stored.focus ? { focus: stored.focus } : null);
    }
    const json = JSON.stringify(out);
    this._lastSavedJson = json;
    await ShortcutStorage._setStorageItem(key, JSON.parse(json));
  },

  scheduleSave(delay = 600) {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), delay);
  },

  flushSave() {
    return this._saveTimer ? this.save() : Promise.resolve();
  },

  // Another new tab changed our profile's widgets: adopt it, unless the user is mid-edit here
  onStorageChanged(changes, area) {
    if (area !== 'local' || !this.profileId) return;
    const change = changes[this.KEY_PREFIX + this.profileId];
    if (!change || !change.newValue) return;
    if (JSON.stringify(change.newValue) === this._lastSavedJson) return; // our own write
    // The focus timer is adopted immediately (even mid-edit) so every tab shows the same running clock;
    // its writes are never debounced, so the stored copy is always the latest.
    const next = this.normalize(change.newValue);
    if (JSON.stringify(next.focus) !== JSON.stringify(this.state.focus)) {
      this.state.focus = next.focus;
      this.ctxCall('focus', 'sync');
    }
    const withoutFocus = (s) => JSON.stringify(Object.assign({}, s, { focus: null }));
    if (withoutFocus(next) === withoutFocus(this.state)) {
      if (!this._saveTimer) this._lastSavedJson = JSON.stringify(this.state);
      return; // nothing else changed: skip the full re-render
    }
    if (this._saveTimer) return; // local unsaved edits win; they are written momentarily
    if (document.hasFocus() && this.els.root.contains(document.activeElement)) {
      this._pendingExternal = change.newValue;
      return;
    }
    this.applyExternal(change.newValue);
  },

  applyExternal(raw) {
    this._pendingExternal = null;
    // Focus timer state is merged eagerly in onStorageChanged and is always the newest copy;
    // a deferred (older) snapshot must not roll it back.
    const focus = this.state && this.state.focus;
    this.state = this.normalize(raw);
    if (focus) this.state.focus = focus;
    this._lastSavedJson = JSON.stringify(this.state);
    this.renderAll();
    this.syncPicker();
  },

  // ---------------------------------------------------------------------------
  // DOM helpers (never innerHTML: to-do text and notes are user data)
  // ---------------------------------------------------------------------------
  el(tag, opts = {}, children = []) {
    const node = document.createElement(tag);
    if (opts.className) node.className = opts.className;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.attrs) {
      for (const [k, v] of Object.entries(opts.attrs)) {
        if (v != null && v !== false) node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (opts.on) {
      for (const [ev, fn] of Object.entries(opts.on)) node.addEventListener(ev, fn);
    }
    for (const child of children) if (child) node.appendChild(child);
    return node;
  },

  iconBtn(label, glyph, onClick, className = '') {
    const btn = this.el('button', {
      className: `spw-icon-btn ${className}`.trim(),
      attrs: { type: 'button', 'aria-label': label, title: label },
      on: onClick ? { click: onClick } : null
    }, [this.el('span', { text: glyph, attrs: { 'aria-hidden': 'true' } })]);
    return btn;
  },

  checkboxRow(label, checked, onChange) {
    const input = this.el('input', { attrs: { type: 'checkbox' } });
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    return this.el('label', { className: 'spw-check-row' }, [input, this.el('span', { text: label })]);
  },

  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  clamp(v, min, max) {
    return Math.min(Math.max(v, min), Math.max(min, max));
  },

  localeRegion() {
    try {
      return new Intl.Locale(navigator.language || 'en-US').maximize().region || '';
    } catch (e) {
      return '';
    }
  },

  // ---------------------------------------------------------------------------
  // Shell: root container, default column, launcher button & picker popover
  // ---------------------------------------------------------------------------
  buildShell() {
    const root = this.el('div', { className: 'spw-root', attrs: { id: 'spw-root' } });
    // Keep DragEngine's body-level pointerdown (marquee / clear selection) out of widgets
    root.addEventListener('pointerdown', (e) => e.stopPropagation());

    const column = this.el('div', { className: 'spw-column', attrs: { role: 'region', 'aria-label': 'Widgets' } });

    const launcher = this.el('button', {
      className: 'spw-launcher',
      attrs: { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'spw-picker', title: 'Widgets' },
      on: { click: () => this.togglePicker() }
    }, [this.gridIcon(), this.el('span', { text: 'Widgets' })]);

    const picker = this.el('div', {
      className: 'spw-picker',
      attrs: { id: 'spw-picker', role: 'dialog', 'aria-label': 'Choose widgets', hidden: true }
    });
    picker.appendChild(this.el('div', { className: 'spw-picker-head' }, [
      this.el('h2', { className: 'spw-picker-title', text: 'Widgets' }),
      this.el('p', { className: 'spw-picker-sub', text: 'Shown for this profile. Drag them in Edit mode.' })
    ]));

    this.els.switches = {};
    const list = this.el('div', { className: 'spw-picker-list' });
    for (const def of this.DEFS) {
      const sw = this.el('input', { className: 'spw-switch', attrs: { type: 'checkbox', role: 'switch', 'aria-label': `Show ${def.title} widget` } });
      sw.addEventListener('change', () => this.setEnabled(def.id, sw.checked));
      this.els.switches[def.id] = sw;
      list.appendChild(this.el('label', { className: 'spw-picker-row' }, [
        this.el('span', { className: 'spw-picker-icon', text: def.icon, attrs: { 'aria-hidden': 'true' } }),
        this.el('span', { className: 'spw-picker-text' }, [
          this.el('span', { className: 'spw-picker-name', text: def.title }),
          this.el('span', { className: 'spw-picker-desc', text: def.desc })
        ]),
        sw
      ]));
    }
    picker.appendChild(list);
    picker.appendChild(this.el('div', { className: 'spw-picker-foot' }, [
      this.el('button', {
        className: 'spw-text-btn',
        text: 'Reset positions',
        attrs: { type: 'button' },
        on: { click: () => this.resetPositions() }
      })
    ]));

    // Persistent live region (outside the cards, so announcements survive collapsed/re-rendered cards)
    const live = this.el('div', { className: 'spw-sr-only', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });

    root.append(column, launcher, picker, live);
    document.body.appendChild(root);
    Object.assign(this.els, { root, column, launcher, picker, live });
  },

  gridIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    for (const [x, y] of [[3, 3], [13, 3], [3, 13], [13, 13]]) {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', x);
      r.setAttribute('y', y);
      r.setAttribute('width', '8');
      r.setAttribute('height', '8');
      r.setAttribute('rx', '2.5');
      r.setAttribute('fill', 'currentColor');
      svg.appendChild(r);
    }
    return svg;
  },

  togglePicker(open) {
    const { picker, launcher } = this.els;
    const willOpen = open === undefined ? picker.hidden : open;
    picker.hidden = !willOpen;
    launcher.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      this.syncPicker();
      const first = picker.querySelector('.spw-switch');
      if (first) first.focus();
    }
  },

  syncPicker() {
    if (!this.state || !this.els.switches) return;
    for (const { id } of this.DEFS) this.els.switches[id].checked = !!this.state.enabled[id];
  },

  bindGlobalEvents() {
    // Close the picker on outside press (capture: widgets stop propagation)
    document.addEventListener('pointerdown', (e) => {
      const { picker, launcher } = this.els;
      if (picker.hidden || picker.contains(e.target) || launcher.contains(e.target)) return;
      this.togglePicker(false);
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.els.picker.hidden) {
        this.togglePicker(false);
        this.els.launcher.focus();
      }
    });

    window.addEventListener('resize', () => {
      cancelAnimationFrame(this._resizeRaf);
      this._resizeRaf = requestAnimationFrame(() => this.clampAll());
    });

    const onLayoutChange = () => this.placeAll();
    if (this._mql.addEventListener) this._mql.addEventListener('change', onLayoutChange);
    else this._mql.addListener(onLayoutChange);

    // Timers are throttled in background tabs; catch up when the tab is shown again
    document.addEventListener('visibilitychange', () => {
      this.ctxCall('focus', 'sync'); // switches between the 1s display tick and the slow hidden cadence
      if (document.hidden) return;
      this.ctxCall('clock', 'tick');
      this.ctxCall('weather', 'refreshIfIdle');
    });
    window.addEventListener('online', () => this.ctxCall('weather', 'refreshIfIdle'));
    window.addEventListener('pagehide', () => this.flushSave());

    // Unlock audio on the first gesture anywhere, so a chime for a timer started in another tab
    // isn't blocked by the autoplay policy. The context is still created lazily (on that gesture).
    const unlockAudio = () => {
      if (!this.state || !this.state.enabled.focus) return; // no timer here (yet): keep waiting
      document.removeEventListener('pointerdown', unlockAudio, true);
      document.removeEventListener('keydown', unlockAudio, true);
      this.getAudioContext();
    };
    document.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
    document.addEventListener('keydown', unlockAudio, { capture: true, passive: true });

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => this.onStorageChanged(changes, area));
    }

    // Apply a deferred external update once focus leaves the widgets
    this.els.root.addEventListener('focusout', (e) => {
      if (this._pendingExternal && !this.els.root.contains(e.relatedTarget)) {
        setTimeout(() => {
          if (this._pendingExternal && !this._saveTimer) this.applyExternal(this._pendingExternal);
        }, 0);
      }
    });
  },

  ctxCall(id, fn, ...args) {
    const entry = this.cards[id];
    if (entry && typeof entry.ctx[fn] === 'function') entry.ctx[fn](...args);
  },

  // ---------------------------------------------------------------------------
  // Cards
  // ---------------------------------------------------------------------------
  renderAll() {
    for (const id of Object.keys(this.cards)) this.destroyCard(id);
    for (const def of this.DEFS) {
      if (this.state.enabled[def.id]) this.createCard(def);
    }
    this.placeAll();
  },

  createCard(def) {
    const id = def.id;
    const ctx = { alive: true, cleanup: [] };
    const bodyId = `spw-body-${id}`;
    const settingsId = `spw-settings-${id}`;

    const card = this.el('section', { className: 'spw-card', attrs: { 'data-widget': id, 'aria-label': `${def.title} widget` } });
    const settings = this.el('div', { className: 'spw-card-settings', attrs: { id: settingsId, hidden: true } });
    const body = this.el('div', { className: 'spw-card-body', attrs: { id: bodyId } });

    let gearBtn = null;
    ctx.setSettingsOpen = (open) => {
      settings.hidden = !open;
      if (gearBtn) gearBtn.setAttribute('aria-expanded', String(open));
    };

    const build = { clock: this.buildClock, weather: this.buildWeather, focus: this.buildFocus, todo: this.buildTodo, notes: this.buildNotes }[id];
    build.call(this, body, settings, ctx);

    const actions = this.el('div', { className: 'spw-card-actions' });
    actions.appendChild(this.iconBtn('Reset position', '↺', () => this.resetPosition(id), 'spw-reset-pos'));
    if (settings.childElementCount > 0) {
      gearBtn = this.iconBtn(`${def.title} settings`, '⚙', () => ctx.setSettingsOpen(settings.hidden), 'spw-gear-btn');
      gearBtn.setAttribute('aria-expanded', 'false');
      gearBtn.setAttribute('aria-controls', settingsId);
      actions.appendChild(gearBtn);
    }
    const collapseBtn = this.iconBtn('Collapse', '▾', () => this.toggleCollapse(id), 'spw-collapse-btn');
    collapseBtn.setAttribute('aria-controls', bodyId);
    actions.appendChild(collapseBtn);
    actions.appendChild(this.iconBtn(`Hide ${def.title} widget`, '×', () => {
      this.setEnabled(id, false);
      this.els.launcher.focus();
    }, 'spw-close-btn'));

    const header = this.el('header', { className: 'spw-card-header' }, [
      this.el('h2', { className: 'spw-card-title', text: def.title }),
      actions
    ]);
    header.addEventListener('pointerdown', (e) => this.startDrag(e, id, card, header));

    card.append(header, settings, body);
    this.cards[id] = { card, ctx, body, settings, collapseBtn };
    this.applyCollapsed(id);
  },

  destroyCard(id) {
    const entry = this.cards[id];
    if (!entry) return;
    entry.ctx.alive = false;
    for (const fn of entry.ctx.cleanup) {
      try { fn(); } catch (e) { /* ignore teardown errors */ }
    }
    entry.card.remove();
    delete this.cards[id];
  },

  setEnabled(id, on) {
    this.state.enabled[id] = !!on;
    if (on && !this.cards[id]) {
      const def = this.DEFS.find(d => d.id === id);
      this.createCard(def);
      this.placeAll();
    } else if (!on) {
      this.destroyCard(id);
    }
    this.syncPicker();
    this.save();
  },

  toggleCollapse(id) {
    if (this.state.collapsed[id]) delete this.state.collapsed[id];
    else this.state.collapsed[id] = true;
    this.applyCollapsed(id);
    this.save();
  },

  applyCollapsed(id) {
    const entry = this.cards[id];
    if (!entry) return;
    const collapsed = !!this.state.collapsed[id];
    entry.card.classList.toggle('spw-collapsed', collapsed);
    entry.body.hidden = collapsed;
    if (collapsed) entry.ctx.setSettingsOpen(false);
    entry.collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    entry.collapseBtn.setAttribute('aria-label', collapsed ? 'Expand' : 'Collapse');
    entry.collapseBtn.title = collapsed ? 'Expand' : 'Collapse';
    if (typeof entry.ctx.sync === 'function') entry.ctx.sync(); // visibility changed: retune the focus tick
  },

  // True when a card is actually on screen (page visible, body expanded, not hidden by minimal mode)
  isCardShown(id) {
    const entry = this.cards[id];
    return !!entry && !document.hidden && !entry.body.hidden && entry.card.getClientRects().length > 0;
  },

  // ---------------------------------------------------------------------------
  // Placement & dragging (positions stored in vw/vh like tiles)
  // ---------------------------------------------------------------------------
  isSideLayout() {
    return this._mql.matches;
  },

  placeAll() {
    const side = this.isSideLayout();
    const { root, column } = this.els;
    root.classList.toggle('spw-shelf', !side);
    for (const { id } of this.DEFS) {
      const entry = this.cards[id];
      if (!entry) continue;
      const { card } = entry;
      const pos = this.state.positions[id];
      if (side && pos) {
        card.classList.add('spw-free');
        card.style.left = `${pos.x}vw`;
        card.style.top = `${pos.y}vh`;
        if (card.parentNode !== root) root.insertBefore(card, column);
      } else {
        card.classList.remove('spw-free');
        card.style.left = '';
        card.style.top = '';
        column.appendChild(card); // appending in DEFS order keeps a stable stack order
      }
    }
    requestAnimationFrame(() => {
      this.clampAll();
      this.ctxCall('focus', 'sync'); // the card is in the DOM now, so it can tell whether it is visible
    });
  },

  clampAll() {
    for (const { card } of Object.values(this.cards)) this.clampCard(card);
  },

  // Keep free cards fully on screen (visual only; the stored position stays the user's intent)
  clampCard(card) {
    if (!card.classList.contains('spw-free') || card.classList.contains('spw-dragging')) return;
    const r = card.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const x = this.clamp(r.left, 0, W - r.width);
    const y = this.clamp(r.top, 0, H - r.height);
    if (Math.abs(x - r.left) > 0.5) card.style.left = `${(x / W) * 100}vw`;
    if (Math.abs(y - r.top) > 0.5) card.style.top = `${(y / H) * 100}vh`;
  },

  startDrag(e, id, card, header) {
    if (!document.body.classList.contains('edit-mode-active') || !this.isSideLayout()) return;
    if (e.button !== 0 || e.target.closest('button, input, textarea, select, a')) return;
    e.preventDefault();

    const r = card.getBoundingClientRect();
    if (!card.classList.contains('spw-free')) {
      card.classList.add('spw-free');
      this.els.root.insertBefore(card, this.els.column);
    }
    card.style.left = `${r.left}px`;
    card.style.top = `${r.top}px`;
    card.classList.add('spw-dragging');

    const offX = e.clientX - r.left;
    const offY = e.clientY - r.top;
    const pointerId = e.pointerId;
    try { header.setPointerCapture(pointerId); } catch (err) { /* pointer already gone */ }

    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      card.style.left = `${this.clamp(ev.clientX - offX, 0, window.innerWidth - r.width)}px`;
      card.style.top = `${this.clamp(ev.clientY - offY, 0, window.innerHeight - r.height)}px`;
    };
    const end = (ev) => {
      if (ev && ev.pointerId !== undefined && ev.pointerId !== pointerId) return;
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', end);
      header.removeEventListener('pointercancel', end);
      header.removeEventListener('lostpointercapture', end);
      card.classList.remove('spw-dragging');
      const cr = card.getBoundingClientRect();
      const x = Math.round((cr.left / window.innerWidth) * 10000) / 100;
      const y = Math.round((cr.top / window.innerHeight) * 10000) / 100;
      this.state.positions[id] = { x, y };
      card.style.left = `${x}vw`;
      card.style.top = `${y}vh`;
      this.save();
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
    header.addEventListener('lostpointercapture', end);
  },

  resetPosition(id) {
    delete this.state.positions[id];
    this.placeAll();
    this.save();
  },

  resetPositions() {
    this.state.positions = {};
    this.placeAll();
    this.save();
  },

  // ---------------------------------------------------------------------------
  // Clock
  // ---------------------------------------------------------------------------
  clockUses24h() {
    const pref = this.state.clock.hour24;
    if (typeof pref === 'boolean') return pref;
    try {
      const hc = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
      return hc === 'h23' || hc === 'h24';
    } catch (e) {
      return false;
    }
  },

  greetingFor(hour) {
    if (hour >= 5 && hour < 12) return 'Good morning';
    if (hour >= 12 && hour < 17) return 'Good afternoon';
    return 'Good evening';
  },

  buildClock(body, settings, ctx) {
    const greet = this.el('div', { className: 'spw-clock-greeting' });
    const time = this.el('time', { className: 'spw-clock-time' });
    const date = this.el('div', { className: 'spw-clock-date' });
    body.append(greet, time, date);

    const render = () => {
      const cfg = this.state.clock;
      const now = new Date();
      time.textContent = now.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        second: cfg.seconds ? '2-digit' : undefined,
        hour12: !this.clockUses24h()
      });
      time.setAttribute('datetime', now.toISOString());
      date.hidden = !cfg.date;
      date.textContent = cfg.date ? now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : '';
      greet.hidden = !cfg.greeting;
      greet.textContent = cfg.greeting ? this.greetingFor(now.getHours()) : '';
    };

    // Align ticks to the next second/minute boundary so the display never lags
    const tick = () => {
      if (!ctx.alive) return;
      render();
      const period = this.state.clock.seconds ? 1000 : 60000;
      ctx.timer = setTimeout(tick, period - (Date.now() % period) + 25);
    };
    ctx.tick = () => {
      clearTimeout(ctx.timer);
      tick();
    };
    ctx.cleanup.push(() => clearTimeout(ctx.timer));
    tick();

    const update = (key) => (checked) => {
      this.state.clock[key] = checked;
      this.save();
      ctx.tick();
    };
    settings.append(
      this.checkboxRow('24-hour time', this.clockUses24h(), update('hour24')),
      this.checkboxRow('Show seconds', this.state.clock.seconds, update('seconds')),
      this.checkboxRow('Show date', this.state.clock.date, update('date')),
      this.checkboxRow('Show greeting', this.state.clock.greeting, update('greeting'))
    );
  },

  // ---------------------------------------------------------------------------
  // Weather (Open-Meteo, no API key)
  // ---------------------------------------------------------------------------
  weatherUnit() {
    if (this.state.weather.unit) return this.state.weather.unit;
    return ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'].includes(this.localeRegion()) ? 'f' : 'c';
  },

  formatTemp(celsius) {
    if (!Number.isFinite(celsius)) return '--';
    const v = this.weatherUnit() === 'f' ? celsius * 9 / 5 + 32 : celsius;
    return `${Math.round(v)}°`;
  },

  // WMO weather interpretation codes -> emoji + label
  weatherInfo(code, isDay = true) {
    const c = Number(code);
    if (c === 0) return { icon: isDay ? '☀️' : '\u{1F319}', label: 'Clear sky' };
    if (c === 1) return { icon: isDay ? '\u{1F324}️' : '\u{1F319}', label: 'Mainly clear' };
    if (c === 2) return { icon: isDay ? '⛅' : '☁️', label: 'Partly cloudy' };
    if (c === 3) return { icon: '☁️', label: 'Overcast' };
    if (c === 45 || c === 48) return { icon: '\u{1F32B}️', label: 'Fog' };
    if (c >= 51 && c <= 55) return { icon: '\u{1F326}️', label: 'Drizzle' };
    if (c === 56 || c === 57) return { icon: '\u{1F327}️', label: 'Freezing drizzle' };
    if (c >= 61 && c <= 65) return { icon: '\u{1F327}️', label: c === 65 ? 'Heavy rain' : 'Rain' };
    if (c === 66 || c === 67) return { icon: '\u{1F327}️', label: 'Freezing rain' };
    if (c >= 71 && c <= 75) return { icon: '\u{1F328}️', label: c === 75 ? 'Heavy snow' : 'Snow' };
    if (c === 77) return { icon: '❄️', label: 'Snow grains' };
    if (c >= 80 && c <= 82) return { icon: '\u{1F326}️', label: 'Rain showers' };
    if (c === 85 || c === 86) return { icon: '\u{1F328}️', label: 'Snow showers' };
    if (c === 95) return { icon: '⛈️', label: 'Thunderstorm' };
    if (c === 96 || c === 99) return { icon: '⛈️', label: 'Thunderstorm with hail' };
    return { icon: '\u{1F321}️', label: 'Unknown' };
  },

  async fetchJson(url, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // The abort timer also covers reading the body, so a stalled response can't hang the widget
      const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
      let data = null;
      try { data = await res.json(); } catch (e) { if (e && e.name === 'AbortError') throw e; }
      // Open-Meteo reports problems as { error: true, reason } (usually with HTTP 400)
      if (!res.ok || !data || data.error) {
        const err = new Error((data && data.reason) || `HTTP ${res.status}`);
        err.code = res.status === 429 ? 'rate' : 'http';
        throw err;
      }
      return data;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const timeout = new Error(`Request timed out after ${timeoutMs} ms`);
        timeout.code = 'timeout';
        throw timeout;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },

  // Friendly text for a failed Open-Meteo request
  weatherErrorText(err, what) {
    if (navigator.onLine === false) return "You're offline.";
    if (err && err.code === 'timeout') return `The weather service is slow to respond. Couldn't ${what}.`;
    if (err && err.code === 'rate') return `Too many requests. Couldn't ${what}; try again in a minute.`;
    return `Couldn't ${what} right now.`;
  },

  async geocode(query) {
    const lang = (navigator.language || 'en').split('-')[0];
    const params = new URLSearchParams({ name: query, count: '5', language: lang, format: 'json' });
    const data = await this.fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
    return (Array.isArray(data.results) ? data.results : [])
      .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
      .map(r => ({
        name: String(r.name || ''),
        region: [r.admin1 !== r.name ? r.admin1 : null, r.country].filter(Boolean).join(', '),
        lat: r.latitude,
        lon: r.longitude
      }));
  },

  async fetchForecast(loc) {
    const params = new URLSearchParams({
      latitude: loc.lat.toFixed(4),
      longitude: loc.lon.toFixed(4),
      current: 'temperature_2m,apparent_temperature,weather_code,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      timezone: 'auto',
      forecast_days: '4'
    });
    const data = await this.fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
    const cur = data && data.current;
    const daily = data && data.daily;
    if (!cur || !Number.isFinite(cur.temperature_2m) || !daily || !Array.isArray(daily.time)) {
      throw new Error('Unexpected forecast response');
    }
    const col = (k) => (Array.isArray(daily[k]) ? daily[k] : []);
    const codes = col('weather_code');
    const maxes = col('temperature_2m_max');
    const mins = col('temperature_2m_min');
    // Store a trimmed, metric-only copy; unit conversion happens at render time
    return {
      current: { temp: cur.temperature_2m, feels: cur.apparent_temperature, code: cur.weather_code, isDay: cur.is_day !== 0 },
      daily: daily.time.map((date, i) => ({
        date: String(date),
        code: codes[i],
        max: maxes[i],
        min: mins[i]
      }))
    };
  },

  weatherCacheKey(loc) {
    return `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
  },

  async readWeatherCache() {
    const cache = await ShortcutStorage._getStorageItem(this.WEATHER_CACHE_KEY, {});
    return cache && typeof cache === 'object' ? cache : {};
  },

  async writeWeatherCache(loc, data) {
    const cache = await this.readWeatherCache();
    const entry = { fetchedAt: Date.now(), data };
    cache[this.weatherCacheKey(loc)] = entry;
    // Profiles may use different cities; keep only the few most recent
    const keys = Object.keys(cache).sort((a, b) => (cache[b].fetchedAt || 0) - (cache[a].fetchedAt || 0));
    for (const k of keys.slice(6)) delete cache[k];
    await ShortcutStorage._setStorageItem(this.WEATHER_CACHE_KEY, cache);
    return entry;
  },

  relativeAge(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    try {
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
      if (mins < 60) return rtf.format(-mins, 'minute');
      const hours = Math.round(mins / 60);
      if (hours < 48) return rtf.format(-hours, 'hour');
      return rtf.format(-Math.round(hours / 24), 'day');
    } catch (e) {
      return `${mins} min ago`;
    }
  },

  buildWeather(body, settings, ctx) {
    ctx.reqId = 0;
    ctx.entry = null;
    ctx.note = '';
    ctx.view = '';

    // --- Settings: unit toggle + change location ---
    const unitBtns = [];
    const unitGroup = this.el('div', { className: 'spw-seg', attrs: { role: 'group', 'aria-label': 'Temperature unit' } });
    for (const u of ['c', 'f']) {
      const btn = this.el('button', {
        className: 'spw-seg-btn',
        text: u === 'c' ? '°C' : '°F',
        attrs: { type: 'button', 'aria-pressed': String(this.weatherUnit() === u) },
        on: {
          click: () => {
            this.state.weather.unit = u;
            this.save();
            unitBtns.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
            if (ctx.view === 'weather') showWeather();
          }
        }
      });
      unitBtns.push(btn);
      unitGroup.appendChild(btn);
    }
    settings.append(
      this.el('div', { className: 'spw-settings-row' }, [this.el('span', { text: 'Units' }), unitGroup]),
      this.el('button', {
        className: 'spw-text-btn',
        text: 'Change location',
        attrs: { type: 'button' },
        on: { click: () => { ctx.setSettingsOpen(false); showSearch(true); } }
      })
    );

    const status = (text, isError = false) => this.el('p', {
      className: `spw-status${isError ? ' spw-status-error' : ''}`,
      text,
      attrs: { role: 'status' }
    });

    // --- Search view: geocode a typed city and let the user pick a result ---
    const showSearch = (focus) => {
      ctx.view = 'search';
      ctx.reqId++; // drop any in-flight forecast for the old location
      const input = this.el('input', {
        className: 'spw-input',
        attrs: { type: 'search', placeholder: 'Search for a city', 'aria-label': 'City name', maxlength: '100', autocomplete: 'off', enterkeyhint: 'search' }
      });
      const results = this.el('ul', { className: 'spw-wx-results', attrs: { 'aria-label': 'Matching locations' } });
      const live = this.el('p', { className: 'spw-status', attrs: { role: 'status', 'aria-live': 'polite' } });
      let searchId = 0;

      const form = this.el('form', {
        className: 'spw-inline-form',
        on: {
          submit: async (e) => {
            e.preventDefault();
            const q = input.value.trim();
            if (q.length < 2) {
              live.textContent = 'Type at least 2 characters.';
              return;
            }
            const myId = ++searchId;
            results.replaceChildren();
            live.textContent = 'Searching…';
            try {
              const matches = await this.geocode(q);
              if (!ctx.alive || myId !== searchId) return;
              live.textContent = matches.length ? `${matches.length} result${matches.length === 1 ? '' : 's'}` : 'No places found. Try another spelling.';
              for (const m of matches) {
                const btn = this.el('button', {
                  className: 'spw-wx-result',
                  attrs: { type: 'button' },
                  on: { click: () => pick(m) }
                }, [
                  this.el('span', { className: 'spw-wx-result-name', text: m.name }),
                  this.el('span', { className: 'spw-wx-result-region', text: m.region })
                ]);
                results.appendChild(this.el('li', {}, [btn]));
              }
              const firstBtn = results.querySelector('button');
              if (firstBtn) firstBtn.focus();
            } catch (err) {
              if (!ctx.alive || myId !== searchId) return;
              live.textContent = this.weatherErrorText(err, 'search') + (navigator.onLine === false ? '' : ' Please try again.');
            }
          }
        }
      }, [input, this.el('button', { className: 'spw-btn', text: 'Search', attrs: { type: 'submit' } })]);

      const children = [
        this.el('p', { className: 'spw-wx-hint', text: 'Show local weather for a city.' }),
        form, live, results
      ];
      if (this.state.weather.location) {
        children.push(this.el('button', {
          className: 'spw-text-btn',
          text: 'Cancel',
          attrs: { type: 'button' },
          on: { click: () => ctx.load(false) }
        }));
      }
      body.replaceChildren(...children);
      if (focus) input.focus();
    };

    const pick = (loc) => {
      this.state.weather.location = { name: loc.name, region: loc.region, lat: loc.lat, lon: loc.lon };
      this.save();
      ctx.entry = null;
      ctx.load(false);
    };

    let slowTimer = null;
    ctx.cleanup.push(() => clearTimeout(slowTimer));
    const showLoading = (reqId) => {
      ctx.view = 'loading';
      const msg = status('Loading weather…');
      body.replaceChildren(msg);
      // Slow network feedback before the 8s request timeout kicks in
      clearTimeout(slowTimer);
      slowTimer = setTimeout(() => {
        if (ctx.alive && ctx.view === 'loading' && reqId === ctx.reqId) msg.textContent = 'Still loading… the connection seems slow.';
      }, 3000);
    };

    const showError = (message) => {
      ctx.view = 'error';
      body.replaceChildren(
        status(message, true),
        this.el('div', { className: 'spw-row-actions' }, [
          this.el('button', { className: 'spw-btn', text: 'Retry', attrs: { type: 'button' }, on: { click: () => ctx.load(true) } }),
          this.el('button', { className: 'spw-text-btn', text: 'Change location', attrs: { type: 'button' }, on: { click: () => showSearch(true) } })
        ])
      );
    };

    // --- Weather view: current conditions, today's hi/lo and a 3-day outlook ---
    const showWeather = () => {
      const entry = ctx.entry;
      const loc = this.state.weather.location;
      if (!entry || !loc) return;
      ctx.view = 'weather';
      const current = entry.data.current;
      const daily = Array.isArray(entry.data.daily) ? entry.data.daily : [];
      const info = this.weatherInfo(current.code, current.isDay);
      const today = daily[0] || {};
      const unitLabel = this.weatherUnit() === 'f' ? 'Fahrenheit' : 'Celsius';

      const now = this.el('div', {
        className: 'spw-wx-now',
        attrs: { role: 'group', 'aria-label': `${this.formatTemp(current.temp)} ${unitLabel}, ${info.label}` }
      }, [
        this.el('span', { className: 'spw-wx-icon', text: info.icon, attrs: { 'aria-hidden': 'true' } }),
        this.el('div', { className: 'spw-wx-main', attrs: { 'aria-hidden': 'true' } }, [
          this.el('div', { className: 'spw-wx-temp', text: this.formatTemp(current.temp) }),
          this.el('div', { className: 'spw-wx-label', text: info.label })
        ])
      ]);

      const meta = this.el('div', {
        className: 'spw-wx-meta',
        text: `Feels like ${this.formatTemp(current.feels)} · H ${this.formatTemp(today.max)} L ${this.formatTemp(today.min)}`
      });

      const place = this.el('div', { className: 'spw-wx-place', attrs: { title: [loc.name, loc.region].filter(Boolean).join(', ') } }, [
        this.el('span', { className: 'spw-wx-place-name', text: loc.name }),
        loc.region ? this.el('span', { className: 'spw-wx-place-region', text: loc.region }) : null
      ]);

      const days = this.el('ul', { className: 'spw-wx-days', attrs: { 'aria-label': '3-day forecast' } });
      for (const d of daily.slice(1, 4)) {
        const [y, m, dd] = String(d.date).split('-').map(Number);
        const dayName = new Date(y, (m || 1) - 1, dd || 1).toLocaleDateString(undefined, { weekday: 'short' });
        const di = this.weatherInfo(d.code, true);
        days.appendChild(this.el('li', {
          className: 'spw-wx-day',
          attrs: { 'aria-label': `${dayName}: ${di.label}, high ${this.formatTemp(d.max)}, low ${this.formatTemp(d.min)}` }
        }, [
          this.el('span', { className: 'spw-wx-day-name', text: dayName, attrs: { 'aria-hidden': 'true' } }),
          this.el('span', { className: 'spw-wx-day-icon', text: di.icon, attrs: { 'aria-hidden': 'true', title: di.label } }),
          this.el('span', { className: 'spw-wx-day-temps', text: `${this.formatTemp(d.max)} ${this.formatTemp(d.min)}`, attrs: { 'aria-hidden': 'true' } })
        ]));
      }

      const footerText = ctx.note
        ? `${ctx.note} (${this.relativeAge(entry.fetchedAt)})`
        : `Updated ${this.relativeAge(entry.fetchedAt)}`;
      const footer = this.el('div', { className: 'spw-wx-footer' }, [
        this.el('span', {
          className: `spw-wx-updated${ctx.note ? ' spw-status-error' : ''}`,
          text: ctx.updating ? 'Updating…' : footerText,
          attrs: { 'aria-live': 'polite' }
        }),
        this.iconBtn('Refresh weather', '↻', () => ctx.load(true), 'spw-wx-refresh')
      ]);

      body.replaceChildren(place, now, meta, days.childElementCount ? days : null, footer);
    };

    // --- Data flow: cached first, then refresh if stale; keep cached data on failure ---
    ctx.load = async (force) => {
      const loc = this.state.weather.location;
      if (!loc) {
        showSearch(false);
        return;
      }
      const reqId = ++ctx.reqId;
      const isCurrent = () => ctx.alive && reqId === ctx.reqId;
      ctx.updating = false;

      let cache = {};
      try { cache = await this.readWeatherCache(); } catch (e) { /* no cache: fetch fresh */ }
      if (!isCurrent()) return;
      const cached = cache[this.weatherCacheKey(loc)];
      if (cached && cached.data && cached.data.current && Number.isFinite(cached.fetchedAt)) {
        ctx.entry = cached;
        ctx.note = '';
      } else {
        ctx.entry = null;
      }

      const fresh = ctx.entry && Date.now() - ctx.entry.fetchedAt < this.WEATHER_TTL;
      if (fresh && !force) {
        showWeather();
        return;
      }
      if (navigator.onLine === false) {
        if (ctx.entry) {
          ctx.note = 'Offline · showing saved data';
          showWeather();
        } else {
          showError("You're offline. Weather will load when you reconnect.");
        }
        return;
      }

      if (ctx.entry) {
        ctx.updating = true;
        showWeather();
      } else {
        showLoading(reqId);
      }
      try {
        const data = await this.fetchForecast(loc);
        if (!isCurrent()) return;
        let entry = { fetchedAt: Date.now(), data };
        try {
          entry = await this.writeWeatherCache(loc, data);
        } catch (e) {
          console.warn('[ShortcutWidgets] Weather cache write failed:', e); // still show the fresh data
        }
        if (!isCurrent()) return;
        ctx.entry = entry;
        ctx.note = '';
        ctx.updating = false;
        showWeather();
      } catch (err) {
        if (!isCurrent()) return;
        ctx.updating = false;
        console.warn('[ShortcutWidgets] Weather fetch failed:', err);
        if (ctx.entry) {
          ctx.note = err && err.code === 'timeout' ? 'Slow connection · showing saved data' : "Couldn't update · showing saved data";
          showWeather();
        } else {
          showError(this.weatherErrorText(err, 'load weather'));
        }
      }
    };

    // Background refresh (tab shown again, back online, polling) must never clobber the
    // search view while the user is typing a city, nor stack on an in-flight load.
    ctx.refreshIfIdle = () => {
      if (ctx.view === 'weather' && !ctx.updating) ctx.load(false);
      else if (ctx.view === 'error') ctx.load(false);
    };

    // Re-check periodically for long-lived tabs (cheap: usually served from cache)
    const poll = setInterval(() => {
      if (!document.hidden) ctx.refreshIfIdle();
    }, this.WEATHER_POLL);
    ctx.cleanup.push(() => clearInterval(poll));

    ctx.load(false);
  },

  // ---------------------------------------------------------------------------
  // Focus timer (Pomodoro)
  //   state.focus.timer is timestamp-based: running -> endsAt, paused -> remaining (ms).
  //   Every tab derives the display from it, so reloads, sleeping tabs and new tabs agree.
  //   Session ends are resolved under a Web Lock against the stored copy, so stats are
  //   counted once and only one tab chimes (lastAlertedSessionId records who already did).
  // ---------------------------------------------------------------------------
  pad2(n) {
    return String(n).padStart(2, '0');
  },

  localDateKey(ts = Date.now()) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${this.pad2(d.getMonth() + 1)}-${this.pad2(d.getDate())}`;
  },

  formatDuration(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${this.pad2(m)}:${this.pad2(s)}` : `${this.pad2(m)}:${this.pad2(s)}`;
  },

  focusDuration(mode, f = this.state.focus) {
    return f.settings[this.FOCUS_MODES[mode].key] * 60000;
  },

  focusRemaining(f = this.state.focus, now = Date.now()) {
    const t = f.timer;
    if (t.status === 'running') return Math.max(0, t.endsAt - now);
    if (t.status === 'paused') return t.remaining;
    return this.focusDuration(t.mode, f);
  },

  // Today's stats (a stored record from another day reads as zero)
  focusToday(f = this.state.focus) {
    const today = this.localDateKey();
    return f.stats.date === today ? f.stats : { date: today, sessions: 0, minutes: 0 };
  },

  // --- Pure-ish transitions on a focus object (also applied to the freshly stored copy) ---
  focusSetMode(f, mode) {
    Object.assign(f.timer, { mode, status: 'idle', endsAt: null, remaining: null, duration: null, sessionId: null });
  },

  focusStart(f, now = Date.now()) {
    const t = f.timer;
    if (t.status === 'running') return;
    if (t.status === 'paused') {
      t.endsAt = now + t.remaining;
    } else {
      t.duration = this.focusDuration(t.mode, f);
      t.endsAt = now + t.duration;
      t.sessionId = this.uid();
    }
    t.remaining = null;
    t.status = 'running';
  },

  focusPause(f, now = Date.now()) {
    const t = f.timer;
    if (t.status !== 'running') return;
    t.remaining = Math.max(0, t.endsAt - now);
    t.endsAt = null;
    t.status = 'paused';
  },

  // Which mode follows the current one (resets the long-break cycle after a long break)
  focusFollowing(f) {
    const t = f.timer;
    if (t.mode !== 'focus') {
      if (t.mode === 'long') t.cycle = 0;
      return 'focus';
    }
    return t.cycle >= f.settings.longEvery ? 'long' : 'short';
  },

  focusSkip(f) {
    this.focusSetMode(f, this.focusFollowing(f));
  },

  focusComplete(f, now = Date.now()) {
    const t = f.timer;
    const done = { mode: t.mode, sessionId: t.sessionId, endsAt: t.endsAt };
    if (t.mode === 'focus') {
      const day = this.localDateKey(t.endsAt);
      if (f.stats.date !== day && day > f.stats.date) f.stats = { date: day, sessions: 0, minutes: 0 };
      if (f.stats.date === day) {
        f.stats.sessions = Math.min(999, f.stats.sessions + 1);
        f.stats.minutes += Math.round(t.duration / 60000);
      }
      t.cycle = Math.min(12, t.cycle + 1);
    }
    done.next = this.focusFollowing(f);
    done.late = now - done.endsAt > this.FOCUS_LATE_MS;
    this.focusSetMode(f, done.next);
    // Don't chain sessions that were never watched (no tab was open when it ended)
    done.autoStarted = f.settings.autoStart && !done.late;
    if (done.autoStarted) this.focusStart(f, now);
    return done;
  },

  // A user action in this tab: apply, persist immediately (other tabs adopt it via storage.onChanged)
  focusAct(fn) {
    fn(this.state.focus, Date.now());
    this.save('focus').catch(err => console.warn('[ShortcutWidgets] Focus timer save failed:', err));
    this.ctxCall('focus', 'sync');
  },

  // Resolve a session whose endsAt has passed. Runs under a cross-tab lock and re-reads storage,
  // so if another tab got there first we simply adopt its result.
  async focusResolveEnd() {
    if (this._focusResolving || !this.profileId) return;
    this._focusResolving = true;
    const profileId = this.profileId;
    let retry = false;
    try {
      // Let a visible tab win the race to chime; hidden tabs only step in if no one else did
      if (document.hidden) await new Promise(r => setTimeout(r, 1500));
      const run = async () => {
        if (profileId !== this.profileId || !this.state) return;
        const raw = await ShortcutStorage._getStorageItem(this.KEY_PREFIX + profileId, null);
        if (profileId !== this.profileId) return;
        const f = raw && raw.focus ? this.normalizeFocus(raw.focus) : this.state.focus;
        const now = Date.now();
        if (f.timer.status === 'running' && f.timer.endsAt <= now) {
          const done = this.focusComplete(f, now);
          const alert = f.lastAlertedSessionId !== done.sessionId;
          if (alert) f.lastAlertedSessionId = done.sessionId;
          this.state.focus = f;
          // Already under the lock: merge just the focus subtree into the stored copy
          await this.writeMerged(profileId, JSON.parse(JSON.stringify(this.state)), 'focus');
          if (alert) this.focusAlert(done);
        } else {
          this.state.focus = f; // already resolved elsewhere (or changed): adopt the stored truth
        }
      };
      if (navigator.locks && typeof navigator.locks.request === 'function') {
        await navigator.locks.request(`shortcut-plus-focus-${profileId}`, run);
      } else {
        await run();
      }
    } catch (err) {
      console.warn('[ShortcutWidgets] Focus timer update failed:', err);
      retry = true;
    } finally {
      this._focusResolving = false;
    }
    if (retry) {
      setTimeout(() => this.ctxCall('focus', 'sync'), 5000);
    } else {
      this.ctxCall('focus', 'sync');
    }
  },

  focusAlert(done) {
    const f = this.state.focus;
    const nextLabel = this.FOCUS_MODES[done.next].label.toLowerCase();
    let msg = done.mode === 'focus'
      ? `Focus session complete. Time for a ${nextLabel}.`
      : 'Break is over. Ready to focus?';
    if (done.autoStarted) msg += ` ${this.FOCUS_MODES[done.next].label} started.`;
    if (done.mode === 'focus') {
      const today = this.focusToday(f);
      if (today.sessions === f.settings.goal) msg += ` Daily goal of ${f.settings.goal} reached!`;
    }
    this.announce(msg);
    if (!f.settings.muted && !done.late) this.playChime();
    const action = done.autoStarted ? null : {
      label: `Start ${nextLabel}`,
      run: () => this.focusAct((s, now) => this.focusStart(s, now))
    };
    this.showToast(msg, action);
  },

  announce(text) {
    const live = this.els.live;
    if (!live) return;
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 60); // re-set so repeated messages are announced
  },

  // Lazily created on the first user gesture / chime (autoplay policy)
  getAudioContext() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!this._audioCtx) {
      try { this._audioCtx = new AC(); } catch (e) { return null; }
    }
    if (this._audioCtx.state === 'suspended') this._audioCtx.resume().catch(() => {});
    return this._audioCtx;
  },

  // Gentle three-note bell: soft sine partials with a long exponential decay
  playChime() {
    const ac = this.getAudioContext();
    if (!ac) return;
    try {
      const t0 = ac.currentTime + 0.05;
      const master = ac.createGain();
      master.gain.value = 0.18;
      master.connect(ac.destination);
      [[659.25, 0], [880, 0.24], [1318.5, 0.48]].forEach(([freq, at]) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(1, t0 + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 1.6);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t0 + at);
        osc.stop(t0 + at + 1.7);
      });
      setTimeout(() => { try { master.disconnect(); } catch (e) { /* already gone */ } }, 2600);
    } catch (e) {
      /* audio is a nicety; the toast still shows */
    }
  },

  showToast(message, action) {
    let toast = this.els.toast;
    if (!toast) {
      toast = this.el('div', { className: 'spw-toast', attrs: { role: 'region', 'aria-label': 'Focus timer notification', hidden: true } });
      toast.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          this.hideToast();
        }
      });
      this.els.root.appendChild(toast);
      this.els.toast = toast;
    }
    const children = [
      this.el('span', { className: 'spw-toast-icon', text: '⏱', attrs: { 'aria-hidden': 'true' } }),
      this.el('span', { className: 'spw-toast-text', text: message })
    ];
    if (action) {
      children.push(this.el('button', {
        className: 'spw-btn spw-toast-action',
        text: action.label,
        attrs: { type: 'button' },
        on: { click: () => { this.hideToast(); action.run(); } }
      }));
    }
    children.push(this.iconBtn('Dismiss', '×', () => this.hideToast(), 'spw-toast-close'));
    toast.replaceChildren(...children);
    toast.hidden = false;
    clearTimeout(this._toastTimer);
    const autoHide = () => {
      // Don't yank it away while the user is interacting with it
      if (toast.matches(':hover') || toast.contains(document.activeElement)) {
        this._toastTimer = setTimeout(autoHide, 4000);
      } else {
        this.hideToast();
      }
    };
    this._toastTimer = setTimeout(autoHide, 15000);
  },

  hideToast() {
    clearTimeout(this._toastTimer);
    const toast = this.els.toast;
    if (!toast || toast.hidden) return;
    const hadFocus = toast.contains(document.activeElement);
    toast.hidden = true;
    if (hadFocus && this.cards.focus) {
      const btn = this.cards.focus.card.querySelector('.spw-focus-primary');
      if (btn) btn.focus();
    }
  },

  setTabTitle(text) {
    // Re-capture whenever something else (e.g. a profile/title change) replaced our timer title
    if (!this._titleSet || !document.title.startsWith('⏱ ')) {
      this._baseTitle = document.title;
    }
    const want = `⏱ ${text} · ${this._baseTitle || 'New Tab'}`;
    if (document.title !== want) document.title = want;
    this._titleSet = true;
  },

  restoreTabTitle() {
    if (!this._titleSet) return;
    this._titleSet = false;
    if (!document.title.startsWith('⏱ ')) return; // title was changed since: keep it, ours is stale
    document.title = this._baseTitle || 'New Tab';
  },

  svg(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
    return node;
  },

  buildFocus(body, settings, ctx) {
    const R = 52;
    const C = 2 * Math.PI * R;

    // --- Mode switcher ---
    const modeBtns = {};
    const modes = this.el('div', { className: 'spw-seg spw-focus-modes', attrs: { role: 'group', 'aria-label': 'Timer mode' } });
    for (const [mode, def] of Object.entries(this.FOCUS_MODES)) {
      const btn = this.el('button', {
        className: 'spw-seg-btn',
        text: mode === 'focus' ? 'Focus' : mode === 'short' ? 'Short' : 'Long',
        attrs: { type: 'button', 'aria-pressed': 'false', 'aria-label': def.label },
        on: {
          click: () => {
            const t = this.state.focus.timer;
            if (t.mode === mode && t.status === 'idle') return;
            this.focusAct((f) => this.focusSetMode(f, mode));
          }
        }
      });
      modeBtns[mode] = btn;
      modes.appendChild(btn);
    }

    // --- Progress ring (SVG) with the remaining time on top ---
    const svgEl = this.svg('svg', { viewBox: '0 0 120 120', class: 'spw-focus-svg', 'aria-hidden': 'true', focusable: 'false' });
    svgEl.appendChild(this.svg('circle', { cx: 60, cy: 60, r: R, class: 'spw-focus-track' }));
    const arc = this.svg('circle', {
      cx: 60, cy: 60, r: R, class: 'spw-focus-arc',
      transform: 'rotate(-90 60 60)', 'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': '0'
    });
    svgEl.appendChild(arc);
    const timeEl = this.el('div', { className: 'spw-focus-time', attrs: { role: 'timer', 'aria-atomic': 'true' } });
    const modeEl = this.el('div', { className: 'spw-focus-mode' });
    const ring = this.el('div', { className: 'spw-focus-ring' }, [
      svgEl,
      this.el('div', { className: 'spw-focus-center' }, [timeEl, modeEl])
    ]);

    // --- Controls ---
    const primary = this.el('button', {
      className: 'spw-btn spw-focus-primary',
      attrs: { type: 'button' },
      on: {
        click: () => {
          const t = this.state.focus.timer;
          if (t.status === 'running') {
            this.focusAct((f, now) => this.focusPause(f, now));
          } else {
            if (!this.state.focus.settings.muted) this.getAudioContext(); // unlock audio with this gesture
            this.focusAct((f, now) => this.focusStart(f, now));
          }
        }
      }
    });
    const resetBtn = this.iconBtn('Reset timer', '↺', () => {
      this.focusAct((f) => this.focusSetMode(f, f.timer.mode));
      primary.focus();
    }, 'spw-focus-ctrl');
    const skipBtn = this.iconBtn('Skip to next session', '⏭', () => this.focusAct((f) => this.focusSkip(f)), 'spw-focus-ctrl');
    const controls = this.el('div', { className: 'spw-focus-controls' }, [resetBtn, primary, skipBtn]);

    // --- Today: session dots toward the daily goal + focused minutes ---
    const dots = this.el('div', { className: 'spw-focus-dots', attrs: { 'aria-hidden': 'true' } });
    const statText = this.el('div', { className: 'spw-focus-stat' });
    const stats = this.el('div', { className: 'spw-focus-today' }, [dots, statText]);

    body.append(modes, ring, controls, stats);

    // --- Settings ---
    const inputs = {};
    const numberRow = (label, key, unit) => {
      const [min, max] = this.FOCUS_LIMITS[key];
      const input = this.el('input', {
        className: 'spw-input spw-num-input',
        attrs: { type: 'number', min, max, step: 1, inputmode: 'numeric', 'aria-label': `${label}${unit ? ` (${unit})` : ''}` }
      });
      input.value = String(this.state.focus.settings[key]);
      input.addEventListener('change', () => {
        const n = Math.round(Number(input.value));
        if (input.value.trim() === '' || !Number.isFinite(n)) {
          input.value = String(this.state.focus.settings[key]);
          return;
        }
        const v = this.clamp(n, min, max);
        input.value = String(v);
        if (v === this.state.focus.settings[key]) return;
        this.focusAct((f) => { f.settings[key] = v; });
      });
      inputs[key] = input;
      return this.el('label', { className: 'spw-settings-row' }, [
        this.el('span', { text: label }),
        this.el('span', { className: 'spw-num-wrap' }, [input, unit ? this.el('span', { className: 'spw-num-unit', text: unit, attrs: { 'aria-hidden': 'true' } }) : null])
      ]);
    };
    const toggles = {};
    const toggleRow = (label, key, invert = false) => {
      const row = this.checkboxRow(label, invert ? !this.state.focus.settings[key] : !!this.state.focus.settings[key], (checked) => {
        this.focusAct((f) => { f.settings[key] = invert ? !checked : checked; });
        if (key === 'muted' && checked) this.getAudioContext(); // sound just enabled: unlock with this gesture
      });
      toggles[key] = { input: row.querySelector('input'), invert };
      return row;
    };
    settings.append(
      numberRow('Focus', 'focusMin', 'min'),
      numberRow('Short break', 'shortMin', 'min'),
      numberRow('Long break', 'longMin', 'min'),
      numberRow('Long break every', 'longEvery', 'sessions'),
      numberRow('Daily goal', 'goal', 'sessions'),
      toggleRow('Auto-start next session', 'autoStart'),
      toggleRow('Play a chime', 'muted', true),
      toggleRow('Show time in tab title', 'titleTimer')
    );
    const syncSettings = () => {
      const s = this.state.focus.settings;
      for (const [key, input] of Object.entries(inputs)) {
        if (document.activeElement !== input) input.value = String(s[key]);
      }
      for (const [key, { input, invert }] of Object.entries(toggles)) input.checked = invert ? !s[key] : !!s[key];
    };

    // --- Render (cheap; runs every second only while visible) ---
    let lastDotsKey = '';
    const render = () => {
      if (!ctx.alive) return;
      const f = this.state.focus;
      const t = f.timer;
      const now = Date.now();
      const rem = this.focusRemaining(f, now);
      const total = t.status === 'idle' ? rem : t.duration;
      const elapsed = total > 0 ? this.clamp(1 - rem / total, 0, 1) : 0;
      const modeLabel = this.FOCUS_MODES[t.mode].label;

      timeEl.textContent = this.formatDuration(rem);
      arc.setAttribute('stroke-dashoffset', (C * elapsed).toFixed(2));
      modeEl.textContent = t.status === 'paused' ? `${modeLabel} · Paused` : modeLabel;
      ring.setAttribute('data-mode', t.mode);
      ring.setAttribute('data-status', t.status);
      body.setAttribute('data-mode', t.mode);

      const label = t.status === 'running' ? 'Pause' : t.status === 'paused' ? 'Resume' : 'Start';
      if (primary.textContent !== label) primary.textContent = label;
      primary.setAttribute('aria-label', `${label} ${modeLabel.toLowerCase()} timer`);
      resetBtn.disabled = t.status === 'idle';
      for (const [mode, btn] of Object.entries(modeBtns)) btn.setAttribute('aria-pressed', String(mode === t.mode));

      const today = this.focusToday(f);
      const goal = f.settings.goal;
      const dotsKey = `${today.date}|${today.sessions}|${today.minutes}|${goal}`;
      if (dotsKey !== lastDotsKey) {
        lastDotsKey = dotsKey;
        const shown = Math.min(Math.max(goal, today.sessions), 24);
        const list = [];
        for (let i = 0; i < shown; i++) {
          list.push(this.el('span', { className: `spw-focus-dot${i < today.sessions ? ' is-done' : ''}${i >= goal ? ' is-extra' : ''}` }));
        }
        dots.replaceChildren(...list);
        stats.classList.toggle('is-goal', today.sessions >= goal);
        const mins = new Intl.NumberFormat().format(today.minutes);
        statText.textContent = today.sessions >= goal
          ? `Goal reached · ${today.sessions} sessions · ${mins} min today`
          : `${today.sessions} of ${goal} sessions · ${mins} min focused today`;
      }

      if (t.status === 'running' && f.settings.titleTimer) {
        this.setTabTitle(document.hidden ? `${Math.ceil(rem / 60000)}m` : this.formatDuration(rem));
      } else {
        this.restoreTabTitle();
      }
    };

    // --- Scheduler: one timeout, aligned to the next displayed-second change while visible,
    //     a slow cadence (title only) while hidden, and always waking at endsAt ---
    const schedule = () => {
      clearTimeout(ctx.timer);
      ctx.timer = null;
      if (!ctx.alive) return;
      const t = this.state.focus.timer;
      if (t.status !== 'running') return;
      const rem = t.endsAt - Date.now();
      if (rem <= 0) {
        this.focusResolveEnd();
        return;
      }
      const step = this.isCardShown('focus') ? (rem % 1000 || 1000) + 15 : this.FOCUS_HIDDEN_STEP;
      ctx.timer = setTimeout(() => {
        render();
        schedule();
      }, Math.min(step, rem + 15));
    };

    let lastDay = this.localDateKey();
    ctx.sync = () => {
      if (!ctx.alive) return;
      lastDay = this.localDateKey();
      render();
      schedule();
      syncSettings();
    };

    // Midnight rollover for an idle widget left open overnight (yesterday's stats read as zero)
    const dayCheck = setInterval(() => {
      if (this.localDateKey() !== lastDay) ctx.sync();
    }, 60000);

    ctx.cleanup.push(() => {
      clearTimeout(ctx.timer);
      clearInterval(dayCheck);
      this.restoreTabTitle();
    });
    ctx.sync();
  },

  // ---------------------------------------------------------------------------
  // To-do list
  // ---------------------------------------------------------------------------
  buildTodo(body, settings, ctx) {
    const input = this.el('input', {
      className: 'spw-input',
      attrs: { type: 'text', placeholder: 'Add a task', 'aria-label': 'New task', maxlength: String(this.TODO_MAX_LEN), autocomplete: 'off', enterkeyhint: 'done' }
    });
    const form = this.el('form', {
      className: 'spw-inline-form',
      on: { submit: (e) => { e.preventDefault(); add(); } }
    }, [input, this.iconBtn('Add task', '+', null, 'spw-add-btn')]);
    form.querySelector('button').type = 'submit';

    const list = this.el('ul', { className: 'spw-todo-list', attrs: { 'aria-label': 'Tasks' } });
    const empty = this.el('p', { className: 'spw-empty', text: 'Nothing to do. Enjoy your day!' });
    const count = this.el('span', { className: 'spw-todo-count', attrs: { 'aria-live': 'polite' } });
    const clearBtn = this.el('button', {
      className: 'spw-text-btn',
      text: 'Clear completed',
      attrs: { type: 'button' },
      on: {
        click: () => {
          this.state.todos = this.state.todos.filter(t => !t.done);
          this.save();
          render();
          input.focus();
        }
      }
    });
    const footer = this.el('div', { className: 'spw-todo-footer' }, [count, clearBtn]);
    body.append(form, list, empty, footer);

    const todos = () => this.state.todos;

    const add = () => {
      const text = input.value.trim().slice(0, this.TODO_MAX_LEN);
      if (!text) return;
      todos().push({ id: this.uid(), text, done: false });
      input.value = '';
      this.save();
      render();
      list.scrollTop = list.scrollHeight;
    };

    const remove = (id) => {
      const idx = todos().findIndex(t => t.id === id);
      if (idx < 0) return;
      todos().splice(idx, 1);
      this.save();
      const next = todos()[idx] || todos()[idx - 1];
      render(next ? next.id : null, 'del');
      if (!next) input.focus();
    };

    const move = (id, dir, part) => {
      const arr = todos();
      const i = arr.findIndex(t => t.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      this.save();
      render(id, part);
    };

    const startEdit = (li, t) => {
      const textEl = li.querySelector('.spw-todo-text');
      if (!textEl) return;
      const field = this.el('input', {
        className: 'spw-input spw-todo-edit-input',
        attrs: { type: 'text', maxlength: String(this.TODO_MAX_LEN), 'aria-label': 'Edit task' }
      });
      field.value = t.text;
      textEl.replaceWith(field);
      li.classList.add('is-editing');
      field.focus();
      field.select();

      let finished = false;
      const finish = (commit, refocus) => {
        if (finished) return;
        finished = true;
        const v = field.value.trim().slice(0, this.TODO_MAX_LEN);
        if (commit && v && v !== t.text) {
          t.text = v;
          this.save();
        }
        render(refocus ? t.id : null, 'edit');
      };
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation(); // cancel the edit instead of the global blur handler
          finish(false, true);
        }
      });
      field.addEventListener('blur', () => finish(true, false));
    };

    const partClass = { check: '.spw-todo-check', edit: '.spw-todo-edit', del: '.spw-todo-del' };
    const partOf = (target) => {
      if (target.closest('.spw-todo-edit')) return 'edit';
      if (target.closest('.spw-todo-del')) return 'del';
      return 'check';
    };

    const makeItem = (t) => {
      const li = this.el('li', { className: `spw-todo-item${t.done ? ' is-done' : ''}`, attrs: { 'data-id': t.id } });
      const cb = this.el('input', {
        className: 'spw-todo-check',
        attrs: { type: 'checkbox', 'aria-label': t.text, title: 'Alt+↑/↓ to reorder' }
      });
      cb.checked = t.done;
      cb.addEventListener('change', () => {
        t.done = cb.checked;
        this.save();
        render(t.id, 'check');
      });
      // Space toggles natively; make Enter toggle too (checkboxes ignore it by default)
      cb.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        cb.click();
      });
      const text = this.el('span', { className: 'spw-todo-text', text: t.text, attrs: { title: 'Double-click to edit' } });
      text.addEventListener('dblclick', () => startEdit(li, t));
      li.append(
        cb,
        text,
        this.iconBtn(`Edit task: ${t.text}`, '✎', () => startEdit(li, t), 'spw-todo-edit'),
        this.iconBtn(`Delete task: ${t.text}`, '×', () => remove(t.id), 'spw-todo-del')
      );
      // Keyboard reordering; stop propagation so the grid's arrow-key navigation stays out
      li.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        if (e.target.classList.contains('spw-todo-edit-input')) return;
        e.preventDefault();
        e.stopPropagation();
        move(t.id, e.key === 'ArrowUp' ? -1 : 1, partOf(e.target));
      });
      return li;
    };

    const render = (focusId, part) => {
      list.replaceChildren(...todos().map(makeItem));
      const total = todos().length;
      const left = todos().filter(t => !t.done).length;
      empty.hidden = total > 0;
      list.hidden = total === 0;
      count.textContent = total ? `${left} ${left === 1 ? 'task' : 'tasks'} left` : '';
      clearBtn.hidden = left === total;
      footer.hidden = total === 0;
      if (focusId) {
        const li = list.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
        const target = li && (li.querySelector(partClass[part] || partClass.check) || li.querySelector(partClass.check));
        if (target) target.focus();
      }
    };

    render();
  },

  // ---------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------
  buildNotes(body, settings, ctx) {
    const ta = this.el('textarea', {
      className: 'spw-notes-text',
      attrs: { 'aria-label': 'Notes', placeholder: 'Jot something down…', maxlength: String(this.NOTES_MAX_LEN), spellcheck: 'true', rows: '6' }
    });
    ta.value = this.state.notes.text;
    const count = this.el('span', { className: 'spw-notes-count' });
    const status = this.el('span', { className: 'spw-notes-status', attrs: { 'aria-live': 'polite' } });
    body.append(ta, this.el('div', { className: 'spw-notes-footer' }, [count, status]));

    const nf = new Intl.NumberFormat();
    const updateCount = () => {
      const n = ta.value.length;
      count.textContent = `${nf.format(n)} ${n === 1 ? 'character' : 'characters'}`;
    };
    updateCount();

    ta.addEventListener('input', () => {
      this.state.notes.text = ta.value;
      updateCount();
      status.textContent = 'Saving…';
      this.scheduleSave(600);
    });
    ta.addEventListener('blur', () => this.flushSave());

    let fadeTimer = null;
    ctx.onSaved = () => {
      if (!status.textContent) return;
      status.textContent = 'Saved';
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => { status.textContent = ''; }, 2000);
    };
    ctx.cleanup.push(() => clearTimeout(fadeTimer));
  }
};
