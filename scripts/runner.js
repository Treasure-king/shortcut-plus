/* runner.js - "Shortcut Runner" offline endless arcade game (V4)
 *
 * Engine notes
 *  - Fixed 120 Hz simulation step with render interpolation: identical gameplay at 60/120/144/240 Hz.
 *    All physics constants are expressed in "60 Hz frame" units (DT = 0.5 per step).
 *  - Logical world is 760x320; the canvas backing store tracks its CSS size x devicePixelRatio
 *    (ResizeObserver, device-pixel-content-box) so it is crisp on high-DPI screens and in fullscreen.
 *  - Obstacles/items live in world coordinates (wx); screen x = wx - distance.
 *  - Characters are pre-rendered per skin into offscreen frame canvases (run cycle, jump, tuck, fall,
 *    fly, duck, hurt, idle) at the current pixel scale; obstacles, items and glows are cached sprites.
 *  - Particles come from a fixed pool and HUD strings are cached, so the hot loop does not allocate.
 *  - Economy (coins, skins, trails, upgrades, consumables, missions) goes through ArcadeWallet
 *    (scripts/wallet.js). Wallet writes are fire-and-forget and batched once per run.
 *
 * Public API (used by keyboard.js / search.js / main.js / arcade.js):
 *   ShortcutRunner.init(), ShortcutRunner.open(opts), ShortcutRunner.close(), ShortcutRunner.isOpen,
 *   ShortcutRunner.renderSkinPreview(canvas, skinId, trailId, opts?)
 */

