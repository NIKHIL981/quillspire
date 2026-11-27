#!/usr/bin/env python3
"""
InkRealm Auto-Publisher v2.0
Zero-dependency Python 3 program (GUI + CLI + Watch-Folder + Auto-Git Deploy)
Add novels (.txt, .md, .docx, .epub, .html, .json, or chapter folders) directly
to your live website WITHOUT needing Antigravity!

Usage:
  python publisher_app/novel_publisher.py                        # Opens Desktop GUI
  python publisher_app/novel_publisher.py --scan                 # Batch import everything in incoming_novels/
  python publisher_app/novel_publisher.py --scan --deploy        # Batch import + git push live!
  python publisher_app/novel_publisher.py --watch --deploy       # Auto-pilot watch folder!
  python publisher_app/novel_publisher.py --add "book.epub"      # Import a single file or folder
  python publisher_app/novel_publisher.py --rebuild              # Rebuild catalog.json, bundle.js & sitemap.xml
  python publisher_app/novel_publisher.py --serve                # Start local preview server on port 8080
"""

import argparse
import html
import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

# Resolve project root regardless of where script is invoked from
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
SITE_DIR = PROJECT_ROOT / "site"
DATA_DIR = SITE_DIR / "data"
NOVELS_DIR = DATA_DIR / "novels"
COVERS_DIR = SITE_DIR / "assets" / "covers"
INCOMING_DIR = PROJECT_ROOT / "incoming_novels"
PROCESSED_DIR = PROJECT_ROOT / "processed_novels"

for _d in [SITE_DIR, DATA_DIR, NOVELS_DIR, COVERS_DIR, INCOMING_DIR, PROCESSED_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

PALETTES = {
    "Xianxia": ("#0f172a", "#312e81", "#f59e0b", "#fde68a"),
    "LitRPG": ("#090d16", "#064e3b", "#10b981", "#a7f3d0"),
    "Fantasy": ("#1e1b4b", "#581c87", "#c084fc", "#f3e8ff"),
    "Sci-Fi": ("#020617", "#0c4a6e", "#38bdf8", "#e0f2fe"),
    "Mystery": ("#18181b", "#450a0a", "#ef4444", "#fecaca"),
    "Romance": ("#3b0764", "#831843", "#f472b6", "#fce7f3"),
    "Slice of Life": ("#14532d", "#0f766e", "#fbbf24", "#fef3c7"),
    "Steampunk": ("#292524", "#78350f", "#f97316", "#ffedd5"),
    "Horror": ("#09090b", "#3f0f1d", "#e11d48", "#ffe4e6"),
    "Historical": ("#1c1917", "#573619", "#d97706", "#fef3c7"),
}

CHAPTER_REGEX = re.compile(
    r"^(?:#{1,3}\s+)?"
    r"(?:(?:chapter|ch\.?|part|episode|book|act|arc|volume|vol\.?)\s*"
    r"(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b.*|"
    r"prologue\b.*|epilogue\b.*|interlude\b.*|"
    r"第[\d一二三四五六七八九十百千万零两]+[章回节部].*)$",
    re.IGNORECASE | re.MULTILINE,
)


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.in_ignore = False
        self.first_heading = ""
        self._in_h = False

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in ("script", "style", "head"):
            self.in_ignore = True
        elif tag in ("p", "div", "br", "li", "blockquote", "h1", "h2", "h3", "h4"):
            self.parts.append("\n\n")
        if tag in ("h1", "h2", "h3") and not self.first_heading:
            self._in_h = True

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ("script", "style", "head"):
            self.in_ignore = False
        if tag in ("h1", "h2", "h3"):
            self._in_h = False

    def handle_data(self, data):
        if self.in_ignore:
            return
        if self._in_h and not self.first_heading and data.strip():
            self.first_heading = data.strip()
        self.parts.append(data)


def html_to_text(raw_html):
    parser = _TextExtractor()
    parser.feed(raw_html)
    text = "".join(parser.parts)
    return clean_text(text), parser.first_heading


def clean_text(text):
    text = html.unescape(text or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", (name or "untitled").lower()).strip("-")
    return s or f"novel-{int(time.time())}"


def natural_key(path_or_str):
    s = str(path_or_str)
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def count_words(text):
    return len(re.findall(r"\b\w+\b", text or ""))


def generate_svg_cover(title, author, genre, slug):
    c1, c2, acc, light = PALETTES.get(genre, ("#0f172a", "#1e293b", "#6366f1", "#e0e7ff"))
    words = (title or "Untitled").split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) <= 15:
            cur = (cur + " " + w).strip()
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    lines = lines[:4]
    y_start = 220 - (len(lines) - 1) * 20
    title_svg = "\n".join(
        f'  <text x="200" y="{y_start + i*44}" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="34" fill="#ffffff">{html.escape(ln)}</text>'
        for i, ln in enumerate(lines)
    )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="400" height="600">\n'
        '  <defs>\n'
        f'    <linearGradient id="bg-{slug}" x1="0" y1="0" x2="1" y2="1">\n'
        f'      <stop offset="0%" stop-color="{c1}"/><stop offset="60%" stop-color="{c2}"/><stop offset="100%" stop-color="{c1}"/>\n'
        '    </linearGradient>\n'
        f'    <radialGradient id="glow-{slug}" cx="50%" cy="35%" r="55%">\n'
        f'      <stop offset="0%" stop-color="{acc}" stop-opacity="0.38"/><stop offset="100%" stop-color="{c1}" stop-opacity="0"/>\n'
        '    </radialGradient>\n'
        '  </defs>\n'
        f'  <rect width="400" height="600" fill="url(#bg-{slug})"/>\n'
        f'  <rect width="400" height="600" fill="url(#glow-{slug})"/>\n'
        f'  <rect x="18" y="18" width="364" height="564" rx="10" fill="none" stroke="{acc}" stroke-opacity="0.45" stroke-width="1.5"/>\n'
        f'  <circle cx="200" cy="115" r="38" fill="none" stroke="{acc}" stroke-width="1.5" stroke-opacity="0.7"/>\n'
        f'  <polygon points="200,82 210,108 236,115 210,122 200,148 190,122 164,115 190,108" fill="{acc}" fill-opacity="0.85"/>\n'
        f'{title_svg}\n'
        f'  <line x1="110" y1="395" x2="290" y2="395" stroke="{acc}" stroke-opacity="0.5" stroke-width="1.2"/>\n'
        f'  <rect x="120" y="420" width="160" height="28" rx="14" fill="{acc}" fill-opacity="0.2" stroke="{acc}" stroke-opacity="0.5"/>\n'
        f'  <text x="200" y="439" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="{light}" letter-spacing="2">{html.escape((genre or "NOVEL").upper())}</text>\n'
        f'  <text x="200" y="538" text-anchor="middle" font-family="Georgia, serif" font-size="20" font-weight="600" fill="#ffffff">{html.escape(author or "Author")}</text>\n'
        '</svg>'
    )
    out = COVERS_DIR / f"{slug}.svg"
    out.write_text(svg, encoding="utf-8")
    return f"assets/covers/{slug}.svg"


