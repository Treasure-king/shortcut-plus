/* favicon.js - Favicon resolver and letter avatar fallback */

const FaviconResolver = {
  /**
   * Ensure URL starts with valid protocol.
   */
  normalizeUrl(rawUrl) {
    if (!rawUrl) return '';
    let url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    return url;
  },

  /**
   * Extract hostname safely from URL.
   */
  getHostname(url) {
    try {
      const normalized = this.normalizeUrl(url);
      const parsed = new URL(normalized);
      return parsed.hostname.replace(/^www\./i, '');
    } catch (e) {
      return url || '';
    }
  },

  /**
   * Primary Favicon API URL (Google Favicon API).
   */
  getFaviconUrl(url) {
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
