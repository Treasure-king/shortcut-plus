/* keyboard.js - 2D Grid Arrow Key Matrix Navigation & Global Productivity Hotkeys */

const KeyboardNav = {
  focusedIndex: -1,
  tiles: [],

  init() {
    this.bindEvents();
  },

  updateTiles() {
    this.tiles = Array.from(document.querySelectorAll('.shortcut-card:not(.shortcut-card-add)'))
      .filter(tile => getComputedStyle(tile).display !== 'none');
  },

  bindEvents() {
    document.addEventListener('keydown', (e) => {
      const isInputActive = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      const isRunnerOpen = typeof ShortcutRunner !== 'undefined' && ShortcutRunner.isOpen;
      const isModalOpen = typeof ShortcutModal !== 'undefined' && ShortcutModal.isOpen();

      // If Runner game or Modal drawer is open, suppress background hotkeys and tile navigation
      if (isRunnerOpen || isModalOpen) {
        if (e.key === 'Escape') {
          if (isInputActive && document.activeElement) {
            document.activeElement.blur();
          }
          if (isRunnerOpen) {
            ShortcutRunner.close();
          } else if (isModalOpen) {
            ShortcutModal.close();
          }
        }
        return;
      }

      // Global Settings Hotkey: Ctrl+, (works even when inputs might be focused)
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        if (typeof ShortcutModal !== 'undefined') {
          ShortcutModal.openSettings();
        }
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

      // 1. Productivity Single-Key & Alt Hotkeys (when not typing in an input)
      const key = e.key.toLowerCase();

      // N / Alt+N: New Shortcut
      if ((key === 'n' && !e.ctrlKey && !e.metaKey) || (e.altKey && key === 'n')) {
        e.preventDefault();
        if (typeof ShortcutModal !== 'undefined') {
          ShortcutModal.openAdd();
        }
        return;
      }

      // E / Alt+E: Edit Layout Mode Toggle
      if ((key === 'e' && !e.ctrlKey && !e.metaKey) || (e.altKey && key === 'e')) {
        e.preventDefault();
        const isEditActive = document.body.classList.contains('edit-mode-active');
        if (typeof setEditMode === 'function') {
          setEditMode(!isEditActive);
        } else {
          document.body.classList.toggle('edit-mode-active');
        }
        return;
      }

      // G / Alt+G: Create Category Group
      if ((key === 'g' && !e.ctrlKey && !e.metaKey) || (e.altKey && key === 'g')) {
        e.preventDefault();
        if (typeof ShortcutModal !== 'undefined') {
          ShortcutModal.openCreateGroup();
        }
        return;
      }

      // S / Alt+S: Settings & Customization
      if ((key === 's' && !e.ctrlKey && !e.metaKey) || (e.altKey && key === 's')) {
        e.preventDefault();
        if (typeof ShortcutModal !== 'undefined') {
          ShortcutModal.openSettings();
        }
        return;
      }

      // M / Alt+M: Multi-Select Mode
      if ((key === 'm' && !e.ctrlKey && !e.metaKey) || (e.altKey && key === 'm')) {
        e.preventDefault();
        if (typeof ShortcutGrid !== 'undefined') {
          ShortcutGrid.setMultiSelectMode(!ShortcutGrid.isMultiSelectMode);
        }
        return;
      }

      // R / Alt+R: Play Shortcut Runner Arcade Game
      if ((key === 'r' && !e.ctrlKey && !e.metaKey) || (e.altKey && key === 'r')) {
        e.preventDefault();
        if (typeof ShortcutRunner !== 'undefined') {
          ShortcutRunner.open();
        }
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
                window.location.href = href;
              }
            }
          }
          break;
        case 'Escape':
          this.clearFocus();
          if (document.activeElement) document.activeElement.blur();
          if (typeof ShortcutModal !== 'undefined' && ShortcutModal.isOpen()) {
            ShortcutModal.close();
          }
          break;
      }
    });
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
      const card = document.querySelector(`.shortcut-card[data-id="${id}"]`);
      if (!card) return;

      const cardW = card.offsetWidth || 112;
      const cardH = card.offsetHeight || 112;

      let pxX, pxY;
      if (card.dataset.posPxX !== undefined && card.dataset.posPxY !== undefined &&
          card.dataset.posPxX !== '' && card.dataset.posPxY !== '') {
        pxX = parseFloat(card.dataset.posPxX);
        pxY = parseFloat(card.dataset.posPxY);
      } else if (card.dataset.posX !== undefined && card.dataset.posY !== undefined &&
                 card.dataset.posX !== '' && card.dataset.posY !== '') {
        pxX = (parseFloat(card.dataset.posX) / 100) * screenW;
        pxY = (parseFloat(card.dataset.posY) / 100) * screenH;
      } else if (card.style.left && card.style.top) {
        if (card.style.left.endsWith('vw')) {
          pxX = (parseFloat(card.style.left) / 100) * screenW;
        } else if (card.style.left.endsWith('px')) {
          pxX = parseFloat(card.style.left);
        } else {
          pxX = card.offsetLeft;
        }
        if (card.style.top.endsWith('vh')) {
          pxY = (parseFloat(card.style.top) / 100) * screenH;
        } else if (card.style.top.endsWith('px')) {
          pxY = parseFloat(card.style.top);
        } else {
          pxY = card.offsetTop;
        }
      } else {
        pxX = card.offsetLeft;
        pxY = card.offsetTop;
      }

      cardsData.push({ id, card, pxX, pxY, cardW, cardH });

      if (pxX < groupMinX) groupMinX = pxX;
      if (pxX + cardW > groupMaxX) groupMaxX = pxX + cardW;
      if (pxY < groupMinY) groupMinY = pxY;
      if (pxY + cardH > groupMaxY) groupMaxY = pxY + cardH;
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
    const updatesToPersist = [];
    let lastCard = null;

    cardsData.forEach(({ id, card, pxX, pxY }) => {
      const newPxX = pxX + effectiveDx;
      const newPxY = pxY + effectiveDy;

      // Keep exact pixel precision in dataset to prevent rounding loss over repeated keypresses
      card.dataset.posPxX = newPxX;
      card.dataset.posPxY = newPxY;

      // High precision viewport percentages
      const relX = (newPxX / screenW) * 100;
      const relY = (newPxY / screenH) * 100;

      card.style.position = 'fixed';
      card.style.left = `${relX.toFixed(3)}vw`;
      card.style.top = `${relY.toFixed(3)}vh`;
      card.dataset.posX = relX.toFixed(3);
      card.dataset.posY = relY.toFixed(3);

      updatesToPersist.push({
        id,
        position: { x: parseFloat(relX.toFixed(2)), y: parseFloat(relY.toFixed(2)) },
        hasCustomPosition: true
      });

      lastCard = card;
    });

    // 4. Debounced storage update to prevent concurrent async storage write race conditions
    clearTimeout(this._nudgeSaveTimer);
    this._nudgeSaveTimer = setTimeout(async () => {
      if (typeof ShortcutStorage !== 'undefined') {
        for (const update of updatesToPersist) {
          await ShortcutStorage.updateShortcut(update.id, {
            position: update.position,
            hasCustomPosition: true
          });
        }
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
