/* drag.js - Pointer Events Drag Engine with Ultra-Accurate X,Y Alignment Rays & Magnetic Snapping */

const DragEngine = {
  // Tile Drag State
  activeTile: null,
  ghostEl: null,
  startPos: { x: 0, y: 0 },
  initialOffset: { x: 0, y: 0 },
  isDragging: false,
  justDragged: false,
  lastDraggedId: null,
  lastDragTime: 0,
  container: null,
  layoutMode: 'grid', // 'grid' | 'free'
  hoveredGroupId: undefined,

  // Marquee Selection State (Photoshop / Figma style)
  isMarqueeSelecting: false,
  isMarqueeCandidate: false,
  marqueeStartPos: { x: 0, y: 0 },
  marqueeBoxEl: null,
  marqueeHasModifier: false,
  initialSelectionSnapshot: null,

  // Multi-Tile Group Drag State
  selectedTilesData: [],
  dragItems: [],        // every element moving in the current drag: { id, el, startX, startY, rect }
  dragStartBox: null,   // bounding box of dragItems at drag start (snapped as one unit)
  snapTargets: [],      // cached boxes of static elements, collected once per drag
  justSelectedId: null,

  // Group Section Drag State
  activeGroupSection: null,
  isGroupDragging: false,
  wasGroupJustDragged: false,
  groupStartPos: { x: 0, y: 0 },

  // Main Component Section Drag State (Google Logo & Search Bar)
  activeMainSection: null,
  mainSectionId: null,
  isSectionDragging: false,
  sectionStartPos: { x: 0, y: 0 },
  sectionOffset: { x: 0, y: 0 },

  // Resizing State
  activeResizingEl: null,
  resizeTargetType: null, // 'shortcut' | 'group' | 'logo' | 'search'
  resizeTargetId: null,
  isResizing: false,
  justResized: false,
  lastResizedId: null,
  lastResizeTime: 0,
  resizeStartPos: { x: 0, y: 0 },
  resizeStartSize: { width: 0, height: 0 },

  // Smart Guides Overlay Element
  smartGuidesSvgEl: null,

  init(containerElement, layoutMode = 'grid') {
    this.container = containerElement;
    this.layoutMode = layoutMode;
    this.smartGuidesSvgEl = document.getElementById('smart-guides-svg');
    this.bindEvents();
  },

  setLayoutMode(mode) {
    this.layoutMode = mode;
    if (mode === 'free') {
      this.recalculateFreePositions();
    }
  },

  recalculateFreePositions() {
    if (this.layoutMode !== 'free') return;

    const freeElements = Array.from(document.querySelectorAll(
      '#google-logo-section.has-free-position, ' +
      '#search-bar-section.has-free-position, ' +
      '.shortcut-group-section.group-section-free, ' +
      '.shortcut-card.shortcut-card-free'
    )).filter(el => el.getClientRects().length > 0 && !el.closest('.hidden'));

    if (freeElements.length === 0) return;

    const winW = window.innerWidth;
    const winH = window.innerHeight;

    // Viewport Boundary clamping for every free element (keeps inside visible screen)
    freeElements.forEach(el => {
      const rect = el.getBoundingClientRect();
      let posX = parseFloat(el.dataset.posX);
      let posY = parseFloat(el.dataset.posY);

      if (isNaN(posX) || isNaN(posY)) return;

      let pixelX = (posX / 100) * winW;
      let pixelY = (posY / 100) * winH;
      let changed = false;

      const minTop = 50;
      const maxTop = Math.max(minTop, winH - rect.height - 40);

      if (rect.right > winW - 8) {
        pixelX = Math.max(8, winW - rect.width - 8);
        changed = true;
      }
      if (rect.left < 8) {
        pixelX = 8;
        changed = true;
      }
      if (pixelY < minTop || rect.top < minTop) {
        pixelY = minTop;
        changed = true;
      } else if (rect.bottom > winH - 40) {
        pixelY = maxTop;
        changed = true;
      }

      if (changed) {
        const newVw = (pixelX / winW) * 100;
        const newVh = (pixelY / winH) * 100;
        el.style.left = `${newVw.toFixed(2)}vw`;
        el.style.top = `${newVh.toFixed(2)}vh`;
        el.dataset.posX = newVw.toFixed(2);
        el.dataset.posY = newVh.toFixed(2);
      }
    });
  },

  wasJustDragged(id) {
    if (this.justDragged) return true;
    if (this.lastDraggedId && this.lastDraggedId === id && (Date.now() - this.lastDragTime) < 500) {
      return true;
    }
    return false;
  },

  wasJustResized(id) {
    if (this.isResizing || this.justResized) return true;
    if (this.lastResizedId && this.lastResizedId === id && (Date.now() - this.lastResizeTime) < 500) {
      return true;
    }
    return false;
  },

  bindEvents() {
    if (!this.container) return;

    document.body.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    window.addEventListener('pointermove', (e) => this.handlePointerMove(e));
    window.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    window.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
    window.addEventListener('blur', () => {
      if (this.isDragging || this.isGroupDragging || this.isSectionDragging || this.isResizing || this.isMarqueeSelecting) {
        this.handlePointerUp();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.isDragging || this.isGroupDragging || this.isSectionDragging || this.isResizing || this.isMarqueeSelecting)) {
        this.handlePointerUp();
      }
    });
  },

  handlePointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const isEditMode = document.body.classList.contains('edit-mode-active');
    // STRICT DRAG LOCK: Dragging & resizing only allowed when Edit Mode is active!
    if (!isEditMode) return;

    // 0. Check for Dynamic Resizing Handle Click
    const resizeHandle = e.target.closest('.resize-handle');
    if (resizeHandle) {
      e.preventDefault();
      e.stopPropagation();
      const resizableParent = resizeHandle.closest('.shortcut-card, .shortcut-group-section, #google-logo-section, #search-bar-section');
      if (resizableParent) {
        this.activeResizingEl = resizableParent;
        this.isResizing = true;
        this.resizeStartPos = { x: e.clientX, y: e.clientY };
        document.body.classList.add('is-actively-dragging');

        const rect = resizableParent.getBoundingClientRect();
        this.resizeStartSize = { width: rect.width, height: rect.height };

        if (resizableParent.classList.contains('shortcut-card')) {
          this.resizeTargetType = 'shortcut';
          this.resizeTargetId = resizableParent.dataset.id;
        } else if (resizableParent.classList.contains('shortcut-group-section')) {
          this.resizeTargetType = 'group';
          this.resizeTargetId = resizableParent.dataset.groupId;
        } else if (resizableParent.id === 'google-logo-section') {
          this.resizeTargetType = 'logo';
          this.resizeTargetId = 'logo';
        } else if (resizableParent.id === 'search-bar-section') {
          this.resizeTargetType = 'search';
          this.resizeTargetId = 'search';
        }
        return;
      }
    }

    // 1. Check for Main Component Section Dragging (Google Logo or Search Bar)
    const logoSection = e.target.closest('#google-logo-section');
    const searchSection = e.target.closest('#search-bar-section');

    // Logo / search bar can only be repositioned in Free Placement mode (grid mode keeps them in the flow)
    if ((logoSection || searchSection) && this.layoutMode === 'free' &&
        !e.target.closest('.section-edit-btn:not(.section-drag-handle)') &&
        !e.target.closest('input, .search-history-dropdown, .search-history-item')) {
      const targetSection = logoSection || searchSection;
      this.activeMainSection = targetSection;
      this.mainSectionId = targetSection.id;
      this.sectionStartPos = { x: e.clientX, y: e.clientY };

      const rect = targetSection.getBoundingClientRect();
      this.sectionOffset = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };

      this.isSectionDragging = false;
      return;
    }

    // 2. Check for Group Header Dragging
    const groupHeader = e.target.closest('.group-header');
    if (groupHeader && !e.target.closest('.group-actions')) {
      const section = groupHeader.closest('.shortcut-group-section');
      if (section) {
        this.activeGroupSection = section;
        this.groupStartPos = { x: e.clientX, y: e.clientY };

        const rect = section.getBoundingClientRect();
        this.groupInitialOffset = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };

        this.isGroupDragging = false;
        this.wasGroupJustDragged = false;
        return;
      }
    }

    // 3. Check for Shortcut Tile Dragging (including Add Shortcut Tile)
    const tile = e.target.closest('.shortcut-card');
    if (!tile) {
      // 4. Check for Empty Background Click in Edit Mode -> Photoshop-style Marquee Selection!
      const isUIElement = e.target.closest(
        '.edit-toolbar, .multiselect-bar, .modal-backdrop, .modal, .side-panel-drawer, .side-panel-overlay, .arcade-modal-screen, ' +
        '.sidebar-drawer, .sidebar-overlay, .google-apps-dropdown, .bg-video-controls, .search-history-dropdown, .align-bar, ' +
        '.spw-root, .sa-modal, .brk-modal, .game-arcade-modal, .onboarding-tip, ' +
        'button, input, select, textarea, a, kbd, svg, .section-edit-btn'
      );
      if (!isUIElement) {
        this.isMarqueeCandidate = true;
        this.isMarqueeSelecting = false;
        this.marqueeStartPos = { x: e.clientX, y: e.clientY };
        this.marqueeHasModifier = e.shiftKey || e.ctrlKey || e.metaKey;
        this.initialSelectionSnapshot = (typeof ShortcutGrid !== 'undefined' && ShortcutGrid.selectedShortcutIds)
          ? new Set(ShortcutGrid.selectedShortcutIds)
          : new Set();
      }
      return;
    }

    if (e.target.closest('.shortcut-menu-btn')) return;
    if (e.target.closest('.shortcut-select-checkbox')) return;

    const tileId = tile.dataset.id;
    const hasModifier = e.shiftKey || e.ctrlKey || e.metaKey;

    if (tileId && typeof ShortcutGrid !== 'undefined') {
      if (!ShortcutGrid.selectedShortcutIds.has(tileId) && !hasModifier) {
        // Clicking an unselected tile without modifier: clear other selections, select this tile
        ShortcutGrid.selectedShortcutIds.clear();
        ShortcutGrid.selectedShortcutIds.add(tileId);
        ShortcutGrid.updateMultiselectUI();
      } else if (hasModifier && !ShortcutGrid.selectedShortcutIds.has(tileId)) {
        // Shift/Ctrl click on unselected tile: add to selection
        ShortcutGrid.selectedShortcutIds.add(tileId);
        ShortcutGrid.updateMultiselectUI();
        this.justSelectedId = tileId;
      }
    }

    this.activeTile = tile;
    this.startPos = { x: e.clientX, y: e.clientY };

    const rect = tile.getBoundingClientRect();
    this.initialOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    this.isDragging = false;
    this.justDragged = false;
    this.hoveredGroupId = undefined;
  },

  handlePointerMove(e) {
    // -1. Handle Marquee Selection (Photoshop / Figma style)
    if (this.isMarqueeCandidate || this.isMarqueeSelecting) {
      const dx = e.clientX - this.marqueeStartPos.x;
      const dy = e.clientY - this.marqueeStartPos.y;

      if (!this.isMarqueeSelecting && Math.hypot(dx, dy) > 4) {
        this.isMarqueeSelecting = true;
        this.createMarqueeBox();
      }

      if (this.isMarqueeSelecting) {
        e.preventDefault();
        this.updateMarqueeBox(e.clientX, e.clientY);
        return;
      }
    }

    // 0. Handle Dynamic Resizing
    if (this.activeResizingEl && this.isResizing) {
      e.preventDefault();
      const dx = e.clientX - this.resizeStartPos.x;
      const dy = e.clientY - this.resizeStartPos.y;

      let minW = 80;
      let minH = 40;
      if (this.resizeTargetType === 'shortcut') { minW = 80; minH = 80; }
      else if (this.resizeTargetType === 'group') { minW = 200; minH = 80; }
      else if (this.resizeTargetType === 'logo') { minW = 120; minH = 40; }
      else if (this.resizeTargetType === 'search') { minW = 240; minH = 40; }

      let targetWidth = Math.max(minW, Math.round(this.resizeStartSize.width + dx));
      let targetHeight = Math.max(minH, Math.round(this.resizeStartSize.height + dy));

      const snappedSize = this.calculateDimensionGuides(this.activeResizingEl, targetWidth, targetHeight);
      targetWidth = snappedSize.width;
      targetHeight = snappedSize.height;

      this.activeResizingEl.style.width = `${targetWidth}px`;
      if (this.resizeTargetType === 'group') {
        this.activeResizingEl.style.maxWidth = `${targetWidth}px`;
      }
      if (this.resizeTargetType !== 'search' && this.resizeTargetType !== 'group') {
        this.activeResizingEl.style.height = `${targetHeight}px`;
      }

      this.activeResizingEl.dataset.customWidth = targetWidth;
      this.activeResizingEl.dataset.customHeight = targetHeight;
      return;
    }

    // 1. Handle Main Section Dragging (Google Logo / Search Bar)
    if (this.activeMainSection) {
      const dx = e.clientX - this.sectionStartPos.x;
      const dy = e.clientY - this.sectionStartPos.y;

      if (!this.isSectionDragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        this.isSectionDragging = true;
        this.activeMainSection.style.position = 'absolute';
        this.activeMainSection.style.margin = '0';
        this.activeMainSection.classList.add('has-free-position');
        document.body.classList.add('is-actively-dragging');
      }

      if (this.isSectionDragging) {
        e.preventDefault();
        let newX = e.clientX - this.sectionOffset.x;
        let newY = e.clientY - this.sectionOffset.y;

        // Shift key axis locking
        if (e.shiftKey && this.sectionStartPos) {
          const startX = this.sectionStartPos.x - this.sectionOffset.x;
          const startY = this.sectionStartPos.y - this.sectionOffset.y;
          if (Math.abs(newX - startX) > Math.abs(newY - startY)) {
            newY = startY; // lock Y axis
          } else {
            newX = startX; // lock X axis
          }
        }

        newX = Math.max(10, Math.min(window.innerWidth - 120, newX));
        newY = Math.max(10, Math.min(window.innerHeight - 50, newY));

        // High precision X,Y rays for main sections
        const snapped = this.calculateSmartGuides(this.activeMainSection, newX, newY, { disabled: e.ctrlKey || e.metaKey });
        newX = snapped.x;
        newY = snapped.y;
        const relX = (newX / window.innerWidth) * 100;
        const relY = (newY / window.innerHeight) * 100;

        this.activeMainSection.style.position = 'fixed';
        this.activeMainSection.style.left = `${relX.toFixed(2)}vw`;
        this.activeMainSection.style.top = `${relY.toFixed(2)}vh`;
        this.activeMainSection.dataset.posX = relX.toFixed(2);
        this.activeMainSection.dataset.posY = relY.toFixed(2);
      }
      return;
    }

    // 2. Handle Group Section Dragging
    if (this.activeGroupSection) {
      const dx = e.clientX - this.groupStartPos.x;
      const dy = e.clientY - this.groupStartPos.y;
      if (!this.isGroupDragging && Math.hypot(dx, dy) > 5) {
        this.isGroupDragging = true;
        this.wasGroupJustDragged = true;
        this.activeGroupSection.classList.add('is-dragging-group');
        document.body.classList.add('is-actively-dragging');
      }

      if (this.isGroupDragging) {
        e.preventDefault();

        if (this.layoutMode === 'grid') {
          const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
          const hoverSection = elemBelow ? elemBelow.closest('.shortcut-group-section') : null;

          if (hoverSection && hoverSection !== this.activeGroupSection) {
            const parent = this.activeGroupSection.parentNode;
            const sections = Array.from(parent.querySelectorAll('.shortcut-group-section'));
            const activeIdx = sections.indexOf(this.activeGroupSection);
            const hoverIdx = sections.indexOf(hoverSection);

            if (activeIdx !== -1 && hoverIdx !== -1) {
              if (activeIdx < hoverIdx) {
                parent.insertBefore(hoverSection, this.activeGroupSection);
              } else {
                parent.insertBefore(this.activeGroupSection, hoverSection);
              }
            }
          }
        } else {
          // Free Placement mode: move entire group section freely around screen
          const screenWidth = window.innerWidth;
          const screenHeight = window.innerHeight;

          let pixelX = e.clientX - (this.groupInitialOffset?.x || 0);
          let pixelY = e.clientY - (this.groupInitialOffset?.y || 0);

          // Shift key axis locking
          if (e.shiftKey && this.groupStartPos) {
            const startX = this.groupStartPos.x - (this.groupInitialOffset?.x || 0);
            const startY = this.groupStartPos.y - (this.groupInitialOffset?.y || 0);
            if (Math.abs(pixelX - startX) > Math.abs(pixelY - startY)) {
              pixelY = startY; // lock Y axis
            } else {
              pixelX = startX; // lock X axis
            }
          }

          const snapped = this.calculateSmartGuides(this.activeGroupSection, pixelX, pixelY, { disabled: e.ctrlKey || e.metaKey });
          pixelX = snapped.x;
          pixelY = snapped.y;

          let relativeX = (pixelX / screenWidth) * 100;
          let relativeY = (pixelY / screenHeight) * 100;

          relativeX = Math.max(1, Math.min(85, relativeX));
          relativeY = Math.max(1, Math.min(85, relativeY));

          this.activeGroupSection.style.position = 'fixed';
          this.activeGroupSection.style.left = `${relativeX.toFixed(2)}vw`;
          this.activeGroupSection.style.top = `${relativeY.toFixed(2)}vh`;
          this.activeGroupSection.dataset.posX = relativeX.toFixed(2);
          this.activeGroupSection.dataset.posY = relativeY.toFixed(2);
          this.activeGroupSection.classList.add('group-section-free');
        }
      }
      return;
    }

    // 3. Handle Shortcut Tile Dragging
    if (!this.activeTile) return;

    const dx = e.clientX - this.startPos.x;
    const dy = e.clientY - this.startPos.y;

    if (!this.isDragging && Math.hypot(dx, dy) > 5) {
      this.isDragging = true;
      this.justDragged = true;

      // Prepare Multi-Tile Drag if active tile is part of a multi-selection
      this.selectedTilesData = [];
      const activeId = this.activeTile.dataset.id;
      const isMultiDrag = activeId && typeof ShortcutGrid !== 'undefined' &&
        ShortcutGrid.selectedShortcutIds &&
        ShortcutGrid.selectedShortcutIds.has(activeId) &&
        ShortcutGrid.selectedShortcutIds.size > 1;

      if (isMultiDrag) {
        const grid = this.container || document;
        ShortcutGrid.selectedShortcutIds.forEach(id => {
          const cardEl = grid.querySelector(`.shortcut-card[data-id="${CSS.escape(id)}"]`);
          if (cardEl && cardEl.getClientRects().length > 0) {
            cardEl.classList.add('is-multidrag-active');
            this.selectedTilesData.push({ id, el: cardEl });
          }
        });

        // Auto-promote to free placement mode so tiles can move anywhere across the canvas
        if (this.layoutMode === 'grid') {
          this.setLayoutMode('free');
          if (typeof ShortcutGrid !== 'undefined') {
            ShortcutGrid.setLayoutMode('free');
          }
          const modeGridBtn = document.getElementById('mode-grid-btn');
          const modeFreeBtn = document.getElementById('mode-free-btn');
          if (modeGridBtn && modeFreeBtn) {
            modeFreeBtn.classList.add('active');
            modeGridBtn.classList.remove('active');
          }
          if (typeof ShortcutStorage !== 'undefined') {
            ShortcutStorage.saveSettings({ layoutMode: 'free' });
          }
        }
      } else {
        this.createGhost();
        this.activeTile.classList.add('is-dragging');
      }

      // Everything that moves together, with start positions, plus a cached snapshot of snap targets
      const movingEls = this.selectedTilesData.length > 1 ? this.selectedTilesData.map(item => item.el) : [this.activeTile];
      this.dragItems = movingEls.map(el => {
        const start = this.getFreePositionPx(el);
        return { id: el.dataset.id, el, startX: start.x, startY: start.y, rect: this.getVisualRect(el) };
      });
      this.dragStartBox = this.unionRect(this.dragItems.map(item => item.rect));
      this.snapTargets = this.collectSnapTargets(movingEls);

      document.body.classList.add('is-actively-dragging');
    }

    if (!this.isDragging) return;

    e.preventDefault();

    if (this.ghostEl && this.layoutMode === 'grid') {
      this.ghostEl.style.left = `${e.clientX - this.initialOffset.x}px`;
      this.ghostEl.style.top = `${e.clientY - this.initialOffset.y}px`;
    }

    if (this.layoutMode === 'grid' && (!this.selectedTilesData || this.selectedTilesData.length <= 1)) {
      this.handleGridMove(e);
    } else {
      this.handleFreeMove(e);
    }
  },

  createGhost() {
    if (this.ghostEl) this.ghostEl.remove();

    const rect = this.activeTile.getBoundingClientRect();
    this.ghostEl = this.activeTile.cloneNode(true);
    this.ghostEl.classList.add('drag-ghost');
    this.ghostEl.style.width = `${rect.width}px`;
    this.ghostEl.style.height = `${rect.height}px`;
    this.ghostEl.style.left = `${rect.left}px`;
    this.ghostEl.style.top = `${rect.top}px`;

    document.body.appendChild(this.ghostEl);
  },

  handleGridMove(e) {
    if (this.ghostEl) this.ghostEl.style.display = 'none';
    const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
    if (this.ghostEl) this.ghostEl.style.display = 'flex';

    // Highlight category drop target if hovering over a group section
    document.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));

    if (elemBelow) {
      const targetGroupSection = elemBelow.closest('.shortcut-group-section');
      if (targetGroupSection) {
        targetGroupSection.classList.add('is-drop-target');
        this.hoveredGroupId = targetGroupSection.dataset.groupId || null;
      } else {
        this.hoveredGroupId = null;
      }
    }

    if (!elemBelow) return;

    const hoverTile = elemBelow.closest('.shortcut-card');
    if (!hoverTile || hoverTile === this.activeTile || hoverTile.classList.contains('shortcut-card-add')) {
      return;
    }

    const currentParent = hoverTile.parentNode;
    if (currentParent) {
      const children = Array.from(currentParent.children);
      const activeIndex = children.indexOf(this.activeTile);
      const hoverIndex = children.indexOf(hoverTile);

      if (activeIndex !== -1 && hoverIndex !== -1) {
        if (activeIndex < hoverIndex) {
          currentParent.insertBefore(hoverTile, this.activeTile);
        } else {
          currentParent.insertBefore(this.activeTile, hoverTile);
        }
      }
    }
  },

  handleFreeMove(e) {
    if (!this.dragItems || this.dragItems.length === 0 || !this.dragStartBox) return;

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const box = this.dragStartBox;

    let dx = e.clientX - this.startPos.x;
    let dy = e.clientY - this.startPos.y;

    // Shift key axis locking (Photoshop style horizontal/vertical lock)
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }

    // Snap the bounding box of everything being moved; hold Ctrl/Cmd to move without snapping
    const snapped = this.calculateSmartGuides(null, box.left + dx, box.top + dy, {
      size: box,
      targets: this.snapTargets,
      disabled: e.ctrlKey || e.metaKey
    });
    dx = snapped.x - box.left;
    dy = snapped.y - box.top;
    if (e.shiftKey) {
      if (Math.abs(e.clientX - this.startPos.x) > Math.abs(e.clientY - this.startPos.y)) dy = 0;
      else dx = 0;
    }

    // Clamp the whole selection as one rigid unit so tiles never compress into each other at the edges
    const clampDelta = (d, min, max) => (max < min ? min : Math.max(min, Math.min(max, d)));
    dx = clampDelta(dx, this.getMinFreeLeft() - box.left, (screenWidth - 8) - box.right);
    dy = clampDelta(dy, 50 - box.top, (screenHeight - 40) - box.bottom);

    if (this.ghostEl) {
      this.ghostEl.style.left = `${box.left + dx}px`;
      this.ghostEl.style.top = `${box.top + dy}px`;
    }

    this.dragItems.forEach(item => {
      this.setFreePosition(item.el, item.startX + dx, item.startY + dy);
      item.el.classList.add('shortcut-card-free');
    });

    // Highlight category group drop target if hovering over one (moving tiles ignore pointer hit-testing)
    document.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
    if (elemBelow) {
      const targetGroupSection = elemBelow.closest('.shortcut-group-section');
      if (targetGroupSection) {
        targetGroupSection.classList.add('is-drop-target');
        this.hoveredGroupId = targetGroupSection.dataset.groupId || null;
      } else {
        this.hoveredGroupId = undefined;
      }
    }
  },

  unionRect(rects) {
    const left = Math.min(...rects.map(r => r.left));
    const top = Math.min(...rects.map(r => r.top));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return this.makeBox(left, top, right - left, bottom - top);
  },

  // ---------- Geometry helpers (shared with AlignEngine & KeyboardNav) ----------

  SNAP_THRESHOLD: 6,
  SNAP_TARGET_SELECTOR: '.shortcut-card, .shortcut-group-section, #google-logo-section, #search-bar-section',

  makeBox(left, top, width, height) {
    return {
      left, top, width, height,
      right: left + width, bottom: top + height,
      centerX: left + width / 2, centerY: top + height / 2
    };
  },

  // Layout box of an element, ignoring hover/selection scale transforms (which scale about the center)
  getVisualRect(el) {
    const r = el.getBoundingClientRect();
    const w = el.offsetWidth || r.width;
    const h = el.offsetHeight || r.height;
    return this.makeBox(r.left + (r.width - w) / 2, r.top + (r.height - h) / 2, w, h);
  },

  // Leftmost x a free tile may be dragged/aligned to; keeps tiles clear of the align palette (left:16px, ~48px wide)
  getMinFreeLeft() {
    const bar = document.getElementById('align-bar');
    return bar && bar.classList.contains('active') ? 72 : 8;
  },

  // Current stored free position of an element in pixels (falls back to its on-screen box)
  getFreePositionPx(el) {
    const x = parseFloat(el.dataset.posX);
    const y = parseFloat(el.dataset.posY);
    if (!isNaN(x) && !isNaN(y) && el.style.position === 'fixed') {
      return { x: (x / 100) * window.innerWidth, y: (y / 100) * window.innerHeight };
    }
    const r = this.getVisualRect(el);
    return { x: r.left, y: r.top };
  },

  // Writes a free position (pixels in, viewport-relative units stored) and returns the stored {x, y} percentages
  setFreePosition(el, pixelX, pixelY) {
    const relX = Number(((pixelX / window.innerWidth) * 100).toFixed(3));
    const relY = Number(((pixelY / window.innerHeight) * 100).toFixed(3));
    el.style.position = 'fixed';
    el.style.left = `${relX}vw`;
    el.style.top = `${relY}vh`;
    el.dataset.posX = relX;
    el.dataset.posY = relY;
    delete el.dataset.posPxX;
    delete el.dataset.posPxY;
    return { x: relX, y: relY };
  },

  // Boxes of everything the dragged elements can snap to (excludes the moving elements, their children and hidden items)
  collectSnapTargets(excludeEls = []) {
    return Array.from(document.querySelectorAll(this.SNAP_TARGET_SELECTOR))
      .filter(el => !el.classList.contains('drag-ghost') &&
        !excludeEls.some(ex => ex && (ex === el || ex.contains(el))) &&
        el.getClientRects().length > 0)
      .map(el => this.getVisualRect(el))
      .filter(r => r.width > 0 && r.height > 0);
  },

  // Snaps a box (pixel left/top) and draws Figma-style guides. Pass options.size/targets to reuse cached geometry.
  calculateSmartGuides(draggedEl, currentPixelX, currentPixelY, options = {}) {
    if (!this.smartGuidesSvgEl) return { x: currentPixelX, y: currentPixelY };
    if (options.disabled) {
      this.clearSmartGuides();
      return { x: currentPixelX, y: currentPixelY };
    }

    const size = options.size || this.getVisualRect(draggedEl);
    const targets = options.targets || this.collectSnapTargets([draggedEl]);
    const box = this.makeBox(currentPixelX, currentPixelY, size.width, size.height);

    const snap = this.computeSnap(box, targets);
    this.drawSmartGuides(snap.guides);
    return { x: currentPixelX + snap.dx, y: currentPixelY + snap.dy };
  },

  computeSnap(box, targets) {
    const T = this.SNAP_THRESHOLD;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const pick = (best, diff) => (Math.abs(diff) < T && (best === null || Math.abs(diff) < Math.abs(best))) ? diff : best;

    // 1. Closest edge/center alignment on each axis (left|center|right against left|center|right, flush included)
    const boxXs = [box.left, box.centerX, box.right];
    const boxYs = [box.top, box.centerY, box.bottom];
    let alignX = pick(null, W / 2 - box.centerX);
    let alignY = pick(null, H / 2 - box.centerY);
    targets.forEach(t => {
      [t.left, t.centerX, t.right].forEach(tx => boxXs.forEach(bx => { alignX = pick(alignX, tx - bx); }));
      [t.top, t.centerY, t.bottom].forEach(ty => boxYs.forEach(by => { alignY = pick(alignY, ty - by); }));
    });

    // 2. Equal spacing along rows/columns; wins when it is at least as close as the alignment snap
    const gapX = this.findEqualGapSnap(box, targets, 'x');
    const gapY = this.findEqualGapSnap(box, targets, 'y');
    const useGapX = gapX && (alignX === null || Math.abs(gapX.diff) <= Math.abs(alignX));
    const useGapY = gapY && (alignY === null || Math.abs(gapY.diff) <= Math.abs(alignY));

    const dx = useGapX ? gapX.diff : (alignX ?? 0);
    const dy = useGapY ? gapY.diff : (alignY ?? 0);
    const snapped = this.makeBox(box.left + dx, box.top + dy, box.width, box.height);

    // 3. Guides for every line the snapped box now shares with a target (Figma shows them all)
    const EPS = 0.5;
    const vLines = new Map();
    const hLines = new Map();
    const addLine = (map, pos, from, to) => {
      const key = Math.round(pos * 2) / 2;
      const line = map.get(key);
      if (line) { line.from = Math.min(line.from, from); line.to = Math.max(line.to, to); }
      else map.set(key, { pos, from, to });
    };
    targets.forEach(t => {
      [t.left, t.centerX, t.right].forEach(tx => {
        if ([snapped.left, snapped.centerX, snapped.right].some(bx => Math.abs(bx - tx) < EPS)) {
          addLine(vLines, tx, Math.min(snapped.top, t.top), Math.max(snapped.bottom, t.bottom));
        }
      });
      [t.top, t.centerY, t.bottom].forEach(ty => {
        if ([snapped.top, snapped.centerY, snapped.bottom].some(by => Math.abs(by - ty) < EPS)) {
          addLine(hLines, ty, Math.min(snapped.left, t.left), Math.max(snapped.right, t.right));
        }
      });
    });
    if (Math.abs(snapped.centerX - W / 2) < EPS) addLine(vLines, W / 2, 0, H);
    if (Math.abs(snapped.centerY - H / 2) < EPS) addLine(hLines, H / 2, 0, W);

    // 4. Distance badges to the nearest neighbour on axes without an equal-spacing guide
    const distances = [];
    if (!useGapX) {
      const d = this.nearestDistance(snapped, targets, 'x');
      if (d) distances.push(d);
    }
    if (!useGapY) {
      const d = this.nearestDistance(snapped, targets, 'y');
      if (d) distances.push(d);
    }

    return {
      dx, dy,
      guides: {
        vRays: Array.from(vLines.values()).map(l => ({ x: l.pos, y1: l.from, y2: l.to })),
        hRays: Array.from(hLines.values()).map(l => ({ y: l.pos, x1: l.from, x2: l.to })),
        equalGaps: [useGapX ? { dir: 'horizontal', ...gapX } : null, useGapY ? { dir: 'vertical', ...gapY } : null].filter(Boolean),
        distances
      }
    };
  },

  // axis 'x': spacing within a row (gaps measured horizontally); axis 'y': within a column
  findEqualGapSnap(box, targets, axis) {
    const T = this.SNAP_THRESHOLD;
    const [s, e, size, cs, ce] = axis === 'x'
      ? ['left', 'right', 'width', 'top', 'bottom']
      : ['top', 'bottom', 'height', 'left', 'right'];
    const crossOverlap = (p, q) => Math.min(p[ce], q[ce]) - Math.max(p[cs], q[cs]);
    const crossMid = (p, q) => (Math.max(p[cs], q[cs]) + Math.min(p[ce], q[ce])) / 2;

    const line = targets.filter(t => crossOverlap(t, box) > 8).sort((a, b) => a[s] - b[s]);
    if (line.length === 0) return null;

    // Existing gaps: each element to its nearest following non-overlapping neighbour on this line
    // (robust to overlapping clutter, which would hide gaps between items adjacent in sort order)
    const gaps = [];
    line.forEach(A => {
      let B = null;
      line.forEach(C => {
        if (C !== A && C[s] >= A[e] + 2 && crossOverlap(A, C) > 8 && (!B || C[s] < B[s])) B = C;
      });
      if (B && B[s] - A[e] <= 600) {
        gaps.push({ gap: B[s] - A[e], seg: { from: A[e], to: B[s], cross: crossMid(A, B) } });
      }
    });

    const prev = line.filter(t => t[e] <= box[s] + T).sort((a, b) => b[e] - a[e])[0];
    const next = line.filter(t => t[s] >= box[e] - T).sort((a, b) => a[s] - b[s])[0];

    let best = null;
    const consider = (diff, gap, segs) => {
      if (Math.abs(diff) < T && (!best || Math.abs(diff) < Math.abs(best.diff))) {
        best = { diff, gap: Math.round(gap), segments: segs };
      }
    };

    gaps.forEach(({ gap, seg }) => {
      if (prev) {
        consider(prev[e] + gap - box[s], gap, [seg, { from: prev[e], to: prev[e] + gap, cross: crossMid(prev, box) }]);
      }
      if (next) {
        consider(next[s] - gap - box[e], gap, [seg, { from: next[s] - gap, to: next[s], cross: crossMid(next, box) }]);
      }
    });

    // Centered between the previous and next neighbour
    if (prev && next && next[s] - prev[e] > box[size] + 8) {
      const g = (next[s] - prev[e] - box[size]) / 2;
      consider(prev[e] + g - box[s], g, [
        { from: prev[e], to: prev[e] + g, cross: crossMid(prev, box) },
        { from: next[s] - g, to: next[s], cross: crossMid(next, box) }
      ]);
    }

    if (!best) return null;
    // Segments are expressed along the axis; convert to drawable coordinates
    best.segments = best.segments.map(seg => axis === 'x'
      ? { x1: seg.from, x2: seg.to, y: seg.cross }
      : { y1: seg.from, y2: seg.to, x: seg.cross });
    return best;
  },

  nearestDistance(box, targets, axis) {
    const [s, e, cs, ce] = axis === 'x' ? ['left', 'right', 'top', 'bottom'] : ['top', 'bottom', 'left', 'right'];
    let best = null;
    targets.forEach(t => {
      if (Math.min(t[ce], box[ce]) - Math.max(t[cs], box[cs]) <= 8) return;
      const cross = (Math.max(t[cs], box[cs]) + Math.min(t[ce], box[ce])) / 2;
      let from = null, to = null;
      if (t[e] <= box[s]) { from = t[e]; to = box[s]; }
      else if (t[s] >= box[e]) { from = box[e]; to = t[s]; }
      if (from === null) return;
      const dist = to - from;
      if (dist > 2 && dist < 300 && (!best || dist < best.dist)) best = { from, to, cross, dist };
    });
    if (!best) return null;
    const dist = Math.round(best.dist);
    return axis === 'x'
      ? { dir: 'horizontal', x1: best.from, x2: best.to, y: best.cross, dist }
      : { dir: 'vertical', y1: best.from, y2: best.to, x: best.cross, dist };
  },

  calculateDimensionGuides(resizedEl, currentWidth, currentHeight) {
    if (!this.smartGuidesSvgEl) return { width: currentWidth, height: currentHeight };

    const T = this.SNAP_THRESHOLD;
    const targets = this.collectSnapTargets([resizedEl]);
    const rect = this.getVisualRect(resizedEl);

    // Width and height snap independently to the closest matching size
    let bestW = null, bestH = null;
    targets.forEach(r => {
      const dw = r.width - currentWidth;
      const dh = r.height - currentHeight;
      if (Math.abs(dw) < T && (bestW === null || Math.abs(dw) < Math.abs(bestW))) bestW = dw;
      if (Math.abs(dh) < T && (bestH === null || Math.abs(dh) < Math.abs(bestH))) bestH = dh;
    });

    const snappedW = bestW === null ? currentWidth : Math.round(currentWidth + bestW);
    const snappedH = bestH === null ? currentHeight : Math.round(currentHeight + bestH);

    const vRays = bestW === null ? [] : [{ x: rect.left + snappedW, y1: rect.top, y2: rect.top + snappedH }];
    const hRays = bestH === null ? [] : [{ y: rect.top + snappedH, x1: rect.left, x2: rect.left + snappedW }];
    this.drawSmartGuides({ vRays, hRays });

    return { width: snappedW, height: snappedH };
  },

  drawSmartGuides({ vRays = [], hRays = [], equalGaps = [], distances = [] } = {}) {
    if (!this.smartGuidesSvgEl) return;

    if (vRays.length === 0 && hRays.length === 0 && equalGaps.length === 0 && distances.length === 0) {
      this.clearSmartGuides();
      return;
    }

    const badge = (cx, cy, text, color, opacity = 0.9) => `
      <g class="snap-badge-pulse">
        <rect x="${cx - 18}" y="${cy - 9}" width="36" height="18" rx="4" fill="rgba(24, 27, 34, ${opacity})" stroke="${color}" stroke-width="1.2"/>
        <text x="${cx}" y="${cy + 4}" fill="#ffffff" font-size="10.5" font-weight="600" text-anchor="middle" font-family="system-ui, sans-serif">${text}</text>
      </g>`;

    // Measurement segment with end ticks: horizontal segments have x1/x2/y, vertical ones y1/y2/x
    const segment = (seg, color, width, dash, tick) => {
      const d = dash ? ` stroke-dasharray="${dash}"` : '';
      if (seg.x1 !== undefined) {
        return `<line x1="${seg.x1}" y1="${seg.y}" x2="${seg.x2}" y2="${seg.y}" stroke="${color}" stroke-width="${width}"${d}/>` +
          `<line x1="${seg.x1}" y1="${seg.y - tick}" x2="${seg.x1}" y2="${seg.y + tick}" stroke="${color}" stroke-width="${width}"/>` +
          `<line x1="${seg.x2}" y1="${seg.y - tick}" x2="${seg.x2}" y2="${seg.y + tick}" stroke="${color}" stroke-width="${width}"/>`;
      }
      return `<line x1="${seg.x}" y1="${seg.y1}" x2="${seg.x}" y2="${seg.y2}" stroke="${color}" stroke-width="${width}"${d}/>` +
        `<line x1="${seg.x - tick}" y1="${seg.y1}" x2="${seg.x + tick}" y2="${seg.y1}" stroke="${color}" stroke-width="${width}"/>` +
        `<line x1="${seg.x - tick}" y1="${seg.y2}" x2="${seg.x + tick}" y2="${seg.y2}" stroke="${color}" stroke-width="${width}"/>`;
    };
    const segMid = seg => seg.x1 !== undefined ? [(seg.x1 + seg.x2) / 2, seg.y] : [seg.x, (seg.y1 + seg.y2) / 2];

    let svgHtml = '';

    // Vertical alignment rays (cyan) and horizontal alignment rays (magenta)
    vRays.forEach(r => {
      svgHtml += `<line x1="${r.x}" y1="${r.y1 ?? 0}" x2="${r.x}" y2="${r.y2 ?? window.innerHeight}" stroke="#00e5ff" stroke-width="1.5" stroke-dasharray="6 3" class="snap-pulse-line" style="color:#00e5ff"/>`;
    });
    hRays.forEach(r => {
      svgHtml += `<line x1="${r.x1 ?? 0}" y1="${r.y}" x2="${r.x2 ?? window.innerWidth}" y2="${r.y}" stroke="#ff007f" stroke-width="1.5" stroke-dasharray="6 3" class="snap-pulse-line" style="color:#ff007f"/>`;
    });

    // Equal spacing guides with matching pixel badges
    equalGaps.forEach(eg => {
      const color = eg.dir === 'horizontal' ? '#ffb703' : '#00f5d4';
      eg.segments.forEach(seg => {
        svgHtml += segment(seg, color, 2, null, 6);
        const [mx, my] = segMid(seg);
        svgHtml += badge(mx, my, `${eg.gap}px`, color);
      });
    });

    // Distance to the nearest neighbour
    distances.forEach(dg => {
      const color = dg.dir === 'horizontal' ? '#ff9100' : '#00e5ff';
      svgHtml += segment(dg, color, 1.5, '3 2', 5);
      const [mx, my] = segMid(dg);
      svgHtml += badge(mx, my, `${dg.dist}px`, color, 0.92);
    });

    this.smartGuidesSvgEl.innerHTML = svgHtml;
  },

  clearSmartGuides() {
    if (this.smartGuidesSvgEl) {
      this.smartGuidesSvgEl.innerHTML = '';
    }
  },

  createMarqueeBox() {
    if (this.marqueeBoxEl) this.marqueeBoxEl.remove();
    this.marqueeBoxEl = document.createElement('div');
    this.marqueeBoxEl.className = 'marquee-selection-box';
    this.marqueeBoxEl.style.left = `${this.marqueeStartPos.x}px`;
    this.marqueeBoxEl.style.top = `${this.marqueeStartPos.y}px`;
    this.marqueeBoxEl.style.width = '0px';
    this.marqueeBoxEl.style.height = '0px';
    document.body.appendChild(this.marqueeBoxEl);
  },

  updateMarqueeBox(currentX, currentY) {
    if (!this.marqueeBoxEl) return;

    const left = Math.min(this.marqueeStartPos.x, currentX);
    const top = Math.min(this.marqueeStartPos.y, currentY);
    const right = Math.max(this.marqueeStartPos.x, currentX);
    const bottom = Math.max(this.marqueeStartPos.y, currentY);
    const width = right - left;
    const height = bottom - top;

    this.marqueeBoxEl.style.left = `${left}px`;
    this.marqueeBoxEl.style.top = `${top}px`;
    this.marqueeBoxEl.style.width = `${width}px`;
    this.marqueeBoxEl.style.height = `${height}px`;

    if (typeof ShortcutGrid === 'undefined') return;

    const allCards = Array.from(document.querySelectorAll('.shortcut-card[data-id]'));
    allCards.forEach(card => {
      const id = card.dataset.id;
      if (!id) return;

      const cardRect = card.getBoundingClientRect();
      const intersects = !(
        cardRect.right < left ||
        cardRect.left > right ||
        cardRect.bottom < top ||
        cardRect.top > bottom
      );

      if (intersects) {
        ShortcutGrid.selectedShortcutIds.add(id);
        card.classList.add('is-selected');
        const checkbox = card.querySelector('.shortcut-select-checkbox');
        if (checkbox) checkbox.checked = true;
      } else {
        if (this.marqueeHasModifier && this.initialSelectionSnapshot && this.initialSelectionSnapshot.has(id)) {
          ShortcutGrid.selectedShortcutIds.add(id);
          card.classList.add('is-selected');
          const checkbox = card.querySelector('.shortcut-select-checkbox');
          if (checkbox) checkbox.checked = true;
        } else {
          ShortcutGrid.selectedShortcutIds.delete(id);
          card.classList.remove('is-selected');
          const checkbox = card.querySelector('.shortcut-select-checkbox');
          if (checkbox) checkbox.checked = false;
        }
      }
    });

    ShortcutGrid.updateMultiselectUI();
  },

  async handlePointerUp(e) {
    // Clean up Marquee Selection
    if (this.isMarqueeCandidate || this.isMarqueeSelecting) {
      if (this.marqueeBoxEl) {
        this.marqueeBoxEl.remove();
        this.marqueeBoxEl = null;
      }

      // If user simply clicked without dragging on empty canvas (and without Shift/Ctrl), deselect all
      if (!this.isMarqueeSelecting && !this.marqueeHasModifier && typeof ShortcutGrid !== 'undefined') {
        ShortcutGrid.clearSelection();
      }

      this.isMarqueeCandidate = false;
      this.isMarqueeSelecting = false;
      this.initialSelectionSnapshot = null;
    }

    // Clear alignment ray lines
    this.clearSmartGuides();

    // Clear all group drop target highlights
    document.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));

    // 0. Handle Resizing Drop & Save
    if (this.activeResizingEl && this.isResizing) {
      // Read and reset drag state synchronously so a second pointerup/blur can't save twice
      const resEl = this.activeResizingEl;
      const resType = this.resizeTargetType;
      const resId = this.resizeTargetId;
      const finalWidth = parseFloat(resEl.dataset.customWidth || resEl.offsetWidth);
      const finalHeight = parseFloat(resEl.dataset.customHeight || resEl.offsetHeight);

      this.justResized = true;
      this.lastResizedId = resId;
      this.lastResizeTime = Date.now();
      this.activeResizingEl = null;
      this.isResizing = false;
      document.body.classList.remove('is-actively-dragging');
      setTimeout(() => {
        this.justResized = false;
      }, 400);

      try {
        if ((resType === 'shortcut' || resType === 'group') && resId && typeof AlignEngine !== 'undefined') {
          await AlignEngine.checkpoint();
        }
        if (resType === 'shortcut' && resId) {
          await ShortcutStorage.updateShortcut(resId, { size: { width: finalWidth, height: finalHeight } });
        } else if (resType === 'group' && resId) {
          await ShortcutStorage.updateGroup(resId, { size: { width: finalWidth, height: finalHeight } });
        } else if (resType === 'logo') {
          await ShortcutStorage.saveSettings({ logoSize: { width: finalWidth, height: finalHeight } });
        } else if (resType === 'search') {
          await ShortcutStorage.saveSettings({ searchBarSize: { width: finalWidth, height: finalHeight } });
        }
      } catch (err) {
        console.error('[DragEngine] Failed to save resize:', err);
      }
      return;
    }

    // 1. Handle Main Section Drop
    if (this.activeMainSection) {
      const section = this.activeMainSection;
      const sectionId = this.mainSectionId;
      const wasDragging = this.isSectionDragging;
      this.activeMainSection = null;
      this.isSectionDragging = false;
      document.body.classList.remove('is-actively-dragging');

      if (wasDragging) {
        const posX = parseFloat(section.dataset.posX || '0');
        const posY = parseFloat(section.dataset.posY || '0');
        try {
          if (sectionId === 'google-logo-section') {
            await ShortcutStorage.saveSettings({ logoPosition: { x: posX, y: posY } });
          } else if (sectionId === 'search-bar-section') {
            await ShortcutStorage.saveSettings({ searchBarPosition: { x: posX, y: posY } });
          }
        } catch (err) {
          console.error('[DragEngine] Failed to save section position:', err);
        }
      }
      return;
    }

    // 2. Handle Group Section Drop
    if (this.activeGroupSection) {
      const section = this.activeGroupSection;
      const wasDragging = this.isGroupDragging;
      const mode = this.layoutMode;
      this.activeGroupSection = null;
      this.isGroupDragging = false;
      document.body.classList.remove('is-actively-dragging');
      setTimeout(() => {
        this.wasGroupJustDragged = false;
      }, 300);

      if (wasDragging) {
        section.classList.remove('is-dragging-group');
        try {
          if (typeof AlignEngine !== 'undefined') await AlignEngine.checkpoint();
          if (mode === 'grid') {
            const parent = section.parentNode;
            const reorderedGroupIds = parent
              ? Array.from(parent.querySelectorAll('.shortcut-group-section')).map(sec => sec.dataset.groupId).filter(Boolean)
              : [];
            await ShortcutStorage.transaction(async () => {
              const groups = await ShortcutStorage.getGroups();
              // Keep any group not present in the DOM instead of dropping it
              const updatedGroups = groups.map(g => {
                const idx = reorderedGroupIds.indexOf(g.id);
                return idx === -1 ? g : { ...g, order: idx };
              });
              await ShortcutStorage.saveGroups(updatedGroups);
            });
          } else {
            const groupId = section.dataset.groupId;
            const posX = parseFloat(section.dataset.posX || '0');
            const posY = parseFloat(section.dataset.posY || '0');
            if (groupId) {
              await ShortcutStorage.updateGroup(groupId, {
                position: { x: posX, y: posY },
                hasCustomPosition: true
              });
            }
          }
        } catch (err) {
          console.error('[DragEngine] Failed to save group drop:', err);
        }
      }
      return;
    }

    // 3. Handle Shortcut Tile Drop
    if (!this.activeTile) return;

    // Snapshot and reset all tile drag state synchronously before any await
    const tile = this.activeTile;
    const wasDragging = this.isDragging;
    const dragItems = this.dragItems || [];
    const isMulti = this.selectedTilesData && this.selectedTilesData.length > 1;
    const hoveredGroupId = this.hoveredGroupId;
    const mode = this.layoutMode;

    tile.classList.remove('is-dragging');
    (this.selectedTilesData || []).forEach(item => item.el && item.el.classList.remove('is-multidrag-active'));
    if (this.ghostEl) {
      this.ghostEl.remove();
      this.ghostEl = null;
    }
    this.activeTile = null;
    this.isDragging = false;
    this.hoveredGroupId = undefined;
    this.selectedTilesData = [];
    this.dragItems = [];
    this.dragStartBox = null;
    this.snapTargets = [];
    document.body.classList.remove('is-actively-dragging');

    setTimeout(() => {
      this.justDragged = false;
      this.justSelectedId = null;
    }, 400);

    if (!wasDragging) return;

    const tileId = tile.dataset.id || (tile.classList.contains('shortcut-card-add') ? 'add-shortcut-btn' : null);
    this.lastDraggedId = tileId;
    this.lastDragTime = Date.now();

    try {
      if (typeof AlignEngine !== 'undefined' && tile.dataset.id) await AlignEngine.checkpoint();

      if (isMulti || (mode !== 'grid' && tile.dataset.id)) {
        await this.persistFreeDrop(dragItems.filter(item => item.id), hoveredGroupId);
      } else if (mode === 'grid') {
        await this.persistGridDrop(tile, tileId, hoveredGroupId);
      } else if (tile.classList.contains('shortcut-card-add')) {
        const posX = parseFloat(tile.dataset.posX || '0');
        const posY = parseFloat(tile.dataset.posY || '0');
        await ShortcutStorage.saveSettings({ addShortcutPosition: { x: posX, y: posY } });
      }
    } catch (err) {
      console.error('[DragEngine] Failed to save tile drop:', err);
    }
  },

  // Free placement drop: tiles land on the canvas, or join the category group under the pointer
  async persistFreeDrop(items, hoveredGroupId) {
    if (items.length === 0) return;
    const targetGroupId = hoveredGroupId || null;
    const byId = new Map(items.map(item => [item.id, item]));
    let needsRender = false;

    await ShortcutStorage.transaction(async () => {
      const shortcuts = await ShortcutStorage.getShortcuts();
      let maxOrder = shortcuts
        .filter(s => (s.groupId || null) === targetGroupId)
        .reduce((max, s) => Math.max(max, s.order ?? 0), -1);

      const updated = shortcuts.map(s => {
        const item = byId.get(s.id);
        if (!item) return s;
        const oldGroupId = s.groupId || null;

        if (targetGroupId) {
          // Dropped onto a group: re-render puts the tile back into that group's grid
          needsRender = true;
          if (oldGroupId === targetGroupId) return s;
          maxOrder += 1;
          return { ...s, groupId: targetGroupId, order: maxOrder, position: null, hasCustomPosition: false };
        }

        // Dragging a tile out of its group detaches it onto the free canvas
        if (oldGroupId) needsRender = true;
        const posX = parseFloat(item.el.dataset.posX || '0');
        const posY = parseFloat(item.el.dataset.posY || '0');
        return { ...s, groupId: null, position: { x: posX, y: posY }, hasCustomPosition: true };
      });
      await ShortcutStorage.saveShortcuts(updated);
    });

    if (needsRender && typeof ShortcutGrid !== 'undefined') await ShortcutGrid.render();
  },

  async persistGridDrop(tile, tileId, hoveredGroupId) {
    let needsRender = false;
    await ShortcutStorage.transaction(async () => {
      const shortcuts = await ShortcutStorage.getShortcuts();
      const currentShortcut = shortcuts.find(s => s.id === tileId);

      // Cross-Group Drop: check if shortcut category changed
      if (currentShortcut && hoveredGroupId !== undefined && (hoveredGroupId || null) !== (currentShortcut.groupId || null)) {
        const newGroupId = hoveredGroupId || null;
        const existingInTarget = shortcuts.filter(s => (s.groupId || null) === newGroupId);
        const maxOrder = existingInTarget.reduce((max, s) => Math.max(max, s.order ?? 0), -1);
        await ShortcutStorage.saveShortcuts(shortcuts.map(s => s.id === tileId
          ? { ...s, groupId: newGroupId, order: maxOrder + 1, updatedAt: Date.now() }
          : s));
        needsRender = true;
        return;
      }

      // Same group reorder - scoped strictly to this group container
      const parentGrid = tile.closest('.group-grid') || document;
      const newOrderIds = Array.from(parentGrid.querySelectorAll('.shortcut-card:not(.shortcut-card-add)')).map(t => t.dataset.id);
      await ShortcutStorage.saveShortcuts(shortcuts.map(s => {
        const idx = newOrderIds.indexOf(s.id);
        return idx !== -1 ? { ...s, order: idx } : s;
      }));
    });

    if (needsRender && typeof ShortcutGrid !== 'undefined') await ShortcutGrid.render();
  }
};
