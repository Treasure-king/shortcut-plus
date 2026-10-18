/* arcade.js - "Shortcut Arcade" hub: game picker (Runner / Breaker), daily rewards & missions, and the coin shop.
 *
 * Public API:
 *   ShortcutArcade.init()
 *   ShortcutArcade.open()             - hub on the Play tab (refuses to stack on top of a running game)
 *   ShortcutArcade.openShop(game?)    - hub on the Shop tab, scrolled to 'runner' | 'breaker' (closes a running game first)
 *   ShortcutArcade.openDaily()        - hub on the Daily tab (closes a running game first)
 *   ShortcutArcade.close()
 *   ShortcutArcade.isOpen / isAnyGameOpen()
 */

const ShortcutArcade = (() => {
  'use strict';

  const LAST_KEY = 'shortcut_plus_arcade_last';
  const MUTE_KEY = 'shortcut_plus_game_muted';
  const HEADER_BTN_ID = 'game-header-btn';

  const GAMES = [
    {
      id: 'runner',
      hotkey: '1',
      icon: '🏃',
      title: 'Shortcut Runner',
      tag: 'Endless runner',
      desc: 'Leap and double-jump over your own shortcuts, grab power-ups and survive Nightmare mode.',
      available: () => typeof ShortcutRunner !== 'undefined',
      getScore: async () => (typeof ShortcutStorage !== 'undefined' ? ShortcutStorage.getGameHighScore() : 0),
      launch: (opts) => ShortcutRunner.open(opts)
    },
    {
      id: 'breaker',
      hotkey: '2',
      icon: '🧱',
      title: 'Shortcut Breaker',
      tag: 'Brick breaker',
      desc: 'Smash a wall built from your shortcuts. Chain combos, catch fireballs, lasers and coins.',
      available: () => typeof ShortcutBreaker !== 'undefined',
      getScore: async () => (typeof ShortcutBreaker !== 'undefined' ? ShortcutBreaker.getHighScore() : 0),
      launch: (opts) => ShortcutBreaker.open(opts)
    }
  ];

  const TABS = [
    { id: 'play', label: 'Play', icon: '🎮' },
    { id: 'daily', label: 'Daily', icon: '🎁' },
    { id: 'shop', label: 'Shop', icon: '🛒' }
  ];

  const FOOTER_HINTS = {
    play: '1 / 2 quick start · ←/→ tabs · Enter play · Esc close',
    daily: '←/→ tabs · ↑/↓ move · Enter claim · Esc close',
    shop: '←/→ tabs · ↑/↓ move · Enter buy / equip · Esc close'
  };

  const SHOP_GROUPS = [
    {
      game: 'runner', title: 'Shortcut Runner', icon: '🏃', sections: [
        { title: 'Characters', match: i => i.type === 'skin' },
        { title: 'Trails', match: i => i.type === 'trail' },
        { title: 'Power-up upgrades', match: i => i.type === 'upgrade' },
        { title: 'Boosts', match: i => i.type === 'consumable' }
      ]
    },
    {
      game: 'breaker', title: 'Shortcut Breaker', icon: '🧱', sections: [
        { title: 'Paddles', match: i => i.type === 'paddle' },
        { title: 'Upgrades', match: i => i.type === 'upgrade' }
      ]
    }
  ];

  const ITEM_EMOJI = {
    'skin-classic': '🏃', 'skin-ninja': '🥷', 'skin-robot': '🤖', 'skin-cat': '🐱', 'skin-astronaut': '🧑‍🚀', 'skin-golden': '👑',
    'trail-none': '➖', 'trail-sparkle': '✨', 'trail-fire': '🔥', 'trail-rainbow': '🌈',
    'up-magnet': '🧲', 'up-shield': '🛡️', 'up-double': '💰', 'up-jetpack': '🚀', 'up-slowmo': '☕',
    'boost-headstart': '⚡', 'item-revive': '💖',
    'paddle-classic': '🏓', 'paddle-neon': '🏓', 'paddle-lava': '🏓', 'paddle-gold': '🏓',
    'brk-up-lives': '❤️', 'brk-up-power': '⏱️'
  };

  const dom = {
    cards: [], plays: [], scores: [], tabs: [], panels: {},
    shopEntries: [], shopGroups: {}, dayCells: [], missionRows: []
  };
  let initialized = false;
  let walletReady = false;
  let returnFocus = null;
  let openToken = 0;
  let activeTab = 'play';
  let reducedMotion = false;
  let coinShown = 0;
  let coinTarget = 0;
  let coinAnim = null;
  let countdownTimer = null;
  let midnightTimer = null;
  let missionKey = '';
  let previewKey = '';
  let headerBadge = null;
  let headerLabel = '';
  let lastPending = 0;
  let audioCtx = null;
  const busy = new Set();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const wallet = () => (typeof ArcadeWallet !== 'undefined' ? ArcadeWallet : null);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function coinIcon(extra) {
    const c = el('span', `sa-coin${extra ? ' ' + extra : ''}`);
    c.setAttribute('aria-hidden', 'true');
    return c;
  }

  function fmtNum(n) {
    return Math.max(0, Math.floor(n || 0)).toLocaleString();
  }

  function isOpenNow() {
    return !!(dom.modal && dom.modal.classList.contains('active'));
  }

  function isVisible(node) {
    return !!(node && node.getClientRects().length > 0);
  }

  function focusEl(node, scroll) {
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch (e) { try { node.focus(); } catch (e2) { } }
    if (scroll) {
      try { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { }
    }
  }

  function pulseClass(node, cls, ms = 600) {
    if (!node) return;
    node.classList.remove(cls);
    void node.offsetWidth; // restart the animation
    node.classList.add(cls);
    clearTimeout(node._saPulse);
    node._saPulse = setTimeout(() => node.classList.remove(cls), ms);
  }

  function announce(text) {
    if (!dom.live) return;
    dom.live.textContent = '';
    // Separate frame so repeated messages are still read out
    requestAnimationFrame(() => { if (dom.live) dom.live.textContent = text; });
  }

  function msToMidnight() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return Math.max(0, next - now);
  }

  function fmtCountdown(ms) {
    const mins = Math.ceil(ms / 60000);
    if (mins <= 1) return '<1m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function fallbackFocusTarget() {
    const btn = document.getElementById(HEADER_BTN_ID);
    return isVisible(btn) ? btn : null;
  }

  // ---------------------------------------------------------------------------
  // Sound (tiny synthesized blips; shares the games' mute setting)
  // ---------------------------------------------------------------------------
  function sfx(kind) {
    try { if (localStorage.getItem(MUTE_KEY) === 'true') return; } catch (e) { }
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => { });
      const seqs = {
        buy: { type: 'triangle', vol: 0.12, notes: [[660, 0], [880, 0.07], [1320, 0.14]] },
        claim: { type: 'square', vol: 0.06, notes: [[784, 0], [988, 0.06], [1175, 0.12], [1568, 0.18], [2093, 0.26]] },
        equip: { type: 'sine', vol: 0.12, notes: [[520, 0], [780, 0.06]] },
        error: { type: 'square', vol: 0.05, notes: [[196, 0], [147, 0.09]] }
      };
      const seq = seqs[kind];
      if (!seq) return;
      const t0 = audioCtx.currentTime;
      seq.notes.forEach(([f, d]) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = seq.type;
        osc.frequency.setValueAtTime(f, t0 + d);
        gain.gain.setValueAtTime(0.0001, t0 + d);
        gain.gain.exponentialRampToValueAtTime(seq.vol, t0 + d + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.12);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (e) { } };
        osc.start(t0 + d);
        osc.stop(t0 + d + 0.14);
      });
    } catch (e) { }
  }

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------
  function buildDom() {
    const modal = el('div', 'sa-modal');
    modal.id = 'shortcut-arcade-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'sa-title');

    const frame = el('div', 'sa-frame');

    // Header: title, coin balance, close
    const header = el('div', 'sa-header');
    const titleGroup = el('div', 'sa-title-group');
    const badge = el('span', 'sa-icon-badge', '🎮');
    badge.setAttribute('aria-hidden', 'true');
    const title = el('h2', 'sa-title', 'SHORTCUT ARCADE');
    title.id = 'sa-title';
    titleGroup.append(badge, title);

    const right = el('div', 'sa-header-right');
    const coins = el('div', 'sa-coins');
    coins.title = 'Arcade coins';
    const coinVal = el('span', 'sa-coins-val', '0');
    coins.append(coinIcon('sa-coin-lg'), coinVal);
    const closeBtn = el('button', 'sa-close-btn', '✕');
    closeBtn.type = 'button';
    closeBtn.title = 'Close (Esc)';
    closeBtn.setAttribute('aria-label', 'Close arcade');
    right.append(coins, closeBtn);
    header.append(titleGroup, right);

    // Tabs
    const tablist = el('div', 'sa-tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Arcade sections');
    const body = el('div', 'sa-body');

    TABS.forEach(t => {
      const tab = el('button', 'sa-tab');
      tab.type = 'button';
      tab.id = `sa-tab-${t.id}`;
      tab.dataset.tab = t.id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `sa-panel-${t.id}`);
      const ic = el('span', 'sa-tab-icon', t.icon);
      ic.setAttribute('aria-hidden', 'true');
      tab.append(ic, el('span', 'sa-tab-label', t.label));
      if (t.id === 'daily') {
        const dot = el('span', 'sa-tab-dot');
        dot.setAttribute('aria-hidden', 'true');
        dot.hidden = true;
        const sr = el('span', 'sa-sr-only', '');
        tab.append(dot, sr);
        dom.dailyDot = dot;
        dom.dailySr = sr;
      }
      tablist.appendChild(tab);
      dom.tabs.push(tab);

      const panel = el('div', `sa-panel sa-panel-${t.id}`);
      panel.id = `sa-panel-${t.id}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.hidden = true;
      body.appendChild(panel);
      dom.panels[t.id] = panel;
    });

    const footer = el('div', 'sa-footer', FOOTER_HINTS.play);
    const live = el('div', 'sa-sr-only');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');

    frame.append(header, tablist, body, footer, live);
    modal.appendChild(frame);
    document.body.appendChild(modal);

    Object.assign(dom, { modal, frame, closeBtn, coins, coinVal, tablist, body, footer, live });

    buildPlay(dom.panels.play);
    buildDaily(dom.panels.daily);
    buildShop(dom.panels.shop);
  }

  function buildPlay(panel) {
    const cta = el('button', 'sa-play-cta');
    cta.type = 'button';
    cta.hidden = true;
    const ctaIcon = el('span', 'sa-play-cta-icon', '🎁');
    ctaIcon.setAttribute('aria-hidden', 'true');
    const ctaText = el('span', 'sa-play-cta-text', '');
    const ctaArrow = el('span', 'sa-play-cta-arrow', '→');
    ctaArrow.setAttribute('aria-hidden', 'true');
    cta.append(ctaIcon, ctaText, ctaArrow);
    cta.addEventListener('click', () => { setTab('daily'); focusInitial('daily'); });
    dom.playCta = cta;
    dom.playCtaText = ctaText;

    const grid = el('div', 'sa-grid');
    grid.setAttribute('role', 'list');

    GAMES.forEach((game, i) => {
      const card = el('div', `sa-card sa-card-${game.id}`);
      card.setAttribute('role', 'listitem');
      card.dataset.game = game.id;

      const top = el('div', 'sa-card-top');
      const icon = el('span', 'sa-card-icon', game.icon);
      icon.setAttribute('aria-hidden', 'true');
      const key = el('kbd', 'sa-key', game.hotkey);
      key.title = `Press ${game.hotkey}`;
      top.append(icon, key);

      const name = el('h3', 'sa-card-title', game.title);
      name.id = `sa-card-title-${game.id}`;
      const tag = el('div', 'sa-card-tag', game.tag);
      const desc = el('p', 'sa-card-desc', game.desc);

      const foot = el('div', 'sa-card-foot');
      const scoreBox = el('div', 'sa-score');
      scoreBox.appendChild(el('span', 'sa-score-label', 'BEST'));
      const score = el('span', 'sa-score-val', '—');
      scoreBox.appendChild(score);

      const play = el('button', 'sa-play-btn', '▶ Play');
      play.type = 'button';
      play.setAttribute('aria-label', `Play ${game.title} (${game.hotkey})`);
      play.addEventListener('click', (e) => { e.stopPropagation(); pick(i); });

      const shopLink = el('button', 'sa-card-shop', '🛒 Shop');
      shopLink.type = 'button';
      shopLink.setAttribute('aria-label', `${game.title} shop`);
      shopLink.addEventListener('click', (e) => { e.stopPropagation(); showShop(game.id, true); });

      const btns = el('div', 'sa-card-btns');
      btns.append(shopLink, play);
      foot.append(scoreBox, btns);
      card.append(top, name, tag, desc, foot);
      card.addEventListener('click', () => pick(i));

      grid.appendChild(card);
      dom.cards.push(card);
      dom.plays.push(play);
      dom.scores.push(score);
    });

    panel.append(cta, grid);
  }

  function buildDaily(panel) {
    const wl = wallet();
    const rewards = wl ? wl.DAILY_REWARDS : [25, 40, 60, 80, 100, 150, 250];

    const card = el('section', 'sa-daily-card');
    card.setAttribute('aria-labelledby', 'sa-daily-title');
    const head = el('div', 'sa-daily-head');
    const h = el('h3', 'sa-section-title', 'Daily Reward');
    h.id = 'sa-daily-title';
    const streak = el('span', 'sa-streak', '');
    head.append(h, streak);

    const track = el('ol', 'sa-track');
    track.setAttribute('aria-label', '7-day streak rewards');
    rewards.forEach((r, i) => {
      const li = el('li', 'sa-day');
      const label = el('span', 'sa-day-label', i === rewards.length - 1 ? `Day ${i + 1}+` : `Day ${i + 1}`);
      const val = el('span', 'sa-day-val');
      val.append(coinIcon(), el('span', null, String(r)));
      const check = el('span', 'sa-day-check', '✓');
      check.setAttribute('aria-hidden', 'true');
      li.append(label, val, check);
      track.appendChild(li);
      dom.dayCells.push({ li, reward: r });
    });

    const claimBtn = el('button', 'sa-claim-btn');
    claimBtn.type = 'button';
    claimBtn.addEventListener('click', onClaimDaily);
    const note = el('p', 'sa-daily-note', '');
    card.append(head, track, claimBtn, note);

    const missions = el('section', 'sa-missions');
    missions.setAttribute('aria-labelledby', 'sa-missions-title');
    const mhead = el('div', 'sa-daily-head');
    const mh = el('h3', 'sa-section-title', "Today's Missions");
    mh.id = 'sa-missions-title';
    const countdown = el('span', 'sa-countdown', '');
    mhead.append(mh, countdown);
    const list = el('ul', 'sa-mission-list');
    missions.append(mhead, list);

    panel.append(card, missions);
    Object.assign(dom, { dailyCard: card, streak, claimBtn, dailyNote: note, countdown, missionList: list });
  }

  function buildMissionRows(list) {
    dom.missionList.replaceChildren();
    dom.missionRows = list.map(m => {
      const game = GAMES.find(gm => gm.id === m.game);
      const li = el('li', 'sa-mission');
      const icon = el('span', 'sa-mission-icon', game ? game.icon : '⭐');
      icon.setAttribute('aria-hidden', 'true');
      const main = el('div', 'sa-mission-main');
      const label = el('div', 'sa-mission-label', m.label);
      const bar = el('div', 'sa-bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', m.label);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(m.target));
      const fill = el('div', 'sa-bar-fill');
      bar.appendChild(fill);
      const sub = el('div', 'sa-mission-sub', '');
      main.append(label, bar, sub);
      const reward = el('div', 'sa-mission-reward');
      reward.append(coinIcon(), el('span', null, String(m.reward)));
      reward.setAttribute('aria-label', `${m.reward} coins`);
      const btn = el('button', 'sa-mission-btn');
      btn.type = 'button';
      const row = { id: m.id, game: m.game, li, fill, bar, sub, btn };
      btn.addEventListener('click', () => onMissionButton(row));
      li.append(icon, main, reward, btn);
      dom.missionList.appendChild(li);
      return row;
    });
  }

  function buildShop(panel) {
    const wl = wallet();
    const jump = el('div', 'sa-shop-jump');
    jump.setAttribute('aria-label', 'Jump to game');
    jump.setAttribute('role', 'group');
    panel.appendChild(jump);
    dom.shopJump = jump;

    if (!wl) {
      panel.appendChild(el('p', 'sa-empty', 'The shop is unavailable right now.'));
      return;
    }

    SHOP_GROUPS.forEach(group => {
      const sec = el('section', `sa-shop-group sa-shop-${group.game}`);
      sec.id = `sa-shop-${group.game}`;
      const gt = el('h3', 'sa-shop-game-title');
      const gi = el('span', null, group.icon);
      gi.setAttribute('aria-hidden', 'true');
      gt.append(gi, el('span', null, group.title));
      gt.id = `sa-shop-title-${group.game}`;
      sec.setAttribute('aria-labelledby', gt.id);
      sec.appendChild(gt);

      const jb = el('button', `sa-jump-btn sa-jump-${group.game}`);
      jb.type = 'button';
      jb.append(el('span', null, group.icon), el('span', null, group.title.replace('Shortcut ', '')));
      jb.addEventListener('click', () => scrollToGroup(group.game, true));
      jump.appendChild(jb);

      group.sections.forEach(s => {
        const items = wl.CATALOG.filter(it => it.game === group.game && s.match(it));
        if (!items.length) return;
        sec.appendChild(el('h4', 'sa-shop-sec-title', s.title));
        const grid = el('div', 'sa-shop-grid');
        items.forEach(item => grid.appendChild(buildItemCard(item)));
        sec.appendChild(grid);
      });
      panel.appendChild(sec);
      dom.shopGroups[group.game] = sec;
    });
  }

  function buildItemCard(item) {
    const card = el('div', `sa-item sa-item-${item.type}`);
    card.dataset.id = item.id;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', item.name);

    const preview = el('div', 'sa-item-preview');
    const canvas = el('canvas', 'sa-item-canvas');
    canvas.width = 240;
    canvas.height = 112;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.hidden = true;
    const emoji = el('span', 'sa-item-emoji', ITEM_EMOJI[item.id] || '⭐');
    emoji.setAttribute('aria-hidden', 'true');
    const tagEl = el('span', 'sa-item-tag', '');
    tagEl.hidden = true;
    preview.append(canvas, emoji, tagEl);

    const name = el('div', 'sa-item-name', item.name);
    const desc = el('div', 'sa-item-desc', item.desc || '');
    const meta = el('div', 'sa-item-meta');
    let pips = [];
    if (item.type === 'upgrade') {
      const pipWrap = el('span', 'sa-pips');
      pipWrap.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < item.values.length - 1; i++) {
        const p = el('span', 'sa-pip');
        pipWrap.appendChild(p);
        pips.push(p);
      }
      meta.appendChild(pipWrap);
    }
    const metaText = el('span', 'sa-item-meta-text', '');
    meta.appendChild(metaText);

    const btn = el('button', 'sa-item-btn');
    btn.type = 'button';

    card.append(preview, name, desc, meta, btn);
    const entry = { item, card, canvas, emoji, tagEl, btn, pips, metaText, state: '', short: 0 };
    btn.addEventListener('click', () => onShopAction(entry));
    dom.shopEntries.push(entry);
    return card;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function paintCoins() {
    if (!dom.coinVal) return;
    dom.coinVal.textContent = fmtNum(coinShown);
    dom.coins.setAttribute('aria-label', `${fmtNum(coinTarget)} coins`);
  }

  function setCoins(value, animate) {
    coinTarget = Math.max(0, Math.floor(value || 0));
    if (coinAnim) { cancelAnimationFrame(coinAnim); coinAnim = null; }
    if (!animate || reducedMotion || !isOpenNow() || coinShown === coinTarget) {
      coinShown = coinTarget;
      paintCoins();
      return;
    }
    const from = coinShown;
    const to = coinTarget;
    const start = performance.now();
    const dur = Math.min(1000, 350 + Math.abs(to - from) * 3);
    pulseClass(dom.coins, to > from ? 'sa-coins-up' : 'sa-coins-down', dur + 250);
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      coinShown = Math.round(from + (to - from) * eased);
      paintCoins();
      coinAnim = t < 1 ? requestAnimationFrame(step) : null;
    };
    coinAnim = requestAnimationFrame(step);
  }

  function pendingCount() {
    const wl = wallet();
    if (!wl || !walletReady) return 0;
    try { return wl.getPendingCount(); } catch (e) { return 0; }
  }

  function updateBadge() {
    const n = pendingCount();
    const btn = document.getElementById(HEADER_BTN_ID);
    if (btn) {
      if (!headerBadge || !btn.contains(headerBadge)) {
        headerLabel = btn.getAttribute('aria-label') || 'Open Arcade games';
        headerBadge = el('span', 'sa-notif-badge');
        headerBadge.setAttribute('aria-hidden', 'true');
        headerBadge.hidden = true;
        btn.classList.add('sa-badge-host');
        btn.appendChild(headerBadge);
      }
      headerBadge.hidden = n <= 0;
      headerBadge.textContent = n > 9 ? '9+' : String(n);
      if (n > lastPending && n > 0 && !reducedMotion) pulseClass(headerBadge, 'sa-pop', 500);
      btn.setAttribute('aria-label', n > 0 ? `${headerLabel} (${n} reward${n === 1 ? '' : 's'} waiting)` : headerLabel);
    }
    lastPending = n;
    if (dom.dailyDot) {
      dom.dailyDot.hidden = n <= 0;
      dom.dailySr.textContent = n > 0 ? ` (${n} waiting)` : '';
    }
    if (dom.playCta) {
      dom.playCta.hidden = n <= 0;
      dom.playCtaText.textContent = n === 1 ? '1 reward waiting — open Daily' : `${n} rewards waiting — open Daily`;
    }
  }

  function renderDaily() {
    const wl = wallet();
    if (!wl || !dom.claimBtn) return;
    const st = wl.getDailyStatus();
    const day = st.claimedToday ? Math.max(1, st.streak) : st.nextStreak;
    const todayIdx = Math.min(day, dom.dayCells.length) - 1;

    dom.dayCells.forEach(({ li, reward }, i) => {
      const claimed = i < todayIdx || (i === todayIdx && st.claimedToday);
      const today = i === todayIdx;
      li.classList.toggle('sa-day-claimed', claimed);
      li.classList.toggle('sa-day-today', today);
      li.classList.toggle('sa-day-ready', today && !st.claimedToday);
      li.setAttribute('aria-label', `Day ${i + 1}${i === dom.dayCells.length - 1 ? ' and later' : ''}: ${reward} coins` +
        (claimed ? ', claimed' : today ? ', today' : ''));
      if (today) li.setAttribute('aria-current', 'date'); else li.removeAttribute('aria-current');
    });

    if (st.claimedToday) {
      dom.streak.textContent = `🔥 ${st.streak}-day streak`;
    } else if (st.streak > 0) {
      dom.streak.textContent = `🔥 ${st.streak}-day streak · keep it alive!`;
    } else {
      dom.streak.textContent = 'Start a streak today';
    }

    dom.claimBtn.replaceChildren();
    if (st.claimedToday) {
      dom.claimBtn.disabled = true;
      dom.claimBtn.classList.remove('sa-ready');
      dom.claimBtn.append(el('span', null, '✓ Claimed today'));
      const nextReward = wl.DAILY_REWARDS[Math.min(st.streak + 1, wl.DAILY_REWARDS.length) - 1];
      dom.dailyNote.textContent = `Come back tomorrow for Day ${st.streak + 1}: ${nextReward} coins (in ${fmtCountdown(msToMidnight())})`;
      dom.claimBtn.setAttribute('aria-label', 'Daily reward already claimed today');
    } else {
      dom.claimBtn.disabled = false;
      dom.claimBtn.classList.add('sa-ready');
      dom.claimBtn.append(el('span', null, 'Claim'), coinIcon('sa-coin-lg'), el('span', 'sa-claim-amt', String(st.reward)));
      dom.claimBtn.setAttribute('aria-label', `Claim daily reward: ${st.reward} coins`);
      dom.dailyNote.textContent = st.nextStreak > 1
        ? `Day ${st.nextStreak} of your streak — don't break the chain!`
        : `Claim every day to build a streak — up to ${wl.DAILY_REWARDS[wl.DAILY_REWARDS.length - 1]} coins a day.`;
    }

    renderMissions();
    updateCountdown();
  }

  function renderMissions() {
    const wl = wallet();
    if (!wl) return;
    const list = wl.getMissions();
    const key = list.map(m => m.id).join('|');
    if (key !== missionKey) {
      missionKey = key;
      buildMissionRows(list);
    }
    dom.missionRows.forEach((row, i) => {
      const m = list[i];
      if (!m) return;
      const prog = Math.min(m.progress, m.target);
      const done = prog >= m.target;
      row.fill.style.width = `${Math.round((prog / m.target) * 100)}%`;
      row.bar.setAttribute('aria-valuenow', String(prog));
      row.sub.textContent = m.claimed ? 'Reward collected' : done ? 'Complete! Claim your reward' : `${fmtNum(prog)} / ${fmtNum(m.target)}`;
      row.li.classList.toggle('sa-mission-done', done && !m.claimed);
      row.li.classList.toggle('sa-mission-claimed', m.claimed);
      row.btn.classList.toggle('sa-ready', done && !m.claimed);
      row.reward = m.reward;
      row.btn.removeAttribute('title');
      if (m.claimed) {
        row.state = 'claimed';
        row.btn.textContent = '✓';
        row.btn.disabled = true;
        row.btn.setAttribute('aria-label', 'Claimed');
      } else if (done) {
        row.state = 'claim';
        row.btn.textContent = 'Claim';
        row.btn.disabled = false;
        row.btn.setAttribute('aria-label', `Claim ${m.reward} coins for: ${m.label}`);
      } else {
        const game = GAMES.find(gm => gm.id === m.game);
        row.state = 'play';
        row.btn.textContent = '▶';
        row.btn.disabled = !(game && game.available());
        row.btn.setAttribute('aria-label', `Play ${game ? game.title : 'game'}`);
        row.btn.title = `Play ${game ? game.title : 'game'}`;
      }
    });
  }

  function updateCountdown() {
    if (!dom.countdown) return;
    dom.countdown.textContent = `New missions in ${fmtCountdown(msToMidnight())}`;
  }

  function fmtUpgradeVal(item, v) {
    if (item.unit === 's') return `${v}s`;
    if (item.id === 'brk-up-lives') return `+${v} ${v === 1 ? 'life' : 'lives'}`;
    return `${v}${item.unit || ''}`;
  }

  function setBuyContent(entry, verb, price, coins) {
    const { btn, item } = entry;
    const short = Math.max(0, price - coins);
    entry.short = short;
    btn.replaceChildren();
    if (short > 0) {
      entry.state = 'short';
      btn.classList.add('sa-short');
      btn.setAttribute('aria-disabled', 'true');
      const top = el('span', 'sa-btn-price');
      top.append(coinIcon(), el('span', null, fmtNum(price)));
      btn.append(top, el('span', 'sa-btn-need', `Need ${fmtNum(short)} more`));
      btn.setAttribute('aria-label', `${verb} ${item.name} for ${price} coins. Need ${short} more coins`);
    } else {
      entry.state = 'buy';
      btn.classList.add('sa-buy');
      btn.append(el('span', null, verb), coinIcon(), el('span', null, fmtNum(price)));
      btn.setAttribute('aria-label', `${verb} ${item.name} for ${price} coins`);
    }
  }

  function updateShopEntry(entry, coins) {
    const wl = wallet();
    const { item, btn, card } = entry;
    btn.classList.remove('sa-short', 'sa-buy', 'sa-equip', 'sa-equipped', 'sa-max');
    btn.removeAttribute('aria-disabled');
    btn.removeAttribute('aria-pressed');
    entry.tagEl.hidden = true;
    card.classList.remove('sa-item-owned', 'sa-item-equipped');

    if (item.type === 'upgrade') {
      const lvl = wl.getLevel(item.id);
      const max = item.values.length - 1;
      entry.pips.forEach((p, i) => p.classList.toggle('sa-on', i < lvl));
      const cur = item.values[Math.min(lvl, max)];
      if (lvl >= max) {
        entry.metaText.textContent = `${fmtUpgradeVal(item, cur)} · Level ${lvl}/${max}`;
        entry.state = 'max';
        btn.classList.add('sa-max');
        btn.setAttribute('aria-disabled', 'true');
        btn.replaceChildren(el('span', null, 'MAX'));
        btn.setAttribute('aria-label', `${item.name} is fully upgraded`);
      } else {
        entry.metaText.textContent = `${fmtUpgradeVal(item, cur)} → ${fmtUpgradeVal(item, item.values[lvl + 1])}`;
        setBuyContent(entry, 'Upgrade', wl.getPrice(item.id) || 0, coins);
      }
      card.setAttribute('aria-label', `${item.name}, level ${lvl} of ${max}`);
      return;
    }

    if (item.type === 'consumable') {
      const count = wl.getConsumableCount(item.id);
      entry.metaText.textContent = count > 0 ? `Owned ×${count}` : 'None owned';
      if (count > 0) { entry.tagEl.hidden = false; entry.tagEl.textContent = `×${count}`; }
      if (count >= 99) {
        entry.state = 'max';
        btn.classList.add('sa-max');
        btn.setAttribute('aria-disabled', 'true');
        btn.replaceChildren(el('span', null, 'MAX'));
      } else {
        setBuyContent(entry, 'Buy', item.price, coins);
      }
      return;
    }

    // Cosmetics (skin / trail / paddle)
    const owned = wl.isOwned(item.id);
    const equipped = owned && item.slot && wl.getEquipped(item.slot) === item.id;
    if (owned) card.classList.add('sa-item-owned');
    if (equipped) {
      card.classList.add('sa-item-equipped');
      entry.state = 'equipped';
      btn.classList.add('sa-equipped');
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('aria-pressed', 'true');
      btn.replaceChildren(el('span', null, '✓ Equipped'));
      btn.setAttribute('aria-label', `${item.name} equipped`);
      entry.metaText.textContent = 'In use';
    } else if (owned) {
      entry.state = 'equip';
      btn.classList.add('sa-equip');
      btn.setAttribute('aria-pressed', 'false');
      btn.replaceChildren(el('span', null, 'Equip'));
      btn.setAttribute('aria-label', `Equip ${item.name}`);
      entry.metaText.textContent = 'Owned';
    } else {
      entry.metaText.textContent = '';
      setBuyContent(entry, 'Buy', item.price, coins);
    }
  }

  function refreshShop() {
    const wl = wallet();
    if (!wl || !dom.shopEntries.length) return;
    const coins = wl.getCoins();
    dom.shopEntries.forEach(entry => updateShopEntry(entry, coins));
    if (activeTab === 'shop' && isOpenNow()) renderPreviews(false);
  }

  function sizeCanvas(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const w = Math.max(1, Math.round((r.width || 120) * dpr));
    const h = Math.max(1, Math.round((r.height || 56) * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  // Draws item previews (runner skins/trails via ShortcutRunner, paddles via ShortcutBreaker, emoji otherwise)
  function renderPreviews(force) {
    const wl = wallet();
    if (!wl) return;
    const skin = wl.getEquipped('runnerSkin');
    const trail = wl.getEquipped('runnerTrail');
    const key = `${skin}|${trail}`;
    if (!force && key === previewKey) return;
    previewKey = key;
    const runnerFn = typeof ShortcutRunner !== 'undefined' && typeof ShortcutRunner.renderSkinPreview === 'function'
      ? ShortcutRunner.renderSkinPreview.bind(ShortcutRunner) : null;
    const paddleFn = typeof ShortcutBreaker !== 'undefined' && typeof ShortcutBreaker.renderPaddlePreview === 'function'
      ? ShortcutBreaker.renderPaddlePreview : null;

    dom.shopEntries.forEach(entry => {
      const { item, canvas, emoji } = entry;
      let drawn = false;
      const draw = (fn) => {
        canvas.hidden = false;
        sizeCanvas(canvas);
        try { fn(); drawn = true; } catch (e) { drawn = false; }
      };
      if (runnerFn && item.type === 'skin') draw(() => runnerFn(canvas, item.id, trail));
      else if (runnerFn && item.type === 'trail') draw(() => runnerFn(canvas, skin, item.id));
      else if (paddleFn && item.type === 'paddle') draw(() => paddleFn(canvas, item.id));
      canvas.hidden = !drawn;
      emoji.hidden = drawn;
    });
  }

  function renderAll() {
    const wl = wallet();
    if (!wl) return;
    setCoins(wl.getCoins(), isOpenNow());
    updateBadge();
    if (!isOpenNow()) return;
    renderDaily();
    refreshShop();
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  async function onShopAction(entry) {
    const wl = wallet();
    const { item, card, btn } = entry;
    if (!wl || busy.has(item.id)) return;
    if (entry.state === 'equipped' || entry.state === 'max') {
      pulseClass(card, 'sa-nudge', 400);
      return;
    }
    if (entry.state === 'short') {
      pulseClass(card, 'sa-shake', 500);
      sfx('error');
      announce(`Not enough coins. You need ${entry.short} more for ${item.name}.`);
      return;
    }
    busy.add(item.id);
    btn.classList.add('sa-busy');
    try {
      if (entry.state === 'equip') {
        const ok = await wl.equip(item.id);
        if (ok) {
          pulseClass(card, 'sa-flash', 700);
          sfx('equip');
          announce(`${item.name} equipped.`);
        }
        return;
      }
      const res = await wl.buy(item.id);
      if (res && res.ok) {
        pulseClass(card, 'sa-flash', 700);
        sfx('buy');
        if (item.type === 'upgrade') announce(`${item.name} upgraded to level ${wl.getLevel(item.id)}.`);
        else if (item.type === 'consumable') announce(`Bought ${item.name}. You have ${wl.getConsumableCount(item.id)}.`);
        else announce(`Bought and equipped ${item.name}.`);
      } else {
        pulseClass(card, 'sa-shake', 500);
        sfx('error');
        const reason = res && res.reason;
        announce(reason === 'funds' ? `Not enough coins for ${item.name}.`
          : reason === 'maxed' ? `${item.name} is maxed out.`
            : reason === 'owned' ? `You already own ${item.name}.` : 'Purchase failed.');
      }
    } catch (e) {
      pulseClass(card, 'sa-shake', 500);
      sfx('error');
      announce('Purchase failed. Please try again.');
    } finally {
      busy.delete(item.id);
      btn.classList.remove('sa-busy');
      refreshShop();
    }
  }

  async function onClaimDaily() {
    const wl = wallet();
    if (!wl || busy.has('daily') || dom.claimBtn.disabled) return;
    busy.add('daily');
    try {
      const res = await wl.claimDaily();
      if (res && res.ok) {
        sfx('claim');
        coinBurst(dom.claimBtn, dom.dailyCard, 18);
        pulseClass(dom.dailyCard, 'sa-flash', 700);
        announce(`Claimed ${res.reward} coins! ${res.streak}-day streak.`);
      }
    } catch (e) {
      announce('Could not claim the reward. Please try again.');
    } finally {
      busy.delete('daily');
      renderAll();
      if (document.activeElement === dom.claimBtn || !dom.modal.contains(document.activeElement)) focusAfterClaim();
    }
  }

  async function onMissionButton(row) {
    const wl = wallet();
    if (!wl) return;
    if (row.state === 'play') {
      const idx = GAMES.findIndex(gm => gm.id === row.game);
      if (idx >= 0) pick(idx);
      return;
    }
    if (row.state !== 'claim' || busy.has(row.id)) return;
    busy.add(row.id);
    try {
      const res = await wl.claimMission(row.id);
      if (res && res.ok) {
        sfx('claim');
        coinBurst(row.btn, row.li, 10);
        pulseClass(row.li, 'sa-flash', 700);
        announce(`Mission reward: ${res.reward} coins!`);
      }
    } catch (e) {
      announce('Could not claim the mission. Please try again.');
    } finally {
      busy.delete(row.id);
      renderAll();
      if (row.btn.disabled && (document.activeElement === row.btn || !dom.modal.contains(document.activeElement))) focusAfterClaim();
    }
  }

  function focusAfterClaim() {
    const next = dom.missionRows.map(r => r.btn).find(b => b.classList.contains('sa-ready') && !b.disabled);
    focusEl(next || (!dom.claimBtn.disabled ? dom.claimBtn : dom.tabs[1]), true);
  }

  function coinBurst(anchor, host, count) {
    pulseClass(dom.coins, 'sa-coins-pop', 700);
    if (reducedMotion || !anchor || !host) return;
    const hr = host.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const cx = ar.left - hr.left + ar.width / 2;
    const cy = ar.top - hr.top + ar.height / 2;
    for (let i = 0; i < count; i++) {
      const c = el('span', 'sa-burst-coin');
      c.setAttribute('aria-hidden', 'true');
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const dist = 50 + Math.random() * 60;
      c.style.left = `${cx}px`;
      c.style.top = `${cy}px`;
      c.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
      c.style.setProperty('--dy', `${Math.sin(a) * dist - 30}px`);
      c.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 720)}deg`);
      c.style.animationDelay = `${Math.round(Math.random() * 80)}ms`;
      host.appendChild(c);
      setTimeout(() => c.remove(), 1100);
    }
  }

  // ---------------------------------------------------------------------------
  // Tabs / focus
  // ---------------------------------------------------------------------------
  function setTab(id) {
    if (!dom.panels[id]) id = 'play';
    activeTab = id;
    dom.tabs.forEach(t => {
      const sel = t.dataset.tab === id;
      t.setAttribute('aria-selected', String(sel));
      t.tabIndex = sel ? 0 : -1;
      t.classList.toggle('sa-tab-active', sel);
    });
    Object.keys(dom.panels).forEach(k => { dom.panels[k].hidden = k !== id; });
    dom.frame.dataset.tab = id;
    dom.footer.textContent = FOOTER_HINTS[id] || '';
    dom.body.scrollTop = 0;
    if (id === 'shop') renderPreviews(true);
    if (id === 'daily') { renderDaily(); startCountdown(); } else stopCountdown();
  }

  function switchTab(dir) {
    const idx = TABS.findIndex(t => t.id === activeTab);
    const next = TABS[(idx + dir + TABS.length) % TABS.length].id;
    setTab(next);
    focusEl(dom.tabs.find(t => t.dataset.tab === next));
  }

  function focusInitial(tab, game) {
    if (tab === 'play') {
      const idx = lastIndex();
      focusEl(dom.plays[idx] && !dom.plays[idx].disabled ? dom.plays[idx] : dom.plays.find(b => !b.disabled) || dom.closeBtn);
    } else if (tab === 'daily') {
      if (!dom.claimBtn.disabled) { focusEl(dom.claimBtn); return; }
      const ready = dom.missionRows.map(r => r.btn).find(b => b.classList.contains('sa-ready'));
      focusEl(ready || dom.tabs[1]);
    } else if (tab === 'shop') {
      const group = game && dom.shopGroups[game];
      const first = group ? group.querySelector('.sa-item-btn') : null;
      focusEl(first || dom.tabs[2]);
    }
  }

  function scrollToGroup(game, smooth) {
    const group = dom.shopGroups[game];
    if (!group || !dom.body) return;
    const bar = dom.shopJump ? dom.shopJump.offsetHeight : 0;
    const top = Math.max(0, group.offsetTop - bar - 4);
    try {
      dom.body.scrollTo({ top, behavior: smooth && !reducedMotion ? 'smooth' : 'auto' });
    } catch (e) {
      dom.body.scrollTop = top;
    }
  }

  function showShop(game, focus) {
    setTab('shop');
    if (game) scrollToGroup(game, false);
    if (focus) focusInitial('shop', game);
  }

  function startCountdown() {
    stopCountdown();
    countdownTimer = setInterval(() => {
      if (!isOpenNow()) { stopCountdown(); return; }
      updateCountdown();
    }, 20000);
  }

  function stopCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
  }

  // Midnight rolls over the daily reward + missions: refresh the badge / hub then
  function scheduleMidnight() {
    clearTimeout(midnightTimer);
    midnightTimer = setTimeout(() => {
      const wl = wallet();
      if (wl) wl.load().catch(() => { }).then(() => { missionKey = ''; renderAll(); });
      scheduleMidnight();
    }, Math.min(msToMidnight() + 1500, 6 * 3600 * 1000));
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  function bindEvents() {
    dom.closeBtn.addEventListener('click', () => close());
    dom.modal.addEventListener('click', (e) => {
      if (e.target === dom.modal) close();
    });
    dom.tabs.forEach(t => t.addEventListener('click', () => {
      setTab(t.dataset.tab);
      focusEl(t);
    }));
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', () => { if (isOpenNow() && activeTab === 'shop') renderPreviews(true); });
    document.addEventListener('visibilitychange', () => {
      const wl = wallet();
      if (!document.hidden && wl && walletReady) {
        wl.load().catch(() => { }); // pick up coins earned in other tabs
        scheduleMidnight();
      }
    });
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotion = mq.matches;
      const onChange = (ev) => { reducedMotion = ev.matches; };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (e) { }
  }

  function panelFocusables() {
    const panel = dom.panels[activeTab];
    return panel ? Array.from(panel.querySelectorAll('button')).filter(b => !b.disabled && isVisible(b)) : [];
  }

  function onKeyDown(e) {
    if (!isOpenNow()) return;
    e.stopPropagation();
    const code = e.code;
    const active = document.activeElement;

    if (e.key === 'Tab' && e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      switchTab(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (code === 'Escape') {
      e.preventDefault();
      close();
      return;
    }

    if (e.key === 'Tab') {
      const items = Array.from(dom.modal.querySelectorAll('button'))
        .filter(b => !b.disabled && b.tabIndex >= 0 && isVisible(b));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!dom.modal.contains(active) || active === dom.modal) {
        e.preventDefault();
        focusEl(e.shiftKey ? last : first);
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        focusEl(last, true);
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        focusEl(first, true);
      }
      return;
    }

    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      e.preventDefault();
      if (!e.repeat || dom.tabs.includes(active)) switchTab(code === 'ArrowLeft' ? -1 : 1);
      return;
    }

    if (code === 'ArrowUp' || code === 'ArrowDown' || code === 'Home' || code === 'End') {
      const items = panelFocusables();
      if (!items.length) return;
      e.preventDefault();
      const cur = items.indexOf(active);
      let next;
      if (code === 'Home') next = 0;
      else if (code === 'End') next = items.length - 1;
      else if (cur < 0) next = code === 'ArrowUp' ? items.length - 1 : 0;
      else {
        next = cur + (code === 'ArrowUp' ? -1 : 1);
        if (next < 0) { focusEl(dom.tabs.find(t => t.dataset.tab === activeTab)); return; }
        next = Math.min(items.length - 1, next);
      }
      focusEl(items[next], true);
      return;
    }

    if (activeTab === 'play') {
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (digit) {
        const idx = parseInt(digit[1], 10) - 1;
        if (idx < GAMES.length) {
          e.preventDefault();
          e.stopImmediatePropagation(); // The launched game must not see this same key
          if (!e.repeat) pick(idx);
        }
        return;
      }
      if ((code === 'Enter' || code === 'NumpadEnter') && !(active && active.tagName === 'BUTTON' && dom.modal.contains(active))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pick(lastIndex());
      }
    }
  }

  function lastIndex() {
    try {
      const id = localStorage.getItem(LAST_KEY);
      const idx = GAMES.findIndex(g => g.id === id);
      return idx >= 0 ? idx : 0;
    } catch (e) {
      return 0;
    }
  }

  function pick(i) {
    const game = GAMES[i];
    if (!game || !game.available()) return;
    try { localStorage.setItem(LAST_KEY, game.id); } catch (e) { }
    const rf = returnFocus || fallbackFocusTarget();
    close(false);
    try {
      game.launch({ returnFocus: rf });
    } catch (e) {
      console.warn('[Arcade] Failed to launch game:', e);
    }
  }

  async function refreshScores(token) {
    await Promise.all(GAMES.map(async (game, i) => {
      let text = '—';
      if (game.available()) {
        try {
          const v = await game.getScore();
          text = String(typeof v === 'number' && isFinite(v) ? v : 0);
        } catch (e) {
          text = '0';
        }
      }
      if (token === openToken) dom.scores[i].textContent = text;
    }));
  }

  function onWalletChange() {
    walletReady = true;
    renderAll();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function init() {
    if (initialized || !document.body) return;
    buildDom();
    bindEvents();
    initialized = true;
    setTab('play');
    const wl = wallet();
    if (wl) {
      wl.onChange(onWalletChange);
      wl.load()
        .then(() => { walletReady = true; renderAll(); scheduleMidnight(); })
        .catch(err => console.warn('[Arcade] Wallet failed to load:', err));
    }
  }

  function closeRunningGames() {
    try { if (typeof ShortcutRunner !== 'undefined' && ShortcutRunner.isOpen) ShortcutRunner.close(); } catch (e) { }
    try { if (typeof ShortcutBreaker !== 'undefined' && ShortcutBreaker.isOpen) ShortcutBreaker.close(); } catch (e) { }
  }

  function openHub(tab, game) {
    init();
    if (!initialized) return;
    const wasOpen = isOpenNow();
    if (!wasOpen) {
      const active = document.activeElement;
      const usable = active && active !== document.body && !dom.modal.contains(active) && isVisible(active);
      returnFocus = usable ? active : fallbackFocusTarget();
      const token = ++openToken;
      GAMES.forEach((g, i) => {
        const ok = g.available();
        dom.plays[i].disabled = !ok;
        dom.cards[i].classList.toggle('sa-disabled', !ok);
        dom.plays[i].textContent = ok ? '▶ Play' : 'Unavailable';
        dom.scores[i].textContent = '…';
      });
      dom.modal.classList.add('active');
      refreshScores(token);
    }
    const wl = wallet();
    if (wl) {
      setCoins(wl.getCoins(), false);
      renderDaily();
      refreshShop();
      updateBadge();
    }
    setTab(tab);
    if (tab === 'shop' && game) scrollToGroup(game, false);
    focusInitial(tab, game);
    // Fresh read (coins from other tabs / a game that just deposited); the change listener re-renders
    if (wl) wl.load().catch(() => { });
  }

  function open() {
    // Do not stack the picker on top of a running game
    if ((typeof ShortcutRunner !== 'undefined' && ShortcutRunner.isOpen) ||
      (typeof ShortcutBreaker !== 'undefined' && ShortcutBreaker.isOpen)) return;
    openHub('play');
  }

  function openShop(game) {
    closeRunningGames();
    openHub('shop', game === 'runner' || game === 'breaker' ? game : null);
  }

  function openDaily() {
    closeRunningGames();
    openHub('daily');
  }

  function close(restoreFocus = true) {
    if (!isOpenNow()) return;
    openToken++;
    stopCountdown();
    dom.modal.classList.remove('active');
    if (coinAnim) { cancelAnimationFrame(coinAnim); coinAnim = null; coinShown = coinTarget; paintCoins(); }
    if (audioCtx && audioCtx.state === 'running') audioCtx.suspend().catch(() => { });
    const target = returnFocus;
    returnFocus = null;
    if (!restoreFocus) return;
    const dest = target && document.contains(target) && isVisible(target) ? target : fallbackFocusTarget();
    if (dest && typeof dest.focus === 'function') focusEl(dest);
  }

  function isAnyGameOpen() {
    return isOpenNow() ||
      (typeof ShortcutRunner !== 'undefined' && !!ShortcutRunner.isOpen) ||
      (typeof ShortcutBreaker !== 'undefined' && !!ShortcutBreaker.isOpen);
  }

  return {
    init,
    open,
    openShop,
    openDaily,
    close: () => close(true),
    get isOpen() { return isOpenNow(); },
    isAnyGameOpen,
    refreshBadge: updateBadge
  };
})();
