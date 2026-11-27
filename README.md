# InkRealm 2.0 — Complete Web Novel Hosting Platform, Auto-Fetcher & Publisher

## What's Inside This Package
- **`site/`** — Full responsive web novel hosting platform (Discover Carousel, Tri-State Multi-Tag Search, Top Charts/Rankings, Novel Detail with 5-Dimension Ratings & Lore Codex, Distraction-Free Reader with 5 Themes, Auto-Scroll, Text-to-Speech, Paragraph Quote Highlights, Offline eBook Export, Personal Library & Analytics, and Browser Studio with 1-Click GitHub Sync).
- **`publisher_app/auto_fetch_novels.py`** — Zero-dependency Python 3 automated novel fetcher that pulls top popular (`best`) and newest (`newest` / `mixed`) public-domain novels from **Project Gutenberg (Gutendex API)** and **Open Library / Internet Archive**, strips license boilerplate & OCR noise, splits chapters cleanly, checks quality (`>= 2` chapters, `>= 2,500` words, English text), deduplicates via `fetched_registry.json`, downloads covers (or generates SVG covers), and rebuilds site data.
- **`.github/workflows/auto-fetch-novels.yml`** — GitHub Actions workflow that runs automatically **every day at 04:00 UTC** (plus manual 1-click "Run workflow" button inside GitHub with custom `source`, `mode`, `limit`, and `topic` inputs) and pushes directly to your repo, auto-redeploying your live subdomain.
- **`publisher_app/novel_publisher.py`** — Desktop GUI + CLI + Watch-Folder publisher for adding your own `.txt`, `.md`, `.docx`, `.epub`, `.html`, `.json`, or chapter folders.
- **`ANTIGRAVITY_DEPLOY_PROMPT.txt`** — Copy-paste prompt for one-time Antigravity setup & subdomain deployment.

## How to Run Everything (Zero Antigravity Needed After Initial Deploy)

### 1. Fully Automatic Daily Fetching (Hands-Free)
Once pushed to GitHub, **GitHub Actions** runs `.github/workflows/auto-fetch-novels.yml` every day automatically. You can also open your GitHub repo -> **Actions** -> **Auto-Fetch Public-Domain Novels** -> **Run workflow** anytime to fetch extra books on demand.

### 2. Fetch Public-Domain Novels Manually on Your PC
- Double-click **`AUTO_FETCH_NOW.bat`** (Mac/Linux: `./auto_fetch_now.sh`), OR run:
  ```bash
  python publisher_app/auto_fetch_novels.py --source both --mode mixed --limit 5 --deploy
  ```
- Optional flags:
  - `--source gutenberg|openlibrary|both`
  - `--mode mixed|best|newest`
  - `--limit 5`
  - `--topic fantasy` (optional specific topic)
  - `--dry-run` (test without modifying files)

### 3. Add Your Own Modern Webnovels
- **Desktop GUI**: Double-click **`START_PUBLISHER_GUI.bat`** (Mac/Linux: `./start_publisher.sh`) — also includes an **"Auto-Fetch Online"** button!
- **Drop-in-Folder**: Drop `.epub`, `.docx`, `.txt`, or chapter folders into **`incoming_novels/`** and double-click **`AUTO_IMPORT_AND_DEPLOY.bat`**.
- **In-Browser**: Open your live website -> **Studio & Publisher** -> **1-Click Live GitHub Sync**.
