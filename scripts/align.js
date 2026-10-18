/* align.js - Figma-style Align, Distribute & Tidy Up for selected free-placement tiles, plus layout Undo/Redo */

const AlignEngine = {
  undoStack: [],
  redoStack: [],
  MAX_HISTORY: 50,
  barEl: null,
  isBusy: false,

  // Minimum selection size per action (a single tile aligns to the viewport, like Figma aligns to its frame)
  ACTION_MIN: {
    'align-left': 1, 'align-hcenter': 1, 'align-right': 1,
    'align-top': 1, 'align-vcenter': 1, 'align-bottom': 1,
    'distribute-h': 3, 'distribute-v': 3,
    'tidy': 2
  },

  ACTION_LABELS: {
    'align-left': 'Aligned left', 'align-hcenter': 'Aligned horizontal centers', 'align-right': 'Aligned right',
    'align-top': 'Aligned top', 'align-vcenter': 'Aligned vertical centers', 'align-bottom': 'Aligned bottom',
    'distribute-h': 'Distributed horizontally', 'distribute-v': 'Distributed vertically',
    'tidy': 'Tidied up into a grid'
  },

  init() {
    this.barEl = document.getElementById('align-bar');
    if (this.barEl) {
      this.barEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-align-action]');
        if (!btn || btn.disabled) return;
        const action = btn.dataset.alignAction;
        if (action === 'undo') this.undo();
        else if (action === 'redo') this.redo();
        else this.run(action);
      });
      // Keep pointerdown on the palette from starting a marquee or clearing the selection
      this.barEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    // Capture phase so these win over the single-key hotkeys in keyboard.js (e.g. Alt+S)
    window.addEventListener('keydown', (e) => this.handleKeydown(e), true);

    // Re-evaluate the palette whenever edit mode or layout mode flips
    const observer = new MutationObserver(() => this.refreshToolbar());
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const grid = document.getElementById('shortcuts-grid');
    if (grid) observer.observe(grid, { attributes: true, attributeFilter: ['class'] });

    this.refreshToolbar();
  },

  isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  },

  // True while a dialog, drawer or game owns the keyboard (the non-modal Inspector panel does not count)
  isBlockingOverlayOpen() {
    if (typeof ShortcutModal !== 'undefined' && ShortcutModal.isOpen() &&
        ShortcutModal.activeViewEl !== ShortcutModal.viewInspector) return true;
    if (typeof ShortcutRunner !== 'undefined' && ShortcutRunner.isOpen) return true;
    if (typeof ShortcutArcade !== 'undefined' && typeof ShortcutArcade.isAnyGameOpen === 'function' &&
        ShortcutArcade.isAnyGameOpen()) return true;
    return false;
  },

  handleKeydown(e) {
    if (this.isTypingTarget(document.activeElement)) return;
    if (this.isBlockingOverlayOpen()) return;

    const mod = e.ctrlKey || e.metaKey;

    // Undo / Redo: Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y
    if (mod && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
      const isRedo = e.code === 'KeyY' || e.shiftKey;
      const stack = isRedo ? this.redoStack : this.undoStack;
      if (stack.length === 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (isRedo) this.redo(); else this.undo();
      return;
    }

    if (!document.body.classList.contains('edit-mode-active')) return;
    // Only claim Alt+letter combos where they apply, so e.g. Alt+S still opens Settings elsewhere
    if (typeof ShortcutGrid === 'undefined' || ShortcutGrid.layoutMode !== 'free' || ShortcutGrid.selectedShortcutIds.size === 0) return;

    // Figma keymap: Alt+A/H/D (left/center/right), Alt+W/V/S (top/middle/bottom),
    // Alt+Shift+H/V (distribute), Ctrl+Alt+T (tidy up)
    let action = null;
    if (e.altKey && mod && !e.shiftKey && e.code === 'KeyT') {
      action = 'tidy';
    } else if (e.altKey && !mod && e.shiftKey) {
      if (e.code === 'KeyH') action = 'distribute-h';
      else if (e.code === 'KeyV') action = 'distribute-v';
    } else if (e.altKey && !mod && !e.shiftKey) {
      action = {
        KeyA: 'align-left', KeyH: 'align-hcenter', KeyD: 'align-right',
        KeyW: 'align-top', KeyV: 'align-vcenter', KeyS: 'align-bottom'
      }[e.code] || null;
    }
    if (!action) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    this.run(action);
  },

  toast(message) {
    if (typeof window !== 'undefined' && window.showToast) window.showToast(message);
  },

  // Selected tiles that are freely positioned on the canvas (grouped tiles stay inside their group grid)
  getSelectedCards() {
    if (typeof ShortcutGrid === 'undefined') return [];
    const grid = document.getElementById('shortcuts-grid');
    if (!grid) return [];
    return Array.from(ShortcutGrid.selectedShortcutIds)
      .map(id => grid.querySelector(`.shortcut-card[data-id="${CSS.escape(id)}"]`))
      .filter(el => el && el.classList.contains('shortcut-card-free') && el.getClientRects().length > 0);
  },

  refreshToolbar() {
    if (!this.barEl) return;
    const isEdit = document.body.classList.contains('edit-mode-active');
    const isFree = typeof ShortcutGrid !== 'undefined' && ShortcutGrid.layoutMode === 'free';
    const count = typeof ShortcutGrid !== 'undefined' ? ShortcutGrid.selectedShortcutIds.size : 0;

    this.barEl.classList.toggle('active', isEdit && isFree);
    this.barEl.setAttribute('aria-hidden', isEdit && isFree ? 'false' : 'true');

    this.barEl.querySelectorAll('[data-align-action]').forEach(btn => {
      const action = btn.dataset.alignAction;
      if (action === 'undo') btn.disabled = this.undoStack.length === 0;
      else if (action === 'redo') btn.disabled = this.redoStack.length === 0;
      else btn.disabled = count < (this.ACTION_MIN[action] || 1);
    });
  },

  // ---------- Align / Distribute / Tidy ----------

  async run(action) {
    if (this.isBusy) return;
    if (typeof ShortcutGrid === 'undefined' || typeof DragEngine === 'undefined') return;

    if (ShortcutGrid.layoutMode !== 'free') {
      this.toast('Switch to Free Placement to align tiles.');
      return;
    }

    const cards = this.getSelectedCards();
    const min = this.ACTION_MIN[action] || 1;
    if (cards.length < min) {
      this.toast(min === 1
        ? 'Select a free-placed tile to align.'
        : `Select at least ${min} free-placed tiles for this action.`);
      return;
    }

    const items = cards.map(el => ({ el, id: el.dataset.id, rect: DragEngine.getVisualRect(el) }));
    const targets = this.computeTargets(action, items);
    if (!targets) return;

    this.isBusy = true;
    try {
      await this.checkpoint();
      const moved = this.applyTargets(items, targets);
      await this.persistPositions(moved);
      this.toast(this.ACTION_LABELS[action] || 'Arranged');
    } finally {
      this.isBusy = false;
      this.refreshToolbar();
    }
  },

  // Returns Map<item, {left, top}> of desired visual positions
  computeTargets(action, items) {
    const targets = new Map();
    const bounds = items.length === 1 ? this.viewportBounds() : this.unionBounds(items.map(i => i.rect));

    const setPos = (item, left, top) => targets.set(item, { left, top });

    switch (action) {
      case 'align-left':
        items.forEach(i => setPos(i, bounds.left, i.rect.top)); break;
      case 'align-hcenter':
        items.forEach(i => setPos(i, bounds.centerX - i.rect.width / 2, i.rect.top)); break;
      case 'align-right':
        items.forEach(i => setPos(i, bounds.right - i.rect.width, i.rect.top)); break;
      case 'align-top':
        items.forEach(i => setPos(i, i.rect.left, bounds.top)); break;
      case 'align-vcenter':
        items.forEach(i => setPos(i, i.rect.left, bounds.centerY - i.rect.height / 2)); break;
      case 'align-bottom':
        items.forEach(i => setPos(i, i.rect.left, bounds.bottom - i.rect.height)); break;
      case 'distribute-h':
        this.distribute(items, 'x').forEach((left, i) => setPos(i, left, i.rect.top)); break;
      case 'distribute-v':
        this.distribute(items, 'y').forEach((top, i) => setPos(i, i.rect.left, top)); break;
      case 'tidy':
        return this.tidyUp(items, bounds);
      default:
        return null;
    }
    return targets;
  },

  // Equal gaps between neighbours; the first and last tiles along the axis stay put (Figma behaviour)
  distribute(items, axis) {
    const start = axis === 'x' ? 'left' : 'top';
    const end = axis === 'x' ? 'right' : 'bottom';
    const size = axis === 'x' ? 'width' : 'height';

    const sorted = [...items].sort((a, b) => a.rect[start] - b.rect[start]);
    const first = sorted[0];
    const span = Math.max(...sorted.map(i => i.rect[end])) - first.rect[start];
    const totalSize = sorted.reduce((sum, i) => sum + i.rect[size], 0);
    const gap = (span - totalSize) / (sorted.length - 1);

    const result = new Map();
    let cursor = first.rect[start];
    sorted.forEach(item => {
      result.set(item, cursor);
      cursor += item.rect[size] + gap;
    });
    return result;
  },

  // Arrange the selection into a tidy grid, preserving reading order (rows top-to-bottom, left-to-right)
  tidyUp(items, bounds) {
    const avgHeight = items.reduce((s, i) => s + i.rect.height, 0) / items.length;
    const byY = [...items].sort((a, b) => a.rect.centerY - b.rect.centerY);

    const rows = [];
    byY.forEach(item => {
      const row = rows[rows.length - 1];
      if (row && Math.abs(item.rect.centerY - row.centerY) < avgHeight / 2) {
        row.items.push(item);
        row.centerY = row.items.reduce((s, i) => s + i.rect.centerY, 0) / row.items.length;
      } else {
        rows.push({ items: [item], centerY: item.rect.centerY });
      }
    });
    rows.forEach(row => row.items.sort((a, b) => a.rect.left - b.rect.left));
    const ordered = rows.flatMap(row => row.items);

    // Keep the user's column count if it looks intentional, otherwise aim for a near-square grid
    let cols = Math.max(...rows.map(r => r.items.length));
    if (rows.length === 1 && items.length > 6) cols = Math.ceil(Math.sqrt(items.length));
    const cellW = Math.max(...items.map(i => i.rect.width));
    const cellH = Math.max(...items.map(i => i.rect.height));
    const gap = this.estimateGap(rows, cellW);

    // Shrink columns until the grid fits horizontally inside the viewport
    const maxWidth = window.innerWidth - bounds.left - 8;
    while (cols > 1 && cols * cellW + (cols - 1) * gap > maxWidth) cols--;

    const targets = new Map();
    ordered.forEach((item, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      // Center each tile inside its cell so mixed sizes still line up
      const left = bounds.left + col * (cellW + gap) + (cellW - item.rect.width) / 2;
      const top = bounds.top + row * (cellH + gap) + (cellH - item.rect.height) / 2;
      targets.set(item, { left, top });
    });
    return targets;
  },

  estimateGap(rows, cellW) {
    const gaps = [];
    rows.forEach(row => {
      for (let i = 1; i < row.items.length; i++) {
        const g = row.items[i].rect.left - row.items[i - 1].rect.right;
        if (g > 0) gaps.push(g);
      }
    });
    if (gaps.length === 0) return 16;
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    return Math.round(Math.max(8, Math.min(median, cellW)));
  },

  viewportBounds() {
    // Same safe area the drag engine clamps to
    const left = DragEngine.getMinFreeLeft(), top = 50, right = window.innerWidth - 8, bottom = window.innerHeight - 40;
    return { left, top, right, bottom, centerX: window.innerWidth / 2, centerY: window.innerHeight / 2 };
  },

  unionBounds(rects) {
    const left = Math.min(...rects.map(r => r.left));
    const top = Math.min(...rects.map(r => r.top));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return { left, top, right, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
  },

  // Converts desired visual positions into stored vw/vh coordinates, clamped to the viewport
  applyTargets(items, targets) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const moved = [];
    items.forEach(item => {
      const target = targets.get(item);
      if (!target) return;
      const left = Math.max(DragEngine.getMinFreeLeft(), Math.min(W - item.rect.width - 8, target.left));
      const top = Math.max(50, Math.min(Math.max(50, H - item.rect.height - 40), target.top));
      const start = DragEngine.getFreePositionPx(item.el);
      const pos = DragEngine.setFreePosition(item.el, start.x + (left - item.rect.left), start.y + (top - item.rect.top));
      moved.push({ id: item.id, position: pos });
    });
    return moved;
  },

  async persistPositions(moved) {
    if (moved.length === 0) return;
    const byId = new Map(moved.map(m => [m.id, m.position]));
    await ShortcutStorage.transaction(async () => {
      const shortcuts = await ShortcutStorage.getShortcuts();
      const updated = shortcuts.map(s => byId.has(s.id)
        ? { ...s, position: byId.get(s.id), hasCustomPosition: true, updatedAt: Date.now() }
        : s);
      await ShortcutStorage.saveShortcuts(updated);
    });
  },

  // ---------- Undo / Redo (layout only: positions, sizes, order and group membership) ----------

  async captureSnapshot() {
    const key = await ShortcutStorage.getShortcutsKey();
    const shortcuts = await ShortcutStorage.getShortcuts();
    const groups = await ShortcutStorage.getGroups();
    const pick = (obj, fields) => {
      const out = {};
      fields.forEach(f => { out[f] = obj[f] === undefined ? undefined : JSON.parse(JSON.stringify(obj[f])); });
      return out;
    };
    return {
      key,
      shortcuts: Object.fromEntries(shortcuts.map(s => [s.id, pick(s, ['position', 'hasCustomPosition', 'size', 'groupId', 'order'])])),
      groups: Object.fromEntries(groups.map(g => [g.id, pick(g, ['position', 'hasCustomPosition', 'size', 'order'])]))
    };
  },

  // Call right before persisting any layout change so it can be undone
  async checkpoint() {
    try {
      const snapshot = await this.captureSnapshot();
      this.undoStack.push(snapshot);
      if (this.undoStack.length > this.MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
    } catch (err) {
      console.warn('[AlignEngine] Could not record undo checkpoint:', err);
    }
    this.refreshToolbar();
  },

  async applySnapshot(snapshot) {
    const groups = await ShortcutStorage.getGroups();
    const groupIds = new Set(groups.map(g => g.id));
    const shortcuts = await ShortcutStorage.getShortcuts();
    await ShortcutStorage.saveShortcuts(shortcuts.map(s => {
      const record = snapshot.shortcuts[s.id];
      if (!record) return s;
      // A group deleted since the checkpoint can't be restored by layout undo; keep the tile ungrouped
      const groupId = record.groupId && groupIds.has(record.groupId) ? record.groupId : null;
      return { ...s, ...record, groupId };
    }));
    await ShortcutStorage.saveGroups(groups.map(g => snapshot.groups[g.id] ? { ...g, ...snapshot.groups[g.id] } : g));
  },

  async stepHistory(fromStack, toStack, label) {
    if (this.isBusy || fromStack.length === 0) return;
    this.isBusy = true;
    let applied = false;
    try {
      await ShortcutStorage.transaction(async () => {
        const snapshot = fromStack.pop();
        const current = await this.captureSnapshot();
        if (current.key !== snapshot.key) {
          // History belongs to another workspace profile; drop it rather than corrupt this one
          this.undoStack = [];
          this.redoStack = [];
          return;
        }
        toStack.push(current);
        await this.applySnapshot(snapshot);
        applied = true;
      });
      if (applied) {
        await ShortcutGrid.render();
        this.toast(label);
      }
    } catch (err) {
      console.error(`[AlignEngine] ${label} failed:`, err);
    } finally {
      this.isBusy = false;
      this.refreshToolbar();
    }
  },

  undo() {
    return this.stepHistory(this.undoStack, this.redoStack, 'Undo');
  },

  redo() {
    return this.stepHistory(this.redoStack, this.undoStack, 'Redo');
  },

  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.refreshToolbar();
  }
};
