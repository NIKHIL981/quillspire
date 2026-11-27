# InkRealm 2.0 — Complete Web Novel Hosting Platform & Auto-Publisher

## What's Inside This Package
- **`site/`** — Full responsive web novel hosting platform (Discover, Hero Carousel, Advanced Multi-Tag Include/Exclude Search, Rankings/Top Charts, Novel Detail with 5-Dimension Ratings & Lore Codex, Distraction-Free Reader with 5 Themes, Auto-Scroll, Text-to-Speech, Paragraph Quote Highlights, Offline eBook Export, Personal Library & Analytics, and Browser Author Studio with 1-Click GitHub Sync).
- **`publisher_app/novel_publisher.py`** — Standalone zero-dependency Python 3 program (Desktop GUI + CLI + Watch-Folder Auto-Pilot) that converts `.txt`, `.md`, `.docx`, `.epub`, `.html`, `.json`, or folders of chapter files into perfectly formatted website novels with automatic chapter splitting, cover art generation, SEO sitemap rebuild, and 1-click Git live deployment!
- **`incoming_novels/`** — Drop any novel file or chapter folder here and run `AUTO_IMPORT_AND_DEPLOY.bat`.
- **`ANTIGRAVITY_DEPLOY_PROMPT.txt`** — Copy-paste prompt for one-time Antigravity setup (creates unique subdomain, links GitHub auto-deploy, uploads site).

## How to Add Novels Without Using Antigravity (3 Easy Ways)

### Way 1: Desktop App (Easiest — 100% Automatic)
1. Double-click **`START_PUBLISHER_GUI.bat`** (Mac/Linux: `./start_publisher.sh`).
2. Pick any `.txt`, `.md`, `.docx`, `.epub` file OR a folder full of chapter files.
3. Check **"Automatically Git Push Live"** and click **Add Novel to Website**. Done! Your live website updates in ~20 seconds.

### Way 2: Drop-in-Folder Auto-Pilot
1. Drop any novel file(s) or folders into **`incoming_novels/`**.
2. Double-click **`AUTO_IMPORT_AND_DEPLOY.bat`** (or run `python publisher_app/novel_publisher.py --watch --deploy` to keep it running in the background!).

### Way 3: Directly Inside Your Live Website Browser
1. Open your live website -> click **Studio & Publisher**.
2. Enter your GitHub Repo & Personal Access Token once under **1-Click Live GitHub Sync**.
3. Drag & drop any novel file right in your browser -> click **Publish & Auto-Push Live to GitHub**!
