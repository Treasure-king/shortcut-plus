/* storage.js - Fullstack Developer dataset, User-controlled Category Storage & Workspace Profiles */

const DEFAULT_GROUPS = []; // No default groups - user creates them when desired!

const DEFAULT_PROFILES = [
  { id: 'profile-default', name: 'Default' },
  { id: 'profile-work', name: 'Work Mode' },
  { id: 'profile-personal', name: 'Personal Mode' },
  { id: 'profile-dev', name: 'Developer Mode' }
];

const DEFAULT_SHORTCUTS = [
  { id: "dev-github", name: "GitHub", url: "https://github.com", groupId: null, order: 0 },
  { id: "dev-chatgpt", name: "ChatGPT", url: "https://chatgpt.com", groupId: null, order: 1 },
  { id: "dev-youtube", name: "YouTube", url: "https://youtube.com", groupId: null, order: 2 },
  { id: "dev-gmail", name: "Gmail", url: "https://mail.google.com", groupId: null, order: 3 },
  { id: "dev-stackoverflow", name: "Stack Overflow", url: "https://stackoverflow.com", groupId: null, order: 4 },
  { id: "dev-mdn", name: "MDN Web Docs", url: "https://developer.mozilla.org", groupId: null, order: 5 },
  { id: "dev-reddit", name: "Reddit", url: "https://reddit.com", groupId: null, order: 6 }
];

const DEFAULT_SETTINGS = {
  layoutMode: 'grid', // 'grid' | 'free'
  themeMode: 'system',
  isEditMode: false,
  showShortcuts: true,
  showGoogleLogo: true,
  showSearchBar: true,
  showHeader: true,
  sectionOrder: ['logo', 'search', 'shortcuts'],
  logoPosition: null,
  searchBarPosition: null,
  addShortcutPosition: null,
  tileStyle: 'grid', // 'grid' | 'pill' | 'list'
  bgMode: 'default', // 'default' | 'unsplash' | 'glass' | 'custom'
  bgCustomUrl: ''
};

const PROFILES_KEY = 'shortcut_plus_profiles';
const ACTIVE_PROFILE_KEY = 'shortcut_plus_active_profile';
const SETTINGS_KEY = 'shortcut_plus_settings';
const SEARCH_HISTORY_KEY = 'shortcut_plus_search_history';

const DEFAULT_SEARCH_HISTORY = [];

