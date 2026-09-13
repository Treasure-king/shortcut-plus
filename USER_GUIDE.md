# Shortcut+ — Comprehensive User Guide & Documentation

Welcome to **Shortcut+**! This guide covers all keyboard shortcuts, mouse launch gestures, features, and setup instructions (including enabling private Incognito browsing).

---

## 🕶️ 1. Incognito Mode Setup Guide

Google Chrome restricts all extensions from operating in Incognito mode by default for privacy reasons. To enable **Alt + Click** to launch shortcuts directly in private Incognito windows, follow these simple one-time setup steps:

### Step-by-Step Instructions:
1. Open Google Chrome.
2. In the address bar, type `chrome://extensions` and press **Enter** (or right-click the Shortcut+ icon in your toolbar and select **Manage Extension**).
3. Locate **Shortcut+** and click the **Details** button.
4. Scroll down to the setting labeled **"Allow in Incognito"**.
5. Switch the toggle to **ON** (Blue).

> [!NOTE]
> **Privacy Reassurance**: Chrome displays the standard alert: *"Google Chrome cannot prevent extensions from recording your browsing history."* Shortcut+ does **not** track, record, or transmit your browsing history. It only requires this permission to create `chrome.windows.create({ incognito: true })` private windows when you ask it to!

---

## 🚀 2. Shortcut Launch Triggers & Mouse Gestures

Every shortcut tile on your New Tab page supports multi-tier launching:

| Trigger | Modifier / Gesture | Destination / Action |
| :--- | :--- | :--- |
| **Normal Launch** | Left Click | Opens URL in the **current tab** (`_self`) |
| **New Tab** | `Ctrl + Click` (Windows/Linux)<br>`⌘ + Click` (macOS) | Opens URL in a **new background tab** |
| **New Window** | `Ctrl + Shift + Click`<br>`⌘ + Shift + Click` | Opens URL in a brand new, dedicated **Chrome window** |
| **Incognito Window** | `Alt + Click` (or `Ctrl + Alt + Click`) | Opens URL in a private **Incognito window** |
| **Middle Click** | Scroll Wheel Click (`auxclick`) | Opens URL in a **new tab** (`Alt + Middle-Click` for Incognito) |
| **Batch Launch Selected** | Click any selected card / Toolbar / Enter | When multiple shortcuts are selected:<br>• **Click** or `Ctrl+Click`: Opens **all selected in New Tabs**<br>• `Ctrl+Shift+Click`: Opens **all selected in a New Window**<br>• `Alt+Click` / `Ctrl+Alt+Click`: Opens **all selected in an Incognito Window**<br>• `Shift+Click`: Toggles selection (deselects card) |
| **Quick Action Menu** | Click the **3-dots button** (`⋮`) | Opens floating menu: New Tab, New Window, Incognito, Edit, Copy URL, Delete |

---

## ⌨️ 3. Workspace Hotkeys & Keyboard Navigation

Shortcut+ includes a comprehensive productivity matrix that allows you to control your entire New Tab page without touching your mouse.

### Global Productivity Hotkeys:
*Press these keys while on your New Tab page (when not typing in a text field):*

- <kbd>N</kbd> or <kbd>Alt + N</kbd>: **Add New Shortcut** — Opens the Add Shortcut modal.
- <kbd>E</kbd> or <kbd>Alt + E</kbd>: **Edit Layout Mode** — Toggles drag-and-drop, spatial repositioning, and alignment guides.
- <kbd>G</kbd> or <kbd>Alt + G</kbd>: **Create Category Group** — Organizes shortcuts into folders.
- <kbd>M</kbd> or <kbd>Alt + M</kbd>: **Multi-Select Mode** — Batch select shortcuts to inspect, resize, or delete together.
- <kbd>R</kbd> or <kbd>Alt + R</kbd>: **Play Shortcut Runner** — Opens the offline endless runner arcade mini-game.
- <kbd>S</kbd>, <kbd>Alt + S</kbd>, or <kbd>Ctrl + ,</kbd>: **Settings & Customization** — Opens themes, wallpapers, component toggles, and profiles.
- <kbd>Ctrl + K</kbd> or <kbd>/</kbd>: **Search Focus** — Jumps cursor into the Google Search bar with live autocomplete and instant tile filtering.
- <kbd>Esc</kbd>: **Dismiss** — Closes any active modal dialog, slide-over drawer, dropdown menu, or search suggestion popup.

