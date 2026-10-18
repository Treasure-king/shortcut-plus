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
  activeTileAnchor: null,

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

    // A fixed-position menu would drift away from its tile; close it instead
    const closeOnViewportChange = (e) => {
      if (!this.activeTileDropdown) return;
      if (e && e.target && e.target.nodeType === 1 && this.activeTileDropdown.contains(e.target)) return;
      this.closeTileMenu();
    };
    window.addEventListener('scroll', closeOnViewportChange, true);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('blur', closeOnViewportChange);
  },

  // Pages can't navigate to chrome://, file://, about: etc. directly; route those through chrome.tabs
  _canUseTabsApi() {
    return typeof chrome !== 'undefined' && !!chrome.tabs;
  },

  _invalidUrlToast() {
    window.showToast?.('This shortcut has an invalid or unsupported URL. Edit it to fix.');
  },

  openInCurrentTab(url) {
    const targetUrl = FaviconResolver.normalizeUrl(url);
    if (!targetUrl) { this._invalidUrlToast(); return; }
    if (FaviconResolver.isSpecialUrl(targetUrl) && this._canUseTabsApi() && chrome.tabs.update) {
      chrome.tabs.update({ url: targetUrl }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          window.showToast?.('Could not open: ' + chrome.runtime.lastError.message);
        }
      });
      return;
    }
    window.location.href = targetUrl;
  },

  openInNewTab(url) {
    const targetUrl = FaviconResolver.normalizeUrl(url);
    if (!targetUrl) { this._invalidUrlToast(); return; }
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: targetUrl, active: true });
    } else {
      window.open(targetUrl, '_blank');
    }
  },

  openInNewWindow(url) {
    const targetUrl = FaviconResolver.normalizeUrl(url);
    if (!targetUrl) { this._invalidUrlToast(); return; }
    if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.create) {
      chrome.windows.create({ url: targetUrl, incognito: false });
    } else {
      window.open(targetUrl, '_blank', 'popup=no');
    }
  },

  openInIncognito(url) {
    const targetUrl = FaviconResolver.normalizeUrl(url);
    if (!targetUrl) { this._invalidUrlToast(); return; }
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
    if (this.activeTileAnchor) {
      this.activeTileAnchor.setAttribute('aria-expanded', 'false');
      this.activeTileAnchor = null;
    }
  },

  showTileMenu(shortcut, card, anchorEl) {
    // Clicking the same "⋮" button again toggles the menu closed
    if (this.activeTileDropdown && this.activeTileAnchor === anchorEl) {
      this.closeTileMenu();
      return;
    }
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
        <span>Edit &amp; Customize…</span>
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
        // Re-read so the dialog never edits a stale copy captured when the tile was rendered
        const fresh = (await ShortcutStorage.getShortcuts()).find(s => s.id === shortcut.id) || shortcut;
        ShortcutModal.openEdit(fresh);
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
          this.selectedShortcutIds.delete(shortcut.id);
          await this.render();
          window.showToast?.('Shortcut deleted');
        }
      }
    });

    dropdown.querySelectorAll('.dropdown-item').forEach(item => item.setAttribute('role', 'menuitem'));

    // Keyboard navigation inside the menu
    dropdown.addEventListener('keydown', (e) => {
      const items = Array.from(dropdown.querySelectorAll('.dropdown-item'));
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        items[next]?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeTileMenu();
        anchorEl.focus?.();
      } else if (e.key === 'Tab') {
        this.closeTileMenu();
      }
    });

    document.body.appendChild(dropdown);
    this.activeTileDropdown = dropdown;
    this.activeTileAnchor = anchorEl;
    anchorEl.setAttribute('aria-expanded', 'true');

    const rect = anchorEl.getBoundingClientRect();
    const dropdownW = dropdown.offsetWidth || 220;
    const dropdownH = dropdown.offsetHeight || 260;
    let left = rect.right - dropdownW;
    if (left < 10) left = rect.left;
    if (left + dropdownW > window.innerWidth - 10) left = window.innerWidth - dropdownW - 10;
    left = Math.max(10, left);

    let top = rect.bottom + 6;
    if (top + dropdownH > window.innerHeight - 10) {
      top = Math.max(10, rect.top - dropdownH - 6);
    }

    dropdown.style.left = `${left}px`;
    dropdown.style.top = `${top}px`;

    // Opened from the keyboard: move focus into the menu
    try {
      if (anchorEl.matches(':focus-visible')) dropdown.querySelector('.dropdown-item')?.focus();
    } catch (e) { /* :focus-visible unsupported */ }
  },

  // ---- Per-tile appearance helpers (also used by the Add/Edit dialog preview) ----

  /** Pick readable text color (#1f1f1f or #ffffff) for a "#rrggbb" background using WCAG contrast. */
  getReadableTextColor(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return null;
    const lin = (v) => {
      const c = parseInt(v, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const L = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
    const contrastWhite = 1.05 / (L + 0.05);
    const contrastDark = (L + 0.05) / (0.0137 + 0.05); // #1f1f1f luminance ≈ 0.0137
    return contrastDark >= contrastWhite ? '#1f1f1f' : '#ffffff';
  },

  /** Apply (or clear) a per-tile background color; inline !important beats theme/wallpaper overrides. */
  applyTileColor(el, color) {
    const safe = ShortcutStorage.sanitizeColor(color);
    if (!safe) {
      el.classList.remove('has-tile-color');
      el.style.removeProperty('background-color');
      el.style.removeProperty('--shortcut-title-color');
      el.style.removeProperty('--shortcut-title-shadow');
      el.style.removeProperty('--tile-color');
      return;
    }
    const fg = this.getReadableTextColor(safe);
    el.classList.add('has-tile-color');
    el.classList.toggle('tile-color-light', fg === '#1f1f1f');
    el.style.setProperty('--tile-color', safe);
    el.style.setProperty('background-color', safe, 'important');
    el.style.setProperty('--shortcut-title-color', fg);
    el.style.setProperty('--shortcut-title-shadow', 'none');
  },

  /**
   * Build the icon content for a tile (appended into an icon wrapper). Never uses innerHTML with user data.
   */
  fillIconWrapper(wrapper, shortcut) {
    wrapper.textContent = '';
    const name = shortcut.name || '';
    const icon = ShortcutStorage.sanitizeIcon(shortcut.icon);
    const appendLetter = () => {
      wrapper.querySelectorAll('img').forEach(i => i.remove());
      wrapper.appendChild(FaviconResolver.createLetterAvatar(name, FaviconResolver.getHostname(shortcut.url)));
    };
    const appendFavicon = () => {
      const faviconUrl = FaviconResolver.getFaviconUrl(shortcut.url);
      if (!faviconUrl) { appendLetter(); return; }
      const img = document.createElement('img');
      img.className = 'shortcut-icon-img';
      img.alt = '';
      img.setAttribute('draggable', 'false');
      img.onerror = () => { img.onerror = null; appendLetter(); };
      img.src = faviconUrl;
      wrapper.appendChild(img);
    };

    wrapper.classList.remove('has-custom-icon', 'has-emoji-icon');
    if (icon && icon.type === 'emoji') {
      const span = document.createElement('span');
      span.className = 'shortcut-icon-emoji';
      span.textContent = icon.value;
      wrapper.classList.add('has-emoji-icon');
      wrapper.appendChild(span);
    } else if (icon && (icon.type === 'upload' || icon.type === 'url')) {
      const img = document.createElement('img');
      img.className = 'shortcut-icon-img is-custom-img';
      img.alt = '';
      img.setAttribute('draggable', 'false');
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => {
        img.onerror = null;
        img.remove();
        wrapper.classList.remove('has-custom-icon');
        appendFavicon();
      };
      img.src = icon.value;
      wrapper.classList.add('has-custom-icon');
      wrapper.appendChild(img);
    } else {
      appendFavicon();
    }
  },

  /** Open a shortcut with a normal (unmodified) click: honours the per-tile "open in new tab" setting. */
  openShortcutDefault(shortcut) {
    if (shortcut && shortcut.openInNewTab === true) {
      this.openInNewTab(shortcut.url);
    } else {
      this.openInCurrentTab(shortcut.url);
    }
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

    if (typeof AlignEngine !== 'undefined') AlignEngine.refreshToolbar();

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
    // A tile menu left open would keep acting on a tile that no longer exists
    this.closeTileMenu();
    this.container.innerHTML = '';

    if (this.layoutMode === 'grid') {
      await this.renderGroupedGrid();
    } else {
      await this.renderFreePlacement();
    }

    // Drop ids of shortcuts that no longer exist so counts and batch actions stay accurate
    const existingIds = new Set(this.shortcuts.map(s => s.id));
    this.selectedShortcutIds.forEach(id => {
      if (!existingIds.has(id)) this.selectedShortcutIds.delete(id);
    });

    this.updateMultiselectUI();

    // Re-apply an active search filter to the freshly rendered tiles
    if (typeof SearchEngine !== 'undefined' && document.body.classList.contains('search-filtering-active')) {
      SearchEngine.handleFilter();
    }
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
          const pixelX = Math.min(window.innerWidth - 380, 88 + (info.order || 0) * 360);
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
        handle.title = 'Drag to resize group';
        section.appendChild(handle);
      }

      const header = document.createElement('div');
      header.className = 'group-header';
      header.innerHTML = `
        <div class="group-drag-handle" title="Drag to reorder group">
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
        <span class="group-title" title="Double-click to rename group"></span>
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
        const newName = prompt(`Rename group "${info.name}":`, info.name);
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
        titleEl.title = `Double-click to rename group: ${info.name}`;
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
          if (confirm(`Delete group "${info.name}"? Its shortcuts are kept and moved out of the group.`)) {
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
    const normalizedHref = FaviconResolver.normalizeUrl(shortcut.url);
    // Never put a rejected scheme (javascript:, data:, ...) into href
    card.href = normalizedHref || '#';
    card.target = '_self';
    card.dataset.id = shortcut.id;
    if (shortcut.openInNewTab === true) card.dataset.openInNewTab = 'true';
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
        // Leave room for the docked widget column on the right, when it's showing
        const widgetColumn = document.querySelector('.spw-root:not(.spw-shelf) .spw-column:not(:empty)');
        const reservedRight = widgetColumn ? widgetColumn.getBoundingClientRect().width + 32 : 0;
        const cols = Math.max(2, Math.floor((window.innerWidth - 120 - reservedRight) / 140));
        const col = index % cols;
        const row = Math.floor(index / cols);
        // Start right of the edit-mode align palette (left edge, ~64px wide)
        const pixelX = 88 + col * 140;
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

      // Batch open if card is one of multiple selected shortcuts (in Edit Mode clicks only manage the selection)
      if (isMultiSelected && !isEditMode && !this.isMultiSelectMode) {
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

      // Shift + Click (no Ctrl): browsers open a new window natively; keep that native behavior,
      // except for chrome:// / file:// etc. which pages can't open via plain links
      if (e.shiftKey) {
        if (!targetUrl || FaviconResolver.isSpecialUrl(targetUrl)) {
          e.preventDefault();
          e.stopPropagation();
          this.openInNewWindow(targetUrl);
          return false;
        }
        return;
      }

      // 4. Default Left-Click: per-tile "Open in" setting (same tab by default).
      // Special schemes (chrome://, file://, about:) and new-tab tiles must go through chrome.tabs.
      if (!targetUrl || shortcut.openInNewTab === true || FaviconResolver.isSpecialUrl(targetUrl)) {
        e.preventDefault();
        e.stopPropagation();
        this.openShortcutDefault(shortcut);
        return false;
      }
      // Otherwise: native href navigation in the current tab
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

    this.fillIconWrapper(iconWrapper, shortcut);
    this.applyTileColor(card, shortcut.color);

    const title = document.createElement('div');
    title.className = 'shortcut-title';
    title.textContent = shortcut.name;
    title.title = shortcut.name;

    const clickHint = shortcut.openInNewTab === true ? 'Click: Open in new tab' : 'Click: Open';
    card.title = `${shortcut.name} (${shortcut.url})\n• ${clickHint}\n• Ctrl+Click: Open in new tab\n• Ctrl+Shift+Click: Open in new window\n• Alt+Click: Open in incognito window`;

    const menuBtn = document.createElement('button');
    menuBtn.className = 'shortcut-menu-btn';
    menuBtn.title = 'Shortcut options & actions';
    menuBtn.type = 'button';
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', `Options for ${shortcut.name || 'shortcut'}`);
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