const ShortcutRunner = (() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const W = 760;
  const H = 320;
  const GROUND = 265;
  const STEP_MS = 1000 / 120;          // fixed simulation step
  const DT = STEP_MS / (1000 / 60);    // = 0.5 "60 Hz frames" per step
  const MAX_STEPS = 12;                // at most 100 ms of simulation per rendered frame
  const TAU = Math.PI * 2;

  const GRAVITY = 0.54;
  const JUMP_V = -10.5;
  const DJUMP_V = -8.8;
  const LAND_FRAMES = 36;              // worst-case frames from obstacle front reaching player to landing
  const PLAYER_X = 84;
  const PLAYER_W = 38;
  const PCX = PLAYER_X + PLAYER_W / 2; // player centre x (screen)
  const STAND_H = 52;
  const DUCK_H = 26;
  const COMBO_WINDOW = 180;            // frames (3 s) to chain the next combo event
  const NEAR_MISS_PX = 10;
  const DAY_CYCLE = 26000;             // world px per full day/night cycle
  const DAY_START = 0.12;              // start in late night, dawn arrives quickly
  const PX_PER_METER = 30;
  const MAX_PARTICLES = 360;
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  // Power-ups / economy
  const JET_FEET = GROUND - 150;       // jetpack cruising height (feet y)
  const MAGNET_R = 150;
  const HEADSTART_FRAMES = 210;        // 3.5 s jetpack burst
  const REVIVE_MS = 4000;
  const REVIVE_INVULN = 120;           // 2 s
  const LAND_INVULN = 60;              // 1 s after a jetpack landing
  const COIN_VALUE = 1;
  const TOKEN_VALUE = 5;
  const RB_N = 64;                     // rainbow trail samples

  // Character frame box (logical px); the origin is the centre of the feet
  const FW = 76;
  const FH = 88;
  const OX = 38;
  const OY = 80;

  const LS = {
    difficulty: 'shortcut_runner_difficulty',
    muted: 'shortcut_plus_game_muted',
    tutorial: 'shortcut_runner_tutorial_done',
    headStart: 'shortcut_runner_use_headstart'
  };

  const OBSTACLES = {
    block:    { w: 50,  h: 46, ground: true,  air: true,  accent: '#38bdf8' },
    wide:     { w: 100, h: 40, ground: true,  air: true,  accent: '#a78bfa' },
    tall:     { w: 50,  h: 86, ground: true,  air: true,  accent: '#f43f5e' },
    droneLow: { w: 70,  h: 30, ground: false, air: true,  accent: '#f59e0b', clearance: 34, bob: 1.5 },
    droneMid: { w: 70,  h: 30, ground: false, air: false, accent: '#38bdf8', clearance: 64, bob: 2 }
  };

  // Power-up table. `up` is the ArcadeWallet upgrade id that sets the duration (seconds).
  const POWERS = [
    { id: 'shield',  up: 'up-shield',  name: 'Shield',   color: '#fbbf24', glow: 'rgba(251,191,36,0.55)', weight: 0.24, base: 5,  burst: ['#fbbf24', '#fff7cc', '#ffffff'] },
    { id: 'magnet',  up: 'up-magnet',  name: 'Magnet',   color: '#ec4899', glow: 'rgba(236,72,153,0.5)',  weight: 0.24, base: 6,  burst: ['#ec4899', '#fbcfe8', '#ffffff'] },
    { id: 'double',  up: 'up-double',  name: '2× Coins', color: '#22c55e', glow: 'rgba(34,197,94,0.5)',   weight: 0.2,  base: 8,  burst: ['#22c55e', '#ffd200', '#ffffff'] },
    { id: 'jetpack', up: 'up-jetpack', name: 'Jetpack',  color: '#f97316', glow: 'rgba(249,115,22,0.55)', weight: 0.15, base: 4,  burst: ['#f97316', '#fde047', '#ffffff'] },
    { id: 'slowmo',  up: 'up-slowmo',  name: 'Slow-mo',  color: '#06b6d4', glow: 'rgba(6,182,212,0.55)',  weight: 0.17, base: 4,  burst: ['#06b6d4', '#a5f3fc', '#ffffff'] }
  ];
  const PW_SHIELD = 0;
  const PW_MAGNET = 1;
  const PW_DOUBLE = 2;
  const PW_JET = 3;
  const PW_SLOW = 4;
  const POWER_COUNT = POWERS.length;

  const TUTORIAL_STEPS = [
    { type: 'block',    hint: [{ k: 'SPACE' }, { t: ' or ' }, { k: 'TAP' }, { t: ' to jump over your shortcuts' }] },
    { type: 'tall',     hint: [{ t: 'Too tall? Press ' }, { k: 'SPACE' }, { t: ' again mid-air to double jump' }] },
    { type: 'droneLow', hint: [{ t: 'Hold ' }, { k: '↓' }, { t: ' or swipe down to duck under drones' }] },
    { type: 'droneMid', hint: [{ t: "High drones: don't jump, just keep running" }] }
  ];

  // Day/night palette keyframes: [phase, skyTop, skyBottom, farCity, nearCity, ground, nightFactor]
  const PALETTE = [
    [0.00, '#0b1020', '#1b2440', '#1a2440', '#111a2e', '#141c2c', 1.0],
    [0.25, '#2b3a67', '#f2a977', '#4a4e7a', '#2c3358', '#232a40', 0.25],
    [0.40, '#4f9fdc', '#cfe9f7', '#8fb3cf', '#5c7f9e', '#33435a', 0.0],
    [0.60, '#4f9fdc', '#cfe9f7', '#8fb3cf', '#5c7f9e', '#33435a', 0.0],
    [0.75, '#3b2f63', '#f08a5d', '#5b3f6e', '#3a2b4f', '#272035', 0.35],
    [1.00, '#0b1020', '#1b2440', '#1a2440', '#111a2e', '#141c2c', 1.0]
  ].map(k => [k[0], hexRgb(k[1]), hexRgb(k[2]), hexRgb(k[3]), hexRgb(k[4]), hexRgb(k[5]), k[6]]);

  // Particle palettes (module constants: no per-event array literals)
  const C_COIN = ['#ffd200', '#fff4b0'];
  const C_TOKEN = ['#ffd200', '#ffffff', '#38bdf8'];
  const C_SMASH = ['#ff007f', '#00f2fe', '#ffd200', '#ffffff'];
  const C_THRUST = ['#ffffff', '#ffd200'];
  const C_SPARK = ['#ffd200', '#ff007f', '#ffffff'];
  const C_DUST = ['rgba(255,255,255,0.5)', 'rgba(148,163,184,0.45)'];
  const C_CONFETTI = ['#ffd200', '#38bdf8', '#f43f5e', '#34d399', '#a78bfa', '#ffffff'];
  const C_SPARKLE_TRAIL = ['#ffffff', '#fde68a', '#a5f3fc', '#f0abfc', '#bbf7d0'];
  const C_FIRE = ['#fde047', '#fb923c', '#f97316', '#ef4444'];
  const C_GOLD = ['#fde047', '#fffbe6', '#facc15'];
  const C_REVIVE = ['#34d399', '#a7f3d0', '#ffffff'];
  const RAINBOW = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'];
  const COUNT_STR = ['0', '1', '2', '3', '4', '5'];

  // Fonts (constant strings)
  const F_HUD = `800 12px ${FONT}`;
  const F_HUD_SM = `800 10px ${FONT}`;
  const F_PILL = `800 11px ${FONT}`;
  const F_TOAST = `900 26px ${FONT}`;
  const F_TOAST_SUB = `700 11px ${FONT}`;
  const F_HINT = `600 12px ${FONT}`;
  const F_HINT_KEY = `800 10.5px ${FONT}`;
  const F_COUNT = `900 64px ${FONT}`;
  const F_TOKEN = `800 11px ${FONT}`;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mixRgb(a, b, t) {
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  }
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, String(val)); } catch (e) { /* storage blocked */ } }
  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const wallet = () => (typeof ArcadeWallet !== 'undefined' && ArcadeWallet ? ArcadeWallet : null);
  const fmt = (n) => { try { return Number(n).toLocaleString(); } catch (e) { return String(n); } };

  // ===========================================================================
  // Character art (module level: usable before init() for shop previews)
  // ===========================================================================
  const DEFAULT_SKIN = 'skin-classic';
  const SKINS = {
    'skin-classic': {
      name: 'Pixel Pal', acc: 'pixel', eye: 'normal',
      top: '#8be0ff', bottom: '#34a0dc', outline: '#103f66', belly: '#e6f7ff',
      arm: '#3fb0e8', limb: '#1d6fa5', hand: '#bdeeff', shoe: '#ff5a6e', sole: '#ffffff',
      cheek: 'rgba(255,110,150,0.55)', ink: '#14213d', fx: '#7dd3fc'
    },
    'skin-ninja': {
      name: 'Shadow Ninja', acc: 'ninja', eye: 'ninja',
      top: '#4a5173', bottom: '#20233a', outline: '#090a14', belly: null,
      arm: '#2b2f4a', limb: '#1a1c2e', hand: '#3d4366', shoe: '#101119', sole: '#3d4366',
      cheek: null, ink: '#14121f', skinTone: '#f6d3b3', scarf: '#ef2d56', scarfDark: '#a3123a', fx: '#ef2d56'
    },
    'skin-robot': {
      name: 'Bolt Bot', acc: 'robot', eye: 'visor',
      top: '#f8fafc', mid: '#cbd5e1', bottom: '#8b98ab', outline: '#2b3647', belly: null,
      arm: '#a7b3c4', limb: '#5b6678', hand: '#e2e8f0', shoe: '#475569', sole: '#1e293b',
      cheek: null, ink: '#0b1222', glow: '#22d3ee', fx: '#22d3ee'
    },
    'skin-cat': {
      name: 'Byte Cat', acc: 'cat', eye: 'normal',
      top: '#ffc857', bottom: '#ee8418', outline: '#6e3205', belly: '#fff4dc',
      arm: '#f39a2a', limb: '#d9730f', hand: '#fff4dc', shoe: '#fff4dc', sole: '#f5c99a',
      cheek: 'rgba(255,120,150,0.5)', ink: '#2a1606', stripe: '#b45309', fx: '#fbbf24'
    },
    'skin-astronaut': {
      name: 'Astro Dash', acc: 'astro', eye: 'helmet',
      top: '#ffffff', bottom: '#c3cddb', outline: '#3f4a5c', belly: null,
      arm: '#e8edf4', limb: '#d5dde8', hand: '#f97316', shoe: '#64748b', sole: '#334155',
      cheek: null, ink: '#0b1a4a', fx: '#93c5fd'
    },
    'skin-golden': {
      name: 'Golden Legend', acc: 'golden', eye: 'normal',
      top: '#fff3b0', mid: '#fbbf24', bottom: '#c27c06', outline: '#6b3e02', belly: '#fff8d6',
      arm: '#f2b01e', limb: '#b87406', hand: '#fff1a8', shoe: '#ffffff', sole: '#e0a00b',
      cheek: 'rgba(255,140,120,0.45)', ink: '#3b2201', fx: '#fde047'
    }
  };
  const SKIN_IDS = Object.keys(SKINS);
  const TRAIL_IDS = ['trail-none', 'trail-sparkle', 'trail-fire', 'trail-rainbow'];

  // Pose generator: legs = [backHip, backKnee, frontHip, frontKnee], arms = [back, front] (0 = down, + = forward)
  function makePose(name, i, expr) {
    const P = { duck: false, bob: 0, lean: 0, legs: [0, 0.25, 0, 0.25], arms: [0.12, -0.12], expr: expr || 'open', flow: 0, wave: 0, armLen: 8 };
    switch (name) {
      case 'run': {
        const ph = (i / 8) * TAU;
        const bk = ph + Math.PI;
        P.bob = -1.8 * Math.abs(Math.cos(ph));
        P.legs = [0.8 * Math.sin(bk), 0.25 + 0.95 * Math.max(0, Math.cos(bk)), 0.8 * Math.sin(ph), 0.25 + 0.95 * Math.max(0, Math.cos(ph))];
        P.arms = [0.95 * Math.sin(ph), -0.95 * Math.sin(ph)];
        P.flow = 1;
        P.wave = ph;
        break;
      }
      case 'idle':
        P.bob = i === 2 ? -0.6 : 0;
        P.legs = [-0.08, 0.05, 0.1, 0.05];
        P.arms = i === 2 ? [-2.5, 1.5] : [0.18, -0.12];
        P.flow = 0;
        P.wave = i * 1.3;
        break;
      case 'jump':
        P.legs = [-0.55, 0.35, 0.95, 1.45];
        P.arms = [-2.5, 1.55];
        P.flow = 0.65;
        P.wave = 1.2;
        break;
      case 'tuck':
        P.bob = 2;
        P.legs = [0.85, 2.25, 1.1, 2.4];
        P.arms = [1.25, 1.45];
        P.armLen = 7.5;
        P.flow = 0.85;
        P.wave = 2.4;
        break;
      case 'fall':
        P.legs = [-0.28, 0.2, 0.32, 0.28];
        P.arms = [-2.3, 1.75];
        P.flow = 0.35;
        P.wave = 0.6;
        break;
      case 'fly':
        P.lean = 0.22;
        P.legs = [-0.95, 0.45, -0.6, 0.55];
        P.arms = [1.5, 1.7];
        P.flow = 1;
        P.wave = i * Math.PI;
        break;
      case 'duck':
        P.duck = true;
        P.flow = 1;
        P.wave = i * Math.PI;
        break;
      case 'hurt':
        P.lean = -0.22;
        P.legs = [-0.7, 0.05, 0.7, 0.05];
        P.arms = [-2.7, 1.7];
        P.flow = 0.3;
        P.wave = 0.4;
        break;
      default:
        break;
    }
    return P;
  }

  function sparklePath(g, x, y, r) {
    g.beginPath();
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.quadraticCurveTo(x, y, x, y + r);
    g.quadraticCurveTo(x, y, x - r, y);
    g.quadraticCurveTo(x, y, x, y - r);
    g.closePath();
  }

  function drawShoe(g, S, x, y, back) {
    g.beginPath();
    g.ellipse(x + 1.8, y - 0.8, 4.8, 3.1, 0, 0, TAU);
    g.fillStyle = S.shoe;
    g.fill();
    g.lineWidth = 1.4;
    g.strokeStyle = S.outline;
    g.stroke();
    g.fillStyle = S.sole;
    g.fillRect(x - 2.6, y + 0.9, 8.6, 1.3);
    if (back) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath();
      g.ellipse(x + 1.8, y - 0.8, 4.8, 3.1, 0, 0, TAU);
      g.fill();
    }
  }

  function drawLeg(g, S, hx, hy, a, b, back) {
    const kx = hx + Math.sin(a) * 7;
    const ky = hy + Math.cos(a) * 7;
    const fx = kx + Math.sin(a - b) * 7;
    const fy = ky + Math.cos(a - b) * 7;
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(kx, ky);
    g.lineTo(fx, fy);
    g.strokeStyle = S.outline;
    g.lineWidth = 7;
    g.stroke();
    g.strokeStyle = S.limb;
    g.lineWidth = 4.4;
    g.stroke();
    if (back) {
      g.strokeStyle = 'rgba(0,0,0,0.22)';
      g.stroke();
    }
    drawShoe(g, S, fx, fy, back);
  }

  function drawArm(g, S, sx, sy, a, len, back) {
    const ex = sx + Math.sin(a) * len;
    const ey = sy + Math.cos(a) * len;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(ex, ey);
    g.strokeStyle = S.outline;
    g.lineWidth = 6.4;
    g.stroke();
    g.strokeStyle = S.arm;
    g.lineWidth = 4.1;
    g.stroke();
    if (back) {
      g.strokeStyle = 'rgba(0,0,0,0.2)';
      g.stroke();
    }
    g.beginPath();
    g.arc(ex, ey, 2.9, 0, TAU);
    g.fillStyle = S.hand;
    g.fill();
    g.lineWidth = 1.3;
    g.strokeStyle = S.outline;
    g.stroke();
  }

  function bodyPath(g, bx, by, bw, bh, duck) {
    g.beginPath();
    g.roundRect(bx, by, bw, bh, duck ? [11, 13, 8, 8] : [14, 14, 11, 11]);
  }

  function drawBody(g, S, bx, by, bw, bh, duck) {
    const grad = g.createLinearGradient(0, by, 0, by + bh);
    grad.addColorStop(0, S.top);
    if (S.mid) grad.addColorStop(0.5, S.mid);
    grad.addColorStop(1, S.bottom);
    bodyPath(g, bx, by, bw, bh, duck);
    g.fillStyle = grad;
    g.fill();
    g.save();
    g.clip();
    // Back-side shade for volume
    g.fillStyle = 'rgba(0,0,0,0.13)';
    g.beginPath();
    g.ellipse(bx - 2, by + bh * 0.62, bw * 0.3, bh * 0.8, 0, 0, TAU);
    g.fill();
    if (S.belly) {
      g.fillStyle = S.belly;
      g.beginPath();
      g.ellipse(bx + bw * 0.6, by + bh * (duck ? 0.86 : 0.76), bw * 0.3, bh * (duck ? 0.3 : 0.2), 0, 0, TAU);
      g.fill();
    }
    if (S.acc === 'golden') {
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 3.2;
      g.beginPath();
      g.moveTo(bx + bw * 0.12, by + bh + 2);
      g.lineTo(bx + bw * 0.5, by - 2);
      g.stroke();
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(bx + bw * 0.3, by + bh + 2);
      g.lineTo(bx + bw * 0.66, by - 2);
      g.stroke();
    }
    if (S.acc === 'pixel') {
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillRect(bx + 5, by + 7, 3, 3);
      g.fillRect(bx + 8.6, by + 4.6, 2.2, 2.2);
    } else {
      g.fillStyle = 'rgba(255,255,255,0.38)';
      g.beginPath();
      g.ellipse(bx + bw * 0.33, by + 5.5, bw * 0.2, 2.5, -0.2, 0, TAU);
      g.fill();
    }
    if (S.acc === 'robot' && !duck) {
      g.strokeStyle = 'rgba(43,54,71,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(bx, by + bh - 13);
      g.lineTo(bx + bw, by + bh - 13);
      g.stroke();
    }
    g.restore();
    bodyPath(g, bx, by, bw, bh, duck);
    g.lineWidth = 1.7;
    g.strokeStyle = S.outline;
    g.stroke();
  }

  function drawEyes(g, S, expr, x1, x2, y, ink) {
    g.lineCap = 'round';
    if (expr === 'blink') {
      g.strokeStyle = ink;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x1 - 3, y + 0.5);
      g.quadraticCurveTo(x1, y + 2.5, x1 + 3, y + 0.5);
      g.moveTo(x2 - 2.6, y + 0.5);
      g.quadraticCurveTo(x2, y + 2.3, x2 + 2.6, y + 0.5);
      g.stroke();
      return;
    }
    if (expr === 'happy') {
      g.strokeStyle = ink;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(x1 - 3, y + 1.2);
      g.quadraticCurveTo(x1, y - 3.6, x1 + 3, y + 1.2);
      g.moveTo(x2 - 2.6, y + 1.2);
      g.quadraticCurveTo(x2, y - 3.2, x2 + 2.6, y + 1.2);
      g.stroke();
      return;
    }
    if (expr === 'x') {
      g.strokeStyle = ink;
      g.lineWidth = 1.7;
      g.beginPath();
      g.moveTo(x1 - 2.5, y - 2.5); g.lineTo(x1 + 2.5, y + 2.5);
      g.moveTo(x1 + 2.5, y - 2.5); g.lineTo(x1 - 2.5, y + 2.5);
      g.moveTo(x2 - 2.2, y - 2.2); g.lineTo(x2 + 2.2, y + 2.2);
      g.moveTo(x2 + 2.2, y - 2.2); g.lineTo(x2 - 2.2, y + 2.2);
      g.stroke();
      return;
    }
    const big = expr === 'wow' ? 1.12 : 1;
    for (let k = 0; k < 2; k++) {
      const x = k === 0 ? x1 : x2;
      const s = k === 0 ? 1 : 0.86;
      g.beginPath();
      g.ellipse(x, y, 3.4 * s, 4.3 * s * big, 0, 0, TAU);
      g.fillStyle = '#ffffff';
      g.fill();
      g.lineWidth = 0.9;
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.stroke();
      g.beginPath();
      g.arc(x + 0.9 * s, y + 0.6, (expr === 'wow' ? 1.6 : 2.3) * s, 0, TAU);
      g.fillStyle = ink;
      g.fill();
      g.beginPath();
      g.arc(x + 0.1 * s, y - 1.1, 0.95 * s, 0, TAU);
      g.fillStyle = '#ffffff';
      g.fill();
    }
    if (expr === 'focus') {
      g.strokeStyle = ink;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x1 - 3.2, y - 6.4); g.lineTo(x1 + 3, y - 4.9);
      g.moveTo(x2 - 2.6, y - 5.4); g.lineTo(x2 + 2.4, y - 6.3);
      g.stroke();
    }
  }

  function drawMouth(g, S, expr, mx, my, ink) {
    g.lineCap = 'round';
    g.strokeStyle = ink;
    g.fillStyle = ink;
    if (S.acc === 'cat') {
      // nose + "ω"
      g.fillStyle = '#f472b6';
      g.beginPath();
      g.moveTo(mx - 1.6, my - 3.2);
      g.lineTo(mx + 1.6, my - 3.2);
      g.lineTo(mx, my - 1.6);
      g.closePath();
      g.fill();
      g.lineWidth = 1.2;
      g.beginPath();
      if (expr === 'wow' || expr === 'x') {
        g.ellipse(mx, my + 0.6, 1.3, 1.7, 0, 0, TAU);
        g.fillStyle = ink;
        g.fill();
      } else {
        g.arc(mx - 1.3, my - 0.6, 1.3, 0.1, Math.PI - 0.1);
        g.moveTo(mx + 2.6, my - 0.6);
        g.arc(mx + 1.3, my - 0.6, 1.3, 0.1, Math.PI - 0.1);
        g.stroke();
      }
      return;
    }
    if (expr === 'happy') {
      g.beginPath();
      g.moveTo(mx - 3, my - 1);
      g.quadraticCurveTo(mx, my + 4.8, mx + 3, my - 1);
      g.closePath();
      g.fillStyle = '#7a1f3d';
      g.fill();
      g.fillStyle = '#f472b6';
      g.beginPath();
      g.ellipse(mx, my + 1.6, 1.4, 0.9, 0, 0, TAU);
      g.fill();
    } else if (expr === 'wow') {
      g.beginPath();
      g.ellipse(mx, my + 0.6, 1.5, 2, 0, 0, TAU);
      g.fill();
    } else if (expr === 'x') {
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(mx - 3, my + 0.5);
      g.lineTo(mx - 1.5, my - 0.8);
      g.lineTo(mx, my + 0.5);
      g.lineTo(mx + 1.5, my - 0.8);
      g.lineTo(mx + 3, my + 0.5);
      g.stroke();
    } else {
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(mx, my - 1.6, 2.4, 0.2 * Math.PI, 0.8 * Math.PI);
      g.stroke();
    }
  }

  function drawVisor(g, S, expr, x1, x2, y, bx, bw) {
    const vx = bx + bw - 22.5;
    g.beginPath();
    g.roundRect(vx, y - 6.5, 23.5, 13, 5);
    g.fillStyle = '#0b1222';
    g.fill();
    g.lineWidth = 1.6;
    g.strokeStyle = S.outline;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.fillRect(vx + 3, y - 5, 15, 1.6);
    const c = expr === 'x' ? '#f43f5e' : S.glow;
    g.fillStyle = c;
    g.strokeStyle = c;
    g.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      const x = k === 0 ? x1 - 0.5 : x2 + 0.5;
      g.beginPath();
      if (expr === 'blink') {
        g.rect(x - 2.4, y - 0.6, 4.8, 1.6);
        g.fill();
      } else if (expr === 'happy') {
        g.lineWidth = 1.7;
        g.moveTo(x - 2.4, y + 1.2);
        g.lineTo(x, y - 1.6);
        g.lineTo(x + 2.4, y + 1.2);
        g.stroke();
      } else if (expr === 'x') {
        g.lineWidth = 1.5;
        g.moveTo(x - 2, y - 2); g.lineTo(x + 2, y + 2);
        g.moveTo(x + 2, y - 2); g.lineTo(x - 2, y + 2);
        g.stroke();
      } else if (expr === 'wow') {
        g.lineWidth = 1.4;
        g.arc(x, y, 2.6, 0, TAU);
        g.stroke();
        g.beginPath();
        g.arc(x, y, 0.9, 0, TAU);
        g.fill();
      } else if (expr === 'focus') {
        g.roundRect(x - 2.2, y - 1.6, 4.4, 4, 1.4);
        g.fill();
      } else {
        g.roundRect(x - 2, y - 3.5, 4, 7, 2);
        g.fill();
      }
    }
  }

  // Draws one character pose at the origin (feet centre). Returns robot antenna tip (frame coords) or null.
  function drawCharacter(g, skinId, pose) {
    const S = SKINS[skinId] || SKINS[DEFAULT_SKIN];
    const duck = pose.duck;
    const bob = pose.bob || 0;
    const bx = duck ? -20 : -15;
    const bw = duck ? 40 : 30;
    const by = (duck ? -24 : -50) + bob;
    const bh = duck ? 22 : 38;
    const ex1 = bx + bw - 6;
    const ex2 = bx + bw - 14;
    const ey = by + (duck ? 9 : 14);
    const f = pose.flow || 0;
    const wv = pose.wave || 0;
    let expr = pose.expr || 'open';
    if (S.eye === 'ninja' && expr === 'open') expr = 'focus';
    let tip = null;

    g.save();
    if (pose.lean) {
      g.translate(0, -26);
      g.rotate(pose.lean);
      g.translate(0, 26);
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // ---- Back layer: tails, ears, backpack, sprout
    if (S.acc === 'ninja') {
      const sy = by + (duck ? 12 : 22);
      for (let k = 1; k >= 0; k--) {
        const sx = bx + 2;
        const s0 = sy + (k ? 1.5 : -0.5);
        const L = 17 + k * 4;
        const tx = sx - 3 - L * (0.25 + 0.75 * f);
        const ty = s0 + L * (1 - f) * 0.85 + f * (Math.sin(wv + k * 1.9) * 3.5 - 2 - k * 1.5);
        g.beginPath();
        g.moveTo(sx, s0);
        g.bezierCurveTo(
          sx + (tx - sx) * 0.35, s0 + (ty - s0) * 0.35 + f * Math.sin(wv + 0.8 + k) * 4,
          sx + (tx - sx) * 0.7, s0 + (ty - s0) * 0.7 - f * Math.sin(wv + 1.6 + k) * 4,
          tx, ty
        );
        g.strokeStyle = S.outline;
        g.lineWidth = 5.6;
        g.stroke();
        g.strokeStyle = k ? S.scarfDark : S.scarf;
        g.lineWidth = 3.6;
        g.stroke();
      }
    } else if (S.acc === 'cat') {
      const sx = bx + 3;
      const sy = by + bh - 7;
      const sw = Math.sin(wv) * (0.6 + f);
      const tx = duck ? bx - 15 : bx - 12 - f * 3;
      const ty = duck ? by + 4 + sw * 2 : by + bh - 27 + f * 8 + sw * 3;
      g.beginPath();
      g.moveTo(sx, sy);
      g.bezierCurveTo(bx - 7, sy + 3 + sw, bx - 16, sy - 8 + sw * 2, tx, ty);
      g.strokeStyle = S.outline;
      g.lineWidth = 7.4;
      g.stroke();
      g.strokeStyle = S.arm;
      g.lineWidth = 5;
      g.stroke();
      g.beginPath();
      g.arc(tx, ty, 2.6, 0, TAU);
      g.fillStyle = S.belly;
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = S.outline;
      g.stroke();
      // ears
      const eh = duck ? 6 : 10;
      for (let k = 0; k < 2; k++) {
        const ex = k === 0 ? bx + 5 : bx + bw - 15;
        g.beginPath();
        g.moveTo(ex, by + 4);
        g.lineTo(ex + 4 + k, by - eh);
        g.lineTo(ex + 10, by + 3);
        g.closePath();
        g.fillStyle = k === 0 ? S.bottom : S.top;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = S.outline;
        g.stroke();
        g.beginPath();
        g.moveTo(ex + 2.6, by + 2.5);
        g.lineTo(ex + 4.3 + k, by - eh + 4);
        g.lineTo(ex + 7.6, by + 2);
        g.closePath();
        g.fillStyle = '#f9a8d4';
        g.fill();
      }
    } else if (S.acc === 'astro') {
      g.beginPath();
      if (duck) g.roundRect(bx - 5, by + 3, 9, 15, 3);
      else g.roundRect(bx - 6.5, by + 11, 10, 23, 3);
      g.fillStyle = '#e2e8f0';
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = S.outline;
      g.stroke();
      g.fillStyle = '#ef4444';
      g.beginPath();
      g.arc(bx - 2, by + (duck ? 7 : 15.5), 1.4, 0, TAU);
      g.fill();
      if (!duck) {
        g.fillStyle = '#94a3b8';
        g.fillRect(bx - 4.5, by + 21, 6, 1.2);
        g.fillRect(bx - 4.5, by + 24, 6, 1.2);
      }
    } else if (S.acc === 'pixel') {
      const cx = bx + bw * 0.5 - 1;
      const px = (x, y, c) => {
        g.fillStyle = '#14532d';
        g.fillRect(x - 0.6, y - 0.6, 3.8, 3.8);
        g.fillStyle = c;
        g.fillRect(x, y, 2.6, 2.6);
      };
      px(cx, by - 2.2, '#22c55e');
      px(cx, by - 4.8, '#22c55e');
      px(cx + 2.6, by - 7.4, '#4ade80');
      px(cx + 5.2, by - 7.4, '#4ade80');
      px(cx + 5.2, by - 10, '#86efac');
      px(cx - 2.6, by - 6.2, '#4ade80');
    } else if (S.acc === 'robot') {
      const baseX = bx + 9;
      const tx = baseX - f * 2.5 - (duck ? 3 : 0);
      const ty = by - (duck ? 7 : 10);
      g.beginPath();
      g.moveTo(baseX, by + 1);
      g.lineTo(tx, ty);
      g.strokeStyle = S.outline;
      g.lineWidth = 3.4;
      g.stroke();
      g.strokeStyle = '#94a3b8';
      g.lineWidth = 1.6;
      g.stroke();
      g.beginPath();
      g.arc(tx, ty - 1.4, 2.7, 0, TAU);
      g.fillStyle = '#b91c1c';
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = S.outline;
      g.stroke();
      tip = { x: tx, y: ty - 1.4 };
    }

    // ---- Limbs behind the body
    const shY = by + 27;
    if (!duck) {
      drawArm(g, S, bx + 10, shY, pose.arms[0], pose.armLen, true);
      const hipY = -14 + bob;
      drawLeg(g, S, -4, hipY, pose.legs[0], pose.legs[1], true);
      drawLeg(g, S, 4, hipY, pose.legs[2], pose.legs[3], false);
    } else {
      drawShoe(g, S, bx + 7, -1.6, true);
      drawShoe(g, S, bx + bw - 11, -1.6, false);
    }

    // ---- Body
    drawBody(g, S, bx, by, bw, bh, duck);

    // ---- Face
    const ink = S.ink;
    if (S.eye === 'visor') {
      drawVisor(g, S, expr, ex1, ex2, ey, bx, bw);
      // ear bolt + chest panel
      g.beginPath();
      g.arc(bx + 7, ey + 1, 3.3, 0, TAU);
      g.fillStyle = '#cbd5e1';
      g.fill();
      g.lineWidth = 1.3;
      g.strokeStyle = S.outline;
      g.stroke();
      g.beginPath();
      g.arc(bx + 7, ey + 1, 1.1, 0, TAU);
      g.fillStyle = S.outline;
      g.fill();
      if (!duck) {
        g.beginPath();
        g.roundRect(bx + bw - 16, by + 26, 11, 6.5, 2);
        g.fillStyle = '#1e293b';
        g.fill();
        g.fillStyle = '#22d3ee';
        g.fillRect(bx + bw - 14, by + 28.4, 1.8, 1.8);
        g.fillStyle = '#facc15';
        g.fillRect(bx + bw - 11.3, by + 28.4, 1.8, 1.8);
        g.fillStyle = '#f43f5e';
        g.fillRect(bx + bw - 8.6, by + 28.4, 1.8, 1.8);
      }
    } else if (S.eye === 'helmet') {
      const cx = ex1 - 3.6;
      const cy = ey + 1;
      const rx = 11;
      const ry = duck ? 7.6 : 9.6;
      g.beginPath();
      g.ellipse(cx, cy, rx + 1.8, ry + 1.8, 0, 0, TAU);
      g.fillStyle = '#9aa7b8';
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = S.outline;
      g.stroke();
      const glass = g.createRadialGradient(cx - 3, cy - 4, 1, cx, cy, rx);
      glass.addColorStop(0, '#3f63e0');
      glass.addColorStop(1, '#0a1a4d');
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      g.fillStyle = glass;
      g.fill();
      drawEyes(g, S, expr, ex1, ex2, ey, '#0a1a4d');
      if (!duck) drawMouth(g, S, expr, ex1 - 3, ey + 7, '#c7d2fe');
      g.strokeStyle = 'rgba(255,255,255,0.78)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.ellipse(cx, cy, rx - 2.6, ry - 2.6, 0, Math.PI * 1.08, Math.PI * 1.45);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.arc(cx + rx * 0.5, cy - ry * 0.5, 1.1, 0, TAU);
      g.fill();
      if (!duck) {
        g.fillStyle = '#3b82f6';
        g.fillRect(bx + 2.5, by + bh - 11, bw - 5, 2.4);
        g.beginPath();
        g.arc(bx + bw - 8, by + bh - 15.5, 2, 0, TAU);
        g.fillStyle = '#ef4444';
        g.fill();
      }
    } else if (S.eye === 'ninja') {
      g.beginPath();
      g.roundRect(ex2 - 6, ey - 5.6, (ex1 - ex2) + 12.4, 11.2, 5);
      g.fillStyle = S.skinTone;
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = S.outline;
      g.stroke();
      drawEyes(g, S, expr, ex1, ex2, ey, ink);
    } else {
      drawEyes(g, S, expr, ex1, ex2, ey, ink);
      if (S.cheek && expr !== 'x') {
        g.fillStyle = S.cheek;
        g.beginPath();
        g.ellipse(ex1 + 3.2, ey + 5.6, 2.3, 1.5, 0, 0, TAU);
        g.ellipse(ex2 - 4.6, ey + 5.6, 2.1, 1.4, 0, 0, TAU);
        g.fill();
      }
      drawMouth(g, S, expr, ex1 - 3, ey + (duck ? 6.5 : 8), ink);
    }

    // ---- Front accessories
    if (S.acc === 'ninja') {
      const sy = by + (duck ? 12 : 22);
      g.beginPath();
      g.roundRect(bx - 0.6, sy - 2.7, bw + 1.2, 5.4, 2.7);
      g.fillStyle = S.scarf;
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = S.outline;
      g.stroke();
      g.beginPath();
      g.arc(bx + 2, sy, 2.9, 0, TAU);
      g.fillStyle = S.scarfDark;
      g.fill();
      g.stroke();
    } else if (S.acc === 'cat') {
      g.strokeStyle = S.stripe;
      g.lineWidth = 1.8;
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        const sx = bx + bw * 0.38 + k * 3.6;
        g.moveTo(sx, by + 1.2);
        g.lineTo(sx + 0.4, by + (k === 1 ? 5.4 : 4.2));
      }
      g.stroke();
      g.strokeStyle = 'rgba(42,22,6,0.55)';
      g.lineWidth = 0.9;
      g.beginPath();
      const wy = ey + (duck ? 5 : 6.5);
      g.moveTo(bx + bw - 1.5, wy); g.lineTo(bx + bw + 6, wy - 1.2);
      g.moveTo(bx + bw - 1.5, wy + 2); g.lineTo(bx + bw + 6, wy + 2.8);
      g.stroke();
    } else if (S.acc === 'golden') {
      const cx = bx + bw * 0.5 + 1;
      const cy = by + 2.4;
      g.beginPath();
      g.moveTo(cx - 7, cy);
      g.lineTo(cx - 7.6, cy - 7.2);
      g.lineTo(cx - 3.6, cy - 3.6);
      g.lineTo(cx, cy - 10);
      g.lineTo(cx + 3.6, cy - 3.6);
      g.lineTo(cx + 7.6, cy - 7.2);
      g.lineTo(cx + 7, cy);
      g.closePath();
      g.fillStyle = '#ffd84d';
      g.fill();
      g.lineWidth = 1.3;
      g.strokeStyle = S.outline;
      g.stroke();
      g.fillStyle = '#ef4444';
      g.beginPath();
      g.arc(cx, cy - 2.4, 1.5, 0, TAU);
      g.fill();
      g.fillStyle = '#fffbe6';
      g.beginPath();
      g.arc(cx - 7.6, cy - 7.4, 1.1, 0, TAU);
      g.arc(cx, cy - 10.2, 1.1, 0, TAU);
      g.arc(cx + 7.6, cy - 7.4, 1.1, 0, TAU);
      g.fill();
      g.fillStyle = '#fffbe6';
      sparklePath(g, bx - 4, by + 6, 3.2);
      g.fill();
      sparklePath(g, bx + bw + 4, by + 17, 2.3);
      g.fill();
    }

    // ---- Front arm
    if (!duck) drawArm(g, S, bx + bw - 16, shY, pose.arms[1], pose.armLen, false);
    else drawArm(g, S, bx + bw - 21, by + 15, 1.4, 5, false);

    g.restore();

    if (tip && pose.lean) {
      // rotate the antenna tip around (0, -26) like the canvas transform did
      const c = Math.cos(pose.lean);
      const s = Math.sin(pose.lean);
      const dx = tip.x;
      const dy = tip.y + 26;
      tip = { x: dx * c - dy * s, y: dx * s + dy * c - 26 };
    }
    return tip;
  }

  // Frame set for a skin at a pixel scale
  const RUN_EXPR = ['open', 'happy', 'focus'];
  function buildFrameSet(skinId, ps) {
    const mk = (pose) => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(FW * ps));
      c.height = Math.max(1, Math.ceil(FH * ps));
      const g = c.getContext('2d');
      g.scale(ps, ps);
      g.translate(OX, OY);
      const tip = drawCharacter(g, skinId, pose);
      return { canvas: c, ax: tip ? tip.x : null, ay: tip ? tip.y : null };
    };
    const set = { skinId, ps, run: [[], [], []], idle: [], fly: [], duck: [] };
    for (let e = 0; e < RUN_EXPR.length; e++) {
      for (let i = 0; i < 8; i++) set.run[e].push(mk(makePose('run', i, RUN_EXPR[e])));
    }
    set.jump = mk(makePose('jump', 0, 'wow'));
    set.tuck = mk(makePose('tuck', 0, 'happy'));
    set.fall = mk(makePose('fall', 0, 'wow'));
    set.hurt = mk(makePose('hurt', 0, 'x'));
    set.fly.push(mk(makePose('fly', 0, 'happy')), mk(makePose('fly', 1, 'happy')));
    set.duck.push(mk(makePose('duck', 0, 'focus')), mk(makePose('duck', 1, 'focus')));
    set.idle.push(mk(makePose('idle', 0, 'open')), mk(makePose('idle', 1, 'blink')), mk(makePose('idle', 2, 'happy')));
    return set;
  }

  // Static trail art for previews (drawn in preview logical space, character back at x = -15)
  function drawTrailPreview(g, trailId, t) {
    if (trailId === 'trail-rainbow') {
      for (let j = 0; j < RAINBOW.length; j++) {
        g.strokeStyle = RAINBOW[j];
        g.lineWidth = 2.6;
        for (let x = -52; x < -14; x += 4) {
          g.globalAlpha = clamp((x + 56) / 40, 0.1, 0.95);
          const y0 = -36 + j * 2.6 + Math.sin(x * 0.13 + t * 4) * 2;
          const y1 = -36 + j * 2.6 + Math.sin((x + 4.5) * 0.13 + t * 4) * 2;
          g.beginPath();
          g.moveTo(x, y0);
          g.lineTo(x + 4.5, y1);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
    } else if (trailId === 'trail-sparkle') {
      const pts = [[-22, -38, 3.4], [-34, -24, 2.6], [-44, -40, 2.2], [-28, -14, 2], [-52, -28, 1.7]];
      for (let i = 0; i < pts.length; i++) {
        g.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(t * 3 + i * 1.7));
        g.fillStyle = C_SPARKLE_TRAIL[i % C_SPARKLE_TRAIL.length];
        sparklePath(g, pts[i][0], pts[i][1], pts[i][2] * 1.4);
        g.fill();
      }
      g.globalAlpha = 1;
    } else if (trailId === 'trail-fire') {
      for (let i = 6; i >= 0; i--) {
        const x = -18 - i * 5.5;
        const r = 6.5 - i * 0.75;
        const y = -18 - i * 1.6 + Math.sin(t * 9 + i) * 1.2;
        g.globalAlpha = clamp(1 - i * 0.12, 0.15, 1);
        g.fillStyle = i < 2 ? '#fde047' : i < 4 ? '#fb923c' : '#ef4444';
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }
  }

  // Lays out and paints a preview scene. `frame` (cached) is optional; without it the art is drawn directly.
  function paintPreview(g, cw, ch, skinId, trailId, t, frame, still) {
    const hasTrail = !!trailId && trailId !== 'trail-none';
    const SW = hasTrail ? 104 : 66;
    const SH = 80;
    const s = Math.min(cw / SW, ch / SH);
    g.save();
    g.translate(cw / 2 + (hasTrail ? 16 * s : 0), ch / 2 + 35 * s);
    g.scale(s, s);
    // ground shadow
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath();
    g.ellipse(0, 1.5, 17, 3.6, 0, 0, TAU);
    g.fill();
    drawTrailPreview(g, trailId, still ? 0.4 : t);
    const breathe = still ? 1 : 1 + Math.sin(t * 2.4) * 0.022;
    g.scale(2 - breathe, breathe);
    let tip = null;
    if (frame) {
      g.drawImage(frame.canvas, -OX, -OY, FW, FH);
      if (frame.ax !== null) tip = { x: frame.ax, y: frame.ay };
    } else {
      const blink = !still && (t % 3.4) > 3.25;
      tip = drawCharacter(g, skinId, makePose('idle', blink ? 1 : 0, blink ? 'blink' : 'open'));
    }
    const S = SKINS[skinId] || SKINS[DEFAULT_SKIN];
    if (tip && (still || Math.sin(t * 5) > -0.2)) {
      g.globalAlpha = 0.9;
      g.fillStyle = 'rgba(248,113,113,0.45)';
      g.beginPath();
      g.arc(tip.x, tip.y, 5, 0, TAU);
      g.fill();
      g.fillStyle = '#fecaca';
      g.beginPath();
      g.arc(tip.x, tip.y, 1.6, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }
    if (S.acc === 'golden') {
      for (let i = 0; i < 3; i++) {
        const a = still ? 0.9 : Math.max(0, Math.sin(t * 2.2 + i * 2.1));
        if (a <= 0.02) continue;
        g.globalAlpha = a;
        g.fillStyle = '#fffbe6';
        sparklePath(g, i === 0 ? 18 : i === 1 ? -20 : 10, i === 0 ? -56 : i === 1 ? -30 : -8, 2.6 + i * 0.4);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    g.restore();
  }

  // Sizes a canvas backing store to its CSS box x DPR without changing its layout size.
  function fitCanvas(canvas) {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw > 0 && ch > 0) {
      // Laid out at its intrinsic (attribute) size: pin the CSS size before growing the backing store
      if (cw === canvas.width && ch === canvas.height && !canvas.style.width && !canvas.style.height) {
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
      }
      const bw = Math.max(1, Math.round(cw * dpr));
      const bh = Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      return { w: cw, h: ch, k: dpr };
    }
    return { w: canvas.width || 1, h: canvas.height || 1, k: 1 };
  }

  // ---------------------------------------------------------------------------
  // Item / power-up icon art
  // ---------------------------------------------------------------------------
  function drawCoinArt(g, c, r) {
    g.fillStyle = '#f59e0b';
    g.beginPath();
    g.arc(c, c + 0.8, r, 0, TAU);
    g.fill();
    g.fillStyle = '#ffd200';
    g.beginPath();
    g.arc(c, c, r, 0, TAU);
    g.fill();
    g.lineWidth = 1.3;
    g.strokeStyle = '#b45309';
    g.stroke();
    g.strokeStyle = 'rgba(180,83,9,0.55)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(c, c, r * 0.68, 0, TAU);
    g.stroke();
    g.fillStyle = '#fff4b0';
    sparklePath(g, c, c, r * 0.5);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.ellipse(c - r * 0.4, c - r * 0.45, r * 0.28, r * 0.16, -0.6, 0, TAU);
    g.fill();
  }

  function drawPowerTile(g, idx, cx, cy, size) {
    const P = POWERS[idx];
    const half = size / 2;
    const k = size / 24;
    const grad = g.createLinearGradient(0, cy - half, 0, cy + half);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.18, P.color);
    grad.addColorStop(1, P.color);
    g.beginPath();
    g.roundRect(cx - half, cy - half, size, size, size * 0.3);
    g.fillStyle = grad;
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.beginPath();
    g.roundRect(cx - half, cy + half * 0.25, size, half * 0.75, [0, 0, size * 0.3, size * 0.3]);
    g.fill();
    g.beginPath();
    g.roundRect(cx - half, cy - half, size, size, size * 0.3);
    g.lineWidth = 1.4 * k;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    switch (P.id) {
      case 'shield':
        g.beginPath();
        g.moveTo(cx, cy - 7.5 * k);
        g.lineTo(cx + 6.2 * k, cy - 4.8 * k);
        g.lineTo(cx + 5.4 * k, cy + 1.8 * k);
        g.quadraticCurveTo(cx + 3.2 * k, cy + 6 * k, cx, cy + 7.6 * k);
        g.quadraticCurveTo(cx - 3.2 * k, cy + 6 * k, cx - 5.4 * k, cy + 1.8 * k);
        g.lineTo(cx - 6.2 * k, cy - 4.8 * k);
        g.closePath();
        g.fill();
        g.fillStyle = P.color;
        sparklePath(g, cx, cy, 3.6 * k);
        g.fill();
        break;
      case 'magnet':
        g.lineWidth = 4 * k;
        g.beginPath();
        g.moveTo(cx - 5 * k, cy - 5.5 * k);
        g.lineTo(cx - 5 * k, cy + 0.5 * k);
        g.arc(cx, cy + 0.5 * k, 5 * k, Math.PI, 0, true);
        g.lineTo(cx + 5 * k, cy - 5.5 * k);
        g.stroke();
        g.fillStyle = '#e2e8f0';
        g.fillRect(cx - 7 * k, cy - 8 * k, 4 * k, 3.4 * k);
        g.fillRect(cx + 3 * k, cy - 8 * k, 4 * k, 3.4 * k);
        break;
      case 'double':
        g.beginPath();
        g.arc(cx, cy, 7.6 * k, 0, TAU);
        g.fill();
        g.fillStyle = P.color;
        g.font = `900 ${Math.round(8.5 * k * 10) / 10}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('×2', cx, cy + 0.6 * k);
        break;
      case 'jetpack':
        g.beginPath();
        g.roundRect(cx - 6.4 * k, cy - 7.5 * k, 5.4 * k, 11 * k, 2.6 * k);
        g.roundRect(cx + 1 * k, cy - 7.5 * k, 5.4 * k, 11 * k, 2.6 * k);
        g.fill();
        g.fillStyle = '#fde047';
        g.beginPath();
        g.moveTo(cx - 5.8 * k, cy + 4 * k);
        g.lineTo(cx - 3.7 * k, cy + 9 * k);
        g.lineTo(cx - 1.6 * k, cy + 4 * k);
        g.moveTo(cx + 1.6 * k, cy + 4 * k);
        g.lineTo(cx + 3.7 * k, cy + 9 * k);
        g.lineTo(cx + 5.8 * k, cy + 4 * k);
        g.fill();
        break;
      case 'slowmo':
        g.beginPath();
        g.roundRect(cx - 6.5 * k, cy - 1.5 * k, 9.5 * k, 8 * k, [0, 0, 3 * k, 3 * k]);
        g.fill();
        g.lineWidth = 1.8 * k;
        g.beginPath();
        g.arc(cx + 3.6 * k, cy + 2 * k, 2.4 * k, -Math.PI / 2, Math.PI / 2);
        g.stroke();
        g.lineWidth = 1.4 * k;
        g.beginPath();
        g.moveTo(cx - 3.5 * k, cy - 3.5 * k);
        g.quadraticCurveTo(cx - 5 * k, cy - 6 * k, cx - 3.5 * k, cy - 8.5 * k);
        g.moveTo(cx, cy - 3.5 * k);
        g.quadraticCurveTo(cx - 1.5 * k, cy - 6 * k, cx, cy - 8.5 * k);
        g.stroke();
        break;
      default:
        break;
    }
  }

  // ===========================================================================
  // Game object
  // ===========================================================================
  const game = {
    // DOM
    modal: null,
    canvas: null,
    ctx: null,
    el: {},

    isInitialized: false,
    isMuted: false,
    isFullscreen: false,
    reducedMotion: false,

    get isOpen() {
      return !!(this.modal && this.modal.classList.contains('active'));
    },
    // Back-compat convenience flags
    get isRunning() { return this.state === 'playing' || this.state === 'countdown' || this.state === 'dying'; },
    get isPaused() { return this.state === 'paused'; },
    get isGameOver() { return this.state === 'over' || this.state === 'dying' || this.state === 'revive'; },

    // Cosmetics (driven by ArcadeWallet)
    skinId: DEFAULT_SKIN,
    trailId: 'trail-none',
    frameSets: new Map(),
    useHeadStart: false,

    difficulty: 'nightmare',
    difficultyProfiles: {
      normal: {
        name: 'Normal', badge: '🛡️ NORMAL', color: '#38bdf8',
        baseSpeed: 4.4, maxSpeed: 11.5, ramp: 70000,
        reactStart: 30, reactEnd: 15, extraFrames: 26,
        initialRunway: 520, unlockScale: 1
      },
      nightmare: {
        name: 'Nightmare', badge: '💀 NIGHTMARE', color: '#ff3366',
        baseSpeed: 5.2, maxSpeed: 17.5, ramp: 52000,
        reactStart: 22, reactEnd: 9, extraFrames: 18,
        initialRunway: 430, unlockScale: 0.6
      }
    },
    get currentProfile() {
      return this.difficultyProfiles[this.difficulty] || this.difficultyProfiles.nightmare;
    },

    // State machine: closed | menu | countdown | playing | paused | dying | revive | over
    state: 'closed',
    rafId: 0,
    renderOnly: false,
    loopCb: null,
    lastTs: 0,
    acc: 0,
    time: 0,
    hitStop: 0,
    openToken: 0,
    prevFocus: null,
    fsChangedAt: 0,
    overUnlockAt: 0,
    effectsUntil: 0,
    menuAnimId: 0,
    menuAnimLast: 0,
    menuAnimCb: null,
    rewardAnim: 0,

    // Run metrics
    runId: 0,
    runLive: false,
    runFinalized: true,
    score: 0,
    bonusScore: 0,
    distanceScore: 0,
    highScore: 0,
    runStartBest: 0,
    bestCommitted: true,
    newBestAnnounced: false,
    distance: 0,
    prevDistance: 0,
    rampDistance: 0,
    speed: 0,
    worldSpeed: 0,
    slowK: 1,
    level: 1,
    lastMilestone: 0,
    combo: 0,
    comboTimer: 0,
    stats: null,
    runCoins: 0,
    revivePending: false,
    banked: { coins: 0, powerups: 0, closecalls: 0 },
    coinPop: 0,
    powerDur: new Float64Array(POWER_COUNT),
    reviveUsed: false,
    reviveLeft: 0,
    reviveUnlockAt: 0,
    reviveShownSec: -1,
    skyCoinAt: 0,
    skyCoinIdx: 0,

    // Tutorial
    tutorial: null,
    hint: null,
    toast: null,
    countdown: 0,
    lastCountTick: 0,
    dyingTimer: 0,

    // World
    nextSpawnAt: 0,
    lastType: 'none',
    obstacles: [],
    items: [],
    particles: [],
    pN: 0,
    floatingTexts: [],
    shake: 0,
    flash: 0,
    dustAcc: 0,
    trailAcc: 0,
    fxAcc: 0,
    rbY: new Float32Array(RB_N),
    rbD: new Float64Array(RB_N),
    rbHead: 0,
    rbCount: 0,

    // Input
    jumpQueued: false,
    jumpBuffer: 0,
    duckSources: new Set(),
    pointers: new Map(),

    // Shortcuts & assets
    userShortcuts: [],
    faviconCache: new Map(),
    spriteCache: new Map(),
    skyGrad: null,
    skyGradKey: -1,
    pal: { far: '', near: '', ground: '', night: 0, top: '', bottom: '' },
    pixelScale: 1,
    sx: 1,
    sy: 1,
    box: { l: 0, r: 0, t: 0, b: 0 },
    hud: null,

    player: null,

    // Audio
    audioCtx: null,
    master: null,
    noiseBuf: null,

    // -------------------------------------------------------------------------
    // Init & binding
    // -------------------------------------------------------------------------
    init() {
      if (this.isInitialized) return;
      this.modal = document.getElementById('game-arcade-modal');
      this.canvas = document.getElementById('runner-canvas');
      if (!this.modal || !this.canvas) return;
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      if (!this.ctx) return;
      this.isInitialized = true;
      this.loopCb = (t) => this.loop(t);
      this.menuAnimCb = (t) => this.menuAnimTick(t);

      const $ = (id) => document.getElementById(id);
      this.el = {
        score: $('runner-current-score'),
        high: $('runner-high-score'),
        modeBadge: $('runner-mode-badge'),
        coinChip: $('runner-coin-balance'),
        coinChipVal: $('runner-coin-balance-val'),
        skinBtn: $('runner-skin-btn'),
        muteBtn: $('runner-mute-btn'),
        fsBtn: $('runner-fullscreen-btn'),
        closeBtn: $('runner-close-btn'),
        restartHeaderBtn: $('runner-restart-btn-header'),
        pauseBtn: $('runner-pause-btn'),
        pauseOverlay: $('runner-pause-overlay'),
        overOverlay: $('runner-game-over-overlay'),
        menuOverlay: $('runner-difficulty-overlay'),
        reviveOverlay: $('runner-revive-overlay'),
        normalBtn: $('runner-mode-normal-btn'),
        nightmareBtn: $('runner-mode-nightmare-btn'),
        changeModeBtn: $('runner-change-mode-btn'),
        restartBtn: $('runner-restart-btn'),
        resumeBtn: $('runner-resume-btn'),
        pauseRestartBtn: $('runner-pause-restart-btn'),
        pauseModeBtn: $('runner-pause-mode-btn'),
        pauseQuitBtn: $('runner-pause-quit-btn'),
        pauseShopBtn: $('runner-pause-shop-btn'),
        overShopBtn: $('runner-over-shop-btn'),
        finalScore: $('runner-final-score'),
        bestScore: $('runner-best-score'),
        newBest: $('runner-new-best'),
        statDistance: $('runner-stat-distance'),
        statCoins: $('runner-stat-coins'),
        statCombo: $('runner-stat-combo'),
        statNear: $('runner-stat-near'),
        reward: $('runner-coin-reward'),
        rewardVal: $('runner-coin-reward-val'),
        rewardTotal: $('runner-coin-reward-total'),
        rewardBonus: $('runner-coin-reward-bonus'),
        menuPreview: $('runner-menu-preview'),
        charName: $('runner-char-name'),
        charHint: $('runner-char-hint'),
        headStartBtn: $('runner-headstart-btn'),
        headStartCount: $('runner-headstart-count'),
        reviveCount: $('runner-revive-count'),
        reviveBar: $('runner-revive-bar-fill'),
        reviveLeftLabel: $('runner-revive-left'),
        reviveYes: $('runner-revive-yes-btn'),
        reviveNo: $('runner-revive-no-btn'),
        toasts: $('runner-toasts'),
        live: $('runner-live')
      };

      const savedDiff = lsGet(LS.difficulty);
      if (savedDiff && this.difficultyProfiles[savedDiff]) this.difficulty = savedDiff;
      this.isMuted = lsGet(LS.muted) === 'true';
      this.useHeadStart = lsGet(LS.headStart) === '1';

      try {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.reducedMotion = mq.matches;
        mq.addEventListener('change', (e) => { this.reducedMotion = e.matches; });
      } catch (e) { /* old browser */ }

      // Pre-allocated particle pool
      for (let i = 0; i < MAX_PARTICLES; i++) {
        this.particles.push({ x: 0, y: 0, vx: 0, vy: 0, g: 0, size: 0, color: '#fff', life: 0, max: 1, shape: 0, layer: 1 });
      }
      this.hud = {
        coinVal: -1, coinStr: '0', coinW: 0,
        pTenths: new Int32Array(POWER_COUNT).fill(-1), pStr: new Array(POWER_COUNT).fill(''),
        lvVal: -1, lvStr: '', lvW: 0,
        comboVal: -1, comboStr: '', comboW: 0
      };

      const w = wallet();
      if (w && typeof w.onChange === 'function') {
        w.onChange(() => this.syncFromWallet());
      }
      this.syncFromWallet();

      this.updateDifficultyVisuals();
      this.updateMuteIcon();
      this.updateSkinTitle();
      this.buildScenery();
      this.resetRun();
      this.bindEvents();
      this.observeResize();
    },

    bindEvents() {
      const el = this.el;
      // Mouse clicks on header buttons hand focus back to the canvas so Space keeps jumping.
      const onClick = (node, fn) => {
        if (!node) return;
        node.addEventListener('click', (e) => {
          this.initAudio();
          fn(e);
          if (e.detail > 0 && this.isOpen && (this.state === 'playing' || this.state === 'countdown')) {
            this.focusCanvas();
          }
        });
      };

      onClick(el.closeBtn, () => this.close());
      onClick(el.skinBtn, () => this.toggleSkin());
      onClick(el.muteBtn, () => this.toggleMute());
      onClick(el.fsBtn, () => this.toggleFullscreen());
      onClick(el.restartHeaderBtn, () => this.promptDifficulty());
      onClick(el.modeBadge, () => this.promptDifficulty());
      onClick(el.pauseBtn, () => (this.state === 'paused' ? this.resume() : this.pause()));
      onClick(el.normalBtn, () => this.selectDifficultyAndStart('normal'));
      onClick(el.nightmareBtn, () => this.selectDifficultyAndStart('nightmare'));
      onClick(el.changeModeBtn, () => this.promptDifficulty());
      onClick(el.restartBtn, () => this.tryRestart());
      onClick(el.resumeBtn, () => this.resume());
      onClick(el.pauseRestartBtn, () => this.restart());
      onClick(el.pauseModeBtn, () => this.promptDifficulty());
      onClick(el.pauseQuitBtn, () => this.close());
      onClick(el.pauseShopBtn, () => this.openShop());
      onClick(el.overShopBtn, () => this.openShop());
      onClick(el.headStartBtn, () => this.toggleHeadStart());
      onClick(el.reviveYes, () => this.acceptRevive());
      onClick(el.reviveNo, () => this.declineRevive());

      // Clicking the dimmed backdrop pauses a live run; on menus / results it closes the game.
      this.modal.addEventListener('click', (e) => {
        if (e.target !== this.modal) return;
        if (this.state === 'playing' || this.state === 'countdown') this.pause();
        else if (this.state === 'menu' || this.state === 'over') this.close();
      });

      // Tapping empty space on overlays: resume (pause) / retry (game over) / continue (revive)
      if (el.pauseOverlay) {
        el.pauseOverlay.addEventListener('click', (e) => { if (e.target === el.pauseOverlay) this.resume(); });
      }
      if (el.overOverlay) {
        el.overOverlay.addEventListener('click', (e) => { if (e.target === el.overOverlay) this.tryRestart(); });
      }
      if (el.reviveOverlay) {
        el.reviveOverlay.addEventListener('click', (e) => { if (e.target === el.reviveOverlay) this.acceptRevive(); });
      }

      window.addEventListener('keydown', (e) => this.onKeyDown(e));
      window.addEventListener('keyup', (e) => this.onKeyUp(e));

      // Pointer: tap = jump, swipe down = duck / fast-fall (hold), works with mouse, touch and pen.
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      c.addEventListener('pointermove', (e) => this.onPointerMove(e));
      c.addEventListener('pointerup', (e) => this.onPointerUp(e));
      c.addEventListener('pointercancel', (e) => this.onPointerUp(e));
      c.addEventListener('contextmenu', (e) => e.preventDefault());

      document.addEventListener('fullscreenchange', () => {
        this.fsChangedAt = performance.now();
        this.setFullscreenState(document.fullscreenElement === this.modal);
      });

      document.addEventListener('visibilitychange', () => {
        if (!this.isOpen) return;
        if (document.hidden) {
          this.pause('auto');
          if (this.audioCtx && this.audioCtx.state === 'running') this.audioCtx.suspend().catch(() => {});
          // Bank what was earned so far: a pagehide write on tab close rarely completes.
          this.bankRunProgress();
        }
      });
      window.addEventListener('blur', () => {
        if (!this.isOpen) return;
        // Entering/leaving fullscreen can blur the window momentarily; ignore that.
        if (performance.now() - this.fsChangedAt < 600) return;
        this.pause('auto');
      });
      window.addEventListener('pagehide', () => {
        this.finishRun('quit');
        this.commitBest();
      });
    },

    observeResize() {
      if (typeof ResizeObserver === 'undefined') {
        window.addEventListener('resize', () => this.resizeCanvas());
        return;
      }
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        let pw = 0;
        let ph = 0;
        if (entry.devicePixelContentBoxSize && entry.devicePixelContentBoxSize[0]) {
          pw = entry.devicePixelContentBoxSize[0].inlineSize;
          ph = entry.devicePixelContentBoxSize[0].blockSize;
        } else {
          const dpr = window.devicePixelRatio || 1;
          pw = entry.contentRect.width * dpr;
          ph = entry.contentRect.height * dpr;
        }
        this.resizeCanvas(pw, ph);
      });
      try {
        ro.observe(this.canvas, { box: 'device-pixel-content-box' });
      } catch (e) {
        ro.observe(this.canvas);
      }
    },

    resizeCanvas(pw, ph) {
      if (pw === undefined) {
        const r = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        pw = r.width * dpr;
        ph = r.height * dpr;
      }
      if (pw < 2 || ph < 2) return;
      // Cap backing store for perf on huge 4K fullscreen surfaces
      const cap = Math.min(1, 3200 / pw);
      pw = Math.round(pw * cap);
      ph = Math.round(ph * cap);
      if (this.canvas.width !== pw || this.canvas.height !== ph) {
        this.canvas.width = pw;
        this.canvas.height = ph;
      }
      this.sx = pw / W;
      this.sy = ph / H;
      const ps = Math.max(this.sx, this.sy);
      if (Math.abs(ps - this.pixelScale) > 0.01) {
        this.pixelScale = ps;
        this.spriteCache.clear();
      }
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
      // Resizing clears the canvas: redraw synchronously (RO callbacks run before paint)
      if (this.isOpen) this.render(1);
    },

    // -------------------------------------------------------------------------
    // Wallet integration
    // -------------------------------------------------------------------------
    syncFromWallet() {
      const w = wallet();
      let skin = DEFAULT_SKIN;
      let trail = 'trail-none';
      if (w) {
        try {
          const s = w.getEquipped('runnerSkin');
          const t = w.getEquipped('runnerTrail');
          if (SKINS[s] && w.isOwned(s)) skin = s;
          if (TRAIL_IDS.indexOf(t) !== -1 && w.isOwned(t)) trail = t;
        } catch (e) { /* wallet not ready */ }
      }
      if (skin !== this.skinId) this.setSkin(skin, true);
      if (trail !== this.trailId) {
        this.trailId = trail;
        this.rbCount = 0;
      }
      this.updateCoinChip();
      this.updateBoostUi();
      this.updateReviveLabel();
      this.updateShopButtons();
      if (this.state === 'menu') this.drawMenuPreview(performance.now() / 1000);
    },

    updateCoinChip() {
      const chip = this.el.coinChip;
      const val = this.el.coinChipVal;
      if (!chip || !val) return;
      const w = wallet();
      chip.hidden = !w;
      if (!w) return;
      const coins = w.getCoins();
      const prev = this.shownBalance;
      this.shownBalance = coins;
      val.textContent = fmt(coins);
      chip.title = `${fmt(coins)} arcade coins`;
      if (prev !== undefined && coins > prev && !this.reducedMotion) {
        chip.classList.remove('bump');
        void chip.offsetWidth; // restart the CSS animation
        chip.classList.add('bump');
      }
    },

    headStartCount() {
      const w = wallet();
      return w ? w.getConsumableCount('boost-headstart') : 0;
    },

    reviveCount() {
      const w = wallet();
      return w ? w.getConsumableCount('item-revive') : 0;
    },

    updateBoostUi() {
      const btn = this.el.headStartBtn;
      if (!btn) return;
      const n = this.headStartCount();
      btn.hidden = n <= 0;
      const on = this.useHeadStart && n > 0;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('is-on', on);
      if (this.el.headStartCount) this.el.headStartCount.textContent = String(n);
      btn.title = on ? 'Head Start is ON: begin with a jetpack burst (H)' : 'Use a Head Start: begin with a jetpack burst (H)';
    },

    toggleHeadStart() {
      if (this.headStartCount() <= 0) return;
      this.useHeadStart = !this.useHeadStart;
      lsSet(LS.headStart, this.useHeadStart ? '1' : '0');
      this.updateBoostUi();
      this.playSfx(this.useHeadStart ? 'pu_jetpack' : 'pause');
    },

    updateReviveLabel() {
      if (this.el.reviveLeftLabel) this.el.reviveLeftLabel.textContent = `(${this.reviveCount()} left)`;
    },

    shopAvailable() {
      return typeof ShortcutArcade !== 'undefined' && !!ShortcutArcade && typeof ShortcutArcade.openShop === 'function';
    },

    updateShopButtons() {
      const ok = this.shopAvailable() && !!wallet();
      if (this.el.pauseShopBtn) this.el.pauseShopBtn.hidden = !ok;
      if (this.el.overShopBtn) this.el.overShopBtn.hidden = !ok;
    },

    openShop() {
      if (!this.shopAvailable()) return;
      // Ends (and banks) the current run, then hands over to the Arcade shop.
      this.close();
      try {
        ShortcutArcade.openShop('runner');
      } catch (e) {
        console.warn('[Runner] Could not open the Arcade shop:', e);
      }
    },

    // Banks coins and reports mission progress once per run (quit, restart or game over).
    finishRun(reason) {
      if (!this.runLive || this.runFinalized || !this.stats) return;
      this.runFinalized = true;
      this.runLive = false;
      const w = wallet();
      if (!w) return;
      const meters = Math.floor(this.distance / PX_PER_METER);
      const counted = reason === 'over' || meters >= 50;
      const runId = this.runId;
      // Only the part not already banked while the tab was hidden
      const b = this.banked;
      const coins = this.runCoins - b.coins;
      const jobs = [];
      if (coins > 0) {
        jobs.push(w.addCoins(coins).then((bal) => {
          if (this.runId === runId && this.state === 'over' && this.el.rewardTotal) {
            this.el.rewardTotal.textContent = `Balance ${fmt(bal)}`;
          }
          return [];
        }));
      } else if (b.coins > 0 && this.state === 'over' && this.el.rewardTotal) {
        this.el.rewardTotal.textContent = `Balance ${fmt(w.getCoins())}`;
      }
      jobs.push(w.report('runner_coins', coins));
      jobs.push(w.report('runner_distance', meters));
      jobs.push(w.report('runner_powerups', this.stats.powerups - b.powerups));
      jobs.push(w.report('runner_closecalls', this.stats.nearMisses - b.closecalls));
      b.coins = this.runCoins;
      b.powerups = this.stats.powerups;
      b.closecalls = this.stats.nearMisses;
      if (counted) jobs.push(w.report('runner_games', 1));
      Promise.all(jobs)
        .then((results) => {
          const labels = [];
          results.forEach((r) => { if (Array.isArray(r)) r.forEach((l) => labels.push(l)); });
          if (labels.length) this.showMissionToasts(labels);
        })
        .catch((e) => console.warn('[Runner] Could not save run rewards:', e));
    },

    // Mid-run deposit (tab hidden): banks coins and additive mission progress earned since
    // the last bank. finishRun later sends only the remainder; the run stays live.
    bankRunProgress() {
      if (!this.runLive || this.runFinalized || !this.stats) return;
      const w = wallet();
      if (!w) return;
      const b = this.banked;
      const runId = this.runId;
      const coins = this.runCoins - b.coins;
      const powerups = this.stats.powerups - b.powerups;
      const closecalls = this.stats.nearMisses - b.closecalls;
      b.coins = this.runCoins;
      b.powerups = this.stats.powerups;
      b.closecalls = this.stats.nearMisses;
      // On failure, roll the delta back (same run, still live) so finishRun retries it
      const undo = (key, n) => (e) => {
        console.warn('[Runner] Could not bank run progress:', e);
        if (this.runId === runId && !this.runFinalized) b[key] -= n;
        return [];
      };
      const jobs = [];
      if (coins > 0) {
        jobs.push(w.addCoins(coins).then(() => w.report('runner_coins', coins).catch(() => []), undo('coins', coins)));
      }
      if (powerups > 0) jobs.push(w.report('runner_powerups', powerups).catch(undo('powerups', powerups)));
      if (closecalls > 0) jobs.push(w.report('runner_closecalls', closecalls).catch(undo('closecalls', closecalls)));
      jobs.push(w.report('runner_distance', Math.floor(this.distance / PX_PER_METER)).catch(() => []));
      Promise.all(jobs).then((results) => {
        const labels = [];
        results.forEach((r) => { if (Array.isArray(r)) r.forEach((l) => labels.push(l)); });
        if (labels.length) this.showMissionToasts(labels);
      });
    },

    showMissionToasts(labels) {
      if (this.isOpen && this.el.toasts) {
        this.playSfx('mission');
        labels.forEach((label, i) => {
          setTimeout(() => this.pushToast('Mission complete!', label), i * 650);
        });
      } else if (typeof window.showToast === 'function') {
        window.showToast(`Mission complete: ${labels.join(' • ')}. Claim it in the Arcade.`);
      }
    },

    pushToast(title, text, plain = false) {
      const box = this.el.toasts;
      if (!box || !this.isOpen) return;
      while (box.children.length >= 3) box.removeChild(box.firstChild);
      const node = document.createElement('div');
      node.className = 'runner-toast';
      const ic = document.createElement('span');
      ic.className = 'runner-toast-icon';
      ic.textContent = plain ? '!' : '✓';
      ic.setAttribute('aria-hidden', 'true');
      const body = document.createElement('span');
      body.className = 'runner-toast-body';
      const t = document.createElement('strong');
      t.textContent = title;
      const s = document.createElement('span');
      s.textContent = plain ? text : `${text} · claim it in the Arcade`;
      body.append(t, s);
      node.append(ic, body);
      box.appendChild(node);
      setTimeout(() => {
        node.classList.add('out');
        setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 350);
      }, 4200);
    },

    // -------------------------------------------------------------------------
    // Open / close / state transitions
    // -------------------------------------------------------------------------
    async open(opts = {}) {
      if (!this.isInitialized) this.init();
      if (!this.isInitialized) return;
      if (this.isOpen) {
        this.focusCanvas();
        return;
      }

      this.prevFocus = (opts && opts.returnFocus) || document.activeElement;
      this.modal.classList.add('active');
      this.initAudio();
      this.resetRun();
      this.syncFromWallet();
      this.promptDifficulty();

      const token = ++this.openToken;
      const w = wallet();
      const tasks = [
        typeof ShortcutStorage !== 'undefined' ? ShortcutStorage.getGameHighScore() : Promise.resolve(0),
        typeof ShortcutStorage !== 'undefined' ? ShortcutStorage.getShortcuts() : Promise.resolve([]),
        w ? w.load().catch((e) => console.warn('[Runner] Wallet load failed:', e)) : Promise.resolve(null)
      ];
      try {
        const [best, shortcuts] = await Promise.all(tasks);
        if (token !== this.openToken || !this.isOpen) return;
        this.highScore = Math.max(0, Number(best) || 0);
        this.runStartBest = this.highScore;
        this.cacheShortcuts(shortcuts);
      } catch (e) {
        console.warn('[Runner] Could not load game data:', e);
      }
      if (token !== this.openToken || !this.isOpen) return;
      if (!this.userShortcuts.length) this.cacheShortcuts([]);
      this.syncFromWallet();
      this.updateHighBadge();
      this.requestRender();
    },

    close() {
      if (!this.isOpen && this.state === 'closed') return;
      this.finishRun('quit');
      this.commitBest();
      this.openToken++;
      this.stopLoop();
      this.stopMenuAnim();
      if (this.rewardAnim) cancelAnimationFrame(this.rewardAnim);
      this.rewardAnim = 0;
      this.state = 'closed';
      this.releaseInputs();
      this.showOverlay(null);
      if (this.el.toasts) this.el.toasts.textContent = '';
      if (this.isFullscreen) this.exitFullscreen();
      if (this.modal) this.modal.classList.remove('active');
      if (this.audioCtx && this.audioCtx.state === 'running') this.audioCtx.suspend().catch(() => {});
      const prev = this.prevFocus;
      this.prevFocus = null;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        try { prev.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
    },

    promptDifficulty() {
      if (!this.isOpen) return;
      if (this.state === 'playing' || this.state === 'countdown' || this.state === 'paused' ||
        this.state === 'dying' || this.state === 'revive') {
        this.finishRun('quit');
        this.commitBest();
      }
      this.stopLoop();
      this.releaseInputs();
      this.state = 'menu';
      this.showOverlay(this.el.menuOverlay);
      this.updateBoostUi();
      this.updateCharInfo();
      const target = this.difficulty === 'normal' ? this.el.normalBtn : this.el.nightmareBtn;
      if (target) target.focus({ preventScroll: true });
      this.startMenuAnim();
      this.requestRender();
    },

    selectDifficultyAndStart(mode) {
      if (!this.difficultyProfiles[mode]) mode = 'nightmare';
      this.difficulty = mode;
      lsSet(LS.difficulty, mode);
      this.updateDifficultyVisuals();
      this.initAudio();
      this.restart();
    },

    restart(mode = null) {
      if (!this.isOpen) return;
      if (mode && this.difficultyProfiles[mode]) this.difficulty = mode;
      this.finishRun('restart');
      this.updateDifficultyVisuals();
      this.commitBest();
      this.resetRun();
      this.state = 'playing';
      this.bestCommitted = false;
      this.runLive = true;
      this.runFinalized = false;
      this.showOverlay(null);
      this.focusCanvas();
      this.setToast('GO!', this.currentProfile.name.toUpperCase() + ' MODE', this.currentProfile.color, 70);
      this.playSfx('go');

      // Head Start consumable: begin with a jetpack burst
      const w = wallet();
      if (w && this.useHeadStart && this.headStartCount() > 0) {
        const runId = this.runId;
        this.tutorial = null;
        this.hint = null;
        this.startJet(HEADSTART_FRAMES);
        this.stats.powerups++;
        this.setToast('HEAD START!', 'jetpack burst', '#f97316', 80);
        this.playSfx('pu_jetpack');
        w.useConsumable('boost-headstart')
          .then((ok) => {
            if (!ok && this.runId === runId && this.player) {
              this.player.pt[PW_JET] = Math.min(this.player.pt[PW_JET], 1);
            }
          })
          .catch((e) => console.warn('[Runner] Head start failed:', e));
      }
      this.startLoop();
    },

    tryRestart() {
      if (this.state === 'over' && performance.now() < this.overUnlockAt) return;
      this.restart();
    },

    pause(reason = 'user') {
      if (this.state !== 'playing' && this.state !== 'countdown') return;
      this.state = 'paused';
      this.releaseInputs();
      this.stopLoop();
      this.updateShopButtons();
      this.showOverlay(this.el.pauseOverlay);
      this.updatePauseButton();
      if (reason === 'user') this.playSfx('pause');
      if (this.el.resumeBtn && reason === 'user') this.el.resumeBtn.focus({ preventScroll: true });
      this.render(1);
    },

    resume() {
      if (this.state !== 'paused') return;
      this.initAudio();
      this.showOverlay(null);
      this.state = 'countdown';
      this.countdown = 3 * 24;     // 3-2-1 at 0.4 s per tick
      this.lastCountTick = 4;
      this.updatePauseButton();
      this.focusCanvas();
      this.startLoop();
    },

    togglePause() {
      if (this.state === 'paused') this.resume();
      else this.pause();
    },

    showOverlay(node) {
      const all = [this.el.menuOverlay, this.el.pauseOverlay, this.el.overOverlay, this.el.reviveOverlay];
      all.forEach(o => { if (o) o.style.display = (o === node) ? 'flex' : 'none'; });
      if (this.modal) this.modal.dataset.runnerState = this.state;
      if (node !== this.el.menuOverlay) this.stopMenuAnim();
      this.updatePauseButton();
    },

    focusCanvas() {
      if (this.canvas && this.isOpen) {
        try { this.canvas.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
    },

    // -------------------------------------------------------------------------
    // Menu character preview
    // -------------------------------------------------------------------------
    updateCharInfo() {
      const S = SKINS[this.skinId] || SKINS[DEFAULT_SKIN];
      if (this.el.charName) this.el.charName.textContent = S.name;
      if (this.el.charHint && !this.lockHintTimer) {
        this.el.charHint.textContent = this.ownedSkins().length > 1 ? 'Press C to switch character' : 'More characters in the Arcade Shop';
      }
    },

    startMenuAnim() {
      if (this.menuAnimId || !this.el.menuPreview) return;
      this.drawMenuPreview(performance.now() / 1000);
      if (this.reducedMotion) return;
      this.menuAnimId = requestAnimationFrame(this.menuAnimCb);
    },

    stopMenuAnim() {
      if (this.menuAnimId) cancelAnimationFrame(this.menuAnimId);
      this.menuAnimId = 0;
    },

    menuAnimTick(ts) {
      this.menuAnimId = 0;
      if (this.state !== 'menu' || !this.isOpen) return;
      if (ts - this.menuAnimLast >= 33) {
        this.menuAnimLast = ts;
        this.drawMenuPreview(ts / 1000);
      }
      this.menuAnimId = requestAnimationFrame(this.menuAnimCb);
    },

    drawMenuPreview(t) {
      const c = this.el.menuPreview;
      if (!c || !this.isOpen) return;
      const box = fitCanvas(c);
      const g = c.getContext('2d');
      if (!g) return;
      const hasTrail = this.trailId !== 'trail-none';
      const s = Math.min(box.w / (hasTrail ? 104 : 66), box.h / 80);
      const ps = Math.max(1, Math.round(s * box.k * 4) / 4);
      const set = this.getFrameSet(this.skinId, ps);
      const still = this.reducedMotion;
      const phase = still ? 0 : t % 4.2;
      const fr = phase > 4.05 ? set.idle[1] : (phase > 2.6 && phase < 3.2 ? set.idle[2] : set.idle[0]);
      g.setTransform(box.k, 0, 0, box.k, 0, 0);
      g.clearRect(0, 0, box.w, box.h);
      paintPreview(g, box.w, box.h, this.skinId, this.trailId, t, fr, still);
    },

    // -------------------------------------------------------------------------
    // Run reset
    // -------------------------------------------------------------------------
    resetRun() {
      const prof = this.currentProfile;
      this.runId++;
      this.runLive = false;
      this.runFinalized = true;
      this.score = 0;
      this.bonusScore = 0;
      this.distanceScore = 0;
      this.distance = 0;
      this.prevDistance = 0;
      this.rampDistance = 0;
      this.speed = prof.baseSpeed;
      this.worldSpeed = prof.baseSpeed;
      this.slowK = 1;
      this.level = 1;
      this.lastMilestone = 0;
      this.combo = 0;
      this.comboTimer = 0;
      this.time = 0;
      this.hitStop = 0;
      this.acc = 0;
      this.shake = 0;
      this.flash = 0;
      this.dustAcc = 0;
      this.trailAcc = 0;
      this.fxAcc = 0;
      this.toast = null;
      this.hint = null;
      this.countdown = 0;
      this.obstacles = [];
      this.items = [];
      this.pN = 0;
      this.floatingTexts = [];
      this.rbCount = 0;
      this.rbHead = 0;
      this.lastType = 'none';
      this.nextSpawnAt = W + prof.initialRunway;
      this.runStartBest = this.highScore;
      this.newBestAnnounced = false;
      this.bestCommitted = true;
      this.stats = { coins: 0, tokens: 0, nearMisses: 0, smashes: 0, bestCombo: 0, powerups: 0, doubleBonus: 0 };
      this.runCoins = 0;
      this.banked = { coins: 0, powerups: 0, closecalls: 0 }; // already sent mid-run (bankRunProgress)
      this.coinPop = 0;
      this.reviveUsed = false;
      this.skyCoinAt = 0;
      this.skyCoinIdx = 0;
      this.jumpQueued = false;
      this.jumpBuffer = 0;
      this.player = {
        feet: GROUND, prevFeet: GROUND, vy: 0, h: STAND_H,
        grounded: true, jumpCount: 0, ducking: false,
        squash: 1, spin: 0, spinV: 0, flip: 0,
        runFrame: 0, happy: 0, danger: false,
        pt: new Float64Array(POWER_COUNT), pmax: new Float64Array(POWER_COUNT),
        invuln: 0, safeFall: false
      };

      // Power-up durations from wallet upgrades (seconds -> 60 Hz frames)
      const w = wallet();
      for (let i = 0; i < POWER_COUNT; i++) {
        let sec = POWERS[i].base;
        if (w) {
          const v = Number(w.getUpgradeValue(POWERS[i].up));
          if (v > 0) sec = v;
        }
        this.powerDur[i] = sec * 60;
      }

      const tutorialDone = lsGet(LS.tutorial) === '1';
      this.tutorial = tutorialDone ? null : { i: 0, pending: null, nextAt: 140 };
      if (this.tutorial) this.hint = { parts: TUTORIAL_STEPS[0].hint, life: Infinity };

      this.updateScoreBadge(true);
      this.updateHighBadge();
    },

    // -------------------------------------------------------------------------
    // Loop
    // -------------------------------------------------------------------------
    startLoop() {
      if (this.rafId && this.renderOnly) {
        // a one-off redraw is queued: replace it with the real loop
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      this.renderOnly = false;
      if (this.rafId) return;
      this.lastTs = performance.now();
      this.acc = 0;
      this.rafId = requestAnimationFrame(this.loopCb);
    },

    stopLoop() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      this.renderOnly = false;
    },

    requestRender() {
      if (!this.isOpen) return;
      if (this.rafId) return; // the running loop (or a queued redraw) will draw
      this.renderOnly = true;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        this.renderOnly = false;
        this.render(1);
      });
    },

    isSimState() {
      return this.state === 'playing' || this.state === 'countdown' || this.state === 'dying';
    },

    loop(ts) {
      this.rafId = 0;
      if (!this.isOpen) return;
      let elapsed = ts - this.lastTs;
      this.lastTs = ts;
      if (!(elapsed >= 0)) elapsed = 0;
      if (elapsed > 100) elapsed = 100;

      if (this.state === 'revive') this.tickRevive(elapsed);

      const sim = this.isSimState();
      const effects = (this.state === 'over' && performance.now() < this.effectsUntil) || this.state === 'revive';

      if (sim || effects) {
        this.acc += elapsed;
        let n = 0;
        while (this.acc >= STEP_MS && n < MAX_STEPS) {
          if (sim) this.step();
          else this.stepEffects(DT);
          this.acc -= STEP_MS;
          n++;
          if (!(this.isSimState() || this.state === 'over' || this.state === 'revive')) break;
        }
        if (n >= MAX_STEPS) this.acc = 0;
      }

      this.render(sim ? clamp(this.acc / STEP_MS, 0, 1) : 1);

      const keep = this.isSimState() || this.state === 'revive' ||
        (this.state === 'over' && performance.now() < this.effectsUntil);
      if (keep && this.isOpen) this.rafId = requestAnimationFrame(this.loopCb);
    },

    speedFor(rampDist) {
      const prof = this.currentProfile;
      return prof.baseSpeed + (prof.maxSpeed - prof.baseSpeed) * (1 - Math.exp(-Math.max(0, rampDist) / prof.ramp));
    },

    get progress() {
      const prof = this.currentProfile;
      return clamp((this.speed - prof.baseSpeed) / (prof.maxSpeed - prof.baseSpeed), 0, 1);
    },

    get multiplier() {
      return Math.min(4, 1 + Math.floor(this.combo / 10));
    },

    // -------------------------------------------------------------------------
    // Simulation step (fixed DT)
    // -------------------------------------------------------------------------
    step() {
      const p = this.player;
      this.prevDistance = this.distance;
      p.prevFeet = p.feet;

      if (this.hitStop > 0) {
        this.hitStop -= DT;
        return;
      }
      this.time += DT / 60;

      if (this.state === 'countdown') {
        this.countdown -= DT;
        const tick = Math.ceil(this.countdown / 24);
        if (tick !== this.lastCountTick) {
          this.lastCountTick = tick;
          if (tick > 0) this.playSfx('tick');
        }
        if (this.countdown <= 0) {
          this.state = 'playing';
          this.playSfx('go');
        }
        this.stepEffects(DT);
        return;
      }

      if (this.state === 'dying') {
        this.stepDying(DT);
        this.stepEffects(DT);
        return;
      }

      if (this.state !== 'playing') {
        this.stepEffects(DT);
        return;
      }

      // ---- Playing ----
      const prof = this.currentProfile;
      this.speed = this.speedFor(this.rampDistance);
      const slowTarget = p.pt[PW_SLOW] > 0 ? 0.6 : 1;
      this.slowK += (slowTarget - this.slowK) * Math.min(1, 0.12 * DT);
      const ws = this.speed * this.slowK;
      this.worldSpeed = ws;
      this.distance += ws * DT;
      if (!this.tutorial) this.rampDistance += ws * DT;

      // Score / progression feedback
      this.distanceScore = Math.floor(this.distance / 9);
      this.score = this.distanceScore + this.bonusScore;
      this.checkProgression(prof);

      // Timers
      for (let i = 0; i < POWER_COUNT; i++) {
        if (p.pt[i] > 0) {
          p.pt[i] -= DT;
          if (p.pt[i] <= 0) {
            p.pt[i] = 0;
            this.onPowerEnd(i);
          }
        }
      }
      if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - DT);
      if (p.happy > 0) p.happy = Math.max(0, p.happy - DT);
      if (this.coinPop > 0) this.coinPop = Math.max(0, this.coinPop - 0.08 * DT);
      if (this.jumpBuffer > 0) this.jumpBuffer = Math.max(0, this.jumpBuffer - DT);
      if (this.comboTimer > 0) {
        this.comboTimer -= DT;
        if (this.comboTimer <= 0) { this.comboTimer = 0; this.combo = 0; }
      }
      const jetOn = p.pt[PW_JET] > 0;

      // Input
      if (this.jumpQueued) {
        this.jumpQueued = false;
        if (!jetOn) this.doJump();
      }
      const duckHeld = this.duckSources.size > 0;

      // Physics
      if (jetOn) {
        // Critically-damped-ish spring towards cruising height
        p.vy += ((JET_FEET - p.feet) * 0.02 - p.vy * 0.2) * DT;
        p.feet += p.vy * DT;
        p.grounded = false;
        p.jumpCount = 2;
        p.flip = 0;
        p.spin = 0;
      } else if (!p.grounded) {
        p.vy += GRAVITY * (p.safeFall ? 0.55 : 1) * DT;
        if (duckHeld) p.vy += GRAVITY * 1.6 * DT; // fast-fall
        p.feet += p.vy * DT;
        if (p.feet >= GROUND) {
          p.feet = GROUND;
          p.vy = 0;
          p.grounded = true;
          p.jumpCount = 0;
          p.squash = 0.8;
          p.flip = 0;
          p.spin = 0;
          if (p.safeFall) {
            p.safeFall = false;
            p.invuln = Math.max(p.invuln, LAND_INVULN);
            this.emitDust(PCX, GROUND, 10);
          }
          this.emitDust(PCX, GROUND, 5);
          if (this.jumpBuffer > 0) {
            this.jumpBuffer = 0;
            this.doJump();
          }
        }
      }
      if (p.flip > 0) {
        p.flip = Math.max(0, p.flip - DT / 26);
        p.spin = p.flip > 0 ? (1 - p.flip) * TAU : 0;
      }
      const wasDucking = p.ducking;
      p.ducking = duckHeld && p.grounded && !jetOn;
      p.h = p.ducking ? DUCK_H : STAND_H;
      if (p.ducking && !wasDucking) this.emitSparks(PLAYER_X + 24, GROUND, 6);
      p.squash += (1 - p.squash) * 0.18 * DT;
      p.runFrame += DT * (0.6 + this.worldSpeed / 10);

      // Distance-based dust / sparks
      if (p.grounded) {
        this.dustAcc += ws * DT;
        const every = p.ducking ? 18 : 52;
        if (this.dustAcc >= every) {
          this.dustAcc = 0;
          if (p.ducking) this.emitSparks(PLAYER_X + 12, GROUND, 2);
          else this.emitDust(PLAYER_X + 8, GROUND, 2);
        }
      }
      this.emitTrail(ws, p, jetOn);

      // Spawning
      if (this.tutorial) this.updateTutorial();
      else {
        let guard = 0;
        while (this.nextSpawnAt < this.distance + W + 80 && guard++ < 4) this.spawnNext();
      }
      if (jetOn) this.spawnSkyCoins(ws, p);

      // Obstacles
      const box = this.playerBox();
      const shielded = p.pt[PW_SHIELD] > 0;
      const safe = jetOn || p.safeFall || p.invuln > 0;
      let danger = false;
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const o = this.obstacles[i];
        const x = o.wx - this.distance;
        if (o.def.bob) o.y = o.baseY + Math.sin(this.time * 4.2 + o.phase) * o.def.bob;

        if (!o.passed && !o.ghost) {
          const ol = x + 3;
          const or = x + o.w - 3;
          const ot = o.y + 3;
          const ob = o.y + o.h - (o.def.ground ? 0 : 3);
          const front = x - (PLAYER_X + PLAYER_W);
          if (!safe && front > 0 && front < 110 && (o.def.ground || o.type === 'droneLow')) danger = true;

          if (box.r > ol && box.l < or) {
            // Horizontal overlap: collision + near-miss tracking
            if (box.b > ot && box.t < ob) {
              if (shielded) {
                this.smash(o, x);
                this.obstacles.splice(i, 1);
                continue;
              }
              if (safe) {
                o.ghost = true;
                o.passed = true;
                continue;
              }
              this.die(o, x);
              return;
            }
            if (!safe) {
              const gap = Math.max(ot - box.b, box.t - ob);
              if (gap < o.minGap) o.minGap = gap;
            }
          }
          if (or < box.l) {
            o.passed = true;
            if (o.minGap <= NEAR_MISS_PX) {
              this.stats.nearMisses++;
              this.comboEvent(10, PLAYER_X + 20, box.t - 14, 'CLOSE! ');
              this.playSfx('near');
            }
          }
        }
        if (x + o.w < -40) this.obstacles.splice(i, 1);
      }
      p.danger = danger;

      // Items (with Coin Magnet pull)
      const magnetOn = p.pt[PW_MAGNET] > 0;
      const pcy = p.feet - p.h * 0.5;
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        let x = it.wx - this.distance;
        if (magnetOn && !it.pulled && it.type !== 'power' && x > PCX - 60 && x < PCX + MAGNET_R) {
          const y0 = it.y + Math.sin(this.time * 5 + it.phase) * 4;
          const dx = PCX - x;
          const dy = pcy - y0;
          if (dx * dx + dy * dy < MAGNET_R * MAGNET_R) {
            it.pulled = true;
            it.y = y0;
          }
        }
        if (it.pulled) {
          const dx = PCX - x;
          const dy = pcy - it.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const sp = Math.min(d, (5 + d * 0.1) * DT * 1.6);
          it.wx += (dx / d) * sp;
          it.y += (dy / d) * sp;
          x = it.wx - this.distance;
        }
        const y = it.pulled ? it.y : it.y + Math.sin(this.time * 5 + it.phase) * 4;
        const nx = clamp(x, box.l - 4, box.r + 4);
        const ny = clamp(y, box.t - 4, box.b + 4);
        const dx = x - nx;
        const dy = y - ny;
        if (dx * dx + dy * dy < it.r * it.r) {
          this.collect(it, x, y);
          this.items.splice(i, 1);
          continue;
        }
        if (x < -40) this.items.splice(i, 1);
      }

      this.stepEffects(DT);
      this.updateScoreBadge();
    },

    emitTrail(ws, p, jetOn) {
      const top = p.feet - p.h;
      // Rainbow ribbon samples (every step)
      if (this.trailId === 'trail-rainbow') {
        this.rbHead = (this.rbHead + 1) % RB_N;
        this.rbY[this.rbHead] = top + p.h * (p.ducking ? 0.45 : 0.5);
        this.rbD[this.rbHead] = this.distance;
        if (this.rbCount < RB_N) this.rbCount++;
      } else if (this.trailId === 'trail-sparkle') {
        this.trailAcc += ws * DT;
        if (this.trailAcc >= 16) {
          this.trailAcc = 0;
          this.emit(PCX - 14 + rand(-3, 3), top + rand(6, p.h - 4), -ws * 0.85 - rand(0, 0.6), rand(-0.5, 0.4), 0.01,
            rand(1.8, 3.4), pick(C_SPARKLE_TRAIL), rand(22, 34), 1, 0);
        }
      } else if (this.trailId === 'trail-fire') {
        this.trailAcc += ws * DT;
        if (this.trailAcc >= 7) {
          this.trailAcc = 0;
          const n = this.reducedMotion ? 1 : 2;
          for (let k = 0; k < n; k++) {
            this.emit(PCX - 12 + rand(-2, 2), top + p.h * rand(0.35, 0.9), -ws * 0.55 - rand(0.5, 1.5), -rand(0.3, 1.1), -0.02,
              rand(3.5, 6.5), pick(C_FIRE), rand(12, 20), 2, 0);
          }
        }
      }
      // Golden Legend sparkles
      if (this.skinId === 'skin-golden' && !this.reducedMotion) {
        this.fxAcc += DT;
        if (this.fxAcc >= 9) {
          this.fxAcc = 0;
          this.emit(PCX + rand(-18, 18), top + rand(-6, p.h), -ws * 0.3, -rand(0.1, 0.5), 0, rand(1.6, 2.8), pick(C_GOLD), 26, 1, 1);
        }
      }
      // Jetpack exhaust
      if (jetOn) {
        this.emit(PCX - 20 + rand(-2, 2), p.feet - 18, -ws * 0.4 - rand(0.5, 1.5), rand(2, 4), 0, rand(2.5, 4.5), pick(C_FIRE), 14, 2, 0);
      }
    },

    spawnSkyCoins(ws, p) {
      const travel = (W + 20 - PCX) / Math.max(1, ws);
      if (p.pt[PW_JET] > travel + 12 && this.distance >= this.skyCoinAt) {
        const k = this.skyCoinIdx++;
        this.items.push(this.makeItem('coin', this.distance + W + 20, JET_FEET - 26 + Math.sin(k * 0.45) * 16));
        this.skyCoinAt = this.distance + 32 * Math.max(1, ws / 6);
      }
    },

    stepDying(dt) {
      const p = this.player;
      this.dyingTimer += dt;
      if (!p.grounded) {
        p.vy += GRAVITY * dt;
        p.feet += p.vy * dt;
        p.spin += p.spinV * dt;
        if (p.feet >= GROUND) {
          p.feet = GROUND;
          p.grounded = true;
          p.vy = 0;
          p.squash = 0.75;
          p.spin = 0;
          this.emitDust(PCX, GROUND, 8);
        }
      }
      p.squash += (1 - p.squash) * 0.15 * dt;
      if (this.dyingTimer >= 48) this.afterDeath();
    },

    stepEffects(dt) {
      const ps = this.particles;
      for (let i = this.pN - 1; i >= 0; i--) {
        const pt = ps[i];
        pt.vy += pt.g * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.life -= dt;
        if (pt.life <= 0) {
          // swap with the last live particle (pool objects are reused, never freed)
          const last = this.pN - 1;
          ps[i] = ps[last];
          ps[last] = pt;
          this.pN = last;
        }
      }
      for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
        const ft = this.floatingTexts[i];
        ft.y += ft.vy * dt;
        ft.vy *= Math.pow(0.96, dt);
        ft.life -= dt;
        if (ft.life <= 0) this.floatingTexts.splice(i, 1);
      }
      if (this.toast) {
        this.toast.life -= dt;
        if (this.toast.life <= 0) this.toast = null;
      }
      if (this.hint && this.hint.life !== Infinity) {
        this.hint.life -= dt;
        if (this.hint.life <= 0) this.hint = null;
      }
      this.shake = Math.max(0, this.shake - 0.6 * dt);
      this.flash = Math.max(0, this.flash - 0.04 * dt);
      if (this.player.happy > 0 && this.state === 'over') this.player.happy = 0;
    },

    checkProgression(prof) {
      const lvl = Math.min(10, 1 + Math.floor(this.progress * 10 + 1e-6));
      if (lvl > this.level) {
        this.level = lvl;
        this.setToast('SPEED UP', `LEVEL ${lvl}`, prof.color, 90);
        this.playSfx('speedup');
        if (!this.reducedMotion) this.flash = Math.max(this.flash, 0.12);
      }
      const ms = Math.floor(this.score / 1000);
      if (ms > this.lastMilestone) {
        this.lastMilestone = ms;
        this.player.happy = 50;
        this.createFloatingText(PLAYER_X + 30, this.player.feet - STAND_H - 18, `${ms * 1000}!`, '#00f2fe', 15);
        this.playSfx('milestone');
      }
      if (!this.newBestAnnounced && this.runStartBest > 0 && this.score > this.runStartBest) {
        this.newBestAnnounced = true;
        this.setToast('NEW BEST!', 'Keep going…', '#ffd200', 110);
        this.playSfx('newbest');
        this.emitConfetti(W / 2, 70, 40);
      }
      if (this.score > this.highScore) {
        this.highScore = this.score;
        this.updateHighBadge();
      }
    },

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------
    queueJump() {
      if (this.state === 'playing') this.jumpQueued = true;
    },

    doJump() {
      const p = this.player;
      if (p.jumpCount >= 2) {
        this.jumpBuffer = 7; // pressed slightly early: jump on landing
        return;
      }
      if (p.jumpCount === 0) {
        p.vy = JUMP_V;
        p.squash = 1.22;
        this.playSfx('jump');
        this.emitThruster(PCX - 10, p.feet - 4, '#00f2fe');
      } else {
        p.vy = DJUMP_V;
        p.squash = 1.18;
        if (!this.reducedMotion) {
          p.flip = 1;
          p.spin = 0;
        }
        this.playSfx('doubleJump');
        this.emitRing(PCX, p.feet);
        this.emitThruster(PCX - 10, p.feet - 4, '#38ef7d');
      }
      p.jumpCount++;
      p.grounded = false;
      p.ducking = false;
      p.h = STAND_H;
    },

    setDuck(source, on) {
      const had = this.duckSources.size > 0;
      if (on) this.duckSources.add(source);
      else this.duckSources.delete(source);
      const p = this.player;
      if (!had && this.duckSources.size > 0 && this.state === 'playing' && p && !p.grounded && !(p.pt[PW_JET] > 0)) {
        p.vy = Math.max(p.vy, 5); // snap into a fast-fall
      }
    },

    releaseInputs() {
      this.duckSources.clear();
      this.pointers.clear();
      this.jumpQueued = false;
      this.jumpBuffer = 0;
    },

    playerBox() {
      const p = this.player;
      const top = p.feet - p.h;
      const b = this.box;
      b.l = PLAYER_X + 7;
      b.r = PLAYER_X + PLAYER_W - 7;
      b.t = top + (p.ducking ? 3 : 6);
      b.b = p.feet - 3;
      return b;
    },

    comboEvent(points, x, y, label = '') {
      this.combo++;
      this.comboTimer = COMBO_WINDOW;
      if (this.combo > this.stats.bestCombo) this.stats.bestCombo = this.combo;
      const prevMult = Math.min(4, 1 + Math.floor((this.combo - 1) / 10));
      const mult = this.multiplier;
      const gained = points * mult;
      this.bonusScore += gained;
      this.score = this.distanceScore + this.bonusScore;
      this.player.happy = 36;
      this.createFloatingText(x, y, `${label}+${gained}`, mult > 1 ? '#fbbf24' : '#ffffff');
      if (mult > prevMult) {
        this.setToast(`×${mult} COMBO`, 'chain coins & close calls', '#fbbf24', 70);
        this.playSfx('combo');
      }
    },

    addRunCoins(base) {
      const dbl = this.player.pt[PW_DOUBLE] > 0;
      const v = dbl ? base * 2 : base;
      this.runCoins += v;
      if (dbl) this.stats.doubleBonus += base;
      this.coinPop = 1;
      return v;
    },

    collect(it, x, y) {
      const p = this.player;
      if (it.type === 'coin') {
        this.stats.coins++;
        this.addRunCoins(COIN_VALUE);
        this.comboEvent(3, x, y - 12);
        this.playSfx('coin');
        this.emitBurst(x, y, 6, C_COIN, 2.2);
      } else if (it.type === 'token') {
        this.stats.tokens++;
        const v = this.addRunCoins(TOKEN_VALUE);
        const name = (it.shortcut && it.shortcut.name) ? String(it.shortcut.name).slice(0, 14) : 'Shortcut';
        this.comboEvent(30, x, y - 14, name + ' ');
        this.createFloatingText(x, y + 12, `+${v} coins`, '#ffd200', 11);
        this.playSfx('token');
        this.emitBurst(x, y, 12, C_TOKEN, 3);
      } else if (it.type === 'power') {
        this.activatePower(it.power, x, y);
        p.happy = 50;
      }
    },

    activatePower(i, x, y) {
      const P = POWERS[i];
      const p = this.player;
      const dur = this.powerDur[i];
      this.stats.powerups++;
      if (i === PW_JET) this.startJet(dur);
      else {
        p.pt[i] = Math.max(p.pt[i], dur);
        p.pmax[i] = Math.max(dur, p.pt[i]);
      }
      this.createFloatingText(x, y - 12, P.name.toUpperCase() + '!', P.color, 14);
      this.playSfx('pu_' + P.id);
      this.emitBurst(x, y, 16, P.burst, 3.2);
    },

    startJet(frames) {
      const p = this.player;
      p.pt[PW_JET] = Math.max(p.pt[PW_JET], frames);
      p.pmax[PW_JET] = Math.max(frames, p.pt[PW_JET]);
      p.grounded = false;
      p.jumpCount = 2;
      p.ducking = false;
      p.h = STAND_H;
      p.safeFall = false;
      p.flip = 0;
      p.spin = 0;
      if (p.vy > 0) p.vy = 0;
      this.jumpBuffer = 0;
      this.skyCoinAt = this.distance + 40;
    },

    onPowerEnd(i) {
      const p = this.player;
      if (i === PW_JET) {
        // Gentle, protected descent; one mid-air jump stays available
        p.safeFall = true;
        p.jumpCount = 1;
        if (p.vy < -1) p.vy = -1;
        this.createFloatingText(PCX, p.feet - STAND_H - 12, 'Safe landing', '#fdba74', 11);
      }
      this.playSfx('pu_end');
    },

    smash(o, x) {
      this.stats.smashes++;
      this.playSfx('smash');
      this.comboEvent(20, x + o.w / 2, o.y - 6, 'SMASH ');
      this.emitBurst(x + o.w / 2, o.y + o.h / 2, 22, C_SMASH, 6);
      this.hitStop = 3;
      if (!this.reducedMotion) this.shake = Math.max(this.shake, 4);
    },

    die(o, x) {
      const p = this.player;
      this.state = 'dying';
      this.dyingTimer = 0;
      this.hitStop = 8;
      this.releaseInputs();
      this.playSfx('hit');
      const S = SKINS[this.skinId] || SKINS[DEFAULT_SKIN];
      this.emitBurst(PCX, p.feet - p.h / 2, 26, [S.fx, '#ffffff', '#f43f5e', S.top], 5.5);
      if (!this.reducedMotion) {
        this.shake = 9;
        this.flash = 0.35;
      }
      // Knock-back
      p.grounded = false;
      p.ducking = false;
      p.h = STAND_H;
      p.vy = -6;
      p.flip = 0;
      p.spin = 0;
      p.spinV = -0.09;
      this.comboTimer = 0;
      this.combo = 0;
      this.hint = null;
      void o; void x;
    },

    // -------------------------------------------------------------------------
    // Second Chance (revive consumable)
    // -------------------------------------------------------------------------
    afterDeath() {
      if (!this.reviveUsed && this.reviveCount() > 0 && this.el.reviveOverlay) this.enterRevive();
      else this.showGameOver();
    },

    enterRevive() {
      this.state = 'revive';
      this.revivePending = false;
      this.reviveLeft = REVIVE_MS;
      this.reviveShownSec = -1;
      this.reviveUnlockAt = performance.now() + 450;
      this.updateReviveLabel();
      this.tickRevive(0);
      this.showOverlay(this.el.reviveOverlay);
      this.playSfx('pause');
      if (this.el.live) this.el.live.textContent = 'Second chance? Press Space to continue or Escape to give up.';
      setTimeout(() => {
        if (this.state === 'revive' && this.el.reviveYes) this.el.reviveYes.focus({ preventScroll: true });
      }, 460);
    },

    tickRevive(elapsed) {
      if (this.revivePending) return; // waiting for the wallet to confirm the Second Chance
      this.reviveLeft -= elapsed;
      const left = Math.max(0, this.reviveLeft);
      const sec = Math.ceil(left / 1000);
      if (sec !== this.reviveShownSec) {
        this.reviveShownSec = sec;
        if (this.el.reviveCount) this.el.reviveCount.textContent = COUNT_STR[clamp(sec, 0, 5)];
        if (sec > 0 && elapsed > 0) this.playSfx('tick');
      }
      if (this.el.reviveBar) this.el.reviveBar.style.transform = `scaleX(${(left / REVIVE_MS).toFixed(3)})`;
      if (this.reviveLeft <= 0) this.declineRevive();
    },

    acceptRevive() {
      if (this.state !== 'revive' || this.revivePending || performance.now() < this.reviveUnlockAt) return;
      this.reviveUsed = true;
      const w = wallet();
      if (!w) {
        this.applyRevive();
        return;
      }
      // Consume first; only revive once the wallet confirms (count may be stale / spent in another tab).
      // The loop keeps rendering; the countdown is frozen while the "…" state is shown.
      this.revivePending = true;
      const runId = this.runId;
      const label = this.el.reviveLeftLabel;
      if (label) label.textContent = '…';
      const done = (ok) => {
        if (!this.revivePending || this.runId !== runId || this.state !== 'revive') return;
        this.revivePending = false;
        if (ok) {
          this.applyRevive();
        } else {
          this.updateReviveLabel();
          this.showGameOver();
          this.pushToast('No Second Chance left', 'It was already used up.', true);
        }
      };
      w.useConsumable('item-revive')
        .then((ok) => done(!!ok))
        .catch((e) => {
          console.warn('[Runner] Revive failed:', e);
          done(false);
        });
    },

    applyRevive() {
      // Clear nearby obstacles with a burst
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const o = this.obstacles[i];
        const x = o.wx - this.distance;
        if (x < PLAYER_X + 460) {
          if (x > -o.w) this.emitBurst(x + o.w / 2, o.y + o.h / 2, 12, C_REVIVE, 4);
          this.obstacles.splice(i, 1);
        }
      }
      const p = this.player;
      p.feet = GROUND;
      p.prevFeet = GROUND;
      p.vy = 0;
      p.grounded = true;
      p.jumpCount = 0;
      p.ducking = false;
      p.h = STAND_H;
      p.spin = 0;
      p.spinV = 0;
      p.flip = 0;
      p.squash = 1;
      p.pt.fill(0);
      p.safeFall = false;
      p.invuln = REVIVE_INVULN;
      this.slowK = 1;
      this.state = 'countdown';
      this.countdown = 2 * 24;
      this.lastCountTick = 3;
      this.showOverlay(null);
      this.focusCanvas();
      this.emitRing(PCX, GROUND);
      this.setToast('SECOND CHANCE!', '2 s of invulnerability', '#34d399', 90);
      this.playSfx('revive');
      this.startLoop();
    },

    declineRevive() {
      if (this.state !== 'revive' || this.revivePending) return;
      this.showGameOver();
    },

    showGameOver() {
      this.state = 'over';
      this.player.happy = 0;
      const prevBest = this.runStartBest;
      const isNewBest = this.score > prevBest && this.score > 0;
      this.highScore = Math.max(this.highScore, this.score);
      this.updateHighBadge();
      this.commitBest();
      const w = wallet();
      const coins = this.runCoins;

      const el = this.el;
      if (el.finalScore) el.finalScore.textContent = fmt(this.score);
      if (el.bestScore) el.bestScore.textContent = fmt(this.highScore);
      if (el.statDistance) el.statDistance.textContent = `${fmt(Math.floor(this.distance / PX_PER_METER))} m`;
      if (el.statCoins) el.statCoins.textContent = String(this.stats.coins + this.stats.tokens);
      if (el.statCombo) el.statCombo.textContent = String(this.stats.bestCombo);
      if (el.statNear) el.statNear.textContent = String(this.stats.nearMisses);
      if (el.newBest) el.newBest.hidden = !isNewBest;
      if (el.reward) el.reward.hidden = !w;
      if (el.rewardVal) el.rewardVal.textContent = '+0';
      if (el.rewardTotal) el.rewardTotal.textContent = w && coins <= 0 ? `Balance ${fmt(w.getCoins())}` : '';
      if (el.rewardBonus) {
        el.rewardBonus.hidden = !(this.stats.doubleBonus > 0);
        el.rewardBonus.textContent = `incl. +${this.stats.doubleBonus} from 2×`;
      }
      const banner = el.overOverlay ? el.overOverlay.querySelector('.game-over-banner') : null;
      if (banner) banner.textContent = this.difficulty === 'nightmare' ? '💀 NIGHTMARE SLAIN' : 'GAME OVER';
      if (el.overOverlay) el.overOverlay.classList.toggle('is-new-best', isNewBest);

      this.finishRun('over');
      this.updateShopButtons();
      this.showOverlay(el.overOverlay);
      if (w) this.animateCoinReward(coins);
      this.overUnlockAt = performance.now() + 450;
      this.effectsUntil = performance.now() + (isNewBest ? 2200 : 900);
      if (isNewBest) {
        this.playSfx('newbest');
        this.emitConfetti(W / 2, 40, 70);
      }
      if (el.live) {
        el.live.textContent = `Game over. Score ${this.score}.` + (isNewBest ? ' New best!' : ` Best ${this.highScore}.`) +
          (w ? ` You earned ${coins} coins.` : '');
      }
      // Focus the retry button only after the lockout, so a held/mashed Space can't instantly restart.
      setTimeout(() => {
        if (this.state === 'over' && this.el.restartBtn) this.el.restartBtn.focus({ preventScroll: true });
      }, 460);
    },

    animateCoinReward(target) {
      const node = this.el.rewardVal;
      if (!node) return;
      if (this.rewardAnim) cancelAnimationFrame(this.rewardAnim);
      this.rewardAnim = 0;
      if (this.reducedMotion || target <= 0) {
        node.textContent = `+${fmt(target)}`;
        return;
      }
      const t0 = performance.now() + 250;
      const dur = Math.min(1400, 500 + target * 12);
      let shown = -1;
      const tick = (now) => {
        this.rewardAnim = 0;
        if (this.state !== 'over') { node.textContent = `+${fmt(target)}`; return; }
        const k = clamp((now - t0) / dur, 0, 1);
        const v = Math.round(target * (1 - Math.pow(1 - k, 3)));
        if (v !== shown) {
          shown = v;
          node.textContent = `+${fmt(v)}`;
        }
        if (k < 1) this.rewardAnim = requestAnimationFrame(tick);
        else this.playSfx('tally');
      };
      this.rewardAnim = requestAnimationFrame(tick);
    },

    commitBest() {
      if (this.bestCommitted) return;
      this.bestCommitted = true;
      const score = this.score;
      if (score <= 0) return;
      this.highScore = Math.max(this.highScore, score);
      this.updateHighBadge();
      if (typeof ShortcutStorage === 'undefined' || !ShortcutStorage.saveGameHighScore) return;
      Promise.resolve()
        .then(() => ShortcutStorage.saveGameHighScore(score))
        .then((saved) => {
          const n = Number(saved);
          if (n > this.highScore) {
            this.highScore = n;
            this.updateHighBadge();
            if (this.el.bestScore) this.el.bestScore.textContent = fmt(this.highScore);
          }
        })
        .catch((e) => console.warn('[Runner] Error saving high score:', e));
    },

    // Kept for compatibility with older callers
    triggerGameOver() {
      if (this.state === 'playing') this.die(null, 0);
    },

    // -------------------------------------------------------------------------
    // Spawning
    // -------------------------------------------------------------------------
    cacheShortcuts(shortcuts = []) {
      const fallbacks = [
        { id: 'fb-github', name: 'GitHub', url: 'https://github.com' },
        { id: 'fb-google', name: 'Google', url: 'https://google.com' },
        { id: 'fb-youtube', name: 'YouTube', url: 'https://youtube.com' },
        { id: 'fb-reddit', name: 'Reddit', url: 'https://reddit.com' },
        { id: 'fb-stackoverflow', name: 'Stack Overflow', url: 'https://stackoverflow.com' },
        { id: 'fb-chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com' },
        { id: 'fb-netflix', name: 'Netflix', url: 'https://netflix.com' }
      ];
      const valid = (Array.isArray(shortcuts) ? shortcuts : [])
        .filter(s => s && typeof s.url === 'string' && s.url);
      this.userShortcuts = valid.length >= 3 ? valid : [...valid, ...fallbacks];

      this.userShortcuts.forEach(s => {
        const key = this.iconKey(s);
        if (this.faviconCache.has(key)) return;
        const icon = s.icon && typeof s.icon === 'object' ? s.icon : null;
        if (icon && icon.type === 'emoji' && icon.value) {
          this.faviconCache.set(key, null); // drawn as text
          return;
        }
        let src = '';
        if (icon && (icon.type === 'upload' || icon.type === 'url') && typeof icon.value === 'string' && icon.value) {
          src = icon.value;
        } else if (typeof FaviconResolver !== 'undefined' && FaviconResolver.getFaviconUrl) {
          src = FaviconResolver.getFaviconUrl(s.url) || '';
        } else {
          try {
            const u = new URL(s.url);
            if (u.protocol === 'http:' || u.protocol === 'https:') src = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
          } catch (e) { src = ''; }
        }
        if (!src) {
          // Special-scheme / unresolvable: behave like a failed load -> letter badge, no request
          this.faviconCache.set(key, null);
          return;
        }
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
        this.faviconCache.set(key, img);
      });
    },

    iconKey(s) {
      const icon = s && s.icon && typeof s.icon === 'object' ? s.icon : null;
      if (icon && icon.value && (icon.type === 'upload' || icon.type === 'url' || icon.type === 'emoji')) {
        return `${icon.type}:${String(icon.value).slice(0, 200)}`;
      }
      return s ? s.url : '';
    },

    randomShortcut() {
      if (!this.userShortcuts.length) this.cacheShortcuts([]);
      return pick(this.userShortcuts);
    },

    addObstacle(type, wx) {
      const def = OBSTACLES[type];
      const y = def.ground ? GROUND - def.h : GROUND - def.clearance - def.h;
      const o = {
        type, def, wx, y, baseY: y, w: def.w, h: def.h,
        phase: Math.random() * Math.PI * 2,
        shortcut: this.randomShortcut(),
        shortcut2: (type === 'wide' || type === 'tall') ? this.randomShortcut() : null,
        passed: false,
        ghost: false,
        minGap: Infinity
      };
      this.obstacles.push(o);
      return o;
    },

    pickType() {
      const s = this.distanceScore;
      const k = this.currentProfile.unlockScale;
      const last = this.lastType;
      let total = 1.0;
      const wWide = s > 120 * k ? 0.45 : 0;
      const wLow = s > 160 * k ? 0.55 + this.progress * 0.2 : 0;
      const wTall = (s > 260 * k && last !== 'tall') ? 0.4 + this.progress * 0.2 : 0;
      const wMid = (s > 450 * k && last !== 'droneMid') ? 0.35 : 0;
      total += wWide + wLow + wTall + wMid;
      let r = Math.random() * total;
      if ((r -= 1.0) <= 0) return 'block';
      if ((r -= wWide) <= 0) return 'wide';
      if ((r -= wLow) <= 0) return 'droneLow';
      if ((r -= wTall) <= 0) return 'tall';
      if ((r -= wMid) <= 0) return 'droneMid';
      return 'block';
    },

    spawnNext() {
      const prof = this.currentProfile;
      const type = this.pickType();
      const def = OBSTACLES[type];
      const wx = this.nextSpawnAt;
      this.addObstacle(type, wx);

      // Speed when the player actually reaches this obstacle (front-to-front gap guarantee)
      const rampOffset = this.distance - this.rampDistance;
      const speed = this.speedFor(wx - PLAYER_X - rampOffset);
      const prog = clamp((speed - prof.baseSpeed) / (prof.maxSpeed - prof.baseSpeed), 0, 1);
      const react = lerp(prof.reactStart, prof.reactEnd, prog);

      // Guaranteed-fair gap: time to clear this obstacle (land, or pass under) + reaction time.
      let frames = (def.air ? LAND_FRAMES : (def.w + PLAYER_W) / speed) + react;
      frames += Math.random() * prof.extraFrames;
      const breather = Math.random() < 0.14;
      if (breather) frames += rand(35, 65);
      const gap = Math.max(def.w + 90, frames * speed);
      this.nextSpawnAt = wx + gap;
      this.lastType = type;
      this.placeItems(type, def, wx, gap, speed, react, breather);
    },

    // Weighted power-up choice among the ones not already running (-1 = none)
    pickPower() {
      const p = this.player;
      let total = 0;
      for (let i = 0; i < POWER_COUNT; i++) {
        if (p.pt[i] > 0) continue;
        if (i === PW_JET && this.distanceScore < 150) continue;
        total += POWERS[i].weight;
      }
      if (total <= 0) return -1;
      let r = Math.random() * total;
      for (let i = 0; i < POWER_COUNT; i++) {
        if (p.pt[i] > 0) continue;
        if (i === PW_JET && this.distanceScore < 150) continue;
        r -= POWERS[i].weight;
        if (r <= 0) return i;
      }
      return -1;
    },

    placeItems(type, def, wx, gap, speed, react, breather) {
      const r = Math.random();
      const cx = wx + def.w / 2;
      if (def.ground && r < 0.32) {
        // Coin arc that follows a natural jump over the obstacle
        const top = GROUND - def.h;
        for (let i = -2; i <= 2; i++) {
          this.items.push(this.makeItem('coin', cx + i * 24, top - 24 - (4 - i * i) * 5));
        }
      } else if (type === 'droneLow' && r < 0.45) {
        for (let i = 0; i < 3; i++) this.items.push(this.makeItem('coin', wx + 12 + i * 23, GROUND - 12));
      } else if (type === 'droneMid' && r < 0.4) {
        for (let i = 0; i < 3; i++) this.items.push(this.makeItem('coin', wx + 12 + i * 23, GROUND - 30));
      }

      // Items in the open gap after the obstacle, never crowding the next one
      const spanStart = wx + def.w + 70;
      const spanEnd = wx + gap - 90;
      if (spanEnd - spanStart < 150) return;
      const pr = Math.random();
      const p = this.player;
      let active = 0;
      for (let i = 0; i < POWER_COUNT; i++) if (p.pt[i] > 0) active++;
      const tokenX = wx + (LAND_FRAMES + 26) * speed;
      const tokenFits = gap >= (LAND_FRAMES + 26 + 18 + react + 6) * speed;

      if (active < 2 && !(p.pt[PW_JET] > 0) && pr < (breather ? 0.26 : 0.07)) {
        const idx = this.pickPower();
        if (idx >= 0) {
          const it = this.makeItem('power', (spanStart + spanEnd) / 2, GROUND - 40);
          it.power = idx;
          this.items.push(it);
          return;
        }
      }
      if (tokenFits && pr < 0.34) {
        const it = this.makeItem('token', tokenX, GROUND - 96);
        it.shortcut = this.randomShortcut();
        this.items.push(it);
      } else if (pr < 0.62) {
        const n = Math.min(6, Math.floor((spanEnd - spanStart) / 26));
        for (let i = 0; i < n; i++) this.items.push(this.makeItem('coin', spanStart + i * 26, GROUND - 26));
      }
    },

    makeItem(type, wx, y) {
      return {
        type, wx, y,
        r: type === 'token' ? 16 : (type === 'coin' ? 12 : 15),
        phase: Math.random() * Math.PI * 2,
        shortcut: null, power: -1, pulled: false
      };
    },

    updateTutorial() {
      const t = this.tutorial;
      if (t.pending) {
        if (t.pending.passed || this.obstacles.indexOf(t.pending) === -1) {
          t.pending = null;
          t.i++;
          t.nextAt = this.distance + 160;
          if (t.i >= TUTORIAL_STEPS.length) {
            this.tutorial = null;
            lsSet(LS.tutorial, '1');
            this.hint = { parts: [{ t: 'Nice! Coins & close calls build a ' }, { k: '×COMBO' }], life: 220 };
            this.nextSpawnAt = this.distance + W + 240;
            this.playSfx('milestone');
          } else {
            this.hint = { parts: TUTORIAL_STEPS[t.i].hint, life: Infinity };
          }
        }
        return;
      }
      if (t.i < TUTORIAL_STEPS.length && this.distance >= t.nextAt) {
        t.pending = this.addObstacle(TUTORIAL_STEPS[t.i].type, this.distance + W + 30);
        this.lastType = TUTORIAL_STEPS[t.i].type;
      }
    },

    // -------------------------------------------------------------------------
    // Particles (fixed pool) & texts
    // -------------------------------------------------------------------------
    emit(x, y, vx, vy, g, size, color, life, shape, layer) {
      if (this.pN >= MAX_PARTICLES) return;
      const pt = this.particles[this.pN++];
      pt.x = x; pt.y = y; pt.vx = vx; pt.vy = vy; pt.g = g;
      pt.size = size; pt.color = color; pt.life = life; pt.max = life;
      pt.shape = shape; pt.layer = layer;
    },
    count(n) {
      return this.reducedMotion ? Math.ceil(n / 2) : n;
    },
    emitThruster(x, y, color) {
      const n = this.count(8);
      for (let i = 0; i < n; i++) {
        this.emit(x + rand(-3, 3), y, -rand(1, 3), rand(2, 5), 0, rand(2, 4.5), i % 3 === 0 ? color : pick(C_THRUST), 14, 0, 1);
      }
    },
    emitSparks(x, y, n) {
      n = this.count(n);
      for (let i = 0; i < n; i++) {
        this.emit(x + rand(0, 10), y - 2, -rand(3, 8), -rand(0, 2), 0.12, rand(1.5, 3), pick(C_SPARK), 12, 0, 1);
      }
    },
    emitDust(x, y, n) {
      n = this.count(n);
      for (let i = 0; i < n; i++) {
        this.emit(x + rand(-6, 6), y - 1, -rand(0.8, 3), -rand(0.2, 1.4), 0.02, rand(1.5, 3.4), pick(C_DUST), 16, 0, 1);
      }
    },
    emitRing(x, y) {
      const n = this.count(12);
      for (let i = 0; i < n; i++) {
        const a = (TAU * i) / n;
        this.emit(x, y, Math.cos(a) * 3.5, Math.sin(a) * 1.5 + 0.5, 0, 2.6, '#38ef7d', 16, 0, 1);
      }
    },
    emitBurst(x, y, n, colors, spd) {
      n = this.count(n);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const s = rand(spd * 0.35, spd);
        this.emit(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.08, rand(1.8, 4), pick(colors), rand(18, 30), i % 4 === 0 ? 1 : 0, 1);
      }
    },
    emitConfetti(x, y, n) {
      if (this.reducedMotion) return;
      for (let i = 0; i < n; i++) {
        this.emit(x + rand(-160, 160), y + rand(-30, 10), rand(-2.5, 2.5), rand(-3, 1), 0.09, rand(2, 4), pick(C_CONFETTI), rand(60, 110), 0, 1);
      }
    },
    createFloatingText(x, y, text, color = '#ffd200', size = 13) {
      if (this.floatingTexts.length > 14) this.floatingTexts.shift();
      this.floatingTexts.push({ x: clamp(x, 40, W - 40), y, text, color, font: `800 ${size}px ${FONT}`, vy: -1.4, life: 42, max: 42 });
    },
    setToast(text, sub, color, life) {
      this.toast = { text, sub, color, life, max: life };
    },

    // -------------------------------------------------------------------------
    // Input
    // -------------------------------------------------------------------------
    onKeyDown(e) {
      if (!this.isOpen) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts (Ctrl+R, Ctrl+F...) alone
      const code = e.code;
      const active = document.activeElement;
      const onButton = !!(active && active.tagName === 'BUTTON' && this.modal.contains(active));

      if (e.key === 'Tab') {
        this.trapFocus(e);
        return;
      }

      if (code === 'Escape') {
        e.preventDefault();
        if (performance.now() - this.fsChangedAt < 300) return; // that Esc already exited native fullscreen
        if (this.isFullscreen) this.exitFullscreen();
        else if (this.state === 'playing' || this.state === 'countdown') this.pause();
        else if (this.state === 'revive') this.declineRevive();
        else this.close();
        return;
      }

      // Global toggles
      if (code === 'KeyM') {
        e.preventDefault();
        if (!e.repeat) this.toggleMute();
        return;
      }
      if (code === 'KeyF') {
        e.preventDefault();
        if (!e.repeat) this.toggleFullscreen();
        return;
      }
      if (code === 'KeyC') {
        e.preventDefault();
        if (!e.repeat) this.toggleSkin();
        return;
      }

      const isActivate = code === 'Space' || code === 'Enter' || code === 'NumpadEnter';
      // Keyboard users who tabbed onto a button get native activation (handlers have their own guards)
      if (isActivate && onButton && active !== this.canvas) {
        if (this.state === 'over' && performance.now() < this.overUnlockAt) e.preventDefault();
        if (this.state === 'revive' && performance.now() < this.reviveUnlockAt) e.preventDefault();
        return;
      }

      this.initAudio();
      switch (this.state) {
        case 'menu':
          // A held key from the Arcade picker must not auto-start a mode
          if (e.repeat) return;
          if (code === 'Digit1' || code === 'Numpad1' || code === 'KeyN') {
            e.preventDefault();
            this.selectDifficultyAndStart('normal');
          } else if (code === 'Digit2' || code === 'Numpad2' || code === 'KeyD') {
            e.preventDefault();
            this.selectDifficultyAndStart('nightmare');
          } else if (code === 'KeyH') {
            e.preventDefault();
            this.toggleHeadStart();
          } else if (isActivate) {
            e.preventDefault();
            this.selectDifficultyAndStart(this.difficulty);
          } else if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown') {
            e.preventDefault();
            const toNormal = code === 'ArrowLeft' || code === 'ArrowUp';
            const btn = toNormal ? this.el.normalBtn : this.el.nightmareBtn;
            if (btn) btn.focus();
          }
          break;

        case 'playing':
          if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') {
            e.preventDefault();
            if (!e.repeat) this.queueJump();
          } else if (code === 'ArrowDown' || code === 'KeyS') {
            e.preventDefault();
            if (!e.repeat) this.setDuck(code, true);
          } else if (code === 'KeyP') {
            e.preventDefault();
            if (!e.repeat) this.pause();
          } else if (code === 'KeyR') {
            e.preventDefault();
            if (!e.repeat) this.promptDifficulty();
          }
          break;

        case 'countdown':
          if (code === 'Space' || code === 'ArrowUp' || code === 'ArrowDown') e.preventDefault();
          else if (code === 'KeyP') { e.preventDefault(); this.pause(); }
          break;

        case 'paused':
          if (code === 'KeyP' || isActivate) {
            e.preventDefault();
            if (!e.repeat) this.resume();
          } else if (code === 'KeyR') {
            e.preventDefault();
            this.promptDifficulty();
          } else if (code === 'ArrowUp' || code === 'ArrowDown') {
            e.preventDefault();
          }
          break;

        case 'dying':
          if (code === 'Space' || code === 'ArrowUp' || code === 'ArrowDown') e.preventDefault();
          break;

        case 'revive':
          if (isActivate || code === 'ArrowUp' || code === 'KeyY') {
            e.preventDefault();
            if (!e.repeat) this.acceptRevive();
          } else if (code === 'KeyN') {
            e.preventDefault();
            this.declineRevive();
          } else if (code === 'ArrowDown') {
            e.preventDefault();
          }
          break;

        case 'over':
          if (isActivate || code === 'ArrowUp' || code === 'KeyW') {
            e.preventDefault();
            if (!e.repeat) this.tryRestart();
          } else if (code === 'KeyR') {
            e.preventDefault();
            this.promptDifficulty();
          } else if (code === 'ArrowDown') {
            e.preventDefault();
          }
          break;

        default:
          break;
      }
    },

    onKeyUp(e) {
      if (e.code === 'ArrowDown' || e.code === 'KeyS') this.setDuck(e.code, false);
    },

    trapFocus(e) {
      const nodes = Array.from(this.modal.querySelectorAll('button, [tabindex]:not([tabindex="-1"])'))
        .filter(n => !n.disabled && !n.hidden && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden');
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!this.modal.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },

    onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      this.initAudio();
      this.focusCanvas();
      if (this.state === 'playing') {
        this.queueJump();
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, ducking: false });
        try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      } else if (this.state === 'over') {
        this.tryRestart();
      } else if (this.state === 'paused') {
        this.resume();
      } else if (this.state === 'revive') {
        this.acceptRevive();
      }
    },

    onPointerMove(e) {
      const ptr = this.pointers.get(e.pointerId);
      if (!ptr || ptr.ducking || this.state !== 'playing') return;
      const dy = e.clientY - ptr.y;
      const dx = e.clientX - ptr.x;
      if (dy > 26 && dy > Math.abs(dx)) {
        ptr.ducking = true;
        this.setDuck('ptr' + e.pointerId, true);
      }
    },

    onPointerUp(e) {
      const ptr = this.pointers.get(e.pointerId);
      if (!ptr) return;
      if (ptr.ducking) this.setDuck('ptr' + e.pointerId, false);
      this.pointers.delete(e.pointerId);
    },

    // -------------------------------------------------------------------------
    // Characters / header toggles
    // -------------------------------------------------------------------------
    ownedSkins() {
      const w = wallet();
      if (!w) return [DEFAULT_SKIN];
      const list = SKIN_IDS.filter((id) => id === DEFAULT_SKIN || w.isOwned(id));
      return list.length ? list : [DEFAULT_SKIN];
    },

    toggleSkin() {
      const owned = this.ownedSkins();
      if (owned.length <= 1) {
        this.showLockHint();
        return;
      }
      const i = owned.indexOf(this.skinId);
      const next = owned[(i + 1) % owned.length];
      this.setSkin(next);
      const w = wallet();
      if (w) w.equip(next).catch((e) => console.warn('[Runner] Could not equip skin:', e));
      const S = SKINS[next];
      this.playSfx('skin');
      if (this.player && this.state !== 'menu') {
        this.createFloatingText(PCX + 16, this.player.feet - STAND_H - 18, S.name, S.fx);
        if (!this.rafId) {
          this.render(1);
          if (this.state === 'over') this.startLoop();
        }
      }
    },

    setSkin(id, silent) {
      if (!SKINS[id]) id = DEFAULT_SKIN;
      this.skinId = id;
      this.updateSkinTitle();
      this.updateCharInfo();
      if (this.isOpen) {
        this.getFrameSet(id, this.pixelScale); // pre-render now rather than mid-jump
        if (this.state === 'menu') this.drawMenuPreview(performance.now() / 1000);
        if (!silent && !this.rafId) this.requestRender();
      }
    },

    showLockHint() {
      this.playSfx('lock');
      const msg = this.shopAvailable() ? '🔒 Unlock more characters in the Arcade Shop' : '🔒 More characters coming from the Arcade Shop';
      if (this.el.charHint) {
        this.el.charHint.textContent = msg;
        this.el.charHint.classList.add('is-locked');
        clearTimeout(this.lockHintTimer);
        this.lockHintTimer = setTimeout(() => {
          this.lockHintTimer = 0;
          if (this.el.charHint) this.el.charHint.classList.remove('is-locked');
          this.updateCharInfo();
        }, 2600);
      }
      if (this.player && this.state !== 'menu') {
        this.createFloatingText(PCX + 40, this.player.feet - STAND_H - 18, '🔒 Buy characters in the Shop', '#e2e8f0', 12);
        if (!this.rafId) this.requestRender();
      }
    },

    updateSkinTitle() {
      const btn = this.el.skinBtn;
      if (!btn) return;
      const name = (SKINS[this.skinId] || SKINS[DEFAULT_SKIN]).name;
      btn.title = `Character: ${name} (C)`;
      btn.setAttribute('aria-label', `Change character (current: ${name})`);
    },

    toggleMute() {
      this.isMuted = !this.isMuted;
      lsSet(LS.muted, this.isMuted);
      this.updateMuteIcon();
      if (!this.isMuted) {
        this.initAudio();
        this.playSfx('coin');
      }
    },

    updateMuteIcon() {
      const btn = this.el.muteBtn;
      if (!btn) return;
      const iconMuted = btn.querySelector('.icon-muted');
      const iconSound = btn.querySelector('.icon-sound');
      if (iconMuted) iconMuted.style.display = this.isMuted ? 'inline' : 'none';
      if (iconSound) iconSound.style.display = this.isMuted ? 'none' : 'inline';
      btn.title = this.isMuted ? 'Unmute (M)' : 'Mute (M)';
      btn.setAttribute('aria-pressed', String(this.isMuted));
      btn.setAttribute('aria-label', this.isMuted ? 'Unmute game sound' : 'Mute game sound');
    },

    updatePauseButton() {
      const btn = this.el.pauseBtn;
      if (!btn) return;
      const paused = this.state === 'paused';
      const usable = this.state === 'playing' || this.state === 'countdown' || paused;
      btn.disabled = !usable;
      btn.setAttribute('aria-pressed', String(paused));
      btn.title = paused ? 'Resume (P)' : 'Pause (P / Esc)';
      const ip = btn.querySelector('.icon-pause');
      const ir = btn.querySelector('.icon-play');
      if (ip) ip.style.display = paused ? 'none' : 'inline';
      if (ir) ir.style.display = paused ? 'inline' : 'none';
    },

    toggleFullscreen() {
      if (this.isFullscreen) {
        this.exitFullscreen();
        return;
      }
      this.fsChangedAt = performance.now();
      const m = this.modal;
      const req = m.requestFullscreen || m.webkitRequestFullscreen;
      if (!req) {
        this.setFullscreenState(true); // CSS-only fallback
        return;
      }
      try {
        const res = req.call(m);
        if (res && typeof res.catch === 'function') res.catch(() => this.setFullscreenState(true));
      } catch (e) {
        this.setFullscreenState(true);
      }
    },

    exitFullscreen() {
      this.fsChangedAt = performance.now();
      if (document.fullscreenElement) {
        // fullscreenchange will sync the state
        document.exitFullscreen().catch(() => this.setFullscreenState(false));
      } else {
        this.setFullscreenState(false);
      }
    },

    setFullscreenState(on) {
      this.isFullscreen = !!on;
      if (this.modal) this.modal.classList.toggle('fullscreen', this.isFullscreen);
      const btn = this.el.fsBtn;
      if (btn) {
        const expand = btn.querySelector('.icon-expand');
        const compress = btn.querySelector('.icon-compress');
        if (expand) expand.style.display = this.isFullscreen ? 'none' : 'inline';
        if (compress) compress.style.display = this.isFullscreen ? 'inline' : 'none';
        btn.title = this.isFullscreen ? 'Exit fullscreen (F / Esc)' : 'Fullscreen (F)';
        btn.setAttribute('aria-pressed', String(this.isFullscreen));
      }
    },

    updateDifficultyVisuals() {
      const prof = this.currentProfile;
      const badge = this.el.modeBadge;
      if (badge) {
        badge.textContent = prof.badge;
        badge.className = `arcade-mode-badge ${this.difficulty}`;
        badge.setAttribute('aria-label', `Difficulty: ${prof.name}. Click to change`);
      }
      if (this.modal) {
        this.modal.classList.toggle('mode-nightmare', this.difficulty === 'nightmare');
        this.modal.classList.toggle('mode-normal', this.difficulty === 'normal');
      }
      [this.el.normalBtn, this.el.nightmareBtn].forEach(b => {
        if (b) b.classList.toggle('is-last', b.dataset.mode === this.difficulty);
      });
    },

    updateScoreBadge(force = false) {
      if (!this.el.score) return;
      if (!force && this.score === this.shownScore) return;
      this.shownScore = this.score;
      this.el.score.textContent = String(this.score).padStart(5, '0');
    },

    updateHighBadge() {
      if (!this.el.high) return;
      const txt = String(this.highScore).padStart(5, '0');
      if (this.el.high.textContent !== txt) this.el.high.textContent = txt;
    },

    // -------------------------------------------------------------------------
    // Audio
    // -------------------------------------------------------------------------
    initAudio() {
      try {
        if (!this.audioCtx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.audioCtx = new AC();
          this.master = this.audioCtx.createGain();
          this.master.gain.value = 0.42;
          this.master.connect(this.audioCtx.destination);
        }
        if (this.audioCtx.state === 'suspended' && this.isOpen) this.audioCtx.resume().catch(() => {});
      } catch (e) {
        console.warn('[Runner] Web Audio not supported:', e);
      }
    },

    tone(type, f0, f1, dur, vol, delay = 0) {
      const ac = this.audioCtx;
      const t = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) { /* ignore */ } };
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },

    noise(dur, vol, freq = 1200, delay = 0) {
      const ac = this.audioCtx;
      if (!this.noiseBuf) {
        const len = Math.floor(ac.sampleRate * 0.5);
        this.noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      const t = ac.currentTime + delay;
      const src = ac.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(freq, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.15), t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.onended = () => { try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) { /* ignore */ } };
      src.start(t);
      src.stop(t + dur + 0.02);
    },

    playSfx(type) {
      if (this.isMuted || !this.audioCtx || !this.master || !this.isOpen) return;
      if (this.audioCtx.state !== 'running') {
        this.audioCtx.resume().catch(() => {});
        if (this.audioCtx.state !== 'running') return;
      }
      try {
        switch (type) {
          case 'jump': this.tone('square', 220, 520, 0.11, 0.06); break;
          case 'doubleJump': this.tone('triangle', 420, 860, 0.14, 0.1); break;
          case 'coin': {
            const f = 880 * Math.pow(2, Math.min(this.combo, 12) / 24);
            this.tone('sine', f, f, 0.06, 0.09);
            this.tone('sine', f * 1.5, f * 1.5, 0.12, 0.07, 0.05);
            break;
          }
          case 'token':
            this.tone('triangle', 660, 660, 0.08, 0.11);
            this.tone('triangle', 990, 990, 0.08, 0.11, 0.07);
            this.tone('triangle', 1320, 1320, 0.14, 0.1, 0.14);
            break;
          case 'pu_shield':
            this.tone('triangle', 523, 1047, 0.2, 0.11);
            this.tone('sine', 784, 784, 0.22, 0.08, 0.1);
            break;
          case 'pu_magnet':
            this.tone('sine', 220, 660, 0.24, 0.1);
            this.tone('triangle', 660, 440, 0.2, 0.06, 0.12);
            break;
          case 'pu_double':
            [988, 1319, 1976].forEach((f, i) => this.tone('sine', f, f, 0.09, 0.08, i * 0.06));
            break;
          case 'pu_jetpack':
            this.noise(0.45, 0.08, 2400);
            this.tone('sawtooth', 120, 480, 0.4, 0.035);
            break;
          case 'pu_slowmo': this.tone('sine', 880, 220, 0.5, 0.09); break;
          case 'pu_end': this.tone('sine', 660, 420, 0.14, 0.045); break;
          case 'milestone':
            this.tone('triangle', 659, 659, 0.08, 0.11);
            this.tone('triangle', 1047, 1047, 0.16, 0.11, 0.08);
            break;
          case 'speedup': this.tone('sawtooth', 300, 900, 0.3, 0.035); this.tone('triangle', 600, 1200, 0.3, 0.06); break;
          case 'combo': this.tone('square', 784, 1568, 0.16, 0.045); break;
          case 'near': this.noise(0.12, 0.06, 3500); this.tone('sine', 1200, 1600, 0.08, 0.04); break;
          case 'smash': this.noise(0.18, 0.16, 1800); this.tone('sawtooth', 280, 70, 0.18, 0.09); break;
          case 'hit': this.noise(0.35, 0.2, 900); this.tone('sawtooth', 160, 40, 0.32, 0.12); break;
          case 'newbest':
            [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.14, 0.1, i * 0.09));
            break;
          case 'revive':
            [392, 523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.12, 0.09, i * 0.06));
            break;
          case 'mission':
            [784, 988, 1175, 1568].forEach((f, i) => this.tone('sine', f, f, 0.12, 0.08, i * 0.07));
            break;
          case 'tally': this.tone('sine', 1319, 1319, 0.08, 0.08); this.tone('sine', 1760, 1760, 0.14, 0.07, 0.06); break;
          case 'skin': this.tone('triangle', 600, 900, 0.1, 0.08); break;
          case 'lock': this.tone('square', 180, 140, 0.14, 0.04); break;
          case 'pause': this.tone('sine', 520, 340, 0.12, 0.07); break;
          case 'tick': this.tone('sine', 660, 660, 0.07, 0.07); break;
          case 'go': this.tone('triangle', 880, 1320, 0.16, 0.1); break;
          default: break;
        }
      } catch (err) {
        console.warn('[Runner] Audio play error:', err);
      }
    },

    // -------------------------------------------------------------------------
    // Scenery & sprites
    // -------------------------------------------------------------------------
    buildScenery() {
      const rnd = seeded(1337);
      this.stars = [];
      for (let i = 0; i < 56; i++) {
        this.stars.push({ x: rnd() * W, y: rnd() * (GROUND - 90), size: rnd() * 1.6 + 0.7, a: rnd() * 0.6 + 0.4, ph: rnd() * 6.28, sp: rnd() * 0.8 + 0.4 });
      }
      this.farCity = this.buildSkyline(seeded(42), 900, 18, 70, 22, 46, 0);
      this.nearCity = this.buildSkyline(seeded(7), 1100, 30, 100, 30, 62, 0.45);
    },

    buildSkyline(rnd, tileW, minH, maxH, minW, maxW, windowChance) {
      const body = new Path2D();
      const win = new Path2D();
      let x = 0;
      while (x < tileW - 10) {
        const bw = Math.min(tileW - x, Math.round(minW + rnd() * (maxW - minW)));
        const bh = Math.round(minH + rnd() * (maxH - minH));
        body.rect(x, GROUND - bh, bw, bh);
        if (rnd() < 0.25 && bw > 26) body.rect(x + bw / 2 - 1, GROUND - bh - 10, 2, 10);
        if (windowChance > 0) {
          for (let wy = GROUND - bh + 8; wy < GROUND - 10; wy += 11) {
            for (let wx = x + 5; wx < x + bw - 7; wx += 9) {
              if (rnd() < windowChance * 0.5) win.rect(wx, wy, 3, 4);
            }
          }
        }
        x += bw + Math.round(rnd() * 8);
      }
      return { body, win, w: tileW };
    },

    // Character frames for (skin, pixel scale); keeps a small LRU of sets.
    getFrameSet(skinId, ps) {
      const key = `${skinId}|${ps.toFixed(3)}`;
      let set = this.frameSets.get(key);
      if (set) return set;
      set = buildFrameSet(skinId, ps);
      this.frameSets.set(key, set);
      while (this.frameSets.size > 4) this.frameSets.delete(this.frameSets.keys().next().value);
      return set;
    },

    makeSprite(w, h, draw) {
      const ps = this.pixelScale;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w * ps));
      c.height = Math.max(1, Math.ceil(h * ps));
      const g = c.getContext('2d');
      g.scale(ps, ps);
      draw(g);
      return { canvas: c, w, h };
    },

    iconState(shortcut) {
      if (!shortcut) return { img: null, pending: false };
      const img = this.faviconCache.get(this.iconKey(shortcut));
      if (!img) return { img: null, pending: false };
      if (!img.complete) return { img: null, pending: true };
      if (img.naturalWidth === 0) return { img: null, pending: false };
      return { img, pending: false };
    },

    drawIcon(g, shortcut, x, y, size) {
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath();
      g.roundRect(x, y, size, size, 5);
      g.fill();
      const st = this.iconState(shortcut);
      const inner = size - 6;
      const emoji = shortcut && shortcut.icon && shortcut.icon.type === 'emoji' && shortcut.icon.value;
      if (st.img) {
        g.drawImage(st.img, x + 3, y + 3, inner, inner);
      } else if (emoji) {
        g.font = `${inner - 1}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#000000';
        g.fillText(String(emoji), x + size / 2, y + size / 2 + 1);
      } else {
        const name = (shortcut && shortcut.name) ? String(shortcut.name) : 'S';
        let color = '#2563eb';
        if (shortcut && typeof shortcut.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(shortcut.color)) {
          color = shortcut.color;
        } else if (typeof FaviconResolver !== 'undefined' && FaviconResolver.getAvatarColor) {
          try { color = FaviconResolver.getAvatarColor(name); } catch (e) { /* ignore */ }
        }
        g.fillStyle = color;
        g.beginPath();
        g.arc(x + size / 2, y + size / 2, inner / 2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffffff';
        g.font = `bold 9px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(name.trim().charAt(0).toUpperCase() || 'S', x + size / 2, y + size / 2 + 0.5);
      }
      return st.pending;
    },

    fitText(g, text, maxW) {
      let t = String(text || 'Site');
      if (g.measureText(t).width <= maxW) return t;
      while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
      return t + '…';
    },

    drawCard(g, x, y, w, h, accent, shortcut) {
      g.fillStyle = 'rgba(30, 41, 59, 0.97)';
      g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 8);
      g.fill();
      g.stroke();
      g.fillStyle = accent;
      g.beginPath();
      g.roundRect(x + 0.5, y + 0.5, w - 1, 3.5, [8, 8, 0, 0]);
      g.fill();
      const size = 22;
      const pending = this.drawIcon(g, shortcut, x + (w - size) / 2, y + 6, size);
      if (h >= 40) {
        g.fillStyle = '#f8fafc';
        g.font = `600 8.5px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.fillText(this.fitText(g, shortcut && shortcut.name, w - 8), x + w / 2, y + 6 + size + 3);
      }
      return pending;
    },

    getObstacleSprite(o) {
      // Cache key lives on the obstacle so the hot path does no string work
      let key = o.spriteKey;
      if (!key) {
        const sk = (s) => (s ? `${s.url}#${this.iconKey(s)}#${s.color || ''}#${s.name || ''}` : '');
        key = o.spriteKey = `${o.type}|${sk(o.shortcut)}|${sk(o.shortcut2)}`;
      }
      let entry = this.spriteCache.get(key);
      if (entry && entry.pending) {
        const still = this.iconState(o.shortcut).pending || (o.shortcut2 && this.iconState(o.shortcut2).pending);
        if (!still) entry = null; // favicon arrived: rebuild once
      }
      if (entry) return entry;

      const def = o.def;
      const pad = 2;
      let pending = false;
      const sprite = this.makeSprite(def.w + pad * 2, def.h + pad * 2, (g) => {
        g.translate(pad, pad);
        if (o.type === 'block') {
          pending = this.drawCard(g, 0, 0, def.w, def.h, def.accent, o.shortcut);
        } else if (o.type === 'wide') {
          const half = def.w / 2 - 1;
          pending = this.drawCard(g, 0, 0, half, def.h, def.accent, o.shortcut);
          pending = this.drawCard(g, half + 2, 0, half, def.h, def.accent, o.shortcut2) || pending;
        } else if (o.type === 'tall') {
          const hh = def.h / 2 - 1;
          pending = this.drawCard(g, 0, 0, def.w, hh, def.accent, o.shortcut);
          pending = this.drawCard(g, 0, hh + 2, def.w, hh, def.accent, o.shortcut2) || pending;
        } else {
          // Drone tile
          g.fillStyle = 'rgba(20, 28, 44, 0.97)';
          g.strokeStyle = def.accent;
          g.lineWidth = 1.2;
          g.beginPath();
          g.roundRect(0.5, 0.5, def.w - 1, def.h - 1, 8);
          g.fill();
          g.stroke();
          pending = this.drawIcon(g, o.shortcut, 5, 4, 22);
          g.textAlign = 'left';
          g.textBaseline = 'top';
          g.fillStyle = '#f8fafc';
          g.font = `600 8.5px ${FONT}`;
          g.fillText(this.fitText(g, o.shortcut && o.shortcut.name, def.w - 36), 31, 5);
          g.fillStyle = def.accent;
          g.font = `800 7.5px ${FONT}`;
          g.fillText(o.type === 'droneLow' ? '▼ DUCK' : '▬ RUN', 31, 17);
        }
      });
      sprite.pad = pad;
      sprite.pending = pending;
      this.spriteCache.set(key, sprite);
      return sprite;
    },

    getItemSprite(type, power) {
      const key = type === 'power' ? `item|power|${power}` : `item|${type}`;
      let s = this.spriteCache.get(key);
      if (s) return s;
      const size = type === 'token' ? 40 : (type === 'power' ? 40 : 34);
      s = this.makeSprite(size, size, (g) => {
        const c = size / 2;
        if (type === 'coin') {
          const glow = g.createRadialGradient(c, c, 4, c, c, c);
          glow.addColorStop(0, 'rgba(255,210,0,0.42)');
          glow.addColorStop(1, 'rgba(255,210,0,0)');
          g.fillStyle = glow;
          g.fillRect(0, 0, size, size);
          drawCoinArt(g, c, 9);
        } else if (type === 'token') {
          const glow = g.createRadialGradient(c, c, 8, c, c, c);
          glow.addColorStop(0, 'rgba(56,189,248,0.5)');
          glow.addColorStop(1, 'rgba(56,189,248,0)');
          g.fillStyle = glow;
          g.fillRect(0, 0, size, size);
          g.fillStyle = '#ffffff';
          g.strokeStyle = '#ffd200';
          g.lineWidth = 3;
          g.beginPath();
          g.arc(c, c, 12.5, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        } else {
          const P = POWERS[power] || POWERS[0];
          const glow = g.createRadialGradient(c, c, 6, c, c, c);
          glow.addColorStop(0, P.glow);
          glow.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = glow;
          g.fillRect(0, 0, size, size);
          drawPowerTile(g, power, c, c, 25);
        }
      });
      this.spriteCache.set(key, s);
      return s;
    },

    getHudSprite(kind, power) {
      const key = kind === 'coin' ? 'hud|coin' : `hud|power|${power}`;
      let s = this.spriteCache.get(key);
      if (s) return s;
      s = this.makeSprite(20, 20, (g) => {
        if (kind === 'coin') drawCoinArt(g, 10, 7.5);
        else drawPowerTile(g, power, 10, 10, 18);
      });
      this.spriteCache.set(key, s);
      return s;
    },

    getGlowSprite(color) {
      const key = 'glow|' + color;
      let s = this.spriteCache.get(key);
      if (s) return s;
      s = this.makeSprite(120, 120, (g) => {
        const grad = g.createRadialGradient(60, 60, 10, 60, 60, 60);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 120, 120);
      });
      this.spriteCache.set(key, s);
      return s;
    },

    getFxSprite(kind) {
      const key = 'fx|' + kind;
      let s = this.spriteCache.get(key);
      if (s) return s;
      if (kind === 'shield') {
        s = this.makeSprite(84, 84, (g) => {
          const grad = g.createRadialGradient(42, 42, 22, 42, 42, 40);
          grad.addColorStop(0, 'rgba(251,191,36,0)');
          grad.addColorStop(0.75, 'rgba(251,191,36,0.16)');
          grad.addColorStop(1, 'rgba(251,191,36,0.42)');
          g.fillStyle = grad;
          g.beginPath();
          g.arc(42, 42, 40, 0, TAU);
          g.fill();
          g.strokeStyle = 'rgba(253,224,71,0.95)';
          g.lineWidth = 1.6;
          g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.7)';
          g.lineWidth = 2;
          g.beginPath();
          g.arc(42, 42, 34, Math.PI * 1.1, Math.PI * 1.4);
          g.stroke();
        });
      } else if (kind === 'magnet') {
        s = this.makeSprite(100, 100, (g) => {
          g.strokeStyle = 'rgba(236,72,153,0.5)';
          g.lineWidth = 1.4;
          g.setLineDash([5, 6]);
          g.beginPath();
          g.arc(50, 50, 46, 0, TAU);
          g.stroke();
          g.setLineDash([]);
          const grad = g.createRadialGradient(50, 50, 20, 50, 50, 48);
          grad.addColorStop(0, 'rgba(236,72,153,0)');
          grad.addColorStop(1, 'rgba(236,72,153,0.14)');
          g.fillStyle = grad;
          g.beginPath();
          g.arc(50, 50, 48, 0, TAU);
          g.fill();
        });
      } else if (kind === 'jetpack') {
        s = this.makeSprite(16, 28, (g) => {
          g.lineWidth = 1.3;
          g.strokeStyle = '#1e293b';
          for (let k = 0; k < 2; k++) {
            const x = 1 + k * 7;
            g.beginPath();
            g.roundRect(x, 2, 6.5, 20, 3);
            g.fillStyle = k ? '#ef4444' : '#f87171';
            g.fill();
            g.stroke();
            g.fillStyle = 'rgba(255,255,255,0.5)';
            g.fillRect(x + 1.4, 4, 1.4, 14);
            g.fillStyle = '#475569';
            g.fillRect(x + 1, 22, 4.5, 3);
          }
          g.fillStyle = '#334155';
          g.fillRect(4, 8, 8, 2.2);
        });
      } else if (kind === 'flame') {
        s = this.makeSprite(12, 24, (g) => {
          const grad = g.createLinearGradient(0, 0, 0, 24);
          grad.addColorStop(0, '#fffbeb');
          grad.addColorStop(0.3, '#fde047');
          grad.addColorStop(0.65, '#f97316');
          grad.addColorStop(1, 'rgba(239,68,68,0)');
          g.fillStyle = grad;
          g.beginPath();
          g.moveTo(1.5, 0);
          g.quadraticCurveTo(0, 10, 6, 24);
          g.quadraticCurveTo(12, 10, 10.5, 0);
          g.closePath();
          g.fill();
        });
      }
      this.spriteCache.set(key, s);
      return s;
    },

    // Palette for a day phase; strings only rebuilt when the quantized phase changes.
    updatePalette(phase) {
      const key = Math.round(phase * 300);
      if (key === this.skyGradKey && this.skyGrad) return this.pal;
      let i = 0;
      while (i < PALETTE.length - 2 && phase > PALETTE[i + 1][0]) i++;
      const a = PALETTE[i];
      const b = PALETTE[i + 1];
      const t = clamp((phase - a[0]) / (b[0] - a[0]), 0, 1);
      const pal = this.pal;
      pal.top = mixRgb(a[1], b[1], t);
      pal.bottom = mixRgb(a[2], b[2], t);
      pal.far = mixRgb(a[3], b[3], t);
      pal.near = mixRgb(a[4], b[4], t);
      pal.ground = mixRgb(a[5], b[5], t);
      pal.night = lerp(a[6], b[6], t);
      const g = this.ctx.createLinearGradient(0, 0, 0, GROUND);
      g.addColorStop(0, pal.top);
      g.addColorStop(1, pal.bottom);
      this.skyGrad = g;
      this.skyGradKey = key;
      return pal;
    },

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------
    render(alpha = 1) {
      const ctx = this.ctx;
      if (!ctx || !this.player) return;
      const p = this.player;
      const dist = lerp(this.prevDistance, this.distance, alpha);
      const feet = lerp(p.prevFeet, p.feet, alpha);
      const prof = this.currentProfile;

      ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
      if (this.shake > 0 && !this.reducedMotion) {
        ctx.translate((Math.random() * 2 - 1) * this.shake, (Math.random() * 2 - 1) * this.shake * 0.6);
      }

      // --- Sky ---
      const phase = (DAY_START + dist / DAY_CYCLE) % 1;
      const pal = this.updatePalette(phase);
      ctx.fillStyle = this.skyGrad;
      ctx.fillRect(-12, -12, W + 24, GROUND + 12);

      // Stars (slow, gentle twinkle - never a strobe)
      if (pal.night > 0.02) {
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < this.stars.length; i++) {
          const s = this.stars[i];
          const tw = this.reducedMotion ? 1 : 0.75 + Math.sin(this.time * s.sp + s.ph) * 0.25;
          ctx.globalAlpha = s.a * tw * pal.night;
          const sx = ((s.x - dist * 0.02) % W + W) % W;
          ctx.fillRect(sx, s.y, s.size, s.size);
        }
        ctx.globalAlpha = 1;
      }

      // Sun & moon
      const sunU = (phase - 0.18) / 0.64;
      if (sunU > 0 && sunU < 1) {
        const arc = Math.sin(sunU * Math.PI);
        const x = 60 + sunU * (W - 120);
        const y = GROUND - 40 - arc * 160;
        ctx.globalAlpha = clamp(arc * 1.6, 0, 1);
        const glow = this.getGlowSprite('rgba(255, 200, 90, 0.55)');
        ctx.drawImage(glow.canvas, x - 60, y - 60, 120, 120);
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      const moonU = ((phase + 0.32) % 1) / 0.5;
      if (moonU > 0 && moonU < 1 && pal.night > 0.05) {
        const arc = Math.sin(moonU * Math.PI);
        const x = 80 + moonU * (W - 160);
        const y = GROUND - 60 - arc * 140;
        ctx.globalAlpha = clamp(arc * 1.5, 0, 1) * pal.night;
        const glow = this.getGlowSprite('rgba(200, 220, 255, 0.3)');
        ctx.drawImage(glow.canvas, x - 45, y - 45, 90, 90);
        ctx.fillStyle = '#e8eefc';
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Parallax skylines
      this.drawSkyline(this.farCity, dist * 0.12, pal.far, null, 0);
      this.drawSkyline(this.nearCity, dist * 0.32, pal.near, 'rgba(255, 214, 120, 0.85)', pal.night);

      // --- Ground ---
      ctx.fillStyle = pal.ground;
      ctx.fillRect(-12, GROUND, W + 24, H - GROUND + 12);
      ctx.fillStyle = prof.color;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(-12, GROUND, W + 24, 2);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#ffffff';
      const off = dist % 48;
      for (let x = -off; x < W; x += 48) ctx.fillRect(x, GROUND + 14, 24, 3);
      ctx.globalAlpha = 0.07;
      const off2 = (dist * 1.25) % 90;
      for (let x = -off2; x < W; x += 90) ctx.fillRect(x, GROUND + 34, 50, 2);
      ctx.globalAlpha = 1;

      // Speed lines at high pace
      if (!this.reducedMotion && this.progress > 0.45 && this.state === 'playing') {
        const k = (this.progress - 0.45) / 0.55;
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.05 + 0.08 * k;
        for (let i = 0; i < 6; i++) {
          const ly = 30 + ((i * 53) % (GROUND - 60));
          const lx = W - ((dist * 2.2 + i * 211) % (W + 200));
          ctx.fillRect(lx, ly, 60 + 40 * k, 1.5);
        }
        ctx.globalAlpha = 1;
      }

      // --- Obstacles ---
      for (let i = 0; i < this.obstacles.length; i++) {
        const o = this.obstacles[i];
        const x = o.wx - dist;
        if (x > W + 20 || x + o.w < -30) continue;
        if (o.ghost) ctx.globalAlpha = 0.45;
        // Ground shadow (also an altitude cue for drones)
        ctx.fillStyle = o.def.ground ? 'rgba(0,0,0,0.28)' : (o.type === 'droneLow' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.16)');
        ctx.beginPath();
        ctx.ellipse(x + o.w / 2, GROUND + 3, o.w * (o.def.ground ? 0.55 : 0.4), 4, 0, 0, Math.PI * 2);
        ctx.fill();

        if (!o.def.ground) this.drawRotors(ctx, x, o.y, o.w);
        const spr = this.getObstacleSprite(o);
        ctx.drawImage(spr.canvas, x - spr.pad, o.y - spr.pad, spr.w, spr.h);
        ctx.globalAlpha = 1;
      }

      // --- Items ---
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        const x = it.wx - dist;
        if (x > W + 30 || x < -30) continue;
        const y = it.pulled ? it.y : it.y + Math.sin(this.time * 5 + it.phase) * 4;
        const spr = this.getItemSprite(it.type, it.power);
        if (it.type === 'coin' && !this.reducedMotion) {
          const sxk = 0.35 + Math.abs(Math.cos(this.time * 4 + it.phase)) * 0.65;
          ctx.drawImage(spr.canvas, x - (spr.w * sxk) / 2, y - spr.h / 2, spr.w * sxk, spr.h);
        } else {
          ctx.drawImage(spr.canvas, x - spr.w / 2, y - spr.h / 2, spr.w, spr.h);
        }
        if (it.type === 'token') {
          const st = this.iconState(it.shortcut);
          if (st.img) ctx.drawImage(st.img, x - 8, y - 8, 16, 16);
          else {
            ctx.fillStyle = '#2563eb';
            ctx.font = F_TOKEN;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(((it.shortcut && it.shortcut.name) || 'S').trim().charAt(0).toUpperCase(), x, y + 0.5);
          }
        }
      }

      // --- Trails & back-layer particles ---
      if (this.trailId === 'trail-rainbow' && (this.state === 'playing' || this.state === 'countdown')) {
        this.drawRainbow(ctx, dist);
      }
      this.drawParticles(ctx, 0);

      // --- Player ---
      this.renderPlayer(ctx, feet);

      // --- Front particles ---
      this.drawParticles(ctx, 1);

      // --- Floating texts (outlined for contrast on bright skies) ---
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.75)';
      for (let i = 0; i < this.floatingTexts.length; i++) {
        const ft = this.floatingTexts[i];
        ctx.globalAlpha = clamp(ft.life / 18, 0, 1);
        ctx.font = ft.font;
        ctx.strokeText(ft.text, ft.x, ft.y);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y);
      }
      ctx.globalAlpha = 1;

      // --- HUD (no shake) ---
      ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
      if (this.slowK < 0.985) {
        ctx.fillStyle = '#00c8ff';
        ctx.globalAlpha = ((1 - this.slowK) / 0.4) * 0.07;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      this.renderHud(ctx, prof);

      if (this.flash > 0 && !this.reducedMotion) {
        ctx.globalAlpha = this.flash;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    },

    drawParticles(ctx, layer) {
      const ps = this.particles;
      for (let i = 0; i < this.pN; i++) {
        const pt = ps[i];
        if (pt.layer !== layer) continue;
        const k = clamp(pt.life / pt.max, 0, 1);
        ctx.globalAlpha = k;
        ctx.fillStyle = pt.color;
        if (pt.shape === 1) {
          const s = pt.size;
          ctx.fillRect(pt.x - s, pt.y - s * 0.22, s * 2, s * 0.44);
          ctx.fillRect(pt.x - s * 0.22, pt.y - s, s * 0.44, s * 2);
        } else if (pt.shape === 2) {
          const s = pt.size * (0.35 + 0.65 * k);
          ctx.fillRect(pt.x - s / 2, pt.y - s / 2, s, s);
        } else {
          ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
        }
      }
      ctx.globalAlpha = 1;
    },

    drawRainbow(ctx, dist) {
      const n = this.rbCount;
      if (n < 2) return;
      const band = 2.4;
      const half = (RAINBOW.length * band) / 2;
      let idx = this.rbHead;
      let prevX = PCX - 10;
      for (let s = 1; s < n; s++) {
        idx = (idx - 1 + RB_N) % RB_N;
        const x = PCX - 10 - (dist - this.rbD[idx]);
        if (x < -10) break;
        const w = prevX - x + 0.6;
        if (w > 0.2) {
          const y = this.rbY[idx];
          ctx.globalAlpha = clamp(1 - (PCX - x) / 220, 0, 0.85);
          for (let j = 0; j < RAINBOW.length; j++) {
            ctx.fillStyle = RAINBOW[j];
            ctx.fillRect(x, y - half + j * band, w, band + 0.2);
          }
        }
        prevX = x;
      }
      ctx.globalAlpha = 1;
    },

    drawSkyline(layer, offset, color, winColor, winAlpha) {
      const ctx = this.ctx;
      const o = offset % layer.w;
      ctx.save();
      ctx.translate(-o, 0);
      ctx.fillStyle = color;
      ctx.fill(layer.body);
      if (winColor && winAlpha > 0.05) {
        ctx.globalAlpha = winAlpha * 0.8;
        ctx.fillStyle = winColor;
        ctx.fill(layer.win);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
      }
      if (layer.w - o < W) {
        ctx.translate(layer.w, 0);
        ctx.fill(layer.body);
        if (winColor && winAlpha > 0.05) {
          ctx.globalAlpha = winAlpha * 0.8;
          ctx.fillStyle = winColor;
          ctx.fill(layer.win);
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    },

    drawRotors(ctx, x, y, w) {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      const blade = this.reducedMotion ? 8 : 7 + Math.sin(this.time * 48) * 4;
      ctx.beginPath();
      for (let k = 0; k < 2; k++) {
        const rx = k === 0 ? x + 13 : x + w - 13;
        ctx.moveTo(rx, y);
        ctx.lineTo(rx, y - 4);
        ctx.moveTo(rx - blade, y - 4);
        ctx.lineTo(rx + blade, y - 4);
      }
      ctx.stroke();
    },

    // -------------------------------------------------------------------------
    // Player rendering (pre-rendered frames + cheap transforms)
    // -------------------------------------------------------------------------
    renderPlayer(ctx, feet) {
      const p = this.player;
      const set = this.getFrameSet(this.skinId, this.pixelScale);
      const st = this.state;
      const dead = st === 'dying' || st === 'over' || st === 'revive';
      const jetOn = p.pt[PW_JET] > 0 && !dead;
      const rm = this.reducedMotion;

      let fr;
      let rot = 0;
      if (dead) {
        fr = set.hurt;
        rot = p.spin;
      } else if (st === 'menu') {
        fr = set.idle[0];
      } else if (jetOn) {
        fr = set.fly[rm ? 0 : Math.floor(this.time * 10) % 2];
      } else if (p.ducking) {
        fr = set.duck[rm ? 0 : Math.floor(p.runFrame / 5) % 2];
      } else if (!p.grounded) {
        if (p.flip > 0) {
          fr = set.tuck;
          rot = p.spin;
        } else fr = p.vy < 1.5 ? set.jump : set.fall;
      } else {
        const e = p.happy > 0 ? 1 : (p.danger ? 2 : 0);
        fr = set.run[e][Math.floor(p.runFrame * 0.4074) % 8];
      }

      // Squash & stretch anchored at the feet
      let sxk = 1;
      let syk = 1;
      if (!rm && p.flip <= 0) {
        syk = p.squash;
        sxk = 1 + (1 - p.squash) * 0.8;
      }
      const hover = jetOn && !rm ? Math.sin(this.time * 6) * 1.2 : 0;

      // Ground shadow (shrinks with altitude)
      const alt = clamp((GROUND - feet) / 160, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.globalAlpha = 1 - alt * 0.7;
      ctx.beginPath();
      ctx.ellipse(PCX, GROUND + 2, 15 * (1 - alt * 0.5), 3.2, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Magnet field
      if (p.pt[PW_MAGNET] > 0 && !dead) {
        const m = this.getFxSprite('magnet');
        const pulse = rm ? 1 : 1 + Math.sin(this.time * 5) * 0.04;
        const r = 50 * pulse;
        ctx.globalAlpha = p.pt[PW_MAGNET] < 90 && !rm && Math.floor(this.time * 8) % 2 ? 0.4 : 0.9;
        ctx.drawImage(m.canvas, PCX - r, feet - p.h / 2 - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
      }

      // Invulnerability blink (revive / safe landing)
      let alpha = 1;
      if (!dead && (p.invuln > 0 || p.safeFall)) {
        alpha = rm ? 0.7 : (Math.floor(this.time * 14) % 2 ? 0.45 : 0.95);
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(PCX, feet + hover);
      if (sxk !== 1 || syk !== 1) ctx.scale(sxk, syk);
      if (jetOn) {
        // jetpack strapped to the back, leaning with the fly pose
        ctx.save();
        ctx.translate(0, -26);
        ctx.rotate(0.22);
        ctx.translate(0, 26);
        const flame = this.getFxSprite('flame');
        const len = rm ? 16 : 13 + Math.random() * 8;
        ctx.drawImage(flame.canvas, -25, -21, 12, len);
        const jp = this.getFxSprite('jetpack');
        ctx.drawImage(jp.canvas, -27, -46, 16, 28);
        ctx.restore();
      }
      if (rot) {
        ctx.translate(0, -26);
        ctx.rotate(rot);
        ctx.translate(0, 26);
      }
      ctx.drawImage(fr.canvas, -OX, -OY, FW, FH);
      // Bolt Bot antenna light
      if (fr.ax !== null && (rm || dead || Math.sin(this.time * 5) > 0.2)) {
        const glow = this.getGlowSprite('rgba(248,113,113,0.85)');
        ctx.drawImage(glow.canvas, fr.ax - 7, fr.ay - 7, 14, 14);
        ctx.fillStyle = '#fecaca';
        ctx.fillRect(fr.ax - 1, fr.ay - 1, 2, 2);
      }
      ctx.restore();

      // Shield bubble
      if (p.pt[PW_SHIELD] > 0 && !dead) {
        const blink = p.pt[PW_SHIELD] < 70 && !rm && Math.floor(this.time * 10) % 2 === 0;
        if (!blink) {
          const b = this.getFxSprite('shield');
          const bw = p.ducking ? 66 : 64;
          const bh = p.ducking ? 44 : 70;
          ctx.globalAlpha = 0.95;
          ctx.drawImage(b.canvas, PCX - bw / 2, feet + hover - p.h / 2 - bh / 2 - 2, bw, bh);
          ctx.globalAlpha = 1;
        }
      }
    },

    // -------------------------------------------------------------------------
    // HUD
    // -------------------------------------------------------------------------
    hudPanel(ctx, x, y, w, h, border) {
      ctx.fillStyle = 'rgba(2, 6, 23, 0.62)';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 7);
      ctx.fill();
      if (border) {
        ctx.strokeStyle = border;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },

    renderHud(ctx, prof) {
      const p = this.player;
      const hud = this.hud;
      const st = this.state;
      ctx.textBaseline = 'middle';
      const inRun = st !== 'menu' && st !== 'closed';

      // Top-left: run coins, then active power-up timers
      let bx = 12;
      if (inRun && wallet()) {
        if (hud.coinVal !== this.runCoins) {
          hud.coinVal = this.runCoins;
          hud.coinStr = String(this.runCoins);
          ctx.font = F_HUD;
          hud.coinW = ctx.measureText(hud.coinStr).width;
        }
        const dbl = p.pt[PW_DOUBLE] > 0;
        const w = 34 + hud.coinW + (dbl ? 22 : 0);
        this.hudPanel(ctx, bx, 10, w, 24, dbl ? 'rgba(34,197,94,0.7)' : null);
        const pop = this.reducedMotion ? 1 : 1 + this.coinPop * 0.25;
        const cs = this.getHudSprite('coin');
        ctx.drawImage(cs.canvas, bx + 12 - 9 * pop, 22 - 9 * pop, 18 * pop, 18 * pop);
        ctx.font = F_HUD;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffe58a';
        ctx.fillText(hud.coinStr, bx + 25, 22.5);
        if (dbl) {
          ctx.font = F_HUD_SM;
          ctx.fillStyle = '#4ade80';
          ctx.fillText('×2', bx + 29 + hud.coinW, 22.5);
        }
        bx += w + 6;
      }
      if (inRun) {
        for (let i = 0; i < POWER_COUNT; i++) {
          const t = p.pt[i];
          if (!(t > 0)) continue;
          const P = POWERS[i];
          const tenths = Math.ceil(t / 6);
          if (tenths !== hud.pTenths[i]) {
            hud.pTenths[i] = tenths;
            hud.pStr[i] = (tenths / 10).toFixed(1) + 's';
          }
          const w = 70;
          const warn = t < 90 && !this.reducedMotion && Math.floor(this.time * 6) % 2 === 0;
          ctx.globalAlpha = warn ? 0.6 : 1;
          this.hudPanel(ctx, bx, 10, w, 24, P.color);
          const ic = this.getHudSprite('power', i);
          ctx.drawImage(ic.canvas, bx + 3, 12, 20, 20);
          ctx.font = F_PILL;
          ctx.textAlign = 'left';
          ctx.fillStyle = '#ffffff';
          ctx.fillText(hud.pStr[i], bx + 27, 20);
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(bx + 27, 27, w - 33, 3);
          ctx.fillStyle = P.color;
          ctx.fillRect(bx + 27, 27, (w - 33) * clamp(t / (p.pmax[i] || t), 0, 1), 3);
          ctx.globalAlpha = 1;
          bx += w + 6;
        }
      }

      // Level + combo (top-right)
      if (inRun) {
        let rx = W - 12;
        ctx.font = F_PILL;
        if (hud.lvVal !== this.level) {
          hud.lvVal = this.level;
          hud.lvStr = `LV ${this.level}`;
          hud.lvW = ctx.measureText(hud.lvStr).width + 18;
        }
        rx -= hud.lvW;
        this.hudPanel(ctx, rx, 10, hud.lvW, 24, null);
        ctx.fillStyle = prof.color;
        ctx.textAlign = 'center';
        ctx.fillText(hud.lvStr, rx + hud.lvW / 2, 22.5);
        rx -= 6;
        if (this.combo > 0) {
          if (hud.comboVal !== this.combo) {
            hud.comboVal = this.combo;
            hud.comboStr = `COMBO ${this.combo}  ×${this.multiplier}`;
            hud.comboW = ctx.measureText(hud.comboStr).width + 18;
          }
          rx -= hud.comboW;
          this.hudPanel(ctx, rx, 10, hud.comboW, 24, null);
          ctx.fillStyle = '#fbbf24';
          ctx.fillText(hud.comboStr, rx + hud.comboW / 2, 20.5);
          ctx.fillRect(rx + 6, 29, (hud.comboW - 12) * clamp(this.comboTimer / COMBO_WINDOW, 0, 1), 2);
        }
      }

      // Toast (center)
      if (this.toast) {
        const t = this.toast;
        const k = t.life / t.max;
        const fadeIn = clamp((1 - k) * 6, 0, 1);
        const a = clamp(Math.min(fadeIn, t.life / 20), 0, 1);
        const pop = this.reducedMotion ? 1 : 1 + (1 - fadeIn) * 0.25;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(W / 2, 92);
        ctx.scale(pop, pop);
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        ctx.font = F_TOAST;
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(2, 6, 23, 0.8)';
        ctx.strokeText(t.text, 0, 0);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, 0, 0);
        if (t.sub) {
          ctx.font = F_TOAST_SUB;
          ctx.lineWidth = 3;
          ctx.strokeText(t.sub, 0, 22);
          ctx.fillStyle = '#e2e8f0';
          ctx.fillText(t.sub, 0, 22);
        }
        ctx.restore();
      }

      // Tutorial / hint pill (top center)
      if (this.hint && (st === 'playing' || st === 'countdown')) {
        this.drawHint(ctx, this.hint, this.hint.life === Infinity ? 1 : clamp(this.hint.life / 30, 0, 1));
      }

      // Countdown
      if (st === 'countdown') {
        const n = Math.max(1, Math.ceil(this.countdown / 24));
        const frac = (this.countdown % 24) / 24;
        ctx.save();
        ctx.translate(W / 2, H / 2 - 20);
        const s = this.reducedMotion ? 1 : 0.8 + frac * 0.5;
        ctx.scale(s, s);
        ctx.globalAlpha = 0.4 + frac * 0.6;
        ctx.font = F_COUNT;
        ctx.textAlign = 'center';
        ctx.lineWidth = 6;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(2, 6, 23, 0.8)';
        ctx.strokeText(COUNT_STR[clamp(n, 0, 5)], 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(COUNT_STR[clamp(n, 0, 5)], 0, 0);
        ctx.restore();
      }
    },

    drawHint(ctx, hint, alpha) {
      const parts = hint.parts;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (!hint.widths) {
        // measured once per hint
        hint.widths = parts.map(pt => {
          ctx.font = pt.k ? F_HINT_KEY : F_HINT;
          return pt.k ? ctx.measureText(pt.k).width + 12 : ctx.measureText(pt.t).width;
        });
        hint.total = hint.widths.reduce((a, b) => a + b, 0);
      }
      const padX = 14;
      const bw = hint.total + padX * 2;
      const bx = (W - bw) / 2;
      const by = 46;
      ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, 28, 14);
      ctx.fill();
      ctx.stroke();
      let x = bx + padX;
      for (let i = 0; i < parts.length; i++) {
        const pt = parts[i];
        const w = hint.widths[i];
        if (pt.k) {
          ctx.fillStyle = 'rgba(255,255,255,0.14)';
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.beginPath();
          ctx.roundRect(x, by + 6, w, 16, 4);
          ctx.fill();
          ctx.stroke();
          ctx.font = F_HINT_KEY;
          ctx.fillStyle = '#7dd3fc';
          ctx.textAlign = 'center';
          ctx.fillText(pt.k, x + w / 2, by + 14.5);
          ctx.textAlign = 'left';
        } else {
          ctx.font = F_HINT;
          ctx.fillStyle = '#f1f5f9';
          ctx.fillText(pt.t, x, by + 14.5);
        }
        x += w;
      }
      ctx.restore();
    },

    // -------------------------------------------------------------------------
    // Shop preview (public): works before init()/open()
    // -------------------------------------------------------------------------
    renderSkinPreview(canvas, skinId, trailId, opts) {
      if (!game.isInitialized) {
        try { game.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }
      }
      if (!canvas || typeof canvas.getContext !== 'function') return false;
      const g = canvas.getContext('2d');
      if (!g) return false;
      const box = fitCanvas(canvas);
      const id = SKINS[skinId] ? skinId : DEFAULT_SKIN;
      const trail = TRAIL_IDS.indexOf(trailId) !== -1 ? trailId : 'trail-none';
      const t = opts && typeof opts.time === 'number' ? opts.time : 0.4;
      let still = !(opts && typeof opts.time === 'number');
      if (game.reducedMotion) still = true;
      g.setTransform(box.k, 0, 0, box.k, 0, 0);
      g.clearRect(0, 0, box.w, box.h);
      paintPreview(g, box.w, box.h, id, trail, t, null, still);
      return true;
    }
  };

  // Static catalog info for other modules (names match ArcadeWallet's catalog)
  game.SKIN_IDS = SKIN_IDS.slice();
  game.TRAIL_IDS = TRAIL_IDS.slice();

  return game;
})();

window.ShortcutRunner = ShortcutRunner;
