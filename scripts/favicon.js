/* favicon.js - Favicon resolver and letter avatar fallback */

const FaviconResolver = {
  // Non-web schemes users may keep as shortcuts (opened via chrome.tabs, not plain navigation)
  ALLOWED_SPECIAL_SCHEMES: ['chrome', 'chrome-extension', 'edge', 'about', 'file'],

  /**
   * Normalize a user-entered URL.
   * - http/https: kept as-is
   * - scheme-less input (e.g. "github.com", "localhost:3000/x"): prefixed with https://
   * - chrome://, chrome-extension://, edge://, about:, file://: kept as-is
   * - anything else (javascript:, data:, vbscript:, ftp:, ...): returns '' (invalid)
   */
  normalizeUrl(rawUrl) {
    if (rawUrl === null || rawUrl === undefined) return '';
    // Strip ASCII control chars (the URL parser ignores them, so "java\tscript:" must not slip through)
    let url = String(rawUrl).replace(/[\u0000-\u001F\u007F]/g, '').trim();
    if (!url) return '';

    const schemeMatch = url.match(/^([a-z][a-z0-9+.-]*):/i);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toLowerCase();
      if (scheme === 'http' || scheme === 'https') return url;
      if (this.ALLOWED_SPECIAL_SCHEMES.includes(scheme)) return url;
      if (['javascript', 'data', 'vbscript', 'blob', 'filesystem'].includes(scheme)) return '';
      // "localhost:3000" / "example.com:8080/path" look like a scheme but are host:port
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)*:\d+([\/?#]|$)/i.test(url)) return 'https://' + url;
      return '';
    }

    if (url.startsWith('//')) return 'https:' + url;
    return 'https://' + url;
  },

  /**
   * True for allowed non-http(s) URLs (chrome://, file://, about:, ...). Pages can't navigate to these
   * directly, so callers should open them through chrome.tabs.
   */
  isSpecialUrl(url) {
    const normalized = this.normalizeUrl(url);
    if (!normalized) return false;
    const m = normalized.match(/^([a-z][a-z0-9+.-]*):/i);
    return !!m && this.ALLOWED_SPECIAL_SCHEMES.includes(m[1].toLowerCase());
  },

  /**
   * Validate a user-entered shortcut URL. Returns { ok, url, error }.
   */
  validateUrl(rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (!raw) return { ok: false, url: '', error: 'Please enter a URL.' };
    const normalized = this.normalizeUrl(raw);
    if (!normalized) {
      return { ok: false, url: '', error: 'This link type isn\'t supported. Use a web address (https://…) or chrome://, edge://, about:, file:// links.' };
    }
    try {
      const parsed = new URL(normalized);
      const proto = parsed.protocol;
      if ((proto === 'http:' || proto === 'https:') && !parsed.hostname) throw new Error('no host');
      if ((proto === 'chrome:' || proto === 'edge:' || proto === 'chrome-extension:') && !parsed.hostname) throw new Error('no host');
      if (proto === 'about:' && !parsed.pathname) throw new Error('empty');
    } catch (e) {
      return { ok: false, url: '', error: 'Please enter a valid URL (e.g. github.com or https://example.com).' };
    }
    return { ok: true, url: normalized, error: '' };
  },

  /**
   * Extract hostname safely from URL.
   */
  getHostname(url) {
    try {
      const normalized = this.normalizeUrl(url);
      if (!normalized) return '';
      const parsed = new URL(normalized);
      return parsed.hostname.replace(/^www\./i, '');
    } catch (e) {
      return '';
    }
  },

  /**
   * Suggest a readable display name from a URL ("github.com" -> "GitHub", "chrome://settings" -> "Settings").
   */
  suggestName(url) {
    const normalized = this.normalizeUrl(url);
    if (!normalized) return '';
    let parsed;
    try { parsed = new URL(normalized); } catch (e) { return ''; }

    const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    const proto = parsed.protocol;

    if (proto === 'file:') {
      let path = parsed.pathname;
      try { path = decodeURIComponent(path); } catch (e) { /* keep encoded */ }
      const parts = path.split('/').filter(Boolean);
      return parts.length ? parts[parts.length - 1] : 'Local file';
    }
    if (proto === 'about:') return 'about:' + parsed.pathname;
    if (proto !== 'http:' && proto !== 'https:') {
      return cap((parsed.hostname || '').replace(/[-_]+/g, ' ')) || normalized;
    }

    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (!host) return '';
    if (host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':')) {
      return parsed.port ? `${host}:${parsed.port}` : host;
    }

    const known = {
      github: 'GitHub', gitlab: 'GitLab', youtube: 'YouTube', chatgpt: 'ChatGPT', openai: 'OpenAI',
      linkedin: 'LinkedIn', stackoverflow: 'Stack Overflow', wikipedia: 'Wikipedia', whatsapp: 'WhatsApp',
      tiktok: 'TikTok', paypal: 'PayPal', icloud: 'iCloud', bitbucket: 'Bitbucket', devto: 'DEV',
      npmjs: 'npm', figma: 'Figma', reddit: 'Reddit', netflix: 'Netflix', x: 'X'
    };
    const labels = host.split('.');
    let core = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    // e.g. bbc.co.uk / example.com.au
    if (labels.length >= 3 && ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'].includes(core) && labels[labels.length - 1].length === 2) {
      core = labels[labels.length - 3];
    }
    // Keep meaningful subdomains for big platforms (mail.google.com -> "Google Mail")
    const sub = labels.length >= 3 ? labels[0] : '';
    const base = known[core] || cap(core);
    if (sub && ['mail', 'drive', 'docs', 'calendar', 'maps', 'photos', 'music', 'news'].includes(sub)) {
      return `${base} ${cap(sub)}`;
    }
    return base;
  },

  /**
   * Primary Favicon API URL (Google Favicon API). Empty for non-web URLs (letter avatar is used instead).
   */
  getFaviconUrl(url) {
    if (this.isSpecialUrl(url)) return '';
    const hostname = this.getHostname(url);
    if (!hostname) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
  },

  /**
   * Deterministic background color generator for letter avatars based on name/hostname.
   */
  getAvatarColor(str) {
    const colors = [
      '#1a73e8', '#d93025', '#f9ab00', '#1e8e3e',
      '#a142f4', '#e37400', '#007b83', '#681da8',
      '#b06000', '#188038', '#12b5cb', '#fa7b17'
    ];
    const safeStr = String(str || 'default');
    let hash = 0;
    for (let i = 0; i < safeStr.length; i++) {
      hash = safeStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  },

  /**
   * Generate letter avatar element.
   */
  createLetterAvatar(name, hostname) {
    const char = (name || hostname || '?').charAt(0).toUpperCase();
    const bg = this.getAvatarColor(name || hostname || 'default');
    
    const element = document.createElement('div');
    element.className = 'shortcut-icon-letter';
    element.style.backgroundColor = bg;
    element.textContent = char;
    return element;
  }
};
