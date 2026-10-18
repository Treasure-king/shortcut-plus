/* backup.js - Layout JSON Export & Import Engine (Multi-Profile & Backwards Compatible) */

const BackupEngine = {
  /**
   * Export all shortcuts, groups, settings, and workspace profiles to JSON file download.
   */
  async exportBackup() {
    const shortcuts = await ShortcutStorage.getShortcuts();
    const groups = await ShortcutStorage.getGroups();
    const settings = await ShortcutStorage.getSettings();
    const workspaceData = await ShortcutStorage.getAllWorkspaceData();

    // Uploaded background media lives in its own per-profile key (settings only hold a marker)
    const bgMedia = {};
    for (const p of workspaceData.profiles || []) {
      try {
        const media = await ShortcutStorage._getStorageItem(`shortcut_plus_bg_media_${p.id}`, null);
        if (typeof media === 'string' && media.startsWith('data:')) bgMedia[p.id] = media;
      } catch (err) {
        console.warn('[BackupEngine] Could not read background media for', p.id, err);
      }
    }

    // Arcade coins, purchases and streaks are global (shared by all profiles)
    let arcadeWallet = null;
    try {
      arcadeWallet = await ShortcutStorage._getStorageItem('shortcut_plus_arcade_wallet', null);
    } catch (err) {
      console.warn('[BackupEngine] Could not read arcade wallet', err);
    }

    const payload = {
      app: 'Shortcut+',
      version: '1.1.0',
      exportedAt: new Date().toISOString(),
      shortcuts,
      groups,
      settings,
      profiles: workspaceData.profiles,
      activeProfileId: workspaceData.activeProfileId,
      workspaces: workspaceData.workspaces,
      bgMedia,
      arcadeWallet
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `shortcut-plus-backup-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /**
   * Import JSON backup file and restore shortcuts, groups, settings, and workspace profiles.
   */
  async importBackup(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = e.target.result;
          const data = JSON.parse(content);

          // Validation (supports full multi-profile backup, single-profile object, or raw shortcuts array)
          if (!data || (!Array.isArray(data.shortcuts) && !Array.isArray(data.groups) && !data.workspaces && !Array.isArray(data))) {
            throw new Error('Invalid JSON backup structure');
          }

          // Fully validate & sanitize BEFORE any storage write
          const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
          const sanitizeShortcuts = (list) => list
            .filter(s => isPlainObject(s) && typeof s.name === 'string' && typeof s.url === 'string')
            .map(s => {
              const clean = {
                ...s,
                id: (typeof s.id === 'string' && s.id) ? s.id : 'shortcut-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
              };
              // Customization fields are only kept when valid (same rules as the Add/Edit dialog)
              const icon = ShortcutStorage.sanitizeIcon(s.icon);
              const color = ShortcutStorage.sanitizeColor(s.color);
              if (icon) clean.icon = icon; else delete clean.icon;
              if (color) clean.color = color; else delete clean.color;
              if (s.openInNewTab === true) clean.openInNewTab = true; else delete clean.openInNewTab;
              return clean;
            });
          const sanitizeGroups = (list) => list.filter(g => isPlainObject(g));

          let plan;
          if (data.workspaces && typeof ShortcutStorage.restoreAllWorkspaceData === 'function') {
            if (!isPlainObject(data.workspaces)) {
              throw new Error('Invalid JSON backup structure: workspaces must be an object');
            }

            let profiles = Array.isArray(data.profiles)
              ? data.profiles
                .filter(p => isPlainObject(p) && typeof p.id === 'string' && p.id && typeof p.name === 'string')
                .map(p => ({ id: p.id, name: p.name }))
              : [];
            if (profiles.length > 0 && !profiles.some(p => p.id === 'profile-default')) {
              profiles.unshift({ id: 'profile-default', name: 'Default' });
            }

            // Only restore workspaces that belong to a known profile
            const knownIds = (profiles.length > 0 ? profiles : await ShortcutStorage.getProfiles()).map(p => p.id);

            const workspaces = {};
            for (const [profileId, ws] of Object.entries(data.workspaces)) {
              if (!knownIds.includes(profileId) || !isPlainObject(ws)) continue;
              const clean = {};
              if (Array.isArray(ws.shortcuts)) clean.shortcuts = sanitizeShortcuts(ws.shortcuts);
              if (Array.isArray(ws.groups)) clean.groups = sanitizeGroups(ws.groups);
              if (isPlainObject(ws.settings)) clean.settings = ws.settings;
              if (typeof ws.gameHighScore === 'number' && Number.isFinite(ws.gameHighScore)) clean.gameHighScore = ws.gameHighScore;
              if (typeof ws.breakerHighScore === 'number' && Number.isFinite(ws.breakerHighScore)) clean.breakerHighScore = ws.breakerHighScore;
              // Widget data (to-dos, notes, layout) is normalized the same way the widgets load it
              if (isPlainObject(ws.widgets)) {
                clean.widgets = typeof ShortcutWidgets !== 'undefined' && ShortcutWidgets.normalize
                  ? ShortcutWidgets.normalize(ws.widgets)
                  : ws.widgets;
              }
              workspaces[profileId] = clean;
            }

            const activeProfileId = (typeof data.activeProfileId === 'string' && knownIds.includes(data.activeProfileId))
              ? data.activeProfileId
              : 'profile-default';

            plan = { type: 'full', payload: { profiles, activeProfileId, workspaces } };

            // Background media blobs keyed by profile (only data: URLs for known profiles)
            if (isPlainObject(data.bgMedia)) {
              plan.bgMedia = {};
              for (const [profileId, media] of Object.entries(data.bgMedia)) {
                if (knownIds.includes(profileId) && typeof media === 'string' && media.startsWith('data:')) {
                  plan.bgMedia[profileId] = media;
                }
              }
            }

            // Arcade wallet is cleaned with the same rules the games use when loading it
            if (isPlainObject(data.arcadeWallet) && typeof ArcadeWallet !== 'undefined') {
              plan.arcadeWallet = ArcadeWallet.normalize(data.arcadeWallet);
            }
          } else if (Array.isArray(data)) {
            // Direct array of shortcuts (e.g. developer-shortcuts.json)
            plan = { type: 'array', shortcuts: sanitizeShortcuts(data) };
          } else {
            // Legacy single-profile fallback
            plan = {
              type: 'legacy',
              shortcuts: Array.isArray(data.shortcuts) ? sanitizeShortcuts(data.shortcuts) : null,
              groups: Array.isArray(data.groups) ? sanitizeGroups(data.groups) : null,
              settings: isPlainObject(data.settings) ? data.settings : null
            };
          }

          // Tell the user exactly what will be replaced
          const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
          let summary;
          if (plan.type === 'full') {
            const wsList = Object.values(plan.payload.workspaces);
            const shortcutCount = wsList.reduce((sum, ws) => sum + (Array.isArray(ws.shortcuts) ? ws.shortcuts.length : 0), 0);
            const profileCount = plan.payload.profiles.length || wsList.length;
            summary = `This backup contains ${plural(shortcutCount, 'shortcut')} across ${plural(profileCount, 'profile')}. ` +
              'Importing will replace your current profiles and their shortcuts, groups and settings.';
          } else {
            const shortcutCount = plan.shortcuts ? plan.shortcuts.length : 0;
            summary = `This backup contains ${plural(shortcutCount, 'shortcut')}. ` +
              'Importing will replace the shortcuts' + (plan.type === 'legacy' ? ', groups and settings' : '') + ' of your current profile.';
          }

          if (!confirm(`${summary}\n\nThis cannot be undone. Continue?`)) {
            resolve(false);
            return;
          }

          if (plan.type === 'full') {
            await ShortcutStorage.restoreAllWorkspaceData(plan.payload);
            if (plan.bgMedia) {
              for (const [profileId, media] of Object.entries(plan.bgMedia)) {
                await ShortcutStorage._setStorageItem(`shortcut_plus_bg_media_${profileId}`, media);
              }
            }
            if (plan.arcadeWallet) {
              // Through the wallet's queue/lock so an in-flight coin update can't overwrite the import
              await ArcadeWallet.replace(plan.arcadeWallet);
            }
          } else if (plan.type === 'array') {
            await ShortcutStorage.saveShortcuts(plan.shortcuts);
          } else {
            if (plan.shortcuts) await ShortcutStorage.saveShortcuts(plan.shortcuts);
            if (plan.groups) await ShortcutStorage.saveGroups(plan.groups);
            if (plan.settings) await ShortcutStorage.saveSettings(plan.settings);
          }

          // Re-render layout & apply imported settings
          if (typeof window.switchProfile === 'function') {
            // switchProfile re-applies theme, background, page layout, layout mode and renders the grid
            const activeId = await ShortcutStorage.getActiveProfileId();
            await window.switchProfile(activeId);
          } else {
            const settings = await ShortcutStorage.getSettings();

            ShortcutGrid.setLayoutMode(settings.layoutMode || 'grid');
            ShortcutGrid.setTileStyle(settings.tileStyle || 'grid');
            DragEngine.setLayoutMode(settings.layoutMode || 'grid');

            if (typeof applyPageLayout === 'function') {
              applyPageLayout(settings);
            }

            if (typeof ThemeEngine !== 'undefined') {
              // Apply without re-saving (settings were just written)
              await ThemeEngine.applySettings(settings);
            }

            await ShortcutGrid.render();
          }

          resolve(true);
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => reject(new Error('Failed to read backup file'));
      reader.readAsText(file);
    });
  }
};
