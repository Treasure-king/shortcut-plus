/* keyboard.js - 2D Grid Arrow Key Matrix Navigation & Global Productivity Hotkeys */

const KeyboardNav = {
  focusedIndex: -1,
  tiles: [],

  init() {
    this.bindEvents();
  },

  updateTiles() {
    this.tiles = Array.from(document.querySelectorAll('#shortcuts-grid .shortcut-card:not(.shortcut-card-add)'))
      .filter(tile => tile.getClientRects().length > 0);
    // Tiles can disappear (delete, collapsed group) between key presses
    if (this.focusedIndex >= this.tiles.length) this.focusedIndex = this.tiles.length - 1;
  },

  bindEvents() {
    document.addEventListener('keydown', (e) => {
      const isInputActive = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      const isRunnerOpen = typeof ShortcutRunner !== 'undefined' && ShortcutRunner.isOpen;
      const isModalOpen = typeof ShortcutModal !== 'undefined' && ShortcutModal.isBlockingModalOpen();
      const isArcadeOpen = typeof ShortcutArcade !== 'undefined' && typeof ShortcutArcade.isAnyGameOpen === 'function' &&
        ShortcutArcade.isAnyGameOpen();

      // Arcade games own the keyboard (they handle their own Escape)
      if (isArcadeOpen) return;

      // If Runner game or Modal drawer is open, suppress background hotkeys and tile navigation
      if (isRunnerOpen || isModalOpen) {
        if (e.key === 'Escape') {
          if (isInputActive && document.activeElement) {
            document.activeElement.blur();
          }
          // The runner handles its own Escape (exit fullscreen first, then close)
          if (!isRunnerOpen && isModalOpen) {
            ShortcutModal.close();
          }
        }
        return;
      }

      // Global Settings Hotkey: Ctrl+, (works even when inputs might be focused)
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        this.openSettings();
        return;
      }

      // Ignore single key shortcuts if user is typing in any text/input field
      if (isInputActive) {
        if (e.key === 'Escape') {
          document.activeElement.blur();
          if (typeof ShortcutModal !== 'undefined' && ShortcutModal.isOpen()) {
            ShortcutModal.close();
          }
        }
        return;
      }

      // The hamburger drawer and Google apps menu handle their own keys (main.js closes them on Escape)
      const drawer = document.getElementById('sidebar-drawer');
      const appsMenu = document.getElementById('google-apps-dropdown');
      if ((drawer && drawer.classList.contains('active')) || (appsMenu && !appsMenu.classList.contains('hidden'))) {
        return;
      }

      // 1. Productivity Single-Key & Alt Hotkeys (when not typing in an input)
      const key = (e.key || '').toLowerCase();
      // Plain letter (no modifiers, no auto-repeat) or the Alt+letter variant
      const isHotkey = (letter) => key === letter && !e.repeat && !e.ctrlKey && !e.metaKey && !e.shiftKey;

      // N / Alt+N: New Shortcut
      if (isHotkey('n')) {
        e.preventDefault();
        if (typeof ShortcutModal !== 'undefined') {
          ShortcutModal.openAdd();
        }
        return;
      }

      // E / Alt+E: Edit Layout Mode Toggle
      if (isHotkey('e')) {
        e.preventDefault();
        const isEditActive = document.body.classList.contains('edit-mode-active');
        if (typeof setEditMode === 'function') {
          setEditMode(!isEditActive);
        } else {
          document.body.classList.toggle('edit-mode-active');
        }
        return;
      }

      // G / Alt+G: Create Group
      if (isHotkey('g')) {
        e.preventDefault();
        if (typeof ShortcutModal !== 'undefined') {
          ShortcutModal.openCreateGroup();
        }
        return;
      }

      // S / Alt+S: Settings & Customization
      if (isHotkey('s')) {
        e.preventDefault();
        this.openSettings();
        return;
      }

      // M / Alt+M: Multi-Select Mode
      if (isHotkey('m')) {
        e.preventDefault();
        if (typeof ShortcutGrid !== 'undefined') {
          ShortcutGrid.setMultiSelectMode(!ShortcutGrid.isMultiSelectMode);
        }
        return;
      }

      // R / Alt+R: open the Arcade game picker
      if (isHotkey('r')) {
        e.preventDefault();
        if (typeof ShortcutArcade !== 'undefined') {
          ShortcutArcade.open();
        } else if (typeof ShortcutRunner !== 'undefined') {
          ShortcutRunner.open();
        }
        return;
      }

      // Escape in edit mode: clear the selection first, then exit edit mode
      if (e.key === 'Escape' && !e.repeat && this.handleEditModeEscape()) {
        e.preventDefault();
        this.clearFocus();
        this.focusedIndex = -1;
        return;
      }

      // 2. Navigation Keys (Arrow keys, Enter, Escape)
      const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape'];
      if (!navKeys.includes(e.key)) return;

      // 2a. Photoshop-Style Arrow Key Nudging (Edit Mode + Free Layout + Selection/Focus)
      const isEditMode = document.body.classList.contains('edit-mode-active');
      const isFreeMode = typeof ShortcutGrid !== 'undefined' && ShortcutGrid.layoutMode === 'free';
      const hasSelection = typeof ShortcutGrid !== 'undefined' && ShortcutGrid.selectedShortcutIds && ShortcutGrid.selectedShortcutIds.size > 0;
      const hasFocused = this.focusedIndex >= 0 && this.tiles && this.tiles[this.focusedIndex];
      const isArrowKey = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key);

      if (isEditMode && isFreeMode && (hasSelection || hasFocused) && isArrowKey) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        switch (e.key) {
          case 'ArrowLeft':  dx = -step; break;
          case 'ArrowRight': dx = step;  break;
          case 'ArrowUp':    dy = -step; break;
          case 'ArrowDown':  dy = step;  break;
        }
        this.nudgeSelectedTiles(dx, dy);
        return;
      }

      // 2b. Normal Grid Navigation (non-edit mode)
      this.updateTiles();
      if (this.tiles.length === 0) return;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          this.moveFocus(1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.moveFocus(-1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.moveFocusGrid('down');
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.moveFocusGrid('up');
          break;
        case 'Enter':
          // Let focused buttons and links activate natively
          if (document.activeElement && ['BUTTON', 'A'].includes(document.activeElement.tagName)) break;
          if (typeof ShortcutGrid !== 'undefined' && ShortcutGrid.selectedShortcutIds && ShortcutGrid.selectedShortcutIds.size > 1) {
            e.preventDefault();
            let mode = 'new-tab';
            if (e.altKey) {
              mode = 'incognito';
            } else if (e.shiftKey) {
              mode = 'new-window';
            }
            ShortcutGrid.openSelectedShortcuts(mode);
            break;
          }

          if (this.focusedIndex >= 0 && this.focusedIndex < this.tiles.length) {
            e.preventDefault();
            const focusedTile = this.tiles[this.focusedIndex];
            const href = focusedTile.getAttribute('href');
            if (href) {
              if (e.altKey) {
                if (typeof ShortcutGrid !== 'undefined' && ShortcutGrid.openInIncognito) {
                  ShortcutGrid.openInIncognito(href);
                } else {
                  window.location.href = href;
                }
              } else if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                if (typeof ShortcutGrid !== 'undefined' && ShortcutGrid.openInNewWindow) {
                  ShortcutGrid.openInNewWindow(href);
                } else {
                  window.open(href, '_blank', 'popup=no');
                }
              } else if (e.ctrlKey || e.metaKey) {
                if (typeof ShortcutGrid !== 'undefined' && ShortcutGrid.openInNewTab) {
                  ShortcutGrid.openInNewTab(href);
                } else {
                  window.open(href, '_blank');
                }
              } else {
                // Plain Enter honours the tile's "open in new tab" setting and special schemes (chrome:// etc.)
                const shortcut = typeof ShortcutGrid !== 'undefined' && ShortcutGrid.shortcuts
                  ? ShortcutGrid.shortcuts.find(s => s.id === focusedTile.dataset.id)
                  : null;
                if (shortcut && ShortcutGrid.openShortcutDefault) {
                  ShortcutGrid.openShortcutDefault(shortcut);
                } else {
                  window.location.href = href;
                }
              }
            }
          }
          break;
        case 'Escape':
          this.clearFocus();
          this.focusedIndex = -1;
          if (document.activeElement) document.activeElement.blur();
          if (typeof ShortcutModal !== 'undefined' && ShortcutModal.isOpen()) {
            ShortcutModal.close();
          }
          break;
      }
    });
  },

  // Escape outside dialogs: first clear the edit-mode selection, then leave edit mode (same as Done)
  handleEditModeEscape() {
    if (!document.body.classList.contains('edit-mode-active')) return false;
    const hasSelection = typeof ShortcutGrid !== 'undefined' && ShortcutGrid.selectedShortcutIds &&
      ShortcutGrid.selectedShortcutIds.size > 0;
    const isInspectorOpen = typeof ShortcutModal !== 'undefined' && ShortcutModal.isOpen() &&
      ShortcutModal.activeViewEl === ShortcutModal.viewInspector;
    if (hasSelection) {
      ShortcutGrid.clearSelection();
      if (isInspectorOpen) ShortcutModal.close();
    } else if (isInspectorOpen) {
      ShortcutModal.close();
    } else if (typeof window.setEditMode === 'function') {
      window.setEditMode(false);
      if (typeof ShortcutGrid !== 'undefined') ShortcutGrid.setMultiSelectMode(false);
    } else {
      document.body.classList.remove('edit-mode-active');
    }
    return true;
  },

  // Prefer main.js's openSettings (it populates the controls); fall back to just opening the view
  openSettings() {
    if (typeof window.openSettings === 'function') {
      window.openSettings();
    } else if (typeof ShortcutModal !== 'undefined') {
      ShortcutModal.openSettings();
    }
  },

  moveFocus(delta) {
    if (this.focusedIndex === -1) {
      this.focusedIndex = delta > 0 ? 0 : this.tiles.length - 1;
    } else {
      this.focusedIndex = (this.focusedIndex + delta + this.tiles.length) % this.tiles.length;
    }
    this.applyFocus();
  },

  moveFocusGrid(direction) {
    if (this.focusedIndex === -1) {
      this.focusedIndex = 0;
      this.applyFocus();
      return;
    }

    // Estimate items per row based on container geometry
    const currentRect = this.tiles[this.focusedIndex].getBoundingClientRect();
    let itemsPerRow = 1;

    for (let i = this.focusedIndex + 1; i < this.tiles.length; i++) {
      const rect = this.tiles[i].getBoundingClientRect();
      if (Math.abs(rect.top - currentRect.top) < 10) {
        itemsPerRow++;
      } else {
        break;
      }
    }

    const delta = direction === 'down' ? itemsPerRow : -itemsPerRow;
    const targetIndex = this.focusedIndex + delta;

    if (targetIndex >= 0 && targetIndex < this.tiles.length) {
      this.focusedIndex = targetIndex;
      this.applyFocus();
    }
  },

  applyFocus() {
    this.clearFocus();
    if (this.focusedIndex >= 0 && this.focusedIndex < this.tiles.length) {
      const tile = this.tiles[this.focusedIndex];
      tile.classList.add('keyboard-focused');
      tile.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  },

  clearFocus() {
    document.querySelectorAll('.shortcut-card.keyboard-focused').forEach(tile => {
      tile.classList.remove('keyboard-focused');
    });
  },

  nudgeSelectedTiles(dx, dy) {
    if (typeof ShortcutGrid === 'undefined') return;
    let selectedIds = Array.from(ShortcutGrid.selectedShortcutIds || []);
    if (selectedIds.length === 0) {
      if (this.focusedIndex >= 0 && this.tiles && this.tiles[this.focusedIndex]) {
        const id = this.tiles[this.focusedIndex].dataset.id;
        if (id) selectedIds = [id];
      }
    }
    if (selectedIds.length === 0) return;

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    // 1. Gather all target cards and compute their true pixel positions
    const cardsData = [];
    let groupMinX = Infinity, groupMaxX = -Infinity;
    let groupMinY = Infinity, groupMaxY = -Infinity;

    selectedIds.forEach(id => {
      const card = document.querySelector(`#shortcuts-grid .shortcut-card[data-id="${CSS.escape(id)}"]`);
      // Only free-placed tiles can be nudged; grouped tiles live in their group's grid
      if (!card || !card.classList.contains('shortcut-card-free')) return;

      // Visual box (ignores the selection scale transform) and stored free position
      const rect = DragEngine.getVisualRect(card);
      const cardW = rect.width;
      const cardH = rect.height;
      const start = DragEngine.getFreePositionPx(card);
      const pxX = start.x;
      const pxY = start.y;
      // Clamp against the on-screen box, which may be offset from the stored position by margins
      const boxX = rect.left;
      const boxY = rect.top;

      cardsData.push({ id, card, pxX, pxY, cardW, cardH });

      if (boxX < groupMinX) groupMinX = boxX;
      if (boxX + cardW > groupMaxX) groupMaxX = boxX + cardW;
      if (boxY < groupMinY) groupMinY = boxY;
      if (boxY + cardH > groupMaxY) groupMaxY = boxY + cardH;
    });

    if (cardsData.length === 0) return;

    // 2. Uniform Viewport Clamping:
    // Clamp the delta (dx, dy) for the ENTIRE group as a rigid unit so items NEVER compress into each other!
    let effectiveDx = dx;
    let effectiveDy = dy;

    if (effectiveDx < 0 && groupMinX + effectiveDx < 2) {
      effectiveDx = Math.min(0, 2 - groupMinX);
    } else if (effectiveDx > 0 && groupMaxX + effectiveDx > screenW - 2) {
      effectiveDx = Math.max(0, (screenW - 2) - groupMaxX);
    }

    if (effectiveDy < 0 && groupMinY + effectiveDy < 2) {
      effectiveDy = Math.min(0, 2 - groupMinY);
    } else if (effectiveDy > 0 && groupMaxY + effectiveDy > screenH - 2) {
      effectiveDy = Math.max(0, (screenH - 2) - groupMaxY);
    }

    if (effectiveDx === 0 && effectiveDy === 0) return;

    // 3. Apply the EXACT SAME delta to every card (NO independent magnetic snapping during nudge!)
    // Pending positions accumulate across key presses so nudging tile A then quickly tile B saves both
    if (!this._pendingNudge) this._pendingNudge = new Map();
    let lastCard = null;

    cardsData.forEach(({ id, card, pxX, pxY }) => {
      const position = DragEngine.setFreePosition(card, pxX + effectiveDx, pxY + effectiveDy);
      this._pendingNudge.set(id, position);
      lastCard = card;
    });

    // 4. Debounced, single batched write per burst of key presses (undoable as one step)
    clearTimeout(this._nudgeSaveTimer);
    this._nudgeSaveTimer = setTimeout(async () => {
      if (typeof ShortcutStorage === 'undefined') return;
      const byId = this._pendingNudge || new Map();
      this._pendingNudge = null;
      if (byId.size === 0) return;
      try {
        if (typeof AlignEngine !== 'undefined') await AlignEngine.checkpoint();
        await ShortcutStorage.transaction(async () => {
          const shortcuts = await ShortcutStorage.getShortcuts();
          await ShortcutStorage.saveShortcuts(shortcuts.map(s => byId.has(s.id)
            ? { ...s, position: byId.get(s.id), hasCustomPosition: true }
            : s));
        });
      } catch (err) {
        console.error('[KeyboardNav] Failed to save nudge:', err);
      }
    }, 250);

    // 5. Show nudge distance tooltip near the last moved tile
    if (lastCard) {
      let arrow = '';
      if (dx > 0) arrow = '→';
      else if (dx < 0) arrow = '←';
      else if (dy > 0) arrow = '↓';
      else if (dy < 0) arrow = '↑';
      const amount = Math.abs(dx || dy);
      this.showNudgeTooltip(lastCard, `${amount}px ${arrow}`);
    }
  },

  showNudgeTooltip(anchorEl, text) {
    // Remove any existing tooltip
    const existing = document.querySelector('.nudge-tooltip');
    if (existing) existing.remove();

    const tooltip = document.createElement('div');
    tooltip.className = 'nudge-tooltip';
    tooltip.textContent = text;
    document.body.appendChild(tooltip);

    const rect = anchorEl.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2 - 24}px`;
    tooltip.style.top = `${rect.top - 28}px`;

    // Auto-remove after animation completes
    setTimeout(() => {
      if (tooltip.parentNode) tooltip.remove();
    }, 800);
  }
};
