/* main.js - Application entry point and controller */

document.addEventListener('DOMContentLoaded', () => {
  const gridContainer = document.getElementById('shortcuts-grid');
  const shortcutsContainer = document.getElementById('shortcuts-container');

  // 1. Synchronously initialize UI components and DOM references
  ShortcutModal.init();
  SearchEngine.init();
  KeyboardNav.init();

  // Google Apps Launcher Waffle Menu Controller
  const googleAppsBtn = document.getElementById('google-apps-btn');
  const googleAppsDropdown = document.getElementById('google-apps-dropdown');
  const googleAppsWrapper = document.querySelector('.google-apps-wrapper');

  if (googleAppsBtn && googleAppsDropdown) {
    const toggleGoogleAppsMenu = (e) => {
      e.stopPropagation();
      const isHidden = googleAppsDropdown.classList.contains('hidden');
      if (isHidden) {
        googleAppsDropdown.classList.remove('hidden');
        googleAppsBtn.classList.add('active');
        googleAppsBtn.setAttribute('aria-expanded', 'true');
      } else {
        googleAppsDropdown.classList.add('hidden');
        googleAppsBtn.classList.remove('active');
        googleAppsBtn.setAttribute('aria-expanded', 'false');
      }
    };

    googleAppsBtn.addEventListener('click', toggleGoogleAppsMenu);

    googleAppsDropdown.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link) {
        googleAppsDropdown.classList.add('hidden');
        googleAppsBtn.classList.remove('active');
        googleAppsBtn.setAttribute('aria-expanded', 'false');
      } else {
        e.stopPropagation();
      }
    });

    document.addEventListener('click', (e) => {
      if (!googleAppsDropdown.classList.contains('hidden') && googleAppsWrapper && !googleAppsWrapper.contains(e.target)) {
        googleAppsDropdown.classList.add('hidden');
        googleAppsBtn.classList.remove('active');
        googleAppsBtn.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !googleAppsDropdown.classList.contains('hidden')) {
        googleAppsDropdown.classList.add('hidden');
        googleAppsBtn.classList.remove('active');
        googleAppsBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (gridContainer) {
    ShortcutGrid.init(gridContainer, 'grid');
    DragEngine.init(gridContainer, 'grid');
    AlignEngine.init();
  }

  // Hamburger Sidebar Drawer Controller
  const hamburgerBtn = document.getElementById('hamburger-menu-btn');
  const sidebarDrawer = document.getElementById('sidebar-drawer');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  const sidebarCustomizeBtn = document.getElementById('sidebar-customize-btn');
  const sidebarNewGroupBtn = document.getElementById('sidebar-new-group-btn');
  const sidebarSettingsBtn = document.getElementById('sidebar-settings-btn');
  const sidebarProfileSelect = document.getElementById('sidebar-profile-select');

  function openSidebar() {
    if (sidebarDrawer) sidebarDrawer.classList.add('active');
    if (sidebarOverlay) sidebarOverlay.classList.add('active');
    if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'true');
    if (sidebarCloseBtn) sidebarCloseBtn.focus();
  }

  function closeSidebar() {
    const wasOpen = sidebarDrawer && sidebarDrawer.classList.contains('active');
    if (sidebarDrawer) sidebarDrawer.classList.remove('active');
    if (sidebarOverlay) sidebarOverlay.classList.remove('active');
    if (hamburgerBtn) {
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      // Return focus to the toggle when the drawer itself had it
      if (wasOpen && sidebarDrawer.contains(document.activeElement)) hamburgerBtn.focus();
    }
  }

  if (hamburgerBtn) hamburgerBtn.addEventListener('click', openSidebar);
  if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

  if (sidebarCustomizeBtn) {
    sidebarCustomizeBtn.addEventListener('click', () => {
      closeSidebar();
      const isCurrentlyActive = document.body.classList.contains('edit-mode-active');
      setEditMode(!isCurrentlyActive);
    });
  }

  if (sidebarNewGroupBtn) {
    sidebarNewGroupBtn.addEventListener('click', () => {
      closeSidebar();
      ShortcutModal.openCreateGroup();
    });
  }

  const sidebarDocsBtn = document.getElementById('sidebar-docs-btn');

  if (sidebarDocsBtn) {
    sidebarDocsBtn.addEventListener('click', () => {
      closeSidebar();
      if (typeof ShortcutModal !== 'undefined') {
        ShortcutModal.openDocs();
      }
    });
  }

  if (sidebarSettingsBtn) {
    sidebarSettingsBtn.addEventListener('click', () => {
      closeSidebar();
      openSettings();
    });
  }

  const sidebarGameBtn = document.getElementById('sidebar-game-btn');
  if (sidebarGameBtn) {
    sidebarGameBtn.addEventListener('click', () => {
      closeSidebar();
      if (typeof ShortcutArcade !== 'undefined') {
        ShortcutArcade.open();
      } else if (typeof ShortcutRunner !== 'undefined') {
        ShortcutRunner.open();
      }
    });
  }

  if (sidebarProfileSelect) {
    sidebarProfileSelect.addEventListener('change', async (e) => {
      const val = e.target.value;
      closeSidebar();
      if (val === '__create_new__') {
        const activeProfileId = await ShortcutStorage.getActiveProfileId();
        if (profileSelect) profileSelect.value = activeProfileId;
        sidebarProfileSelect.value = activeProfileId;
        await promptCreateProfile();
      } else {
        await switchProfile(val);
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebarDrawer && sidebarDrawer.classList.contains('active')) {
      closeSidebar();
    }
  });

  // 2. Profile Switcher & Management Controller
  const profileSelect = document.getElementById('profile-switcher-select');
  const addProfileSettingsBtn = document.getElementById('add-profile-settings-btn');
  const profilesSettingsList = document.getElementById('profiles-settings-list');

  async function switchProfile(profileId) {
    // Layout undo history belongs to the profile it was recorded in
    AlignEngine.clearHistory();
    try {
      await ShortcutStorage.setActiveProfile(profileId);
      await refreshProfilesUI();
      if (typeof ShortcutWidgets !== 'undefined') await ShortcutWidgets.refresh();

      // Retrieve profile-specific settings
      const st = await ShortcutStorage.getSettings();

      // 1. Re-apply Theme, Wallpaper, and Visual Customizations
      // (also migrates/resolves uploaded background media into ThemeEngine.bgCustomUrl)
      await ThemeEngine.applySettings(st);

      // Small screens force grid mode (same override as initApp / checkResponsiveLayout)
      const layoutMode = getEffectiveLayoutMode(st);

      // 2. Re-apply Page Layout (component visibilities & section ordering & positions)
      if (typeof applyPageLayout === 'function') {
        applyPageLayout({ ...st, layoutMode });
      }

      // 3. Re-apply Layout Mode & Tile Style
      const tileStyle = st.tileStyle || 'grid';
      if (typeof ShortcutGrid !== 'undefined') {
        ShortcutGrid.setLayoutMode(layoutMode);
        ShortcutGrid.setTileStyle(tileStyle);
      }
      if (typeof DragEngine !== 'undefined') {
        DragEngine.setLayoutMode(layoutMode);
      }
      if (typeof updateModeButtons === 'function') {
        updateModeButtons(layoutMode);
      }

      // 4. Synchronize Settings Modal inputs if modal is open or about to be opened
      if (themeSelect) themeSelect.value = st.themeMode || 'system';
      if (tileStyleSelect) tileStyleSelect.value = st.tileStyle || 'grid';
      if (bgModeSelect) bgModeSelect.value = st.bgMode || 'default';
      if (customBgUrlInput) {
        customBgUrlInput.value = getEditableBgUrl(st.bgCustomUrl);
      }
      if (customBgField) {
        customBgField.style.display = st.bgMode === 'custom' ? 'block' : 'none';
      }
      updateCustomBgPreview(st.bgCustomUrl ? ThemeEngine.bgCustomUrl : '');

      const toggleLogoCheck = document.getElementById('toggle-logo-check');
      const toggleSearchCheck = document.getElementById('toggle-search-check');
      const toggleHeaderCheck = document.getElementById('toggle-header-check');
      if (toggleLogoCheck) toggleLogoCheck.checked = st.showGoogleLogo !== false;
      if (toggleSearchCheck) toggleSearchCheck.checked = st.showSearchBar !== false;
      if (showShortcutsToggle) showShortcutsToggle.checked = st.showShortcuts !== false;
      if (toggleHeaderCheck) toggleHeaderCheck.checked = st.showHeader !== false;

      // 5. Render Shortcut Grid for the switched profile
      if (typeof ShortcutGrid !== 'undefined') {
        await ShortcutGrid.render();
      }
    } catch (err) {
      console.error('[Profile] Error switching profile:', err);
    }
  }

  window.switchProfile = switchProfile;

  async function refreshProfilesUI() {
    try {
      const profiles = await ShortcutStorage.getProfiles();
      const activeProfileId = await ShortcutStorage.getActiveProfileId();

      // 2a. Update Header Dropdown
      if (profileSelect) {
        profileSelect.innerHTML = '';
        profiles.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name;
          if (p.id === activeProfileId) opt.selected = true;
          profileSelect.appendChild(opt);
        });

        if (profiles.length < 8) {
          const createOpt = document.createElement('option');
          createOpt.value = '__create_new__';
          createOpt.textContent = '+ Create New Profile...';
          profileSelect.appendChild(createOpt);
        }

        const sidebarSelect = document.getElementById('sidebar-profile-select');
        if (sidebarSelect) {
          sidebarSelect.innerHTML = profileSelect.innerHTML;
          sidebarSelect.value = activeProfileId;
        }
      }

      // 2b. Update Settings Modal Profiles List
      if (profilesSettingsList) {
        profilesSettingsList.innerHTML = '';
        profiles.forEach(p => {
          const row = document.createElement('div');
          row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--shortcut-tile-hover); border-radius: 6px; font-size: 13px;';

          const isDefault = p.id === 'profile-default';
          const isActive = p.id === activeProfileId;

          const safeName = (p.name || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

          row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 500; color: var(--text-primary);">${safeName}</span>
              ${isActive ? '<span style="font-size: 10px; padding: 2px 6px; background: var(--btn-primary); color: #fff; border-radius: 10px;">Active</span>' : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 2px;">
              <button type="button" class="btn-rename-profile" title="Rename Profile" aria-label="Rename profile ${safeName}" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
              </button>
              ${!isDefault ? `<button type="button" class="btn-delete-profile" title="Delete Profile" aria-label="Delete profile ${safeName}" style="background: none; border: none; color: #ea4335; cursor: pointer; padding: 4px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>` : '<span style="font-size: 11px; color: var(--text-secondary);">System Default</span>'}
            </div>
          `;

          const renameBtn = row.querySelector('.btn-rename-profile');
          if (renameBtn) {
            renameBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              await promptRenameProfile(p.id, p.name);
            });
          }

          const delBtn = row.querySelector('.btn-delete-profile');
          if (delBtn) {
            delBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              if (confirm(`Delete profile "${p.name}"?\n\nAll of its shortcuts, groups and settings will be permanently deleted. This cannot be undone.`)) {
                await ShortcutStorage.deleteProfile(p.id);
                const activeId = await ShortcutStorage.getActiveProfileId();
                await switchProfile(activeId);
              }
            });
          }

          profilesSettingsList.appendChild(row);
        });
      }

      if (addProfileSettingsBtn) {
        const isFull = profiles.length >= 8;
        addProfileSettingsBtn.disabled = isFull;
        addProfileSettingsBtn.style.cursor = isFull ? 'not-allowed' : 'pointer';
        addProfileSettingsBtn.style.opacity = isFull ? '0.6' : '1';
        addProfileSettingsBtn.textContent = isFull ? 'Limit Reached (8/8)' : '+ New Profile';
        addProfileSettingsBtn.title = isFull ? 'Maximum 8 profiles reached' : 'Create a new profile';
      }
    } catch (e) {
      console.warn('Error refreshing profiles UI:', e);
    }
  }

  const PROFILE_NAME_MAX = 40;

  // Returns an error message, or '' when the (trimmed) name is valid and unique
  function validateProfileName(name, profiles, excludeId = null) {
    if (!name) return 'Profile name cannot be empty.';
    if (name.length > PROFILE_NAME_MAX) return `Profile name must be ${PROFILE_NAME_MAX} characters or fewer.`;
    const lower = name.toLowerCase();
    if (profiles.some(p => p.id !== excludeId && (p.name || '').trim().toLowerCase() === lower)) {
      return `A profile named "${name}" already exists.`;
    }
    return '';
  }

  async function promptCreateProfile() {
    try {
      const profiles = await ShortcutStorage.getProfiles();
      if (profiles.length >= 8) {
        showToast('Maximum limit of 8 profiles reached.');
        return;
      }
      const input = prompt(`Enter a profile name (max ${PROFILE_NAME_MAX} characters, e.g. Design, Gaming, Side Project):`);
      if (input === null) return;
      const name = input.trim();
      const error = validateProfileName(name, profiles);
      if (error) {
        showToast(error);
        return;
      }
      const newProfile = await ShortcutStorage.addProfile(name);
      if (newProfile) {
        await switchProfile(newProfile.id);
      }
    } catch (e) {
      console.warn('Error creating profile:', e);
    }
  }

  async function promptRenameProfile(profileId, currentName) {
    const input = prompt(`Rename profile "${currentName}" (max ${PROFILE_NAME_MAX} characters):`, currentName);
    if (input === null) return;
    const name = input.trim();
    if (name === currentName) return;
    try {
      let error = '';
      await ShortcutStorage.transaction(async () => {
        const profiles = await ShortcutStorage.getProfiles();
        error = validateProfileName(name, profiles, profileId);
        if (error) return;
        if (!profiles.some(p => p.id === profileId)) {
          error = 'That profile no longer exists.';
          return;
        }
        await ShortcutStorage.saveProfiles(profiles.map(p => p.id === profileId ? { ...p, name } : p));
      });
      if (error) {
        showToast(error);
        return;
      }
      await refreshProfilesUI();
      showToast(`Profile renamed to "${name}".`);
    } catch (e) {
      console.warn('Error renaming profile:', e);
      showToast('Could not rename the profile.');
    }
  }

  if (profileSelect) {
    profileSelect.addEventListener('change', async (e) => {
      const val = e.target.value;
      if (val === '__create_new__') {
        const activeProfileId = await ShortcutStorage.getActiveProfileId();
        profileSelect.value = activeProfileId;
        await promptCreateProfile();
      } else {
        await switchProfile(val);
      }
    });
  }

  if (addProfileSettingsBtn) {
    addProfileSettingsBtn.addEventListener('click', async () => {
      await promptCreateProfile();
    });
  }

  const importProfileSettingsBtn = document.getElementById('import-profile-settings-btn');
  if (importProfileSettingsBtn) {
    importProfileSettingsBtn.addEventListener('click', () => {
      ShortcutModal.openImportProfile();
    });
  }

  // Page Layout Order & Component Visibility Controller
  const SECTION_ORDER_MAP = {
    'logo-search-shortcuts': { logo: 1, search: 2, shortcuts: 3 },
    'search-logo-shortcuts': { logo: 2, search: 1, shortcuts: 3 },
    'search-shortcuts-logo': { logo: 3, search: 1, shortcuts: 2 },
    'shortcuts-search-logo': { logo: 3, search: 2, shortcuts: 1 }
  };

  function applyPageLayout(st) {
    const root = document.documentElement;
    const body = document.body;

    // Component Visibilities
    if (st.showGoogleLogo === false) body.classList.add('hide-google-logo');
    else body.classList.remove('hide-google-logo');

    if (st.showSearchBar === false) body.classList.add('hide-search-bar');
    else body.classList.remove('hide-search-bar');

    if (st.showShortcuts === false) body.classList.add('hide-shortcuts-container');
    else body.classList.remove('hide-shortcuts-container');

    if (st.showHeader === false) body.classList.add('hide-header-bar');
    else body.classList.remove('hide-header-bar');

    // Section Ordering
    const orderPreset = typeof st.sectionOrder === 'string' ? st.sectionOrder : (
      Array.isArray(st.sectionOrder) ? st.sectionOrder.join('-') : 'logo-search-shortcuts'
    );
    const orderObj = SECTION_ORDER_MAP[orderPreset] || SECTION_ORDER_MAP['logo-search-shortcuts'];

    root.style.setProperty('--logo-order', orderObj.logo);
    root.style.setProperty('--search-order', orderObj.search);
    root.style.setProperty('--shortcuts-order', orderObj.shortcuts);

    // Main Component Free Placement Positions (Only active in Free Placement Mode)
    const logoEl = document.getElementById('google-logo-section');
    const searchEl = document.getElementById('search-bar-section');
    const logoResetBtn = document.getElementById('logo-reset-pos-btn');
    const searchResetBtn = document.getElementById('search-reset-pos-btn');

    // Narrow windows are forced into grid mode, so never pin the logo/search over grid tiles there
    const isFreeMode = getEffectiveLayoutMode(st) === 'free';

    if (logoEl) {
      const existingHandle = logoEl.querySelector('.resize-handle');
      if (existingHandle) existingHandle.remove();

      if (isFreeMode) {
        let posX, posY;
        if (st.logoPosition && typeof st.logoPosition.x === 'number' && typeof st.logoPosition.y === 'number') {
          posX = st.logoPosition.x;
          posY = st.logoPosition.y;
          if (posX > 100) posX = Number(((posX / window.innerWidth) * 100).toFixed(2));
          if (posY > 100) posY = Number(((posY / window.innerHeight) * 100).toFixed(2));
        } else {
          posX = 42;
          posY = 9;
        }
        posY = Math.max(7.5, posY);

        logoEl.style.position = 'fixed';
        logoEl.style.left = `${posX}vw`;
        logoEl.style.top = `${posY}vh`;
        logoEl.dataset.posX = posX;
        logoEl.dataset.posY = posY;
        logoEl.classList.add('has-free-position');
        if (logoResetBtn) logoResetBtn.style.display = 'inline-flex';

        if (st.logoSize && st.logoSize.width) {
          logoEl.style.width = st.logoSize.width + 'px';
        }
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        handle.title = 'Drag to resize logo';
        logoEl.appendChild(handle);
      } else {
        logoEl.style.position = '';
        logoEl.style.left = '';
        logoEl.style.top = '';
        logoEl.style.width = '';
        logoEl.classList.remove('has-free-position');
        if (logoResetBtn) logoResetBtn.style.display = 'none';
      }
    }

    if (searchEl) {
      const existingHandle = searchEl.querySelector('.resize-handle');
      if (existingHandle) existingHandle.remove();

      if (isFreeMode) {
        let posX, posY;
        if (st.searchBarPosition && typeof st.searchBarPosition.x === 'number' && typeof st.searchBarPosition.y === 'number') {
          posX = st.searchBarPosition.x;
          posY = st.searchBarPosition.y;
          if (posX > 100) posX = Number(((posX / window.innerWidth) * 100).toFixed(2));
          if (posY > 100) posY = Number(((posY / window.innerHeight) * 100).toFixed(2));
        } else {
          posX = 28;
          posY = 19;
        }
        posY = Math.max(7.5, posY);

        searchEl.style.position = 'fixed';
        searchEl.style.left = `${posX}vw`;
        searchEl.style.top = `${posY}vh`;
        searchEl.dataset.posX = posX;
        searchEl.dataset.posY = posY;
        searchEl.classList.add('has-free-position');
        if (searchResetBtn) searchResetBtn.style.display = 'inline-flex';

        if (st.searchBarSize && st.searchBarSize.width) {
          searchEl.style.width = st.searchBarSize.width + 'px';
        }
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        handle.title = 'Drag to resize search bar';
        searchEl.appendChild(handle);
      } else {
        searchEl.style.position = '';
        searchEl.style.left = '';
        searchEl.style.top = '';
        searchEl.style.width = '';
        searchEl.classList.remove('has-free-position');
        if (searchResetBtn) searchResetBtn.style.display = 'none';
      }
    }
  }

  // Initial settings and layout are coordinated in initApp() below

  // 3. Header & Toolbar Element Event Listeners
  const headerAddShortcutBtn = document.getElementById('header-add-shortcut-btn');
  const customizeBtn = document.getElementById('customize-btn');
  const newGroupHeaderBtn = document.getElementById('new-group-header-btn');
  const modeGridBtn = document.getElementById('mode-grid-btn');
  const modeFreeBtn = document.getElementById('mode-free-btn');
  const modeSelectBtn = document.getElementById('mode-select-btn');
  const editDoneBtn = document.getElementById('edit-done-btn');

  if (headerAddShortcutBtn) {
    headerAddShortcutBtn.addEventListener('click', () => {
      ShortcutModal.openAdd();
    });
  }

  const gameHeaderBtn = document.getElementById('game-header-btn');
  if (gameHeaderBtn) {
    gameHeaderBtn.addEventListener('click', () => {
      if (typeof ShortcutArcade !== 'undefined') {
        ShortcutArcade.open();
      } else if (typeof ShortcutRunner !== 'undefined') {
        ShortcutRunner.open();
      }
    });
  }



  const multiselectOpenBtn = document.getElementById('multiselect-open-btn');
  const multiselectSelectAllBtn = document.getElementById('multiselect-select-all-grid-btn');
  const multiselectClearBtn = document.getElementById('multiselect-clear-grid-btn');
  const multiselectDeleteBtn = document.getElementById('multiselect-delete-btn');
  const multiselectExitBtn = document.getElementById('multiselect-exit-btn');

  function handleBatchOpenEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    let mode = 'new-tab';
    if (e.altKey) {
      mode = 'incognito';
    } else if (e.shiftKey) {
      mode = 'new-window';
    }
    ShortcutGrid.openSelectedShortcuts(mode);
  }

  if (multiselectOpenBtn) {
    multiselectOpenBtn.addEventListener('click', handleBatchOpenEvent);
  }
  if (multiselectSelectAllBtn) {
    multiselectSelectAllBtn.addEventListener('click', () => ShortcutGrid.selectAll());
  }
  if (multiselectClearBtn) {
    multiselectClearBtn.addEventListener('click', () => ShortcutGrid.clearSelection());
  }
  if (multiselectDeleteBtn) {
    multiselectDeleteBtn.addEventListener('click', async () => await ShortcutGrid.deleteSelected());
  }
  if (multiselectExitBtn) {
    multiselectExitBtn.addEventListener('click', () => {
      ShortcutGrid.clearSelection();
      ShortcutGrid.setMultiSelectMode(false);
    });
  }

  // Inspector mode buttons live in the side panel; declared here so updateModeButtons can reach them
  const inspectorModeGridBtn = document.getElementById('inspector-mode-grid');
  const inspectorModeFreeBtn = document.getElementById('inspector-mode-free');

  // Syncs BOTH the edit toolbar and the Inspector mode buttons
  function updateModeButtons(mode) {
    const isFree = mode === 'free';
    [[modeGridBtn, !isFree], [modeFreeBtn, isFree], [inspectorModeGridBtn, !isFree], [inspectorModeFreeBtn, isFree]]
      .forEach(([btn, active]) => {
        if (!btn) return;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
  }

  function isNarrowWindow() {
    return window.innerWidth < SMALL_SCREEN_BREAKPOINT;
  }

  // Single entry point for switching layout mode (toolbar, Inspector and presets)
  async function setLayout(mode) {
    if (mode === 'free' && isNarrowWindow()) {
      showToast('Free Placement needs a wider window');
      updateModeButtons('grid');
      return false;
    }
    updateModeButtons(mode);
    ShortcutGrid.setLayoutMode(mode);
    DragEngine.setLayoutMode(mode);
    await ShortcutStorage.saveSettings({ layoutMode: mode });
    const st = await ShortcutStorage.getSettings();
    applyPageLayout(st);
    await ShortcutGrid.render();
    if (mode === 'free') DragEngine.recalculateFreePositions();
    return true;
  }

  if (modeGridBtn) modeGridBtn.addEventListener('click', () => setLayout('grid'));
  if (modeFreeBtn) modeFreeBtn.addEventListener('click', () => setLayout('free'));

  // Edit mode is per-tab UI state: it is intentionally NOT persisted, so every new tab starts in normal mode
  function setEditMode(active) {
    const sidebarCustomizeLabel = document.getElementById('sidebar-customize-label');
    if (sidebarCustomizeLabel) sidebarCustomizeLabel.textContent = active ? 'Done' : 'Edit layout';
    if (customizeBtn) {
      customizeBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      customizeBtn.title = active ? 'Done (E)' : 'Edit layout (E)';
      customizeBtn.setAttribute('aria-label', active ? 'Done' : 'Edit layout');
    }
    if (active) {
      document.body.classList.add('edit-mode-active');
      // Sidebar no longer auto-opens — user clicks a tile to inspect it
    } else {
      document.body.classList.remove('edit-mode-active');
      if (typeof ShortcutGrid !== 'undefined') {
        ShortcutGrid.clearSelection();
        ShortcutGrid.setMultiSelectMode(false);
      }
      if (typeof ShortcutModal !== 'undefined' && ShortcutModal.activeViewEl === ShortcutModal.viewInspector) {
        ShortcutModal.close();
      }
    }
  }

  async function applyLayoutPreset(presetName) {
    let layoutMode = 'free';
    if (presetName === 'classic-center') {
      layoutMode = 'grid';
    }
    if (layoutMode === 'free' && isNarrowWindow()) {
      showToast('Free Placement needs a wider window');
      return;
    }
    if (!confirm('Apply this layout preset? It repositions all of your shortcuts, the logo and the search bar.\n\nYou can undo the shortcut moves with Ctrl+Z.')) {
      return;
    }
    await AlignEngine.checkpoint();
    const shortcuts = await ShortcutStorage.getShortcuts();

    ShortcutGrid.setLayoutMode(layoutMode);
    DragEngine.setLayoutMode(layoutMode);
    updateModeButtons(layoutMode);
    await ShortcutStorage.saveSettings({ layoutMode });

    const updatedShortcuts = shortcuts.map(s => ({ ...s }));

    if (presetName === 'sidebar-split') {
      await ShortcutStorage.saveSettings({
        logoPosition: { x: 6, y: 12 },
        searchBarPosition: { x: 36, y: 10 }
      });

      const startX = 64; // vw
      const startY = 12; // vh
      const colSpacing = 10; // vw
      const rowSpacing = 14; // vh
      const rowsPerCol = 5;

      for (let i = 0; i < updatedShortcuts.length; i++) {
        const col = Math.floor(i / rowsPerCol);
        const row = i % rowsPerCol;
        updatedShortcuts[i].position = { x: startX + col * colSpacing, y: startY + row * rowSpacing };
        updatedShortcuts[i].hasCustomPosition = true;
      }
    } else if (presetName === 'classic-center') {
      await ShortcutStorage.saveSettings({
        logoPosition: { x: 50, y: 14 },
        searchBarPosition: { x: 50, y: 26 }
      });
    } else if (presetName === 'bottom-dock') {
      await ShortcutStorage.saveSettings({
        logoPosition: { x: 50, y: 12 },
        searchBarPosition: { x: 50, y: 24 }
      });

      const total = updatedShortcuts.length;
      const itemWidth = 8; // vw
      const perRow = Math.floor((92 - 6) / itemWidth) + 1; // fit within viewport
      const posY = 80; // vh (first dock row; extra rows stack upward)
      const rowSpacing = 12; // vh

      for (let i = 0; i < updatedShortcuts.length; i++) {
        const row = Math.floor(i / perRow);
        const indexInRow = i % perRow;
        const rowCount = Math.min(perRow, total - row * perRow);
        const startX = Math.max(6, (100 - rowCount * itemWidth) / 2);
        updatedShortcuts[i].position = { x: startX + indexInRow * itemWidth, y: posY - row * rowSpacing };
        updatedShortcuts[i].hasCustomPosition = true;
      }
    } else if (presetName === 'command-dashboard') {
      await ShortcutStorage.saveSettings({
        logoPosition: { x: 60, y: 14 },
        searchBarPosition: { x: 60, y: 28 }
      });

      const startX = 6;
      const startY = 10;
      const colSpacing = 10;
      const rowSpacing = 13;
      const rowsPerCol = 6;

      for (let i = 0; i < updatedShortcuts.length; i++) {
        const col = Math.floor(i / rowsPerCol);
        const row = i % rowsPerCol;
        updatedShortcuts[i].position = { x: startX + col * colSpacing, y: startY + row * rowSpacing };
        updatedShortcuts[i].hasCustomPosition = true;
      }
    } else if (presetName === 'dual-column') {
      await ShortcutStorage.saveSettings({
        logoPosition: { x: 50, y: 14 },
        searchBarPosition: { x: 50, y: 26 }
      });

      const mid = Math.ceil(updatedShortcuts.length / 2);
      const rowsPerCol = Math.floor((92 - 14) / 13) + 1; // wrap into inner columns when full
      for (let i = 0; i < updatedShortcuts.length; i++) {
        const isLeft = i < mid;
        const idx = isLeft ? i : (i - mid);
        const row = idx % rowsPerCol;
        const col = Math.floor(idx / rowsPerCol);
        updatedShortcuts[i].position = { x: isLeft ? 8 + col * 10 : 82 - col * 10, y: 14 + row * 13 };
        updatedShortcuts[i].hasCustomPosition = true;
      }
    }

    // Keep every preset position inside the visible viewport
    const clampPos = (v) => Math.min(92, Math.max(1, v));
    updatedShortcuts.forEach(s => {
      if (s.position) {
        s.position = { x: clampPos(s.position.x), y: clampPos(s.position.y) };
      }
    });

    // Single atomic batch write to storage
    await ShortcutStorage.saveShortcuts(updatedShortcuts);

    const st = await ShortcutStorage.getSettings();
    applyPageLayout(st);
    await ShortcutGrid.render();
    if (layoutMode === 'free') DragEngine.recalculateFreePositions();
    showToast('Layout preset applied. Press Ctrl+Z to undo the shortcut moves.');
  }

  if (customizeBtn) {
    customizeBtn.addEventListener('click', () => {
      const isCurrentlyActive = document.body.classList.contains('edit-mode-active');
      setEditMode(!isCurrentlyActive);
    });
  }

  // Inspector Buttons Wiring
  const inspectorPresetSelect = document.getElementById('inspector-preset-select');
  const inspectorApplyPresetBtn = document.getElementById('inspector-apply-preset-btn');
  const inspectorDoneBtn = document.getElementById('inspector-done-btn');
  const inspectorWidthInput = document.getElementById('inspector-width-input');
  const inspectorHeightInput = document.getElementById('inspector-height-input');
  const inspectorSelectAllBtn = document.getElementById('inspector-select-all-btn');
  const inspectorClearSelBtn = document.getElementById('inspector-clear-sel-btn');
  const inspectorDeleteSelBtn = document.getElementById('inspector-delete-sel-btn');
  const inspectorResetPosBtn = document.getElementById('inspector-reset-pos-btn');
  const inspectorResetSizesBtn = document.getElementById('inspector-reset-sizes-btn');

  if (inspectorModeGridBtn) inspectorModeGridBtn.addEventListener('click', () => setLayout('grid'));
  if (inspectorModeFreeBtn) inspectorModeFreeBtn.addEventListener('click', () => setLayout('free'));

  if (inspectorApplyPresetBtn && inspectorPresetSelect) {
    inspectorApplyPresetBtn.addEventListener('click', async () => {
      await applyLayoutPreset(inspectorPresetSelect.value);
    });
  }

  if (inspectorDoneBtn) {
    inspectorDoneBtn.addEventListener('click', () => {
      setEditMode(false);
      ShortcutGrid.setMultiSelectMode(false);
    });
  }

  // Toast Notification System
  let toastTimer = null;
  // options: { actionLabel, onAction, duration } - an action renders a clickable button (e.g. Undo)
  function showToast(message, options = {}) {
    const toast = document.getElementById('app-toast');
    const toastText = document.getElementById('app-toast-text');
    if (!toast || !toastText) return;

    toastText.textContent = message;

    let actionBtn = toast.querySelector('.app-toast-action');
    if (options.actionLabel && typeof options.onAction === 'function') {
      if (!actionBtn) {
        actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'app-toast-action';
        toast.appendChild(actionBtn);
      }
      actionBtn.textContent = options.actionLabel;
      actionBtn.onclick = () => {
        toast.classList.remove('active', 'has-action');
        if (toastTimer) clearTimeout(toastTimer);
        options.onAction();
      };
      toast.classList.add('has-action');
    } else {
      if (actionBtn) actionBtn.remove();
      toast.classList.remove('has-action');
    }

    toast.classList.add('active');

    if (toastTimer) clearTimeout(toastTimer);
    const duration = options.duration || (options.actionLabel ? 6000 : 2400);
    toastTimer = setTimeout(() => {
      toast.classList.remove('active', 'has-action');
    }, duration);
  }
  window.showToast = showToast;

  // Real-time Live Size Application to Selected Card(s)
  function applyLiveSizeToSelected(w, h) {
    if (!w || !h || w < 24 || h < 24) return;
    const targetIds = Array.from(ShortcutGrid.selectedShortcutIds);
    if (targetIds.length === 0) return; // Never mutate all cards if none selected!

    targetIds.forEach(id => {
      const card = document.querySelector(`.shortcut-card[data-id="${id}"]`);
      if (card) {
        card.style.width = `${w}px`;
        card.style.height = `${h}px`;
        if (h < 68 || w < 68) {
          card.classList.add('is-compact-tile');
        } else {
          card.classList.remove('is-compact-tile');
        }
      }
    });
  }

  // Quick Size Presets in Inspector
  const sizePresetTiny = document.getElementById('size-preset-tiny');
  const sizePresetSmall = document.getElementById('size-preset-small');
  const sizePresetMedium = document.getElementById('size-preset-medium');
  const sizePresetLarge = document.getElementById('size-preset-large');
  const sizePresetPill = document.getElementById('size-preset-pill');

  const stepDownW = document.getElementById('step-down-w');
  const stepUpW = document.getElementById('step-up-w');
  const stepDownH = document.getElementById('step-down-h');
  const stepUpH = document.getElementById('step-up-h');

  function setAndApplySizeInputs(w, h, save = true) {
    const targetIds = Array.from(ShortcutGrid.selectedShortcutIds);
    if (targetIds.length === 0) {
      showToast('Select a shortcut first to change its size.');
      return;
    }
    if (inspectorWidthInput) inspectorWidthInput.value = w;
    if (inspectorHeightInput) inspectorHeightInput.value = h;
    applyLiveSizeToSelected(w, h);
    if (save) {
      saveSelectedSize(w, h);
    }
  }

  if (sizePresetTiny) {
    sizePresetTiny.addEventListener('click', () => setAndApplySizeInputs(40, 40, true));
  }
  if (sizePresetSmall) {
    sizePresetSmall.addEventListener('click', () => setAndApplySizeInputs(60, 60, true));
  }
  if (sizePresetMedium) {
    sizePresetMedium.addEventListener('click', () => setAndApplySizeInputs(112, 112, true));
  }
  if (sizePresetLarge) {
    sizePresetLarge.addEventListener('click', () => setAndApplySizeInputs(140, 140, true));
  }
  if (sizePresetPill) {
    sizePresetPill.addEventListener('click', () => setAndApplySizeInputs(160, 44, true));
  }

  if (stepDownW && inspectorWidthInput) {
    stepDownW.addEventListener('click', () => {
      const current = parseInt(inspectorWidthInput.value || 112, 10);
      const nw = Math.max(24, current - 8);
      const h = parseInt(inspectorHeightInput?.value || nw, 10);
      setAndApplySizeInputs(nw, h, true);
    });
  }
  if (stepUpW && inspectorWidthInput) {
    stepUpW.addEventListener('click', () => {
      const current = parseInt(inspectorWidthInput.value || 112, 10);
      const nw = Math.min(450, current + 8);
      const h = parseInt(inspectorHeightInput?.value || nw, 10);
      setAndApplySizeInputs(nw, h, true);
    });
  }
  if (stepDownH && inspectorHeightInput) {
    stepDownH.addEventListener('click', () => {
      const current = parseInt(inspectorHeightInput.value || 112, 10);
      const nh = Math.max(24, current - 8);
      const w = parseInt(inspectorWidthInput?.value || nh, 10);
      setAndApplySizeInputs(w, nh, true);
    });
  }
  if (stepUpH && inspectorHeightInput) {
    stepUpH.addEventListener('click', () => {
      const current = parseInt(inspectorHeightInput.value || 112, 10);
      const nh = Math.min(450, current + 8);
      const w = parseInt(inspectorWidthInput?.value || nh, 10);
      setAndApplySizeInputs(w, nh, true);
    });
  }

  let sizeSaveTimer = null;
  function handleSizeInput() {
    const targetIds = Array.from(ShortcutGrid.selectedShortcutIds);
    if (targetIds.length === 0) return;
    const w = parseInt(inspectorWidthInput?.value, 10);
    const h = parseInt(inspectorHeightInput?.value || w, 10);
    if (!w || !h || w < 24 || h < 24) return;
    applyLiveSizeToSelected(w, h);

    if (sizeSaveTimer) clearTimeout(sizeSaveTimer);
    sizeSaveTimer = setTimeout(() => {
      saveSelectedSize(w, h);
    }, 450);
  }

  if (inspectorWidthInput) {
    inspectorWidthInput.addEventListener('input', handleSizeInput);
    inspectorWidthInput.addEventListener('change', () => {
      if (sizeSaveTimer) clearTimeout(sizeSaveTimer);
      const w = parseInt(inspectorWidthInput.value, 10);
      const h = parseInt(inspectorHeightInput?.value || w, 10);
      if (w && h) saveSelectedSize(w, h);
    });
  }
  if (inspectorHeightInput) {
    inspectorHeightInput.addEventListener('input', handleSizeInput);
    inspectorHeightInput.addEventListener('change', () => {
      if (sizeSaveTimer) clearTimeout(sizeSaveTimer);
      const h = parseInt(inspectorHeightInput.value, 10);
      const w = parseInt(inspectorWidthInput?.value || h, 10);
      if (w && h) saveSelectedSize(w, h);
    });
  }

  async function saveSelectedSize(width, height) {
    if (!width || !height || width < 24 || height < 24) {
      showToast('Please enter width and height of at least 24px.');
      return;
    }

    const targetIds = Array.from(ShortcutGrid.selectedShortcutIds);
    if (targetIds.length === 0) {
      showToast('Select a shortcut first to change its size.');
      return;
    }

    for (const id of targetIds) {
      await ShortcutStorage.updateShortcut(id, { size: { width, height } });
    }

    await ShortcutGrid.render();
    showToast(`Saved ${width}×${height}px size to ${targetIds.length} shortcut${targetIds.length > 1 ? 's' : ''}`);
  }

  const inspectorOpenSelBtn = document.getElementById('inspector-open-sel-btn');
  if (inspectorOpenSelBtn) {
    inspectorOpenSelBtn.addEventListener('click', handleBatchOpenEvent);
  }

  if (inspectorSelectAllBtn) {
    inspectorSelectAllBtn.addEventListener('click', () => {
      ShortcutGrid.setMultiSelectMode(true);
      ShortcutGrid.selectAll();
      if (inspectorDeleteSelBtn) inspectorDeleteSelBtn.disabled = false;
    });
  }

  if (inspectorClearSelBtn) {
    inspectorClearSelBtn.addEventListener('click', () => {
      ShortcutGrid.clearSelection();
      if (inspectorDeleteSelBtn) inspectorDeleteSelBtn.disabled = true;
    });
  }

  if (inspectorDeleteSelBtn) {
    inspectorDeleteSelBtn.addEventListener('click', async () => {
      await ShortcutGrid.deleteSelected();
      inspectorDeleteSelBtn.disabled = true;
    });
  }

  if (inspectorResetPosBtn) {
    inspectorResetPosBtn.addEventListener('click', async () => {
      await AlignEngine.checkpoint();
      await ShortcutStorage.saveSettings({ logoPosition: null, searchBarPosition: null });
      const shortcuts = await ShortcutStorage.getShortcuts();
      const updated = shortcuts.map(s => ({ ...s, position: null, hasCustomPosition: false }));
      await ShortcutStorage.saveShortcuts(updated);
      const st = await ShortcutStorage.getSettings();
      applyPageLayout(st);
      await ShortcutGrid.render();
      showToast('Shortcut, logo and search bar positions reset. Ctrl+Z undoes the shortcut moves.');
    });
  }

  // Shared by the Inspector and Settings: resets shortcut, group, logo and search bar sizes (undoable for tiles/groups)
  async function resetAllSizes() {
    await AlignEngine.checkpoint();
    await ShortcutStorage.transaction(async () => {
      const shortcuts = await ShortcutStorage.getShortcuts();
      await ShortcutStorage.saveShortcuts(shortcuts.map(s => ({ ...s, size: null })));
      const groups = await ShortcutStorage.getGroups();
      await ShortcutStorage.saveGroups(groups.map(g => ({ ...g, size: null })));
    });
    await ShortcutStorage.saveSettings({ logoSize: null, searchBarSize: null });
    const st = await ShortcutStorage.getSettings();
    applyPageLayout(st);
    await ShortcutGrid.render();
    showToast('Shortcut, group, logo and search bar sizes reset. Ctrl+Z undoes the tile and group sizes.');
  }

  if (inspectorResetSizesBtn) {
    inspectorResetSizesBtn.addEventListener('click', resetAllSizes);
  }

  // Bottom-Right Switch to Google Home Handler
  const switchNtpBtn = document.getElementById('switch-ntp-mode-btn');

  if (switchNtpBtn) {
    switchNtpBtn.addEventListener('click', () => {
      window.open('https://www.google.com', '_blank');
    });
  }

  if (newGroupHeaderBtn) {
    newGroupHeaderBtn.addEventListener('click', () => {
      ShortcutModal.openCreateGroup();
    });
  }

  if (editDoneBtn) {
    editDoneBtn.addEventListener('click', () => {
      setEditMode(false);
      ShortcutGrid.setMultiSelectMode(false);
    });
  }

  if (modeSelectBtn) {
    modeSelectBtn.addEventListener('click', () => {
      ShortcutGrid.setMultiSelectMode(!ShortcutGrid.isMultiSelectMode);
    });
  }

  const toolbarOpenSidebarBtn = document.getElementById('toolbar-open-sidebar-btn');
  if (toolbarOpenSidebarBtn) {
    toolbarOpenSidebarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof ShortcutModal !== 'undefined') {
        if (ShortcutModal.isOpen() && ShortcutModal.activeViewEl === ShortcutModal.viewInspector) {
          ShortcutModal.close();
        } else {
          ShortcutModal.openInspector();
        }
      }
    });
  }

  // 4. Settings & Customization Modal Wiring
  const settingsBtn = document.getElementById('settings-btn');
  const settingsCloseBtn = document.getElementById('settings-close-btn');
  const showShortcutsToggle = document.getElementById('show-shortcuts-toggle');
  const tileStyleSelect = document.getElementById('tile-style-select');
  const themeSelect = document.getElementById('theme-select');
  const bgModeSelect = document.getElementById('bg-mode-select');
  const customBgField = document.getElementById('custom-bg-field');
  const customBgUrlInput = document.getElementById('custom-bg-url-input');
  const customBgUploadBtn = document.getElementById('custom-bg-upload-btn');
  const customBgFileInput = document.getElementById('custom-bg-file-input');
  const customBgRemoveBtn = document.getElementById('custom-bg-remove-btn');
  const customBgPreviewWrapper = document.getElementById('custom-bg-preview-wrapper');
  const customBgPreviewImg = document.getElementById('custom-bg-preview-img');
  const customBgPreviewVideo = document.getElementById('custom-bg-preview-video');

  const exportJsonBtn = document.getElementById('export-json-btn');
  const importJsonBtn = document.getElementById('import-json-btn');
  const importFileInput = document.getElementById('import-file-input');
  const resetDevShortcutsBtn = document.getElementById('reset-dev-shortcuts-btn');

  function processMediaFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }

      const fileName = file.name || '';
      const fileType = file.type || '';
      const isVideo = fileType.startsWith('video/') || /\.(mp4|webm|ogg|mov)$/i.test(fileName);
      const isGif = fileType === 'image/gif' || /\.gif$/i.test(fileName);
      // PNG / WebP / GIF keep transparency (and animation) when stored as-is
      const isLosslessFriendly = isGif || ['image/png', 'image/webp'].includes(fileType) || /\.(png|webp)$/i.test(fileName);
      const KEEP_AS_IS_LIMIT = 4 * 1024 * 1024;

      if (file.size > 50 * 1024 * 1024) {
        reject(new Error(`${isVideo ? 'Video' : 'Media'} file exceeds the 50MB size limit. Please choose a smaller file.`));
        return;
      }

      const reader = new FileReader();

      // Videos, GIFs and small PNG/WebP files are stored untouched (canvas would drop animation/transparency)
      if (isVideo || isGif || (isLosslessFriendly && file.size <= KEEP_AS_IS_LIMIT)) {
        reader.onload = (e) => {
          resolve(e.target.result);
        };
        reader.onerror = () => reject(new Error('Failed to read video/media file'));
        reader.readAsDataURL(file);
        return;
      }

      // Large static images (and all JPEGs): downscale and re-encode as WebP to keep storage small
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const MAX_WIDTH = 1920;
          const MAX_HEIGHT = 1080;
          let width = img.width;
          let height = img.height;

          // Small JPEGs that already fit the screen gain nothing from a re-encode
          if (file.size <= KEEP_AS_IS_LIMIT && width <= MAX_WIDTH && height <= MAX_HEIGHT) {
            resolve(e.target.result);
            return;
          }

          if (width > MAX_WIDTH || height > MAX_HEIGHT) {
            if (width / height > MAX_WIDTH / MAX_HEIGHT) {
              height = Math.round((height * MAX_WIDTH) / width);
              width = MAX_WIDTH;
            } else {
              width = Math.round((width * MAX_HEIGHT) / height);
              height = MAX_HEIGHT;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          let dataUrl = canvas.toDataURL('image/webp', 0.88);
          // Browsers without WebP encoding fall back to PNG; use JPEG then to stay compact
          if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.88);
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error('Failed to load image file'));
        img.src = e.target.result;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }

  // The URL field only ever shows a user-typed URL (never uploaded media or its storage marker)
  function getEditableBgUrl(url) {
    if (!url || url.startsWith('data:') || ThemeEngine.isStoredMediaMarker(url)) return '';
    return url;
  }

  function updateCustomBgPreview(url) {
    if (url && url.trim()) {
      const isVideo = ThemeEngine.isVideoUrl(url);

      if (isVideo) {
        if (customBgPreviewImg) {
          customBgPreviewImg.style.display = 'none';
          customBgPreviewImg.src = '';
        }
        if (customBgPreviewVideo) {
          customBgPreviewVideo.src = url;
          customBgPreviewVideo.style.display = 'block';
          customBgPreviewVideo.play().catch(() => {});
        }
      } else {
        if (customBgPreviewVideo) {
          customBgPreviewVideo.style.display = 'none';
          customBgPreviewVideo.src = '';
        }
        if (customBgPreviewImg) {
          customBgPreviewImg.src = url;
          customBgPreviewImg.style.display = 'block';
        }
      }
      if (customBgPreviewWrapper) customBgPreviewWrapper.style.display = 'block';
      if (customBgRemoveBtn) customBgRemoveBtn.style.display = 'inline-flex';
    } else {
      if (customBgPreviewWrapper) customBgPreviewWrapper.style.display = 'none';
      if (customBgRemoveBtn) customBgRemoveBtn.style.display = 'none';
      if (customBgPreviewImg) {
        customBgPreviewImg.style.display = 'none';
        customBgPreviewImg.src = '';
      }
      if (customBgPreviewVideo) {
        customBgPreviewVideo.style.display = 'none';
        customBgPreviewVideo.src = '';
      }
    }
  }

  function openSettings() {
    ShortcutStorage.getSettings().then(st => {
      if (themeSelect) themeSelect.value = st.themeMode || 'system';
      if (showShortcutsToggle) showShortcutsToggle.checked = st.showShortcuts !== false;
      if (tileStyleSelect) tileStyleSelect.value = st.tileStyle || 'grid';
      if (bgModeSelect) bgModeSelect.value = st.bgMode || 'default';
      if (customBgUrlInput) {
        customBgUrlInput.value = getEditableBgUrl(st.bgCustomUrl);
      }

      const toggleLogoCheck = document.getElementById('toggle-logo-check');
      const toggleSearchCheck = document.getElementById('toggle-search-check');
      const toggleHeaderCheck = document.getElementById('toggle-header-check');

      if (toggleLogoCheck) toggleLogoCheck.checked = st.showGoogleLogo !== false;
      if (toggleSearchCheck) toggleSearchCheck.checked = st.showSearchBar !== false;
      if (showShortcutsToggle) showShortcutsToggle.checked = st.showShortcuts !== false;
      if (toggleHeaderCheck) toggleHeaderCheck.checked = st.showHeader !== false;

      // Populate Visual Customization Controls
      const settingsTitleColor = document.getElementById('settings-title-color');
      const settingsCardBgColor = document.getElementById('settings-card-bg-color');
      const settingsCardOpacity = document.getElementById('settings-card-opacity');
      const opacityValBadge = document.getElementById('opacity-val-badge');
      const settingsCardBlur = document.getElementById('settings-card-blur');
      const blurValBadge = document.getElementById('blur-val-badge');

      if (settingsTitleColor) {
        if (st.titleColor) {
          settingsTitleColor.value = st.titleColor;
        } else {
          const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || 
            (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
          settingsTitleColor.value = isDark ? '#f1f3f4' : '#1f1f1f';
        }
      }
      if (settingsCardBgColor) settingsCardBgColor.value = st.cardBgColor || '#12161e';
      if (settingsCardOpacity) {
        settingsCardOpacity.value = st.cardOpacity !== undefined ? st.cardOpacity : 85;
        if (opacityValBadge) opacityValBadge.textContent = `${settingsCardOpacity.value}%`;
      }
      if (settingsCardBlur) {
        settingsCardBlur.value = st.cardBlur !== undefined ? st.cardBlur : 16;
        if (blurValBadge) blurValBadge.textContent = `${settingsCardBlur.value}px`;
      }

      if (customBgField) {
        customBgField.style.display = st.bgMode === 'custom' ? 'block' : 'none';
      }
      ThemeEngine.resolveBgUrl(st.bgCustomUrl || '').then(updateCustomBgPreview);
    });
    refreshProfilesUI();
    ShortcutModal.openSettings();
  }

  window.openSettings = openSettings;
  window.setEditMode = setEditMode;

  const floatingSettingsBtn = document.getElementById('floating-settings-btn');
  if (floatingSettingsBtn) {
    floatingSettingsBtn.addEventListener('click', openSettings);
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettings);
  }

  if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener('click', () => {
      ShortcutModal.close();
    });
  }

  const resetComponentSizesBtn = document.getElementById('reset-component-sizes-btn');
  if (resetComponentSizesBtn) {
    resetComponentSizesBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to reset all custom shortcut, group, logo, and search bar sizes to default?')) {
        return;
      }
      await resetAllSizes();
    });
  }

  // Component Visibility & Section Placement Event Listeners
  const toggleLogoCheck = document.getElementById('toggle-logo-check');
  const toggleSearchCheck = document.getElementById('toggle-search-check');
  const toggleHeaderCheck = document.getElementById('toggle-header-check');

  if (toggleLogoCheck) {
    toggleLogoCheck.addEventListener('change', async (e) => {
      const show = e.target.checked;
      const st = await ShortcutStorage.getSettings();
      const updated = { ...st, showGoogleLogo: show };
      await ShortcutStorage.saveSettings({ showGoogleLogo: show });
      applyPageLayout(updated);
    });
  }

  if (toggleSearchCheck) {
    toggleSearchCheck.addEventListener('change', async (e) => {
      const show = e.target.checked;
      const st = await ShortcutStorage.getSettings();
      const updated = { ...st, showSearchBar: show };
      await ShortcutStorage.saveSettings({ showSearchBar: show });
      applyPageLayout(updated);
    });
  }

  if (showShortcutsToggle) {
    showShortcutsToggle.addEventListener('change', async (e) => {
      const show = e.target.checked;
      const st = await ShortcutStorage.getSettings();
      const updated = { ...st, showShortcuts: show };
      await ShortcutStorage.saveSettings({ showShortcuts: show });
      applyPageLayout(updated);
    });
  }

  if (toggleHeaderCheck) {
    toggleHeaderCheck.addEventListener('change', async (e) => {
      const show = e.target.checked;
      const st = await ShortcutStorage.getSettings();
      const updated = { ...st, showHeader: show };
      await ShortcutStorage.saveSettings({ showHeader: show });
      applyPageLayout(updated);
    });
  }

  // On-Screen Section Action Badges (Logo & Search Bar in Edit Mode)
  const logoHideBtn = document.getElementById('logo-hide-btn');
  const logoResetPosBtn = document.getElementById('logo-reset-pos-btn');
  const searchHideBtn = document.getElementById('search-hide-btn');
  const searchResetPosBtn = document.getElementById('search-reset-pos-btn');
  const resetAllPositionsBtn = document.getElementById('reset-all-positions-btn');

  if (logoResetPosBtn) {
    logoResetPosBtn.addEventListener('click', async () => {
      const st = await ShortcutStorage.getSettings();
      const updated = { ...st, logoPosition: null };
      await ShortcutStorage.saveSettings({ logoPosition: null });
      applyPageLayout(updated);
    });
  }

  if (searchResetPosBtn) {
    searchResetPosBtn.addEventListener('click', async () => {
      const st = await ShortcutStorage.getSettings();
      const updated = { ...st, searchBarPosition: null };
      await ShortcutStorage.saveSettings({ searchBarPosition: null });
      applyPageLayout(updated);
    });
  }

  if (resetAllPositionsBtn) {
    resetAllPositionsBtn.addEventListener('click', async () => {
      const st = await ShortcutStorage.getSettings();
      const updated = { ...st, logoPosition: null, searchBarPosition: null, addShortcutPosition: null };
      await ShortcutStorage.saveSettings({ logoPosition: null, searchBarPosition: null, addShortcutPosition: null });
      applyPageLayout(updated);
      await ShortcutGrid.render();
    });
  }

  // Hides the logo or search bar, with an Undo action (both can also be re-enabled in Settings)
  async function setSectionVisible(key, checkboxId, visible) {
    await ShortcutStorage.saveSettings({ [key]: visible });
    const st = await ShortcutStorage.getSettings();
    applyPageLayout({ ...st, layoutMode: getEffectiveLayoutMode(st) });
    const checkbox = document.getElementById(checkboxId);
    if (checkbox) checkbox.checked = visible;
  }

  function hideSectionWithUndo(key, checkboxId, label) {
    return async () => {
      await setSectionVisible(key, checkboxId, false);
      showToast(`${label} hidden. You can re-enable it in Settings.`, {
        actionLabel: 'Undo',
        onAction: () => setSectionVisible(key, checkboxId, true)
      });
    };
  }

  if (logoHideBtn) {
    logoHideBtn.addEventListener('click', hideSectionWithUndo('showGoogleLogo', 'toggle-logo-check', 'Logo'));
  }

  if (searchHideBtn) {
    searchHideBtn.addEventListener('click', hideSectionWithUndo('showSearchBar', 'toggle-search-check', 'Search bar'));
  }

  // Settings Change Event Listeners (Tile Style, Theme, Wallpaper & Custom Backgrounds)
  if (tileStyleSelect) {
    tileStyleSelect.addEventListener('change', async (e) => {
      const style = e.target.value;
      ShortcutGrid.setTileStyle(style);
      await ShortcutStorage.saveSettings({ tileStyle: style });
      await ShortcutGrid.render();
    });
  }

  if (themeSelect) {
    themeSelect.addEventListener('change', async (e) => {
      // setTheme applies and persists the theme
      await ThemeEngine.setTheme(e.target.value);
    });
  }

  if (bgModeSelect) {
    bgModeSelect.addEventListener('change', async (e) => {
      const mode = e.target.value;
      if (customBgField) {
        customBgField.style.display = mode === 'custom' ? 'block' : 'none';
      }
      const st = await ShortcutStorage.getSettings();
      const url = st.bgCustomUrl || (customBgUrlInput ? customBgUrlInput.value.trim() : '');
      updateCustomBgPreview(mode === 'custom' ? await ThemeEngine.resolveBgUrl(url) : '');
      // setBackground applies and persists bgMode + bgCustomUrl; if the saved custom URL fails
      // to load it persists nothing, so still remember the chosen mode
      const ok = await ThemeEngine.setBackground(mode, url);
      if (!ok) await ShortcutStorage.saveSettings({ bgMode: mode });
    });
  }

  // Upload Custom Background Image File
  if (customBgUploadBtn && customBgFileInput) {
    customBgUploadBtn.addEventListener('click', () => {
      customBgFileInput.click();
    });

    customBgFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        const dataUrl = await processMediaFile(file);
        if (bgModeSelect) bgModeSelect.value = 'custom';
        if (customBgField) customBgField.style.display = 'block';
        if (customBgUrlInput) customBgUrlInput.value = '';

        updateCustomBgPreview(dataUrl);
        // setBackground persists bgMode + bgCustomUrl itself
        await ThemeEngine.setBackground('custom', dataUrl);
        showToast('Background media applied successfully!');
      } catch (err) {
        console.error('[Settings] Error processing media upload:', err);
        showToast(err.message || 'Could not process selected media file.');
      } finally {
        // Reset so re-picking the same file fires 'change' again
        e.target.value = '';
      }
    });
  }

  // Drag & Drop Image / Video File onto Custom Background Section
  if (customBgField) {
    customBgField.addEventListener('dragover', (e) => {
      e.preventDefault();
      customBgField.style.opacity = '0.8';
    });

    customBgField.addEventListener('dragleave', () => {
      customBgField.style.opacity = '1';
    });

    customBgField.addEventListener('drop', async (e) => {
      e.preventDefault();
      customBgField.style.opacity = '1';
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && (file.type.startsWith('image/') || file.type.startsWith('video/') || /\.(mp4|webm|ogg|mov)$/i.test(file.name || ''))) {
        try {
          const dataUrl = await processMediaFile(file);
          if (bgModeSelect) bgModeSelect.value = 'custom';
          if (customBgUrlInput) customBgUrlInput.value = '';

          updateCustomBgPreview(dataUrl);
          await ThemeEngine.setBackground('custom', dataUrl);
          showToast('Background media applied successfully!');
        } catch (err) {
          console.error('[Settings] Error dropping media file:', err);
          showToast(err.message || 'Could not process dropped media file.');
        }
      }
    });
  }

  // Custom Background Image/Video URL Input
  if (customBgUrlInput) {
    // Applied on 'change' only (Enter / blur), never while typing
    customBgUrlInput.addEventListener('change', async () => {
      const url = customBgUrlInput.value.trim();
      if (!url) return;
      if (bgModeSelect) bgModeSelect.value = 'custom';
      if (customBgField) customBgField.style.display = 'block';
      updateCustomBgPreview(url);
      const ok = await ThemeEngine.setBackground('custom', url);
      if (!ok && customBgUrlInput.value.trim() === url) {
        // Failed URLs are not saved: restore the last saved background and its preview
        const st = await ShortcutStorage.getSettings();
        await ThemeEngine.applySettings(st);
        if (bgModeSelect) bgModeSelect.value = st.bgMode || 'default';
        if (customBgField) customBgField.style.display = st.bgMode === 'custom' ? 'block' : 'none';
        updateCustomBgPreview(st.bgMode === 'custom' ? ThemeEngine.bgCustomUrl : '');
      }
    });
  }

  // Remove Custom Background Button
  if (customBgRemoveBtn) {
    customBgRemoveBtn.addEventListener('click', async () => {
      if (customBgUrlInput) customBgUrlInput.value = '';
      if (customBgFileInput) customBgFileInput.value = '';
      updateCustomBgPreview('');
      if (bgModeSelect) bgModeSelect.value = 'default';
      const st = await ShortcutStorage.getSettings();
      await ThemeEngine.setBackground('default', '');
      // Free the uploaded media blob of this profile
      const activeId = await ShortcutStorage.getActiveProfileId();
      if (st.bgCustomUrl === ThemeEngine.MEDIA_MARKER_PREFIX + activeId) {
        await ShortcutStorage._setStorageItem(ThemeEngine.mediaKey(activeId), null);
      }
    });
  }

  // Visual Customization Controls (Contrast, Opacity & Blur Sliders)
  const settingsTitleColor = document.getElementById('settings-title-color');
  const resetTitleColorBtn = document.getElementById('reset-title-color-btn');
  const settingsCardBgColor = document.getElementById('settings-card-bg-color');
  const resetCardBgBtn = document.getElementById('reset-card-bg-btn');
  const settingsCardOpacity = document.getElementById('settings-card-opacity');
  const opacityValBadge = document.getElementById('opacity-val-badge');
  const settingsCardBlur = document.getElementById('settings-card-blur');
  const blurValBadge = document.getElementById('blur-val-badge');

  if (settingsTitleColor) {
    settingsTitleColor.addEventListener('input', (e) => {
      ThemeEngine.applyVisualCustomizations({ titleColor: e.target.value });
    });
    settingsTitleColor.addEventListener('change', async (e) => {
      await ShortcutStorage.saveSettings({ titleColor: e.target.value });
    });
  }

  if (resetTitleColorBtn) {
    resetTitleColorBtn.addEventListener('click', async () => {
      ThemeEngine.applyVisualCustomizations({ titleColor: '' });
      await ShortcutStorage.saveSettings({ titleColor: '' });
      if (settingsTitleColor) {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || 
          (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
        settingsTitleColor.value = isDark ? '#f1f3f4' : '#1f1f1f';
      }
    });
  }

  if (settingsCardBgColor) {
    settingsCardBgColor.addEventListener('input', (e) => {
      ThemeEngine.applyVisualCustomizations({ cardBgColor: e.target.value });
    });
    settingsCardBgColor.addEventListener('change', async (e) => {
      await ShortcutStorage.saveSettings({ cardBgColor: e.target.value });
    });
  }

  if (resetCardBgBtn) {
    resetCardBgBtn.addEventListener('click', async () => {
      ThemeEngine.applyVisualCustomizations({ cardBgColor: '' });
      await ShortcutStorage.saveSettings({ cardBgColor: '' });
      if (settingsCardBgColor) settingsCardBgColor.value = '#12161e';
    });
  }

  if (settingsCardOpacity) {
    // Live preview while dragging; persist once on release
    settingsCardOpacity.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (opacityValBadge) opacityValBadge.textContent = `${val}%`;
      ThemeEngine.applyVisualCustomizations({ cardOpacity: val });
    });
    settingsCardOpacity.addEventListener('change', async (e) => {
      await ShortcutStorage.saveSettings({ cardOpacity: parseInt(e.target.value, 10) });
    });
  }

  if (settingsCardBlur) {
    settingsCardBlur.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (blurValBadge) blurValBadge.textContent = `${val}px`;
      ThemeEngine.applyVisualCustomizations({ cardBlur: val });
    });
    settingsCardBlur.addEventListener('change', async (e) => {
      await ShortcutStorage.saveSettings({ cardBlur: parseInt(e.target.value, 10) });
    });
  }

  if (resetDevShortcutsBtn) {
    resetDevShortcutsBtn.addEventListener('click', async () => {
      if (confirm('Reset this profile to the default shortcuts?\n\nAll of your current shortcuts AND groups in this profile will be removed. This cannot be undone.')) {
        const clonedDefaults = DEFAULT_SHORTCUTS.map((s, idx) => ({
          ...s,
          id: 'shortcut-' + Date.now() + '-' + idx
        }));
        await ShortcutStorage.saveShortcuts(clonedDefaults);
        await ShortcutStorage.saveGroups([]);
        await ShortcutGrid.render();
        showToast('Successfully reset default shortcuts!');
        if (typeof ShortcutModal !== 'undefined') ShortcutModal.close();
      }
    });
  }

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', async () => {
      await BackupEngine.exportBackup();
    });
  }

  if (importJsonBtn && importFileInput) {
    importJsonBtn.addEventListener('click', () => {
      importFileInput.click();
    });

    importFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const imported = await BackupEngine.importBackup(file);
          if (imported) {
            showToast('Shortcut+ layout successfully restored!');
            if (typeof ShortcutModal !== 'undefined') ShortcutModal.close();
          }
        } catch (err) {
          showToast('Failed to import layout: ' + err.message);
        }
      }
      // Reset so re-picking the same file fires 'change' again
      e.target.value = '';
    });
  }

  // 5. Search Bar form handling
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');

  if (searchForm && searchInput) {
    searchForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const query = searchInput.value.trim();
      if (!query) return;
      await SearchEngine.executeSearch(query);
    });
  }

  // 6. Unified Coordinated Startup Lifecycle (Zero-FOUC single render pass)
  const SMALL_SCREEN_BREAKPOINT = 900;
  let windowResizeTimeout = null;

  function getEffectiveLayoutMode(settings) {
    const isSmallScreen = window.innerWidth < SMALL_SCREEN_BREAKPOINT;
    return isSmallScreen ? 'grid' : ((settings && settings.layoutMode) || 'grid');
  }

  async function initApp() {
    try {
      const settings = await ShortcutStorage.getSettings();
      const targetMode = getEffectiveLayoutMode(settings);

      // Set styles and layout modes before any DOM rendering
      ShortcutGrid.setLayoutMode(targetMode);
      ShortcutGrid.setTileStyle(settings.tileStyle || 'grid');
      DragEngine.setLayoutMode(targetMode);
      updateModeButtons(targetMode);

      applyPageLayout({ ...settings, layoutMode: targetMode });

      // Edit mode is never restored on load: every new tab starts in normal mode
      if (settings.isEditMode) {
        ShortcutStorage.saveSettings({ isEditMode: false });
      }

      await ThemeEngine.init();
      await refreshProfilesUI();

      // Each optional module initializes on its own so one failure can't take the others down
      [
        ['Runner', typeof ShortcutRunner !== 'undefined' ? ShortcutRunner : null],
        ['Breaker', typeof ShortcutBreaker !== 'undefined' ? ShortcutBreaker : null],
        ['Arcade', typeof ShortcutArcade !== 'undefined' ? ShortcutArcade : null]
      ].forEach(([name, mod]) => {
        if (!mod) return;
        try { mod.init(); } catch (err) { console.error(`[Shortcut+] ${name} failed to initialize:`, err); }
      });
      if (typeof ShortcutWidgets !== 'undefined') {
        // Widgets go first so free-placement defaults can avoid the docked widget column
        try { await ShortcutWidgets.init(); } catch (err) { console.error('[Shortcut+] Widgets failed to load:', err); }
      }

      // Single coordinated render pass
      await ShortcutGrid.render();

      if (targetMode === 'free') {
        DragEngine.recalculateFreePositions();
      }
    } catch (err) {
      console.warn('[Main] Error during unified app init:', err);
      try { await ShortcutGrid.render(); } catch (e) {}
    }
  }

  // First-run onboarding tip (one-time, dismissible, never auto-hides)
  const ONBOARDED_KEY = 'shortcut_plus_onboarded';

  function maybeShowOnboardingTip() {
    try {
      if (localStorage.getItem(ONBOARDED_KEY)) return;
    } catch (e) {
      return; // Storage blocked: skip the tip rather than show it on every tab
    }

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const tip = document.createElement('div');
    tip.className = 'onboarding-tip';
    tip.setAttribute('role', 'note');
    tip.setAttribute('aria-label', 'Getting started tips');

    const text = document.createElement('p');
    text.className = 'onboarding-tip-text';
    const parts = [
      ['Tips: press ', 'E', ' to edit layout, '],
      ['', 'N', ' to add a shortcut, '],
      ['', '/', ' or '],
      ['', isMac ? '\u2318K' : 'Ctrl+K', ' to search, and drag to arrange.']
    ];
    parts.forEach(([before, key, after]) => {
      if (before) text.appendChild(document.createTextNode(before));
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      text.appendChild(kbd);
      text.appendChild(document.createTextNode(after));
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'onboarding-tip-close';
    closeBtn.setAttribute('aria-label', 'Dismiss tips');
    closeBtn.title = 'Dismiss';
    closeBtn.textContent = '\u2715';
    closeBtn.addEventListener('click', () => {
      try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch (e) { /* ignore */ }
      tip.remove();
    });

    tip.append(text, closeBtn);
    document.body.appendChild(tip);
  }

  // Initialize entire application cleanly
  initApp().then(maybeShowOnboardingTip);

  async function checkResponsiveLayout() {
    const settings = await ShortcutStorage.getSettings();
    const targetMode = getEffectiveLayoutMode(settings);

    if (ShortcutGrid.layoutMode !== targetMode || DragEngine.layoutMode !== targetMode) {
      ShortcutGrid.setLayoutMode(targetMode);
      DragEngine.setLayoutMode(targetMode);
      updateModeButtons(targetMode);
      applyPageLayout({ ...settings, layoutMode: targetMode });
      await ShortcutGrid.render();
    } else if (targetMode === 'free') {
      DragEngine.recalculateFreePositions();
    }
  }

  window.addEventListener('resize', () => {
    if (windowResizeTimeout) clearTimeout(windowResizeTimeout);
    windowResizeTimeout = setTimeout(() => {
      checkResponsiveLayout();
    }, 40);
  });
});
