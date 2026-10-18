/* modal.js - Modern Right-Side Slide Panel Controller & Form Handlers */

const ShortcutModal = {
  // Drawer & Overlay Elements
  drawer: null,
  overlay: null,
  titleEl: null,
  closeBtn: null,
  activeViewEl: null,

  // Views
  viewSettings: null,
  viewShortcut: null,
  viewCreateGroup: null,
  viewImportProfile: null,
  viewInspector: null,

  // Shortcut Form
  form: null,
  idInput: null,
  nameInput: null,
  urlInput: null,
  groupSelect: null,
  cancelBtn: null,
  deleteBtn: null,
  saveBtn: null,

  // Create Group Form
  createGroupForm: null,
  newGroupNameInput: null,
  multiselectSearch: null,
  multiselectList: null,
  selectAllBtn: null,
  clearAllBtn: null,
  createGroupCancelBtn: null,

  // Import Profile Form
  importProfileForm: null,
  importSourceSelect: null,
  importMultiselectSearch: null,
  importMultiselectList: null,
  importSelectAllBtn: null,
  importClearAllBtn: null,
  importCancelBtn: null,

  // Shortcut form state preserved while "+ Create New Category..." is in progress
  pendingShortcutForm: null,
  lastGroupValue: 'none',

  // Add/Edit dialog: appearance state + save guard
  isSaving: false,
  appearance: null,
  _previewTimer: null,
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  ICON_SIZE: 128,

  init() {
    this.drawer = document.getElementById('side-panel-drawer');
    this.overlay = document.getElementById('side-panel-overlay');
    this.titleEl = document.getElementById('side-panel-title');
    this.closeBtn = document.getElementById('side-panel-close-btn');

    this.viewSettings = document.getElementById('view-settings');
    this.viewShortcut = document.getElementById('view-shortcut-form');
    this.viewCreateGroup = document.getElementById('view-create-group');
    this.viewImportProfile = document.getElementById('view-import-profile');
    this.viewInspector = document.getElementById('view-edit-inspector');
    this.viewDocs = document.getElementById('view-docs');

    // Shortcut Form elements
    this.form = document.getElementById('shortcut-form');
    this.idInput = document.getElementById('shortcut-id');
    this.nameInput = document.getElementById('shortcut-name-input');
    this.urlInput = document.getElementById('shortcut-url-input');
    this.groupSelect = document.getElementById('shortcut-group-select');
    this.cancelBtn = document.getElementById('modal-cancel-btn');
    this.deleteBtn = document.getElementById('modal-delete-btn');
    this.saveBtn = document.getElementById('modal-save-btn');
    this.nameError = document.getElementById('shortcut-name-error');
    this.urlError = document.getElementById('shortcut-url-error');

    // Appearance section elements
    this.previewTile = document.getElementById('shortcut-tile-preview');
    this.previewIcon = document.getElementById('shortcut-preview-icon');
    this.previewTitle = document.getElementById('shortcut-preview-title');
    this.iconTypeGroup = document.getElementById('shortcut-icon-type');
    this.emojiInput = document.getElementById('shortcut-emoji-input');
    this.emojiQuickRow = document.getElementById('shortcut-emoji-quick');
    this.iconFileInput = document.getElementById('shortcut-icon-file-input');
    this.uploadHint = document.getElementById('shortcut-upload-hint');
    this.iconUrlInput = document.getElementById('shortcut-icon-url-input');
    this.iconError = document.getElementById('shortcut-icon-error');
    this.colorSwatches = document.getElementById('shortcut-color-swatches');
    this.colorInput = document.getElementById('shortcut-color-input');
    this.colorCustomSwatch = document.getElementById('shortcut-color-custom');
    this.openModeGroup = document.getElementById('shortcut-open-mode');
    this.appearance = this.defaultAppearance();

    // Create Group elements
    this.createGroupForm = document.getElementById('create-group-form');
    this.newGroupNameInput = document.getElementById('new-group-name-input');
    this.multiselectSearch = document.getElementById('multiselect-search-input');
    this.multiselectList = document.getElementById('multiselect-list');
    this.selectAllBtn = document.getElementById('multiselect-select-all');
    this.clearAllBtn = document.getElementById('multiselect-clear-all');
    this.createGroupCancelBtn = document.getElementById('create-group-cancel-btn');

    // Import Profile elements
    this.importProfileForm = document.getElementById('import-profile-form');
    this.importSourceSelect = document.getElementById('import-source-profile-select');
    this.importMultiselectSearch = document.getElementById('import-multiselect-search-input');
    this.importMultiselectList = document.getElementById('import-multiselect-list');
    this.importSelectAllBtn = document.getElementById('import-multiselect-select-all');
    this.importClearAllBtn = document.getElementById('import-multiselect-clear-all');
    this.importCancelBtn = document.getElementById('import-profile-cancel-btn');

    this.bindEvents();
  },

  showView(viewEl, title) {
    [this.viewSettings, this.viewShortcut, this.viewCreateGroup, this.viewImportProfile, this.viewInspector, this.viewDocs].forEach(v => {
      if (v) v.classList.add('hidden');
    });

    const isInspector = (viewEl === this.viewInspector);

    // Navigating anywhere other than the create-category view abandons the pending form return
    if (viewEl !== this.viewCreateGroup) {
      this.pendingShortcutForm = null;
    }

    if (viewEl) {
      viewEl.classList.remove('hidden');
      this.activeViewEl = viewEl;
    }
    if (this.titleEl && title) {
      this.titleEl.textContent = title;
    }
    if (this.drawer) {
      this.drawer.classList.add('active');
      this.drawer.setAttribute('aria-hidden', 'false');
    }

    if (isInspector) {
      document.body.classList.add('has-inspector-open');
      if (this.overlay) {
        this.overlay.classList.remove('active');
      }
    } else {
      document.body.classList.remove('has-inspector-open');
      if (this.overlay) {
        this.overlay.classList.add('active');
      }
    }
  },

  async populateGroups(selectedGroupId) {
    if (!this.groupSelect) return;
    const groups = await ShortcutStorage.getGroups();
    this.groupSelect.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = 'none';
    defaultOpt.textContent = 'None (Ungrouped)';
    if (!selectedGroupId || selectedGroupId === 'none') defaultOpt.selected = true;
    this.groupSelect.appendChild(defaultOpt);

    groups.forEach(group => {
      const opt = document.createElement('option');
      opt.value = group.id;
      opt.textContent = group.name;
      if (group.id === selectedGroupId) opt.selected = true;
      this.groupSelect.appendChild(opt);
    });

    const newGroupOpt = document.createElement('option');
    newGroupOpt.value = '__create_new__';
    newGroupOpt.textContent = '+ Create New Group...';
    this.groupSelect.appendChild(newGroupOpt);

    this.lastGroupValue = this.groupSelect.value;
  },

  // Re-show the shortcut form (inputs keep their values while hidden) with the given category selected
  async returnToShortcutForm(groupId) {
    const pending = this.pendingShortcutForm;
    this.pendingShortcutForm = null;
    await this.populateGroups(groupId || 'none');
    this.showView(this.viewShortcut, (pending && pending.title) || 'Add shortcut');
    setTimeout(() => this.nameInput?.focus(), 60);
  },

  bindEvents() {
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }

    if (this.overlay) {
      this.overlay.addEventListener('click', () => this.close());
    }

    if (this.cancelBtn) {
      this.cancelBtn.addEventListener('click', () => this.close());
    }

    if (this.drawer) {
      this.drawer.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;

      if (e.key === 'Escape') {
        this.close();
      } else if (e.key === 'Tab' && this.drawer && this.activeViewEl !== this.viewInspector) {
        // Inspector is a non-modal side panel: don't trap focus inside it
        const focusable = Array.from(this.drawer.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'))
          .filter(el => el.offsetParent !== null);
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    });

    if (this.groupSelect) {
      this.groupSelect.addEventListener('change', async (e) => {
        if (e.target.value === '__create_new__') {
          // Remember the half-filled shortcut form so we can return to it
          this.pendingShortcutForm = {
            title: this.titleEl ? this.titleEl.textContent : '',
            previousGroupId: this.lastGroupValue || 'none'
          };
          await this.openCreateGroup();
        } else {
          this.lastGroupValue = e.target.value;
        }
      });
    }

    if (this.form) {
      this.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSave();
      });
    }

    this.bindShortcutFormEvents();

    if (this.deleteBtn) {
      this.deleteBtn.addEventListener('click', async () => {
        await this.handleDelete();
      });
    }

    // Create Group Handlers
    if (this.createGroupCancelBtn) {
      this.createGroupCancelBtn.addEventListener('click', async () => {
        if (this.pendingShortcutForm) {
          await this.returnToShortcutForm(this.pendingShortcutForm.previousGroupId);
        } else {
          this.close();
        }
      });
    }

    if (this.multiselectSearch) {
      this.multiselectSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
        }
        e.stopPropagation();
      });

      this.multiselectSearch.addEventListener('input', () => {
        this.filterMultiselect(this.multiselectSearch, this.multiselectList);
      });
    }

    if (this.newGroupNameInput) {
      this.newGroupNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleCreateGroupSubmit();
        }
        e.stopPropagation();
      });
    }

    if (this.selectAllBtn) {
      this.selectAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.setAllCheckboxes(this.multiselectList, true);
      });
    }

    if (this.clearAllBtn) {
      this.clearAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.setAllCheckboxes(this.multiselectList, false);
      });
    }

    if (this.createGroupForm) {
      this.createGroupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleCreateGroupSubmit();
      });
    }

    // Import Profile Handlers
    if (this.importCancelBtn) {
      this.importCancelBtn.addEventListener('click', () => this.close());
    }

    if (this.importSourceSelect) {
      this.importSourceSelect.addEventListener('change', async (e) => {
        await this.populateImportShortcuts(e.target.value);
      });
    }

    if (this.importMultiselectSearch) {
      this.importMultiselectSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
        }
        e.stopPropagation();
      });

      this.importMultiselectSearch.addEventListener('input', () => {
        this.filterMultiselect(this.importMultiselectSearch, this.importMultiselectList);
      });
    }

    if (this.importSelectAllBtn) {
      this.importSelectAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.setAllCheckboxes(this.importMultiselectList, true);
      });
    }

    if (this.importClearAllBtn) {
      this.importClearAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.setAllCheckboxes(this.importMultiselectList, false);
      });
    }

    if (this.importProfileForm) {
      this.importProfileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleImportProfileSubmit();
      });
    }

    const openDocsBtn = document.getElementById('open-docs-btn');
    if (openDocsBtn) {
      openDocsBtn.addEventListener('click', () => this.openDocs());
    }

    const docsBackSettingsBtn = document.getElementById('docs-back-settings-btn');
    if (docsBackSettingsBtn) {
      docsBackSettingsBtn.addEventListener('click', () => this.openSettings());
    }

    const docsDoneBtn = document.getElementById('docs-done-btn');
    if (docsDoneBtn) {
      docsDoneBtn.addEventListener('click', () => this.close());
    }

    const openExtSettingsBtn = document.getElementById('open-ext-settings-btn');
    if (openExtSettingsBtn) {
      openExtSettingsBtn.addEventListener('click', () => {
        try {
          if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create && chrome.runtime && chrome.runtime.id) {
            chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
          } else if (typeof window !== 'undefined' && window.showToast) {
            window.showToast('Open chrome://extensions in a new tab to manage extension settings.');
          }
        } catch (e) {
          if (typeof window !== 'undefined' && window.showToast) {
            window.showToast('Open chrome://extensions in a new tab to manage extension settings.');
          }
        }
      });
    }

    const refreshIncognitoBtn = document.getElementById('refresh-incognito-status-btn');
    if (refreshIncognitoBtn) {
      refreshIncognitoBtn.addEventListener('click', () => {
        this.checkIncognitoPermission();
        window.showToast?.('Incognito status updated');
      });
    }
  },

  isOpen() {
    return this.drawer && this.drawer.classList.contains('active');
  },

  // True for dialogs that should swallow page hotkeys; the edit-mode Inspector is a non-blocking side panel
  isBlockingModalOpen() {
    return this.isOpen() && this.activeViewEl !== this.viewInspector;
  },

  openInspector() {
    this.showView(this.viewInspector, 'Edit Layout & Inspector');
  },

  openSettings() {
    this.showView(this.viewSettings, 'Settings & Customization');
    this.checkIncognitoPermission();
  },

  openDocs() {
    this.showView(this.viewDocs, 'Help & Shortcuts Guide');
    this.checkIncognitoPermission();
  },

  checkIncognitoPermission() {
    const badges = [
      document.getElementById('incognito-status-badge'),
      document.getElementById('settings-incognito-badge')
    ];
    const note = document.getElementById('incognito-status-note');

    if (typeof chrome !== 'undefined' && chrome.extension && typeof chrome.extension.isAllowedIncognitoAccess === 'function') {
      chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
        badges.forEach(b => {
          if (!b) return;
          if (isAllowed) {
            b.className = 'doc-badge incognito-badge-active';
            b.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Allowed`;
          } else {
            b.className = 'doc-badge incognito-badge-disabled';
            b.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> Permission Needed`;
          }
        });

        if (note) {
          if (isAllowed) {
            note.innerHTML = `<span style="color: #0f9d58; font-weight: 500;">✓ Incognito access is enabled!</span> You can launch any shortcut in Incognito mode using <strong>Alt + Click</strong>.`;
          } else {
            note.innerHTML = `To open shortcuts in Incognito windows via <strong>Alt + Click</strong>, Chrome requires toggling <strong>"Allow in Incognito"</strong> ON in extension details.`;
          }
        }
      });
    } else {
      badges.forEach(b => {
        if (b) {
          b.className = 'doc-badge incognito-badge-active';
          b.textContent = 'Active';
        }
      });
    }
  },

  async openAdd() {
    this.idInput.value = '';
    this.nameInput.value = '';
    this.urlInput.value = '';
    this.resetShortcutFormState();
    this.loadAppearance(null);
    await this.populateGroups('none');
    if (this.deleteBtn) this.deleteBtn.style.display = 'none';
    this.showView(this.viewShortcut, 'Add shortcut');
    setTimeout(() => this.nameInput?.focus(), 60);
  },

  async openEdit(shortcut) {
    this.idInput.value = shortcut.id;
    this.nameInput.value = shortcut.name || '';
    this.urlInput.value = shortcut.url || '';
    this.resetShortcutFormState();
    this.loadAppearance(shortcut);
    await this.populateGroups(shortcut.groupId || 'none');
    if (this.deleteBtn) this.deleteBtn.style.display = 'inline-flex';
    this.showView(this.viewShortcut, 'Edit shortcut');
    setTimeout(() => {
      if (!this.nameInput) return;
      this.nameInput.focus();
      this.nameInput.select();
    }, 60);
  },

  // ---------------------------------------------------------------------------
  // Add/Edit shortcut dialog: validation, name auto-fill, appearance section
  // ---------------------------------------------------------------------------

  defaultAppearance() {
    return { iconType: 'auto', emoji: '', uploadData: '', iconUrl: '', color: null, openInNewTab: false };
  },

  resetShortcutFormState() {
    this.setSaving(false);
    this.setFieldError(this.nameError, this.nameInput, '');
    this.setFieldError(this.urlError, this.urlInput, '');
    this.setFieldError(this.iconError, null, '');
    this.updateNamePlaceholder();
  },

  setSaving(saving) {
    this.isSaving = !!saving;
    if (this.saveBtn) {
      this.saveBtn.disabled = this.isSaving;
      this.saveBtn.textContent = this.isSaving ? 'Saving…' : 'Done';
    }
    if (this.form) this.form.setAttribute('aria-busy', this.isSaving ? 'true' : 'false');
  },

  setFieldError(errorEl, inputEl, message) {
    if (errorEl) {
      errorEl.textContent = message || '';
      errorEl.hidden = !message;
    }
    if (inputEl) {
      inputEl.classList.toggle('has-error', !!message);
      if (message) inputEl.setAttribute('aria-invalid', 'true');
      else inputEl.removeAttribute('aria-invalid');
    }
  },

  updateNamePlaceholder() {
    if (!this.nameInput) return;
    const suggestion = FaviconResolver.suggestName(this.urlInput ? this.urlInput.value : '');
    this.nameInput.placeholder = suggestion ? `${suggestion} (from URL)` : 'e.g. GitHub';
  },

  loadAppearance(shortcut) {
    const a = this.defaultAppearance();
    if (shortcut) {
      const icon = ShortcutStorage.sanitizeIcon(shortcut.icon);
      if (icon) {
        a.iconType = icon.type;
        if (icon.type === 'emoji') a.emoji = icon.value;
        if (icon.type === 'upload') a.uploadData = icon.value;
        if (icon.type === 'url') a.iconUrl = icon.value;
      }
      a.color = ShortcutStorage.sanitizeColor(shortcut.color);
      a.openInNewTab = shortcut.openInNewTab === true;
    }
    this.appearance = a;

    if (this.emojiInput) this.emojiInput.value = a.emoji;
    if (this.iconUrlInput) this.iconUrlInput.value = a.iconUrl;
    if (this.uploadHint) {
      this.uploadHint.textContent = a.uploadData ? 'Current image kept · choose another to replace' : 'PNG, JPG, WebP or GIF · max 5 MB';
    }
    if (this.colorInput && a.color) this.colorInput.value = a.color;

    this.setIconType(a.iconType, false);
    this.selectColor(a.color, false);
    this.setOpenMode(a.openInNewTab);
    this.updatePreview();
  },

  // Generic radio-group behavior for segmented controls and swatch rows (click + arrow keys)
  bindRadioGroup(groupEl, onSelect) {
    if (!groupEl) return;
    groupEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[role="radio"]');
      if (!btn || !groupEl.contains(btn) || btn.tagName === 'LABEL') return;
      onSelect(btn, false);
    });
    groupEl.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const radios = Array.from(groupEl.querySelectorAll('button[role="radio"]'));
      const idx = radios.indexOf(document.activeElement);
      if (idx === -1) return;
      e.preventDefault();
      const dir = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1;
      const next = radios[(idx + dir + radios.length) % radios.length];
      next.focus();
      onSelect(next, true);
    });
  },

  markRadio(groupEl, activeBtn) {
    if (!groupEl) return;
    groupEl.querySelectorAll('[role="radio"]').forEach(btn => {
      const on = btn === activeBtn;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  },

  setIconType(type, focusField = true) {
    const valid = ['auto', 'emoji', 'upload', 'url'];
    if (!valid.includes(type)) type = 'auto';
    this.appearance.iconType = type;
    if (this.iconTypeGroup) {
      this.markRadio(this.iconTypeGroup, this.iconTypeGroup.querySelector(`[data-icon-type="${type}"]`));
    }
    if (this.form) {
      this.form.querySelectorAll('.icon-type-panel').forEach(p => {
        p.hidden = p.dataset.iconPanel !== type;
      });
    }
    this.setFieldError(this.iconError, null, '');
    this.setFieldError(null, this.emojiInput, '');
    this.setFieldError(null, this.iconUrlInput, '');
    if (focusField) {
      if (type === 'emoji') this.emojiInput?.focus();
      else if (type === 'url') this.iconUrlInput?.focus();
      else if (type === 'upload' && !this.appearance.uploadData) this.iconFileInput?.click();
    }
    this.updatePreview();
  },

  selectColor(color, fromCustom = false) {
    const safe = ShortcutStorage.sanitizeColor(color);
    this.appearance.color = safe;
    if (!this.colorSwatches) return;
    let active = null;
    if (!safe) {
      active = this.colorSwatches.querySelector('.swatch-default');
    } else if (!fromCustom) {
      active = Array.from(this.colorSwatches.querySelectorAll('button[data-color]'))
        .find(b => (b.dataset.color || '').toLowerCase() === safe) || null;
    }
    const isCustom = !!safe && !active;
    this.markRadio(this.colorSwatches, active);
    if (this.colorCustomSwatch) {
      this.colorCustomSwatch.classList.toggle('is-active', isCustom);
      this.colorCustomSwatch.style.backgroundColor = isCustom ? safe : '';
    }
    this.updatePreview();
  },

  setOpenMode(newTab) {
    this.appearance.openInNewTab = !!newTab;
    if (this.openModeGroup) {
      this.markRadio(this.openModeGroup, this.openModeGroup.querySelector(`[data-open-mode="${newTab ? 'new' : 'same'}"]`));
    }
  },

  /** The icon object that would be saved for the current dialog state (null = auto). */
  currentIcon() {
    const a = this.appearance;
    if (a.iconType === 'emoji') return { type: 'emoji', value: (this.emojiInput ? this.emojiInput.value : a.emoji).trim() };
    if (a.iconType === 'upload') return a.uploadData ? { type: 'upload', value: a.uploadData } : null;
    if (a.iconType === 'url') return { type: 'url', value: (this.iconUrlInput ? this.iconUrlInput.value : a.iconUrl).trim() };
    return null;
  },

  schedulePreview(delay = 250) {
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this.updatePreview(), delay);
  },

  updatePreview() {
    if (!this.previewTile || !this.previewIcon || typeof ShortcutGrid === 'undefined') return;
    const url = this.urlInput ? this.urlInput.value.trim() : '';
    const typedName = this.nameInput ? this.nameInput.value.trim() : '';
    const name = typedName || FaviconResolver.suggestName(url) || 'Shortcut';
    // sanitizeIcon drops invalid values, so the preview falls back to the favicon like the real tile would
    ShortcutGrid.fillIconWrapper(this.previewIcon, { name, url, icon: this.currentIcon() });
    ShortcutGrid.applyTileColor(this.previewTile, this.appearance.color);
    if (this.previewTitle) this.previewTitle.textContent = name;
  },

  bindShortcutFormEvents() {
    if (this.nameInput) {
      this.nameInput.addEventListener('input', () => {
        this.setFieldError(this.nameError, this.nameInput, '');
        this.schedulePreview(80);
      });
    }

    if (this.urlInput) {
      this.urlInput.addEventListener('input', () => {
        this.setFieldError(this.urlError, this.urlInput, '');
        this.updateNamePlaceholder();
        this.schedulePreview(350);
      });
      this.urlInput.addEventListener('blur', () => {
        const raw = this.urlInput.value.trim();
        if (!raw || !this.isOpen()) return;
        const result = FaviconResolver.validateUrl(raw);
        this.setFieldError(this.urlError, this.urlInput, result.ok ? '' : result.error);
      });
    }

    this.bindRadioGroup(this.iconTypeGroup, (btn, viaKeyboard) => this.setIconType(btn.dataset.iconType, !viaKeyboard));
    this.bindRadioGroup(this.colorSwatches, (btn) => this.selectColor(btn.dataset.color || null));
    this.bindRadioGroup(this.openModeGroup, (btn) => this.setOpenMode(btn.dataset.openMode === 'new'));

    if (this.emojiInput) {
      this.emojiInput.addEventListener('input', () => {
        this.appearance.emoji = this.emojiInput.value;
        this.setFieldError(this.iconError, this.emojiInput, '');
        this.schedulePreview(60);
      });
    }

    if (this.emojiQuickRow) {
      this.emojiQuickRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.emoji-quick-btn');
        if (!btn || !this.emojiInput) return;
        this.emojiInput.value = btn.dataset.emoji || '';
        this.appearance.emoji = this.emojiInput.value;
        this.setFieldError(this.iconError, this.emojiInput, '');
        this.updatePreview();
      });
    }

    if (this.iconUrlInput) {
      this.iconUrlInput.addEventListener('input', () => {
        this.appearance.iconUrl = this.iconUrlInput.value;
        this.setFieldError(this.iconError, this.iconUrlInput, '');
        this.schedulePreview(400);
      });
    }

    if (this.iconFileInput) {
      this.iconFileInput.addEventListener('change', async () => {
        const file = this.iconFileInput.files && this.iconFileInput.files[0];
        await this.processIconFile(file);
        this.iconFileInput.value = '';
      });
    }

    if (this.colorInput) {
      const onCustom = () => this.selectColor(this.colorInput.value, true);
      this.colorInput.addEventListener('input', onCustom);
      this.colorInput.addEventListener('change', onCustom);
    }

    // Paint preset swatches from their data-color (single source of truth)
    if (this.colorSwatches) {
      this.colorSwatches.querySelectorAll('button[data-color]').forEach(btn => {
        const c = ShortcutStorage.sanitizeColor(btn.dataset.color);
        if (c) btn.style.backgroundColor = c;
      });
    }
  },

  async processIconFile(file) {
    if (!file) return;
    this.setFieldError(this.iconError, null, '');
    if (!/^image\//i.test(file.type || '') || /svg/i.test(file.type)) {
      this.setFieldError(this.iconError, null, 'Please choose a PNG, JPG, WebP or GIF image.');
      return;
    }
    if (file.size > this.MAX_UPLOAD_BYTES) {
      this.setFieldError(this.iconError, null, 'That image is larger than 5 MB. Please choose a smaller file.');
      return;
    }
    if (this.uploadHint) this.uploadHint.textContent = 'Processing…';
    try {
      const dataUrl = await this.resizeImageFile(file, this.ICON_SIZE);
      if (!ShortcutStorage.sanitizeIcon({ type: 'upload', value: dataUrl })) throw new Error('invalid output');
      this.appearance.uploadData = dataUrl;
      if (this.uploadHint) this.uploadHint.textContent = `${file.name} · ready`;
      this.setIconType('upload', false);
    } catch (e) {
      console.error('Icon processing failed:', e);
      if (this.uploadHint) {
        this.uploadHint.textContent = this.appearance.uploadData ? 'Current image kept' : 'PNG, JPG, WebP or GIF · max 5 MB';
      }
      this.setFieldError(this.iconError, null, 'Couldn\'t read that image. Try a different file.');
    }
  },

  /**
   * Downscale an image file to a square data URL (WebP, PNG fallback) so it stays small in storage.
   * Near-square images are center-cropped; very wide/tall ones (logos) are fitted with transparent padding.
   */
  async resizeImageFile(file, size) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('decode failed'));
        i.src = objectUrl;
      });
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) throw new Error('empty image');

      const target = Math.max(16, Math.min(size, Math.max(w, h)));
      const canvas = document.createElement('canvas');
      canvas.width = target;
      canvas.height = target;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const ratio = Math.max(w, h) / Math.min(w, h);
      if (ratio <= 1.25) {
        const side = Math.min(w, h);
        ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, target, target);
      } else {
        const scale = target / Math.max(w, h);
        const dw = w * scale;
        const dh = h * scale;
        ctx.drawImage(img, 0, 0, w, h, (target - dw) / 2, (target - dh) / 2, dw, dh);
      }

      let out = canvas.toDataURL('image/webp', 0.9);
      if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/png');
      return out;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  },

  close() {
    this.pendingShortcutForm = null;
    clearTimeout(this._previewTimer);
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    document.body.classList.remove('has-inspector-open');
    if (this.drawer) {
      this.drawer.classList.remove('active');
      this.drawer.setAttribute('aria-hidden', 'true');
    }
    if (this.overlay) {
      this.overlay.classList.remove('active');
    }
  },

  async openCreateGroup() {
    if (!this.createGroupForm) return;
    this.newGroupNameInput.value = '';
    if (this.multiselectSearch) this.multiselectSearch.value = '';

    const shortcuts = await ShortcutStorage.getShortcuts();
    this.multiselectList.innerHTML = '';

    shortcuts.forEach(s => {
      const item = this.createMultiselectItem(s);
      this.multiselectList.appendChild(item);
    });

    this.showView(this.viewCreateGroup, 'Create Group');
    setTimeout(() => this.newGroupNameInput?.focus(), 60);
  },

  async openImportProfile() {
    if (!this.importProfileForm) return;
    const profiles = await ShortcutStorage.getProfiles();
    const activeProfileId = await ShortcutStorage.getActiveProfileId();

    this.importSourceSelect.innerHTML = '';
    const otherProfiles = profiles.filter(p => p.id !== activeProfileId);

    if (otherProfiles.length === 0) {
      if (typeof window !== 'undefined' && window.showToast) {
        window.showToast('No other profiles available to import from.');
      }
      return;
    }

    otherProfiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      this.importSourceSelect.appendChild(opt);
    });

    if (this.importMultiselectSearch) this.importMultiselectSearch.value = '';
    await this.populateImportShortcuts(otherProfiles[0].id);

    this.showView(this.viewImportProfile, 'Import Shortcuts from Profile');
  },

  async populateImportShortcuts(sourceProfileId) {
    if (!this.importMultiselectList) return;
    const sourceKey = sourceProfileId === 'profile-default' ? 'shortcut_plus_shortcuts' : `shortcut_plus_shortcuts_${sourceProfileId}`;
    const shortcuts = await ShortcutStorage._getStorageItem(sourceKey, []);

    this.importMultiselectList.innerHTML = '';
    if (shortcuts.length === 0) {
      this.importMultiselectList.innerHTML = '<div style="padding: 12px; font-size: 13px; color: var(--text-secondary); text-align: center;">No shortcuts found in this profile.</div>';
      return;
    }

    shortcuts.forEach(s => {
      const item = this.createMultiselectItem(s);
      this.importMultiselectList.appendChild(item);
    });
  },

  createMultiselectItem(s) {
    const item = document.createElement('label');
    item.className = 'multiselect-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'multiselect-checkbox';
    checkbox.value = s.id;

    const faviconUrl = FaviconResolver.getFaviconUrl(s.url);
    const host = FaviconResolver.getHostname(s.url);

    const img = document.createElement('img');
    img.className = 'multiselect-icon';
    const fallbackSrc = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%231a73e8"/></svg>';
    img.alt = s.name || '';
    img.onerror = () => {
      img.onerror = null;
      img.src = fallbackSrc;
    };
    img.src = faviconUrl || fallbackSrc;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'multiselect-name';
    nameSpan.textContent = s.name;

    const urlSpan = document.createElement('span');
    urlSpan.className = 'multiselect-url';
    urlSpan.textContent = host;

    item.appendChild(checkbox);
    item.appendChild(img);
    item.appendChild(nameSpan);
    item.appendChild(urlSpan);
    return item;
  },

  filterMultiselect(searchInput, listContainer) {
    if (!searchInput || !listContainer) return;
    const q = (searchInput.value || '').toLowerCase().trim();
    const items = listContainer.querySelectorAll('.multiselect-item');
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
    });
  },

  setAllCheckboxes(listContainer, checked) {
    if (!listContainer) return;
    const checkboxes = listContainer.querySelectorAll('.multiselect-checkbox');
    checkboxes.forEach(cb => {
      if (cb.closest('.multiselect-item').style.display !== 'none') {
        cb.checked = checked;
      }
    });
  },

  async handleCreateGroupSubmit() {
    const name = this.newGroupNameInput.value.trim();
    if (!name) return;

    const checkboxes = this.multiselectList.querySelectorAll('.multiselect-checkbox:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);

    const newGroup = await ShortcutStorage.addGroup(name, selectedIds);
    if (this.pendingShortcutForm) {
      // Return to the in-progress Add/Edit shortcut form with the new category selected
      await this.returnToShortcutForm(newGroup && newGroup.id);
    } else {
      this.close();
    }
    await ShortcutGrid.render();
  },

  async handleImportProfileSubmit() {
    const sourceProfileId = this.importSourceSelect.value;
    const checkboxes = this.importMultiselectList.querySelectorAll('.multiselect-checkbox:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);

    if (selectedIds.length === 0) {
      if (typeof window !== 'undefined' && window.showToast) {
        window.showToast('Please select at least one shortcut to import.');
      }
      return;
    }

    await ShortcutStorage.importShortcutsFromProfile(sourceProfileId, selectedIds);
    this.close();
    await ShortcutGrid.render();
  },

  async handleSave() {
    if (this.isSaving) return;

    const id = this.idInput.value;
    let name = (this.nameInput.value || '').trim();
    const rawUrl = (this.urlInput.value || '').trim();
    let groupId = this.groupSelect ? this.groupSelect.value : 'none';
    if (groupId === '__create_new__') groupId = this.lastGroupValue || 'none';

    this.setFieldError(this.nameError, this.nameInput, '');
    this.setFieldError(this.urlError, this.urlInput, '');
    this.setFieldError(this.iconError, null, '');

    // URL: http(s), scheme-less hosts, and chrome:// / edge:// / about: / file:// are accepted;
    // javascript:, data:, vbscript: and other schemes are rejected
    const urlResult = FaviconResolver.validateUrl(rawUrl);
    if (!urlResult.ok) {
      this.setFieldError(this.urlError, this.urlInput, urlResult.error);
      this.urlInput.focus();
      return;
    }
    const url = urlResult.url;

    // Name: auto-fill from the URL when left empty
    if (!name) {
      name = FaviconResolver.suggestName(url);
      if (!name) {
        this.setFieldError(this.nameError, this.nameInput, 'Please enter a name for the shortcut.');
        this.nameInput.focus();
        return;
      }
      this.nameInput.value = name;
    }

    // Icon
    const a = this.appearance || this.defaultAppearance();
    let icon = { type: 'auto' };
    if (a.iconType === 'emoji') {
      const value = this.emojiInput ? this.emojiInput.value.trim() : '';
      if (!value) {
        this.setFieldError(this.iconError, this.emojiInput, 'Type or pick an emoji, or switch the icon back to Auto.');
        this.emojiInput?.focus();
        return;
      }
      icon = ShortcutStorage.sanitizeIcon({ type: 'emoji', value });
      if (!icon) {
        this.setFieldError(this.iconError, this.emojiInput, 'Use a single emoji or up to 8 characters.');
        this.emojiInput?.focus();
        return;
      }
    } else if (a.iconType === 'upload') {
      icon = ShortcutStorage.sanitizeIcon({ type: 'upload', value: a.uploadData });
      if (!icon) {
        this.setFieldError(this.iconError, null, 'Choose an image to upload, or switch the icon back to Auto.');
        return;
      }
    } else if (a.iconType === 'url') {
      const value = this.iconUrlInput ? this.iconUrlInput.value.trim() : '';
      icon = ShortcutStorage.sanitizeIcon({ type: 'url', value });
      if (!icon) {
        this.setFieldError(this.iconError, this.iconUrlInput, 'Icon URL must be a valid http:// or https:// image link.');
        this.iconUrlInput?.focus();
        return;
      }
    }

    const payload = {
      name,
      url,
      groupId,
      icon,
      color: ShortcutStorage.sanitizeColor(a.color),
      openInNewTab: a.openInNewTab === true
    };

    this.setSaving(true);
    try {
      if (id) {
        await ShortcutStorage.updateShortcut(id, payload);
      } else {
        await ShortcutStorage.addShortcut(payload);
      }
      this.setSaving(false);
      this.close();
      await ShortcutGrid.render();
    } catch (e) {
      console.error('Failed to save shortcut:', e);
      this.setSaving(false);
      window.showToast?.('Could not save the shortcut. Please try again.');
    }
  },

  async handleDelete() {
    const id = this.idInput.value;
    if (id) {
      await ShortcutStorage.deleteShortcut(id);
      this.close();
      await ShortcutGrid.render();
    }
  }
};