def split_chapters_smart(raw_text):
    text = clean_text(raw_text)
    matches = [m for m in CHAPTER_REGEX.finditer(text) if len(m.group(0).strip()) <= 120]
    if not matches:
        return [{"title": "Chapter 1", "volume": "Volume 1", "content": text}] if text else []

    chapters = []
    lead = text[: matches[0].start()].strip()
    if len(lead) > 200:
        chapters.append({"title": "Prologue", "volume": "Volume 1", "content": lead})

    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        title = re.sub(r"^#{1,3}\s+", "", m.group(0)).strip()
        if body:
            chapters.append({"title": title, "volume": "Volume 1", "content": body})
    return chapters


def parse_docx(path: Path):
    with zipfile.ZipFile(path, "r") as z:
        xml_bytes = z.read("word/document.xml")
    root = ET.fromstring(xml_bytes)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paras = []
    for p in root.findall(".//w:p", ns):
        txt = "".join(t.text for t in p.findall(".//w:t", ns) if t.text)
        if txt.strip():
            paras.append(txt.strip())
    return "\n\n".join(paras)


def parse_epub(path: Path):
    meta = {
        "title": path.stem.replace("_", " ").replace("-", " ").title(),
        "author": "Unknown Author",
        "synopsis": "",
        "cover_bytes": None,
        "cover_ext": None,
    }
    chapters = []
    with zipfile.ZipFile(path, "r") as z:
        container = ET.fromstring(z.read("META-INF/container.xml"))
        rootfile = None
        for elem in container.iter():
            if elem.tag.endswith("rootfile"):
                rootfile = elem.attrib.get("full-path")
                break
        if not rootfile:
            raise ValueError("Invalid EPUB: missing rootfile")

        opf_dir = rootfile.rsplit("/", 1)[0] + "/" if "/" in rootfile else ""
        opf = ET.fromstring(z.read(rootfile))

        manifest = {}
        spine_ids = []
        cover_id = None

        for elem in opf.iter():
            tag = elem.tag.split("}")[-1].lower()
            if tag == "title" and elem.text and elem.text.strip():
                meta["title"] = elem.text.strip()
            elif tag == "creator" and elem.text and elem.text.strip():
                meta["author"] = elem.text.strip()
            elif tag == "description" and elem.text and elem.text.strip():
                meta["synopsis"], _ = html_to_text(elem.text)
            elif tag == "meta" and elem.attrib.get("name") == "cover":
                cover_id = elem.attrib.get("content")
            elif tag == "item":
                iid = elem.attrib.get("id")
                href = elem.attrib.get("href")
                props = elem.attrib.get("properties", "")
                if iid and href:
                    manifest[iid] = href
                if "cover-image" in props and href:
                    cover_id = iid
            elif tag == "itemref":
                idref = elem.attrib.get("idref")
                if idref:
                    spine_ids.append(idref)

        if cover_id and cover_id in manifest:
            cover_path = urllib.parse.unquote(opf_dir + manifest[cover_id])
            if cover_path in z.namelist():
                meta["cover_bytes"] = z.read(cover_path)
                meta["cover_ext"] = Path(cover_path).suffix.lower() or ".jpg"

        for idref in spine_ids:
            href = manifest.get(idref)
            if not href:
                continue
            full_path = urllib.parse.unquote(opf_dir + href)
            if full_path not in z.namelist():
                continue
            raw = z.read(full_path).decode("utf-8", errors="ignore")
            body, heading = html_to_text(raw)
            if len(body) < 80:
                continue
            title = heading if (heading and len(heading) <= 100) else f"Chapter {len(chapters) + 1}"
            chapters.append({"title": title, "volume": "Volume 1", "content": body})

    return meta, chapters


