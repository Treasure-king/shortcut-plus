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
    newGroupOpt.textContent = '+ Create New Category...';
    this.groupSelect.appendChild(newGroupOpt);
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
      } else if (e.key === 'Tab' && this.drawer) {
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
          await this.openCreateGroup();
        }
      });
    }

    if (this.form) {
      this.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSave();
      });
    }

    if (this.deleteBtn) {
      this.deleteBtn.addEventListener('click', async () => {
        await this.handleDelete();
      });
    }

    // Create Group Handlers
    if (this.createGroupCancelBtn) {
      this.createGroupCancelBtn.addEventListener('click', () => this.close());
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
    await this.populateGroups('none');
    if (this.deleteBtn) this.deleteBtn.style.display = 'none';
    if (this.saveBtn) this.saveBtn.textContent = 'Done';
    this.showView(this.viewShortcut, 'Add shortcut');
    setTimeout(() => this.nameInput?.focus(), 60);
  },

  async openEdit(shortcut) {
    this.idInput.value = shortcut.id;
    this.nameInput.value = shortcut.name;
    this.urlInput.value = shortcut.url;
    await this.populateGroups(shortcut.groupId || 'none');
    if (this.deleteBtn) this.deleteBtn.style.display = 'inline-flex';
    if (this.saveBtn) this.saveBtn.textContent = 'Done';
    this.showView(this.viewShortcut, 'Edit shortcut');
    setTimeout(() => this.nameInput?.focus(), 60);
  },

  close() {
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

    this.showView(this.viewCreateGroup, 'Create Category Group');
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
        window.showToast('No other workspace profiles available to import from.');
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
    img.src = faviconUrl;
    img.alt = s.name || '';
    img.onerror = () => {
      img.onerror = null;
      img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%231a73e8"/></svg>';
    };

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

    await ShortcutStorage.addGroup(name, selectedIds);
    this.close();
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
    const id = this.idInput.value;
    const name = (this.nameInput.value || '').trim();
    let url = (this.urlInput.value || '').trim();
    const groupId = this.groupSelect ? this.groupSelect.value : 'none';

    if (!name) {
      if (typeof window !== 'undefined' && window.showToast) {
        window.showToast('Please enter a name for the shortcut.');
      }
      return;
    }
    if (!url) {
      if (typeof window !== 'undefined' && window.showToast) {
        window.showToast('Please enter a website URL.');
      }
      return;
    }

    url = FaviconResolver.normalizeUrl(url);

    // Validate URL format
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
        throw new Error('Invalid URL');
      }
    } catch (e) {
      if (typeof window !== 'undefined' && window.showToast) {
        window.showToast('Please enter a valid web URL (e.g. https://example.com)');
      }
      return;
    }

    if (id) {
      await ShortcutStorage.updateShortcut(id, { name, url, groupId });
    } else {
      await ShortcutStorage.addShortcut({ name, url, groupId });
    }

    this.close();
    await ShortcutGrid.render();
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
