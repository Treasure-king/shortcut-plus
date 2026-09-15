# Shortcut+ 🚀
> **Unlimited, Customizable, and Organized Google-Style New Tab Shortcuts.**

**Shortcut+** is a lightweight, Manifest V3 Chrome Extension that transforms Chrome's default New Tab page into an unlimited, highly customizable, and beautifully organized workspace grid.

It preserves Google’s clean New Tab aesthetic while removing its built-in limitations.

---

## ✨ Features

### 1. ♾️ Unlimited Shortcuts
- Bypasses Chrome’s native 10-shortcut cap. Add 20, 50, 100+ shortcuts with zero performance lag.
- Automatic high-resolution favicon and site title fetching with generated letter fallbacks.

### 2. 🗂️ Category Groups & 1-Click "Launch All"
- Organize shortcuts into custom collapsible categories (e.g. *Frontend*, *Cloud*, *Social*, *Dev Tools*).
- **One-Click Group Launch**: Click the "Launch All" button on any category header to open all shortcuts in that group as browser tabs simultaneously.
- Rename category groups inline by double-clicking the group title or clicking the pencil edit button.

### 3. 👤 Workspace Profiles (Up to 8 Isolated Layouts)
- Toggle between dedicated workspace layouts in 1 click (e.g. **Default**, **Work Mode**, **Personal Mode**, **Developer Mode**, or custom profiles).
- Each profile maintains its own isolated shortcuts and category groups.
- **Import Shortcuts Across Profiles**: Easily copy selected shortcuts from one workspace profile to another.

### 4. 🧹 Multi-Select Batch Delete Mode
- Toggle Multi-Select mode from the floating layout toolbar.
- Interactive checkboxes appear on shortcut tiles to select multiple items.
- Batch remove selected shortcuts with confirmation in a single click.

### 5. 🎯 Dual Layout Modes
- **Smart Snap Grid**: Automatic alignment keeping tiles organized in clean horizontal rows.
- **Free Placement Mode**: Drag and position shortcut cards anywhere on your screen.

### 6. 🎨 Custom Wallpapers & Dark Glassmorphism Theme
- **Unsplash Daily HD Wallpaper**: Auto-fetches curated high-definition backgrounds daily.
- **Dark Glassmorphism**: Translucent glass-morphic UI cards paired with an ambient glowing gradient mesh.
- **Custom Image Upload**: Set any custom background image URL.
- **Light / Dark Mode Sync**: Supports automatic OS system theme synchronization.

### 7. 📱 Tile Presentation Styles
- **Standard Grid Tile**: Classic 112px Google New Tab card layout.
- **Compact Pill View**: Space-saving 36px horizontal badge view.
- **Minimal Text List**: Ultra-clean text-only listing.

### 8. 💾 Backup & Restore
- Export your layout and shortcuts to JSON files for quick backup.
- Restore or migrate layouts seamlessly across computers or browser profiles.

---

## 🛠️ Tech Stack & Architecture

- **Manifest Version**: Manifest V3 (Chrome Web Store Compliant)
- **Frontend**: Vanilla JavaScript (ES6+), HTML5, Vanilla CSS3 (CSS Variables & Flexbox/Grid)
- **Storage Engine**: `chrome.storage.sync` with `chrome.storage.local` fallback
- **Dependencies**: 0 External Libraries (Zero bloat, instant ~15ms page loads)
- **Permissions**: Minimal `["storage"]` permission requested for privacy and security.

---

## 📥 Installation Guide

### Option 1: Load Unpacked (Developer Mode)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/Treasure-king/shortcut-plus.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner toggle.
4. Click **Load unpacked** in the top-left menu.
5. Select the `shortcut+` project directory.
6. Open a new tab in Chrome to enjoy **Shortcut+**!

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + K` or `/` | Focus search bar to filter shortcuts or search the web |
| `Escape` | Close active modals or exit layout edit mode |
| `Enter` | Open selected shortcut card or trigger search |

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