const ShortcutStorage = {
  // Serializes read-modify-write operations so overlapping saves can't overwrite each other
  _queue: Promise.resolve(),

  _mutate(fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run;
  },

  // Runs fn exclusively with the other mutators. fn must only use get*/save* methods
  // (not the queued mutators like updateShortcut), otherwise it would wait on itself.
  transaction(fn) {
    return this._mutate(fn);
  },

  // strict: reject on a read error instead of resolving defaultValue, so callers never
  // mistake a failed read for "first run" and overwrite real data with defaults.
  async _getStorageItem(key, defaultValue, strict = false) {
    return new Promise((resolve, reject) => {
      if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local) {
        try {
          chrome.storage.local.get([key], (result) => {
            const err = chrome.runtime && chrome.runtime.lastError;
            if (err && strict) {
              reject(new Error(`[ShortcutStorage] Failed to read "${key}": ${err.message || err}`));
              return;
            }
            if (!err && result && result[key] !== undefined) {
              resolve(result[key]);
            } else {
              // Fallback: check chrome.storage.sync for data written by older code
              if (chrome.storage.sync) {
                try {
                  chrome.storage.sync.get([key], (syncResult) => {
                    const syncErr = chrome.runtime && chrome.runtime.lastError;
                    if (!syncErr && syncResult && syncResult[key] !== undefined) {
                      chrome.storage.local.set({ [key]: syncResult[key] }, () => {});
                      resolve(syncResult[key]);
                    } else {
                      resolve(defaultValue);
                    }
                  });
                } catch (syncE) {
                  console.warn(`[ShortcutStorage] Error checking chrome.storage.sync:`, syncE);
                  resolve(defaultValue);
                }
              } else {
                resolve(defaultValue);
              }
            }
          });
        } catch (e) {
          console.error(`[ShortcutStorage] Catch error reading key "${key}":`, e);
          if (strict) reject(e); else resolve(defaultValue);
        }
      } else {
        try {
          const localData = localStorage.getItem(key);
          if (localData !== null) {
            const parsed = JSON.parse(localData);
            resolve(parsed);
          } else {
            resolve(defaultValue);
          }
        } catch (e) {
          console.error(`[ShortcutStorage] Catch error reading localStorage key "${key}":`, e);
          if (strict) reject(e); else resolve(defaultValue);
        }
      }
    });
  },

  async _setStorageItem(key, value) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local) {
        try {
          chrome.storage.local.set({ [key]: value }, () => {
            const err = chrome.runtime && chrome.runtime.lastError;
            if (err) {
              console.error(`[ShortcutStorage] Error saving to chrome.storage.local for key "${key}":`, err);
            }
            resolve(value);
          });
        } catch (e) {
          console.error(`[ShortcutStorage] Catch error saving key "${key}":`, e);
          resolve(value);
        }
      } else {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
          console.error(`[ShortcutStorage] Error saving key "${key}" to localStorage:`, e);
        }
        resolve(value);
      }
    });
  },

  async getProfiles() {
    const profiles = await this._getStorageItem(PROFILES_KEY, null, true);
    if (!profiles || !Array.isArray(profiles) || profiles.length === 0) {
      const defaults = DEFAULT_PROFILES.map(p => ({ ...p }));
      await this.saveProfiles(defaults);
      return defaults;
    }
    return profiles;
  },

  async saveProfiles(profiles) {
    return await this._setStorageItem(PROFILES_KEY, profiles);
  },

  async getActiveProfileId() {
    const active = await this._getStorageItem(ACTIVE_PROFILE_KEY, 'profile-default');
    const resolved = active || 'profile-default';
    return resolved;
  },

  async setActiveProfile(profileId) {
    await this._setStorageItem(ACTIVE_PROFILE_KEY, profileId);
  },

  async addProfile(name) {
    if (!name || !name.trim()) return null;
    const profiles = await this.getProfiles();
    if (profiles.length >= 8) {
      if (typeof window !== 'undefined' && window.showToast) {
        window.showToast('Maximum limit of 8 workspace profiles reached.');
      }
      return null;
    }
    const newId = 'profile-' + Date.now();
    const newProfile = { id: newId, name: name.trim() };
    profiles.push(newProfile);
    await this.saveProfiles(profiles);
    await this.setActiveProfile(newId);

    // Initialize clean empty shortcuts & groups for new profile
    await this.saveShortcuts([]);
    await this.saveGroups([]);

    // Initialize separate settings for new profile (inheriting current base settings)
    const baseSettings = await this._getStorageItem(SETTINGS_KEY, null) || DEFAULT_SETTINGS;
    await this._setStorageItem(`${SETTINGS_KEY}_${newId}`, { ...DEFAULT_SETTINGS, ...baseSettings });

    return newProfile;
  },

  async importShortcutsFromProfile(sourceProfileId, selectedShortcutIds = []) {
    if (!sourceProfileId || !selectedShortcutIds || selectedShortcutIds.length === 0) return [];
    const sourceKey = sourceProfileId === 'profile-default' ? 'shortcut_plus_shortcuts' : `shortcut_plus_shortcuts_${sourceProfileId}`;
    const sourceShortcuts = await this._getStorageItem(sourceKey, []);
    const itemsToImport = sourceShortcuts.filter(s => selectedShortcutIds.includes(s.id));

    let activeShortcuts = await this.getShortcuts();
    const maxOrder = activeShortcuts.reduce((max, s) => Math.max(max, s.order ?? 0), -1);

    const newItems = itemsToImport.map((item, idx) => ({
      ...item,
      id: 'shortcut-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + idx,
      groupId: null, // Clear category group assignment on cross-profile import
      order: maxOrder + 1 + idx,
      createdAt: Date.now()
    }));

    activeShortcuts = [...activeShortcuts, ...newItems];
    await this.saveShortcuts(activeShortcuts);
    return newItems;
  },

  async deleteProfile(profileId) {
    if (profileId === 'profile-default') {
      if (typeof window !== 'undefined' && window.showToast) {
        window.showToast('The Default profile cannot be deleted.');
      }
      return null;
    }
    let profiles = await this.getProfiles();
    profiles = profiles.filter(p => p.id !== profileId);
    await this.saveProfiles(profiles);

    const activeId = await this.getActiveProfileId();
    if (activeId === profileId) {
      await this.setActiveProfile('profile-default');
    }

    // Clean up stored keys for this profile
    const shortcutsKey = `shortcut_plus_shortcuts_${profileId}`;
    const groupsKey = `shortcut_plus_groups_${profileId}`;
    const settingsKey = `shortcut_plus_settings_${profileId}`;
    const gameHighscoreKey = `shortcut_plus_game_highscore_${profileId}`;
    const keysToRemove = [
      shortcutsKey, groupsKey, settingsKey, gameHighscoreKey,
      `shortcut_plus_bg_media_${profileId}`,
      `shortcut_plus_breaker_highscore_${profileId}`,
      `shortcut_plus_widgets_${profileId}`
    ];

    if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(keysToRemove, () => {});
    } else {
      keysToRemove.forEach(k => localStorage.removeItem(k));
    }

    return profiles;
  },

  async getShortcutsKey() {
    const activeId = await this.getActiveProfileId();
    const key = (!activeId || activeId === 'profile-default') ? 'shortcut_plus_shortcuts' : `shortcut_plus_shortcuts_${activeId}`;
    return key;
  },

  async getGroupsKey() {
    const activeId = await this.getActiveProfileId();
    const key = (!activeId || activeId === 'profile-default') ? 'shortcut_plus_groups' : `shortcut_plus_groups_${activeId}`;
    return key;
  },

  async getSettingsKey(profileId = null) {
    const activeId = profileId || await this.getActiveProfileId();
    const key = (!activeId || activeId === 'profile-default') ? SETTINGS_KEY : `${SETTINGS_KEY}_${activeId}`;
    return key;
  },

  async getShortcuts() {
    const key = await this.getShortcutsKey();
    const shortcuts = await this._getStorageItem(key, null, true);

    if (!shortcuts || !Array.isArray(shortcuts)) {
      const clonedDefaults = DEFAULT_SHORTCUTS.map(s => ({
        ...s,
        id: 'shortcut-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
      }));
      await this.saveShortcuts(clonedDefaults);
      return clonedDefaults;
    }

    // Automatic Deduplication Safeguard (by unique ID only - preserves intentional duplicate bookmarks across groups)
    const seenIds = new Set();
    const uniqueShortcuts = [];

    let repaired = false;

    for (const s of shortcuts) {
      if (!s || typeof s !== 'object') continue;
      if (!s.id) {
        // Keep id-less entries (e.g. from hand-written imports) instead of silently dropping them
        s.id = 'shortcut-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        repaired = true;
      }
      if (!seenIds.has(s.id)) {
        seenIds.add(s.id);
        uniqueShortcuts.push(s);
      }
    }

    if (repaired || uniqueShortcuts.length !== shortcuts.length) {
      await this.saveShortcuts(uniqueShortcuts);
    }

    const sorted = uniqueShortcuts.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return sorted;
  },

  async saveShortcuts(shortcuts) {
    const key = await this.getShortcutsKey();
    return await this._setStorageItem(key, shortcuts);
  },

  // ---- Per-tile customization validators (pure; safe to call from render code) ----
  MAX_ICON_DATA_URL_LENGTH: 400000, // ~300 KB; uploads are resized to 128x128 so real ones are far smaller

  /**
   * Returns a validated { type, value } icon, or null for the default (auto favicon) / invalid input.
   */
  sanitizeIcon(icon) {
    if (!icon || typeof icon !== 'object') return null;
    const type = icon.type;
    const value = typeof icon.value === 'string' ? icon.value.trim() : '';
    if (type === 'emoji') {
      if (!value || /[\u0000-\u001F\u007F<>]/.test(value)) return null;
      if (Array.from(value).length > 8) return null;
      return { type: 'emoji', value };
    }
    if (type === 'upload') {
      if (value.length > this.MAX_ICON_DATA_URL_LENGTH) return null;
      if (!/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) return null;
      return { type: 'upload', value };
    }
    if (type === 'url') {
      if (value.length > 2048) return null;
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return { type: 'url', value: parsed.href };
      } catch (e) {
        return null;
      }
    }
    return null;
  },

  /** Returns a lowercase "#rrggbb" string, or null for default / invalid input. */
  sanitizeColor(color) {
    if (typeof color !== 'string') return null;
    const c = color.trim();
    return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
  },

  // Apply validated customization fields onto a shortcut record (only non-default values are stored)
  _applyCustomization(target, data) {
    if (data.icon !== undefined) {
      const icon = this.sanitizeIcon(data.icon);
      if (icon) target.icon = icon; else delete target.icon;
    }
    if (data.color !== undefined) {
      const color = this.sanitizeColor(data.color);
      if (color) target.color = color; else delete target.color;
    }
    if (data.openInNewTab !== undefined) {
      if (data.openInNewTab === true) target.openInNewTab = true; else delete target.openInNewTab;
    }
    return target;
  },

  async addShortcut(shortcutData) {
    const shortcuts = await this.getShortcuts();
    const maxOrder = shortcuts.reduce((max, s) => Math.max(max, s.order ?? 0), -1);

    const newShortcut = {
      id: 'shortcut-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: shortcutData.name.trim(),
      url: shortcutData.url.trim(),
      groupId: shortcutData.groupId && shortcutData.groupId !== 'none' ? shortcutData.groupId : null,
      order: maxOrder + 1,
      hasCustomPosition: false,
      createdAt: Date.now()
    };
    this._applyCustomization(newShortcut, shortcutData);
    shortcuts.push(newShortcut);
    await this.saveShortcuts(shortcuts);
    return newShortcut;
  },

  async updateShortcut(id, updatedData) {
    const shortcuts = await this.getShortcuts();
    const index = shortcuts.findIndex(s => s.id === id);
    if (index !== -1) {
      const existing = shortcuts[index];
      const gId = updatedData.groupId !== undefined
        ? (updatedData.groupId && updatedData.groupId !== 'none' ? updatedData.groupId : null)
        : existing.groupId;

      shortcuts[index] = {
        ...existing,
        name: updatedData.name !== undefined ? updatedData.name.trim() : existing.name,
        url: updatedData.url !== undefined ? updatedData.url.trim() : existing.url,
        groupId: gId,
        ...(updatedData.position !== undefined ? { position: updatedData.position } : {}),
        ...(updatedData.hasCustomPosition !== undefined ? { hasCustomPosition: updatedData.hasCustomPosition } : {}),
        ...(updatedData.size !== undefined ? { size: updatedData.size } : {}),
        ...(updatedData.order !== undefined ? { order: updatedData.order } : {}),
        updatedAt: Date.now()
      };
      this._applyCustomization(shortcuts[index], updatedData);
      await this.saveShortcuts(shortcuts);
      return shortcuts[index];
    }
    return null;
  },

  async updateShortcutOrders(reorderedShortcuts) {
    const updated = reorderedShortcuts.map((shortcut, index) => ({
      ...shortcut,
      order: index
    }));
    await this.saveShortcuts(updated);
    return updated;
  },

  async deleteShortcut(id) {
    let shortcuts = await this.getShortcuts();
    shortcuts = shortcuts.filter(s => s.id !== id);
    shortcuts = shortcuts.map((s, idx) => ({ ...s, order: idx }));
    await this.saveShortcuts(shortcuts);
    return shortcuts;
  },

  async getGroups() {
    const key = await this.getGroupsKey();
    const groups = await this._getStorageItem(key, null, true);
    if (!groups || !Array.isArray(groups)) {
      const defaults = DEFAULT_GROUPS.map(g => ({ ...g }));
      await this.saveGroups(defaults);
      return defaults;
    }
    const userGroups = groups.filter(g => !['group-default', 'group-work', 'group-social'].includes(g.id));
    if (userGroups.length !== groups.length) {
      await this.saveGroups(userGroups);
      return userGroups;
    }
    return groups.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },

  async saveGroups(groups) {
    const key = await this.getGroupsKey();
    return await this._setStorageItem(key, groups);
  },

  async addGroup(name, initialShortcutIds = []) {
    const groups = await this.getGroups();
    const newGroupId = 'group-' + Date.now();
    const newGroup = {
      id: newGroupId,
      name: name.trim(),
      isCollapsed: false,
      order: groups.length
    };
    groups.push(newGroup);
    await this.saveGroups(groups);

    if (initialShortcutIds && initialShortcutIds.length > 0) {
      let shortcuts = await this.getShortcuts();
      shortcuts = shortcuts.map(s => {
        if (initialShortcutIds.includes(s.id)) {
          return { ...s, groupId: newGroupId };
        }
        return s;
      });
      await this.saveShortcuts(shortcuts);
    }

    return newGroup;
  },

  async toggleGroupCollapse(groupId) {
    const groups = await this.getGroups();
    const index = groups.findIndex(g => g.id === groupId);
    if (index !== -1) {
      groups[index].isCollapsed = !groups[index].isCollapsed;
      await this.saveGroups(groups);
      return groups[index];
    }
    return null;
  },

  async updateGroup(groupId, updatedData) {
    const groups = await this.getGroups();
    const index = groups.findIndex(g => g.id === groupId);
    if (index !== -1 && updatedData) {
      if (typeof updatedData === 'string' && updatedData.trim()) {
        groups[index].name = updatedData.trim();
      } else if (typeof updatedData === 'object') {
        groups[index] = { ...groups[index], ...updatedData };
      }
      await this.saveGroups(groups);
      return groups[index];
    }
    return null;
  },

  async deleteGroup(groupId) {
    let groups = await this.getGroups();
    groups = groups.filter(g => g.id !== groupId);
    await this.saveGroups(groups);

    let shortcuts = await this.getShortcuts();
    shortcuts = shortcuts.map(s => s.groupId === groupId ? { ...s, groupId: null } : s);
    await this.saveShortcuts(shortcuts);
    return groups;
  },

  async deleteShortcuts(idsArray) {
    if (!idsArray || idsArray.length === 0) return await this.getShortcuts();
    const idsSet = new Set(idsArray);
    let shortcuts = await this.getShortcuts();
    shortcuts = shortcuts.filter(s => !idsSet.has(s.id));
    shortcuts = shortcuts.map((s, idx) => ({ ...s, order: idx }));
    await this.saveShortcuts(shortcuts);
    return shortcuts;
  },

  async getSettings(profileId = null) {
    const key = await this.getSettingsKey(profileId);
    const settings = await this._getStorageItem(key, null);
    if (!settings) {
      if (key === SETTINGS_KEY) {
        await this._setStorageItem(SETTINGS_KEY, DEFAULT_SETTINGS);
        return { ...DEFAULT_SETTINGS };
      }
      // For non-default profile without settings yet, copy existing base settings or default
      const baseSettings = await this._getStorageItem(SETTINGS_KEY, null);
      const initialProfileSettings = { ...DEFAULT_SETTINGS, ...(baseSettings || {}) };
      await this._setStorageItem(key, initialProfileSettings);
      return { ...initialProfileSettings };
    }
    return { ...DEFAULT_SETTINGS, ...settings };
  },

  async saveSettings(settings, profileId = null) {
    const key = await this.getSettingsKey(profileId);
    const current = await this._getStorageItem(key, null) || await this.getSettings(profileId);
    const updated = { ...DEFAULT_SETTINGS, ...(current || {}), ...(settings || {}) };
    return await this._setStorageItem(key, updated);
  },

  async getSearchHistory() {
    const history = await this._getStorageItem(SEARCH_HISTORY_KEY, null);
    if (!history || !Array.isArray(history) || history.length === 0) {
      await this._setStorageItem(SEARCH_HISTORY_KEY, DEFAULT_SEARCH_HISTORY);
      return DEFAULT_SEARCH_HISTORY;
    }
    return history;
  },

  async addSearchHistory(query) {
    if (!query || !query.trim()) return [];
    const trimmed = query.trim();
    let history = await this.getSearchHistory();
    // Remove if already exists (case-insensitive check for deduplication)
    history = history.filter(item => item.toLowerCase() !== trimmed.toLowerCase());
    // Insert at beginning
    history.unshift(trimmed);
    // Limit to max 10 entries
    if (history.length > 10) history = history.slice(0, 10);
    await this._setStorageItem(SEARCH_HISTORY_KEY, history);
    return history;
  },

  async deleteSearchHistoryItem(query) {
    if (!query) return await this.getSearchHistory();
    let history = await this.getSearchHistory();
    history = history.filter(item => item.toLowerCase() !== query.trim().toLowerCase());
    await this._setStorageItem(SEARCH_HISTORY_KEY, history);
    return history;
  },

  async clearSearchHistory() {
    await this._setStorageItem(SEARCH_HISTORY_KEY, []);
    return [];
  },

  async getGameHighScore(profileId = null) {
    const activeId = profileId || await this.getActiveProfileId();
    const key = `shortcut_plus_game_highscore_${activeId || 'profile-default'}`;
    const score = await this._getStorageItem(key, 0);
    return typeof score === 'number' ? score : 0;
  },

  async saveGameHighScore(score, profileId = null) {
    const activeId = profileId || await this.getActiveProfileId();
    const key = `shortcut_plus_game_highscore_${activeId || 'profile-default'}`;
    const currentHigh = await this.getGameHighScore(profileId);
    if (score > currentHigh) {
      await this._setStorageItem(key, score);
      return score;
    }
    return currentHigh;
  },

  async getAllWorkspaceData() {
    const profiles = await this.getProfiles();
    const activeProfileId = await this.getActiveProfileId();
    const allData = {
      profiles,
      activeProfileId,
      workspaces: {}
    };

    for (const p of profiles) {
      const sKey = (p.id === 'profile-default') ? 'shortcut_plus_shortcuts' : `shortcut_plus_shortcuts_${p.id}`;
      const gKey = (p.id === 'profile-default') ? 'shortcut_plus_groups' : `shortcut_plus_groups_${p.id}`;
      const stKey = (p.id === 'profile-default') ? SETTINGS_KEY : `${SETTINGS_KEY}_${p.id}`;
      const hsKey = `shortcut_plus_game_highscore_${p.id}`;

      allData.workspaces[p.id] = {
        shortcuts: await this._getStorageItem(sKey, []),
        groups: await this._getStorageItem(gKey, []),
        settings: await this._getStorageItem(stKey, DEFAULT_SETTINGS),
        gameHighScore: await this._getStorageItem(hsKey, 0),
        breakerHighScore: await this._getStorageItem(`shortcut_plus_breaker_highscore_${p.id}`, 0),
        widgets: await this._getStorageItem(`shortcut_plus_widgets_${p.id}`, null)
      };
    }

    return allData;
  },

  async restoreAllWorkspaceData(data) {
    if (!data || !data.workspaces) return false;

    if (Array.isArray(data.profiles) && data.profiles.length > 0) {
      await this.saveProfiles(data.profiles);
    }
    if (data.activeProfileId) {
      await this.setActiveProfile(data.activeProfileId);
    }

    for (const [profileId, ws] of Object.entries(data.workspaces)) {
      if (!ws || typeof ws !== 'object') continue;
      const sKey = (profileId === 'profile-default') ? 'shortcut_plus_shortcuts' : `shortcut_plus_shortcuts_${profileId}`;
      const gKey = (profileId === 'profile-default') ? 'shortcut_plus_groups' : `shortcut_plus_groups_${profileId}`;
      const stKey = (profileId === 'profile-default') ? SETTINGS_KEY : `${SETTINGS_KEY}_${profileId}`;
      const hsKey = `shortcut_plus_game_highscore_${profileId}`;

      if (Array.isArray(ws.shortcuts)) await this._setStorageItem(sKey, ws.shortcuts);
      if (Array.isArray(ws.groups)) await this._setStorageItem(gKey, ws.groups);
      if (ws.settings) await this._setStorageItem(stKey, ws.settings);
      if (typeof ws.gameHighScore === 'number') await this._setStorageItem(hsKey, ws.gameHighScore);
      if (typeof ws.breakerHighScore === 'number') {
        await this._setStorageItem(`shortcut_plus_breaker_highscore_${profileId}`, ws.breakerHighScore);
      }
      if (ws.widgets && typeof ws.widgets === 'object') {
        await this._setStorageItem(`shortcut_plus_widgets_${profileId}`, ws.widgets);
      }
    }

    return true;
  }
};

// Queue every read-modify-write mutator through _mutate (none of these call each other)
[
  'addProfile', 'deleteProfile', 'importShortcutsFromProfile',
  'addShortcut', 'updateShortcut', 'updateShortcutOrders', 'deleteShortcut', 'deleteShortcuts',
  'addGroup', 'toggleGroupCollapse', 'updateGroup', 'deleteGroup',
  'saveSettings', 'addSearchHistory', 'deleteSearchHistoryItem', 'saveGameHighScore'
].forEach(name => {
  const original = ShortcutStorage[name];
  ShortcutStorage[name] = function (...args) {
    return ShortcutStorage._mutate(() => original.apply(ShortcutStorage, args));
  };
});
