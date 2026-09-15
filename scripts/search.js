/* search.js - High-prominence Real-time Search Engine, Live Google Suggestions, Search History & Hotkeys */

const SearchEngine = {
  searchInput: null,
  searchBadge: null,
  matchCounter: null,
  historyDropdownEl: null,
  selectedHistoryIndex: -1,
  debounceTimer: null,

  init() {
    this.searchInput = document.getElementById('search-input');
    this.historyDropdownEl = document.getElementById('search-history-dropdown');
    this.injectSearchUI();
    this.bindEvents();
  },

  injectSearchUI() {
    if (!this.searchInput) return;

    // Set informative placeholder
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const hotkey = isMac ? '⌘K' : 'Ctrl+K';
    this.searchInput.placeholder = `Search the web or filter shortcuts (${hotkey} or /)`;

    const wrapper = this.searchInput.closest('.search-input-wrapper');
    if (wrapper) {
      // 1. Hotkey Badge
      if (!wrapper.querySelector('.search-badge')) {
        const badge = document.createElement('div');
        badge.className = 'search-badge';
        badge.textContent = hotkey;
        badge.title = 'Press hotkey to focus search';
        wrapper.appendChild(badge);
        this.searchBadge = badge;
      }

      // 2. Real-time Match Counter Badge
      if (!wrapper.querySelector('.search-match-counter')) {
        const counter = document.createElement('div');
        counter.className = 'search-match-counter';
        counter.style.display = 'none';
        wrapper.appendChild(counter);
        this.matchCounter = counter;
      }
    }
  },

  bindEvents() {
    if (!this.searchInput) return;

    // 1. Hotkey Triggers: Ctrl+K / Cmd+K / Slash (/)
    document.addEventListener('keydown', (e) => {
      const isRunnerOpen = typeof ShortcutRunner !== 'undefined' && ShortcutRunner.isOpen;
      const isModalOpen = typeof ShortcutModal !== 'undefined' && ShortcutModal.isOpen();
      if (isRunnerOpen || isModalOpen) return;

      const isInputActive = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
        this.renderHistoryDropdown();
        return;
      }

      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
        this.renderHistoryDropdown();
      }
    });

    // 2. Focus & Typing input handlers for search history & tile filter
    this.searchInput.addEventListener('focus', () => {
      this.renderHistoryDropdown();
    });

    this.searchInput.addEventListener('click', () => {
      this.renderHistoryDropdown();
    });

    this.searchInput.addEventListener('input', () => {
      this.handleFilter();
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.renderHistoryDropdown();
      }, 100);
    });

    // 3. Arrow Keys & Navigation inside Search Input
    this.searchInput.addEventListener('keydown', (e) => {
      if (!this.historyDropdownEl || this.historyDropdownEl.style.display === 'none') {
        if (e.key === 'Enter') {
          this.handleSearchSubmit(e);
        }
        return;
      }

      const items = Array.from(this.historyDropdownEl.querySelectorAll('.search-history-item'));
      if (items.length === 0) {
        if (e.key === 'Enter') {
          this.handleSearchSubmit(e);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectedHistoryIndex = (this.selectedHistoryIndex + 1) % items.length;
        this.highlightHistoryItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectedHistoryIndex = (this.selectedHistoryIndex - 1 + items.length) % items.length;
        this.highlightHistoryItem(items);
      } else if (e.key === 'Enter') {
        if (this.selectedHistoryIndex >= 0 && this.selectedHistoryIndex < items.length) {
          e.preventDefault();
          const selectedItem = items[this.selectedHistoryIndex];
          if (selectedItem && selectedItem.dataset.url) {
            window.location.href = FaviconResolver.normalizeUrl(selectedItem.dataset.url);
          } else {
            const selectedText = selectedItem?.dataset.query;
            if (selectedText) {
              this.searchInput.value = selectedText;
              this.executeSearch(selectedText);
            }
          }
        } else {
          this.handleSearchSubmit(e);
        }
      } else if (e.key === 'Escape') {
        this.hideHistoryDropdown();
      }
    });

    // 4. Click Outside listener to close history dropdown
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#search-bar-section')) {
        this.hideHistoryDropdown();
      }
    });
  },

  highlightHistoryItem(items) {
    items.forEach((item, idx) => {
      if (idx === this.selectedHistoryIndex) {
        item.classList.add('is-selected');
        this.searchInput.value = item.dataset.query || '';
        this.handleFilter();
      } else {
        item.classList.remove('is-selected');
      }
    });
  },

  async renderHistoryDropdown() {
    if (!this.historyDropdownEl) return;

    const query = (this.searchInput.value || '').trim();
    const history = await ShortcutStorage.getSearchHistory();

    // 1. Filter local history matching query
    let filteredHistory = query
      ? history.filter(item => item.toLowerCase().includes(query.toLowerCase()))
      : history;

    // Limit history entries
    filteredHistory = filteredHistory.slice(0, 6);

    // 2. Matching shortcut suggestions if typing
    let matchingShortcuts = [];
    if (query.length > 0) {
      try {
        const shortcuts = await ShortcutStorage.getShortcuts();
        matchingShortcuts = shortcuts.filter(s =>
          (s.name && s.name.toLowerCase().includes(query.toLowerCase())) ||
          (s.url && s.url.toLowerCase().includes(query.toLowerCase()))
        ).slice(0, 4);
      } catch (e) {
        // Silent fallback
      }
    }

    if (filteredHistory.length === 0 && matchingShortcuts.length === 0 && !query) {
      this.hideHistoryDropdown();
      return;
    }

    this.selectedHistoryIndex = -1;
    this.historyDropdownEl.innerHTML = '';

    // Search Action Item: prompt to search default engine if user typed a query
    if (query) {
      const searchItemEl = document.createElement('div');
      searchItemEl.className = 'search-history-item search-type-query';
      searchItemEl.dataset.query = query;

      searchItemEl.innerHTML = `
        <div class="search-history-left">
          <div class="search-history-clock-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
          <span class="search-history-text">Search for "<strong>${this.escapeHtml(query)}</strong>"</span>
        </div>
      `;

      searchItemEl.addEventListener('click', () => {
        this.searchInput.value = query;
        this.executeSearch(query);
      });

      this.historyDropdownEl.appendChild(searchItemEl);
    }

    // Render Matching Shortcuts
    matchingShortcuts.forEach(s => {
      const itemEl = document.createElement('div');
      itemEl.className = 'search-history-item search-type-shortcut';
      itemEl.dataset.query = s.name;
      itemEl.dataset.url = s.url;

      const faviconUrl = FaviconResolver.getFaviconUrl(s.url);
      const host = FaviconResolver.getHostname(s.url);

      itemEl.innerHTML = `
        <div class="search-history-left">
          <div class="search-history-clock-icon">
            <img src="${faviconUrl}" alt="" style="width: 16px; height: 16px; border-radius: 50%; object-fit: contain;" onerror="this.style.display='none'">
          </div>
          <span class="search-history-text">${this.escapeHtml(s.name)} <span style="font-size: 11px; opacity: 0.6; margin-left: 6px;">${this.escapeHtml(host)}</span></span>
        </div>
      `;

      itemEl.addEventListener('click', () => {
        window.location.href = FaviconResolver.normalizeUrl(s.url);
      });

      this.historyDropdownEl.appendChild(itemEl);
    });

    // Render Recent Search History Items (Clock Icon 🕒)
    filteredHistory.forEach((histItem) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'search-history-item search-type-history';
      itemEl.dataset.query = histItem;

      itemEl.innerHTML = `
        <div class="search-history-left">
          <div class="search-history-clock-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <span class="search-history-text">${this.escapeHtml(histItem)}</span>
        </div>
        <button type="button" class="search-history-delete-btn" title="Remove from search history">
          ✕
        </button>
      `;

      itemEl.addEventListener('click', (e) => {
        if (e.target.closest('.search-history-delete-btn')) return;
        this.searchInput.value = histItem;
        this.executeSearch(histItem);
      });

      const delBtn = itemEl.querySelector('.search-history-delete-btn');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await ShortcutStorage.deleteSearchHistoryItem(histItem);
        await this.renderHistoryDropdown();
      });

      this.historyDropdownEl.appendChild(itemEl);
    });

    if (this.historyDropdownEl.children.length === 0) {
      this.hideHistoryDropdown();
      return;
    }

    this.historyDropdownEl.style.display = 'block';
  },

  hideHistoryDropdown() {
    if (this.historyDropdownEl) {
      this.historyDropdownEl.style.display = 'none';
      this.selectedHistoryIndex = -1;
    }
  },

  async handleSearchSubmit(e) {
    const query = (this.searchInput.value || '').trim();

    if (query) {
      e.preventDefault();
      await this.executeSearch(query);
    }
  },

  async executeSearch(query) {
    if (!query || !query.trim()) return;
    const trimmed = query.trim();

    // Save query to persistent search history
    await ShortcutStorage.addSearchHistory(trimmed);
    this.hideHistoryDropdown();

    // Direct URL navigation vs default web search
    const isUrlPattern = /^(https?:\/\/)?(localhost|(\d{1,3}\.){3}\d{1,3}|([\w-]+\.)+[\w-]+)(:\d+)?(\/[^\s]*)?$/i.test(trimmed);
    if (isUrlPattern && !trimmed.includes(' ')) {
      window.location.href = FaviconResolver.normalizeUrl(trimmed);
    } else if (typeof chrome !== 'undefined' && chrome.search && typeof chrome.search.query === 'function') {
      // Respect user's selected search provider via Chrome Search API (Complies with Chrome Web Store Single Purpose Policy - Red Argon)
      chrome.search.query({
        text: trimmed,
        disposition: 'CURRENT_TAB'
      });
    } else {
      // Fallback for non-extension environment
      window.location.href = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
    }
  },

  handleFilter() {
    const query = this.searchInput.value.trim().toLowerCase();
    const cards = document.querySelectorAll('.shortcut-card:not(.shortcut-card-add)');

    if (!query) {
      document.body.classList.remove('search-filtering-active');
      if (this.matchCounter) this.matchCounter.style.display = 'none';
      cards.forEach(card => {
        card.classList.remove('search-match', 'search-dimmed');
      });

      // Restore previously collapsed group state
      if (this._preSearchCollapsedGroupIds && this._preSearchCollapsedGroupIds.size > 0) {
        this._preSearchCollapsedGroupIds.forEach(groupId => {
          const groupSec = document.querySelector(`.shortcut-group-section[data-group-id="${groupId}"]`);
          if (groupSec) {
            groupSec.classList.add('is-collapsed');
          }
        });
        this._preSearchCollapsedGroupIds.clear();
      }
      return;
    }

    // Capture collapsed groups before first character filter if not already tracked
    if (!this._preSearchCollapsedGroupIds) {
      this._preSearchCollapsedGroupIds = new Set();
    }
    if (this._preSearchCollapsedGroupIds.size === 0 && !document.body.classList.contains('search-filtering-active')) {
      document.querySelectorAll('.shortcut-group-section.is-collapsed').forEach(g => {
        if (g.dataset.groupId) this._preSearchCollapsedGroupIds.add(g.dataset.groupId);
      });
    }

    document.body.classList.add('search-filtering-active');
    let matchCount = 0;

    cards.forEach(card => {
      const title = (card.querySelector('.shortcut-title')?.textContent || '').toLowerCase();
      const href = (card.getAttribute('href') || '').toLowerCase();
      const groupSection = card.closest('.shortcut-group-section');
      const groupTitle = (groupSection?.querySelector('.group-title')?.textContent || '').toLowerCase();

      const isMatch = title.includes(query) || href.includes(query) || groupTitle.includes(query);

      if (isMatch) {
        card.classList.add('search-match');
        card.classList.remove('search-dimmed');
        matchCount++;

        // Automatically expand collapsed group if a matching shortcut is inside
        if (groupSection && groupSection.classList.contains('is-collapsed')) {
          groupSection.classList.remove('is-collapsed');
        }
      } else {
        card.classList.add('search-dimmed');
        card.classList.remove('search-match');
      }
    });

    // Update match count badge
    if (this.matchCounter) {
      this.matchCounter.style.display = 'inline-flex';
      this.matchCounter.textContent = `${matchCount} match${matchCount === 1 ? '' : 'es'}`;
    }
  },

  escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }
};
