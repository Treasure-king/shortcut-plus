/* breaker.js - "Shortcut Breaker" brick-breaker arcade game. The bricks are the user's own shortcuts. */

const ShortcutBreaker = (() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants (logical world units; the canvas is scaled to fit at any DPR)
  // ---------------------------------------------------------------------------
  const W = 800;
  const H = 520;
  const STEP = 1 / 120;          // Fixed physics step (identical at 60 / 144 / 240 Hz)
  const MAX_FRAME = 0.1;         // Cap on accumulated frame time (avoids spiral of death)
  const COLS = 10;
  const BRICK_H = 24;
  const BRICK_GAP = 6;
  const BRICK_SIDE = 22;
  const BRICK_TOP = 58;
  const BRICK_W = (W - BRICK_SIDE * 2 - BRICK_GAP * (COLS - 1)) / COLS;
  const PADDLE_Y = H - 44;
  const PADDLE_H = 14;
  const PADDLE_W = 110;
  const PADDLE_W_WIDE = 170;
  const PADDLE_W_SMALL = 70;
  const PADDLE_KEY_SPEED = 820;
  const PADDLE_POINTER_SPEED = 2600;
  const BALL_R = 7;
  const MAX_BOUNCE_ANGLE = 1.13; // ~65deg from vertical
  const MIN_VERTICAL = 0.3;      // Minimum |vy| / speed to avoid endless horizontal bounces
  const MAX_BALLS = 12;
  const MAX_CAPSULES = 3;
  const START_LIVES = 3;
  const MAX_LIVES = 6;
  const CAPSULE_W = 34;
  const CAPSULE_H = 16;
  const CAPSULE_SPEED = 150;
  const LASER_SPEED = 900;
  const DROP_CHANCE = 0.15;
  const COIN_DROP_CHANCE = 0.14;
  const COIN_SPEED = 170;
  const COIN_R = 8;
  const MAX_COIN_DROPS = 10;
  const COIN_VALUE = 2;
  const BIG_COIN_VALUE = 5;
  const REPORT_INTERVAL = 5000;  // ms between batched mission reports while playing
  const PADDLE_SKINS = ['paddle-classic', 'paddle-neon', 'paddle-lava', 'paddle-gold'];
  const MUTE_KEY = 'shortcut_plus_game_muted';
  const HS_PREFIX = 'shortcut_plus_breaker_highscore_';
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  const POWERUPS = {
    multi: { label: 'M', name: 'Multi-ball', color: '#38bdf8', weight: 3 },
    wide: { label: 'W', name: 'Wide Paddle', color: '#34d399', weight: 3, dur: 15 },
    slow: { label: 'S', name: 'Slow-mo', color: '#a78bfa', weight: 2, dur: 9 },
    laser: { label: 'L', name: 'Laser', color: '#f43f5e', weight: 2, dur: 10 },
    sticky: { label: 'C', name: 'Catch', color: '#fbbf24', weight: 2, dur: 15 },
    fire: { label: 'F', name: 'Fireball', color: '#fb923c', weight: 1.6, dur: 8 },
    life: { label: '+', name: 'Extra Life', color: '#ff7ab6', weight: 0.7 },
    // Risk capsule: shrinks the paddle, but pays a fat score bonus if you dare to catch it
    shrink: { label: '−', name: 'Shrink (risky +300)', color: '#ef4444', weight: 1.2, dur: 10, bad: true }
  };
  const TIMED = ['wide', 'slow', 'laser', 'sticky', 'fire', 'shrink'];

  const FALLBACK_SHORTCUTS = [
    { name: 'GitHub', url: 'https://github.com' },
    { name: 'Google', url: 'https://google.com' },
    { name: 'YouTube', url: 'https://youtube.com' },
    { name: 'Reddit', url: 'https://reddit.com' },
    { name: 'Stack Overflow', url: 'https://stackoverflow.com' },
    { name: 'Wikipedia', url: 'https://wikipedia.org' },
    { name: 'Netflix', url: 'https://netflix.com' }
  ];

  // Level layouts. mask(r, c, R, C, rng) => brick present?
  const bitmap = (rows) => (r, c) => !!rows[r] && rows[r].charAt(c) === 'X';
  const INVADER = [
    '..X....X..',
    '...X..X...',
    '..XXXXXX..',
    '.XX.XX.XX.',
    'XXXXXXXXXX',
    'X.XXXXXX.X',
    'X.X....X.X',
    '...XX.XX..'
  ];
  const HEART = [
    '.XXX..XXX.',
    'XXXXXXXXXX',
    'XXXXXXXXXX',
    '.XXXXXXXX.',
    '..XXXXXX..',
    '...XXXX...',
    '....XX....'
  ];
  const PATTERNS = [
    { name: 'The Wall', extraRows: 0, mask: () => true },
    {
      name: 'Pyramid', extraRows: 1, mask: (r, c, R, C) => {
        const half = ((r + 1) / R) * (C / 2);
        return Math.abs(c - (C - 1) / 2) < half + 0.01;
      }
    },
    { name: 'Invaders', rows: INVADER.length, mask: bitmap(INVADER) },
    { name: 'Checkerboard', extraRows: 2, mask: (r, c) => (r + c) % 2 === 0 },
    { name: 'Heartbreaker', rows: HEART.length, mask: bitmap(HEART) },
    {
      name: 'Chevron', rows: 7, mask: (r, c, R, C) => {
        const d = Math.floor(Math.abs(c - (C - 1) / 2));
        return r >= d && r <= d + 2;
      }
    },
    { name: 'Stripes', extraRows: 3, mask: (r) => r % 2 === 0 },
    { name: 'Tunnel', extraRows: 3, mask: (r, c, R, C) => r === 0 || c <= 2 || c >= C - 3 },
    {
      name: 'Diamond', extraRows: 2, mask: (r, c, R, C) => {
        const dr = Math.abs(r - (R - 1) / 2) / (R / 2);
        const dc = Math.abs(c - (C - 1) / 2) / (C / 2);
        return dr + dc <= 1.08;
      }
    },
    { name: 'Pillars', extraRows: 1, mask: (r, c) => c % 3 !== 2 },
    { name: 'Zig-Zag', extraRows: 1, mask: (r, c) => (c + r) % 4 !== 3 },
    {
      name: 'Fortress', extraRows: 2, mask: (r, c, R, C) => r === 0 || r === R - 1 || c === 0 || c === C - 1 ||
        (r > 1 && r < R - 2 && c > 2 && c < C - 3)
    },
    {
      name: 'Scatter', extraRows: 2, mask: (r, c, R, C, rng) => {
        // Mirrored random so it still looks designed
        const mc = c < C / 2 ? c : C - 1 - c;
        return rng.cell(r, mc) > 0.32;
      }
    }
  ];

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  function hashStr(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.cell = (r, c) => (hashStr(`${seed}:${r}:${c}`) % 10000) / 10000;
    return next;
  }

  function getHost(url) {
    if (typeof FaviconResolver !== 'undefined') return FaviconResolver.getHostname(url);
    try {
      return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./i, '');
    } catch (e) {
      return String(url || '');
    }
  }

  function getFavicon(url) {
    if (typeof FaviconResolver !== 'undefined') return FaviconResolver.getFaviconUrl(url);
    const host = getHost(url);
    return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : '';
  }

  function roundRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svgIcon(shapes, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    shapes.forEach(([tag, attrs]) => {
      const s = document.createElementNS(SVG_NS, tag);
      Object.keys(attrs).forEach(k => s.setAttribute(k, attrs[k]));
      svg.appendChild(s);
    });
    return svg;
  }

  const ICONS = {
    pause: [['rect', { x: '6', y: '4', width: '4', height: '16', rx: '1' }], ['rect', { x: '14', y: '4', width: '4', height: '16', rx: '1' }]],
    play: [['polygon', { points: '6 4 20 12 6 20 6 4' }]],
    sound: [['polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }], ['path', { d: 'M19 5a10 10 0 0 1 0 14' }]],
    muted: [['polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }], ['line', { x1: '23', y1: '9', x2: '17', y2: '15' }], ['line', { x1: '17', y1: '9', x2: '23', y2: '15' }]],
    expand: [['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3' }]],
    compress: [['path', { d: 'M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3' }]],
    close: [['line', { x1: '18', y1: '6', x2: '6', y2: '18' }], ['line', { x1: '6', y1: '6', x2: '18', y2: '18' }]]
  };

  // ---------------------------------------------------------------------------
  // Module state
  // ---------------------------------------------------------------------------
  const dom = {};
  let initialized = false;
  let openedAt = 0; // ignore Play activations from a key still held when the dialog opened
  let ctx = null;
  let bgCanvas = null;
  let scale = 1;
  let resizeObs = null;
  let rafId = null;
  let lastFrame = 0;
  let lastReport = 0;
  let acc = 0;
  let openToken = 0;
  let returnFocus = null;
  let reducedMotion = false;
  let isMuted = false;

  // Audio
  let audioCtx = null;
  let masterGain = null;
  let noiseBuffer = null;

  // Shortcut entries + favicon image cache (keyed by host, survives re-opens)
  const imageCache = new Map();
  let entries = [];

  // Game state
  const g = {
    state: 'start',            // start | playing | paused | levelclear | gameover
    stateTime: 0,
    score: 0,
    best: 0,
    level: 1,
    lives: START_LIVES,
    combo: 0,
    maxCombo: 0,
    bricksBroken: 0,
    lastBonus: 0,
    newBest: false,
    patternName: '',
    bricks: [],
    bricksLeft: 0,
    balls: [],
    capsules: [],
    lasers: [],
    particles: [],
    texts: [],
    paddle: { x: W / 2, px: W / 2, w: PADDLE_W, vx: 0, squash: 0 },
    timers: { wide: 0, slow: 0, laser: 0, sticky: 0, fire: 0, shrink: 0 },
    timerMax: {},
    coinDrops: [],
    coins: 0,              // coins collected this run (incl. level bonuses)
    coinsDeposited: 0,     // part of `coins` already sent to ArcadeWallet
    runSeq: 0,             // bumped whenever coins reset, so stale deposit rollbacks are ignored
    levelCoins: 0,
    rep: { breaker_bricks: 0, breaker_levels: 0, breaker_powerups: 0 },
    blastQueue: [],
    blasting: false,
    paddleSkin: 'paddle-classic',
    powerScale: 1,
    laserCooldown: 0,
    shake: 0,
    banner: null,
    lifeFlash: 0,
    keys: { left: false, right: false },
    pointerX: null,
    time: 0,
    rng: Math.random
  };

  const hudCache = {};

  // ---------------------------------------------------------------------------
  // Shortcuts / favicons
  // ---------------------------------------------------------------------------
  function makeEntry(s) {
    const name = String(s.name || '').trim() || getHost(s.url) || 'Shortcut';
    const host = getHost(s.url) || name;
    const h = hashStr(host);
    const hue = h % 360;
    const sat = 62 + (h >> 9) % 18;
    const entry = {
      name,
      host,
      letter: (name.charAt(0) || '?').toUpperCase(),
      base: `hsl(${hue}, ${sat}%, 50%)`,
      light: `hsl(${hue}, ${sat + 8}%, 64%)`,
      dark: `hsl(${hue}, ${sat - 6}%, 30%)`,
      text: `hsl(${hue}, 70%, 78%)`,
      img: null
    };
    let cached = imageCache.get(host);
    if (!cached) {
      cached = { img: null, ok: false, failed: false };
      const src = getFavicon(s.url);
      if (src) {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => { cached.ok = img.naturalWidth > 0; if (!cached.ok) cached.failed = true; };
        img.onerror = () => { cached.failed = true; cached.ok = false; };
        img.src = src;
        cached.img = img;
      } else {
        cached.failed = true;
      }
      imageCache.set(host, cached);
    }
    entry.img = cached;
    return entry;
  }

  function setShortcuts(list) {
    const valid = Array.isArray(list)
      ? list.filter(s => s && typeof s.url === 'string' && s.url.trim())
      : [];
    const src = valid.length >= 3 ? valid : valid.concat(FALLBACK_SHORTCUTS);
    entries = src.map(makeEntry);
  }

  // ---------------------------------------------------------------------------
  // High score (per profile)
  // ---------------------------------------------------------------------------
  async function getProfileId() {
    try {
      if (typeof ShortcutStorage !== 'undefined') {
        return (await ShortcutStorage.getActiveProfileId()) || 'profile-default';
      }
    } catch (e) { }
    return 'profile-default';
  }

  async function highScoreKey() {
    return HS_PREFIX + await getProfileId();
  }

  async function getHighScore() {
    const key = await highScoreKey();
    try {
      if (typeof ShortcutStorage !== 'undefined') {
        const v = await ShortcutStorage._getStorageItem(key, 0);
        return typeof v === 'number' && isFinite(v) ? v : 0;
      }
      const raw = localStorage.getItem(key);
      const v = raw === null ? 0 : JSON.parse(raw);
      return typeof v === 'number' && isFinite(v) ? v : 0;
    } catch (e) {
      return 0;
    }
  }

  async function saveHighScore(score) {
    try {
      const current = await getHighScore();
      if (score <= current) return current;
      const key = await highScoreKey();
      if (typeof ShortcutStorage !== 'undefined') {
        await ShortcutStorage._setStorageItem(key, score);
      } else {
        localStorage.setItem(key, JSON.stringify(score));
      }
      return score;
    } catch (e) {
      return score;
    }
  }

  // ---------------------------------------------------------------------------
  // Audio (Web Audio, synthesized; context created lazily on first gesture)
  // ---------------------------------------------------------------------------
  function ensureAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.55;
        masterGain.connect(audioCtx.destination);
        const len = Math.floor(audioCtx.sampleRate * 0.25);
        noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => { });
    } catch (e) { }
  }

  function tone(type, f0, f1, dur, vol, delay = 0) {
    const now = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, now);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, now + dur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (e) { } };
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  function noise(dur, vol, freq, delay = 0) {
    if (!noiseBuffer) return;
    const now = audioCtx.currentTime + delay;
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 1.2;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    src.onended = () => { try { src.disconnect(); filter.disconnect(); gain.disconnect(); } catch (e) { } };
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  function sfx(name, param = 0) {
    if (isMuted || !audioCtx || audioCtx.state === 'closed') return;
    try {
      switch (name) {
        case 'paddle': tone('triangle', 420, 300, 0.09, 0.22); break;
        case 'wall': tone('square', 640, 600, 0.035, 0.05); break;
        case 'brick': {
          const f = 480 * Math.pow(2, Math.min(param, 14) / 12);
          tone('square', f, f * 1.5, 0.07, 0.1);
          noise(0.06, 0.12, 2400);
          break;
        }
        case 'hard': tone('triangle', 1250, 950, 0.06, 0.12); noise(0.03, 0.05, 5000); break;
        case 'powerup': [523, 659, 784, 1047].forEach((f, i) => tone('sine', f, f, 0.08, 0.16, i * 0.055)); break;
        case 'life': tone('sine', 660, 1320, 0.25, 0.18); tone('sine', 990, 1980, 0.25, 0.08, 0.08); break;
        case 'laser': tone('sawtooth', 1500, 320, 0.09, 0.05); break;
        case 'launch': tone('square', 300, 620, 0.08, 0.08); break;
        case 'lose': tone('sawtooth', 420, 70, 0.45, 0.2); noise(0.3, 0.1, 400); break;
        case 'level': [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone('square', f, f, 0.1, 0.07, i * 0.07)); break;
        case 'gameover': [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, f * 0.98, 0.2, 0.18, i * 0.17)); break;
        case 'ui': tone('sine', 880, 880, 0.05, 0.08); break;
        case 'coin': tone('sine', 1319, 1319, 0.06, 0.12); tone('sine', 1976, 1976, 0.1, 0.1, 0.05); break;
        case 'boom': noise(0.35, 0.28, 300); tone('sawtooth', 160, 40, 0.3, 0.14); break;
        case 'bad': tone('sawtooth', 500, 160, 0.3, 0.12); tone('square', 300, 100, 0.25, 0.05, 0.05); break;
        case 'fire': noise(0.08, 0.06, 1200); break;
        case 'mission': [784, 1047, 1319, 1568].forEach((f, i) => tone('triangle', f, f, 0.14, 0.12, i * 0.08)); break;
      }
    } catch (e) { }
  }

  function readMute() {
    try { return localStorage.getItem(MUTE_KEY) === 'true'; } catch (e) { return false; }
  }

  function toggleMute() {
    isMuted = !isMuted;
    try { localStorage.setItem(MUTE_KEY, String(isMuted)); } catch (e) { }
    // Keep the runner's in-memory flag in sync (same shared key)
    if (typeof ShortcutRunner !== 'undefined') {
      ShortcutRunner.isMuted = isMuted;
      if (typeof ShortcutRunner.updateMuteIcon === 'function') {
        try { ShortcutRunner.updateMuteIcon(); } catch (e) { }
      }
    }
    updateMuteBtn();
    if (!isMuted) { ensureAudio(); sfx('ui'); }
  }

  function updateMuteBtn() {
    if (!dom.muteBtn) return;
    dom.iconSound.style.display = isMuted ? 'none' : '';
    dom.iconMuted.style.display = isMuted ? '' : 'none';
    const label = isMuted ? 'Unmute (M)' : 'Mute (M)';
    dom.muteBtn.title = label;
    dom.muteBtn.setAttribute('aria-label', label);
    dom.muteBtn.setAttribute('aria-pressed', String(isMuted));
  }

  // ---------------------------------------------------------------------------
  // Arcade wallet integration (coins, mission events, shop perks)
  // ---------------------------------------------------------------------------
  const wallet = () => (typeof ArcadeWallet !== 'undefined' ? ArcadeWallet : null);

  function startLives() {
    const wl = wallet();
    let extra = 0;
    try { extra = wl ? Math.max(0, Math.floor(wl.getUpgradeValue('brk-up-lives') || 0)) : 0; } catch (e) { }
    return Math.min(MAX_LIVES, START_LIVES + extra);
  }

  // Equipped paddle + power-up duration upgrade, read once per game
  function loadPerks() {
    const wl = wallet();
    g.paddleSkin = 'paddle-classic';
    g.powerScale = 1;
    if (!wl) return;
    try {
      const skin = wl.getEquipped('breakerPaddle');
      if (PADDLE_SKINS.includes(skin)) g.paddleSkin = skin;
      const secs = Number(wl.getUpgradeValue('brk-up-power'));
      if (secs > 0) g.powerScale = clamp(secs / 10, 0.5, 3); // base level = 10s
    } catch (e) { }
  }

  function canOpenShop() {
    return typeof ShortcutArcade !== 'undefined' && typeof ShortcutArcade.openShop === 'function' && !!wallet();
  }

  // Sends un-banked run coins to the wallet; resolves with the new balance (or null)
  function depositCoins() {
    const wl = wallet();
    const delta = g.coins - g.coinsDeposited;
    if (!wl || delta <= 0) return Promise.resolve(wl ? wl.getCoins() : null);
    g.coinsDeposited = g.coins;
    const seq = g.runSeq;
    return wl.addCoins(delta).catch(err => {
      console.warn('[Breaker] Could not deposit coins:', err);
      // Roll back so the next deposit retries this delta (same run only)
      if (g.runSeq === seq) g.coinsDeposited = Math.max(0, g.coinsDeposited - delta);
      return null;
    });
  }

  // Batched, fire-and-forget mission progress reports (never awaited by the game loop)
  function flushReports() {
    const wl = wallet();
    if (!wl) return;
    Object.keys(g.rep).forEach(ev => {
      const n = g.rep[ev];
      if (!n) return;
      g.rep[ev] = 0;
      wl.report(ev, n).then(labels => {
        if (Array.isArray(labels)) labels.forEach(label => missionToast(label));
      }).catch(() => { });
    });
  }

  function missionToast(label) {
    if (!dom.toasts || !isOpenNow()) return;
    const t = el('div', 'brk-toast');
    t.setAttribute('role', 'status');
    const ic = el('span', 'brk-toast-icon', '🏆');
    ic.setAttribute('aria-hidden', 'true');
    const txt = el('div', 'brk-toast-text');
    txt.append(el('strong', null, 'Mission complete!'), el('span', null, String(label || '')));
    t.append(ic, txt);
    dom.toasts.appendChild(t);
    while (dom.toasts.children.length > 3) dom.toasts.firstChild.remove();
    sfx('mission');
    setTimeout(() => t.classList.add('brk-toast-out'), 2800);
    setTimeout(() => t.remove(), 3300);
  }

  function setBalance(node, value) {
    if (!node) return;
    node.replaceChildren();
    if (value === null || value === undefined || !wallet()) { node.hidden = true; return; }
    node.hidden = false;
    const coin = el('span', 'brk-coin');
    coin.setAttribute('aria-hidden', 'true');
    node.append(coin, el('span', null, `Balance: ${Math.floor(value).toLocaleString()}`));
  }

  function showBalanceAfterDeposit(node) {
    const wl = wallet();
    if (!wl) { setBalance(node, null); return; }
    const pending = g.coins - g.coinsDeposited;
    setBalance(node, wl.getCoins() + Math.max(0, pending)); // optimistic
    depositCoins().then(bal => { if (typeof bal === 'number') setBalance(node, bal); });
  }

  function openShopFromGame() {
    if (!canOpenShop()) return;
    close(); // banks coins + flushes missions, restores focus to the launcher
    try { ShortcutArcade.openShop('breaker'); } catch (e) { console.warn('[Breaker] Could not open shop:', e); }
  }

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------
  function iconButton(cls, label, icons) {
    const b = el('button', `brk-btn-icon ${cls}`);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    icons.forEach(i => b.appendChild(i));
    return b;
  }

  function kbdItem(keys, label) {
    const item = el('span', 'brk-key-item');
    keys.forEach(k => item.appendChild(el('kbd', 'brk-kbd', k)));
    item.appendChild(el('span', null, label));
    return item;
  }

  function scoreItem(label, cls) {
    const item = el('div', 'brk-score-item');
    item.appendChild(el('span', 'brk-score-label', label));
    const val = el('span', `brk-score-val${cls ? ' ' + cls : ''}`, '0');
    item.appendChild(val);
    return { item, val };
  }

  function statBox(label) {
    const box = el('div', 'brk-stat-box');
    box.appendChild(el('div', 'brk-stat-label', label));
    const num = el('div', 'brk-stat-num', '0');
    box.appendChild(num);
    return { box, num };
  }

  function primaryBtn(text, cls = '') {
    const b = el('button', `brk-primary-btn ${cls}`.trim(), text);
    b.type = 'button';
    return b;
  }

  function secondaryBtn(text) {
    const b = el('button', 'brk-secondary-btn', text);
    b.type = 'button';
    return b;
  }

  function buildDom() {
    const modal = el('div', 'brk-modal');
    modal.id = 'shortcut-breaker-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'brk-title');
    modal.setAttribute('aria-describedby', 'brk-footer-hint');

    const frame = el('div', 'brk-frame');
    modal.appendChild(frame);

    // Header
    const header = el('div', 'brk-header');
    const titleGroup = el('div', 'brk-title-group');
    const badge = el('span', 'brk-icon-badge', '🧱');
    badge.setAttribute('aria-hidden', 'true');
    const title = el('h2', 'brk-title', 'SHORTCUT BREAKER');
    title.id = 'brk-title';
    titleGroup.append(badge, title);

    const board = el('div', 'brk-scoreboard');
    const sScore = scoreItem('SCORE');
    const sBest = scoreItem('BEST', 'hi');
    const sLevel = scoreItem('LVL');
    const sLives = scoreItem('LIVES', 'lives');
    const sCoins = scoreItem('COINS', 'coins');
    sCoins.item.classList.add('brk-score-coins');
    board.append(sScore.item, sBest.item, sLevel.item, sLives.item, sCoins.item);

    const actions = el('div', 'brk-actions');
    const pauseBtn = iconButton('brk-pause-btn', 'Pause (P)', [svgIcon(ICONS.pause, 'i-pause'), svgIcon(ICONS.play, 'i-play')]);
    const iconSound = svgIcon(ICONS.sound);
    const iconMuted = svgIcon(ICONS.muted);
    const muteBtn = iconButton('brk-mute-btn', 'Mute (M)', [iconSound, iconMuted]);
    const fsBtn = iconButton('brk-fs-btn', 'Fullscreen (F)', [svgIcon(ICONS.expand, 'i-expand'), svgIcon(ICONS.compress, 'i-compress')]);
    const closeBtn = iconButton('brk-close-btn', 'Close game', [svgIcon(ICONS.close)]);
    actions.append(pauseBtn, muteBtn, fsBtn, closeBtn);
    header.append(titleGroup, board, actions);

    // Stage
    const wrap = el('div', 'brk-wrap');
    const stage = el('div', 'brk-stage');
    const canvas = el('canvas', 'brk-canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Brick breaker playfield. Use left and right arrows to move, Space to launch.');
    stage.appendChild(canvas);

    // Start overlay
    const start = el('div', 'brk-overlay brk-start');
    start.appendChild(el('div', 'brk-banner brk-banner-start', 'SHORTCUT BREAKER'));
    start.appendChild(el('p', 'brk-sub', 'Smash a wall built from your own shortcuts. Chain combos, catch power-ups and coins, beat your best. Watch out for TNT bricks!'));
    const controls = el('div', 'brk-controls-grid');
    controls.append(
      kbdItem(['←', '→'], 'or A / D / mouse / touch to move'),
      kbdItem(['Space'], 'launch ball · fire laser'),
      kbdItem(['P'], 'pause'),
      kbdItem(['M'], 'mute'),
      kbdItem(['F'], 'fullscreen'),
      kbdItem(['Esc'], 'pause · twice to quit')
    );
    start.appendChild(controls);
    const legend = el('div', 'brk-legend');
    Object.keys(POWERUPS).forEach(k => {
      const p = POWERUPS[k];
      const chip = el('span', p.bad ? 'brk-chip brk-chip-bad' : 'brk-chip');
      const dot = el('span', 'brk-chip-dot', p.label);
      dot.style.background = p.color;
      chip.append(dot, el('span', null, p.name));
      legend.appendChild(chip);
    });
    start.appendChild(legend);
    const startBest = el('div', 'brk-hint', 'Best: 0');
    const playBtn = primaryBtn('▶  Play');
    start.append(playBtn, startBest);

    // Pause overlay
    const pause = el('div', 'brk-overlay brk-pause');
    pause.appendChild(el('div', 'brk-banner brk-banner-pause', 'PAUSED'));
    const pauseActions = el('div', 'brk-actions-row');
    const resumeBtn = primaryBtn('▶  Resume');
    const pauseShopBtn = secondaryBtn('🛒  Shop');
    pauseShopBtn.setAttribute('aria-label', 'Open the Arcade shop (ends this run, coins are kept)');
    const quitBtn = secondaryBtn('Quit');
    pauseActions.append(resumeBtn, pauseShopBtn, quitBtn);
    pause.appendChild(pauseActions);
    pause.appendChild(el('div', 'brk-hint brk-hint-pill', 'Press Esc again to quit · P or Space to resume'));

    // Level clear overlay
    const clear = el('div', 'brk-overlay brk-clear');
    const clearBanner = el('div', 'brk-banner brk-banner-clear', 'LEVEL CLEAR!');
    const clearStats = el('div', 'brk-stats');
    const cBonus = statBox('Bonus');
    const cScore = statBox('Score');
    const cCombo = statBox('Best combo');
    const cCoins = statBox('Coins');
    cCoins.box.classList.add('brk-stat-coins');
    clearStats.append(cBonus.box, cScore.box, cCombo.box, cCoins.box);
    const clearBalance = el('div', 'brk-balance');
    clearBalance.hidden = true;
    const nextBtn = primaryBtn('Next level  ▶');
    clear.append(clearBanner, clearStats, clearBalance, nextBtn, el('div', 'brk-hint', 'Space / Enter to continue'));

    // Game over overlay
    const over = el('div', 'brk-overlay brk-over');
    over.appendChild(el('div', 'brk-banner brk-banner-over', 'GAME OVER'));
    const newBest = el('div', 'brk-newbest', '★ NEW BEST ★');
    const overStats = el('div', 'brk-stats');
    const oScore = statBox('Score');
    const oBest = statBox('Best');
    oBest.num.classList.add('hi');
    const oLevel = statBox('Level');
    const oCoins = statBox('Coins');
    oCoins.box.classList.add('brk-stat-coins');
    overStats.append(oScore.box, oBest.box, oLevel.box, oCoins.box);
    const overBalance = el('div', 'brk-balance');
    overBalance.hidden = true;
    const overActions = el('div', 'brk-actions-row');
    const againBtn = primaryBtn('↻  Play again');
    const overShopBtn = secondaryBtn('🛒  Shop');
    overShopBtn.setAttribute('aria-label', 'Open the Arcade shop');
    const overCloseBtn = secondaryBtn('Close');
    overActions.append(againBtn, overShopBtn, overCloseBtn);
    over.append(newBest, overStats, overBalance, overActions, el('div', 'brk-hint', 'Space / Enter to play again · Esc to close'));

    [start, pause, clear, over].forEach(o => { o.hidden = true; stage.appendChild(o); });

    const live = el('div', 'brk-sr-only');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');
    stage.appendChild(live);

    const toasts = el('div', 'brk-toasts');
    toasts.setAttribute('aria-live', 'polite');
    stage.appendChild(toasts);

    wrap.appendChild(stage);

    // Footer
    const footer = el('div', 'brk-footer');
    const list = el('div', 'brk-controls-list');
    list.append(
      kbdItem(['←', '→'], 'Move'),
      kbdItem(['Space'], 'Launch / Laser'),
      kbdItem(['P'], 'Pause'),
      kbdItem(['M'], 'Mute'),
      kbdItem(['F'], 'Fullscreen')
    );
    const hint = el('div', 'brk-tagline', 'Esc pauses · press Esc again to quit');
    hint.id = 'brk-footer-hint';
    footer.append(list, hint);

    frame.append(header, wrap, footer);
    document.body.appendChild(modal);

    Object.assign(dom, {
      modal, frame, wrap, stage, canvas, live, toasts,
      scoreVal: sScore.val, bestVal: sBest.val, levelVal: sLevel.val, livesVal: sLives.val, coinsVal: sCoins.val,
      pauseBtn, muteBtn, iconSound, iconMuted, fsBtn, closeBtn,
      start, startBest, playBtn,
      pause, resumeBtn, quitBtn, pauseShopBtn,
      clear, clearBanner, cBonus: cBonus.num, cScore: cScore.num, cCombo: cCombo.num, cCoins: cCoins.num, clearBalance, nextBtn,
      over, newBest, oScore: oScore.num, oBest: oBest.num, oLevel: oLevel.num, oCoins: oCoins.num, overBalance,
      againBtn, overShopBtn, overCloseBtn
    });
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  function bindEvents() {
    dom.playBtn.addEventListener('click', () => {
      if (performance.now() - openedAt < 350) return;
      ensureAudio();
      newGame();
    });
    dom.resumeBtn.addEventListener('click', () => resume());
    dom.quitBtn.addEventListener('click', () => close());
    dom.nextBtn.addEventListener('click', () => nextLevel());
    dom.againBtn.addEventListener('click', () => { ensureAudio(); newGame(); });
    dom.overCloseBtn.addEventListener('click', () => close());
    dom.pauseShopBtn.addEventListener('click', () => openShopFromGame());
    dom.overShopBtn.addEventListener('click', () => openShopFromGame());
    // Best effort: bank coins / missions if the tab goes away mid-run
    window.addEventListener('pagehide', () => { if (isOpenNow()) { depositCoins(); flushReports(); } });
    dom.closeBtn.addEventListener('click', () => close());
    dom.pauseBtn.addEventListener('click', () => { togglePause(); refocusIfPlaying(); });
    dom.muteBtn.addEventListener('click', () => { toggleMute(); refocusIfPlaying(); });
    dom.fsBtn.addEventListener('click', () => { toggleFullscreen(); refocusIfPlaying(); });

    dom.modal.addEventListener('click', (e) => {
      if (e.target !== dom.modal) return;
      if (g.state === 'playing') pause(); else close();
    });

    dom.modal.addEventListener('pointermove', (e) => {
      if (g.state !== 'playing') return;
      g.pointerX = toLogicalX(e.clientX);
    });

    dom.canvas.addEventListener('pointerdown', (e) => {
      ensureAudio();
      if (g.state !== 'playing') return;
      e.preventDefault();
      try { dom.canvas.focus({ preventScroll: true }); } catch (err) { }
      g.pointerX = toLogicalX(e.clientX);
      primaryAction(false);
    });
    dom.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Capture phase on window so we see keys before page-level document listeners
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden || !isOpenNow()) return;
      if (g.state === 'playing') pause();
      depositCoins();
      flushReports();
    });
    window.addEventListener('blur', () => {
      if (!isOpenNow()) return;
      g.keys.left = g.keys.right = false;
      if (g.state === 'playing') pause();
    });

    document.addEventListener('fullscreenchange', () => {
      const fs = document.fullscreenElement === dom.modal;
      dom.modal.classList.toggle('brk-fullscreen', fs);
      dom.fsBtn.title = fs ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
      dom.fsBtn.setAttribute('aria-label', dom.fsBtn.title);
      requestAnimationFrame(fit);
    });

    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotion = mq.matches;
      const onChange = (ev) => { reducedMotion = ev.matches; };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (e) { }

    if (typeof ResizeObserver !== 'undefined') {
      resizeObs = new ResizeObserver(() => fit());
    } else {
      window.addEventListener('resize', () => { if (isOpenNow()) fit(); });
    }
  }

  function refocusIfPlaying() {
    if (g.state === 'playing') focusEl(dom.canvas);
  }

  function focusEl(node) {
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch (e) { try { node.focus(); } catch (e2) { } }
  }

  function toLogicalX(clientX) {
    const rect = dom.canvas.getBoundingClientRect();
    if (!rect.width) return null;
    return ((clientX - rect.left) / rect.width) * W;
  }

  function isOpenNow() {
    return !!(dom.modal && dom.modal.classList.contains('active'));
  }

  function visibleFocusables() {
    return Array.from(dom.modal.querySelectorAll('button, [tabindex="0"]'))
      .filter(n => !n.disabled && n.getClientRects().length > 0);
  }

  function overlayButtons() {
    const o = currentOverlay();
    return o ? Array.from(o.querySelectorAll('button')).filter(b => !b.disabled && !b.hidden && b.getClientRects().length > 0) : [];
  }

  function currentOverlay() {
    switch (g.state) {
      case 'start': return dom.start;
      case 'paused': return dom.pause;
      case 'levelclear': return dom.clear;
      case 'gameover': return dom.over;
      default: return null;
    }
  }

  function onKeyDown(e) {
    if (!isOpenNow()) return;
    ensureAudio();
    // Keep page-level hotkeys from reacting while the game is open
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const code = e.code;
    const active = document.activeElement;
    const onButton = !!(active && active.tagName === 'BUTTON' && dom.modal.contains(active));

    if (e.key === 'Tab') {
      const items = visibleFocusables();
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (!dom.modal.contains(active)) {
        e.preventDefault();
        focusEl(first);
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        focusEl(last);
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        focusEl(first);
      }
      return;
    }

    if (code === 'Escape') {
      e.preventDefault();
      if (!e.repeat) handleEscape();
      return;
    }
    if (code === 'KeyM') { e.preventDefault(); if (!e.repeat) toggleMute(); return; }
    if (code === 'KeyF') { e.preventDefault(); if (!e.repeat) toggleFullscreen(); return; }
    if (code === 'KeyP') { e.preventDefault(); if (!e.repeat) togglePause(); return; }

    const isLeft = code === 'ArrowLeft' || code === 'KeyA';
    const isRight = code === 'ArrowRight' || code === 'KeyD';
    const isAction = code === 'Space' || code === 'ArrowUp' || code === 'KeyW';
    const isEnter = code === 'Enter' || code === 'NumpadEnter';

    if (g.state === 'playing') {
      if (isLeft) { e.preventDefault(); g.keys.left = true; g.pointerX = null; return; }
      if (isRight) { e.preventDefault(); g.keys.right = true; g.pointerX = null; return; }
      if (isAction || (isEnter && !onButton)) { e.preventDefault(); primaryAction(e.repeat); return; }
      if (code === 'ArrowDown') { e.preventDefault(); return; }
      return;
    }

    // Overlay screens: arrows move between overlay buttons
    if (code.startsWith('Arrow')) {
      const btns = overlayButtons();
      if (btns.length) {
        e.preventDefault();
        const idx = btns.indexOf(active);
        const dir = (code === 'ArrowLeft' || code === 'ArrowUp') ? -1 : 1;
        const next = idx < 0 ? 0 : (idx + dir + btns.length) % btns.length;
        focusEl(btns[next]);
      }
      return;
    }

    // Let a focused overlay button handle Enter / Space natively
    if ((isEnter || code === 'Space') && onButton) return;

    if (code === 'Space' || isEnter) {
      e.preventDefault();
      if (e.repeat) return;
      if (g.stateTime < 0.35) return; // Guard against accidental double-presses
      if (g.state === 'start' || g.state === 'gameover') newGame();
      else if (g.state === 'paused') resume();
      else if (g.state === 'levelclear') nextLevel();
    }
  }

  function onKeyUp(e) {
    if (!isOpenNow()) return;
    e.stopPropagation();
    const code = e.code;
    if (code === 'ArrowLeft' || code === 'KeyA') g.keys.left = false;
    if (code === 'ArrowRight' || code === 'KeyD') g.keys.right = false;
  }

  function handleEscape() {
    if (document.fullscreenElement) {
      try { document.exitFullscreen().catch(() => { }); } catch (e) { }
      return;
    }
    if (g.state === 'playing') {
      pause();
      return;
    }
    close();
  }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => { });
      } else if (dom.modal.requestFullscreen) {
        dom.modal.requestFullscreen().catch(() => { });
      }
    } catch (e) { }
  }

  // ---------------------------------------------------------------------------
  // Canvas sizing (crisp at any devicePixelRatio)
  // ---------------------------------------------------------------------------
  function fit() {
    if (!dom.wrap || !isOpenNow()) return;
    const rect = dom.wrap.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const cssW = Math.floor(Math.min(rect.width, rect.height * (W / H)));
    const cssH = Math.floor(cssW * (H / W));
    dom.stage.style.width = `${cssW}px`;
    dom.stage.style.height = `${cssH}px`;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const pw = Math.max(1, Math.round(cssW * dpr));
    const ph = Math.max(1, Math.round(cssH * dpr));
    if (dom.canvas.width !== pw || dom.canvas.height !== ph) {
      dom.canvas.width = pw;
      dom.canvas.height = ph;
      buildBackground(pw, ph);
    }
    scale = pw / W;
    render(1);
  }

  function buildBackground(pw, ph) {
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = pw;
    bgCanvas.height = ph;
    const b = bgCanvas.getContext('2d');
    const s = pw / W;
    b.setTransform(s, 0, 0, s, 0, 0);
    const grad = b.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0b1224');
    grad.addColorStop(1, '#05070f');
    b.fillStyle = grad;
    b.fillRect(0, 0, W, H);
    b.strokeStyle = 'rgba(56, 189, 248, 0.05)';
    b.lineWidth = 1;
    b.beginPath();
    for (let x = 0; x <= W; x += 40) { b.moveTo(x + 0.5, 0); b.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 40) { b.moveTo(0, y + 0.5); b.lineTo(W, y + 0.5); }
    b.stroke();
    const vig = b.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    b.fillStyle = vig;
    b.fillRect(0, 0, W, H);
    // Danger line under the paddle
    const dl = b.createLinearGradient(0, 0, W, 0);
    dl.addColorStop(0, 'rgba(244,63,94,0)');
    dl.addColorStop(0.5, 'rgba(244,63,94,0.35)');
    dl.addColorStop(1, 'rgba(244,63,94,0)');
    b.fillStyle = dl;
    b.fillRect(0, H - 3, W, 2);
  }

  // ---------------------------------------------------------------------------
  // Level generation
  // ---------------------------------------------------------------------------
  function buildLevel(level) {
    const rng = mulberry32(hashStr(`breaker-level-${level}`) ^ (entries.length * 7919));
    const pattern = PATTERNS[(level - 1) % PATTERNS.length];
    const n = Math.max(1, entries.length);
    const baseRows = clamp(Math.ceil(n / COLS) + 1, 3, 5);
    let rows = pattern.rows
      ? pattern.rows
      : Math.min(9, baseRows + (pattern.extraRows || 0) + Math.floor((level - 1) / 3));

    const make = (maskFn, R) => {
      const out = [];
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < COLS; c++) {
          if (maskFn(r, c, R, COLS, rng)) out.push({ r, c });
        }
      }
      return out;
    };

    let cells = make(pattern.mask, rows);
    if (cells.length < 12) {
      rows = Math.max(rows, 3);
      cells = make(PATTERNS[0].mask, rows);
    }

    const p2Base = level >= 2 ? Math.min(0.6, 0.14 * (level - 1)) : 0;
    const p3Base = level >= 4 ? Math.min(0.45, 0.1 * (level - 3)) : 0;
    const offset = (level - 1) * 3;

    g.bricks = cells.map(({ r, c }, i) => {
      const top = 1 - r / Math.max(1, rows - 1);
      const roll = rng();
      let hp = 1;
      if (roll < p3Base * (0.4 + top)) hp = 3;
      else if (roll < (p3Base + p2Base) * (0.5 + top)) hp = 2;
      // Special bricks: TNT (blasts its neighbours, from level 2) and coin bricks (always drop a big coin)
      const special = rng();
      let kind = 'normal';
      if (hp === 1 && level >= 2 && special < 0.07) kind = 'tnt';
      else if (special > 0.93) kind = 'coin';
      const x = BRICK_SIDE + c * (BRICK_W + BRICK_GAP);
      const y = BRICK_TOP + r * (BRICK_H + BRICK_GAP);
      // Pre-computed crack polyline for damaged multi-hit bricks
      const crack = [];
      let cx = x + BRICK_W * (0.25 + rng() * 0.5);
      let cy = y;
      for (let k = 0; k < 4; k++) {
        crack.push([cx, cy]);
        cx += (rng() - 0.5) * 14;
        cy += BRICK_H / 3;
      }
      return {
        x, y, w: BRICK_W, h: BRICK_H, r, c, kind,
        hp, maxHp: hp, alive: true, flash: 0,
        s: entries[(i + offset) % n],
        crack,
        grad: null
      };
    });
    g.bricksLeft = g.bricks.length;
    g.patternName = pattern.name;
  }

  function baseSpeed() {
    return Math.min(560, 360 + 20 * (g.level - 1));
  }

  function maxSpeed() {
    return baseSpeed() * 1.45;
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------
  function setState(s) {
    g.state = s;
    g.stateTime = 0;
    dom.start.hidden = s !== 'start';
    dom.pause.hidden = s !== 'paused';
    dom.clear.hidden = s !== 'levelclear';
    dom.over.hidden = s !== 'gameover';
    dom.modal.classList.toggle('brk-is-paused', s === 'paused');
    const paused = s === 'paused';
    dom.pauseBtn.title = paused ? 'Resume (P)' : 'Pause (P)';
    dom.pauseBtn.setAttribute('aria-label', dom.pauseBtn.title);
    dom.pauseBtn.disabled = !(s === 'playing' || s === 'paused');
  }

  function announce(text) {
    if (dom.live) dom.live.textContent = text;
  }

  function resetRound() {
    g.capsules = [];
    g.lasers = [];
    g.coinDrops = [];
    TIMED.forEach(k => { g.timers[k] = 0; });
    g.blastQueue = [];
    g.laserCooldown = 0;
    g.combo = 0;
    g.paddle.w = PADDLE_W;
    spawnServe();
  }

  function spawnServe() {
    const p = g.paddle;
    g.balls = [{
      x: p.x, y: PADDLE_Y - BALL_R - 0.5, px: p.x, py: PADDLE_Y - BALL_R - 0.5,
      vx: 0, vy: 0, speed: baseSpeed(), stuck: true, caught: false, offset: 0, trail: [], lost: false
    }];
  }

  function newGame() {
    // Bank anything left over from a previous run before resetting
    depositCoins();
    flushReports();
    loadPerks();
    g.score = 0;
    g.level = 1;
    g.lives = startLives();
    g.maxCombo = 0;
    g.bricksBroken = 0;
    g.newBest = false;
    g.coins = 0;
    g.coinsDeposited = 0;
    g.runSeq++;
    g.levelCoins = 0;
    g.particles = [];
    g.texts = [];
    g.paddle.x = g.paddle.px = W / 2;
    g.paddle.vx = 0;
    g.pointerX = null;
    buildLevel(1);
    resetRound();
    setState('playing');
    showBanner();
    acc = 0;
    lastFrame = performance.now();
    focusEl(dom.canvas);
    sfx('launch');
  }

  function nextLevel() {
    if (g.state !== 'levelclear') return;
    g.level += 1;
    g.particles = [];
    g.texts = [];
    g.levelCoins = 0;
    buildLevel(g.level);
    resetRound();
    setState('playing');
    showBanner();
    acc = 0;
    lastFrame = performance.now();
    focusEl(dom.canvas);
  }

  function showBanner() {
    g.banner = { title: `LEVEL ${g.level}`, sub: g.patternName, t: 0, dur: 1.8 };
    announce(`Level ${g.level}: ${g.patternName}. Press Space to launch.`);
  }

  function pause() {
    if (g.state !== 'playing') return;
    g.keys.left = g.keys.right = false;
    setState('paused');
    dom.pauseShopBtn.hidden = !canOpenShop();
    flushReports();
    announce('Paused. Press Escape again to quit.');
    focusEl(dom.resumeBtn);
  }

  function resume() {
    if (g.state !== 'paused') return;
    setState('playing');
    acc = 0;
    lastFrame = performance.now();
    focusEl(dom.canvas);
    announce('Resumed');
  }

  function togglePause() {
    if (g.state === 'playing') pause();
    else if (g.state === 'paused') resume();
  }

  function levelClear() {
    const bonus = 250 * g.level + g.lives * 100;
    const coinBonus = 5 + g.level * 3;
    g.lastBonus = bonus;
    g.score += bonus;
    g.coins += coinBonus;
    g.levelCoins += coinBonus;
    g.capsules = [];
    g.lasers = [];
    g.coinDrops = [];
    g.rep.breaker_levels += 1;
    setState('levelclear');
    dom.clearBanner.textContent = `LEVEL ${g.level} CLEAR!`;
    dom.cBonus.textContent = `+${bonus}`;
    dom.cScore.textContent = String(g.score);
    dom.cCombo.textContent = `x${g.maxCombo}`;
    dom.cCoins.textContent = `+${g.levelCoins}`;
    showBalanceAfterDeposit(dom.clearBalance);
    flushReports();
    sfx('level');
    confetti();
    if (g.score > g.best) {
      g.best = g.score;
      g.newBest = true;
      saveHighScore(g.score);
    }
    announce(`Level ${g.level} clear. Score ${g.score}.`);
    focusEl(dom.nextBtn);
  }

  function gameOver() {
    const isBest = g.score > g.best;
    if (isBest) g.best = g.score;
    g.newBest = g.newBest || isBest;
    if (g.score > 0) saveHighScore(g.score);
    setState('gameover');
    dom.oScore.textContent = String(g.score);
    dom.oBest.textContent = String(g.best);
    dom.oLevel.textContent = String(g.level);
    dom.oCoins.textContent = `+${g.coins}`;
    dom.overShopBtn.hidden = !canOpenShop();
    dom.newBest.hidden = !g.newBest || g.score <= 0;
    g.coinDrops = [];
    showBalanceAfterDeposit(dom.overBalance);
    flushReports();
    sfx('gameover');
    announce(`Game over. Score ${g.score}.${g.coins ? ` You earned ${g.coins} coins.` : ''}${g.newBest ? ' New best!' : ''}`);
    focusEl(dom.againBtn);
  }

  function loseLife() {
    g.lives -= 1;
    sfx('lose');
    addShake(10);
    g.lifeFlash = 1;
    if (g.lives <= 0) {
      g.lives = 0;
      gameOver();
      return;
    }
    resetRound();
    addText(W / 2, H * 0.6, 'LIFE LOST', '#f43f5e', 20, 1.2);
    announce(`Life lost. ${g.lives} left.`);
  }

  // ---------------------------------------------------------------------------
  // Actions & power-ups
  // ---------------------------------------------------------------------------
  function primaryAction(isRepeat) {
    if (g.state !== 'playing') return;
    const hasStuck = g.balls.some(b => b.stuck);
    if (hasStuck && !isRepeat) launch();
    else fireLaser();
  }

  function launch(onlyCaught = false) {
    const p = g.paddle;
    let launched = false;
    g.balls.forEach(b => {
      if (!b.stuck || (onlyCaught && !b.caught)) return;
      const rel = clamp(b.offset / (p.w / 2), -1, 1);
      let ang = rel * 0.9;
      if (Math.abs(rel) < 0.05) ang = (Math.random() - 0.5) * 0.4;
      b.vx = Math.sin(ang) * b.speed;
      b.vy = -Math.cos(ang) * b.speed;
      b.stuck = false;
      b.caught = false;
      launched = true;
    });
    if (launched) sfx('launch');
  }

  function fireLaser() {
    if (g.timers.laser <= 0 || g.laserCooldown > 0) return;
    const p = g.paddle;
    g.lasers.push({ x: p.x - p.w / 2 + 8, y: PADDLE_Y - 4 });
    g.lasers.push({ x: p.x + p.w / 2 - 8, y: PADDLE_Y - 4 });
    g.laserCooldown = 0.24;
    sfx('laser');
  }

  function pickPowerup() {
    const options = Object.keys(POWERUPS).filter(k => {
      if (k === 'life' && g.lives >= MAX_LIVES) return false;
      if (k === 'multi' && g.balls.length >= MAX_BALLS) return false;
      if (k === 'shrink' && (g.level < 2 || g.timers.shrink > 0)) return false;
      return true;
    });
    const total = options.reduce((s, k) => s + POWERUPS[k].weight, 0);
    let roll = Math.random() * total;
    for (const k of options) {
      roll -= POWERUPS[k].weight;
      if (roll <= 0) return k;
    }
    return options[0];
  }

  function maybeDrop(x, y, br) {
    const coinBrick = br && br.kind === 'coin';
    if (coinBrick || Math.random() < COIN_DROP_CHANCE) dropCoin(x, y, coinBrick || Math.random() < 0.15);
    if (g.capsules.length >= MAX_CAPSULES) return;
    if (Math.random() > DROP_CHANCE) return;
    g.capsules.push({ x, y, py: y, type: pickPowerup(), t: 0 });
  }

  function dropCoin(x, y, big) {
    if (g.coinDrops.length >= MAX_COIN_DROPS) return;
    g.coinDrops.push({
      x, y, px: x, py: y, t: Math.random() * 6,
      vx: (Math.random() - 0.5) * 60,
      value: big ? BIG_COIN_VALUE : COIN_VALUE,
      big: !!big
    });
  }

  function collectCoin(c) {
    g.coins += c.value;
    g.levelCoins += c.value;
    addText(c.x, PADDLE_Y - 16, `+${c.value}`, '#fde047', c.big ? 16 : 13, 0.8);
    burst(c.x, PADDLE_Y - 2, '#fde047', c.big ? 10 : 6, 130);
    sfx('coin');
  }

  function applyPowerup(type) {
    const def = POWERUPS[type];
    if (!def) return;
    g.rep.breaker_powerups += 1;
    addScore(def.bad ? 300 : 50);
    if (type === 'life') {
      g.lives = Math.min(MAX_LIVES, g.lives + 1);
      sfx('life');
    } else if (def.bad) {
      sfx('bad');
      addShake(6);
    } else {
      sfx('powerup');
    }
    if (type === 'multi') {
      if (g.balls.every(b => b.stuck)) launch();
      const clones = [];
      g.balls.forEach(b => {
        if (b.stuck) return;
        [-0.42, 0.42].forEach(a => {
          if (g.balls.length + clones.length >= MAX_BALLS) return;
          const cos = Math.cos(a), sin = Math.sin(a);
          const nb = {
            x: b.x, y: b.y, px: b.x, py: b.y,
            vx: b.vx * cos - b.vy * sin,
            vy: b.vx * sin + b.vy * cos,
            speed: b.speed, stuck: false, caught: false, offset: 0, trail: [], lost: false
          };
          fixAngle(nb);
          clones.push(nb);
        });
      });
      g.balls.push(...clones);
    } else if (def.dur) {
      const dur = def.bad ? def.dur : def.dur * g.powerScale;
      g.timers[type] = dur;
      g.timerMax[type] = dur;
      if (type === 'wide') g.timers.shrink = 0;
      if (type === 'shrink') g.timers.wide = 0;
    }
    addText(g.paddle.x, PADDLE_Y - 24, def.bad ? 'SHRINK!  +300' : def.name.toUpperCase(), def.color, 15, 1.1);
  }

  function onTimerExpire(type) {
    // Release any balls that were caught by Catch (the initial serve stays put)
    if (type === 'sticky') launch(true);
  }

  function addScore(pts) {
    g.score += Math.round(pts);
  }

  // ---------------------------------------------------------------------------
  // Juice
  // ---------------------------------------------------------------------------
  function addShake(amount) {
    if (reducedMotion) return;
    g.shake = Math.min(14, g.shake + amount);
  }

  function burst(x, y, color, count, speed = 220) {
    const n = reducedMotion ? Math.min(4, count) : count;
    for (let i = 0; i < n; i++) {
      if (g.particles.length > 450) g.particles.shift();
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      g.particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 60,
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        size: 2 + Math.random() * 3,
        color
      });
    }
  }

  function confetti() {
    const colors = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa'];
    const n = reducedMotion ? 10 : 90;
    for (let i = 0; i < n; i++) {
      g.particles.push({
        x: W / 2 + (Math.random() - 0.5) * 200,
        y: H * 0.45,
        vx: (Math.random() - 0.5) * 600,
        vy: -200 - Math.random() * 400,
        life: 1.2 + Math.random() * 0.8,
        max: 2,
        size: 3 + Math.random() * 3,
        color: colors[i % colors.length]
      });
    }
  }

  function addText(x, y, text, color, size = 13, life = 1.1) {
    if (g.texts.length > 8) g.texts.shift();
    g.texts.push({ x, y, text, color, size, life, max: life });
  }

  // ---------------------------------------------------------------------------
  // Physics
  // ---------------------------------------------------------------------------
  function fixAngle(b) {
    const sp = b.speed;
    const len = Math.hypot(b.vx, b.vy) || 1;
    b.vx = (b.vx / len) * sp;
    b.vy = (b.vy / len) * sp;
    if (Math.abs(b.vy) < sp * MIN_VERTICAL) {
      const sy = b.vy < 0 ? -1 : (b.vy > 0 ? 1 : -1);
      b.vy = sy * sp * MIN_VERTICAL;
      const sx = b.vx < 0 ? -1 : 1;
      b.vx = sx * Math.sqrt(Math.max(0, sp * sp - b.vy * b.vy));
    }
  }

  function collidePaddle(b) {
    const p = g.paddle;
    const l = p.x - p.w / 2;
    const r = p.x + p.w / 2;
    const t = PADDLE_Y;
    const bt = PADDLE_Y + PADDLE_H;
    const cx = clamp(b.x, l, r);
    const cy = clamp(b.y, t, bt);
    const dx = b.x - cx;
    const dy = b.y - cy;
    if (dx * dx + dy * dy >= BALL_R * BALL_R) return false;

    if (b.y <= t + PADDLE_H * 0.6) {
      // Top hit: angle depends on where the ball struck the paddle
      const rel = clamp((b.x - p.x) / (p.w / 2 + BALL_R), -1, 1);
      const ang = rel * MAX_BOUNCE_ANGLE;
      b.vx = Math.sin(ang) * b.speed;
      b.vy = -Math.cos(ang) * b.speed;
      b.y = t - BALL_R - 0.01;
      g.combo = 0;
      p.squash = 1;
      if (g.timers.sticky > 0) {
        b.stuck = true;
        b.caught = true;
        b.offset = clamp(b.x - p.x, -p.w / 2 + BALL_R, p.w / 2 - BALL_R);
      }
      sfx('paddle');
      burst(b.x, t, '#7dd3fc', 4, 120);
    } else {
      // Side hit: push out horizontally
      const side = b.x < p.x ? -1 : 1;
      b.vx = side * Math.abs(b.vx || b.speed * 0.5);
      b.x = side < 0 ? l - BALL_R - 0.01 : r + BALL_R + 0.01;
      fixAngle(b);
    }
    return true;
  }

  function hitBricks(b) {
    let best = null;
    let bestD2 = BALL_R * BALL_R;
    const bricks = g.bricks;
    for (let i = 0; i < bricks.length; i++) {
      const br = bricks[i];
      if (!br.alive) continue;
      if (b.x + BALL_R < br.x || b.x - BALL_R > br.x + br.w || b.y + BALL_R < br.y || b.y - BALL_R > br.y + br.h) continue;
      const cx = clamp(b.x, br.x, br.x + br.w);
      const cy = clamp(b.y, br.y, br.y + br.h);
      const dx = b.x - cx;
      const dy = b.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2 || (d2 === 0 && bestD2 > 0)) {
        bestD2 = d2;
        best = br;
        if (d2 === 0) break;
      }
    }
    if (!best) return false;

    const br = best;
    if (g.timers.fire > 0) {
      // Fireball: melt straight through, no bounce
      br.hp = 1;
      damageBrick(br);
      burst(b.x, b.y, '#fb923c', 6, 160);
      return true;
    }
    const cx = clamp(b.x, br.x, br.x + br.w);
    const cy = clamp(b.y, br.y, br.y + br.h);
    let nx, ny;
    const dx = b.x - cx;
    const dy = b.y - cy;
    const d = Math.hypot(dx, dy);
    if (d > 1e-4) {
      nx = dx / d;
      ny = dy / d;
      b.x = cx + nx * (BALL_R + 0.01);
      b.y = cy + ny * (BALL_R + 0.01);
    } else {
      // Center inside the brick: exit through the side of least penetration
      const pl = b.x - br.x, pr = br.x + br.w - b.x, pt = b.y - br.y, pb = br.y + br.h - b.y;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pt) { nx = 0; ny = -1; b.y = br.y - BALL_R - 0.01; }
      else if (m === pb) { nx = 0; ny = 1; b.y = br.y + br.h + BALL_R + 0.01; }
      else if (m === pl) { nx = -1; ny = 0; b.x = br.x - BALL_R - 0.01; }
      else { nx = 1; ny = 0; b.x = br.x + br.w + BALL_R + 0.01; }
    }
    const dot = b.vx * nx + b.vy * ny;
    if (dot < 0) {
      b.vx -= 2 * dot * nx;
      b.vy -= 2 * dot * ny;
    }
    fixAngle(b);
    damageBrick(br);
    return true;
  }

  function damageBrick(br) {
    br.hp -= 1;
    br.flash = 1;
    if (br.hp > 0) {
      addScore(2);
      sfx('hard');
      burst(br.x + br.w / 2, br.y + br.h / 2, '#e2e8f0', 5, 140);
      return;
    }
    br.alive = false;
    g.bricksLeft -= 1;
    g.bricksBroken += 1;
    g.rep.breaker_bricks += 1;
    g.combo += 1;
    if (g.combo > g.maxCombo) g.maxCombo = g.combo;
    const mult = 1 + Math.min(g.combo - 1, 12) * 0.25;
    const pts = 10 * br.maxHp * mult * (1 + (g.level - 1) * 0.1);
    addScore(pts);

    const cx = br.x + br.w / 2;
    const cy = br.y + br.h / 2;
    burst(cx, cy, br.s.base, 14);
    burst(cx, cy, br.s.light, 6, 90);
    addText(cx, cy, br.s.name.length > 22 ? br.s.name.slice(0, 21) + '…' : br.s.name, br.s.text, 13, 1.1);
    if (g.combo >= 3) addText(cx, cy + 16, `+${Math.round(pts)}  x${mult.toFixed(2).replace(/\.?0+$/, '')}`, '#fde68a', 11, 0.9);
    sfx('brick', g.combo);
    addShake(br.maxHp > 1 ? 5 : 2.5);
    maybeDrop(cx, cy, br);

    const top = maxSpeed();
    g.balls.forEach(b => { b.speed = Math.min(top, b.speed + 1.2); });

    if (br.kind === 'tnt') {
      g.blastQueue.push(br);
      if (!g.blasting) processBlasts();
    }
  }

  // TNT chain reactions, processed iteratively (a blast can set off more TNT)
  function processBlasts() {
    g.blasting = true;
    let guard = 0;
    while (g.blastQueue.length && guard++ < 200) {
      const b = g.blastQueue.shift();
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      burst(cx, cy, '#f97316', 26, 320);
      burst(cx, cy, '#fde047', 12, 200);
      addText(cx, cy - 10, 'BOOM!', '#fb923c', 18, 0.9);
      addShake(9);
      sfx('boom');
      for (let i = 0; i < g.bricks.length; i++) {
        const n = g.bricks[i];
        if (!n.alive || n === b) continue;
        if (Math.abs(n.r - b.r) <= 1 && Math.abs(n.c - b.c) <= 1) damageBrick(n);
      }
    }
    g.blastQueue.length = 0;
    g.blasting = false;
  }

  function moveBall(b, dt) {
    const dist = b.speed * dt;
    const n = Math.max(1, Math.ceil(dist / (BALL_R * 0.5)));
    const sdt = dt / n;
    for (let i = 0; i < n; i++) {
      b.x += b.vx * sdt;
      b.y += b.vy * sdt;

      if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); fixAngle(b); sfx('wall'); }
      else if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); fixAngle(b); sfx('wall'); }
      if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); fixAngle(b); sfx('wall'); }
      if (b.y - BALL_R > H) { b.lost = true; return; }

      if (b.vy > 0 && collidePaddle(b)) {
        if (b.stuck) return;
        continue;
      }
      hitBricks(b);
    }
  }

  function update(dt) {
    g.time += dt;
    g.stateTime += dt;

    // Cosmetic layers keep animating on overlay screens (except pause)
    updateFx(dt);
    if (g.state !== 'playing') return;

    // Timers
    TIMED.forEach(k => {
      if (g.timers[k] > 0) {
        g.timers[k] -= dt;
        if (g.timers[k] <= 0) { g.timers[k] = 0; onTimerExpire(k); }
      }
    });
    if (g.laserCooldown > 0) g.laserCooldown -= dt;
    if (g.banner) { g.banner.t += dt; if (g.banner.t > g.banner.dur) g.banner = null; }

    // Paddle
    const p = g.paddle;
    p.px = p.x;
    const targetW = g.timers.shrink > 0 ? PADDLE_W_SMALL : g.timers.wide > 0 ? PADDLE_W_WIDE : PADDLE_W;
    p.w += (targetW - p.w) * Math.min(1, dt * 10);
    const dir = (g.keys.right ? 1 : 0) - (g.keys.left ? 1 : 0);
    if (dir !== 0) {
      p.vx += (dir * PADDLE_KEY_SPEED - p.vx) * Math.min(1, dt * 18);
      p.x += p.vx * dt;
    } else if (g.pointerX !== null) {
      const diff = g.pointerX - p.x;
      const maxMove = PADDLE_POINTER_SPEED * dt;
      p.x += clamp(diff, -maxMove, maxMove);
      p.vx = 0;
    } else {
      p.vx *= Math.max(0, 1 - dt * 14);
      p.x += p.vx * dt;
    }
    const half = p.w / 2;
    if (p.x < half) { p.x = half; p.vx = 0; }
    if (p.x > W - half) { p.x = W - half; p.vx = 0; }
    if (p.squash > 0) p.squash = Math.max(0, p.squash - dt * 6);
    if (g.paddleSkin === 'paddle-lava' && !reducedMotion && Math.random() < dt * 14) {
      emitEmber(p.x + (Math.random() - 0.5) * p.w * 0.9, PADDLE_Y, Math.random() < 0.5 ? '#fb923c' : '#fde047');
    }

    // Balls
    const ts = g.timers.slow > 0 ? 0.6 : 1;
    for (let i = 0; i < g.balls.length; i++) {
      const b = g.balls[i];
      b.px = b.x;
      b.py = b.y;
      if (b.stuck) {
        b.offset = clamp(b.offset, -p.w / 2 + BALL_R, p.w / 2 - BALL_R);
        b.x = p.x + b.offset;
        b.y = PADDLE_Y - BALL_R - 0.5;
        b.trail.length = 0;
        continue;
      }
      moveBall(b, dt * ts);
      if (!reducedMotion) {
        b.trail.push(b.x, b.y);
        if (b.trail.length > 16) b.trail.splice(0, 2);
        if (g.timers.fire > 0 && Math.random() < dt * 40) emitEmber(b.x, b.y, Math.random() < 0.5 ? '#f97316' : '#fde047');
      }
      if (g.state !== 'playing') return; // A level clear can happen mid-step
    }
    if (g.bricksLeft <= 0) { levelClear(); return; }
    const before = g.balls.length;
    g.balls = g.balls.filter(b => !b.lost);
    if (before && g.balls.length === 0) { loseLife(); return; }

    // Lasers
    for (let i = g.lasers.length - 1; i >= 0; i--) {
      const l = g.lasers[i];
      const prevY = l.y;
      l.y -= LASER_SPEED * dt;
      let hit = false;
      for (let j = 0; j < g.bricks.length; j++) {
        const br = g.bricks[j];
        if (!br.alive) continue;
        if (l.x >= br.x && l.x <= br.x + br.w && l.y <= br.y + br.h && prevY >= br.y) {
          damageBrick(br);
          hit = true;
          break;
        }
      }
      if (hit) burst(l.x, l.y, '#fda4af', 4, 100);
      if (hit || l.y < -12) g.lasers.splice(i, 1);
      if (g.bricksLeft <= 0) { levelClear(); return; }
    }

    // Capsules
    for (let i = g.capsules.length - 1; i >= 0; i--) {
      const c = g.capsules[i];
      c.py = c.y;
      c.y += CAPSULE_SPEED * dt;
      c.t += dt;
      const pl = p.x - p.w / 2, pr = p.x + p.w / 2;
      if (c.y + CAPSULE_H / 2 >= PADDLE_Y && c.y - CAPSULE_H / 2 <= PADDLE_Y + PADDLE_H &&
        c.x + CAPSULE_W / 2 >= pl && c.x - CAPSULE_W / 2 <= pr) {
        g.capsules.splice(i, 1);
        applyPowerup(c.type);
        burst(c.x, PADDLE_Y, POWERUPS[c.type].color, 10, 160);
      } else if (c.y - CAPSULE_H > H) {
        g.capsules.splice(i, 1);
      }
    }

    // Coins
    for (let i = g.coinDrops.length - 1; i >= 0; i--) {
      const c = g.coinDrops[i];
      c.px = c.x;
      c.py = c.y;
      c.t += dt;
      c.y += COIN_SPEED * dt;
      c.x = clamp(c.x + c.vx * dt, COIN_R, W - COIN_R);
      c.vx *= Math.max(0, 1 - dt * 2);
      const pl = p.x - p.w / 2, pr = p.x + p.w / 2;
      if (c.y + COIN_R >= PADDLE_Y && c.y - COIN_R <= PADDLE_Y + PADDLE_H && c.x + COIN_R >= pl && c.x - COIN_R <= pr) {
        g.coinDrops.splice(i, 1);
        collectCoin(c);
      } else if (c.y - COIN_R > H) {
        g.coinDrops.splice(i, 1);
      }
    }
  }

  function emitEmber(x, y, color) {
    if (g.particles.length > 450) return;
    g.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 40,
      vy: -40 - Math.random() * 60,
      grav: -30,
      life: 0.4 + Math.random() * 0.4,
      max: 0.8,
      size: 1.5 + Math.random() * 2,
      color
    });
  }

  function updateFx(dt) {
    for (let i = g.particles.length - 1; i >= 0; i--) {
      const pt = g.particles[i];
      pt.vy += (pt.grav === undefined ? 520 : pt.grav) * dt;
      pt.vx *= 1 - dt * 1.5;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
      if (pt.life <= 0 || pt.y > H + 20) g.particles.splice(i, 1);
    }
    for (let i = g.texts.length - 1; i >= 0; i--) {
      const t = g.texts[i];
      t.y -= 34 * dt;
      t.life -= dt;
      if (t.life <= 0) g.texts.splice(i, 1);
    }
    for (let i = 0; i < g.bricks.length; i++) {
      const br = g.bricks[i];
      if (br.flash > 0) br.flash = Math.max(0, br.flash - dt * 6);
    }
    if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 40);
    if (g.lifeFlash > 0) g.lifeFlash = Math.max(0, g.lifeFlash - dt * 2);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function drawBrick(br) {
    const { x, y, w, h } = br;
    const s = br.s;
    if (!br.grad) {
      br.grad = ctx.createLinearGradient(0, y, 0, y + h);
      br.grad.addColorStop(0, s.light);
      br.grad.addColorStop(1, s.dark);
    }
    roundRectPath(ctx, x, y, w, h, 5);
    ctx.fillStyle = br.grad;
    ctx.fill();

    // Top gloss
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(x + 4, y + 2, w - 8, 3);

    // Special brick markings
    if (br.kind === 'tnt') {
      const pulse = reducedMotion ? 0.6 : 0.45 + 0.35 * Math.sin(g.time * 7 + br.c);
      roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, 4);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(249, 115, 22, ${0.55 + pulse * 0.45})`;
      ctx.stroke();
      ctx.save();
      roundRectPath(ctx, x, y, w, h, 5);
      ctx.clip();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      for (let sx = -h; sx < w; sx += 10) {
        ctx.beginPath();
        ctx.moveTo(x + sx, y + h);
        ctx.lineTo(x + sx + 5, y + h);
        ctx.lineTo(x + sx + 5 + h, y);
        ctx.lineTo(x + sx + h, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } else if (br.kind === 'coin') {
      roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, 4);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(253, 224, 71, 0.9)';
      ctx.stroke();
    }

    // Armor rim for multi-hit bricks (special bricks already have their own rim)
    if (br.kind !== 'normal') {
      // no-op
    } else if (br.maxHp > 1) {
      roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, 4);
      ctx.lineWidth = 2;
      ctx.strokeStyle = br.maxHp >= 3 ? 'rgba(253, 224, 71, 0.85)' : 'rgba(226, 232, 240, 0.7)';
      ctx.stroke();
    } else {
      roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 5);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
    }

    // Icon plate with favicon (or letter badge fallback)
    const size = h - 8;
    const ix = x + w / 2 - size / 2;
    const iy = y + 4;
    roundRectPath(ctx, ix - 2, iy - 2, size + 4, size + 4, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
    const im = s.img;
    if (im && im.ok && !im.failed) {
      try {
        ctx.drawImage(im.img, ix, iy, size, size);
      } catch (e) {
        im.failed = true;
      }
    } else {
      ctx.fillStyle = s.dark;
      ctx.font = `800 ${Math.round(size * 0.78)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.letter, ix + size / 2, iy + size / 2 + 1);
    }

    // Damage: cracks + darkening
    if (br.hp < br.maxHp) {
      const dmg = 1 - br.hp / br.maxHp;
      ctx.fillStyle = `rgba(0,0,0,${0.28 * dmg})`;
      roundRectPath(ctx, x, y, w, h, 5);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.4 * dmg})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      br.crack.forEach(([cx, cy], i) => { if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy); });
      ctx.stroke();
    }

    // Special badges (left corner)
    if (br.kind === 'tnt' || br.kind === 'coin') {
      const bx = x + 9;
      const by = y + h / 2;
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, Math.PI * 2);
      ctx.fillStyle = br.kind === 'tnt' ? '#f97316' : '#facc15';
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = `900 9px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(br.kind === 'tnt' ? '✸' : '$', bx, by + 0.5);
    }

    // HP pips
    if (br.maxHp > 1) {
      for (let i = 0; i < br.hp; i++) {
        ctx.fillStyle = br.maxHp >= 3 ? '#fde047' : '#f1f5f9';
        ctx.beginPath();
        ctx.arc(x + w - 6 - i * 5, y + h - 5, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (br.flash > 0) {
      roundRectPath(ctx, x, y, w, h, 5);
      ctx.fillStyle = `rgba(255,255,255,${br.flash * 0.6})`;
      ctx.fill();
    }
  }

  // Paddle skins (shared by the game and the shop preview). o: { time, hit, sticky, laser, shrink }
  function drawPaddleSkin(c, l, t, w, h, skin, o) {
    const time = o.time || 0;
    const hit = o.hit || 0;
    const r = h / 2;

    if (skin === 'paddle-neon') {
      const hue = reducedMotion ? 190 : 190 + 60 * Math.sin(time * 2);
      c.save();
      c.shadowColor = `hsla(${hue}, 100%, 60%, 0.95)`;
      c.shadowBlur = 14 + hit * 18;
      roundRectPath(c, l, t, w, h, r);
      c.fillStyle = '#070b1d';
      c.fill();
      const edge = c.createLinearGradient(l, 0, l + w, 0);
      edge.addColorStop(0, '#22d3ee');
      edge.addColorStop(0.5, '#e879f9');
      edge.addColorStop(1, '#22d3ee');
      c.lineWidth = 2.5 + hit * 1.5;
      c.strokeStyle = edge;
      c.stroke();
      c.restore();
      // Inner pulse line
      c.fillStyle = `hsla(${hue}, 100%, 75%, ${0.55 + hit * 0.45})`;
      c.fillRect(l + r, t + h / 2 - 1, w - r * 2, 2);
    } else if (skin === 'paddle-lava') {
      c.save();
      c.shadowColor = 'rgba(249, 115, 22, 0.75)';
      c.shadowBlur = 10 + hit * 10;
      const grad = c.createLinearGradient(0, t, 0, t + h);
      grad.addColorStop(0, '#f97316');
      grad.addColorStop(0.55, '#b91c1c');
      grad.addColorStop(1, '#450a0a');
      roundRectPath(c, l, t, w, h, r);
      c.fillStyle = grad;
      c.fill();
      c.restore();
      c.save();
      roundRectPath(c, l, t, w, h, r);
      c.clip();
      // Drifting molten blobs
      for (let i = 0; i < 5; i++) {
        const k = ((i * 0.23 + time * 0.09 * (i % 2 ? 1 : -1)) % 1 + 1) % 1;
        const bx = l + k * w;
        const by = t + h * (0.35 + 0.3 * Math.sin(time * 2 + i * 1.7));
        const rad = h * (0.7 + 0.25 * Math.sin(time * 3 + i));
        const blob = c.createRadialGradient(bx, by, 0, bx, by, rad);
        blob.addColorStop(0, 'rgba(254, 240, 138, 0.95)');
        blob.addColorStop(0.5, 'rgba(251, 146, 60, 0.55)');
        blob.addColorStop(1, 'rgba(251, 146, 60, 0)');
        c.fillStyle = blob;
        c.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
      }
      // Cooled crust cracks
      c.strokeStyle = 'rgba(28, 10, 10, 0.55)';
      c.lineWidth = 1.2;
      c.beginPath();
      for (let x = l + 10; x < l + w - 6; x += 17) {
        c.moveTo(x, t + 1);
        c.lineTo(x + 4, t + h * 0.5);
        c.lineTo(x + 1, t + h - 1);
      }
      c.stroke();
      c.restore();
      c.fillStyle = `rgba(254, 240, 138, ${0.6 + hit * 0.4})`;
      c.fillRect(l + r, t + 1, w - r * 2, 1.5);
    } else if (skin === 'paddle-gold') {
      c.save();
      c.shadowColor = 'rgba(250, 204, 21, 0.6)';
      c.shadowBlur = 8 + hit * 14;
      const grad = c.createLinearGradient(0, t, 0, t + h);
      grad.addColorStop(0, '#fef9c3');
      grad.addColorStop(0.3, '#facc15');
      grad.addColorStop(0.65, '#a16207');
      grad.addColorStop(1, '#ca8a04');
      roundRectPath(c, l, t, w, h, Math.min(4, r));
      c.fillStyle = grad;
      c.fill();
      c.restore();
      c.save();
      roundRectPath(c, l, t, w, h, Math.min(4, r));
      c.clip();
      // Sweeping specular shine
      const sweep = reducedMotion ? 0.3 : ((time * 0.45) % 1.6) - 0.3;
      const sx = l + sweep * w;
      const shine = c.createLinearGradient(sx - 18, 0, sx + 18, 0);
      shine.addColorStop(0, 'rgba(255,255,255,0)');
      shine.addColorStop(0.5, 'rgba(255,255,255,0.85)');
      shine.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = shine;
      c.beginPath();
      c.moveTo(sx - 14, t + h);
      c.lineTo(sx + 2, t + h);
      c.lineTo(sx + 14, t);
      c.lineTo(sx - 2, t);
      c.closePath();
      c.fill();
      // Stamped bar engraving
      c.strokeStyle = 'rgba(113, 63, 18, 0.55)';
      c.lineWidth = 1;
      roundRectPath(c, l + 4, t + 3, w - 8, h - 6, 2);
      c.stroke();
      c.restore();
      // Twinkles
      for (let i = 0; i < 3; i++) {
        const tw = reducedMotion ? 0.5 : Math.max(0, Math.sin(time * 3 + i * 2.1));
        if (tw < 0.2) continue;
        const px = l + w * (0.2 + 0.3 * i);
        const py = t - 2 + (i % 2) * (h + 4);
        const sz = 2 + tw * 3;
        c.fillStyle = `rgba(255, 251, 235, ${tw})`;
        c.beginPath();
        c.moveTo(px, py - sz);
        c.lineTo(px + sz * 0.3, py - sz * 0.3);
        c.lineTo(px + sz, py);
        c.lineTo(px + sz * 0.3, py + sz * 0.3);
        c.lineTo(px, py + sz);
        c.lineTo(px - sz * 0.3, py + sz * 0.3);
        c.lineTo(px - sz, py);
        c.lineTo(px - sz * 0.3, py - sz * 0.3);
        c.closePath();
        c.fill();
      }
    } else {
      // Classic blue steel
      roundRectPath(c, l - 4, t - 4, w + 8, h + 8, 10);
      c.fillStyle = `rgba(56,189,248,${0.14 + hit * 0.16})`;
      c.fill();
      const grad = c.createLinearGradient(0, t, 0, t + h);
      grad.addColorStop(0, '#7dd3fc');
      grad.addColorStop(1, '#2563eb');
      roundRectPath(c, l, t, w, h, r);
      c.fillStyle = grad;
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(l + 8, t + 2, w - 16, 2);
    }

    // Power-up state overlays (work on every skin)
    if (o.sticky) {
      roundRectPath(c, l - 2, t - 2, w + 4, h + 4, r + 2);
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(251, 191, 36, 0.9)';
      c.stroke();
    }
    if (o.shrink) {
      const a = reducedMotion ? 0.7 : 0.45 + 0.4 * Math.sin(time * 10);
      roundRectPath(c, l - 3, t - 3, w + 6, h + 6, r + 3);
      c.lineWidth = 2;
      c.strokeStyle = `rgba(239, 68, 68, ${a})`;
      c.stroke();
    }
    if (o.laser) {
      c.fillStyle = '#f43f5e';
      roundRectPath(c, l + 3, t - 6, 10, 8, 2);
      c.fill();
      roundRectPath(c, l + w - 13, t - 6, 10, 8, 2);
      c.fill();
    }
  }

  function drawPaddle(alpha) {
    const p = g.paddle;
    const x = lerp(p.px, p.x, alpha);
    const sq = p.squash;
    const w = p.w * (1 + sq * 0.06);
    const h = PADDLE_H * (1 - sq * 0.2);
    const l = x - w / 2;
    const t = PADDLE_Y + (PADDLE_H - h);
    drawPaddleSkin(ctx, l, t, w, h, g.paddleSkin, {
      time: g.time,
      hit: sq,
      sticky: g.timers.sticky > 0,
      laser: g.timers.laser > 0,
      shrink: g.timers.shrink > 0
    });
  }

  // Shop preview: draws a paddle (plus a ball) into any canvas, scaled to its bitmap size
  function renderPaddlePreview(canvas, paddleId) {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const c = canvas.getContext('2d');
    if (!c) return;
    const cw = canvas.width || 160;
    const ch = canvas.height || 64;
    const LW = 160;
    const LH = 64;
    const s = Math.min(cw / LW, ch / LH);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cw, ch);
    const bg = c.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, '#0b1224');
    bg.addColorStop(1, '#05070f');
    c.fillStyle = bg;
    c.fillRect(0, 0, cw, ch);
    c.setTransform(s, 0, 0, s, (cw - LW * s) / 2, (ch - LH * s) / 2);
    const skin = PADDLE_SKINS.includes(paddleId) ? paddleId : 'paddle-classic';
    const pw = 110;
    const ph = PADDLE_H;
    const l = (LW - pw) / 2;
    const t = LH - ph - 12;
    drawPaddleSkin(c, l, t, pw, ph, skin, { time: 0.8, hit: 0.35 });
    // Ball
    c.fillStyle = 'rgba(125, 211, 252, 0.25)';
    c.beginPath();
    c.arc(LW / 2 + 18, t - 16, BALL_R + 3, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(LW / 2 + 18, t - 16, BALL_R - 1, 0, Math.PI * 2);
    c.fill();
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawBall(b, alpha) {
    const x = b.stuck ? b.x : lerp(b.px, b.x, alpha);
    const y = b.stuck ? b.y : lerp(b.py, b.y, alpha);
    const fire = g.timers.fire > 0;
    const tr = b.trail;
    for (let i = 0; i < tr.length; i += 2) {
      const k = (i / 2 + 1) / (tr.length / 2 + 1);
      ctx.fillStyle = fire ? `rgba(249, 115, 22, ${0.4 * k})` : `rgba(125, 211, 252, ${0.22 * k})`;
      ctx.beginPath();
      ctx.arc(tr[i], tr[i + 1], BALL_R * (fire ? 0.6 + 0.7 * k : 0.4 + 0.6 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = fire ? 'rgba(251, 146, 60, 0.4)' : 'rgba(125, 211, 252, 0.25)';
    ctx.beginPath();
    ctx.arc(x, y, BALL_R + (fire ? 6 : 4), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fire ? '#fff7ed' : g.timers.slow > 0 ? '#ddd6fe' : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCapsule(c, alpha) {
    const def = POWERUPS[c.type];
    const y = lerp(c.py === undefined ? c.y : c.py, c.y, alpha);
    const x = c.x - CAPSULE_W / 2;
    const top = y - CAPSULE_H / 2;
    const pulse = reducedMotion ? 0 : Math.sin(c.t * 8) * 0.5 + 0.5;
    roundRectPath(ctx, x - 3, top - 3, CAPSULE_W + 6, CAPSULE_H + 6, 11);
    ctx.fillStyle = `rgba(255,255,255,${0.08 + pulse * 0.1})`;
    ctx.fill();
    roundRectPath(ctx, x, top, CAPSULE_W, CAPSULE_H, CAPSULE_H / 2);
    if (def.bad) {
      ctx.fillStyle = '#1f0a0f';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = def.color;
      ctx.stroke();
    } else {
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x + 6, top + 2, CAPSULE_W - 12, 2);
    }
    ctx.fillStyle = def.bad ? def.color : '#0f172a';
    ctx.font = `900 ${def.bad ? 14 : 11}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.label, c.x, y + 1);
  }

  function drawCoin(c, alpha) {
    const x = lerp(c.px === undefined ? c.x : c.px, c.x, alpha);
    const y = lerp(c.py === undefined ? c.y : c.py, c.y, alpha);
    const r = c.big ? COIN_R + 2 : COIN_R;
    const spin = reducedMotion ? 1 : Math.abs(Math.cos(c.t * 5));
    const rx = Math.max(1.5, r * spin);
    ctx.fillStyle = 'rgba(253, 224, 71, 0.18)';
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y, rx, r, 0, 0, Math.PI * 2);
    const grad = ctx.createLinearGradient(x, y - r, x, y + r);
    grad.addColorStop(0, '#fef08a');
    grad.addColorStop(1, '#ca8a04');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#a16207';
    ctx.stroke();
    if (spin > 0.5) {
      ctx.fillStyle = '#a16207';
      ctx.font = `900 ${c.big ? 11 : 9}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.big ? '5' : '$', x, y + 0.5);
    }
  }

  function drawHud() {
    // Combo (top-left)
    if (g.combo >= 2 && g.state === 'playing') {
      const mult = 1 + Math.min(g.combo - 1, 12) * 0.25;
      ctx.font = `800 14px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fde68a';
      ctx.fillText(`COMBO ${g.combo}  ×${mult.toFixed(2)}`, 16, 26);
    }
    // Active power-up timers (top-right)
    let x = W - 16;
    TIMED.slice().reverse().forEach(k => {
      const t = g.timers[k];
      if (t <= 0) return;
      const def = POWERUPS[k];
      const w = 62;
      x -= w;
      roundRectPath(ctx, x, 16, w, 20, 10);
      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = def.color;
      ctx.stroke();
      const frac = clamp(t / (g.timerMax[k] || def.dur), 0, 1);
      roundRectPath(ctx, x + 2, 32, (w - 4) * frac, 2, 1);
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.fillStyle = def.color;
      ctx.font = `800 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${def.label} ${Math.ceil(t)}s`, x + w / 2, 25);
      x -= 8;
    });

    if (g.state === 'playing' && g.balls.some(b => b.stuck && !b.caught)) {
      const a = reducedMotion ? 0.85 : 0.55 + 0.35 * Math.sin(g.time * 5);
      ctx.fillStyle = `rgba(226,232,240,${a})`;
      ctx.font = `700 13px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SPACE / CLICK TO LAUNCH', W / 2, PADDLE_Y - 64);
    } else if (g.state === 'playing' && g.balls.some(b => b.caught)) {
      ctx.fillStyle = 'rgba(253,230,138,0.8)';
      ctx.font = `700 12px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CAUGHT! SPACE / CLICK TO RELEASE', W / 2, PADDLE_Y - 64);
    }

    if (g.banner && g.state === 'playing') {
      const t = g.banner.t / g.banner.dur;
      const a = t < 0.15 ? t / 0.15 : t > 0.75 ? Math.max(0, (1 - t) / 0.25) : 1;
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 34px ${FONT}`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(2,6,23,0.85)';
      ctx.strokeText(g.banner.title, W / 2, H * 0.66);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText(g.banner.title, W / 2, H * 0.66);
      ctx.font = `700 14px ${FONT}`;
      ctx.lineWidth = 4;
      ctx.strokeText(g.banner.sub.toUpperCase(), W / 2, H * 0.66 + 28);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(g.banner.sub.toUpperCase(), W / 2, H * 0.66 + 28);
      ctx.globalAlpha = 1;
    }
  }

  function render(alpha) {
    if (!ctx || !dom.canvas.width) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, W, H);
    else { ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H); }

    ctx.save();
    if (g.shake > 0 && !reducedMotion) {
      ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
    }

    for (let i = 0; i < g.bricks.length; i++) {
      if (g.bricks[i].alive) drawBrick(g.bricks[i]);
    }
    for (let i = 0; i < g.capsules.length; i++) drawCapsule(g.capsules[i], alpha);
    for (let i = 0; i < g.coinDrops.length; i++) drawCoin(g.coinDrops[i], alpha);

    ctx.fillStyle = '#fb7185';
    for (let i = 0; i < g.lasers.length; i++) {
      const l = g.lasers[i];
      ctx.fillRect(l.x - 1.5, l.y - 10, 3, 14);
    }

    if (g.state !== 'start') {
      drawPaddle(alpha);
      for (let i = 0; i < g.balls.length; i++) drawBall(g.balls[i], alpha);
    }

    for (let i = 0; i < g.particles.length; i++) {
      const pt = g.particles[i];
      ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < g.texts.length; i++) {
      const t = g.texts[i];
      ctx.globalAlpha = clamp(t.life / t.max * 1.6, 0, 1);
      ctx.font = `800 ${t.size}px ${FONT}`;
      const tw = ctx.measureText(t.text).width;
      const tx = clamp(t.x, tw / 2 + 6, W - tw / 2 - 6);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(2,6,23,0.9)';
      ctx.strokeText(t.text, tx, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, tx, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (g.lifeFlash > 0) {
      ctx.fillStyle = `rgba(244,63,94,${g.lifeFlash * 0.22})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawHud();
  }

  function updateHud() {
    const set = (key, node, val) => {
      if (hudCache[key] !== val) { hudCache[key] = val; node.textContent = val; }
    };
    set('score', dom.scoreVal, String(g.score).padStart(5, '0'));
    set('best', dom.bestVal, String(Math.max(g.best, g.score)).padStart(5, '0'));
    set('level', dom.levelVal, String(g.level));
    set('lives', dom.livesVal, g.lives > 0 ? '♥'.repeat(g.lives) : '–');
    set('coins', dom.coinsVal, String(g.coins));
    if (hudCache.livesLabel !== g.lives) {
      hudCache.livesLabel = g.lives;
      dom.livesVal.setAttribute('aria-label', `${g.lives} lives`);
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop (fixed timestep with render interpolation)
  // ---------------------------------------------------------------------------
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (!isOpenNow()) return;
    let dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (!(dt > 0)) dt = 0;
    if (g.state === 'paused') return; // Frozen frame stays on screen under the overlay

    acc += Math.min(dt, MAX_FRAME);
    let steps = 0;
    while (acc >= STEP && steps < 16) {
      update(STEP);
      acc -= STEP;
      steps++;
      if (g.state === 'paused') break;
    }
    if (steps >= 16) acc = 0;
    render(clamp(acc / STEP, 0, 1));
    updateHud();
    if (g.state === 'playing' && now - lastReport > REPORT_INTERVAL) {
      lastReport = now;
      flushReports(); // async; never blocks the frame
    }
  }

  function startLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    lastFrame = performance.now();
    acc = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function init() {
    if (initialized) return;
    if (!document.body) return;
    buildDom();
    ctx = dom.canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }
    bindEvents();
    isMuted = readMute();
    updateMuteBtn();
    setShortcuts([]);
    initialized = true;
  }

  async function open(opts = {}) {
    init();
    if (!initialized) return;
    if (isOpenNow()) {
      const btns = overlayButtons();
      focusEl(btns[0] || dom.canvas);
      return;
    }
    const token = ++openToken;
    const active = opts.returnFocus || document.activeElement;
    returnFocus = active && active !== document.body ? active : null;

    isMuted = readMute();
    updateMuteBtn();
    dom.modal.classList.add('active');
    g.particles = [];
    g.texts = [];
    g.level = 1;
    g.score = 0;
    g.lives = startLives();
    g.combo = 0;
    g.capsules = [];
    g.lasers = [];
    g.coinDrops = [];
    g.balls = [];
    g.coins = 0;
    g.coinsDeposited = 0;
    g.runSeq++;
    loadPerks();
    buildLevel(1);
    setState('start');
    dom.startBest.textContent = `Best: ${g.best}`;
    if (resizeObs) resizeObs.observe(dom.wrap);
    fit();
    startLoop();
    openedAt = performance.now();
    focusEl(dom.playBtn);

    let list = [];
    let best = 0;
    try {
      const wl = wallet();
      [list, best] = await Promise.all([
        typeof ShortcutStorage !== 'undefined' ? ShortcutStorage.getShortcuts().catch(() => []) : Promise.resolve([]),
        getHighScore(),
        wl ? wl.load().catch(() => null) : Promise.resolve(null)
      ]);
    } catch (e) { }
    if (token !== openToken || !isOpenNow()) return;
    setShortcuts(list);
    g.best = Math.max(best || 0, 0);
    dom.startBest.textContent = `Best: ${g.best}`;
    if (g.state === 'start') {
      loadPerks();
      g.lives = startLives();
      buildLevel(1);
    }
  }

  function close() {
    if (!initialized || !isOpenNow()) return;
    openToken++;
    if (g.score > g.best && (g.state === 'playing' || g.state === 'paused' || g.state === 'levelclear')) {
      g.best = g.score;
      saveHighScore(g.score);
    }
    depositCoins();
    flushReports();
    stopLoop();
    if (dom.toasts) dom.toasts.replaceChildren();
    if (document.fullscreenElement === dom.modal) {
      try { document.exitFullscreen().catch(() => { }); } catch (e) { }
    }
    if (resizeObs) resizeObs.unobserve(dom.wrap);
    g.keys.left = g.keys.right = false;
    g.pointerX = null;
    setState('start');
    dom.start.hidden = true;
    dom.modal.classList.remove('active', 'brk-fullscreen');
    const target = returnFocus;
    returnFocus = null;
    if (target && document.contains(target) && typeof target.focus === 'function') {
      focusEl(target);
    }
  }

  return {
    init,
    open,
    close,
    get isOpen() { return isOpenNow(); },
    getHighScore,
    highScoreKey,
    renderPaddlePreview
  };
})();