def parse_header_metadata(text):
    meta = {}
    lines = text.splitlines()
    end_idx = -1
    for i, ln in enumerate(lines[:15]):
        if ln.strip() == "---":
            end_idx = i
            break
        m = re.match(r"^(title|author|genre|status|tags|synopsis|rating|featured)\s*:\s*(.+)$", ln.strip(), re.I)
        if m:
            meta[m.group(1).lower()] = m.group(2).strip()
        elif i == 0:
            break
    if end_idx >= 0 and meta:
        body = "\n".join(lines[end_idx + 1 :]).strip()
        if "tags" in meta:
            meta["tags"] = [t.strip() for t in meta["tags"].split(",") if t.strip()]
        if "featured" in meta:
            meta["featured"] = meta["featured"].lower() in ("true", "yes", "1")
        return meta, body
    return {}, text


def import_novel_source(source_path: Path, overrides=None, append_to_slug=None):
    overrides = overrides or {}
    source_path = Path(source_path)
    meta = {
        "title": source_path.stem.replace("_", " ").replace("-", " ").strip(),
        "author": "Unknown Author",
        "genre": "Fantasy",
        "status": "Ongoing",
        "contentRating": "Teen",
        "tags": ["Web Novel"],
        "synopsis": "",
        "featured": False,
        "cover_file": None,
        "cover_bytes": None,
        "cover_ext": None,
    }
    chapters = []

    if source_path.is_dir():
        meta_json = source_path / "meta.json"
        if meta_json.exists():
            meta.update(json.loads(meta_json.read_text(encoding="utf-8")))
        for ext in (".jpg", ".jpeg", ".png", ".webp", ".svg"):
            cand = source_path / f"cover{ext}"
            if cand.exists():
                meta["cover_file"] = cand
                break
        ch_files = sorted(
            [f for f in source_path.iterdir() if f.is_file() and f.suffix.lower() in (".txt", ".md", ".docx", ".html", ".htm") and f.name.lower() != "readme.txt"],
            key=lambda p: natural_key(p.name),
        )
        for idx, cf in enumerate(ch_files, start=1):
            ext = cf.suffix.lower()
            if ext == ".docx":
                txt = parse_docx(cf)
            elif ext in (".html", ".htm"):
                txt, _ = html_to_text(cf.read_text(encoding="utf-8", errors="ignore"))
            else:
                txt = clean_text(cf.read_text(encoding="utf-8", errors="ignore"))
            if not txt:
                continue
            if len(ch_files) == 1:
                fm, body = parse_header_metadata(txt)
                meta.update(fm)
                chapters.extend(split_chapters_smart(body))
            else:
                ch_title = re.sub(r"^\d+[\s._-]+", "", cf.stem).replace("_", " ").strip() or f"Chapter {idx}"
                chapters.append({"title": ch_title, "volume": "Volume 1", "content": txt})
    else:
        ext = source_path.suffix.lower()
        if ext == ".json":
            data = json.loads(source_path.read_text(encoding="utf-8"))
            meta.update({k: v for k, v in data.items() if k != "chapters"})
            chapters = data.get("chapters", [])
        elif ext == ".epub":
            emeta, chapters = parse_epub(source_path)
            meta.update(emeta)
        elif ext == ".docx":
            raw = parse_docx(source_path)
            fm, body = parse_header_metadata(raw)
            meta.update(fm)
            chapters = split_chapters_smart(body)
        elif ext in (".html", ".htm"):
            raw, heading = html_to_text(source_path.read_text(encoding="utf-8", errors="ignore"))
            if heading:
                meta["title"] = heading
            chapters = split_chapters_smart(raw)
        else:
            raw = source_path.read_text(encoding="utf-8", errors="ignore")
            fm, body = parse_header_metadata(raw)
            meta.update(fm)
            chapters = split_chapters_smart(body)

    for k, v in overrides.items():
        if v not in (None, "", []):
            meta[k] = v

    if not chapters:
        raise ValueError(f"No readable chapters found in {source_path.name}")

    today = datetime.now().strftime("%Y-%m-%d")
    slug = append_to_slug or slugify(meta["title"])
    novel_file = NOVELS_DIR / f"{slug}.json"

    if novel_file.exists():
        existing = json.loads(novel_file.read_text(encoding="utf-8"))
        existing_titles = {c.get("title", "").strip().lower() for c in existing.get("chapters", [])}
        start_num = len(existing.get("chapters", [])) + 1
        added = 0
        for ch in chapters:
            if ch["title"].strip().lower() in existing_titles:
                continue
            wc = count_words(ch["content"])
            existing["chapters"].append({
                "id": f"{slug}-ch-{start_num + added}",
                "number": start_num + added,
                "volume": ch.get("volume", "Volume 1"),
                "title": ch["title"],
                "wordCount": wc,
                "readMinutes": max(1, round(wc / 230)),
                "publishedAt": today,
                "authorNoteTop": ch.get("authorNoteTop", ""),
                "authorNoteBottom": ch.get("authorNoteBottom", ""),
                "content": ch["content"],
                "reactions": {"fire": 0, "cry": 0, "mindblown": 0, "laugh": 0, "heart": 0},
                "comments": [],
            })
            added += 1
        existing["totalWords"] = sum(c.get("wordCount", 0) for c in existing["chapters"])
        existing["chapterCount"] = len(existing["chapters"])
        existing["updatedAt"] = today
        novel_file.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
        rebuild_site_index()
        return existing, added, True

    cover_rel = ""
    if overrides.get("cover_file") and Path(overrides["cover_file"]).exists():
        src_cov = Path(overrides["cover_file"])
        dest = COVERS_DIR / f"{slug}{src_cov.suffix.lower()}"
        shutil.copy2(src_cov, dest)
        cover_rel = f"assets/covers/{dest.name}"
    elif meta.get("cover_file") and Path(meta["cover_file"]).exists():
        src_cov = Path(meta["cover_file"])
        dest = COVERS_DIR / f"{slug}{src_cov.suffix.lower()}"
        shutil.copy2(src_cov, dest)
        cover_rel = f"assets/covers/{dest.name}"
    elif meta.get("cover_bytes"):
        dest = COVERS_DIR / f"{slug}{meta.get('cover_ext') or '.jpg'}"
        dest.write_bytes(meta["cover_bytes"])
        cover_rel = f"assets/covers/{dest.name}"
    else:
        cover_rel = generate_svg_cover(meta["title"], meta["author"], meta["genre"], slug)

    built_chapters = []
    for idx, ch in enumerate(chapters, start=1):
        wc = count_words(ch["content"])
        built_chapters.append({
            "id": f"{slug}-ch-{idx}",
            "number": idx,
            "volume": ch.get("volume", "Volume 1"),
            "title": ch["title"],
            "wordCount": wc,
            "readMinutes": max(1, round(wc / 230)),
            "publishedAt": today,
            "authorNoteTop": ch.get("authorNoteTop", ""),
            "authorNoteBottom": ch.get("authorNoteBottom", ""),
            "content": ch["content"],
            "reactions": {"fire": 0, "cry": 0, "mindblown": 0, "laugh": 0, "heart": 0},
            "comments": [],
        })

    if not meta.get("synopsis"):
        preview = built_chapters[0]["content"][:240].replace("\n", " ").strip()
        meta["synopsis"] = preview + ("..." if len(built_chapters[0]["content"]) > 240 else "")

    novel_obj = {
        "slug": slug,
        "title": meta["title"],
        "author": meta["author"],
        "genre": meta["genre"],
        "tags": meta["tags"] if isinstance(meta["tags"], list) else [t.strip() for t in str(meta["tags"]).split(",") if t.strip()],
        "status": meta["status"],
        "contentRating": meta.get("contentRating", "Teen"),
        "featured": bool(meta.get("featured", False)),
        "cover": cover_rel,
        "views": 1,
        "bookmarks": 0,
        "powerStones": 0,
        "rating": 5.0,
        "subRatings": {"plot": 5.0, "characters": 5.0, "world": 5.0, "style": 5.0},
        "synopsis": meta["synopsis"],
        "totalWords": sum(c["wordCount"] for c in built_chapters),
        "chapterCount": len(built_chapters),
        "updatedAt": today,
        "createdAt": today,
        "glossary": meta.get("glossary", []),
        "reviews": [],
        "chapters": built_chapters,
    }
    novel_file.write_text(json.dumps(novel_obj, indent=2, ensure_ascii=False), encoding="utf-8")
    rebuild_site_index()
    return novel_obj, len(built_chapters), False