### 2D Matrix Arrow Navigation:
- <kbd>←</kbd> <kbd>↑</kbd> <kbd>→</kbd> <kbd>↓</kbd>: Navigate through your shortcuts grid seamlessly.
- <kbd>Enter</kbd>: Launch the currently highlighted shortcut in current tab (or if **multiple shortcuts are selected**, opens all selected shortcuts in **New Tabs**!).
- <kbd>Ctrl + Enter</kbd>: Launch focused shortcut in a **New Tab** (or open all selected shortcuts in **New Tabs**).
- <kbd>Ctrl + Shift + Enter</kbd> or <kbd>Shift + Enter</kbd>: Launch focused shortcut in a **New Window** (or open all selected shortcuts in a dedicated **New Window**).
- <kbd>Alt + Enter</kbd>: Launch focused shortcut in an **Incognito Window** (or open all selected shortcuts in a private **Incognito Window**).

### Photoshop-Style Arrow Nudging (Edit Mode):
- In **Edit Mode** (<kbd>E</kbd>) and **Free Placement Mode**, select any shortcut(s) and use the arrow keys to nudge them pixel-by-pixel.
- Hold <kbd>Shift + Arrow</kbd> to nudge by **10 pixels** at a time with live coordinate tooltips.

---

## 🛠️ 4. Core Features & How to Use

### 1. Dual Layout Engines: Smart Grid vs. Free Placement
- **Smart Grid Mode**: An auto-centering, responsive layout with fluid grid wrapping that automatically organizes your tiles symmetrically on screens of any size.
- **Free Placement Mode**: Allows you to position shortcuts, category folders, the Google Logo, and the Google Search bar anywhere on your screen.
- **Smart Snap Distance Rays**: When dragging in Free Placement Mode, smart Photoshop-style SVG guide lines display equal distance spacing between adjacent cards.
- Hold <kbd>Shift</kbd> while dragging to lock movement strictly to 90° horizontal or vertical axes.
- **Photoshop-Style Marquee Drag Selection**: In Edit Mode (<kbd>E</kbd>), click and drag anywhere on empty background space to draw a rectangular selection box (dashed blue border with translucent glow). All shortcuts touching or enclosed by the box are instantly selected!
  - Hold <kbd>Shift</kbd> or <kbd>Ctrl</kbd> while dragging to add cards to your existing selection.
  - Click on empty space without dragging to quickly deselect all.
- **Photoshop-Style Multi-Tile Group Drag**: Once multiple shortcuts are selected, click and drag *any* of the selected shortcuts with your mouse. All selected shortcuts move together across the screen in lockstep with real-time elevation shadows and smart alignment snapping!
  - Release mouse anywhere on the canvas to save their new positions.
  - Drag and drop them over any category group section to instantly reassign all selected shortcuts to that group!

### 2. Multi-Select Batch Launching & Operations
- **Selecting Multiple Shortcuts**:
  - Press <kbd>M</kbd> to activate Multi-Select Mode and click any cards or their checkboxes.
  - In Edit Mode (<kbd>E</kbd>), use the rectangular marquee drag on background space to lasso multiple cards.
  - Hold <kbd>Shift</kbd> and click multiple cards to add/remove them from selection.
  - Use **Select All** in the floating action bar or inspector drawer.
- **Batch Launching Options**:
  - **Open Selected Button**: Click the button in the Floating Action Bar or Inspector Drawer.
    - Plain Click: Opens all selected in **New Tabs**.
    - <kbd>Shift + Click</kbd>: Opens all selected in a **New Window** (all tabs in one single window).
    - <kbd>Alt + Click</kbd>: Opens all selected in an **Incognito Window** (all tabs in one private window).
  - **Click Any Selected Tile**: When multiple shortcuts are selected, clicking on any one of the selected cards immediately launches all selected shortcuts:
    - Normal Click or <kbd>Ctrl + Click</kbd>: Opens all selected in **New Tabs**.
    - <kbd>Ctrl + Shift + Click</kbd>: Opens all selected in a dedicated **New Window**.
    - <kbd>Alt + Click</kbd> or <kbd>Ctrl + Alt + Click</kbd>: Opens all selected in a private **Incognito Window**.
    - <kbd>Middle-Click</kbd>: Opens all selected in **New Tabs** (<kbd>Shift + Middle-Click</kbd> for New Window, <kbd>Alt + Middle-Click</kbd> for Incognito).
    - <kbd>Shift + Click</kbd>: Toggles selection off for that individual card without launching.
  - **Keyboard Hotkeys**: Press <kbd>Enter</kbd> to open all selected in New Tabs, <kbd>Shift + Enter</kbd> for New Window, or <kbd>Alt + Enter</kbd> for Incognito.

