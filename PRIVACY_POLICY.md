# Privacy Policy for Shortcut+ Chrome Extension

**Last Updated:** September 13, 2026

Shortcut+ ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy outlines how the Shortcut+ Chrome Extension operates and details our strict data protection principles.

---

## 1. Core Principle: Zero Personal Data Collection
Shortcut+ is engineered as a **100% local, privacy-first productivity tool**:
* **We do NOT collect, store, transmit, sell, or rent any personal data.**
* **We do NOT track your browsing history, analytics, keystrokes, or unique personal identifiers.**
* All shortcuts, custom layouts, profiles, and visual preferences remain strictly on your local device.

---

## 2. Information Handled Locally

Shortcut+ utilizes standard browser APIs exclusively on your device:

* **Local Storage (`chrome.storage.local` & `unlimitedStorage`):** 
  Shortcut+ saves your custom shortcuts, free-form coordinates, active workspaces, custom wallpaper choices, and local search history on your machine. The `unlimitedStorage` permission ensures your custom themes and extensive shortcut layouts can be saved locally without hitting browser quota restrictions. This data never leaves your computer and is inaccessible to us or any third party.
* **Chrome Search API (`search` permission):**
  Shortcut+ uses the official `chrome.search.query` API to execute user-initiated web searches strictly via your chosen default browser search engine (Google, Bing, DuckDuckGo, Ecosia, etc.). Shortcut+ does not modify, track, or intercept your default search provider or search queries.

---

## 3. Network Requests & Third-Party Services

Shortcut+ does not operate any remote user databases or backend servers. It performs only the following direct network requests to provide user-requested features:

1. **Favicon Retrieval (`https://www.google.com/s2/favicons`):**
   When you create a shortcut, the extension requests the website's public icon from Google's public favicon service. If unavailable, an offline letter avatar is generated locally.
2. **Daily Wallpaper (`https://images.unsplash.com/*`):**
   If you explicitly choose the "Unsplash Daily" wallpaper mode, the extension loads a curated daily wallpaper directly from Unsplash.

---

## 4. Chrome Web Store Compliance & Limited Use Disclosure

In compliance with the Google Chrome Web Store Developer Program Policies:
* **No Sale of Data:** We never sell, transfer, or license user data or search queries to third parties, data brokers, or advertising networks.
* **Single Purpose:** All data handled by Shortcut+ is used solely to provide and improve its core single purpose: a customizable New Tab visual workspace.
* **No Credit/Lending Evaluation:** User data is never used or transferred to determine creditworthiness or for lending purposes.

---

## 5. Data Control & Deletion

* **Full User Ownership:** You have complete control over all data stored by Shortcut+.
* **Instant Removal:** You can edit or delete individual shortcuts, clear search history, or reset workspaces at any time.
* **Complete Uninstallation:** Uninstalling the Shortcut+ extension from Chrome permanently removes all locally stored extension data immediately.

---

## 6. Contact Us

If you have questions, feedback, or need support regarding this Privacy Policy, please contact us:
* **GitHub Repository:** [https://github.com/Treasure-king/shortcut-plus](https://github.com/Treasure-king/shortcut-plus)
* **Issue Tracker:** [https://github.com/Treasure-king/shortcut-plus/issues](https://github.com/Treasure-king/shortcut-plus/issues)