def rebuild_site_index(base_url=""):
    summaries = []
    bundle_novels = {}
    for jf in sorted(NOVELS_DIR.glob("*.json")):
        try:
            n = json.loads(jf.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[WARN] Skipping invalid JSON {jf.name}: {e}")
            continue
        chapters = n.get("chapters", [])
        total_words = sum(c.get("wordCount", count_words(c.get("content", ""))) for c in chapters)
        n["totalWords"] = total_words
        n["chapterCount"] = len(chapters)
        bundle_novels[n["slug"]] = n
        last_ch = chapters[-1] if chapters else {}
        summaries.append({
            "slug": n["slug"],
            "title": n["title"],
            "author": n.get("author", "Unknown"),
            "genre": n.get("genre", "Fantasy"),
            "tags": n.get("tags", []),
            "status": n.get("status", "Ongoing"),
            "contentRating": n.get("contentRating", "Teen"),
            "featured": bool(n.get("featured", False)),
            "cover": n.get("cover", ""),
            "views": n.get("views", 1),
            "bookmarks": n.get("bookmarks", 0),
            "powerStones": n.get("powerStones", 0),
            "rating": n.get("rating", 4.8),
            "synopsis": n.get("synopsis", ""),
            "totalWords": total_words,
            "chapterCount": len(chapters),
            "latestChapterTitle": last_ch.get("title", ""),
            "latestChapterNumber": len(chapters),
            "updatedAt": n.get("updatedAt", datetime.now().strftime("%Y-%m-%d")),
            "createdAt": n.get("createdAt", datetime.now().strftime("%Y-%m-%d")),
        })

    summaries.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
    catalog_obj = {
        "version": "2.0",
        "generatedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalNovels": len(summaries),
        "novels": summaries,
    }
    (DATA_DIR / "catalog.json").write_text(json.dumps(catalog_obj, indent=2, ensure_ascii=False), encoding="utf-8")

    cfg_path = SITE_DIR / "config.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
    bundle_js = (
        "// Auto-generated by InkRealm Publisher\n"
        f"window.__INKREALM_CONFIG__ = {json.dumps(cfg, ensure_ascii=False)};\n"
        f"window.__INKREALM_CATALOG__ = {json.dumps(catalog_obj, ensure_ascii=False)};\n"
        f"window.__INKREALM_NOVELS__ = {json.dumps(bundle_novels, ensure_ascii=False)};\n"
    )
    (DATA_DIR / "bundle.js").write_text(bundle_js, encoding="utf-8")

    prefix = base_url.rstrip("/")
    urls = [f"  <url><loc>{prefix}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>"]
    for s in summaries:
        urls.append(f"  <url><loc>{prefix}/#novel/{urllib.parse.quote(s['slug'])}</loc><lastmod>{s['updatedAt']}</lastmod><priority>0.8</priority></url>")
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(urls) + "\n</urlset>\n"
    (SITE_DIR / "sitemap.xml").write_text(sitemap, encoding="utf-8")
    return len(summaries)


def scan_incoming_folder(move_processed=True):
    results = []
    for item in sorted(INCOMING_DIR.iterdir(), key=lambda p: natural_key(p.name)):
        if item.name.startswith(".") or item.name.upper().startswith("SAMPLE_HOW_TO"):
            continue
        try:
            novel, count, appended = import_novel_source(item)
            action = f"Appended {count} new ch" if appended else f"Added new novel ({count} ch)"
            results.append((item.name, novel["title"], action))
            if move_processed:
                dest = PROCESSED_DIR / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{item.name}"
                shutil.move(str(item), str(dest))
        except Exception as e:
            results.append((item.name, "ERROR", str(e)))
    return results


def git_auto_deploy(commit_msg="Publish novels via InkRealm Auto-Publisher"):
    def run(cmd):
        return subprocess.run(cmd, cwd=str(PROJECT_ROOT), capture_output=True, text=True)

    r1 = run(["git", "add", "-A"])
    if r1.returncode != 0:
        return False, r1.stderr or "Not a git repository. Run Antigravity setup once first."
    r2 = run(["git", "commit", "-m", commit_msg])
    if r2.returncode != 0 and "nothing to commit" not in (r2.stdout + r2.stderr).lower():
        return False, r2.stderr or r2.stdout
    r3 = run(["git", "push"])
    if r3.returncode != 0:
        return False, r3.stderr or r3.stdout
    return True, "Successfully pushed live! Your subdomain will update in ~15-30 seconds."


def start_preview_server(port=8080, open_browser=True):
    os.chdir(str(SITE_DIR))
    handler = http.server.SimpleHTTPRequestHandler
    httpd = socketserver.TCPServer(("", port), handler)
    url = f"http://localhost:{port}"
    print(f"Preview server running at {url} (Ctrl+C to stop)")
    if open_browser:
        webbrowser.open(url)
    httpd.serve_forever()


def launch_gui():
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox, ttk
    except Exception:
        print("Tkinter GUI unavailable in this environment. Use CLI flags (run with --help).")
        return

    win = tk.Tk()
    win.title("InkRealm Auto-Publisher — Zero-Antigravity Novel Manager")
    win.geometry("820x620")
    win.configure(bg="#0f172a")

    style = ttk.Style()
    try:
        style.theme_use("clam")
    except Exception:
        pass

    header = tk.Frame(win, bg="#1e1b4b", pady=12, padx=16)
    header.pack(fill="x")
    tk.Label(header, text="InkRealm Auto-Publisher", font=("Segoe UI", 16, "bold"), fg="#ffffff", bg="#1e1b4b").pack(anchor="w")
    tk.Label(header, text="Drop .TXT, .MD, .DOCX, .EPUB, or chapter folders -> Auto-split chapters, generate covers & push live!", font=("Segoe UI", 9), fg="#c7d2fe", bg="#1e1b4b").pack(anchor="w")

    nb = ttk.Notebook(win)
    nb.pack(fill="both", expand=True, padx=12, pady=12)

    t1 = tk.Frame(nb, bg="#111827", padx=16, pady=14)
    nb.add(t1, text="  Add / Update Novel  ")

    src_var = tk.StringVar()
    cov_var = tk.StringVar()
    title_var = tk.StringVar()
    author_var = tk.StringVar(value="Author")
    genre_var = tk.StringVar(value="Xianxia")
    status_var = tk.StringVar(value="Ongoing")
    tags_var = tk.StringVar(value="Web Novel, Original")
    deploy_var = tk.BooleanVar(value=False)

    def pick_file():
        p = filedialog.askopenfilename(title="Select Novel File", filetypes=[("Novel Files", "*.txt *.md *.docx *.epub *.html *.json"), ("All", "*.*")])
        if p:
            src_var.set(p)
            if not title_var.get():
                title_var.set(Path(p).stem.replace("_", " ").replace("-", " ").title())

    def pick_folder():
        p = filedialog.askdirectory(title="Select Folder of Chapter Files")
        if p:
            src_var.set(p)
            if not title_var.get():
                title_var.set(Path(p).name.replace("_", " ").replace("-", " ").title())

    def pick_cover():
        p = filedialog.askopenfilename(title="Optional Cover Image", filetypes=[("Images", "*.jpg *.jpeg *.png *.webp *.svg")])
        if p:
            cov_var.set(p)

    def row_field(parent, r, label, var, btn_cfg=None):
        tk.Label(parent, text=label, fg="#e2e8f0", bg="#111827", font=("Segoe UI", 9, "bold")).grid(row=r, column=0, sticky="w", pady=5)
        e = tk.Entry(parent, textvariable=var, bg="#1f2937", fg="#ffffff", insertbackground="white", relief="flat", width=52)
        e.grid(row=r, column=1, sticky="ew", padx=8, pady=5, ipady=4)
        if btn_cfg:
            bf = tk.Frame(parent, bg="#111827")
            bf.grid(row=r, column=2, sticky="e")
            for text, cmd in btn_cfg:
                tk.Button(bf, text=text, command=cmd, bg="#4f46e5", fg="white", relief="flat", padx=8, pady=3).pack(side="left", padx=2)

    t1.columnconfigure(1, weight=1)
    row_field(t1, 0, "Novel File / Folder:", src_var, [("File", pick_file), ("Folder", pick_folder)])
    row_field(t1, 1, "Novel Title:", title_var)
    row_field(t1, 2, "Author Name:", author_var)

    tk.Label(t1, text="Genre & Status:", fg="#e2e8f0", bg="#111827", font=("Segoe UI", 9, "bold")).grid(row=3, column=0, sticky="w", pady=5)
    gs_frame = tk.Frame(t1, bg="#111827")
    gs_frame.grid(row=3, column=1, sticky="w", padx=8, pady=5)
    ttk.Combobox(gs_frame, textvariable=genre_var, values=list(PALETTES.keys()), width=20).pack(side="left", padx=(0, 10))
    ttk.Combobox(gs_frame, textvariable=status_var, values=["Ongoing", "Completed", "Hiatus"], width=16).pack(side="left")

    row_field(t1, 4, "Tags (comma sep):", tags_var)
    row_field(t1, 5, "Cover Image (opt):", cov_var, [("Browse", pick_cover)])

    tk.Label(t1, text="Synopsis (optional):", fg="#e2e8f0", bg="#111827", font=("Segoe UI", 9, "bold")).grid(row=6, column=0, sticky="nw", pady=5)
    syn_box = tk.Text(t1, height=4, bg="#1f2937", fg="#ffffff", insertbackground="white", relief="flat", wrap="word")
    syn_box.grid(row=6, column=1, columnspan=2, sticky="ew", padx=8, pady=5)

    tk.Checkbutton(t1, text="Automatically Git Push Live after adding (updates your live subdomain immediately)", variable=deploy_var, bg="#111827", fg="#a7f3d0", selectcolor="#064e3b", activebackground="#111827").grid(row=7, column=1, sticky="w", padx=8, pady=6)

    log_box = tk.Text(t1, height=6, bg="#090d16", fg="#94a3b8", relief="flat", font=("Consolas", 9))
    log_box.grid(row=9, column=0, columnspan=3, sticky="nsew", pady=(10, 0))
    t1.rowconfigure(9, weight=1)

    def log(msg):
        log_box.insert("end", f"[{datetime.now().strftime('%H:%M:%S')}] {msg}\n")
        log_box.see("end")
        win.update_idletasks()

    def do_add():
        src = src_var.get().strip()
        if not src or not Path(src).exists():
            messagebox.showwarning("Missing Source", "Please choose a valid novel file or chapter folder.")
            return
        try:
            overrides = {
                "title": title_var.get().strip(),
                "author": author_var.get().strip(),
                "genre": genre_var.get().strip(),
                "status": status_var.get().strip(),
                "tags": [t.strip() for t in tags_var.get().split(",") if t.strip()],
                "synopsis": syn_box.get("1.0", "end").strip(),
                "cover_file": cov_var.get().strip() or None,
            }
            novel, cnt, appended = import_novel_source(Path(src), overrides=overrides)
            verb = f"Appended {cnt} new chapter(s) to" if appended else f"Published new novel ({cnt} chapters):"
            log(f"SUCCESS: {verb} '{novel['title']}' (slug: {novel['slug']})")
            refresh_catalog_list()
            if deploy_var.get():
                ok, dmsg = git_auto_deploy(f"Publish {novel['title']}")
                log(("DEPLOY OK: " if ok else "DEPLOY NOTE: ") + dmsg)
            messagebox.showinfo("Published!", f"{verb} {novel['title']}!\nSite data rebuilt automatically.")
        except Exception as e:
            log(f"ERROR: {e}")
            messagebox.showerror("Import Failed", str(e))

    def do_scan_batch():
        res = scan_incoming_folder(move_processed=True)
        if not res:
            log("No new files found inside incoming_novels/ folder.")
            messagebox.showinfo("Folder Empty", f"Drop .txt/.docx/.epub files or novel folders into:\n{INCOMING_DIR}")
            return
        for fname, title, act in res:
            log(f"{fname} -> {title} ({act})")
        refresh_catalog_list()
        if deploy_var.get():
            ok, dmsg = git_auto_deploy("Batch publish novels")
            log(("DEPLOY OK: " if ok else "DEPLOY NOTE: ") + dmsg)

    btn_bar = tk.Frame(t1, bg="#111827")
    btn_bar.grid(row=8, column=0, columnspan=3, sticky="ew", pady=6)
    tk.Button(btn_bar, text="Add Novel to Website", command=do_add, bg="#4f46e5", fg="white", font=("Segoe UI", 10, "bold"), relief="flat", padx=16, pady=7).pack(side="left", padx=(0, 8))
    tk.Button(btn_bar, text="Batch Import incoming_novels/", command=do_scan_batch, bg="#059669", fg="white", font=("Segoe UI", 10, "bold"), relief="flat", padx=14, pady=7).pack(side="left", padx=4)
    tk.Button(btn_bar, text="Preview Website", command=lambda: threading.Thread(target=start_preview_server, args=(8080, True), daemon=True).start(), bg="#0284c7", fg="white", font=("Segoe UI", 10, "bold"), relief="flat", padx=14, pady=7).pack(side="right")

    t2 = tk.Frame(nb, bg="#111827", padx=16, pady=14)
    nb.add(t2, text="  Manage Hosted Novels  ")

    cat_list = tk.Listbox(t2, bg="#1f2937", fg="#f8fafc", font=("Consolas", 10), selectbackground="#4f46e5", relief="flat")
    cat_list.pack(fill="both", expand=True, pady=(0, 10))
    slugs_map = []

    def refresh_catalog_list():
        cat_list.delete(0, "end")
        slugs_map.clear()
        cat_file = DATA_DIR / "catalog.json"
        if not cat_file.exists():
            return
        data = json.loads(cat_file.read_text(encoding="utf-8"))
        for n in data.get("novels", []):
            slugs_map.append(n["slug"])
            cat_list.insert("end", f"{n['title']}  |  {n['author']}  |  {n['genre']}  |  {n['chapterCount']} Ch  ({n['slug']})")

    def delete_selected():
        sel = cat_list.curselection()
        if not sel:
            return
        slug = slugs_map[sel[0]]
        if not messagebox.askyesno("Confirm Delete", f"Permanently delete novel '{slug}' from website?"):
            return
        jf = NOVELS_DIR / f"{slug}.json"
        if jf.exists():
            jf.unlink()
        rebuild_site_index()
        refresh_catalog_list()
        log(f"Deleted novel: {slug}")

    def push_live_now():
        ok, msg = git_auto_deploy("Manual sync from InkRealm Publisher")
        messagebox.showinfo("Git Deploy", msg) if ok else messagebox.showwarning("Git Deploy", msg)

    m_bar = tk.Frame(t2, bg="#111827")
    m_bar.pack(fill="x")
    tk.Button(m_bar, text="Rebuild Index & Sitemap", command=lambda: (rebuild_site_index(), refresh_catalog_list(), messagebox.showinfo("Done", "Rebuilt catalog.json, bundle.js & sitemap.xml!")), bg="#4f46e5", fg="white", relief="flat", padx=12, pady=6).pack(side="left", padx=(0, 8))
    tk.Button(m_bar, text="Push All Changes Live (Git)", command=push_live_now, bg="#059669", fg="white", relief="flat", padx=12, pady=6).pack(side="left", padx=4)
    tk.Button(m_bar, text="Delete Selected Novel", command=delete_selected, bg="#dc2626", fg="white", relief="flat", padx=12, pady=6).pack(side="right")

    refresh_catalog_list()
    log(f"Ready! Drop novels into {INCOMING_DIR} or select a file above.")
    win.mainloop()


def main():
    parser = argparse.ArgumentParser(description="InkRealm Zero-Antigravity Novel Publisher")
    parser.add_argument("--add", help="Path to a novel file (.txt/.md/.docx/.epub/.json) or folder of chapters")
    parser.add_argument("--title", help="Override novel title")
    parser.add_argument("--author", help="Override author name")
    parser.add_argument("--genre", help="Override genre (e.g. Xianxia, LitRPG, Fantasy, Sci-Fi, Romance, Mystery)")
    parser.add_argument("--status", default="Ongoing", help="Ongoing, Completed, or Hiatus")
    parser.add_argument("--tags", help="Comma-separated tags")
    parser.add_argument("--cover", help="Path to custom cover image (.jpg/.png/.webp)")
    parser.add_argument("--append", help="Append chapters to an existing novel slug")
    parser.add_argument("--scan", action="store_true", help="Batch-import all novels in incoming_novels/")
    parser.add_argument("--watch", action="store_true", help="Continuously watch incoming_novels/ and auto-import")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild catalog.json, bundle.js, and sitemap.xml")
    parser.add_argument("--deploy", action="store_true", help="Automatically git commit & push after updating")
    parser.add_argument("--serve", action="store_true", help="Start local preview server on port 8080")
    args = parser.parse_args()

    if len(sys.argv) == 1:
        launch_gui()
        return

    changed = False
    if args.add:
        overrides = {
            "title": args.title,
            "author": args.author,
            "genre": args.genre,
            "status": args.status,
            "tags": [t.strip() for t in args.tags.split(",")] if args.tags else None,
            "cover_file": args.cover,
        }
        novel, cnt, appended = import_novel_source(Path(args.add), overrides=overrides, append_to_slug=args.append)
        print(f"[OK] {'Appended' if appended else 'Added'} {cnt} chapter(s) -> '{novel['title']}' (slug: {novel['slug']})")
        changed = True

    if args.scan:
        res = scan_incoming_folder(move_processed=True)
        for fname, title, act in res:
            print(f"[BATCH] {fname} -> {title}: {act}")
        if res:
            changed = True
        else:
            print(f"[INFO] No new files in {INCOMING_DIR}")

    if args.rebuild:
        total = rebuild_site_index()
        print(f"[OK] Rebuilt catalog.json, bundle.js & sitemap.xml ({total} novels)")
        changed = True

    if args.deploy and changed:
        ok, msg = git_auto_deploy()
        print(("[DEPLOY OK] " if ok else "[DEPLOY ERR] ") + msg)

    if args.watch:
        print(f"[WATCHING] Drop novels into {INCOMING_DIR} ... (Press Ctrl+C to stop)")
        while True:
            res = scan_incoming_folder(move_processed=True)
            if res:
                for fname, title, act in res:
                    print(f"[AUTO-IMPORT] {fname} -> {title}: {act}")
                if args.deploy:
                    ok, msg = git_auto_deploy("Auto-publish dropped novels")
                    print(("[DEPLOY OK] " if ok else "[DEPLOY ERR] ") + msg)
            time.sleep(4)

    if args.serve:
        start_preview_server(8080, open_browser=True)


if __name__ == "__main__":
    main()
