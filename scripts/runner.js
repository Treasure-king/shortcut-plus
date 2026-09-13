/* runner.js - "Shortcut Runner" Offline Endless Arcade Game Engine (V2 - Balanced & Polished) */

const ShortcutRunner = {
  // DOM Elements
  modal: null,
  canvas: null,
  ctx: null,
  scoreBadge: null,
  highScoreBadge: null,
  modeBadge: null,
  skinBtn: null,
  muteBtn: null,
  fullscreenBtn: null,
  closeBtn: null,
  restartHeaderBtn: null,
  pauseOverlay: null,
  gameOverOverlay: null,
  difficultyOverlay: null,
  modeNormalBtn: null,
  modeNightmareBtn: null,
  changeModeBtn: null,
  finalScoreEl: null,
  bestScoreEl: null,
  restartBtn: null,

  // Audio Context & Settings
  audioCtx: null,
  isMuted: false,
  isFullscreen: false,

  get isOpen() {
    return !!(this.modal && this.modal.classList.contains('active'));
  },

  // Mascot Skins & Customization (Eye-Friendly, Clean Modern Palette)
  skins: [
    {
      id: 'classic',
      name: 'Astro Cobalt',
      primary: '#38bdf8',       // Gentle sky blue
      secondary: '#2563eb',     // Royal blue
      accent: '#f59e0b',        // Warm amber core
      bodyDark: '#0f172a',      // Matte slate
      bodyPlate: '#1e293b'      // Soft plate
    },
    {
      id: 'mint',
      name: 'Mint Explorer',
      primary: '#34d399',       // Soft soothing mint
      secondary: '#059669',     // Emerald
      accent: '#fbbf24',        // Soft gold core
      bodyDark: '#0f172a',
      bodyPlate: '#1e293b'
    },
    {
      id: 'stealth',
      name: 'Silver Shadow',
      primary: '#94a3b8',       // Platinum silver
      secondary: '#475569',     // Slate steel
      accent: '#f43f5e',        // Soft rose red core
      bodyDark: '#0a0a0e',
      bodyPlate: '#1e1e26'
    }
  ],
  currentSkinIndex: 0,

  // Game Loop State
  animFrameId: null,
  lastFrameTime: 0,
  isInitialized: false,
  isRunning: false,
  isPaused: false,
  isGameOver: false,

  // Difficulty Mode Configuration ('normal' | 'nightmare')
  difficulty: 'nightmare', // Defaults to scary mode as requested
  isSelectingDifficulty: false,
  difficultyProfiles: {
    normal: {
      name: 'Normal',
      badge: '🛡️ NORMAL',
      baseSpeed: 3.0,
      maxSpeed: 12.0,
      speedStep: 0.6,
      initialRunway: 380,
      clearance: { double: 40, drone: 24, single: 30 },
      reactionRunwayFramesStart: 28,
      reactionRunwayFramesEnd: 18,
      baseGapFloorStart: 260,
      baseGapFloorEnd: 210,
      maxBufferMult: 8,
      color: '#38bdf8'
    },
    nightmare: {
      name: 'Nightmare',
      badge: '💀 NIGHTMARE',
      baseSpeed: 3.4,
      maxSpeed: 20.0,
      speedStep: 1.5,
      initialRunway: 300,
      clearance: { double: 36, drone: 20, single: 26 },
      reactionRunwayFramesStart: 26,
      reactionRunwayFramesEnd: 9,
      baseGapFloorStart: 231,
      baseGapFloorEnd: 160,
      maxBufferMult: 9,
      color: '#ff3366'
    }
  },

  get currentProfile() {
    return this.difficultyProfiles[this.difficulty] || this.difficultyProfiles.nightmare;
  },

  // Game Metrics (Balanced Speed & Progressive Curve)
  score: 0,
  highScore: 0,
  distance: 0,
  speed: 3.4,           // Starting pace (calibrated per active difficulty profile)
  baseSpeed: 3.4,
  maxSpeed: 20.0,       // Elevated ceiling for thrilling high-score mastery (capped at 20)
  lastMilestone: 0,
  lastObstacleType: 'none',

  // Shortcuts & Favicon Cache
  userShortcuts: [],
  faviconCache: new Map(),

  // World & Physics
  width: 760,
  height: 320,
  groundY: 265,
  gravity: 0.54,

  // Player Model (Expressive Mascot Bot)
  player: {
    x: 75,
    y: 213,
    w: 38,
    h: 52,
    baseH: 52,
    duckHeight: 26,
    vy: 0,
    isGrounded: true,
    jumpCount: 0,
    maxJumps: 2,
    jumpStrength: -10.5,
    doubleJumpStrength: -8.8,
    isDucking: false,
    runFrame: 0,
    blinkTimer: 0,
    happyTimer: 0,      // Excited/happy expression (^ ^) when grabbing items or milestones
    dangerAlert: false, // Startled expression (o o) when obstacle is imminent (<110px)
    squashStretch: 1,   // Vertical deformation
    invincibleTimer: 0,
    slowMoTimer: 0,
    trail: []
  },

  // Obstacles, Items, Particles, Floating Texts
  obstacles: [],
  items: [],
  particles: [],
  floatingTexts: [],
  nextObstacleDistance: 300, // Balanced starting runway at 0m (~300px / 1.5s)

  // Track & Skyline Parallax
  trackOffset: 0,
  skylineStars: [],

  init() {
    if (this.isInitialized) return;
    this.modal = document.getElementById('game-arcade-modal');
    this.canvas = document.getElementById('runner-canvas');
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    if (this.ctx) {
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
    }
    this.isInitialized = true;
    this.scoreBadge = document.getElementById('runner-current-score');
    this.highScoreBadge = document.getElementById('runner-high-score');
    this.modeBadge = document.getElementById('runner-mode-badge');
    this.skinBtn = document.getElementById('runner-skin-btn');
    this.muteBtn = document.getElementById('runner-mute-btn');
    this.fullscreenBtn = document.getElementById('runner-fullscreen-btn');
    this.closeBtn = document.getElementById('runner-close-btn');
    this.restartHeaderBtn = document.getElementById('runner-restart-btn-header');
    this.pauseOverlay = document.getElementById('runner-pause-overlay');
    this.gameOverOverlay = document.getElementById('runner-game-over-overlay');
    this.difficultyOverlay = document.getElementById('runner-difficulty-overlay');
    this.modeNormalBtn = document.getElementById('runner-mode-normal-btn');
    this.modeNightmareBtn = document.getElementById('runner-mode-nightmare-btn');
    this.changeModeBtn = document.getElementById('runner-change-mode-btn');
    this.finalScoreEl = document.getElementById('runner-final-score');
    this.bestScoreEl = document.getElementById('runner-best-score');
    this.restartBtn = document.getElementById('runner-restart-btn');

    // Load saved difficulty preference
    try {
      const savedDiff = localStorage.getItem('shortcut_runner_difficulty');
      if (savedDiff && this.difficultyProfiles[savedDiff]) {
        this.difficulty = savedDiff;
      }
    } catch (e) { }
    this.updateDifficultyVisuals();

    // Load sound preference
    try {
      this.isMuted = localStorage.getItem('shortcut_plus_game_muted') === 'true';
      this.updateMuteIcon();
    } catch (e) { }

    // Load saved mascot skin preference
    try {
      const savedSkin = localStorage.getItem('shortcut_plus_runner_skin');
      if (savedSkin !== null) {
        const idx = parseInt(savedSkin, 10);
        if (!isNaN(idx) && idx >= 0 && idx < this.skins.length) {
          this.currentSkinIndex = idx;
        }
      }
      if (this.skinBtn) {
        this.skinBtn.title = `Skin: ${this.skins[this.currentSkinIndex].name} (C)`;
      }
    } catch (e) { }

    this.generateSkyStars();
    this.bindEvents();
  },

  generateSkyStars() {
    this.skylineStars = [];
    for (let i = 0; i < 48; i++) {
      this.skylineStars.push({
        x: Math.random() * this.width,
        y: Math.random() * (this.groundY - 75),
        size: Math.random() * 2 + 0.8,
        alpha: Math.random() * 0.7 + 0.3,
        twinkleSpeed: Math.random() * 0.05 + 0.02
      });
    }
  },

  bindEvents() {
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }

    if (this.skinBtn) {
      this.skinBtn.addEventListener('click', () => this.toggleSkin());
    }

    if (this.muteBtn) {
      this.muteBtn.addEventListener('click', () => this.toggleMute());
    }

    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    }

    if (this.restartBtn) {
      this.restartBtn.addEventListener('click', () => this.restart());
    }

    if (this.restartHeaderBtn) {
      this.restartHeaderBtn.addEventListener('click', () => this.promptDifficulty());
    }

    if (this.modeBadge) {
      this.modeBadge.addEventListener('click', () => this.promptDifficulty());
    }

    if (this.modeNormalBtn) {
      this.modeNormalBtn.addEventListener('click', () => this.selectDifficultyAndStart('normal'));
    }

    if (this.modeNightmareBtn) {
      this.modeNightmareBtn.addEventListener('click', () => this.selectDifficultyAndStart('nightmare'));
    }

    if (this.changeModeBtn) {
      this.changeModeBtn.addEventListener('click', () => this.promptDifficulty());
    }

    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.close();
      });
    }

    // Keyboard Controller
    window.addEventListener('keydown', (e) => {
      if (!this.modal || !this.modal.classList.contains('active')) return;

      // When difficulty selection overlay is active
      if (this.isSelectingDifficulty) {
        if (e.code === 'Digit1' || e.code === 'Numpad1' || e.code === 'KeyN') {
          e.preventDefault();
          this.initAudio();
          this.selectDifficultyAndStart('normal');
          return;
        }
        if (e.code === 'Digit2' || e.code === 'Numpad2' || e.code === 'KeyD' || e.code === 'KeyM') {
          e.preventDefault();
          this.initAudio();
          this.selectDifficultyAndStart('nightmare');
          return;
        }
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          this.initAudio();
          this.selectDifficultyAndStart(this.difficulty || 'nightmare');
          return;
        }
        if (e.code === 'Escape') {
          e.preventDefault();
          this.close();
          return;
        }
        return;
      }

      // Quick R button / key to trigger difficulty prompt & restart
      if (e.code === 'KeyR') {
        e.preventDefault();
        this.promptDifficulty();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = Array.from(this.modal.querySelectorAll('button:not([disabled])')).filter(b => b.offsetParent !== null);
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      } else if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        if (e.repeat) return; // Prevent OS key-repeat from eating double-jump
        this.initAudio();
        if (this.isGameOver) {
          this.restart();
        } else if (!this.isPaused) {
          this.handleJump();
        }
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.handleDuck(true);
      } else if (e.code === 'KeyC') {
        e.preventDefault();
        if (e.repeat) return;
        this.toggleSkin();
      } else if (e.code === 'KeyP') {
        e.preventDefault();
        if (e.repeat) return;
        this.togglePause();
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        if (e.repeat) return;
        this.toggleFullscreen();
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        if (e.repeat) return;
        this.toggleMute();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        if (this.isFullscreen) {
          this.toggleFullscreen();
        } else {
          this.close();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowDown') {
        this.handleDuck(false);
      }
    });

    // Touch / Pointer Tap
    if (this.canvas) {
      this.canvas.addEventListener('pointerdown', (e) => {
        if (this.isSelectingDifficulty) return;
        e.preventDefault();
        this.initAudio();
        if (this.isGameOver) {
          this.restart();
        } else if (!this.isPaused) {
          this.handleJump();
        }
      });
    }

    // Auto-Pause when switching tabs or unfocusing window
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.isRunning && !this.isPaused && !this.isGameOver) {
        this.togglePause();
      }
    });

    window.addEventListener('blur', () => {
      if (this.isRunning && !this.isPaused && !this.isGameOver) {
        this.togglePause();
      }
    });
  },

  toggleSkin() {
    this.currentSkinIndex = (this.currentSkinIndex + 1) % this.skins.length;
    const skin = this.skins[this.currentSkinIndex];
    try {
      localStorage.setItem('shortcut_plus_runner_skin', String(this.currentSkinIndex));
    } catch (e) { }

    this.playSfx('coin');
    this.createFloatingText(this.player.x + 35, this.player.y - 18, skin.name, skin.primary);
    if (this.skinBtn) {
      this.skinBtn.title = `Skin: ${skin.name} (C)`;
    }
  },

  initAudio() {
    if (this.audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    } catch (e) {
      console.warn('[Runner] Web Audio not supported:', e);
    }
  },

  playSfx(type) {
    if (this.isMuted || !this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (e) { }
      };

      if (type === 'jump') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(520, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'doubleJump') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(840, now + 0.14);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.start(now);
        osc.stop(now + 0.14);
      } else if (type === 'coin') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.setValueAtTime(880, now + 0.06);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'powerup') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(329.63, now);
        osc.frequency.exponentialRampToValueAtTime(987.77, now + 0.25);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'milestone') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(659.25, now);
        osc.frequency.setValueAtTime(1046.50, now + 0.08);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'smash') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(70, now + 0.18);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'hit') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.28);
        gain.gain.setValueAtTime(0.28, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now);
        osc.stop(now + 0.28);
      }
    } catch (err) {
      console.warn('[Runner] Audio play error:', err);
    }
  },

  toggleMute() {
    this.isMuted = !this.isMuted;
    try {
      localStorage.setItem('shortcut_plus_game_muted', String(this.isMuted));
    } catch (e) { }
    this.updateMuteIcon();
  },

  updateMuteIcon() {
    if (!this.muteBtn) return;
    const iconMuted = this.muteBtn.querySelector('.icon-muted');
    const iconSound = this.muteBtn.querySelector('.icon-sound');
    if (iconMuted && iconSound) {
      iconMuted.style.display = this.isMuted ? 'inline' : 'none';
      iconSound.style.display = this.isMuted ? 'none' : 'inline';
    }
    this.muteBtn.title = this.isMuted ? 'Unmute Game (M)' : 'Mute Game (M)';
  },

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    if (this.modal) {
      this.modal.classList.toggle('fullscreen', this.isFullscreen);
    }

    if (this.fullscreenBtn) {
      const expand = this.fullscreenBtn.querySelector('.icon-expand');
      const compress = this.fullscreenBtn.querySelector('.icon-compress');
      if (expand && compress) {
        expand.style.display = this.isFullscreen ? 'none' : 'inline';
        compress.style.display = this.isFullscreen ? 'inline' : 'none';
      }
      this.fullscreenBtn.title = this.isFullscreen ? 'Exit Fullscreen (F)' : 'Toggle Fullscreen (F)';
    }

    try {
      if (this.isFullscreen) {
        if (this.modal.requestFullscreen) {
          this.modal.requestFullscreen().catch(() => { });
        } else if (this.modal.webkitRequestFullscreen) {
          this.modal.webkitRequestFullscreen();
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => { });
        }
      }
    } catch (e) { }
  },

  async open() {
    if (!this.modal) this.init();
    if (!this.modal) return;

    this.modal.classList.add('active');

    if (typeof ShortcutStorage !== 'undefined') {
      this.highScore = await ShortcutStorage.getGameHighScore();
      const shortcuts = await ShortcutStorage.getShortcuts();
      this.cacheShortcuts(shortcuts);
    }

    if (this.highScoreBadge) {
      this.highScoreBadge.textContent = String(this.highScore).padStart(5, '0');
    }

    // Ask the user for difficulty mode upon starting the game
    this.promptDifficulty();
  },

  promptDifficulty() {
    if (!this.modal) return;
    this.isSelectingDifficulty = true;

    // Pause game loop if running
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.isRunning = false;

    if (this.gameOverOverlay) this.gameOverOverlay.style.display = 'none';
    if (this.pauseOverlay) this.pauseOverlay.style.display = 'none';

    if (this.difficultyOverlay) {
      this.difficultyOverlay.style.display = 'flex';
      const targetBtn = (this.difficulty === 'normal') ? this.modeNormalBtn : this.modeNightmareBtn;
      if (targetBtn) {
        setTimeout(() => targetBtn.focus(), 60);
      }
    }
  },

  selectDifficultyAndStart(mode) {
    if (!this.difficultyProfiles[mode]) mode = 'nightmare';
    this.difficulty = mode;
    this.isSelectingDifficulty = false;

    try {
      localStorage.setItem('shortcut_runner_difficulty', mode);
    } catch (e) { }

    if (this.difficultyOverlay) {
      this.difficultyOverlay.style.display = 'none';
    }

    this.updateDifficultyVisuals();
    this.playSfx(mode === 'nightmare' ? 'hit' : 'jump');

    this.restart();
  },

  updateDifficultyVisuals() {
    const profile = this.currentProfile;
    if (this.modeBadge) {
      this.modeBadge.textContent = profile.badge;
      this.modeBadge.className = `arcade-mode-badge ${this.difficulty}`;
    }
    if (this.modal) {
      this.modal.classList.toggle('mode-nightmare', this.difficulty === 'nightmare');
      this.modal.classList.toggle('mode-normal', this.difficulty === 'normal');
    }
  },

  close() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.lastFrameTime = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.isGameOver = false;
    this.isSelectingDifficulty = false;
    if (this.difficultyOverlay) {
      this.difficultyOverlay.style.display = 'none';
    }
    if (this.isFullscreen) {
      this.toggleFullscreen();
    }
    if (this.modal) {
      this.modal.classList.remove('active');
    }
  },

  togglePause() {
    if (this.isGameOver || !this.isRunning) return;
    this.isPaused = !this.isPaused;
    if (this.pauseOverlay) {
      this.pauseOverlay.style.display = this.isPaused ? 'flex' : 'none';
    }
    if (this.isPaused) {
      if (this.animFrameId) {
        cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
    } else {
      this.lastFrameTime = performance.now();
      if (!this.animFrameId) {
        this.animFrameId = requestAnimationFrame((t) => this.loop(t));
      }
    }
  },

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

    this.userShortcuts = (shortcuts && shortcuts.length >= 3) ? shortcuts : [...shortcuts, ...fallbacks];

    this.userShortcuts.forEach(s => {
      if (!this.faviconCache.has(s.url)) {
        const img = new Image();
        let faviconUrl = '';
        if (typeof FaviconResolver !== 'undefined') {
          faviconUrl = FaviconResolver.getFaviconUrl(s.url);
        } else {
          try {
            const domain = new URL(s.url).hostname;
            faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
          } catch (e) {
            faviconUrl = '';
          }
        }
        if (faviconUrl) {
          img.src = faviconUrl;
          this.faviconCache.set(s.url, img);
        }
      }
    });
  },

  restart(mode = null) {
    if (mode && this.difficultyProfiles[mode]) {
      this.difficulty = mode;
    }
    this.updateDifficultyVisuals();

    const profile = this.currentProfile;
    this.baseSpeed = profile.baseSpeed;
    this.maxSpeed = profile.maxSpeed;
    this.speed = profile.baseSpeed;

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    this.score = 0;
    this.distance = 0;
    this.lastMilestone = 0;
    this.lastObstacleType = 'none';
    this.isGameOver = false;
    this.isPaused = false;
    this.isSelectingDifficulty = false;
    this.isRunning = true;
    this.lastFrameTime = performance.now();

    if (this.difficultyOverlay) this.difficultyOverlay.style.display = 'none';
    if (this.gameOverOverlay) this.gameOverOverlay.style.display = 'none';
    if (this.pauseOverlay) this.pauseOverlay.style.display = 'none';

    // Reset player
    this.player.h = this.player.baseH;
    this.player.y = this.groundY - this.player.h;
    this.player.vy = 0;
    this.player.isGrounded = true;
    this.player.jumpCount = 0;
    this.player.isDucking = false;
    this.player.runFrame = 0;
    this.player.squashStretch = 1;
    this.player.invincibleTimer = 0;
    this.player.slowMoTimer = 0;
    this.player.trail = [];

    // Clear world arrays
    this.obstacles = [];
    this.items = [];
    this.particles = [];
    this.floatingTexts = [];
    this.nextObstacleDistance = profile.initialRunway; // 300px for Nightmare, 380px for Normal

    if (this.scoreBadge) this.scoreBadge.textContent = '00000';

    if (!this.animFrameId) {
      this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }
  },

  handleJump() {
    this.player.isDucking = false;
    if (this.player.jumpCount < this.player.maxJumps) {
      if (this.player.jumpCount === 0) {
        this.player.vy = this.player.jumpStrength;
        this.player.squashStretch = 1.25; // Vertical stretch
        this.playSfx('jump');
        this.createThrusterParticles(this.player.x + 8, this.player.y + this.player.h - 10, '#00f2fe');
      } else {
        // Double Jump
        this.player.vy = this.player.doubleJumpStrength;
        this.player.squashStretch = 1.35;
        this.playSfx('doubleJump');
        this.createDoubleJumpRing(this.player.x + this.player.w / 2, this.player.y + this.player.h);
        this.createThrusterParticles(this.player.x + 8, this.player.y + this.player.h - 10, '#38ef7d');
      }
      this.player.jumpCount++;
      this.player.isGrounded = false;
    }
  },

  handleDuck(ducking) {
    this.player.isDucking = ducking;
    if (ducking) {
      if (!this.player.isGrounded) {
        // Fast snap drop downward
        this.player.vy += 5;
      } else {
        // Create slide sparks on ground
        this.createSlideSparks(this.player.x + 20, this.groundY);
      }
    }
  },

  createThrusterParticles(x, y, color) {
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x: x + Math.random() * 6 - 3,
        y,
        vx: -(Math.random() * 2 + 1),
        vy: Math.random() * 3 + 2, // blast downward
        size: Math.random() * 3.5 + 2,
        color: [color, '#ffffff', '#ffd200'][Math.floor(Math.random() * 3)],
        alpha: 1,
        life: 14
      });
    }
  },

  createSlideSparks(x, y) {
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x: x + Math.random() * 10,
        y: y - 2,
        vx: -(Math.random() * 5 + 3),
        vy: -(Math.random() * 2),
        size: Math.random() * 2.5 + 1.5,
        color: ['#ffd200', '#ff007f', '#ffffff'][Math.floor(Math.random() * 3)],
        alpha: 1,
        life: 12
      });
    }
  },

  createFootstepDust(x, y) {
    for (let i = 0; i < 2; i++) {
      this.particles.push({
        x: x + (Math.random() * 6 - 3),
        y: y - 1,
        vx: -(Math.random() * 2.2 + 0.8),
        vy: -(Math.random() * 1.2 + 0.2),
        size: Math.random() * 2.5 + 1.2,
        color: ['rgba(255,255,255,0.45)', 'rgba(148,163,184,0.35)', 'rgba(0,242,254,0.35)'][Math.floor(Math.random() * 3)],
        alpha: 0.8,
        life: 14
      });
    }
  },

  createDoubleJumpRing(x, y) {
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 * i) / 12;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * 3.5,
        vy: Math.sin(angle) * 1.5 + 0.5,
        size: 3,
        color: '#38ef7d',
        alpha: 1,
        life: 16
      });
    }
  },

  createSmashParticles(x, y) {
    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 6 + 2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 4 + 2,
        color: ['#ff007f', '#00f2fe', '#ffd200', '#ffffff'][Math.floor(Math.random() * 4)],
        alpha: 1,
        life: 25
      });
    }
  },

  createFloatingText(x, y, text, color = '#ffd200') {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      alpha: 1,
      vy: -1.2,
      life: 30
    });
  },

  spawnObstacle() {
    if (!this.userShortcuts || this.userShortcuts.length === 0) {
      this.cacheShortcuts([]);
    }
    if (!this.userShortcuts || this.userShortcuts.length === 0) {
      this.nextObstacleDistance = (this.currentProfile ? this.currentProfile.initialRunway : 300);
      return;
    }

    const shortcut = this.userShortcuts[Math.floor(Math.random() * this.userShortcuts.length)];
    const roll = Math.random();

    let type = 'single';
    let w = 54;
    let h = 48;
    let y = this.groundY - h;
    let altitude = 'ground';

    // Guaranteed Human Avoidability Rules:
    // 1. Double stacks appear after score 200, and NEVER right after another double stack
    // 2. Drones appear after score 160, featuring 4 VARIED ALTITUDES (low/must-slide, mid-low/duck, mid/run-under, high/aerial hazard)
    if (this.lastObstacleType !== 'double' && roll > 0.74 && this.score > 200) {
      type = 'double';
      w = 54;
      h = 84;
      y = this.groundY - h;
    } else if (this.lastObstacleType !== 'double' && roll > 0.48 && this.score > 160) {
      type = 'drone';
      w = 64;
      h = 36;

      // Varied flight heights requested by user:
      // 1. 'low': clearance 32-35px -> MUST SLIDE/DUCK (standing player at 52px hits it; ducking at 26px clears!)
      // 2. 'mid_low': clearance 43-47px -> Ducking slides under; standing crashes; aerial leap over!
      // 3. 'mid': clearance 62-72px -> Runs under standing safely, but careless jumps crash into it!
      // 4. 'high': clearance 94-110px -> Ceiling hazard that threatens high double-jumps!
      const altRoll = Math.random();
      let clearance = 33;
      if (altRoll < 0.40) {
        altitude = 'low';
        clearance = 32 + Math.floor(Math.random() * 4); // 32 - 35px
      } else if (altRoll < 0.65) {
        altitude = 'mid_low';
        clearance = 43 + Math.floor(Math.random() * 5); // 43 - 47px
      } else if (altRoll < 0.88) {
        altitude = 'mid';
        clearance = 62 + Math.floor(Math.random() * 11); // 62 - 72px
      } else {
        altitude = 'high';
        clearance = 94 + Math.floor(Math.random() * 17); // 94 - 110px
      }
      y = this.groundY - clearance - h;
    }

    this.lastObstacleType = type;

    this.obstacles.push({
      x: this.width + 10,
      y,
      baseY: y,
      bobAngle: Math.random() * Math.PI * 2,
      w,
      h,
      type,
      altitude,
      shortcut,
      passed: false
    });

    // Dynamic Runway & Gap Compression (Mode-specific: Nightmare is tight & dense, Normal is smooth & relaxed)
    const profile = this.currentProfile;
    const jumpClearanceFrames = profile.clearance[type] || 26;

    // Progressive reaction runway: smoothly tightens as score progresses
    const scoreProgress = Math.min(1, this.score / 10000);
    const runwayDelta = (profile.reactionRunwayFramesStart - profile.reactionRunwayFramesEnd) * scoreProgress;
    const reactionRunwayFrames = Math.max(profile.reactionRunwayFramesEnd, Math.round(profile.reactionRunwayFramesStart - runwayDelta));

    // Minimum safe runway in pixels
    const minSafeRunway = Math.floor((jumpClearanceFrames + reactionRunwayFrames) * this.speed);

    // Physical floor: calibrated per mode (Nightmare = 231 floor -> ~300px at 0m; Normal = 260 floor -> ~380px at 0m)
    const floorDelta = (profile.baseGapFloorStart - profile.baseGapFloorEnd) * scoreProgress;
    const baseGapFloor = Math.max(profile.baseGapFloorEnd, Math.round(profile.baseGapFloorStart - floorDelta));
    const minPhysicalGap = w + Math.max(baseGapFloor, Math.floor(this.speed * 16));
    const safeDistance = Math.max(minPhysicalGap, minSafeRunway);

    // Dynamic controlled random variance
    const maxBuffer = Math.max(25, Math.floor(this.speed * (profile.maxBufferMult - scoreProgress * 4)));
    const randomBuffer = Math.floor(Math.random() * maxBuffer);

    // Preserve negative overshoot if any, so gap rhythm never drifts
    this.nextObstacleDistance = safeDistance + randomBuffer + Math.min(0, this.nextObstacleDistance);

    // Spawn bonus item occasionally
    if (Math.random() < 0.26) {
      this.spawnItem(this.width + Math.floor(this.nextObstacleDistance * 0.45));
    }
  },

  spawnItem(x) {
    const roll = Math.random();
    let type = 'coin';
    let y = this.groundY - (Math.random() * 65 + 40);

    if (roll < 0.12) {
      type = 'star'; // Invincible Shield
    } else if (roll < 0.25) {
      type = 'coffee'; // Slow-Mo Boost
    }

    this.items.push({
      x,
      y,
      w: 24,
      h: 24,
      type,
      floatOffset: Math.random() * Math.PI * 2
    });
  },

  update(dt = 1) {
    const effectiveSpeed = (this.player.slowMoTimer > 0) ? this.speed * 0.6 : this.speed;

    // 1. Distance & Score Tracking
    this.distance += effectiveSpeed * dt;
    this.score = Math.floor(this.distance / 9);

    if (this.scoreBadge) {
      this.scoreBadge.textContent = String(this.score).padStart(5, '0');
    }

    // High Score tracking
    if (this.score > this.highScore) {
      this.highScore = this.score;
      if (this.highScoreBadge) {
        this.highScoreBadge.textContent = String(this.highScore).padStart(5, '0');
      }
    }

    // Milestone sound every 100 points
    const currentMilestone = Math.floor(this.score / 100);
    if (currentMilestone > this.lastMilestone) {
      this.lastMilestone = currentMilestone;
      this.playSfx('milestone');
      this.player.happyTimer = 50;
      this.createFloatingText(this.player.x + 30, this.player.y - 15, `${currentMilestone * 100}!`, '#00f2fe');
    }

    // Progressive Speed Scaling based on active difficulty mode
    const profile = this.currentProfile;
    if (this.speed < this.maxSpeed) {
      this.speed = this.baseSpeed + ((this.score / 500) * profile.speedStep);
      if (this.speed > this.maxSpeed) this.speed = this.maxSpeed;
    }

    // 2. Power-up & Emotion Timers (scaled by dt)
    if (this.player.invincibleTimer > 0) this.player.invincibleTimer = Math.max(0, this.player.invincibleTimer - dt);
    if (this.player.slowMoTimer > 0) this.player.slowMoTimer = Math.max(0, this.player.slowMoTimer - dt);
    if (this.player.happyTimer > 0) this.player.happyTimer = Math.max(0, this.player.happyTimer - dt);

    // 3. Player Physics & Deformation
    // Restrict ducking hitbox only when grounded
    const currentH = (this.player.isDucking && this.player.isGrounded) ? this.player.duckHeight : this.player.baseH;
    this.player.h = currentH;

    this.player.vy += this.gravity * dt;
    this.player.y += this.player.vy * dt;

    // Rebound squash-stretch back to 1.0
    this.player.squashStretch += (1 - this.player.squashStretch) * (0.12 * dt);

    // Ground Collision
    if (this.player.y + this.player.h >= this.groundY) {
      if (!this.player.isGrounded) {
        // Just landed: squash deformation
        this.player.squashStretch = 0.82;
      }
      this.player.y = this.groundY - this.player.h;
      this.player.vy = 0;
      this.player.isGrounded = true;
      this.player.jumpCount = 0;

      // Create slide sparks while sliding on ground
      if (this.player.isDucking && Math.floor(this.player.runFrame) % 4 === 0) {
        this.createSlideSparks(this.player.x + 15, this.groundY);
      }
    }

    this.player.runFrame += dt;
    this.player.blinkTimer = (this.player.blinkTimer + dt) % 150;

    // Footstep Dust on Ground Running
    if (this.player.isGrounded && !this.player.isDucking && Math.floor(this.player.runFrame) % 18 === 0) {
      this.createFootstepDust(this.player.x + 8, this.groundY);
    }

    // Ghost Trails
    if (this.player.invincibleTimer > 0 || this.player.slowMoTimer > 0) {
      if (Math.floor(this.player.runFrame) % 3 === 0) {
        this.player.trail.push({
          x: this.player.x,
          y: this.player.y,
          w: this.player.w,
          h: this.player.h,
          alpha: 0.6,
          color: (this.player.invincibleTimer > 0) ? '#ffd200' : '#00f2fe'
        });
      }
    }

    for (let i = this.player.trail.length - 1; i >= 0; i--) {
      this.player.trail[i].alpha -= 0.05 * dt;
      if (this.player.trail[i].alpha <= 0) {
        this.player.trail.splice(i, 1);
      }
    }

    // 4. Parallax Track Offset
    this.trackOffset = (this.trackOffset + effectiveSpeed * dt) % 40;

    // 5. Obstacle Spawning, Danger Sensing & Collision
    this.nextObstacleDistance -= effectiveSpeed * dt;
    if (this.nextObstacleDistance <= 0) {
      this.spawnObstacle();
    }

    // Danger Proximity Sensing (Startled o o Face)
    let isDanger = false;
    for (let k = 0; k < this.obstacles.length; k++) {
      const obs = this.obstacles[k];
      const dist = obs.x - (this.player.x + this.player.w);
      if (dist > 0 && dist < 110 && obs.y + obs.h >= this.groundY - 30) {
        isDanger = true;
        break;
      }
    }
    this.player.dangerAlert = isDanger;

    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      obs.x -= effectiveSpeed * dt;

      // Organic hover bob for aerial drones
      if (obs.type === 'drone' && obs.baseY !== undefined) {
        obs.bobAngle = (obs.bobAngle || 0) + 0.07 * dt;
        const bobAmp = (obs.altitude === 'low') ? 1.5 : 2.5;
        obs.y = obs.baseY + Math.sin(obs.bobAngle) * bobAmp;
      }

      // Proportional vertical collision padding: 3px when ducking, 6px when standing
      const padX = 7;
      const padY = (this.player.isDucking && this.player.isGrounded) ? 3 : 6;
      const hit = (
        this.player.x + padX < obs.x + obs.w &&
        this.player.x + this.player.w - padX > obs.x &&
        this.player.y + padY < obs.y + obs.h &&
        this.player.y + this.player.h - padY > obs.y
      );

      if (hit) {
        if (this.player.invincibleTimer > 0) {
          // Smash through obstacle!
          this.playSfx('smash');
          this.score += 50;
          this.player.happyTimer = 40;
          this.createSmashParticles(obs.x + obs.w / 2, obs.y + obs.h / 2);
          this.createFloatingText(obs.x + obs.w / 2, obs.y, 'SMASH! +50', '#ff007f');
          this.obstacles.splice(i, 1);
          continue;
        } else {
          // Game Over hit
          this.triggerGameOver();
          return;
        }
      }

      // Despawn offscreen
      if (obs.x + obs.w < -20) {
        this.obstacles.splice(i, 1);
      }
    }

    // 6. Items Movement & Pickups
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.x -= effectiveSpeed * dt;
      item.floatOffset += 0.08 * dt;

      const bobY = item.y + Math.sin(item.floatOffset) * 6;

      const hit = (
        this.player.x < item.x + item.w &&
        this.player.x + this.player.w > item.x &&
        this.player.y < bobY + item.h &&
        this.player.y + this.player.h > bobY
      );

      if (hit) {
        if (item.type === 'coin') {
          this.playSfx('coin');
          this.score += 50;
          this.player.happyTimer = 40;
          this.createFloatingText(item.x, item.y, '+50', '#ffd200');
        } else if (item.type === 'coffee') {
          this.playSfx('powerup');
          this.player.slowMoTimer = 300; // 5 seconds
          this.player.happyTimer = 45;
          this.createFloatingText(item.x, item.y, '☕ SLOW-MO!', '#00f2fe');
        } else if (item.type === 'star') {
          this.playSfx('powerup');
          this.player.invincibleTimer = 260; // 4.3 seconds
          this.player.happyTimer = 50;
          this.createFloatingText(item.x, item.y, '⭐ INVINCIBLE!', '#ffd200');
        }
        this.items.splice(i, 1);
        continue;
      }

      if (item.x + item.w < -20) {
        this.items.splice(i, 1);
      }
    }

    // 7. Particle System Update
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= (1 / p.life) * dt;
      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // 8. Floating Texts Update
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy * dt;
      ft.alpha -= (1 / ft.life) * dt;
      if (ft.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }
  },

  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;

    // 1. Sky & Atmosphere Transitions
    // 1. Sky & Atmosphere Transitions (Soothing Slate Modern Palette)
    const cyclePhase = Math.floor(this.score / 500) % 4;
    let skyTop = '#0e131f';
    let skyBottom = '#1a2333';
    let gridColor = 'rgba(255, 255, 255, 0.08)';
    let trackColor = '#182030';

    if (cyclePhase === 1) { // Midnight Navy
      skyTop = '#0a101d';
      skyBottom = '#141d2e';
      gridColor = 'rgba(96, 165, 250, 0.12)';
    } else if (cyclePhase === 2) { // Cool Charcoal
      skyTop = '#111827';
      skyBottom = '#1f2937';
      gridColor = 'rgba(52, 211, 153, 0.10)';
    } else if (cyclePhase === 3) { // Nordic Slate
      skyTop = '#0f172a';
      skyBottom = '#1e293b';
      gridColor = 'rgba(148, 163, 184, 0.12)';
    }

    const skyGrad = ctx.createLinearGradient(0, 0, 0, this.groundY);
    skyGrad.addColorStop(0, skyTop);
    skyGrad.addColorStop(1, skyBottom);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Stars (Soft, non-straining)
    this.skylineStars.forEach(s => {
      ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha * (0.5 + Math.sin(Date.now() * s.twinkleSpeed) * 0.2)})`;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    });

    // Distant Cityscape Silhouette
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    const citySpeed = (this.distance * 0.05) % 120;
    for (let x = -citySpeed; x < this.width + 60; x += 40) {
      const bH = 25 + Math.sin(x * 0.08) * 15;
      ctx.fillRect(x, this.groundY - bH, 32, bH);
    }

    // 2. Track & Lane Striping
    ctx.fillStyle = trackColor;
    ctx.fillRect(0, this.groundY, this.width, this.height - this.groundY);

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, this.groundY);
    ctx.lineTo(this.width, this.groundY);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    for (let x = -this.trackOffset; x < this.width; x += 40) {
      ctx.fillRect(x, this.groundY + 12, 20, 3);
    }

    // 3. Ghost Trails
    this.player.trail.forEach(t => {
      ctx.save();
      ctx.globalAlpha = t.alpha;
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.roundRect(t.x, t.y, t.w, t.h, 8);
      ctx.fill();
      ctx.restore();
    });

    // 4. Draw Redesigned Shortcut Obstacles (Clean Modern Floating Tiles)
    this.obstacles.forEach(obs => {
      ctx.save();
      const isDrone = (obs.type === 'drone');
      const isDouble = (obs.type === 'double');

      // Aerial Drone Mini Rotor Blades
      if (isDrone) {
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        const rotorOffset = 12;
        const bladeW = 7 + Math.sin(Date.now() * 0.05) * 4;

        // Left rotor
        ctx.beginPath();
        ctx.moveTo(obs.x + rotorOffset, obs.y);
        ctx.lineTo(obs.x + rotorOffset, obs.y - 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(obs.x + rotorOffset - bladeW, obs.y - 4);
        ctx.lineTo(obs.x + rotorOffset + bladeW, obs.y - 4);
        ctx.stroke();

        // Right rotor
        ctx.beginPath();
        ctx.moveTo(obs.x + obs.w - rotorOffset, obs.y);
        ctx.lineTo(obs.x + obs.w - rotorOffset, obs.y - 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(obs.x + obs.w - rotorOffset - bladeW, obs.y - 4);
        ctx.lineTo(obs.x + obs.w - rotorOffset + bladeW, obs.y - 4);
        ctx.stroke();
      }

      // Card Base Chassis
      ctx.fillStyle = isDrone ? 'rgba(24, 32, 47, 0.96)' : 'rgba(30, 41, 59, 0.95)';
      ctx.strokeStyle = isDrone ? '#f59e0b' : (isDouble ? '#f43f5e' : 'rgba(255, 255, 255, 0.16)');
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.roundRect(obs.x, obs.y, obs.w, obs.h, 8);
      ctx.fill();
      ctx.stroke();

      // Subtle Top Accent Strip
      const topAccent = isDrone ? '#f59e0b' : (isDouble ? '#f43f5e' : '#38bdf8');
      ctx.fillStyle = topAccent;
      ctx.beginPath();
      ctx.roundRect(obs.x, obs.y, obs.w, 3, [8, 8, 0, 0]);
      ctx.fill();

      const cachedImg = this.faviconCache.get(obs.shortcut.url);

      if (isDrone) {
        // Streamlined horizontal drone tile layout
        const iconWellSize = 22;
        const iconWellX = obs.x + 6;
        const iconWellY = obs.y + 7;
        const iconDrawSize = 16;
        const iconDrawX = iconWellX + (iconWellSize - iconDrawSize) / 2;
        const iconDrawY = iconWellY + (iconWellSize - iconDrawSize) / 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.beginPath();
        ctx.roundRect(iconWellX, iconWellY, iconWellSize, iconWellSize, 5);
        ctx.fill();

        if (cachedImg && cachedImg.complete && cachedImg.naturalWidth !== 0) {
          ctx.drawImage(cachedImg, iconDrawX, iconDrawY, iconDrawSize, iconDrawSize);
        } else {
          const letter = (obs.shortcut.name || 'S').trim().charAt(0).toUpperCase();
          ctx.fillStyle = '#2563eb';
          ctx.beginPath();
          ctx.arc(iconWellX + iconWellSize / 2, iconWellY + iconWellSize / 2, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(letter, iconWellX + iconWellSize / 2, iconWellY + iconWellSize / 2);
        }

        // Drone Title & Altitude Indicator
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#f8fafc';
        ctx.font = '600 8.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        const label = (obs.shortcut.name || 'Site').slice(0, 5);
        ctx.fillText(label, obs.x + 32, obs.y + 8);

        // Altitude action tag
        let tagText = '▼';
        let tagColor = '#f59e0b';
        if (obs.altitude === 'mid') {
          tagText = '▲';
          tagColor = '#38bdf8';
        } else if (obs.altitude === 'high') {
          tagText = '▲';
          tagColor = '#f43f5e';
        }
        ctx.fillStyle = tagColor;
        ctx.font = 'bold 7.5px sans-serif';
        ctx.fillText(tagText, obs.x + 32, obs.y + 20);

      } else {
        // High-Contrast Ground Card (Single or Double)
        const iconWellSize = 22;
        const iconWellX = obs.x + (obs.w - iconWellSize) / 2;
        const iconWellY = obs.y + 6;
        const iconDrawSize = 16;
        const iconDrawX = iconWellX + (iconWellSize - iconDrawSize) / 2;
        const iconDrawY = iconWellY + (iconWellSize - iconDrawSize) / 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.beginPath();
        ctx.roundRect(iconWellX, iconWellY, iconWellSize, iconWellSize, 5);
        ctx.fill();

        if (cachedImg && cachedImg.complete && cachedImg.naturalWidth !== 0) {
          ctx.drawImage(cachedImg, iconDrawX, iconDrawY, iconDrawSize, iconDrawSize);
        } else {
          const letter = (obs.shortcut.name || 'S').trim().charAt(0).toUpperCase();
          ctx.fillStyle = '#2563eb';
          ctx.beginPath();
          ctx.arc(iconWellX + iconWellSize / 2, iconWellY + iconWellSize / 2, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(letter, iconWellX + iconWellSize / 2, iconWellY + iconWellSize / 2);
        }

        // Clean Legible Typography
        ctx.fillStyle = '#f8fafc';
        ctx.font = '600 8.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = (obs.shortcut.name || 'Site').slice(0, 7);
        ctx.fillText(label, obs.x + obs.w / 2, iconWellY + iconWellSize + 3);

        // Double Stack Second Lower Card
        if (isDouble) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
          ctx.beginPath();
          ctx.moveTo(obs.x + 6, obs.y + 42);
          ctx.lineTo(obs.x + obs.w - 6, obs.y + 42);
          ctx.stroke();

          const iconWellY2 = obs.y + 48;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
          ctx.beginPath();
          ctx.roundRect(iconWellX, iconWellY2, iconWellSize, iconWellSize, 5);
          ctx.fill();

          if (cachedImg && cachedImg.complete && cachedImg.naturalWidth !== 0) {
            ctx.drawImage(cachedImg, iconDrawX, iconWellY2 + (iconWellSize - iconDrawSize) / 2, iconDrawSize, iconDrawSize);
          }
          ctx.fillStyle = '#f8fafc';
          ctx.fillText(label, obs.x + obs.w / 2, iconWellY2 + iconWellSize + 3);
        }
      }

      ctx.restore();
    });

    // 5. Draw Collectable Items
    this.items.forEach(item => {
      ctx.save();
      const bobY = item.y + Math.sin(item.floatOffset) * 6;

      if (item.type === 'coin') {
        ctx.fillStyle = '#ffd200';
        ctx.shadowColor = '#ffd200';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(item.x + item.w / 2, bobY + item.h / 2, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b45309';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', item.x + item.w / 2, bobY + item.h / 2);
      } else if (item.type === 'coffee') {
        ctx.fillStyle = '#00f2fe';
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.roundRect(item.x, bobY, item.w, item.h, 6);
        ctx.fill();
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('☕', item.x + item.w / 2, bobY + item.h / 2);
      } else if (item.type === 'star') {
        ctx.fillStyle = '#ff007f';
        ctx.shadowColor = '#ff007f';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.roundRect(item.x, bobY, item.w, item.h, 6);
        ctx.fill();
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⭐', item.x + item.w / 2, bobY + item.h / 2);
      }
      ctx.restore();
    });

    // 6. Draw Upgraded Cyber Dino-Runner Bot
    this.renderPlayer(ctx);

    // 7. Particles
    this.particles.forEach(pt => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.alpha);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // 8. Floating Score Texts
    this.floatingTexts.forEach(ft => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    });

    // 9. Active Power-Up HUD
    const p = this.player;
    if (p.slowMoTimer > 0 || p.invincibleTimer > 0) {
      ctx.save();
      let badgeX = 14;
      if (p.slowMoTimer > 0) {
        ctx.fillStyle = 'rgba(0, 242, 254, 0.2)';
        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(badgeX, 12, 105, 24, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`☕ Slow-Mo ${(p.slowMoTimer / 60).toFixed(1)}s`, badgeX + 8, 28);
        badgeX += 115;
      }
      if (p.invincibleTimer > 0) {
        ctx.fillStyle = 'rgba(255, 210, 0, 0.2)';
        ctx.strokeStyle = '#ffd200';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(badgeX, 12, 115, 24, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`⭐ Invincible ${(p.invincibleTimer / 60).toFixed(1)}s`, badgeX + 8, 28);
      }
      ctx.restore();
    }
  },

  renderPlayer(ctx) {
    const p = this.player;
    ctx.save();

    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;

    // Squash & Stretch Transform
    ctx.translate(cx, cy);
    ctx.scale(2 - p.squashStretch, p.squashStretch);
    ctx.translate(-cx, -cy);

    const skin = this.skins[this.currentSkinIndex] || this.skins[0];
    const isInv = (p.invincibleTimer > 0);
    const primaryColor = isInv ? '#ffd200' : skin.primary;
    const secondaryColor = isInv ? '#ff8800' : skin.secondary;
    const accentColor = isInv ? '#f59e0b' : skin.accent;
    const bodyDark = skin.bodyDark;
    const bodyPlate = skin.bodyPlate;

    // Invincible Super Aura
    if (isInv) {
      ctx.save();
      ctx.shadowColor = '#ffd200';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = '#ffd200';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(p.x - 5, p.y - 5, p.w + 10, p.h + 10, 8);
      ctx.stroke();

      // Soft electric sparks
      for (let a = 0; a < 3; a++) {
        const arcAngle = (Date.now() * 0.008) + (a * 2.1);
        const arcX = cx + Math.cos(arcAngle) * (p.w * 0.6);
        const arcY = cy + Math.sin(arcAngle) * (p.h * 0.5);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(arcX, arcY, 2.5, 2.5);
      }
      ctx.restore();
    }

    if (p.isDucking && p.isGrounded) {
      // ══════════════════════════════════════════════
      // SLIDE / CROUCH POSE (Clean low-profile cyber glide)
      // ══════════════════════════════════════════════
      const slideW = p.w + 14;
      const slideH = p.duckHeight;
      const slideY = this.groundY - slideH;

      // 1. Horizontal Jet Micro-Flame
      ctx.fillStyle = isInv ? '#ffd200' : '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(p.x - 6, slideY + 8);
      ctx.lineTo(p.x - 15, slideY + 11);
      ctx.lineTo(p.x - 6, slideY + 14);
      ctx.closePath();
      ctx.fill();

      // 2. Slide Torso Armor Chassis
      const slideGrad = ctx.createLinearGradient(p.x, slideY, p.x + slideW, slideY + slideH);
      slideGrad.addColorStop(0, bodyPlate);
      slideGrad.addColorStop(1, primaryColor);
      ctx.fillStyle = slideGrad;
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(p.x - 2, slideY + 2, slideW - 2, slideH - 4, 6);
      ctx.fill();
      ctx.stroke();

      // 3. Low-Profile Helmet & Slit Visor
      ctx.fillStyle = bodyDark;
      ctx.beginPath();
      ctx.roundRect(p.x + slideW - 18, slideY + 2, 16, slideH - 6, 4);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(p.x + slideW - 12, slideY + 6, 8, 3);

      // 4. Sliding Skates with Friction Sparks
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(p.x - 2, this.groundY - 3.5, slideW, 3.5);

    } else {
      // ══════════════════════════════════════════════
      // ERECT RUNNER / MASCOT POSE (Clean Astro-Bot silhouette)
      // ══════════════════════════════════════════════

      // 1. Dual-Canister Jetpack on Back
      this.drawJetpack(ctx, p, primaryColor, isInv);

      // 2. Torso Armor Chassis & Chest Reactor
      const bodyGrad = ctx.createLinearGradient(p.x, p.y + 14, p.x + p.w, p.y + p.h - 10);
      bodyGrad.addColorStop(0, bodyPlate);
      bodyGrad.addColorStop(0.5, bodyDark);
      bodyGrad.addColorStop(1, bodyPlate);
      ctx.fillStyle = bodyGrad;
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 1.2;

      ctx.beginPath();
      ctx.roundRect(p.x, p.y + 14, p.w - 4, 22, 6);
      ctx.fill();
      ctx.stroke();

      // Subtle armor panel seam
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x + 8, p.y + 15);
      ctx.lineTo(p.x + 8, p.y + 35);
      ctx.stroke();

      // Pulsing Arc Core Heart (Reactor)
      const pulse = 1 + Math.sin(Date.now() * 0.007) * 0.18;
      ctx.save();
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(p.x + (p.w - 4) / 2, p.y + 25, 4.2 * pulse, 0, Math.PI * 2);
      ctx.fill();
      // Inner hot core
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x + (p.w - 4) / 2, p.y + 25, 1.8 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 3. Articulated Mechanical Legs (Natural rhythmic cadence)
      this.drawRaptorLegs(ctx, p, primaryColor);

      // 4. Cute Articulated Foreclaws (Arms)
      this.drawForeclaws(ctx, p, primaryColor);

      // 5. Mascot Helmet & Living Emotional Visor
      this.drawDinoHead(ctx, p, primaryColor, secondaryColor, accentColor, bodyDark);
    }

    ctx.restore();
  },

  drawJetpack(ctx, p, primaryColor, isInv) {
    ctx.save();
    // Jetpack Double Canister
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    ctx.roundRect(p.x - 6, p.y + 15, 7, 20, 3);
    ctx.fill();
    ctx.stroke();

    // Chrome bands
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(p.x - 6, p.y + 19, 7, 2);
    ctx.fillRect(p.x - 6, p.y + 28, 7, 2);

    // Nozzle
    ctx.fillStyle = '#475569';
    ctx.fillRect(p.x - 5, p.y + 35, 5, 3);

    // Dynamic Exhaust Flame
    const isAirborne = !p.isGrounded;
    const flameLen = isAirborne ? (9 + Math.random() * 5) : (2.5 + Math.random() * 1.5);
    const flameColor = isInv ? '#ffd200' : (isAirborne ? '#38bdf8' : '#f59e0b');

    ctx.fillStyle = flameColor;
    ctx.beginPath();
    ctx.moveTo(p.x - 5, p.y + 38);
    ctx.lineTo(p.x - 2.5, p.y + 38 + flameLen);
    ctx.lineTo(p.x, p.y + 38);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  drawRaptorLegs(ctx, p, primaryColor) {
    // Stride frequency reduced to 0.16 for smooth, natural robotic motion
    const strideFreq = 0.16;
    const legPhase = p.isGrounded ? Math.sin(p.runFrame * strideFreq) : 0;
    const footY = this.groundY;

    // Helper to draw one articulated leg
    const drawSingleLeg = (hipX, hipY, forwardOffset, isFront) => {
      ctx.save();
      const kneeX = hipX + forwardOffset * 4.5;
      const kneeY = hipY + 12;
      const targetFootX = hipX + forwardOffset * 6.5;
      const targetFootY = p.isGrounded ? footY : (hipY + 22);

      // Thigh armor plate
      ctx.strokeStyle = isFront ? primaryColor : '#64748b';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(kneeX, kneeY);
      ctx.stroke();

      // Circular Knee Pin
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(kneeX, kneeY, 2, 0, Math.PI * 2);
      ctx.fill();

      // Shin mechanical strut
      ctx.strokeStyle = isFront ? '#f8fafc' : '#94a3b8';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(kneeX, kneeY);
      ctx.lineTo(targetFootX, targetFootY - 3);
      ctx.stroke();

      // Raptor Talon Boot
      ctx.fillStyle = isFront ? '#f8fafc' : '#94a3b8';
      ctx.beginPath();
      ctx.roundRect(targetFootX - 2, targetFootY - 4, 8, 4, 1.5);
      ctx.fill();

      // Front claw tip
      ctx.fillStyle = primaryColor;
      ctx.fillRect(targetFootX + 5, targetFootY - 3, 2.5, 2.5);

      ctx.restore();
    };

    if (p.isGrounded) {
      // Back leg
      drawSingleLeg(p.x + 10, p.y + 34, -legPhase, false);
      // Front leg
      drawSingleLeg(p.x + 22, p.y + 34, legPhase, true);
    } else {
      // Air leap: dynamic tucked jump posture
      drawSingleLeg(p.x + 10, p.y + 34, -0.5, false);
      drawSingleLeg(p.x + 22, p.y + 34, 0.35, true);
    }
  },

  drawForeclaws(ctx, p, primaryColor) {
    const strideFreq = 0.16;
    const armPhase = p.isGrounded ? Math.sin(p.runFrame * strideFreq) : -0.4;
    const shoulderX = p.x + 18;
    const shoulderY = p.y + 20;
    const elbowX = shoulderX + armPhase * 4;
    const elbowY = shoulderY + 8;
    const handX = elbowX + 5 + armPhase * 2.5;
    const handY = elbowY + 2;

    ctx.save();
    // Arm limb
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(handX, handY);
    ctx.stroke();

    // Cute mini 2-finger claw hand
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(handX + 3, handY - 2);
    ctx.moveTo(handX, handY);
    ctx.lineTo(handX + 3, handY + 2);
    ctx.stroke();
    ctx.restore();
  },

  drawDinoHead(ctx, p, primaryColor, secondaryColor, accentColor, bodyDark) {
    const headX = p.x + 4;
    const headY = p.y;
    const headW = p.w - 6;
    const headH = 17;

    ctx.save();
    // 1. Helmet Gradient Dome
    const headGrad = ctx.createLinearGradient(headX, headY, headX + headW, headY + headH);
    headGrad.addColorStop(0, primaryColor);
    headGrad.addColorStop(1, secondaryColor);
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.roundRect(headX, headY, headW, headH, [8, 8, 4, 4]);
    ctx.fill();

    // Helmet Top Glass Highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.roundRect(headX + 4, headY + 2, headW - 12, 3, 1.5);
    ctx.fill();

    // 2. Cranial Tech Crest & Beacon Antenna
    ctx.fillStyle = primaryColor;
    ctx.fillRect(headX + 10, headY - 3, 7, 4);

    // Antenna stalk & pulsing LED beacon
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(headX + 13, headY - 3);
    ctx.lineTo(headX + 13, headY - 7);
    ctx.stroke();

    const beaconPulse = Math.sin(Date.now() * 0.008) > 0;
    ctx.fillStyle = beaconPulse ? accentColor : primaryColor;
    ctx.beginPath();
    ctx.arc(headX + 13, headY - 8, 2, 0, Math.PI * 2);
    ctx.fill();

    // 3. Side Ear Disc / Bolt
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(headX + 4, headY + 8, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 4. Living Emotional Visor Screen
    const visorX = headX + headW - 16;
    const visorY = headY + 3;
    const visorW = 14;
    const visorH = 10;

    ctx.fillStyle = '#0a0f1d';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(visorX, visorY, visorW, visorH, 3);
    ctx.fill();
    ctx.stroke();

    // 5. Visor Emotion Expressions
    if (this.isGameOver) {
      // Dead: Pink Glowing 'X  X'
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      // Left eye X
      ctx.moveTo(visorX + 3, visorY + 2);
      ctx.lineTo(visorX + 6, visorY + 7);
      ctx.moveTo(visorX + 6, visorY + 2);
      ctx.lineTo(visorX + 3, visorY + 7);
      // Right eye X
      ctx.moveTo(visorX + 8, visorY + 2);
      ctx.lineTo(visorX + 11, visorY + 7);
      ctx.moveTo(visorX + 11, visorY + 2);
      ctx.lineTo(visorX + 8, visorY + 7);
      ctx.stroke();

    } else if (p.happyTimer > 0) {
      // Happy: Adorable '^  ^' crescent eyes + blush!
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(visorX + 4, visorY + 6, 2.5, Math.PI, 0, false);
      ctx.arc(visorX + 10, visorY + 6, 2.5, Math.PI, 0, false);
      ctx.stroke();

      // Cute Pink Blush dots
      ctx.fillStyle = 'rgba(244, 63, 94, 0.6)';
      ctx.fillRect(visorX + 2, visorY + 8, 2, 1.5);
      ctx.fillRect(visorX + 10, visorY + 8, 2, 1.5);

    } else if (p.dangerAlert && p.isGrounded) {
      // Danger / Surprise: Wide alarmed 'o  o' eyes!
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(visorX + 4, visorY + 5, 2.5, 0, Math.PI * 2);
      ctx.arc(visorX + 10, visorY + 5, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // Pupils
      ctx.fillStyle = primaryColor;
      ctx.beginPath();
      ctx.arc(visorX + 4.5, visorY + 5, 1.2, 0, Math.PI * 2);
      ctx.arc(visorX + 10.5, visorY + 5, 1.2, 0, Math.PI * 2);
      ctx.fill();

    } else if (!p.isGrounded) {
      // Airborne Jump: Focused forward slit eye '>'
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(visorX + 3, visorY + 3);
      ctx.lineTo(visorX + 12, visorY + 5);
      ctx.lineTo(visorX + 3, visorY + 7);
      ctx.closePath();
      ctx.fill();

    } else {
      // Running: Natural Blinking + Forward Eye Tracking
      const isBlinking = (p.blinkTimer > 140);
      if (isBlinking) {
        ctx.fillStyle = primaryColor;
        ctx.fillRect(visorX + 3, visorY + 5, 8, 2);
      } else {
        // Expressive oval eye with primary pupil
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(visorX + 4, visorY + 2, 7, 6, 2);
        ctx.fill();
        ctx.fillStyle = primaryColor;
        ctx.fillRect(visorX + 7, visorY + 3, 3, 4);
      }
    }

    ctx.restore();
  },

  loop(timestamp = performance.now()) {
    if (!this.isRunning || this.isPaused || this.isGameOver) {
      this.animFrameId = null;
      return;
    }
    this.animFrameId = null;

    if (!this.lastFrameTime) this.lastFrameTime = timestamp;
    let elapsed = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;

    // Cap elapsed to avoid massive jumps on lag spikes or tab resume
    if (elapsed > 100) elapsed = 100;
    // 60 FPS standard reference (16.67ms per tick)
    const dt = elapsed / (1000 / 60);

    this.update(dt);
    this.render();

    if (this.isRunning && !this.isPaused && !this.isGameOver) {
      this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }
  },

  async triggerGameOver() {
    this.isGameOver = true;
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.playSfx('hit');

    // Synchronously update high score in memory and UI before any async await
    this.highScore = Math.max(this.highScore, this.score);
    if (this.finalScoreEl) this.finalScoreEl.textContent = String(this.score);
    if (this.bestScoreEl) this.bestScoreEl.textContent = String(this.highScore);
    if (this.highScoreBadge) this.highScoreBadge.textContent = String(this.highScore).padStart(5, '0');

    const banner = this.gameOverOverlay ? this.gameOverOverlay.querySelector('.game-over-banner') : null;
    if (banner) {
      banner.textContent = (this.difficulty === 'nightmare') ? '💀 NIGHTMARE SLAIN' : 'GAME OVER';
    }
    if (this.gameOverOverlay) this.gameOverOverlay.style.display = 'flex';

    // Draw final frame so dead eye expression renders immediately
    this.render();

    if (typeof ShortcutStorage !== 'undefined') {
      try {
        const saved = await ShortcutStorage.saveGameHighScore(this.score);
        this.highScore = Math.max(this.highScore, saved);
        if (this.bestScoreEl) this.bestScoreEl.textContent = String(this.highScore);
        if (this.highScoreBadge) this.highScoreBadge.textContent = String(this.highScore).padStart(5, '0');
      } catch (e) {
        console.warn('[Runner] Error saving high score:', e);
      }
    }
  }
};

window.ShortcutRunner = ShortcutRunner;
