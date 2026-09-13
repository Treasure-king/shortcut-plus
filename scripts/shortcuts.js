/* shortcuts.js - Grid rendering with un-grouped default and optional category sections */

const ShortcutGrid = {
  container: null,
  shortcuts: [],
  groups: [],
  layoutMode: 'grid', // 'grid' | 'free'
  tileStyle: 'grid', // 'grid' | 'pill' | 'list'
  isMultiSelectMode: false,
  selectedShortcutIds: new Set(),
  activeTileDropdown: null,

  init(containerElement, layoutMode = 'grid') {
    this.container = containerElement;
    this.layoutMode = layoutMode;

    document.addEventListener('click', (e) => {
      if (this.activeTileDropdown && !this.activeTileDropdown.contains(e.target) && !e.target.closest('.shortcut-menu-btn')) {
        this.closeTileMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeTileDropdown) {
        this.closeTileMenu();
      }
    });
  },

  openInCurrentTab(url) {
    const targetUrl = FaviconResolver.normalizeUrl(url);
    window.location.href = targetUrl;
  },

  openInNewTab(url) {
    const targetUrl = FaviconResolver.normalizeUrl(url);
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: targetUrl, active: true });
    } else {
      window.open(targetUrl, '_blank');
    }
  },

  openInNewWindow(url) {
    const targetUrl = FaviconResolver.normalizeUrl(url);
    if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.create) {
      chrome.windows.create({ url: targetUrl, incognito: false });
    } else {
      window.open(targetUrl, '_blank', 'popup=no');
    }
  },

  openInIncognito(url) {
    const targetUrl = FaviconResolver.normalizeUrl(url);
    try {
      if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.create) {
        if (chrome.extension && typeof chrome.extension.isAllowedIncognitoAccess === 'function') {
          chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
            if (!isAllowed) {
              window.showToast?.('Enable "Allow in Incognito" in Chrome Settings to open incognito windows');
              if (chrome.tabs && chrome.tabs.create && chrome.runtime && chrome.runtime.id) {
                chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
              }
            } else {
              chrome.windows.create({ url: targetUrl, incognito: true }, (win) => {
                if (chrome.runtime && chrome.runtime.lastError) {
                  window.showToast?.('Could not open Incognito: ' + chrome.runtime.lastError.message);
                }
              });
            }
          });
        } else {
          chrome.windows.create({ url: targetUrl, incognito: true }, (win) => {
            if (chrome.runtime && chrome.runtime.lastError) {
              window.showToast?.('Enable "Allow in Incognito" in Chrome Settings');
            }
          });
        }
      } else {
        window.showToast?.('Incognito mode is only available within Chrome');
      }
    } catch (err) {
      console.error('Error launching incognito window:', err);
      window.showToast?.('Could not open Incognito window');
    }
  },

  openMultipleShortcuts(items, mode = 'new-tab') {
    if (!items || items.length === 0) return;
    const urls = items.map(item => {
      const rawUrl = typeof item === 'string' ? item : item.url;
      return FaviconResolver.normalizeUrl(rawUrl);
    }).filter(Boolean);

    if (urls.length === 0) return;

    if (mode === 'incognito') {
      try {
        if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.create) {
          if (chrome.extension && typeof chrome.extension.isAllowedIncognitoAccess === 'function') {
            chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
              if (!isAllowed) {
                window.showToast?.('Enable "Allow in Incognito" in Chrome Settings to open incognito windows');
                if (chrome.tabs && chrome.tabs.create && chrome.runtime && chrome.runtime.id) {
                  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
                }
              } else {
                chrome.windows.create({ url: urls, incognito: true }, (win) => {
                  if (chrome.runtime && chrome.runtime.lastError) {
                    window.showToast?.('Could not open Incognito: ' + chrome.runtime.lastError.message);
                  }
                });
              }
            });
          } else {
            chrome.windows.create({ url: urls, incognito: true }, (win) => {
              if (chrome.runtime && chrome.runtime.lastError) {
                window.showToast?.('Enable "Allow in Incognito" in Chrome Settings');
              }
            });
          }
        } else {
          window.showToast?.('Incognito mode is only available within Chrome');
        }
      } catch (err) {
        console.error('Error launching incognito window:', err);
        window.showToast?.('Could not open Incognito window');
      }
      return;
    }

    if (mode === 'new-window') {
      try {
        if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.create) {
          chrome.windows.create({ url: urls, incognito: false });
        } else {
          urls.forEach(u => window.open(u, '_blank', 'popup=no'));
        }
      } catch (err) {
        console.error('Error launching new window:', err);
        urls.forEach(u => window.open(u, '_blank', 'popup=no'));
      }
      return;
    }

    // Default mode: 'new-tab'
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        urls.forEach((u, idx) => {
          chrome.tabs.create({ url: u, active: idx === 0 });
        });
      } else {
        urls.forEach(u => window.open(u, '_blank'));
      }
    } catch (err) {
      console.error('Error opening new tabs:', err);
      urls.forEach(u => window.open(u, '_blank'));
    }
  },

  openSelectedShortcuts(mode = 'new-tab') {
    if (!this.selectedShortcutIds || this.selectedShortcutIds.size === 0) {
      window.showToast?.('No shortcuts selected to open');
      return;
    }
    const selectedIds = Array.from(this.selectedShortcutIds);
    const toOpen = this.shortcuts.filter(s => selectedIds.includes(s.id));
    if (toOpen.length === 0) return;

    this.openMultipleShortcuts(toOpen, mode);
    const modeLabel = mode === 'incognito' ? 'Incognito' : mode === 'new-window' ? 'New Window' : 'New Tabs';
    window.showToast?.(`Opened ${toOpen.length} shortcut${toOpen.length > 1 ? 's' : ''} in ${modeLabel}`);
  },

  closeTileMenu() {
    if (this.activeTileDropdown) {
      this.activeTileDropdown.remove();
      this.activeTileDropdown = null;
    }
  },

  showTileMenu(shortcut, card, anchorEl) {
    this.closeTileMenu();

    const dropdown = document.createElement('div');
    dropdown.className = 'shortcut-action-dropdown';
    dropdown.setAttribute('role', 'menu');

    const targetUrl = FaviconResolver.normalizeUrl(shortcut.url);

    dropdown.innerHTML = `
      <button type="button" class="dropdown-item" data-action="new-tab">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          <polyline points="15 3 21 3 21 9"></polyline>
          <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
        <span>Open in New Tab</span>
        <kbd class="dropdown-kbd">Ctrl+Click</kbd>
      </button>

      <button type="button" class="dropdown-item" data-action="new-window">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
          <line x1="8" y1="21" x2="16" y2="21"></line>
          <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
        <span>Open in New Window</span>
        <kbd class="dropdown-kbd">Ctrl+Shift+Click</kbd>
      </button>

      <button type="button" class="dropdown-item" data-action="incognito">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 12h20"></path>
          <circle cx="7" cy="16" r="3"></circle>
          <circle cx="17" cy="16" r="3"></circle>
          <path d="M5 8l2-5h10l2 5"></path>
        </svg>
        <span>Open in Incognito</span>
        <kbd class="dropdown-kbd">Alt+Click</kbd>
      </button>

      <div class="dropdown-divider"></div>

      <button type="button" class="dropdown-item" data-action="edit">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
        <span>Edit Shortcut</span>
      </button>

      <button type="button" class="dropdown-item" data-action="copy">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>Copy URL</span>
      </button>

      <div class="dropdown-divider"></div>

      <button type="button" class="dropdown-item dropdown-item-danger" data-action="delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>Delete Shortcut</span>
      </button>
    `;

    dropdown.addEventListener('click', async (e) => {
      const btn = e.target.closest('.dropdown-item');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.action;
      this.closeTileMenu();

      if (action === 'new-tab') {
        this.openInNewTab(targetUrl);
      } else if (action === 'new-window') {
        this.openInNewWindow(targetUrl);
      } else if (action === 'incognito') {
        this.openInIncognito(targetUrl);
      } else if (action === 'edit') {
        ShortcutModal.openEdit(shortcut);
      } else if (action === 'copy') {
        try {
          await navigator.clipboard.writeText(targetUrl);
          window.showToast?.('URL copied to clipboard');
        } catch (err) {
          window.showToast?.('Failed to copy URL');
        }
      } else if (action === 'delete') {
        if (confirm(`Delete shortcut "${shortcut.name}"?`)) {
          await ShortcutStorage.deleteShortcut(shortcut.id);
          await this.render();
          window.showToast?.('Shortcut deleted');
        }
      }
    });

    document.body.appendChild(dropdown);
    this.activeTileDropdown = dropdown;

    const rect = anchorEl.getBoundingClientRect();
    const dropdownW = 220;
    let left = rect.right - dropdownW;
    if (left < 10) left = rect.left;
    if (left + dropdownW > window.innerWidth - 10) left = window.innerWidth - dropdownW - 10;

    let top = rect.bottom + 6;
    if (top + 260 > window.innerHeight) {
      top = Math.max(10, rect.top - 260);
    }

    dropdown.style.left = `${left}px`;
    dropdown.style.top = `${top}px`;
  },

  setLayoutMode(mode) {
    this.layoutMode = mode;
    this.updateContainerClasses();
  },

  setTileStyle(style) {
    this.tileStyle = style;
    this.updateContainerClasses();
  },

  updateContainerClasses() {
    if (this.container) {
      this.container.className = `shortcuts-grid mode-${this.layoutMode} tile-style-${this.tileStyle}`;
    }
  },

  setMultiSelectMode(enabled) {
    this.isMultiSelectMode = enabled;
    if (!enabled) {
      this.selectedShortcutIds.clear();
    }
    if (enabled) {
      document.body.classList.add('multiselect-active');
    } else {
      document.body.classList.remove('multiselect-active');
    }
    const bar = document.getElementById('multiselect-bar');
    if (bar) {
      if (enabled) {
        bar.classList.add('active');
      } else {
        bar.classList.remove('active');
      }
    }
    const selectBtn = document.getElementById('mode-select-btn');
    if (selectBtn) {
      if (enabled) {
        selectBtn.classList.add('active');
      } else {
        selectBtn.classList.remove('active');
      }
    }
    this.updateMultiselectUI();
    this.render();
  },

  toggleShortcutSelection(id, cardElement) {
    if (this.selectedShortcutIds.has(id)) {
      this.selectedShortcutIds.delete(id);
      if (cardElement) cardElement.classList.remove('is-selected');
    } else {
      this.selectedShortcutIds.add(id);
      if (cardElement) cardElement.classList.add('is-selected');
    }
    this.updateMultiselectUI();
  },

  selectAll() {
    this.shortcuts.forEach(s => this.selectedShortcutIds.add(s.id));
    if (this.container) {
      const cards = this.container.querySelectorAll('.shortcut-card:not(.shortcut-card-add)');
      cards.forEach(c => c.classList.add('is-selected'));
    }
    this.updateMultiselectUI();
  },

  clearSelection() {
    this.selectedShortcutIds.clear();
    if (this.container) {
      const cards = this.container.querySelectorAll('.shortcut-card');
      cards.forEach(c => c.classList.remove('is-selected'));
    }
    this.updateMultiselectUI();
  },

  async deleteSelected() {
    const count = this.selectedShortcutIds.size;
    if (count === 0) return;

    if (confirm(`Delete ${count} selected shortcut${count > 1 ? 's' : ''}?`)) {
      const idsToDelete = Array.from(this.selectedShortcutIds);
      await ShortcutStorage.deleteShortcuts(idsToDelete);
      this.selectedShortcutIds.clear();
      this.updateMultiselectUI();
      await this.render();
    }
  },

  selectSingleForInspection(shortcut, cardElement) {
    this.selectedShortcutIds.clear();
    this.selectedShortcutIds.add(shortcut.id);

    if (this.container) {
      const cards = this.container.querySelectorAll('.shortcut-card');
      cards.forEach(c => c.classList.remove('is-selected'));
    }
    if (cardElement) cardElement.classList.add('is-selected');

    const widthInput = document.getElementById('inspector-width-input');
    const heightInput = document.getElementById('inspector-height-input');

    const currentW = (shortcut.size && shortcut.size.width) ? shortcut.size.width : (cardElement ? cardElement.offsetWidth : 112);
    const currentH = (shortcut.size && shortcut.size.height) ? shortcut.size.height : (cardElement ? cardElement.offsetHeight : 112);

    if (widthInput) widthInput.value = currentW;
    if (heightInput) heightInput.value = currentH;

    this.updateMultiselectUI();
    if (typeof ShortcutModal !== 'undefined' && (!ShortcutModal.isOpen() || ShortcutModal.activeViewEl !== ShortcutModal.viewInspector)) {
      ShortcutModal.openInspector();
    }
  },

  updateMultiselectUI() {
    const countText = document.getElementById('multiselect-count-text');
    const deleteBtn = document.getElementById('multiselect-delete-btn');
    const openBtn = document.getElementById('multiselect-open-btn');
    const count = this.selectedShortcutIds.size;

    if (countText) {
      countText.textContent = `${count} selected`;
    }
    if (openBtn) {
      openBtn.disabled = count === 0;
      openBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: -1px;">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          <polyline points="15 3 21 3 21 9"></polyline>
          <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
        <span>${count > 0 ? `Open Selected (${count})` : 'Open Selected'}</span>
      `;
    }
    if (deleteBtn) {
      deleteBtn.disabled = count === 0;
      deleteBtn.textContent = count > 0 ? `Delete Selected (${count})` : 'Delete Selected';
    }

    const inspectorBadge = document.getElementById('inspector-selection-badge');
    const inspectorOpenBtn = document.getElementById('inspector-open-sel-btn');
    const inspectorDeleteBtn = document.getElementById('inspector-delete-sel-btn');
    if (inspectorBadge) {
      inspectorBadge.textContent = `${count} selected`;
    }
    if (inspectorOpenBtn) {
      inspectorOpenBtn.disabled = count === 0;
      inspectorOpenBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          <polyline points="15 3 21 3 21 9"></polyline>
          <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
        <span>${count > 0 ? `Open Selected (${count})` : 'Open Selected'}</span>
      `;
    }
    if (inspectorDeleteBtn) {
      inspectorDeleteBtn.disabled = count === 0;
      inspectorDeleteBtn.textContent = count > 0 ? `Delete Selected Shortcuts (${count})` : 'Delete Selected Shortcuts';
    }

    if (this.container) {
      const cards = this.container.querySelectorAll('.shortcut-card[data-id]');
      cards.forEach(card => {
        const id = card.dataset.id;
        const checkbox = card.querySelector('.shortcut-select-checkbox');
        const isSel = this.selectedShortcutIds.has(id);
        if (isSel) {
          card.classList.add('is-selected');
          if (checkbox) checkbox.checked = true;
        } else {
          card.classList.remove('is-selected');
          if (checkbox) checkbox.checked = false;
        }
      });
    }

    const bar = document.getElementById('multiselect-bar');
    if (bar) {
      if (count > 0 || this.isMultiSelectMode) {
        bar.classList.add('active');
      } else {
        bar.classList.remove('active');
      }
    }
  },

  async render() {
    if (!this.container) {
      this.container = document.getElementById('shortcuts-grid');
    }
    if (!this.container) {
      return;
    }

    this.shortcuts = await ShortcutStorage.getShortcuts();
    this.groups = await ShortcutStorage.getGroups();
    const settings = await ShortcutStorage.getSettings();
    if (!this.layoutMode) {
      this.layoutMode = settings.layoutMode || 'grid';
    }
    this.tileStyle = settings.tileStyle || 'grid';

    this.updateContainerClasses();
    this.container.innerHTML = '';

    if (this.layoutMode === 'grid') {
      await this.renderGroupedGrid();
    } else {
      await this.renderFreePlacement();
    }

    this.updateMultiselectUI();
  },

  async renderGroupedGrid() {
    // If no custom user groups exist, render all shortcuts inside a standard group-grid container
    if (!this.groups || this.groups.length === 0) {
      const grid = document.createElement('div');
      grid.className = 'group-grid';
      this.shortcuts.forEach((shortcut, idx) => {
        const tile = this.createShortcutTile(shortcut, idx);
        grid.appendChild(tile);
      });

      this.container.appendChild(grid);
      return;
    }

    // Categorize shortcuts by user-created groups
    const groupMap = new Map();
    this.groups.forEach(g => groupMap.set(g.id, { info: g, items: [] }));
    const ungrouped = [];

    this.shortcuts.forEach(shortcut => {
      if (shortcut.groupId && groupMap.has(shortcut.groupId)) {
        groupMap.get(shortcut.groupId).items.push(shortcut);
      } else {
        ungrouped.push(shortcut);
      }
    });

    // 1. Render User-Created Group Sections
    groupMap.forEach(({ info, items }) => {
      const section = document.createElement('div');
      section.className = `shortcut-group-section ${info.isCollapsed ? 'is-collapsed' : ''}`;
      section.dataset.groupId = info.id;

      if (this.layoutMode === 'free') {
        let posX, posY;
        if (info.hasCustomPosition && info.position && typeof info.position.x === 'number') {
          posX = info.position.x;
          posY = info.position.y;
          if (posX > 100) posX = Number(((posX / window.innerWidth) * 100).toFixed(2));
          if (posY > 100) posY = Number(((posY / window.innerHeight) * 100).toFixed(2));
        } else {
          const pixelX = Math.min(window.innerWidth - 380, 60 + (info.order || 0) * 360);
          const pixelY = 250;
          posX = Number(((pixelX / window.innerWidth) * 100).toFixed(2));
          posY = Number(((pixelY / window.innerHeight) * 100).toFixed(2));
        }

        section.style.position = 'fixed';
        section.style.left = `${posX}vw`;
        section.style.top = `${posY}vh`;
        section.dataset.posX = posX;
        section.dataset.posY = posY;
        section.classList.add('group-section-free');
      }

      if (this.layoutMode === 'free' && info.size && info.size.width) {
        section.style.width = `${info.size.width}px`;
        section.style.maxWidth = `${info.size.width}px`;
      } else {
        section.style.width = '';
        section.style.maxWidth = '';
      }

      if (this.layoutMode === 'free') {
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        handle.title = 'Drag to resize category group';
        section.appendChild(handle);
      }

      const header = document.createElement('div');
      header.className = 'group-header';
      header.innerHTML = `
        <div class="group-drag-handle" title="Drag to reorder category group">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="5" r="1.3"></circle>
            <circle cx="15" cy="5" r="1.3"></circle>
            <circle cx="9" cy="12" r="1.3"></circle>
            <circle cx="15" cy="12" r="1.3"></circle>
            <circle cx="9" cy="19" r="1.3"></circle>
            <circle cx="15" cy="19" r="1.3"></circle>
          </svg>
        </div>
        <svg class="group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        <span class="group-title" title="Double click to rename category"></span>
        <span class="group-badge">${items.length}</span>
        <div class="group-actions">
          <button class="group-btn-icon group-launch-btn" title="Launch All Shortcuts in New Tabs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </button>
          <button class="group-btn-icon group-rename-btn" title="Rename Group">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="group-btn-icon group-delete-btn" title="Delete Group">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;

      const promptRename = async () => {
        const newName = prompt(`Rename category group "${info.name}":`, info.name);
        if (newName && newName.trim() && newName.trim() !== info.name) {
          await ShortcutStorage.updateGroup(info.id, newName.trim());
          await ShortcutGrid.render();
        }
      };

      header.addEventListener('click', async (e) => {
        if (e.target.closest('.group-actions') || DragEngine.isGroupDragging || DragEngine.wasGroupJustDragged) return;
        section.classList.toggle('is-collapsed');
        await ShortcutStorage.toggleGroupCollapse(info.id);
      });

      const launchBtn = header.querySelector('.group-launch-btn');
      if (launchBtn) {
        launchBtn.title = 'Launch All Shortcuts\n• Click: New Tabs\n• Shift+Click: New Window\n• Alt+Click: Incognito Window';
        launchBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (items.length === 0) return;
          if (e.altKey) {
            this.openMultipleShortcuts(items, 'incognito');
          } else if (e.shiftKey) {
            this.openMultipleShortcuts(items, 'new-window');
          } else {
            this.openMultipleShortcuts(items, 'new-tab');
          }
        });
      }

      const titleEl = header.querySelector('.group-title');
      if (titleEl) {
        titleEl.textContent = info.name;
        titleEl.title = `Double click to rename category: ${info.name}`;
        titleEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          promptRename();
        });
      }

      const renameBtn = header.querySelector('.group-rename-btn');
      if (renameBtn) {
        renameBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          promptRename();
        });
      }

      const delBtn = header.querySelector('.group-delete-btn');
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Delete category group "${info.name}"? Shortcuts will return to Ungrouped.`)) {
            await ShortcutStorage.deleteGroup(info.id);
            await ShortcutGrid.render();
          }
        });
      }

      const grid = document.createElement('div');
      grid.className = 'group-grid';

      items.forEach((shortcut, idx) => {
        const tile = this.createShortcutTile(shortcut, idx);
        grid.appendChild(tile);
      });

      section.appendChild(header);
      section.appendChild(grid);
      this.container.appendChild(section);
    });

    // 2. Render Ungrouped shortcuts directly in grid with Add button right beside the last shortcut
    const unGrid = document.createElement('div');
    unGrid.className = 'group-grid';

    ungrouped.forEach((shortcut, idx) => {
      const tile = this.createShortcutTile(shortcut, idx);
      unGrid.appendChild(tile);
    });

    this.container.appendChild(unGrid);
  },

  async renderFreePlacement() {
    await this.renderGroupedGrid();
  },

  createShortcutTile(shortcut, index) {
    const card = document.createElement('a');
    card.className = 'shortcut-card';
    if (this.selectedShortcutIds.has(shortcut.id)) {
      card.classList.add('is-selected');
    }
    card.href = FaviconResolver.normalizeUrl(shortcut.url);
    card.target = '_self';
    card.dataset.id = shortcut.id;
    card.dataset.index = index;
    card.setAttribute('draggable', 'false');

    card.addEventListener('dragstart', (e) => {
      e.preventDefault();
      return false;
    });

    const isGrouped = shortcut.groupId && shortcut.groupId !== 'none';
    if (this.layoutMode === 'free' && !isGrouped) {
      let posX, posY;
      if (shortcut.hasCustomPosition && shortcut.position && typeof shortcut.position.x === 'number') {
        posX = shortcut.position.x;
        posY = shortcut.position.y;
        if (posX > 100) posX = Number(((posX / window.innerWidth) * 100).toFixed(2));
        if (posY > 100) posY = Number(((posY / window.innerHeight) * 100).toFixed(2));
      } else {
        const cols = Math.max(2, Math.floor((window.innerWidth - 120) / 140));
        const col = index % cols;
        const row = Math.floor(index / cols);
        const pixelX = 60 + col * 140;
        const pixelY = 250 + row * 140;
        posX = Number(((pixelX / window.innerWidth) * 100).toFixed(2));
        posY = Number(((pixelY / window.innerHeight) * 100).toFixed(2));
      }

      card.style.position = 'fixed';
      card.style.left = `${posX}vw`;
      card.style.top = `${posY}vh`;
      card.dataset.posX = posX;
      card.dataset.posY = posY;
      card.classList.add('shortcut-card-free');
    }

    if (shortcut.size && shortcut.size.width && shortcut.size.height) {
      card.style.width = `${shortcut.size.width}px`;
      card.style.height = `${shortcut.size.height}px`;
      if (shortcut.size.height < 68 || shortcut.size.width < 68) {
        card.classList.add('is-compact-tile');
      } else {
        card.classList.remove('is-compact-tile');
      }
    } else {
      card.style.width = '';
      card.style.height = '';
      card.classList.remove('is-compact-tile');
    }



    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'shortcut-select-overlay';
    checkboxWrapper.innerHTML = `<input type="checkbox" class="shortcut-select-checkbox" ${this.selectedShortcutIds.has(shortcut.id) ? 'checked' : ''}>`;
    card.appendChild(checkboxWrapper);

    card.addEventListener('click', (e) => {
      const isEditMode = document.body.classList.contains('edit-mode-active');

      if (DragEngine.isDragging || DragEngine.justDragged || DragEngine.wasJustDragged(shortcut.id) ||
        DragEngine.isResizing || DragEngine.justResized || DragEngine.wasJustResized(shortcut.id)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Fix: Handle direct checkbox clicks using native checked state
      if (e.target.classList.contains('shortcut-select-checkbox')) {
        e.stopPropagation();
        const checkbox = e.target;
        if (checkbox.checked) {
          this.selectedShortcutIds.add(shortcut.id);
        } else {
          this.selectedShortcutIds.delete(shortcut.id);
        }
        card.classList.toggle('is-selected', checkbox.checked);
        this.updateMultiselectUI();
        return;
      }

      const isMultiSelected = this.selectedShortcutIds.has(shortcut.id) && this.selectedShortcutIds.size > 1;

      // Batch open if card is one of multiple selected shortcuts
      if (isMultiSelected) {
        // 1. Incognito Mode: Alt + Click OR Ctrl + Alt + Click
        if (e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          this.openSelectedShortcuts('incognito');
          return false;
        }

        // 2. New Window: (Ctrl or Cmd) + Shift + Click
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          this.openSelectedShortcuts('new-window');
          return false;
        }

        // 3. New Tab: (Ctrl or Cmd) + Click
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          this.openSelectedShortcuts('new-tab');
          return false;
        }

        // Shift + Click alone (without Ctrl/Alt): toggles selection (unselects this card)
        if (e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          this.toggleShortcutSelection(shortcut.id, card);
          return false;
        }

        // Plain Click (not in Edit Mode): Open all selected in new tabs!
        if (!isEditMode) {
          e.preventDefault();
          e.stopPropagation();
          this.openSelectedShortcuts('new-tab');
          return false;
        }
      }

      if (this.isMultiSelectMode) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleShortcutSelection(shortcut.id, card);
        return false;
      }

      if (isEditMode) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          if (typeof DragEngine === 'undefined' || DragEngine.justSelectedId !== shortcut.id) {
            this.toggleShortcutSelection(shortcut.id, card);
          }
        } else {
          this.selectSingleForInspection(shortcut, card);
        }
        return false;
      }

      const targetUrl = FaviconResolver.normalizeUrl(shortcut.url);

      // 1. Incognito Mode: Alt + Click OR Ctrl + Alt + Click
      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        this.openInIncognito(targetUrl);
        return false;
      }

      // 2. New Window: (Ctrl or Cmd) + Shift + Click
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        this.openInNewWindow(targetUrl);
        return false;
      }

      // 3. New Tab: (Ctrl or Cmd) + Click
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        this.openInNewTab(targetUrl);
        return false;
      }

      // 4. Default Left-Click: Navigates in current tab (native href)
    });

    // Middle click (auxclick) support: button 1 is scroll wheel click
    card.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        const isEditMode = document.body.classList.contains('edit-mode-active');
        if (isEditMode) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        e.stopPropagation();

        if (this.selectedShortcutIds.has(shortcut.id) && this.selectedShortcutIds.size > 1) {
          if (e.altKey) {
            this.openSelectedShortcuts('incognito');
          } else if (e.shiftKey) {
            this.openSelectedShortcuts('new-window');
          } else {
            this.openSelectedShortcuts('new-tab');
          }
          return;
        }

        const targetUrl = FaviconResolver.normalizeUrl(shortcut.url);
        if (e.altKey) {
          this.openInIncognito(targetUrl);
        } else if (e.shiftKey) {
          this.openInNewWindow(targetUrl);
        } else {
          this.openInNewTab(targetUrl);
        }
      }
    });

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'shortcut-icon-wrapper';

    const faviconUrl = FaviconResolver.getFaviconUrl(shortcut.url);
    const img = document.createElement('img');
    img.className = 'shortcut-icon-img';
    img.src = faviconUrl;
    img.alt = shortcut.name;
    img.setAttribute('draggable', 'false');

    img.onerror = () => {
      img.remove();
      const letterAvatar = FaviconResolver.createLetterAvatar(shortcut.name, shortcut.url);
      iconWrapper.appendChild(letterAvatar);
    };

    iconWrapper.appendChild(img);

    const title = document.createElement('div');
    title.className = 'shortcut-title';
    title.textContent = shortcut.name;
    title.title = shortcut.name;

    card.title = `${shortcut.name} (${shortcut.url})\n• Click: Open\n• Ctrl+Click: Open in new tab\n• Ctrl+Shift+Click: Open in new window\n• Alt+Click: Open in incognito window`;

    const menuBtn = document.createElement('button');
    menuBtn.className = 'shortcut-menu-btn';
    menuBtn.title = 'Shortcut options & actions';
    menuBtn.type = 'button';
    menuBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="5" r="2"></circle>
        <circle cx="12" cy="12" r="2"></circle>
        <circle cx="12" cy="19" r="2"></circle>
      </svg>
    `;

    menuBtn.addEventListener('click', (e) => {
      if (this.isMultiSelectMode) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleShortcutSelection(shortcut.id, card);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.showTileMenu(shortcut, card, menuBtn);
    });

    card.appendChild(iconWrapper);
    card.appendChild(title);
    card.appendChild(menuBtn);

    return card;
  },


};