### 3. Category Groups & Folders
- Click **+ Group** (<kbd>G</kbd>) to organize shortcuts into labeled sections (e.g., *Development*, *Work*, *Social*, *Entertainment*).
- **Collapse / Expand**: Click any group header to collapse or expand the section.
- **Batch Launch All**: Click the launch icon in the group header to open all group shortcuts at once.
  - Click: Opens all in new tabs.
  - <kbd>Shift + Click</kbd>: Opens all in a new window (grouped in one window).
  - <kbd>Alt + Click</kbd>: Opens all in an incognito window (grouped in one private window).

### 4. Workspace Profiles (Up to 8 Profiles)
- Switch contexts effortlessly (e.g., *Work*, *Personal*, *Dev Mode*) using the header dropdown or the sidebar drawer.
- Each profile maintains its own shortcuts, category groups, layout positions, and custom wallpaper.

### 5. Wallpapers, Glassmorphism & Themes
- **Spatial Dev Presets**: 4 curated spatial desk setups (*Boy Dev Cozy Desk*, *Girl Dev Studio*, *Night Loft*, *Sunset Room*).
- **Ambient Themes**: Cyberpunk Neon Rain, Lo-Fi Evening, Deep Space Glass, Unsplash Daily HD.
- **Custom Media**: Upload your own image, GIF, or looping MP4/WebM video wallpaper.
- **Contrast Sliders**: Fine-tune label text color, card background tint, card opacity (0–100%), and frosted glass blur (0–40px) in the Settings drawer.

### 6. Google Apps Waffle Menu
- Click the 9-dots waffle button in the top-right header to access 18+ official Google Workspace applications (Gmail, Drive, Docs, Sheets, Gemini, YouTube, Calendar, Photos, and more).

### 7. Shortcut Runner (Offline Endless Arcade Game)
- Inspired by the legendary Google Chrome Dinosaur game, **Shortcut Runner** is an instant offline arcade game built directly into Shortcut+.
- **How to Play**: Click the 🎮 header button, open it from the sidebar drawer, or press <kbd>R</kbd>.
- **Your Bookmarks as Obstacles**: Obstacles are dynamically populated from your actual shortcuts (with real favicons and titles).
- **Controls**:
  - <kbd>Space</kbd> or <kbd>↑</kbd>: Jump (tap in mid-air for **Double Jump**).
  - <kbd>↓</kbd>: Fast drop / duck under floating drone shortcuts.
  - <kbd>C</kbd>: Cycle Mascot Skins (Volt Cyan, Neon Synth, Stealth Gold).
  - <kbd>F</kbd>: Toggle Fullscreen Mode.
  - <kbd>P</kbd>: Pause / Resume.
  - <kbd>M</kbd>: Mute / Unmute 8-bit sound effects.
  - <kbd>Esc</kbd>: Exit game instantly back to your workspace.
- **Power-Ups**:
  - ☕ **Espresso Slow-Mo**: Slows down game physics for 5 seconds.
  - ⭐ **Invincible Shield**: Lets you smash right through shortcuts with explosive particle sparks (+50 bonus points per smash).
  - 🪙 **Focus Coin**: Grants +50 bonus points.
- **Persistent High Scores**: Track and save your highest score per workspace profile.
- **Zero File Bloat**: 100% lightweight HTML5 Canvas and browser Web Audio API synthesis (0 KB audio/image files).

---

## ❓ 5. Frequently Asked Questions (FAQ)

#### Q: Why doesn't Alt+Click open in Incognito mode?
**A:** Chrome requires you to manually check the **"Allow in Incognito"** toggle for Shortcut+ in `chrome://extensions`. See [Section 1](#1-incognito-mode-setup-guide) above for the quick 4-step setup.

#### Q: How do I move or resize the Google Logo and Search Bar?
**A:** Press <kbd>E</kbd> to enter **Edit Layout Mode**, switch to **Free Placement**, and drag the handle on the logo or search bar. You can also resize them using their corner resize handles.

#### Q: How can I back up my shortcuts?
**A:** Open Settings (<kbd>S</kbd>), scroll down to **Backup & Restore**, and click **Export**. This saves your entire setup as a portable JSON file that you can import at any time.
