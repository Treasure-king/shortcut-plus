/* wallet.js - Shared Arcade economy: coin wallet, shop catalog, upgrades, daily reward streak & daily missions */

const ArcadeWallet = (() => {
  const STORAGE_KEY = 'shortcut_plus_arcade_wallet';

  // Upgrade prices per level (level 1..5); effect values per level (level 0 = base)
  const UPGRADE_PRICES = [100, 250, 500, 900, 1500];

  /*
   * Shop catalog. type:
   *  - 'skin' / 'trail' / 'paddle': cosmetic, bought once, equipped into `slot`
   *  - 'upgrade': levels 0..maxLevel, `values[level]` is the effect (seconds, count, ...)
   *  - 'consumable': stackable count, used up by the game
   */
  const CATALOG = [
    // Runner characters
    { id: 'skin-classic', game: 'runner', type: 'skin', slot: 'runnerSkin', name: 'Pixel Pal', price: 0, desc: 'The original shortcut runner.' },
    { id: 'skin-ninja', game: 'runner', type: 'skin', slot: 'runnerSkin', name: 'Shadow Ninja', price: 150, desc: 'Silent, swift, scarf included.' },
    { id: 'skin-robot', game: 'runner', type: 'skin', slot: 'runnerSkin', name: 'Bolt Bot', price: 300, desc: 'Chrome plating and a blinking antenna.' },
    { id: 'skin-cat', game: 'runner', type: 'skin', slot: 'runnerSkin', name: 'Byte Cat', price: 400, desc: 'Lands on its feet. Usually.' },
    { id: 'skin-astronaut', game: 'runner', type: 'skin', slot: 'runnerSkin', name: 'Astro Dash', price: 600, desc: 'One small step, many big jumps.' },
    { id: 'skin-golden', game: 'runner', type: 'skin', slot: 'runnerSkin', name: 'Golden Legend', price: 2000, desc: 'Pure flex. Sparkles as it runs.' },

    // Runner trails
    { id: 'trail-none', game: 'runner', type: 'trail', slot: 'runnerTrail', name: 'No Trail', price: 0, desc: 'Clean and simple.' },
    { id: 'trail-sparkle', game: 'runner', type: 'trail', slot: 'runnerTrail', name: 'Sparkle', price: 200, desc: 'Leaves a shimmer of stars.' },
    { id: 'trail-fire', game: 'runner', type: 'trail', slot: 'runnerTrail', name: 'Afterburn', price: 400, desc: 'Run so fast the air ignites.' },
    { id: 'trail-rainbow', game: 'runner', type: 'trail', slot: 'runnerTrail', name: 'Rainbow', price: 700, desc: 'A streak of every color.' },

    // Runner power-up upgrades (longer-lasting power-ups)
    { id: 'up-magnet', game: 'runner', type: 'upgrade', name: 'Coin Magnet', unit: 's', values: [6, 8, 10, 12, 14, 16], desc: 'Pulls nearby coins to you.' },
    { id: 'up-shield', game: 'runner', type: 'upgrade', name: 'Shield', unit: 's', values: [5, 6.5, 8, 9.5, 11, 13], desc: 'Smash through obstacles unharmed.' },
    { id: 'up-double', game: 'runner', type: 'upgrade', name: 'Double Coins', unit: 's', values: [8, 10, 12, 14, 17, 20], desc: 'Every coin counts twice.' },
    { id: 'up-jetpack', game: 'runner', type: 'upgrade', name: 'Jetpack', unit: 's', values: [4, 5, 6, 7, 8, 10], desc: 'Fly above everything and grab sky coins.' },
    { id: 'up-slowmo', game: 'runner', type: 'upgrade', name: 'Espresso Slow-Mo', unit: 's', values: [4, 5, 6, 7, 8, 9], desc: 'Time slows down, reflexes speed up.' },

    // Runner consumables
    { id: 'boost-headstart', game: 'runner', type: 'consumable', name: 'Head Start', price: 75, desc: 'Begin the run with a jetpack burst.' },
    { id: 'item-revive', game: 'runner', type: 'consumable', name: 'Second Chance', price: 150, desc: 'Keep running once after a crash.' },

    // Breaker paddles & upgrades
    { id: 'paddle-classic', game: 'breaker', type: 'paddle', slot: 'breakerPaddle', name: 'Classic Paddle', price: 0, desc: 'Reliable blue steel.' },
    { id: 'paddle-neon', game: 'breaker', type: 'paddle', slot: 'breakerPaddle', name: 'Neon Pulse', price: 200, desc: 'Glows with every hit.' },
    { id: 'paddle-lava', game: 'breaker', type: 'paddle', slot: 'breakerPaddle', name: 'Lava Bar', price: 450, desc: 'Molten and menacing.' },
    { id: 'paddle-gold', game: 'breaker', type: 'paddle', slot: 'breakerPaddle', name: 'Gold Bar', price: 1200, desc: 'Literally a gold bar.' },
    { id: 'brk-up-lives', game: 'breaker', type: 'upgrade', name: 'Extra Lives', unit: '', values: [0, 1, 2], desc: 'Start every game with more lives.' },
    { id: 'brk-up-power', game: 'breaker', type: 'upgrade', name: 'Power-Up Duration', unit: 's', values: [10, 12, 14, 16, 18, 20], desc: 'Power-ups last longer.' }
  ];

  const DEFAULT_EQUIPPED = { runnerSkin: 'skin-classic', runnerTrail: 'trail-none', breakerPaddle: 'paddle-classic' };

  // Daily login reward by streak day (day 7+ repeats the top reward)
  const DAILY_REWARDS = [25, 40, 60, 80, 100, 150, 250];

  // Daily mission templates. mode 'add' accumulates, 'max' tracks a best single value.
  const MISSION_TEMPLATES = [
    { id: 'runner-coins', game: 'runner', event: 'runner_coins', mode: 'add', targets: [40, 80, 150], label: n => `Collect ${n} coins in Runner` },
    { id: 'runner-distance', game: 'runner', event: 'runner_distance', mode: 'max', targets: [400, 800, 1500], label: n => `Run ${n} m in a single Runner game` },
    { id: 'runner-powerups', game: 'runner', event: 'runner_powerups', mode: 'add', targets: [3, 6, 10], label: n => `Use ${n} power-ups in Runner` },
    { id: 'runner-games', game: 'runner', event: 'runner_games', mode: 'add', targets: [3, 5], label: n => `Play ${n} Runner games` },
    { id: 'runner-closecalls', game: 'runner', event: 'runner_closecalls', mode: 'add', targets: [5, 12], label: n => `Pull off ${n} close calls in Runner` },
    { id: 'breaker-bricks', game: 'breaker', event: 'breaker_bricks', mode: 'add', targets: [60, 150, 300], label: n => `Break ${n} bricks in Breaker` },
    { id: 'breaker-levels', game: 'breaker', event: 'breaker_levels', mode: 'add', targets: [1, 3], label: n => `Clear ${n} Breaker level${n > 1 ? 's' : ''}` },
    { id: 'breaker-powerups', game: 'breaker', event: 'breaker_powerups', mode: 'add', targets: [4, 8], label: n => `Catch ${n} power-ups in Breaker` }
  ];

  const listeners = new Set();
  let state = null;
  let queue = Promise.resolve();

  function todayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function daysBetween(fromKey, toKey) {
    const [fy, fm, fd] = fromKey.split('-').map(Number);
    const [ty, tm, td] = toKey.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
  }

  // Small deterministic PRNG so every tab picks the same missions for a given day
  function seededRandom(seedText) {
    let h = 2166136261;
    for (let i = 0; i < seedText.length; i++) {
      h ^= seedText.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return () => {
      h += 0x6d2b79f5;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateMissions(dayKey) {
    const rand = seededRandom('missions-' + dayKey);
    const pool = [...MISSION_TEMPLATES];
    const picked = [];
    // Always mix both games: two Runner missions and one Breaker mission
    const take = (game) => {
      const options = pool.filter(t => t.game === game);
      const tpl = options[Math.floor(rand() * options.length)];
      pool.splice(pool.indexOf(tpl), 1);
      return tpl;
    };
    [take('runner'), take('runner'), take('breaker')].forEach((tpl, idx) => {
      const tier = Math.floor(rand() * tpl.targets.length);
      const target = tpl.targets[tier];
      picked.push({
        id: `${dayKey}-${idx}-${tpl.id}`,
        templateId: tpl.id,
        game: tpl.game,
        event: tpl.event,
        mode: tpl.mode,
        target,
        label: tpl.label(target),
        reward: 50 + tier * 40,
        progress: 0,
        claimed: false
      });
    });
    return { date: dayKey, list: picked };
  }

  function emptyState() {
    return {
      coins: 0,
      lifetimeCoins: 0,
      owned: { 'skin-classic': true, 'trail-none': true, 'paddle-classic': true },
      levels: {},
      consumables: {},
      equipped: { ...DEFAULT_EQUIPPED },
      daily: { lastClaim: null, streak: 0 },
      missions: null
    };
  }

  // Coerce stored/imported data into a valid state
  function normalize(raw) {
    const s = emptyState();
    if (!raw || typeof raw !== 'object') return s;
    const num = (v, min = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : min);
    s.coins = num(raw.coins);
    s.lifetimeCoins = Math.max(num(raw.lifetimeCoins), s.coins);
    if (raw.owned && typeof raw.owned === 'object') {
      Object.keys(raw.owned).forEach(id => { if (getItem(id) && raw.owned[id] === true) s.owned[id] = true; });
    }
    if (raw.levels && typeof raw.levels === 'object') {
      Object.keys(raw.levels).forEach(id => {
        const item = getItem(id);
        if (item && item.type === 'upgrade') s.levels[id] = Math.min(num(raw.levels[id]), item.values.length - 1);
      });
    }
    if (raw.consumables && typeof raw.consumables === 'object') {
      Object.keys(raw.consumables).forEach(id => {
        const item = getItem(id);
        if (item && item.type === 'consumable') s.consumables[id] = Math.min(num(raw.consumables[id]), 99);
      });
    }
    if (raw.equipped && typeof raw.equipped === 'object') {
      Object.keys(DEFAULT_EQUIPPED).forEach(slot => {
        const id = raw.equipped[slot];
        const item = getItem(id);
        if (item && item.slot === slot && s.owned[id]) s.equipped[slot] = id;
      });
    }
    if (raw.daily && typeof raw.daily === 'object') {
      s.daily.lastClaim = typeof raw.daily.lastClaim === 'string' ? raw.daily.lastClaim : null;
      s.daily.streak = num(raw.daily.streak);
    }
    if (raw.missions && typeof raw.missions === 'object' && Array.isArray(raw.missions.list)) {
      s.missions = {
        date: String(raw.missions.date || ''),
        list: raw.missions.list.filter(m => m && typeof m === 'object' && typeof m.id === 'string').map(m => ({
          ...m,
          progress: num(m.progress),
          target: Math.max(1, num(m.target, 1)),
          reward: num(m.reward),
          claimed: m.claimed === true
        }))
      };
    }
    return s;
  }

  function getItem(id) {
    return CATALOG.find(item => item.id === id) || null;
  }

  // Strict read: a storage error rejects instead of looking like an empty wallet (which would then be saved over real coins)
  async function readStored() {
    if (typeof ShortcutStorage === 'undefined') return null;
    return ShortcutStorage._getStorageItem(STORAGE_KEY, null, true);
  }

  // Cross-tab mutual exclusion (Web Locks); falls back to running directly where unavailable
  function withLock(fn) {
    if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
      return navigator.locks.request('shortcut-plus-arcade-wallet', fn);
    }
    return fn();
  }

  async function writeStored(value) {
    if (typeof ShortcutStorage === 'undefined') return;
    await ShortcutStorage._setStorageItem(STORAGE_KEY, value);
  }

  // Rolls missions over to today if the stored set is from another day
  function ensureMissions(s) {
    const today = todayKey();
    if (!s.missions || s.missions.date !== today) s.missions = generateMissions(today);
  }

  function notify() {
    listeners.forEach(fn => {
      try { fn(state); } catch (err) { console.error('[ArcadeWallet] listener failed:', err); }
    });
  }

  // Runs fn after every earlier wallet operation in this tab, holding the cross-tab lock
  function enqueue(fn) {
    const run = queue.then(() => withLock(fn));
    queue = run.catch(err => console.error('[ArcadeWallet] operation failed:', err));
    return run;
  }

  // Serialized read-modify-write against fresh storage, so open tabs can't overwrite each other's coins.
  // If the read fails nothing is written and the promise rejects.
  function update(mutator) {
    return enqueue(async () => {
      const fresh = normalize(await readStored());
      ensureMissions(fresh);
      const result = mutator(fresh);
      await writeStored(fresh);
      state = fresh;
      notify();
      return result;
    });
  }

  return {
    CATALOG,
    DAILY_REWARDS,
    UPGRADE_PRICES,
    normalize,
    todayKey,

    load() {
      return enqueue(async () => {
        state = normalize(await readStored());
        ensureMissions(state);
        notify();
        return state;
      });
    },

    // Replaces the whole wallet (backup import), cleaned the same way as stored data
    replace(raw) {
      return update(s => {
        const next = normalize(raw);
        Object.keys(s).forEach(k => delete s[k]);
        Object.assign(s, next);
        ensureMissions(s);
        return true;
      });
    },

    // Cached state (call load() first; returns a safe empty state before that)
    get state() {
      return state || emptyState();
    },

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    getItem,

    getCoins() {
      return this.state.coins;
    },

    addCoins(amount) {
      const n = Math.max(0, Math.floor(amount || 0));
      if (!n) return Promise.resolve(this.state.coins);
      return update(s => {
        s.coins += n;
        s.lifetimeCoins += n;
        return s.coins;
      });
    },

    isOwned(id) {
      return this.state.owned[id] === true;
    },

    getLevel(id) {
      return this.state.levels[id] || 0;
    },

    // Effect value of an upgrade at its current level (e.g. seconds of magnet)
    getUpgradeValue(id) {
      const item = getItem(id);
      if (!item || item.type !== 'upgrade') return 0;
      return item.values[Math.min(this.getLevel(id), item.values.length - 1)];
    },

    getConsumableCount(id) {
      return this.state.consumables[id] || 0;
    },

    getEquipped(slot) {
      return this.state.equipped[slot] || DEFAULT_EQUIPPED[slot];
    },

    // Price of the next purchase of an item (null when maxed or unknown)
    getPrice(id) {
      const item = getItem(id);
      if (!item) return null;
      if (item.type === 'upgrade') {
        const level = this.getLevel(id);
        return level >= item.values.length - 1 ? null : UPGRADE_PRICES[level];
      }
      if (item.type === 'consumable') return item.price;
      return this.isOwned(id) ? null : item.price;
    },

    // Buys an item; resolves { ok, reason?, coins }
    buy(id) {
      return update(s => {
        const item = getItem(id);
        if (!item) return { ok: false, reason: 'unknown', coins: s.coins };
        let price;
        if (item.type === 'upgrade') {
          const level = s.levels[id] || 0;
          if (level >= item.values.length - 1) return { ok: false, reason: 'maxed', coins: s.coins };
          price = UPGRADE_PRICES[level];
        } else if (item.type === 'consumable') {
          if ((s.consumables[id] || 0) >= 99) return { ok: false, reason: 'maxed', coins: s.coins };
          price = item.price;
        } else {
          if (s.owned[id]) return { ok: false, reason: 'owned', coins: s.coins };
          price = item.price;
        }
        if (s.coins < price) return { ok: false, reason: 'funds', coins: s.coins };

        s.coins -= price;
        if (item.type === 'upgrade') s.levels[id] = (s.levels[id] || 0) + 1;
        else if (item.type === 'consumable') s.consumables[id] = (s.consumables[id] || 0) + 1;
        else {
          s.owned[id] = true;
          if (item.slot) s.equipped[item.slot] = id; // equip new cosmetics right away
        }
        return { ok: true, coins: s.coins };
      });
    },

    equip(id) {
      return update(s => {
        const item = getItem(id);
        if (!item || !item.slot || !s.owned[id]) return false;
        s.equipped[item.slot] = id;
        return true;
      });
    },

    // Uses one consumable; resolves true if one was available
    useConsumable(id) {
      return update(s => {
        if (!(s.consumables[id] > 0)) return false;
        s.consumables[id] -= 1;
        return true;
      });
    },

    // ---------- Daily reward ----------

    getDailyStatus() {
      const today = todayKey();
      const { lastClaim, streak } = this.state.daily;
      // A claim dated today or later (clock/timezone moved back) counts as already claimed
      const claimedToday = !!lastClaim && daysBetween(lastClaim, today) <= 0;
      const continues = lastClaim && daysBetween(lastClaim, today) === 1;
      const nextStreak = claimedToday ? streak : (continues ? streak + 1 : 1);
      const reward = DAILY_REWARDS[Math.min(nextStreak, DAILY_REWARDS.length) - 1];
      return { claimedToday, streak: claimedToday ? streak : (continues ? streak : 0), nextStreak, reward };
    },

    claimDaily() {
      return update(s => {
        const today = todayKey();
        if (s.daily.lastClaim && daysBetween(s.daily.lastClaim, today) <= 0) {
          return { ok: false, reason: 'claimed', coins: s.coins };
        }
        const continues = s.daily.lastClaim && daysBetween(s.daily.lastClaim, today) === 1;
        s.daily.streak = continues ? s.daily.streak + 1 : 1;
        s.daily.lastClaim = today;
        const reward = DAILY_REWARDS[Math.min(s.daily.streak, DAILY_REWARDS.length) - 1];
        s.coins += reward;
        s.lifetimeCoins += reward;
        return { ok: true, reward, streak: s.daily.streak, coins: s.coins };
      });
    },

    // ---------- Daily missions ----------

    getMissions() {
      const s = this.state;
      ensureMissions(s);
      return s.missions.list;
    },

    // Games report events here, e.g. report('runner_coins', 12) or report('runner_distance', 830)
    report(event, value = 1) {
      const amount = Math.max(0, Math.floor(value || 0));
      if (!amount) return Promise.resolve([]);
      return update(s => {
        const completed = [];
        s.missions.list.forEach(m => {
          if (m.event !== event || m.claimed) return;
          const wasDone = m.progress >= m.target;
          m.progress = m.mode === 'max' ? Math.max(m.progress, amount) : m.progress + amount;
          m.progress = Math.min(m.progress, m.target);
          if (!wasDone && m.progress >= m.target) completed.push(m.label);
        });
        return completed; // labels of missions completed by this report (for "Mission complete!" toasts)
      });
    },

    claimMission(id) {
      return update(s => {
        const m = s.missions.list.find(x => x.id === id);
        if (!m || m.claimed || m.progress < m.target) return { ok: false, coins: s.coins };
        m.claimed = true;
        s.coins += m.reward;
        s.lifetimeCoins += m.reward;
        return { ok: true, reward: m.reward, coins: s.coins };
      });
    },

    // Count of things waiting for the player (unclaimed daily reward + finished missions), for badges
    getPendingCount() {
      const daily = this.getDailyStatus().claimedToday ? 0 : 1;
      const missions = this.getMissions().filter(m => !m.claimed && m.progress >= m.target).length;
      return daily + missions;
    }
  };
})();
