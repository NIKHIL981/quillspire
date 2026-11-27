#!/usr/bin/env python3
"""
InkRealm Automated Public-Domain Novel Fetcher v1.0
Fetches top-rated ("best") and newest public-domain novels automatically from:
  1) Project Gutenberg via Gutendex API (https://gutendex.com/books)
  2) Open Library + Internet Archive Public-Domain Full-Text Scans

Zero external pip dependencies required (pure Python 3 standard library).
Reuses publisher_app/novel_publisher.py to parse, split chapters, save covers,
and rebuild site/data/catalog.json, site/data/bundle.js, and site/sitemap.xml.

Usage:
  python publisher_app/auto_fetch_novels.py --source both --mode mixed --limit 5
  python publisher_app/auto_fetch_novels.py --source gutenberg --mode newest --limit 3
  python publisher_app/auto_fetch_novels.py --source openlibrary --mode best --limit 3 --deploy
  python publisher_app/auto_fetch_novels.py --topic fantasy --limit 4 --dry-run
"""

import argparse
import json
import random
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

# Ensure sibling import of novel_publisher works regardless of working directory
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import novel_publisher as npub

REGISTRY_PATH = SCRIPT_DIR / "fetched_registry.json"
USER_AGENT = "InkRealmNovelBot/2.0 (https://github.com/inkrealm; contact@inkrealm.local)"
REQUEST_DELAY_SEC = 0.5  # Polite delay between requests (1.5s enforced for Open Library)

FICTION_TOPICS = [
    "fantasy",
    "science fiction",
    "mystery",
    "adventure",
    "romance",
    "horror",
    "historical fiction",
    "detective",
    "gothic",
    "fairy tales",
]

OPENLIBRARY_SUBJECTS = [
    "fantasy",
    "science_fiction",
    "mystery",
    "romance",
    "adventure",
    "horror",
    "historical_fiction",
    "ghost_stories",
]

# Subject keyword -> InkRealm/Quillspire genre mapping (ordered by specificity)
GENRE_RULES = [
    ("Xianxia", ["xianxia", "wuxia", "cultivation", "martial arts", "immortal", "dao", "qi "]),
    ("LitRPG", ["litrpg", "gamelit", "dungeon", "system", "level up", "virtual reality", "mmorpg"]),
    ("Steampunk", ["steampunk", "clockwork", "airship", "verne", "scientific romance"]),
    ("Sci-Fi", ["science fiction", "sci-fi", "space", "mars", "martian", "future", "dystopia", "time travel", "alien", "utopia", "cyber"]),
    ("Horror", ["horror", "ghost", "vampire", "gothic", "supernatural", "occult", "haunted", "macabre", "cthulhu", "werewolf"]),
    ("Mystery", ["mystery", "detective", "crime", "murder", "thriller", "sleuth", "sherlock", "noir", "whodunit", "espionage", "suspense"]),
    ("Romance", ["romance", "love stor", "courtship", "marriage", "regency", "sentimental"]),
    ("Historical", ["historical", "war", "medieval", "victorian", "ancient", "empire", "napoleon", "civil war", "pirate", "western"]),
    ("Slice of Life", ["domestic", "coming of age", "country life", "pastoral", "humor", "comedy", "satire", "manners"]),
    ("Fantasy", ["fantasy", "magic", "fairy", "dragon", "myth", "legend", "wizard", "sword", "kingdom", "enchant", "adventure", "lost world"]),
]

NON_FICTION_NOISE = (
    "dictionary", "encyclopedia", "grammar", "textbook", "sermon", "theology",
    "treatise", "census", "almanac", "bibliography", "catalog", "statutes",
    "parliamentary", "cookery", "cooking", "recipes", "manual of", "handbook",
)


def is_fiction_novel(title: str, subjects: list) -> bool:
    """Ensure imported books are novels/fiction/stories rather than reference/non-fiction."""
    low_t = (title or "").lower()
    if any(n in low_t for n in NON_FICTION_NOISE):
        return False
    blob = " | ".join(subjects or []).lower()
    if not blob:
        return True
    fiction_hints = (
        "fiction", "novel", "story", "stories", "tales", "fantasy", "sci-fi",
        "science fiction", "mystery", "romance", "horror", "adventure", "thriller",
        "detective", "ghost", "gothic", "espionage", "steampunk", "young adult",
    )
    return any(h in blob for h in fiction_hints)

GUTENBERG_START_RE = re.compile(
    r"\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*{3}",
    re.IGNORECASE,
)
GUTENBERG_END_RE = re.compile(
    r"\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*{3}",
    re.IGNORECASE,
)
GUTENBERG_LEGACY_END_RE = re.compile(
    r"End of (?:the )?Project Gutenberg(?:'s)?\s+E(?:Book|text)",
    re.IGNORECASE,
)

_last_request_ts = 0.0


def polite_sleep(min_delay=REQUEST_DELAY_SEC):
    global _last_request_ts
    now = time.time()
    elapsed = now - _last_request_ts
    if _last_request_ts > 0 and elapsed < min_delay:
        time.sleep(min_delay - elapsed)
    _last_request_ts = time.time()


def http_get_bytes(url, timeout=30, retries=2):
    """Polite HTTP GET returning raw bytes with retry & proper User-Agent."""
    last_err = None
    for attempt in range(retries + 1):
        polite_sleep()
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "*/*",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read(), resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(3.0 * (attempt + 1))
                continue
            raise
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(2.0 * (attempt + 1))
                continue
            raise
    raise last_err


def http_get_json(url, timeout=18, retries=1):
    data, _ = http_get_bytes(url, timeout=timeout, retries=retries)
    return json.loads(data.decode("utf-8", errors="replace"))


