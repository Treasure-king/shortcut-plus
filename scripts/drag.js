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
  activeTileStartPixelX: 0,
  activeTileStartPixelY: 0,
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
    )).filter(el => el.offsetParent !== null && !el.closest('.hidden'));

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

    if ((logoSection || searchSection) && !e.target.closest('.section-edit-btn:not(.section-drag-handle)') && !e.target.closest('input')) {
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
        '.edit-toolbar, .multiselect-bar, .modal-backdrop, .modal, .side-panel-drawer, .side-panel-overlay, .arcade-modal-screen, button, input, select, textarea, a, kbd, svg, .section-edit-btn'
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
        const snapped = this.calculateSmartGuides(this.activeMainSection, newX, newY);
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

          const snapped = this.calculateSmartGuides(this.activeGroupSection, pixelX, pixelY);
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
        const winW = window.innerWidth;
        const winH = window.innerHeight;

        ShortcutGrid.selectedShortcutIds.forEach(id => {
          const cardEl = document.querySelector(`.shortcut-card[data-id="${id}"]`);
          if (cardEl) {
            const r = cardEl.getBoundingClientRect();
            cardEl.classList.add('is-multidrag-active');
            this.selectedTilesData.push({
              id,
              el: cardEl,
              startPixelX: r.left,
              startPixelY: r.top,
              width: r.width,
              height: r.height
            });
          }
        });

        const activeRect = this.activeTile.getBoundingClientRect();
        this.activeTileStartPixelX = activeRect.left;
        this.activeTileStartPixelY = activeRect.top;

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
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    let pixelX = e.clientX - this.initialOffset.x;
    let pixelY = e.clientY - this.initialOffset.y;

    // Shift key axis locking (Photoshop style horizontal/vertical lock)
    if (e.shiftKey && this.startPos) {
      const startX = this.startPos.x - this.initialOffset.x;
      const startY = this.startPos.y - this.initialOffset.y;
      if (Math.abs(pixelX - startX) > Math.abs(pixelY - startY)) {
        pixelY = startY; // lock Y axis
      } else {
        pixelX = startX; // lock X axis
      }
    }

    // Calculate Ultra-Accurate X,Y Alignment Rays & Magnetic Snapping
    const snapped = this.calculateSmartGuides(this.activeTile, pixelX, pixelY);
    pixelX = snapped.x;
    pixelY = snapped.y;

    if (this.ghostEl) {
      this.ghostEl.style.left = `${pixelX}px`;
      this.ghostEl.style.top = `${pixelY}px`;
    }

    let relativeX = (pixelX / screenWidth) * 100;
    let relativeY = (pixelY / screenHeight) * 100;

    relativeX = Math.max(1, Math.min(92, relativeX));
    relativeY = Math.max(1, Math.min(92, relativeY));

    this.activeTile.style.position = 'fixed';
    this.activeTile.style.left = `${relativeX.toFixed(2)}vw`;
    this.activeTile.style.top = `${relativeY.toFixed(2)}vh`;
    this.activeTile.dataset.posX = relativeX.toFixed(2);
    this.activeTile.dataset.posY = relativeY.toFixed(2);
    this.activeTile.classList.add('shortcut-card-free');

    // Move all other selected shortcuts along with active tile (Photoshop group drag)!
    if (this.selectedTilesData && this.selectedTilesData.length > 1) {
      const deltaX = pixelX - this.activeTileStartPixelX;
      const deltaY = pixelY - this.activeTileStartPixelY;

      this.selectedTilesData.forEach(item => {
        if (item.el === this.activeTile) return;

        let otherPixelX = item.startPixelX + deltaX;
        let otherPixelY = item.startPixelY + deltaY;

        const minTop = 50;
        const maxTop = Math.max(minTop, screenHeight - item.height - 40);
        otherPixelX = Math.max(8, Math.min(screenWidth - item.width - 8, otherPixelX));
        otherPixelY = Math.max(minTop, Math.min(maxTop, otherPixelY));

        const relX = (otherPixelX / screenWidth) * 100;
        const relY = (otherPixelY / screenHeight) * 100;

        item.el.style.position = 'fixed';
        item.el.style.left = `${relX.toFixed(2)}vw`;
        item.el.style.top = `${relY.toFixed(2)}vh`;
        item.el.dataset.posX = relX.toFixed(2);
        item.el.dataset.posY = relY.toFixed(2);
        item.el.classList.add('shortcut-card-free');
      });
    }

    // Highlight category group drop target if hovering over one
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

  calculateSmartGuides(draggedEl, currentPixelX, currentPixelY) {
    if (!this.smartGuidesSvgEl) return { x: currentPixelX, y: currentPixelY };

    const SNAP_THRESHOLD = 6; // High accuracy tight pixel threshold
    const rect = draggedEl.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    let left = currentPixelX;
    let centerX = currentPixelX + width / 2;
    let right = currentPixelX + width;

    let top = currentPixelY;
    let centerY = currentPixelY + height / 2;
    let bottom = currentPixelY + height;

    const screenCenterX = window.innerWidth / 2;
    const screenCenterY = window.innerHeight / 2;

    // Collect candidate targets (all static shortcuts, category groups, Google logo, Search bar, and screen center)
    const staticElements = Array.from(document.querySelectorAll('.shortcut-card, .shortcut-group-section, #google-logo-section, #search-bar-section'))
      .filter(el => el !== draggedEl && getComputedStyle(el).display !== 'none');

    const targets = [];
    targets.push({ id: 'screen-center', centerX: screenCenterX, centerY: screenCenterY, label: 'Screen Center' });

    staticElements.forEach(card => {
      const r = card.getBoundingClientRect();
      const title = card.querySelector('.shortcut-title, .group-title')?.textContent || card.id || 'card';
      targets.push({
        id: title,
        el: card,
        left: r.left,
        centerX: r.left + r.width / 2,
        right: r.right,
        top: r.top,
        centerY: r.top + r.height / 2,
        bottom: r.bottom,
        width: r.width,
        height: r.height
      });
    });

    let snappedX = currentPixelX;
    let snappedY = currentPixelY;
    let activeVRays = [];
    let activeHRays = [];
    let activeEqualGaps = [];

    const validTargets = targets.filter(t => t.left !== undefined);

    // 1. Photoshop-Style Vertical Alignment Rays (Snap X: Center, Left, Right, Screen Center)
    for (const t of validTargets) {
      // Center-to-Center alignment
      if (t.centerX !== undefined && Math.abs(centerX - t.centerX) < SNAP_THRESHOLD) {
        snappedX = t.centerX - width / 2;
        activeVRays.push({
          x: t.centerX,
          y1: Math.min(top, t.top !== undefined ? t.top : 0),
          y2: Math.max(bottom, t.bottom !== undefined ? t.bottom : window.innerHeight),
          label: 'Center'
        });
        break;
      }
      // Left-to-Left edge
      if (t.left !== undefined && Math.abs(left - t.left) < SNAP_THRESHOLD) {
        snappedX = t.left;
        activeVRays.push({
          x: t.left,
          y1: Math.min(top, t.top),
          y2: Math.max(bottom, t.bottom),
          label: 'Left'
        });
        break;
      }
      // Right-to-Right edge
      if (t.right !== undefined && Math.abs(right - t.right) < SNAP_THRESHOLD) {
        snappedX = t.right - width;
        activeVRays.push({
          x: t.right,
          y1: Math.min(top, t.top),
          y2: Math.max(bottom, t.bottom),
          label: 'Right'
        });
        break;
      }
      // Flush against Left edge
      if (t.left !== undefined && Math.abs(right - t.left) < SNAP_THRESHOLD) {
        snappedX = t.left - width;
        activeVRays.push({
          x: t.left,
          y1: Math.min(top, t.top),
          y2: Math.max(bottom, t.bottom),
          label: 'Flush'
        });
        break;
      }
      // Flush against Right edge
      if (t.right !== undefined && Math.abs(left - t.right) < SNAP_THRESHOLD) {
        snappedX = t.right;
        activeVRays.push({
          x: t.right,
          y1: Math.min(top, t.top),
          y2: Math.max(bottom, t.bottom),
          label: 'Flush'
        });
        break;
      }
    }

    // 2. Photoshop-Style Horizontal Alignment Rays (Snap Y: Center, Top, Bottom, Screen Center)
    for (const t of validTargets) {
      // Center-to-Center alignment
      if (t.centerY !== undefined && Math.abs(centerY - t.centerY) < SNAP_THRESHOLD) {
        snappedY = t.centerY - height / 2;
        activeHRays.push({
          y: t.centerY,
          x1: Math.min(left, t.left !== undefined ? t.left : 0),
          x2: Math.max(right, t.right !== undefined ? t.right : window.innerWidth),
          label: 'Center'
        });
        break;
      }
      // Top-to-Top edge
      if (t.top !== undefined && Math.abs(top - t.top) < SNAP_THRESHOLD) {
        snappedY = t.top;
        activeHRays.push({
          y: t.top,
          x1: Math.min(left, t.left),
          x2: Math.max(right, t.right),
          label: 'Top'
        });
        break;
      }
      // Bottom-to-Bottom edge
      if (t.bottom !== undefined && Math.abs(bottom - t.bottom) < SNAP_THRESHOLD) {
        snappedY = t.bottom - height;
        activeHRays.push({
          y: t.bottom,
          x1: Math.min(left, t.left),
          x2: Math.max(right, t.right),
          label: 'Bottom'
        });
        break;
      }
      // Flush against Top edge
      if (t.top !== undefined && Math.abs(bottom - t.top) < SNAP_THRESHOLD) {
        snappedY = t.top - height;
        activeHRays.push({
          y: t.top,
          x1: Math.min(left, t.left),
          x2: Math.max(right, t.right),
          label: 'Flush'
        });
        break;
      }
      // Flush against Bottom edge
      if (t.bottom !== undefined && Math.abs(top - t.bottom) < SNAP_THRESHOLD) {
        snappedY = t.bottom;
        activeHRays.push({
          y: t.bottom,
          x1: Math.min(left, t.left),
          x2: Math.max(right, t.right),
          label: 'Flush'
        });
        break;
      }
    }

    // 3. Photoshop-Style Equal Distance Spacing Calculation
    const overlapsVertically = (r1, r2) => Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top) > 15;
    const overlapsHorizontally = (r1, r2) => Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left) > 15;

    const currentRect = { left: currentPixelX, right: currentPixelX + width, top: currentPixelY, bottom: currentPixelY + height };

    // A. Horizontal Equal Spacing (between cards in the same row)
    for (let i = 0; i < validTargets.length; i++) {
      for (let j = 0; j < validTargets.length; j++) {
        if (i === j) continue;
        const A = validTargets[i];
        const B = validTargets[j];

        if (A.right < B.left && overlapsVertically(A, B)) {
          const gapAB = Math.round(B.left - A.right);
          if (gapAB < 4 || gapAB > 600) continue;

          const rowY = Math.round((Math.max(A.top, B.top) + Math.min(A.bottom, B.bottom)) / 2);

          // Case 1: Dragged X is to the right of B
          if (overlapsVertically(B, currentRect)) {
            const candRight = B.right + gapAB;
            if (Math.abs(left - candRight) < SNAP_THRESHOLD) {
              snappedX = candRight;
              activeEqualGaps.push({
                dir: 'horizontal',
                gap: gapAB,
                gap1: { x1: A.right, x2: B.left, y: rowY },
                gap2: { x1: B.right, x2: candRight, y: rowY }
              });
              break;
            }
          }

          // Case 2: Dragged X is to the left of A
          if (overlapsVertically(A, currentRect)) {
            const candLeft = A.left - gapAB - width;
            if (Math.abs(left - candLeft) < SNAP_THRESHOLD) {
              snappedX = candLeft;
              activeEqualGaps.push({
                dir: 'horizontal',
                gap: gapAB,
                gap1: { x1: candLeft + width, x2: A.left, y: rowY },
                gap2: { x1: A.right, x2: B.left, y: rowY }
              });
              break;
            }
          }

          // Case 3: Dragged X is between A and B
          if (overlapsVertically(A, currentRect)) {
            const totalSpace = B.left - A.right;
            if (totalSpace > width + 8) {
              const candMid = A.right + (totalSpace - width) / 2;
              if (Math.abs(left - candMid) < SNAP_THRESHOLD) {
                snappedX = candMid;
                const midGap = Math.round((totalSpace - width) / 2);
                activeEqualGaps.push({
                  dir: 'horizontal',
                  gap: midGap,
                  gap1: { x1: A.right, x2: candMid, y: rowY },
                  gap2: { x1: candMid + width, x2: B.left, y: rowY }
                });
                break;
              }
            }
          }
        }
      }
      if (activeEqualGaps.length > 0) break;
    }

    // B. Vertical Equal Spacing (between cards in the same column)
    for (let i = 0; i < validTargets.length; i++) {
      for (let j = 0; j < validTargets.length; j++) {
        if (i === j) continue;
        const A = validTargets[i];
        const B = validTargets[j];

        if (A.bottom < B.top && overlapsHorizontally(A, B)) {
          const gapAB = Math.round(B.top - A.bottom);
          if (gapAB < 4 || gapAB > 600) continue;

          const colX = Math.round((Math.max(A.left, B.left) + Math.min(A.right, B.right)) / 2);

          // Case 1: Dragged Y is below B
          if (overlapsHorizontally(B, currentRect)) {
            const candBelow = B.bottom + gapAB;
            if (Math.abs(top - candBelow) < SNAP_THRESHOLD) {
              snappedY = candBelow;
              activeEqualGaps.push({
                dir: 'vertical',
                gap: gapAB,
                gap1: { y1: A.bottom, y2: B.top, x: colX },
                gap2: { y1: B.bottom, y2: candBelow, x: colX }
              });
              break;
            }
          }

          // Case 2: Dragged Y is above A
          if (overlapsHorizontally(A, currentRect)) {
            const candAbove = A.top - gapAB - height;
            if (Math.abs(top - candAbove) < SNAP_THRESHOLD) {
              snappedY = candAbove;
              activeEqualGaps.push({
                dir: 'vertical',
                gap: gapAB,
                gap1: { y1: candAbove + height, y2: A.top, x: colX },
                gap2: { y1: A.bottom, y2: B.top, x: colX }
              });
              break;
            }
          }

          // Case 3: Dragged Y is between A and B
          if (overlapsHorizontally(A, currentRect)) {
            const totalSpaceY = B.top - A.bottom;
            if (totalSpaceY > height + 8) {
              const candMidY = A.bottom + (totalSpaceY - height) / 2;
              if (Math.abs(top - candMidY) < SNAP_THRESHOLD) {
                snappedY = candMidY;
                const midGapY = Math.round((totalSpaceY - height) / 2);
                activeEqualGaps.push({
                  dir: 'vertical',
                  gap: midGapY,
                  gap1: { y1: A.bottom, y2: candMidY, x: colX },
                  gap2: { y1: candMidY + height, y2: B.top, x: colX }
                });
                break;
              }
            }
          }
        }
      }
      if (activeEqualGaps.length > 0) break;
    }

    // 4. Photoshop-Style Adjacent Pixel Distance Measurement
    let distanceGap = null;
    if (activeEqualGaps.length === 0) {
      for (const t of validTargets) {
        if (overlapsVertically(t, currentRect)) {
          if (t.right <= left && (left - t.right) > 2 && (left - t.right) < 300) {
            const d = Math.round(left - t.right);
            const midY = Math.round((Math.max(top, t.top) + Math.min(bottom, t.bottom)) / 2);
            distanceGap = { dir: 'horizontal', x1: t.right, x2: left, y: midY, dist: d };
            break;
          } else if (right <= t.left && (t.left - right) > 2 && (t.left - right) < 300) {
            const d = Math.round(t.left - right);
            const midY = Math.round((Math.max(top, t.top) + Math.min(bottom, t.bottom)) / 2);
            distanceGap = { dir: 'horizontal', x1: right, x2: t.left, y: midY, dist: d };
            break;
          }
        }
        if (overlapsHorizontally(t, currentRect)) {
          if (t.bottom <= top && (top - t.bottom) > 2 && (top - t.bottom) < 300) {
            const d = Math.round(top - t.bottom);
            const midX = Math.round((Math.max(left, t.left) + Math.min(right, t.right)) / 2);
            distanceGap = { dir: 'vertical', y1: t.bottom, y2: top, x: midX, dist: d };
            break;
          } else if (bottom <= t.top && (t.top - bottom) > 2 && (t.top - bottom) < 300) {
            const d = Math.round(t.top - bottom);
            const midX = Math.round((Math.max(left, t.left) + Math.min(right, t.right)) / 2);
            distanceGap = { dir: 'vertical', y1: bottom, y2: t.top, x: midX, dist: d };
            break;
          }
        }
      }
    }

    this.drawSmartGuides(activeVRays, activeHRays, snappedX, snappedY, activeEqualGaps, distanceGap);

    return { x: snappedX, y: snappedY };
  },

  calculateDimensionGuides(resizedEl, currentWidth, currentHeight) {
    if (!this.smartGuidesSvgEl) return { width: currentWidth, height: currentHeight };

    const SNAP_THRESHOLD = 6;
    const staticElements = Array.from(document.querySelectorAll('.shortcut-card, .shortcut-group-section, #google-logo-section, #search-bar-section'))
      .filter(el => el !== resizedEl && getComputedStyle(el).display !== 'none');

    let snappedW = currentWidth;
    let snappedH = currentHeight;
    let activeVRays = [];
    let activeHRays = [];

    const rect = resizedEl.getBoundingClientRect();

    for (const el of staticElements) {
      const r = el.getBoundingClientRect();

      // Equal Width Snapping
      if (Math.abs(currentWidth - r.width) < SNAP_THRESHOLD) {
        snappedW = Math.round(r.width);
        activeVRays.push({ x: rect.left + snappedW, label: `Equal Width (${snappedW}px)` });
        break;
      }

      // Equal Height Snapping
      if (Math.abs(currentHeight - r.height) < SNAP_THRESHOLD) {
        snappedH = Math.round(r.height);
        activeHRays.push({ y: rect.top + snappedH, label: `Equal Height (${snappedH}px)` });
        break;
      }
    }

    this.drawSmartGuides(activeVRays, activeHRays, rect.left, rect.top);

    return { width: snappedW, height: snappedH };
  },

  drawSmartGuides(vRays, hRays, currentX, currentY, equalGaps = [], distanceGap = null) {
    if (!this.smartGuidesSvgEl) return;

    if ((!vRays || vRays.length === 0) && (!hRays || hRays.length === 0) && (!equalGaps || equalGaps.length === 0) && !distanceGap) {
      this.clearSmartGuides();
      return;
    }

    let svgHtml = '';

    // Render Vertical Alignment Ray Lines (Cyan Glowing Lines)
    (vRays || []).forEach(vRay => {
      const y1 = vRay.y1 !== undefined ? vRay.y1 : 0;
      const y2 = vRay.y2 !== undefined ? vRay.y2 : window.innerHeight;
      svgHtml += `<line x1="${vRay.x}" y1="${y1}" x2="${vRay.x}" y2="${y2}" stroke="#00e5ff" stroke-width="1.5" stroke-dasharray="6 3" class="snap-pulse-line" style="color:#00e5ff"/>`;
    });

    // Render Horizontal Alignment Ray Lines (Magenta Glowing Lines)
    (hRays || []).forEach(hRay => {
      const x1 = hRay.x1 !== undefined ? hRay.x1 : 0;
      const x2 = hRay.x2 !== undefined ? hRay.x2 : window.innerWidth;
      svgHtml += `<line x1="${x1}" y1="${hRay.y}" x2="${x2}" y2="${hRay.y}" stroke="#ff007f" stroke-width="1.5" stroke-dasharray="6 3" class="snap-pulse-line" style="color:#ff007f"/>`;
    });

    // Render Photoshop-Style Equal Distance Spacing Guides with Pixel Difference Badges
    (equalGaps || []).forEach(eg => {
      if (eg.dir === 'horizontal') {
        const { gap1, gap2, gap } = eg;
        svgHtml += `<line x1="${gap1.x1}" y1="${gap1.y}" x2="${gap1.x2}" y2="${gap1.y}" stroke="#ffb703" stroke-width="2" class="snap-pulse-line" style="color:#ffb703"/>`;
        svgHtml += `<line x1="${gap1.x1}" y1="${gap1.y - 6}" x2="${gap1.x1}" y2="${gap1.y + 6}" stroke="#ffb703" stroke-width="2"/>`;
        svgHtml += `<line x1="${gap1.x2}" y1="${gap1.y - 6}" x2="${gap1.x2}" y2="${gap1.y + 6}" stroke="#ffb703" stroke-width="2"/>`;

        svgHtml += `<line x1="${gap2.x1}" y1="${gap2.y}" x2="${gap2.x2}" y2="${gap2.y}" stroke="#ffb703" stroke-width="2" class="snap-pulse-line" style="color:#ffb703"/>`;
        svgHtml += `<line x1="${gap2.x1}" y1="${gap2.y - 6}" x2="${gap2.x1}" y2="${gap2.y + 6}" stroke="#ffb703" stroke-width="2"/>`;
        svgHtml += `<line x1="${gap2.x2}" y1="${gap2.y - 6}" x2="${gap2.x2}" y2="${gap2.y + 6}" stroke="#ffb703" stroke-width="2"/>`;

        const mid1X = (gap1.x1 + gap1.x2) / 2;
        const mid2X = (gap2.x1 + gap2.x2) / 2;
        svgHtml += `
          <g class="snap-badge-pulse">
            <rect x="${mid1X - 18}" y="${gap1.y - 9}" width="36" height="18" rx="4" fill="rgba(24, 27, 34, 0.9)" stroke="#ffb703" stroke-width="1.2"/>
            <text x="${mid1X}" y="${gap1.y + 4}" fill="#ffffff" font-size="10.5" font-weight="600" text-anchor="middle" font-family="system-ui, sans-serif">${gap}px</text>
          </g>
          <g class="snap-badge-pulse">
            <rect x="${mid2X - 18}" y="${gap2.y - 9}" width="36" height="18" rx="4" fill="rgba(24, 27, 34, 0.9)" stroke="#ffb703" stroke-width="1.2"/>
            <text x="${mid2X}" y="${gap2.y + 4}" fill="#ffffff" font-size="10.5" font-weight="600" text-anchor="middle" font-family="system-ui, sans-serif">${gap}px</text>
          </g>
        `;
      } else if (eg.dir === 'vertical') {
        const { gap1, gap2, gap } = eg;
        svgHtml += `<line x1="${gap1.x}" y1="${gap1.y1}" x2="${gap1.x}" y2="${gap1.y2}" stroke="#00f5d4" stroke-width="2" class="snap-pulse-line" style="color:#00f5d4"/>`;
        svgHtml += `<line x1="${gap1.x - 6}" y1="${gap1.y1}" x2="${gap1.x + 6}" y2="${gap1.y1}" stroke="#00f5d4" stroke-width="2"/>`;
        svgHtml += `<line x1="${gap1.x - 6}" y1="${gap1.y2}" x2="${gap1.x + 6}" y2="${gap1.y2}" stroke="#00f5d4" stroke-width="2"/>`;

        svgHtml += `<line x1="${gap2.x}" y1="${gap2.y1}" x2="${gap2.x}" y2="${gap2.y2}" stroke="#00f5d4" stroke-width="2" class="snap-pulse-line" style="color:#00f5d4"/>`;
        svgHtml += `<line x1="${gap2.x - 6}" y1="${gap2.y1}" x2="${gap2.x + 6}" y2="${gap2.y1}" stroke="#00f5d4" stroke-width="2"/>`;
        svgHtml += `<line x1="${gap2.x - 6}" y1="${gap2.y2}" x2="${gap2.x + 6}" y2="${gap2.y2}" stroke="#00f5d4" stroke-width="2"/>`;

        const mid1Y = (gap1.y1 + gap1.y2) / 2;
        const mid2Y = (gap2.y1 + gap2.y2) / 2;
        svgHtml += `
          <g class="snap-badge-pulse">
            <rect x="${gap1.x - 18}" y="${mid1Y - 9}" width="36" height="18" rx="4" fill="rgba(24, 27, 34, 0.9)" stroke="#00f5d4" stroke-width="1.2"/>
            <text x="${gap1.x}" y="${mid1Y + 4}" fill="#ffffff" font-size="10.5" font-weight="600" text-anchor="middle" font-family="system-ui, sans-serif">${gap}px</text>
          </g>
          <g class="snap-badge-pulse">
            <rect x="${gap2.x - 18}" y="${mid2Y - 9}" width="36" height="18" rx="4" fill="rgba(24, 27, 34, 0.9)" stroke="#00f5d4" stroke-width="1.2"/>
            <text x="${gap2.x}" y="${mid2Y + 4}" fill="#ffffff" font-size="10.5" font-weight="600" text-anchor="middle" font-family="system-ui, sans-serif">${gap}px</text>
          </g>
        `;
      }
    });

    // Render Adjacent Pixel Distance Measurement (between dragged item and closest adjacent object)
    if (distanceGap) {
      if (distanceGap.dir === 'horizontal') {
        const midX = (distanceGap.x1 + distanceGap.x2) / 2;
        svgHtml += `
          <line x1="${distanceGap.x1}" y1="${distanceGap.y}" x2="${distanceGap.x2}" y2="${distanceGap.y}" stroke="#ff9100" stroke-width="1.5" stroke-dasharray="3 2"/>
          <line x1="${distanceGap.x1}" y1="${distanceGap.y - 5}" x2="${distanceGap.x1}" y2="${distanceGap.y + 5}" stroke="#ff9100" stroke-width="1.5"/>
          <line x1="${distanceGap.x2}" y1="${distanceGap.y - 5}" x2="${distanceGap.x2}" y2="${distanceGap.y + 5}" stroke="#ff9100" stroke-width="1.5"/>
          <g class="snap-badge-pulse">
            <rect x="${midX - 18}" y="${distanceGap.y - 9}" width="36" height="18" rx="4" fill="rgba(24, 27, 34, 0.92)" stroke="#ff9100" stroke-width="1.2"/>
            <text x="${midX}" y="${distanceGap.y + 4}" fill="#ffffff" font-size="10.5" font-weight="600" text-anchor="middle" font-family="system-ui, sans-serif">${distanceGap.dist}px</text>
          </g>
        `;
      } else if (distanceGap.dir === 'vertical') {
        const midY = (distanceGap.y1 + distanceGap.y2) / 2;
        svgHtml += `
          <line x1="${distanceGap.x}" y1="${distanceGap.y1}" x2="${distanceGap.x}" y2="${distanceGap.y2}" stroke="#00e5ff" stroke-width="1.5" stroke-dasharray="3 2"/>
          <line x1="${distanceGap.x - 5}" y1="${distanceGap.y1}" x2="${distanceGap.x + 5}" y2="${distanceGap.y1}" stroke="#00e5ff" stroke-width="1.5"/>
          <line x1="${distanceGap.x - 5}" y1="${distanceGap.y2}" x2="${distanceGap.x + 5}" y2="${distanceGap.y2}" stroke="#00e5ff" stroke-width="1.5"/>
          <g class="snap-badge-pulse">
            <rect x="${distanceGap.x - 18}" y="${midY - 9}" width="36" height="18" rx="4" fill="rgba(24, 27, 34, 0.92)" stroke="#00e5ff" stroke-width="1.2"/>
            <text x="${distanceGap.x}" y="${midY + 4}" fill="#ffffff" font-size="10.5" font-weight="600" text-anchor="middle" font-family="system-ui, sans-serif">${distanceGap.dist}px</text>
          </g>
        `;
      }
    }

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
      const resId = this.resizeTargetId;
      const finalWidth = parseFloat(this.activeResizingEl.dataset.customWidth || this.activeResizingEl.offsetWidth);
      const finalHeight = parseFloat(this.activeResizingEl.dataset.customHeight || this.activeResizingEl.offsetHeight);

      if (this.resizeTargetType === 'shortcut' && this.resizeTargetId) {
        await ShortcutStorage.updateShortcut(this.resizeTargetId, {
          size: { width: finalWidth, height: finalHeight }
        });
      } else if (this.resizeTargetType === 'group' && this.resizeTargetId) {
        await ShortcutStorage.updateGroup(this.resizeTargetId, {
          size: { width: finalWidth, height: finalHeight }
        });
      } else if (this.resizeTargetType === 'logo') {
        await ShortcutStorage.saveSettings({
          logoSize: { width: finalWidth, height: finalHeight }
        });
      } else if (this.resizeTargetType === 'search') {
        await ShortcutStorage.saveSettings({
          searchBarSize: { width: finalWidth, height: finalHeight }
        });
      }

      this.justResized = true;
      this.lastResizedId = resId;
      this.lastResizeTime = Date.now();

      this.activeResizingEl = null;
      this.isResizing = false;
      document.body.classList.remove('is-actively-dragging');

      setTimeout(() => {
        this.justResized = false;
      }, 400);
      return;
    }

    // 1. Handle Main Section Drop
    if (this.activeMainSection) {
      if (this.isSectionDragging) {
        const posX = parseFloat(this.activeMainSection.dataset.posX || '0');
        const posY = parseFloat(this.activeMainSection.dataset.posY || '0');

        if (this.mainSectionId === 'google-logo-section') {
          await ShortcutStorage.saveSettings({ logoPosition: { x: posX, y: posY } });
        } else if (this.mainSectionId === 'search-bar-section') {
          await ShortcutStorage.saveSettings({ searchBarPosition: { x: posX, y: posY } });
        }
      }
      this.activeMainSection = null;
      this.isSectionDragging = false;
      document.body.classList.remove('is-actively-dragging');
      return;
    }

    // 2. Handle Group Section Drop
    if (this.activeGroupSection) {
      if (this.isGroupDragging) {
        this.activeGroupSection.classList.remove('is-dragging-group');

        if (this.layoutMode === 'grid') {
          const parent = this.activeGroupSection.parentNode;
          const sections = Array.from(parent.querySelectorAll('.shortcut-group-section'));
          const reorderedGroupIds = sections.map(sec => sec.dataset.groupId).filter(Boolean);

          const groups = await ShortcutStorage.getGroups();
          const updatedGroups = [];
          reorderedGroupIds.forEach((gid, idx) => {
            const g = groups.find(item => item.id === gid);
            if (g) {
              updatedGroups.push({ ...g, order: idx });
            }
          });
          await ShortcutStorage.saveGroups(updatedGroups);
        } else {
          const groupId = this.activeGroupSection.dataset.groupId;
          const posX = parseFloat(this.activeGroupSection.dataset.posX || '0');
          const posY = parseFloat(this.activeGroupSection.dataset.posY || '0');

          if (groupId) {
            await ShortcutStorage.updateGroup(groupId, {
              position: { x: posX, y: posY },
              hasCustomPosition: true
            });
          }
        }
      }

      this.activeGroupSection = null;
      this.isGroupDragging = false;
      document.body.classList.remove('is-actively-dragging');
      setTimeout(() => {
        this.wasGroupJustDragged = false;
      }, 300);
      return;
    }

    // 3. Handle Shortcut Tile Drop
    if (!this.activeTile) return;

    if (this.isDragging) {
      const tileId = this.activeTile.dataset.id || (this.activeTile.classList.contains('shortcut-card-add') ? 'add-shortcut-btn' : null);
      this.lastDraggedId = tileId;
      this.lastDragTime = Date.now();

      // Clean up multi-drag visual styling classes
      if (this.selectedTilesData && this.selectedTilesData.length > 0) {
        this.selectedTilesData.forEach(item => {
          if (item.el) item.el.classList.remove('is-multidrag-active');
        });
      }

      // Check if multi-tile group drop onto a category group
      if (this.selectedTilesData && this.selectedTilesData.length > 1 && this.hoveredGroupId !== undefined) {
        const targetGroupId = this.hoveredGroupId;
        const shortcuts = await ShortcutStorage.getShortcuts();
        const updated = shortcuts.map(s => {
          if (ShortcutGrid.selectedShortcutIds.has(s.id)) {
            return {
              ...s,
              groupId: targetGroupId,
              position: null,
              hasCustomPosition: false
            };
          }
          return s;
        });
        await ShortcutStorage.saveShortcuts(updated);
        await ShortcutGrid.render();
        this.selectedTilesData = [];
      } else if (this.selectedTilesData && this.selectedTilesData.length > 1) {
        // Multi-tile group drop in Free Placement mode: save coordinates of all moved items
        const shortcuts = await ShortcutStorage.getShortcuts();
        const updatedShortcuts = shortcuts.map(s => {
          const movedItem = this.selectedTilesData.find(item => item.id === s.id);
          if (movedItem && movedItem.el) {
            const posX = parseFloat(movedItem.el.dataset.posX || '0');
            const posY = parseFloat(movedItem.el.dataset.posY || '0');
            return {
              ...s,
              position: { x: posX, y: posY },
              hasCustomPosition: true
            };
          }
          return s;
        });
        await ShortcutStorage.saveShortcuts(updatedShortcuts);
        this.selectedTilesData = [];
      } else if (this.layoutMode === 'grid') {
        const shortcuts = await ShortcutStorage.getShortcuts();
        const currentShortcut = shortcuts.find(s => s.id === tileId);

        // Cross-Group Drop: check if shortcut category changed
        if (currentShortcut && this.hoveredGroupId !== undefined) {
          const newGroupId = this.hoveredGroupId;
          const oldGroupId = currentShortcut.groupId || null;

          if (newGroupId !== oldGroupId) {
            const existingInTarget = shortcuts.filter(s => (s.groupId || null) === (newGroupId || null));
            const maxOrder = existingInTarget.reduce((max, s) => Math.max(max, s.order ?? 0), -1);
            await ShortcutStorage.updateShortcut(tileId, { groupId: newGroupId, order: maxOrder + 1 });
            await ShortcutGrid.render();
          } else {
            // Same group reorder - scoped strictly to this group container
            const parentGrid = this.activeTile.closest('.group-grid') || document;
            const tiles = Array.from(parentGrid.querySelectorAll('.shortcut-card:not(.shortcut-card-add)'));
            const newOrderIds = tiles.map(tile => tile.dataset.id);
            const updated = shortcuts.map(s => {
              const idx = newOrderIds.indexOf(s.id);
              if (idx !== -1) {
                return { ...s, order: idx };
              }
              return s;
            });
            await ShortcutStorage.saveShortcuts(updated);
          }
        } else {
          // Standard reorder - scoped strictly to the current group grid
          const parentGrid = this.activeTile.closest('.group-grid') || document;
          const tiles = Array.from(parentGrid.querySelectorAll('.shortcut-card:not(.shortcut-card-add)'));
          const newOrderIds = tiles.map(tile => tile.dataset.id);
          const updated = shortcuts.map(s => {
            const idx = newOrderIds.indexOf(s.id);
            if (idx !== -1) {
              return { ...s, order: idx };
            }
            return s;
          });
          await ShortcutStorage.saveShortcuts(updated);
        }
      } else {
        // Free mode: update active tile's full screen coordinates
        const id = this.activeTile.dataset.id;
        const posX = parseFloat(this.activeTile.dataset.posX || '0');
        const posY = parseFloat(this.activeTile.dataset.posY || '0');
        if (id) {
          await ShortcutStorage.updateShortcut(id, {
            position: { x: posX, y: posY },
            hasCustomPosition: true
          });
        } else if (this.activeTile.classList.contains('shortcut-card-add')) {
          await ShortcutStorage.saveSettings({ addShortcutPosition: { x: posX, y: posY } });
        }
      }
    }

    if (this.activeTile) {
      this.activeTile.classList.remove('is-dragging');
    }
    if (this.ghostEl) {
      this.ghostEl.remove();
      this.ghostEl = null;
    }

    this.activeTile = null;
    this.isDragging = false;
    this.hoveredGroupId = undefined;
    document.body.classList.remove('is-actively-dragging');

    setTimeout(() => {
      this.justDragged = false;
      this.justSelectedId = null;
    }, 400);
  }
};
