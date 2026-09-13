/* theme.js - Theme, Spatial/Ambient Presets, Rich Media (Video, GIF), & Contrast/Blur Engine */

const ThemeEngine = {
  currentMode: 'system', // 'system' | 'light' | 'dark'
  bgMode: 'default', // 'default' | 'unsplash' | 'glass' | 'custom' | preset_keys
  bgCustomUrl: '',
  titleColor: '',
  cardBgColor: '',
  cardOpacity: 85,
  cardBlur: 16,

  WALLPAPER_PRESETS: {
    // 1. Spatial Cupboard Workstations (Straight empty shelves for shortcuts)
    'spatial_dev_sikh': {
      title: '⭐ Spatial: Sikh Dev Studio (Cupboard)',
      type: 'spatial',
      url: 'assets/wallpapers/spatial_dev_sikh.webp'
    },
    'spatial_dev_green': {
      title: '⭐ Spatial: Green Hoodie & Pup (Cupboard)',
      type: 'spatial',
      url: 'assets/wallpapers/spatial_dev_green.webp'
    },
    'spatial_dev_purple': {
      title: '⭐ Spatial: Neon Purple & Cat (Cupboard)',
      type: 'spatial',
      url: 'assets/wallpapers/spatial_dev_purple.webp'
    },
    'spatial_dev_grind': {
      title: '⭐ Spatial: Battlestation Dev (Cupboard)',
      type: 'spatial',
      url: 'assets/wallpapers/spatial_dev_grind.webp'
    },
    'spatial_dev_corgi': {
      title: '⭐ Spatial: Warm Loft & Corgi (Cupboard)',
      type: 'spatial',
      url: 'assets/wallpapers/spatial_dev_corgi.webp'
    },

    // 2. Animated Living Wallpapers (With interactive pause/play/restart controls)
    'animated_dev': {
      title: '🎞️ Animated: Dev Studio',
      type: 'spatial',
      url: 'assets/wallpapers/animated_dev.webp',
      animated: true
    },
    'animated_pixel_room': {
      title: '🎞️ Animated: Cozy Pixel Studio',
      type: 'ambient',
      url: 'assets/wallpapers/animated_pixel_room.webp',
      animated: true
    },

    // 3. Classic Spatial Workspaces
    'spatial_boy_programmer': {
      title: '⭐ Spatial: Cozy Desk (Boy Dev)',
      type: 'spatial',
      url: 'assets/wallpapers/spatial_boy_programmer.webp'
    },
    'spatial_girl_programmer': {
      title: '⭐ Spatial: Studio Setup (Girl Dev)',
      type: 'spatial',
      url: 'assets/wallpapers/spatial_girl_programmer.webp'
    },
    'spatial_boy_loft': {
      title: '⭐ Spatial: Night Loft (Boy Dev)',
      type: 'spatial',
      url: 'assets/wallpapers/spatial_boy_loft.webp'
    },
    'spatial_girl_sunset': {
      title: '⭐ Spatial: Sunset Room (Girl Dev)',
      type: 'spatial',
      url: 'assets/wallpapers/spatial_girl_sunset.webp'
    },

    // 4. Ambient Aesthetics
    'ambient_cyberpunk': {
      title: 'Ambient: Cyberpunk Neon Rain',
      type: 'ambient',
      url: 'assets/wallpapers/ambient_cyberpunk.webp'
    },
    'ambient_lofi': {
      title: 'Ambient: Lo-Fi Evening Sunset',
      type: 'ambient',
      url: 'assets/wallpapers/ambient_lofi.webp'
    },

    // Backward compatibility aliases
    get 'animated_gif_cozy'() { return this.animated_pixel_room; },
    get 'animated_desk'() { return this.animated_dev; }
  },

  async applySettings(settings = null) {
    const st = settings || await ShortcutStorage.getSettings();
    this.currentMode = st.themeMode || 'system';
    this.bgMode = st.bgMode || 'default';
    this.bgCustomUrl = st.bgCustomUrl || '';
    this.titleColor = st.titleColor || '';
    this.cardBgColor = st.cardBgColor || '';
    this.cardOpacity = st.cardOpacity !== undefined ? st.cardOpacity : 85;
    this.cardBlur = st.cardBlur !== undefined ? st.cardBlur : 16;

    this.applyTheme(this.currentMode);
    this.applyBackground(this.bgMode, this.bgCustomUrl);
    this.applyVisualCustomizations({
      titleColor: this.titleColor,
      cardBgColor: this.cardBgColor,
      cardOpacity: this.cardOpacity,
      cardBlur: this.cardBlur
    });
  },

  async init() {
    await this.applySettings();
    this.bindSystemListener();
  },

  setTheme(mode) {
    this.currentMode = mode;
    this.applyTheme(mode);
    this.applyVisualCustomizations({
      titleColor: this.titleColor,
      cardBgColor: this.cardBgColor,
      cardOpacity: this.cardOpacity,
      cardBlur: this.cardBlur
    });
    ShortcutStorage.saveSettings({ themeMode: mode });
  },

  setBackground(bgMode, customUrl = '') {
    this.bgMode = bgMode;
    this.bgCustomUrl = customUrl;
    this.applyBackground(bgMode, customUrl);
    ShortcutStorage.saveSettings({ bgMode, bgCustomUrl: customUrl });
  },

  applyVisualCustomizations(opts = {}) {
    const root = document.documentElement;

    if (opts.titleColor !== undefined) {
      this.titleColor = opts.titleColor;
    }
    if (opts.cardOpacity !== undefined) {
      this.cardOpacity = parseInt(opts.cardOpacity, 10);
    }
    if (opts.cardBlur !== undefined) {
      this.cardBlur = parseInt(opts.cardBlur, 10);
    }
    if (opts.cardBgColor !== undefined) {
      this.cardBgColor = opts.cardBgColor;
    }

    // 1. Label Text Color & High-Contrast Adaptive Shadow
    if (this.titleColor) {
      root.style.setProperty('--shortcut-title-color', this.titleColor);
      const rgb = this.hexToRgb(this.titleColor);
      if (rgb) {
        const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b);
        if (lum > 140) {
          root.style.setProperty('--shortcut-title-shadow', '0 1px 3px rgba(0, 0, 0, 0.85), 0 2px 6px rgba(0, 0, 0, 0.6)');
        } else {
          root.style.setProperty('--shortcut-title-shadow', '0 1px 2px rgba(255, 255, 255, 0.6)');
        }
      }
    } else {
      root.style.removeProperty('--shortcut-title-color');
      root.style.removeProperty('--shortcut-title-shadow');
    }

    // 2. Opacity Alpha Calculation
    const alpha = (this.cardOpacity / 100).toFixed(2);
    root.style.setProperty('--shortcut-opacity', alpha);

    // 3. Backdrop Frost Blur
    root.style.setProperty('--shortcut-blur', `${this.cardBlur}px`);

    // 4. Card Background Tint with Alpha (Always recomputed whenever either tint or opacity changes)
    if (this.cardBgColor) {
      root.classList.add('has-custom-card-bg');
      const rgb = this.hexToRgb(this.cardBgColor);
      if (rgb) {
        root.style.setProperty('--shortcut-card-bg', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`);
      }
    } else {
      root.classList.remove('has-custom-card-bg');
      const isDark = root.getAttribute('data-theme') === 'dark' ||
        (!root.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const baseRgb = isDark ? '22, 27, 34' : '255, 255, 255';
      root.style.setProperty('--shortcut-card-bg', `rgba(${baseRgb}, ${alpha})`);
    }
  },

  hexToRgb(hex) {
    if (!hex) return null;
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map(c => c + c).join('');
    }
    const num = parseInt(clean, 16);
    if (isNaN(num)) return null;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  },

  applyTheme(mode) {
    const root = document.documentElement;
    if (mode === 'light') {
      root.setAttribute('data-theme', 'light');
    } else if (mode === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
  },

  isVideoUrl(url) {
    if (!url) return false;
    const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();
    return cleanUrl.endsWith('.mp4') || cleanUrl.endsWith('.webm') || cleanUrl.endsWith('.ogg') || cleanUrl.endsWith('.mov') || url.startsWith('data:video/');
  },

  isGifUrl(url) {
    if (!url) return false;
    const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();
    return cleanUrl.endsWith('.gif') || url.startsWith('data:image/gif') || (cleanUrl.endsWith('.webp') && cleanUrl.includes('animated_'));
  },

  applyBackground(bgMode, customUrl = '') {
    let container = document.getElementById('bg-wallpaper-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'bg-wallpaper-container';
      document.body.prepend(container);
    }

    // Clear previous background classes and contents
    document.body.classList.remove('bg-mode-unsplash', 'bg-mode-glass', 'bg-mode-custom', 'bg-mode-preset');
    container.innerHTML = '';
    container.style.backgroundImage = 'none';
    this.hideVideoControls();

    // 1. Wallpaper Presets
    if (this.WALLPAPER_PRESETS[bgMode]) {
      document.body.classList.add('bg-mode-preset');
      const preset = this.WALLPAPER_PRESETS[bgMode];
      if (this.isVideoUrl(preset.url)) {
        const videoEl = document.createElement('video');
        videoEl.className = 'bg-video-element';
        videoEl.autoplay = true;
        videoEl.loop = true;
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.src = preset.url;
        videoEl.onerror = () => {
          if (typeof window !== 'undefined' && window.showToast) {
            window.showToast('Failed to load background video preset.');
          }
        };
        container.replaceChildren(videoEl);
        this.initVideoControls();
      } else if (preset.animated || this.isGifUrl(preset.url)) {
        const imgEl = document.createElement('img');
        imgEl.className = 'bg-media-element bg-gif-element';
        imgEl.src = preset.url;
        imgEl.alt = 'Background Media';
        const canvasEl = document.createElement('canvas');
        canvasEl.className = 'bg-media-element bg-gif-freeze-canvas';
        canvasEl.style.display = 'none';
        container.replaceChildren(imgEl, canvasEl);
        this.initGifControls(preset.url);
      } else {
        container.style.backgroundImage = `url('${preset.url}')`;
      }
      return;
    }

    // 2. Unsplash Daily
    if (bgMode === 'unsplash') {
      document.body.classList.add('bg-mode-unsplash');
      const dailyUnsplashPhotos = [
        'photo-1507525428034-b723cf961d3e', // Coastal beach
        'photo-1519681393784-d120267933ba', // Snowy mountain starry night
        'photo-1470071459604-3b5ec3a7fe05', // Misty foggy mountains
        'photo-1506744038136-46273834b3fb', // Yosemite valley waterfall
        'photo-1518709268805-4e9042af9f23', // Neon futuristic rain
        'photo-1448375240586-882707db888b', // Deep forest rays
        'photo-1534447677768-be436bb09401', // Northern lights aurora
        'photo-1477346611705-65d1883cee1e', // Dark moody mountains
        'photo-1509198397868-475647b2a1e5', // Cyberpunk night city
        'photo-1518837695005-2083093ee35b'  // Pacific ocean sunset
      ];
      const now = new Date();
      const startOfYear = new Date(now.getFullYear(), 0, 0);
      const diff = now - startOfYear;
      const oneDay = 1000 * 60 * 60 * 24;
      const dayOfYear = Math.floor(diff / oneDay);
      const photoId = dailyUnsplashPhotos[dayOfYear % dailyUnsplashPhotos.length];
      const unsplashUrl = `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=1920&q=80`;
      container.style.backgroundImage = `url('${unsplashUrl}')`;
      return;
    }

    // 3. Dark Glassmorphism
    if (bgMode === 'glass') {
      document.body.classList.add('bg-mode-glass');
      container.innerHTML = `
        <div class="glass-mesh-orb glass-mesh-1"></div>
        <div class="glass-mesh-orb glass-mesh-2"></div>
        <div class="glass-mesh-orb glass-mesh-3"></div>
      `;
      return;
    }

    // 4. Custom Media (Image, GIF, MP4/WebM Video)
    if (bgMode === 'custom' && customUrl) {
      if (customUrl.startsWith('file://')) {
        if (typeof window !== 'undefined' && window.showToast) {
          window.showToast('Local file:// paths are restricted by Chrome security. Please use the Upload button or an https:// URL.');
        }
        container.style.backgroundImage = 'none';
        return;
      }

      document.body.classList.add('bg-mode-custom');

      if (this.isVideoUrl(customUrl)) {
        // Direct video file (MP4/WebM/OGG)
        const videoEl = document.createElement('video');
        videoEl.className = 'bg-video-element';
        videoEl.autoplay = true;
        videoEl.loop = true;
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.src = customUrl;
        videoEl.onerror = () => {
          if (typeof window !== 'undefined' && window.showToast) {
            window.showToast('Failed to load background video. Check the video URL.');
          }
        };
        container.replaceChildren(videoEl);
        this.initVideoControls();
      } else if (this.isGifUrl(customUrl)) {
        // Animated GIF with interactive pause/play/restart controls
        const imgEl = document.createElement('img');
        imgEl.className = 'bg-media-element bg-gif-element';
        imgEl.src = customUrl;
        imgEl.alt = 'Background GIF';
        const canvasEl = document.createElement('canvas');
        canvasEl.className = 'bg-media-element bg-gif-freeze-canvas';
        canvasEl.style.display = 'none';
        container.replaceChildren(imgEl, canvasEl);
        this.initGifControls(customUrl);
      } else {
        // Standard Static Image
        if (customUrl.startsWith('data:image/') || customUrl.startsWith('blob:')) {
          container.style.backgroundImage = `url('${customUrl}')`;
        } else {
          const testImg = new Image();
          testImg.onload = () => {
            container.style.backgroundImage = `url('${customUrl}')`;
          };
          testImg.onerror = () => {
            if (typeof window !== 'undefined' && window.showToast) {
              window.showToast('Failed to load custom background image URL.');
            }
          };
          testImg.src = customUrl;
        }
      }
    }
  },

  initVideoControls() {
    const controls = document.getElementById('bg-video-controls');
    const video = document.querySelector('.bg-video-element');
    if (!controls || !video) return;

    controls.style.display = 'flex';

    const playBtn = document.getElementById('bg-video-play-btn');
    const muteBtn = document.getElementById('bg-video-mute-btn');
    const restartBtn = document.getElementById('bg-video-restart-btn');

    if (muteBtn) {
      muteBtn.style.display = 'inline-flex';
    }

    const iconPause = playBtn ? playBtn.querySelector('.icon-pause') : null;
    const iconPlay = playBtn ? playBtn.querySelector('.icon-play') : null;
    const iconMuted = muteBtn ? muteBtn.querySelector('.icon-muted') : null;
    const iconUnmuted = muteBtn ? muteBtn.querySelector('.icon-unmuted') : null;

    const updatePlayState = () => {
      if (!playBtn) return;
      if (video.paused) {
        if (iconPause) iconPause.style.display = 'none';
        if (iconPlay) iconPlay.style.display = 'block';
        playBtn.title = 'Play background video';
      } else {
        if (iconPause) iconPause.style.display = 'block';
        if (iconPlay) iconPlay.style.display = 'none';
        playBtn.title = 'Pause background video';
      }
    };

    const updateMuteState = () => {
      if (!muteBtn) return;
      if (video.muted) {
        if (iconMuted) iconMuted.style.display = 'block';
        if (iconUnmuted) iconUnmuted.style.display = 'none';
        muteBtn.title = 'Unmute audio';
      } else {
        if (iconMuted) iconMuted.style.display = 'none';
        if (iconUnmuted) iconUnmuted.style.display = 'block';
        muteBtn.title = 'Mute audio';
      }
    };

    if (playBtn) {
      playBtn.onclick = () => {
        if (video.paused) {
          video.play().catch(() => { });
        } else {
          video.pause();
        }
        updatePlayState();
      };
    }

    if (muteBtn) {
      muteBtn.onclick = () => {
        video.muted = !video.muted;
        updateMuteState();
      };
    }

    if (restartBtn) {
      restartBtn.onclick = () => {
        video.currentTime = 0;
        if (video.paused) {
          video.play().catch(() => { });
        }
        updatePlayState();
      };
    }

    video.onplay = updatePlayState;
    video.onpause = updatePlayState;
    video.onvolumechange = updateMuteState;

    updatePlayState();
    updateMuteState();
  },

  initGifControls(gifUrl) {
    const controls = document.getElementById('bg-video-controls');
    const img = document.querySelector('.bg-gif-element');
    const canvas = document.querySelector('.bg-gif-freeze-canvas');
    if (!controls || !img || !canvas) return;

    controls.style.display = 'flex';

    const playBtn = document.getElementById('bg-video-play-btn');
    const muteBtn = document.getElementById('bg-video-mute-btn');
    const restartBtn = document.getElementById('bg-video-restart-btn');

    const iconPause = playBtn ? playBtn.querySelector('.icon-pause') : null;
    const iconPlay = playBtn ? playBtn.querySelector('.icon-play') : null;

    // GIFs do not have audio tracks, so hide the mute button
    if (muteBtn) {
      muteBtn.style.display = 'none';
    }

    let isPaused = false;

    const updatePlayState = () => {
      if (!playBtn) return;
      if (isPaused) {
        if (iconPause) iconPause.style.display = 'none';
        if (iconPlay) iconPlay.style.display = 'block';
        playBtn.title = 'Play animated GIF';
        playBtn.setAttribute('aria-label', 'Play animated GIF');
      } else {
        if (iconPause) iconPause.style.display = 'block';
        if (iconPlay) iconPlay.style.display = 'none';
        playBtn.title = 'Pause animated GIF';
        playBtn.setAttribute('aria-label', 'Pause animated GIF');
      }
    };

    const freezeGif = () => {
      try {
        canvas.width = img.naturalWidth || img.clientWidth || window.innerWidth;
        canvas.height = img.naturalHeight || img.clientHeight || window.innerHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.style.display = 'block';
        img.style.display = 'none';
        isPaused = true;
        updatePlayState();
      } catch (err) {
        console.warn('[ThemeEngine] Canvas draw error when freezing GIF:', err);
        canvas.style.display = 'none';
        img.style.display = 'block';
        isPaused = false;
        updatePlayState();
      }
    };

    const resumeGif = () => {
      canvas.style.display = 'none';
      img.style.display = 'block';
      isPaused = false;
      updatePlayState();
    };

    const restartGif = () => {
      resumeGif();
      const currentSrc = img.src;
      img.src = '';
      img.src = currentSrc;
      if (typeof window !== 'undefined' && window.showToast) {
        window.showToast('GIF restarted');
      }
    };

    if (playBtn) {
      playBtn.onclick = () => {
        if (isPaused) {
          resumeGif();
        } else {
          freezeGif();
        }
      };
    }

    if (restartBtn) {
      restartBtn.title = 'Restart GIF from beginning';
      restartBtn.setAttribute('aria-label', 'Restart GIF');
      restartBtn.onclick = () => {
        restartGif();
      };
    }

    updatePlayState();
  },

  hideVideoControls() {
    const controls = document.getElementById('bg-video-controls');
    if (controls) {
      controls.style.display = 'none';
    }
  },

  bindSystemListener() {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.currentMode === 'system') {
        this.applyTheme('system');
        this.applyVisualCustomizations({
          titleColor: this.titleColor,
          cardBgColor: this.cardBgColor,
          cardOpacity: this.cardOpacity,
          cardBlur: this.cardBlur
        });
      }
    });
  }
};
