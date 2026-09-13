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

    const payload = {
      app: 'Shortcut+',
      version: '1.1.0',
      exportedAt: new Date().toISOString(),
      shortcuts,
      groups,
      settings,
      profiles: workspaceData.profiles,
      activeProfileId: workspaceData.activeProfileId,
      workspaces: workspaceData.workspaces
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

          // Full Multi-Profile Restore
          if (data.workspaces && typeof ShortcutStorage.restoreAllWorkspaceData === 'function') {
            await ShortcutStorage.restoreAllWorkspaceData(data);
          } else if (Array.isArray(data)) {
            // Direct array of shortcuts (e.g. developer-shortcuts.json)
            await ShortcutStorage.saveShortcuts(data);
          } else {
            // Legacy single-profile fallback
            if (Array.isArray(data.shortcuts)) {
              await ShortcutStorage.saveShortcuts(data.shortcuts);
            }
            if (Array.isArray(data.groups)) {
              await ShortcutStorage.saveGroups(data.groups);
            }
            if (data.settings && typeof data.settings === 'object') {
              await ShortcutStorage.saveSettings(data.settings);
            }
          }

          // Re-render layout & apply imported settings
          const settings = await ShortcutStorage.getSettings();

          ShortcutGrid.setLayoutMode(settings.layoutMode || 'grid');
          ShortcutGrid.setTileStyle(settings.tileStyle || 'grid');
          DragEngine.setLayoutMode(settings.layoutMode || 'grid');

          if (typeof applyPageLayout === 'function') {
            applyPageLayout(settings);
          }

          if (typeof ThemeEngine !== 'undefined') {
            await ThemeEngine.setTheme(settings.themeMode || 'system');
            ThemeEngine.setBackground(settings.bgMode || 'default', settings.bgCustomUrl || '');
          }

          if (typeof window.switchProfile === 'function') {
            const activeId = await ShortcutStorage.getActiveProfileId();
            await window.switchProfile(activeId);
          } else {
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