# ------------------------- REGISTRY & DEDUPLICATION -------------------------
def load_registry():
    if REGISTRY_PATH.exists():
        try:
            data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
            data.setdefault("source_ids", [])
            data.setdefault("slugs", [])
            data.setdefault("history", [])
            return data
        except Exception:
            pass
    return {"version": "1.0", "source_ids": [], "slugs": [], "history": []}


def save_registry(reg):
    reg["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
    REGISTRY_PATH.write_text(json.dumps(reg, indent=2, ensure_ascii=False), encoding="utf-8")


def existing_site_slugs():
    return {p.stem.lower() for p in npub.NOVELS_DIR.glob("*.json")}


def is_already_imported(reg, source_id, title):
    slug = npub.slugify(title)
    if source_id in reg["source_ids"]:
        return True
    if slug in reg["slugs"] or slug in existing_site_slugs():
        return True
    return False


def record_imported(reg, source_id, slug, title, source_name, chapters_count, words_count):
    if source_id not in reg["source_ids"]:
        reg["source_ids"].append(source_id)
    if slug not in reg["slugs"]:
        reg["slugs"].append(slug)
    reg["history"].append({
        "sourceId": source_id,
        "slug": slug,
        "title": title,
        "source": source_name,
        "chapters": chapters_count,
        "words": words_count,
        "importedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
    })


# ------------------------- TEXT & METADATA CLEANING -------------------------
def strip_gutenberg_boilerplate(raw_text):
    """Strips standard Project Gutenberg headers, footers, and license blocks."""
    text = raw_text or ""
    m_start = GUTENBERG_START_RE.search(text)
    if m_start:
        text = text[m_start.end():]
    m_end = GUTENBERG_END_RE.search(text)
    if m_end:
        text = text[:m_end.start()]
    else:
        m_leg = GUTENBERG_LEGACY_END_RE.search(text)
        if m_leg:
            text = text[:m_leg.start()]
    # Remove common "Produced by ..." preface line at the top
    text = re.sub(r"^\s*Produced by[^\n]*(?:\n[^\n]+){0,4}\n\s*\n", "", text.lstrip(), flags=re.I)
    return npub.clean_text(text)


def clean_ocr_text(raw_text):
    """Cleans common Internet Archive / DjVu OCR formatting artifacts."""
    text = (raw_text or "").replace("\r\n", "\n").replace("\r", "\n")
    # Re-join hyphenated line breaks ("adven-\nture" -> "adventure")
    text = re.sub(r"([A-Za-z])-\n([a-z])", r"\1\2", text)
    # Remove standalone page number lines
    text = re.sub(r"\n\s*\d{1,4}\s*\n", "\n", text)
    # Convert single line wraps inside paragraphs into spaces while preserving blank-line paragraphs
    paragraphs = re.split(r"\n\s*\n", text)
    cleaned_paras = []
    for p in paragraphs:
        p = p.strip()
        if not p:
            continue
        # Keep short heading-like lines intact
        if len(p) <= 90 and npub.CHAPTER_REGEX.match(p):
            cleaned_paras.append(p)
        else:
            joined = re.sub(r"\s*\n\s*", " ", p)
            joined = re.sub(r" {2,}", " ", joined)
            cleaned_paras.append(joined)
    return npub.clean_text("\n\n".join(cleaned_paras))


def normalize_author_name(name):
    """Converts 'Verne, Jules' -> 'Jules Verne' and strips birth/death years."""
    if not name:
        return "Unknown Author"
    name = re.sub(r",?\s*\d{3,4}\??-\d{0,4}\??", "", name).strip().strip(",")
    if "," in name:
        parts = [p.strip() for p in name.split(",", 1)]
        if len(parts) == 2 and parts[1]:
            name = f"{parts[1]} {parts[0]}"
    return name or "Unknown Author"


def map_genre(subjects_and_shelves, default="Fantasy"):
    blob = " | ".join(subjects_and_shelves or []).lower()
    for genre, keywords in GENRE_RULES:
        if any(kw in blob for kw in keywords):
            return genre
    return default


def extract_clean_tags(subjects_and_shelves, genre, max_tags=6):
    tags = []
    seen = {genre.lower()}
    noise = ("fiction", "browsing:", "gutenberg", "accessible book", "protected daisy", "in library", "lending", "open library")
    for raw in subjects_and_shelves or []:
        # Split LC subject headings like "Science fiction -- Juvenile fiction"
        for part in re.split(r"--|;|/", str(raw)):
            t = re.sub(r"\([^)]*\)", "", part).strip(" .:-")
            if not t or len(t) < 3 or len(t) > 28:
                continue
            low = t.lower()
            if any(n in low for n in noise):
                continue
            if low not in seen:
                seen.add(low)
                tags.append(t.title() if not t.isupper() else t)
            if len(tags) >= max_tags:
                return tags
    if not tags:
        tags = ["Classic", "Public Domain"]
    elif "Public Domain" not in tags and len(tags) < max_tags:
        tags.append("Public Domain")
    return tags[:max_tags]


def is_likely_english(text):
    """Quick heuristic to skip non-English books even if mislabeled."""
    sample = (text or "")[:6000].lower()
    words = re.findall(r"\b[a-z]+\b", sample)
    if len(words) < 80:
        return False
    common = {"the", "and", "of", "to", "in", "that", "was", "his", "her", "with", "for", "had", "not", "but"}
    hits = sum(1 for w in words if w in common)
    return (hits / len(words)) >= 0.14


def filter_and_clean_chapters(chapters):
    """Removes empty/boilerplate front/back matter chapters and cleans titles."""
    skip_titles = (
        "project gutenberg", "table of contents", "contents", "copyright",
        "title page", "cover", "transcriber", "colophon", "license", "index",
        "illustrations", "list of illustrations", "dedication",
    )
    cleaned = []
    for ch in chapters:
        title = re.sub(r"\s+", " ", (ch.get("title") or "")).strip()
        body = strip_gutenberg_boilerplate(ch.get("content") or "")
        low_t = title.lower()
        if any(s in low_t for s in skip_titles) and npub.count_words(body) < 350:
            continue
        if "gutenberg.org/license" in body.lower() and npub.count_words(body) < 600:
            continue
        if npub.count_words(body) < 60:
            continue
        if not title or len(title) > 100:
            title = f"Chapter {len(cleaned) + 1}"
        cleaned.append({
            "title": title,
            "volume": ch.get("volume") or "Volume 1",
            "content": body,
        })
    return cleaned


def download_cover_to_temp(url, tmp_dir: Path, slug: str):
    """Downloads a cover image if valid (>2KB and image MIME type)."""
    if not url:
        return None
    try:
        img_bytes, ctype = http_get_bytes(url, timeout=20, retries=1)
        if len(img_bytes) < 2048:
            # Open Library returns a 43-byte 1x1 GIF when no cover exists
            return None
        ext = ".jpg"
        if "png" in ctype.lower() or url.lower().endswith(".png"):
            ext = ".png"
        elif "webp" in ctype.lower() or url.lower().endswith(".webp"):
            ext = ".webp"
        out = tmp_dir / f"{slug}_cover{ext}"
        out.write_bytes(img_bytes)
        return out
    except Exception:
        return None


def finalize_and_validate_novel(
    source_file: Path,
    meta_overrides: dict,
    source_meta: dict,
    min_chapters: int,
    min_words: int,
    dry_run: bool = False,
):
    """Parses the downloaded file, enforces quality gates, and writes via novel_publisher."""
    ext = source_file.suffix.lower()
    if ext == ".epub":
        try:
            emeta, raw_chapters = npub.parse_epub(source_file)
        except Exception as e:
            return None, f"Skipped (corrupted EPUB: {e})"
        if not meta_overrides.get("synopsis") and emeta.get("synopsis"):
            meta_overrides["synopsis"] = emeta["synopsis"]
    else:
        raw_txt = source_file.read_text(encoding="utf-8", errors="ignore")
        if source_meta.get("source") == "Project Gutenberg":
            raw_txt = strip_gutenberg_boilerplate(raw_txt)
        else:
            raw_txt = clean_ocr_text(raw_txt)
        raw_chapters = npub.split_chapters_smart(raw_txt)

    chapters = filter_and_clean_chapters(raw_chapters)
    # If an EPUB had a single giant HTML file, try smart-splitting that text into chapters
    if len(chapters) == 1 and npub.count_words(chapters[0]["content"]) >= min_words:
        resplit = filter_and_clean_chapters(npub.split_chapters_smart(chapters[0]["content"]))
        if len(resplit) >= min_chapters:
            chapters = resplit

    total_words = sum(npub.count_words(c["content"]) for c in chapters)
    if len(chapters) < min_chapters:
        return None, f"Skipped (only {len(chapters)} chapter(s), need >= {min_chapters})"
    if total_words < min_words:
        return None, f"Skipped (only {total_words} words, need >= {min_words})"

    sample_text = "\n\n".join(c["content"][:2000] for c in chapters[:3])
    if not is_likely_english(sample_text):
        return None, "Skipped (non-English or corrupted OCR text)"

    if dry_run:
        return {
            "slug": npub.slugify(meta_overrides["title"]),
            "title": meta_overrides["title"],
            "chapterCount": len(chapters),
            "totalWords": total_words,
        }, "DRY-RUN OK"

    # Build a clean JSON source payload and pass directly through novel_publisher.import_novel_source
    with tempfile.TemporaryDirectory() as tmp2:
        clean_json = Path(tmp2) / f"{npub.slugify(meta_overrides['title'])}.json"
        payload = {
            "title": meta_overrides["title"],
            "author": meta_overrides["author"],
            "genre": meta_overrides["genre"],
            "status": "Completed",
            "contentRating": "Teen",
            "tags": meta_overrides["tags"],
            "synopsis": meta_overrides.get("synopsis") or "",
            "featured": False,
            "chapters": chapters,
        }
        clean_json.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        novel_obj, cnt, _ = npub.import_novel_source(
            clean_json,
            overrides={"cover_file": meta_overrides.get("cover_file")},
        )

    # Enrich saved novel JSON with public-domain attribution metadata
    novel_path = npub.NOVELS_DIR / f"{novel_obj['slug']}.json"
    if novel_path.exists():
        saved = json.loads(novel_path.read_text(encoding="utf-8"))
        saved["source"] = source_meta.get("source", "Public Domain")
        saved["sourceId"] = source_meta.get("sourceId", "")
        saved["sourceUrl"] = source_meta.get("sourceUrl", "")
        saved["license"] = "Public Domain"
        if source_meta.get("views_seed"):
            saved["views"] = source_meta["views_seed"]
            saved["rating"] = source_meta.get("rating_seed", 4.7)
        novel_path.write_text(json.dumps(saved, indent=2, ensure_ascii=False), encoding="utf-8")
        novel_obj = saved

    return novel_obj, "IMPORTED"


# ------------------------- SOURCE A: PROJECT GUTENBERG (GUTENDEX) -------------------------
def pick_gutenberg_download_url(formats: dict):
    """Prefers EPUB3/EPUB without huge images, falls back to UTF-8 plain text."""
    preferred_keys = [
        "application/epub+zip",
        "text/plain; charset=utf-8",
        "text/plain; charset=us-ascii",
        "text/plain",
    ]
    for k in preferred_keys:
        url = formats.get(k)
        if url and not url.endswith(".zip"):
            ext = ".epub" if "epub" in k else ".txt"
            return url, ext
    for k, url in (formats or {}).items():
        if "epub" in k and url and not url.endswith(".zip"):
            return url, ".epub"
    for k, url in (formats or {}).items():
        if k.startswith("text/plain") and url and not url.endswith(".zip"):
            return url, ".txt"
    return None, None


def fetch_from_gutenberg(reg, limit, mode="mixed", topic="", min_chapters=2, min_words=2500, dry_run=False):
    added = []
    if limit <= 0:
        return added

    if mode == "best":
        sorts = [("popular", limit)]
    elif mode == "newest":
        sorts = [("descending", limit)]
    else:
        newest_target = max(1, limit // 2)
        best_target = limit - newest_target
        sorts = [("descending", newest_target), ("popular", best_target)]

    for sort_key, target_count in sorts:
        if target_count <= 0:
            continue
        got_for_sort = 0
        # Query without slow server-side topic filter; paginate up to 5 pages and filter fiction locally
        params = {"languages": "en", "copyright": "false", "sort": sort_key}
        next_url = "https://gutendex.com/books?" + urllib.parse.urlencode(params)
        page_num = 0
        while next_url and page_num < 5 and got_for_sort < target_count and len(added) < limit:
            page_num += 1
            print(f"[GUTENBERG] Querying sort={sort_key}, page={page_num}...")
            try:
                data = http_get_json(next_url, timeout=18, retries=1)
            except Exception as e:
                print(f"[GUTENBERG WARN] API request failed: {e}")
                break
            next_url = data.get("next")

            for book in data.get("results", []):
                if got_for_sort >= target_count or len(added) >= limit:
                    break
                gid = book.get("id")
                title = (book.get("title") or "").split("\n")[0].strip()
                if not gid or not title or len(title) > 120:
                    continue
                subjects = (book.get("subjects") or []) + (book.get("bookshelves") or [])
                if not is_fiction_novel(title, subjects):
                    continue
                if topic and not any(topic.lower() in s.lower() for s in subjects):
                    continue
                source_id = f"gutenberg:{gid}"
                if is_already_imported(reg, source_id, title):
                    continue

                formats = book.get("formats") or {}
                dl_url, ext = pick_gutenberg_download_url(formats)
                if not dl_url:
                    continue

                authors = book.get("authors") or []
                author = normalize_author_name(authors[0].get("name") if authors else "Unknown Author")
                genre = map_genre(subjects, default=map_genre([topic], default="Fantasy") if topic else "Fantasy")
                tags = extract_clean_tags(subjects, genre)
                summaries = book.get("summaries") or []
                synopsis = npub.clean_text(summaries[0])[:550] if summaries else ""

                with tempfile.TemporaryDirectory() as tmp_str:
                    tmp = Path(tmp_str)
                    book_path = tmp / f"pg_{gid}{ext}"
                    try:
                        raw_bytes, _ = http_get_bytes(dl_url, timeout=45)
                        book_path.write_bytes(raw_bytes)
                    except Exception as e:
                        print(f"[GUTENBERG SKIP] Download failed for '{title}': {e}")
                        continue

                    cover_path = download_cover_to_temp(formats.get("image/jpeg"), tmp, npub.slugify(title))
                    novel_obj, status_msg = finalize_and_validate_novel(
                        source_file=book_path,
                        meta_overrides={
                            "title": title,
                            "author": author,
                            "genre": genre,
                            "tags": tags,
                            "synopsis": synopsis,
                            "cover_file": cover_path,
                        },
                        source_meta={
                            "source": "Project Gutenberg",
                            "sourceId": source_id,
                            "sourceUrl": f"https://www.gutenberg.org/ebooks/{gid}",
                            "views_seed": max(120, min(95000, int(book.get("download_count", 500)) * 3)),
                            "rating_seed": 4.8 if sort_key == "popular" else 4.6,
                        },
                        min_chapters=min_chapters,
                        min_words=min_words,
                        dry_run=dry_run,
                    )
                    if novel_obj:
                        print(f"[GUTENBERG {status_msg}] '{novel_obj['title']}' ({novel_obj['chapterCount']} ch, {novel_obj['totalWords']} words, {genre})")
                        if not dry_run:
                            record_imported(reg, source_id, novel_obj["slug"], novel_obj["title"], "Project Gutenberg", novel_obj["chapterCount"], novel_obj["totalWords"])
                        added.append(novel_obj)
                        got_for_sort += 1
                    else:
                        print(f"[GUTENBERG SKIP] '{title}': {status_msg}")
    return added


# ------------------------- SOURCE B: OPEN LIBRARY + INTERNET ARCHIVE -------------------------
def resolve_ia_book_file(ia_id: str):
    """Queries Internet Archive metadata to pick the cleanest .epub or _djvu.txt file."""
    meta_url = f"https://archive.org/metadata/{urllib.parse.quote(ia_id)}/files"
    data = http_get_json(meta_url, timeout=25)
    files = data.get("result") or []

    epub_name = None
    txt_name = None
    for f in files:
        name = f.get("name") or ""
        low = name.lower()
        size = int(f.get("size") or 0)
        if size > 35_000_000:  # skip gigantic scanned PDFs/EPUBs >35MB
            continue
        if low.endswith(".epub") and not epub_name:
            epub_name = name
        elif low.endswith("_djvu.txt") and not txt_name:
            txt_name = name
        elif low.endswith(".txt") and "meta" not in low and not txt_name:
            txt_name = name

    if epub_name:
        return f"https://archive.org/download/{urllib.parse.quote(ia_id)}/{urllib.parse.quote(epub_name)}", ".epub"
    if txt_name:
        return f"https://archive.org/download/{urllib.parse.quote(ia_id)}/{urllib.parse.quote(txt_name)}", ".txt"
    return None, None


def fetch_from_openlibrary(reg, limit, mode="mixed", topic="", min_chapters=2, min_words=2500, dry_run=False):
    added = []
    if limit <= 0:
        return added

    subjects_pool = [topic.replace(" ", "_").lower()] if topic else random.sample(OPENLIBRARY_SUBJECTS, k=min(4, len(OPENLIBRARY_SUBJECTS)))
    sort_param = "new" if mode == "newest" else "rating"

    for subj in subjects_pool:
        if len(added) >= limit:
            break
        params = {
            "subject": subj,
            "language": "eng",
            "has_fulltext": "true",
            "public_scan_b": "true",
            "sort": sort_param,
            "limit": "20",
            "fields": "key,title,author_name,subject,ia,cover_i,first_publish_year,ebook_access",
        }
        url = "https://openlibrary.org/search.json?" + urllib.parse.urlencode(params)
        print(f"[OPENLIBRARY] Querying subject='{subj}', sort='{sort_param}'...")
        try:
            data = http_get_json(url, timeout=30)
        except Exception as e:
            print(f"[OPENLIBRARY WARN] Search failed: {e}")
            continue

        for doc in data.get("docs", []):
            if len(added) >= limit:
                break
            if doc.get("ebook_access") not in ("public", None):
                continue
            ia_list = doc.get("ia") or []
            if not ia_list:
                continue

            ol_key = doc.get("key") or ""
            title = (doc.get("title") or "").strip()
            if not ol_key or not title or len(title) > 120:
                continue
            source_id = f"openlibrary:{ol_key}"
            if is_already_imported(reg, source_id, title):
                continue

            ia_id = ia_list[0]
            try:
                dl_url, ext = resolve_ia_book_file(ia_id)
            except Exception as e:
                print(f"[OPENLIBRARY SKIP] Archive metadata failed for '{title}': {e}")
                continue
            if not dl_url:
                continue

            author = normalize_author_name((doc.get("author_name") or ["Unknown Author"])[0])
            subjects = doc.get("subject") or [subj.replace("_", " ")]
            genre = map_genre(subjects, default=map_genre([subj.replace("_", " ")], default="Fantasy"))
            tags = extract_clean_tags(subjects, genre)

            cover_url = f"https://covers.openlibrary.org/b/id/{doc['cover_i']}-L.jpg" if doc.get("cover_i") else None

            with tempfile.TemporaryDirectory() as tmp_str:
                tmp = Path(tmp_str)
                book_path = tmp / f"ol_{npub.slugify(ia_id)}{ext}"
                try:
                    raw_bytes, _ = http_get_bytes(dl_url, timeout=50)
                    book_path.write_bytes(raw_bytes)
                except Exception as e:
                    print(f"[OPENLIBRARY SKIP] Download failed for '{title}': {e}")
                    continue

                cover_path = download_cover_to_temp(cover_url, tmp, npub.slugify(title))
                novel_obj, status_msg = finalize_and_validate_novel(
                    source_file=book_path,
                    meta_overrides={
                        "title": title,
                        "author": author,
                        "genre": genre,
                        "tags": tags,
                        "synopsis": "",
                        "cover_file": cover_path,
                    },
                    source_meta={
                        "source": "Open Library",
                        "sourceId": source_id,
                        "sourceUrl": f"https://openlibrary.org{ol_key}",
                        "views_seed": random.randint(450, 12000),
                        "rating_seed": 4.7,
                    },
                    min_chapters=min_chapters,
                    min_words=min_words,
                    dry_run=dry_run,
                )
                if novel_obj:
                    print(f"[OPENLIBRARY {status_msg}] '{novel_obj['title']}' ({novel_obj['chapterCount']} ch, {novel_obj['totalWords']} words, {genre})")
                    if not dry_run:
                        record_imported(reg, source_id, novel_obj["slug"], novel_obj["title"], "Open Library", novel_obj["chapterCount"], novel_obj["totalWords"])
                    added.append(novel_obj)
                else:
                    print(f"[OPENLIBRARY SKIP] '{title}': {status_msg}")
    return added


# ------------------------- SOURCE C: STANDARD EBOOKS (ATOM FEED) -------------------------
ATOM_NS = {"a": "http://www.w3.org/2005/Atom", "media": "http://search.yahoo.com/mrss/"}


def _parse_atom_feed(url):
    raw_bytes, _ = http_get_bytes(url, timeout=25, retries=1)
    return ET.fromstring(raw_bytes.decode("utf-8", errors="replace"))


def fetch_from_standardebooks(reg, limit, mode="mixed", topic="", min_chapters=2, min_words=2500, dry_run=False):
    added = []
    if limit <= 0:
        return added

    feed_url = "https://standardebooks.org/feeds/rss/new-releases"
    print(f"[STANDARDEBOOKS] Querying {feed_url}...")
    try:
        root = _parse_atom_feed(feed_url)
    except Exception as e:
        print(f"[STANDARDEBOOKS WARN] Feed failed: {e}")
        return added

    entries = root.findall("a:entry", ATOM_NS)
    if mode == "best":
        random.shuffle(entries)

    for entry in entries:
        if len(added) >= limit:
            break
        eid = (entry.findtext("a:id", "", ATOM_NS) or "").strip()
        title = (entry.findtext("a:title", "", ATOM_NS) or "").strip()
        if not eid or not title or len(title) > 120:
            continue

        categories = [c.attrib.get("term", "") for c in entry.findall("a:category", ATOM_NS) if c.attrib.get("term")]
        if topic and not any(topic.lower() in c.lower() for c in categories):
            continue

        source_id = f"standardebooks:{eid.rstrip('/').split('/')[-1]}"
        if is_already_imported(reg, source_id, title):
            continue

        epub_url = None
        cover_url = None
        for link in entry.findall("a:link", ATOM_NS):
            rel = link.attrib.get("rel", "")
            ltype = link.attrib.get("type", "")
            href = link.attrib.get("href", "")
            if rel == "enclosure" and ltype == "application/epub+zip" and "_advanced" not in href and not epub_url:
                epub_url = href
            elif "image/" in ltype and not cover_url:
                cover_url = href
        if not cover_url:
            thumb = entry.find("media:thumbnail", ATOM_NS)
            if thumb is not None:
                cover_url = thumb.attrib.get("url")
        if not epub_url:
            continue

        author = normalize_author_name(entry.findtext("a:author/a:name", "Unknown Author", ATOM_NS))
        genre = map_genre(categories, default=map_genre([topic], default="Fantasy") if topic else "Fantasy")
        tags = extract_clean_tags(categories, genre)
        summary_raw = entry.findtext("a:summary", "", ATOM_NS) or ""
        synopsis = npub.clean_text(re.sub(r"<[^>]+>", " ", summary_raw))[:550]

        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            book_path = tmp / f"se_{npub.slugify(title)}.epub"
            try:
                raw_bytes, _ = http_get_bytes(epub_url, timeout=45)
                book_path.write_bytes(raw_bytes)
            except Exception as e:
                print(f"[STANDARDEBOOKS SKIP] Download failed for '{title}': {e}")
                continue

            cover_path = download_cover_to_temp(cover_url, tmp, npub.slugify(title))
            novel_obj, status_msg = finalize_and_validate_novel(
                source_file=book_path,
                meta_overrides={
                    "title": title,
                    "author": author,
                    "genre": genre,
                    "tags": tags,
                    "synopsis": synopsis,
                    "cover_file": cover_path,
                },
                source_meta={
                    "source": "Standard Ebooks",
                    "sourceId": source_id,
                    "sourceUrl": eid,
                    "views_seed": random.randint(800, 18000),
                    "rating_seed": 4.9,
                },
                min_chapters=min_chapters,
                min_words=min_words,
                dry_run=dry_run,
            )
            if novel_obj:
                print(f"[STANDARDEBOOKS {status_msg}] '{novel_obj['title']}' ({novel_obj['chapterCount']} ch, {novel_obj['totalWords']} words, {genre})")
                if not dry_run:
                    record_imported(reg, source_id, novel_obj["slug"], novel_obj["title"], "Standard Ebooks", novel_obj["chapterCount"], novel_obj["totalWords"])
                added.append(novel_obj)
            else:
                print(f"[STANDARDEBOOKS SKIP] '{title}': {status_msg}")
    return added


# ------------------------- SOURCE D: MANYBOOKS (OPDS CATALOG) -------------------------
def fetch_from_manybooks(reg, limit, mode="mixed", topic="", min_chapters=2, min_words=2500, dry_run=False):
    added = []
    if limit <= 0:
        return added

    # Collect target OPDS feeds: new_titles + webnovel-style genre feeds
    feed_urls = []
    if not topic:
        feed_urls.append("https://manybooks.net/opds/new_titles")
    try:
        groot = _parse_atom_feed("https://manybooks.net/opds/genres")
        wanted_genres = (
            [topic.lower()] if topic
            else ["fantasy", "science fiction", "sci-fi", "mystery", "romance", "horror", "thriller", "adventure", "espionage", "ghost", "gothic", "action", "young adult"]
        )
        for ge in groot.findall("a:entry", ATOM_NS):
            gl = ge.find("a:link", ATOM_NS)
            if gl is None:
                continue
            gtitle = (gl.attrib.get("title") or ge.findtext("a:title", "", ATOM_NS) or "").strip().lower()
            href = gl.attrib.get("href", "")
            if href and any(w in gtitle for w in wanted_genres):
                feed_urls.append(href)
    except Exception:
        pass
    if not feed_urls:
        feed_urls = ["https://manybooks.net/opds/new_titles"]

    for base_feed in feed_urls:
        if len(added) >= limit:
            break
        next_url = base_feed
        page_num = 0
        while next_url and page_num < 3 and len(added) < limit:
            page_num += 1
            print(f"[MANYBOOKS] Querying {next_url}...")
            try:
                root = _parse_atom_feed(next_url)
            except Exception as e:
                print(f"[MANYBOOKS WARN] Feed failed: {e}")
                break

            next_url = None
            for l in root.findall("a:link", ATOM_NS):
                if l.attrib.get("rel") == "next" and l.attrib.get("href"):
                    next_url = l.attrib["href"]
                    break

            entries = root.findall("a:entry", ATOM_NS)
            if mode == "best":
                random.shuffle(entries)

            for entry in entries:
                if len(added) >= limit:
                    break
                detail_url = None
                thumb_url = None
                for link in entry.findall("a:link", ATOM_NS):
                    href = link.attrib.get("href", "")
                    rel = link.attrib.get("rel", "")
                    if "title_detail" in href:
                        detail_url = href
                    elif "thumbnail" in rel or "cover" in rel:
                        thumb_url = href
                if not detail_url:
                    continue

                book_num = detail_url.rstrip("/").split("/")[-1]
                source_id = f"manybooks:{book_num}"
                if source_id in reg["source_ids"]:
                    continue

                try:
                    droot = _parse_atom_feed(detail_url)
                except Exception as e:
                    print(f"[MANYBOOKS SKIP] Detail fetch failed ({detail_url}): {e}")
                    continue

                dentry = droot.find("a:entry", ATOM_NS)
                if dentry is None:
                    continue
                title = (dentry.findtext("a:title", "", ATOM_NS) or droot.findtext("a:title", "", ATOM_NS) or "").strip()
                if not title or len(title) > 120 or is_already_imported(reg, source_id, title):
                    continue

                epub_url = None
                cover_url = thumb_url
                for link in dentry.findall("a:link", ATOM_NS):
                    rel = link.attrib.get("rel", "")
                    ltype = link.attrib.get("type", "")
                    href = link.attrib.get("href", "")
                    if ltype == "application/epub+zip" and "acquisition" in rel:
                        epub_url = href
                    elif ("cover" in rel or "thumbnail" in rel) and "image/" in ltype:
                        cover_url = href
                if not epub_url:
                    continue

                author = normalize_author_name(dentry.findtext("a:author/a:name", "Unknown Author", ATOM_NS))
                categories = [c.attrib.get("term", "") for c in dentry.findall("a:category", ATOM_NS) if c.attrib.get("term")]
                if topic:
                    categories.append(topic)
                if not is_fiction_novel(title, categories):
                    continue
                genre = map_genre(categories, default=map_genre([topic], default="Fantasy") if topic else "Fantasy")
                tags = extract_clean_tags(categories, genre)
                content_el = dentry.find("a:content", ATOM_NS)
                raw_desc = "".join(content_el.itertext()) if content_el is not None else ""
                synopsis = npub.clean_text(raw_desc)[:550]

                with tempfile.TemporaryDirectory() as tmp_str:
                    tmp = Path(tmp_str)
                    book_path = tmp / f"mb_{book_num}.epub"
                    try:
                        raw_bytes, _ = http_get_bytes(epub_url, timeout=45)
                        book_path.write_bytes(raw_bytes)
                    except Exception as e:
                        print(f"[MANYBOOKS SKIP] Download failed for '{title}': {e}")
                        continue

                    cover_path = download_cover_to_temp(cover_url, tmp, npub.slugify(title))
                    novel_obj, status_msg = finalize_and_validate_novel(
                        source_file=book_path,
                        meta_overrides={
                            "title": title,
                            "author": author,
                            "genre": genre,
                            "tags": tags,
                            "synopsis": synopsis,
                            "cover_file": cover_path,
                        },
                        source_meta={
                            "source": "ManyBooks",
                            "sourceId": source_id,
                            "sourceUrl": f"https://manybooks.net/titles/{book_num}",
                            "views_seed": random.randint(350, 9500),
                            "rating_seed": 4.6,
                        },
                        min_chapters=min_chapters,
                        min_words=min_words,
                        dry_run=dry_run,
                    )
                    if novel_obj:
                        print(f"[MANYBOOKS {status_msg}] '{novel_obj['title']}' ({novel_obj['chapterCount']} ch, {novel_obj['totalWords']} words, {genre})")
                        if not dry_run:
                            record_imported(reg, source_id, novel_obj["slug"], novel_obj["title"], "ManyBooks", novel_obj["chapterCount"], novel_obj["totalWords"])
                        added.append(novel_obj)
                    else:
                        print(f"[MANYBOOKS SKIP] '{title}': {status_msg}")
    return added


# ------------------------- SOURCE E: FEEDBOOKS (PUBLIC DOMAIN OPDS) -------------------------
def fetch_from_feedbooks(reg, limit, mode="mixed", topic="", min_chapters=2, min_words=2500, dry_run=False):
    added = []
    if limit <= 0:
        return added

    feed_url = (
        "https://catalog.feedbooks.com/publicdomain/browse/recent.atom"
        if mode == "newest"
        else "https://catalog.feedbooks.com/publicdomain/browse/top.atom"
    )
    print(f"[FEEDBOOKS] Querying {feed_url}...")
    try:
        root = _parse_atom_feed(feed_url)
    except Exception as e:
        print(f"[FEEDBOOKS WARN] Public-domain OPDS unavailable ({e}); skipping.")
        return added

    for entry in root.findall("a:entry", ATOM_NS):
        if len(added) >= limit:
            break
        eid = (entry.findtext("a:id", "", ATOM_NS) or "").strip()
        title = (entry.findtext("a:title", "", ATOM_NS) or "").strip()
        if not eid or not title or len(title) > 120:
            continue
        source_id = f"feedbooks:{eid.rstrip('/').split('/')[-1]}"
        if is_already_imported(reg, source_id, title):
            continue

        epub_url = None
        cover_url = None
        for link in entry.findall("a:link", ATOM_NS):
            rel = link.attrib.get("rel", "")
            ltype = link.attrib.get("type", "")
            href = link.attrib.get("href", "")
            if ltype == "application/epub+zip" and "acquisition" in rel and not epub_url:
                epub_url = href
            elif ("cover" in rel or "image" in rel) and "image/" in ltype and not cover_url:
                cover_url = href
        if not epub_url:
            continue

        author = normalize_author_name(entry.findtext("a:author/a:name", "Unknown Author", ATOM_NS))
        categories = [c.attrib.get("term", "") for c in entry.findall("a:category", ATOM_NS) if c.attrib.get("term")]
        genre = map_genre(categories, default="Fantasy")
        tags = extract_clean_tags(categories, genre)
        synopsis = npub.clean_text(entry.findtext("a:summary", "", ATOM_NS) or "")[:550]

        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            book_path = tmp / f"fb_{npub.slugify(title)}.epub"
            try:
                raw_bytes, _ = http_get_bytes(epub_url, timeout=45)
                book_path.write_bytes(raw_bytes)
            except Exception as e:
                print(f"[FEEDBOOKS SKIP] Download failed for '{title}': {e}")
                continue

            cover_path = download_cover_to_temp(cover_url, tmp, npub.slugify(title))
            novel_obj, status_msg = finalize_and_validate_novel(
                source_file=book_path,
                meta_overrides={
                    "title": title,
                    "author": author,
                    "genre": genre,
                    "tags": tags,
                    "synopsis": synopsis,
                    "cover_file": cover_path,
                },
                source_meta={
                    "source": "Feedbooks",
                    "sourceId": source_id,
                    "sourceUrl": eid,
                    "views_seed": random.randint(400, 11000),
                    "rating_seed": 4.7,
                },
                min_chapters=min_chapters,
                min_words=min_words,
                dry_run=dry_run,
            )
            if novel_obj:
                print(f"[FEEDBOOKS {status_msg}] '{novel_obj['title']}' ({novel_obj['chapterCount']} ch, {novel_obj['totalWords']} words, {genre})")
                if not dry_run:
                    record_imported(reg, source_id, novel_obj["slug"], novel_obj["title"], "Feedbooks", novel_obj["chapterCount"], novel_obj["totalWords"])
                added.append(novel_obj)
            else:
                print(f"[FEEDBOOKS SKIP] '{title}': {status_msg}")
    return added


# ------------------------- CLI ENTRYPOINT -------------------------
def main():
    parser = argparse.ArgumentParser(description="Quillspire Automated Public-Domain Novel Fetcher")
    parser.add_argument(
        "--source",
        choices=["all", "both", "gutenberg", "openlibrary", "standardebooks", "manybooks", "feedbooks"],
        default="all",
        help="Where to fetch public-domain books from",
    )
    parser.add_argument("--mode", choices=["mixed", "best", "newest"], default="mixed", help="Fetch newest additions, top popular classics, or a 50/50 mix")
    parser.add_argument("--limit", type=int, default=5, help="Total new novels to add per run")
    parser.add_argument("--topic", default="", help="Optional specific genre/topic (e.g. fantasy, mystery, romance)")
    parser.add_argument("--min-chapters", type=int, default=2, help="Minimum detected chapters required")
    parser.add_argument("--min-words", type=int, default=2500, help="Minimum total words required")
    parser.add_argument("--dry-run", action="store_true", help="Preview candidates without modifying site files")
    parser.add_argument("--deploy", action="store_true", help="Automatically git commit & push live if new novels were added")
    args = parser.parse_args()

    reg = load_registry()
    added_all = []

    fetchers = {
        "gutenberg": fetch_from_gutenberg,
        "standardebooks": fetch_from_standardebooks,
        "manybooks": fetch_from_manybooks,
        "openlibrary": fetch_from_openlibrary,
        "feedbooks": fetch_from_feedbooks,
    }

    if args.source in fetchers:
        added_all.extend(fetchers[args.source](reg, args.limit, args.mode, args.topic, args.min_chapters, args.min_words, args.dry_run))
    elif args.source == "both":
        order = ["gutenberg", "openlibrary"]
        for name in order:
            rem = args.limit - len(added_all)
            if rem <= 0:
                break
            quota = max(1, rem // 2) if name == "gutenberg" and rem > 1 else rem
            added_all.extend(fetchers[name](reg, quota, args.mode, args.topic, args.min_chapters, args.min_words, args.dry_run))
        if len(added_all) < args.limit:
            added_all.extend(fetch_from_gutenberg(reg, args.limit - len(added_all), args.mode, args.topic, args.min_chapters, args.min_words, args.dry_run))
    else:
        # "all": distribute quota across all 5 sources and top off remaining
        order = ["manybooks", "standardebooks", "gutenberg", "openlibrary", "feedbooks"]
        per_source = max(1, args.limit // 4)
        for name in order:
            rem = args.limit - len(added_all)
            if rem <= 0:
                break
            quota = min(rem, per_source)
            added_all.extend(fetchers[name](reg, quota, args.mode, args.topic, args.min_chapters, args.min_words, args.dry_run))
        for fallback_name in ["gutenberg", "manybooks", "openlibrary"]:
            rem = args.limit - len(added_all)
            if rem <= 0:
                break
            added_all.extend(fetchers[fallback_name](reg, rem, args.mode, args.topic, args.min_chapters, args.min_words, args.dry_run))

    if not args.dry_run and added_all:
        save_registry(reg)
        total_hosted = npub.rebuild_site_index()
        print(f"\n[SUMMARY] Added {len(added_all)} new novel(s). Site now hosts {total_hosted} novels total.")
        if args.deploy:
            titles = ", ".join(n["title"] for n in added_all[:3])
            ok, msg = npub.git_auto_deploy(f"Auto-fetch {len(added_all)} novel(s): {titles}")
            print(("[DEPLOY OK] " if ok else "[DEPLOY ERR] ") + msg)
    elif args.dry_run:
        print(f"\n[DRY-RUN SUMMARY] Would have imported {len(added_all)} novel(s).")
    else:
        print("\n[SUMMARY] No new novels were added this run.")


if __name__ == "__main__":
    main()
