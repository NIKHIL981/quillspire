// InkRealm Data Store & Persistence Layer
// Supports live HTTP JSON fetching + automatic offline bundle.js fallback + localStorage overlays

const STORAGE_KEYS = {
  USER_PROFILE: 'inkrealm_v2_profile',
  LIBRARY: 'inkrealm_v2_library',       // { [slug]: { shelf: 'Reading'|'Plan to Read'|'Completed'|'On Hold'|'Dropped', addedAt } }
  PROGRESS: 'inkrealm_v2_progress',     // { [slug]: { chapterNumber, scrollPct, readChapters: [1,2], lastReadAt } }
  SETTINGS: 'inkrealm_v2_settings',     // reader & UI preferences
  HIGHLIGHTS: 'inkrealm_v2_highlights', // [ { id, slug, novelTitle, chapterNumber, chapterTitle, text, note, createdAt } ]
  CUSTOM_NOVELS: 'inkrealm_v2_custom_novels', // { [slug]: fullNovelObj }
  VOTES: 'inkrealm_v2_votes',           // { [slug]: count }
  REVIEWS: 'inkrealm_v2_reviews',       // { [slug]: [reviewObj] }
  COMMENTS: 'inkrealm_v2_comments',     // { [chapterId]: [commentObj] }
  REACTIONS: 'inkrealm_v2_reactions',   // { [chapterId]: { fire, cry, mindblown, laugh, heart, userPicked: [] } }
  GITHUB: 'inkrealm_v2_github_cfg',     // { owner, repo, branch, basePath, token }
  STATS: 'inkrealm_v2_stats',           // { chaptersReadCount, wordsRead, lastActiveDay, streakDays }
};

const DEFAULT_SETTINGS = {
  uiTheme: 'dark',
  readerTheme: 'slate',
  fontFamily: 'merriweather',
  fontSize: 19,
  lineHeight: 1.85,
  paraGap: 1.35,
  maxWidth: 760,
  textAlign: 'left',
  ttsRate: 1.0,
  autoScrollSpeed: 1.2,
};

window.InkStore = {
  config: null,
  catalog: [],
  novelCache: {},

  async init() {
    // 1. Load config
    try {
      if (location.protocol !== 'file:') {
        const res = await fetch('config.json?t=' + Date.now());
        if (res.ok) this.config = await res.json();
      }
    } catch (_) {}
    if (!this.config) {
      this.config = window.__INKREALM_CONFIG__ || {
        siteName: 'InkRealm',
        tagline: 'Infinite Worlds, One Chapter at a Time',
        announcement: '',
        adminPin: '1234',
        collections: []
      };
    }

    // 2. Load base catalog
    let serverCatalog = [];
    try {
      if (location.protocol !== 'file:') {
        const res = await fetch('data/catalog.json?t=' + Date.now());
        if (res.ok) {
          const data = await res.json();
          serverCatalog = data.novels || [];
        }
      }
    } catch (_) {}

    if (!serverCatalog.length && window.__INKREALM_CATALOG__) {
      serverCatalog = window.__INKREALM_CATALOG__.novels || [];
    }

    // 3. Merge browser-created / edited novels from localStorage
    const customNovels = this.getCustomNovels();
    const map = new Map();
    serverCatalog.forEach(n => map.set(n.slug, { ...n }));
    Object.values(customNovels).forEach(full => {
      map.set(full.slug, this.toCatalogSummary(full));
      this.novelCache[full.slug] = full;
    });

    this.catalog = Array.from(map.values());
    this.applyUiTheme();
  },

  toCatalogSummary(full) {
    const chapters = full.chapters || [];
    const totalWords = chapters.reduce((acc, c) => acc + (c.wordCount || this.countWords(c.content || '')), 0);
    const lastCh = chapters[chapters.length - 1];
    return {
      slug: full.slug,
      title: full.title,
      author: full.author || 'Unknown Author',
      genre: full.genre || 'Fantasy',
      tags: full.tags || [],
      status: full.status || 'Ongoing',
      contentRating: full.contentRating || 'Teen',
      featured: Boolean(full.featured),
      cover: full.cover || '',
      views: full.views || 1,
      bookmarks: full.bookmarks || 0,
      powerStones: full.powerStones || 0,
      rating: full.rating || 4.8,
      synopsis: full.synopsis || '',
      totalWords,
      chapterCount: chapters.length,
      latestChapterTitle: lastCh ? lastCh.title : 'Coming Soon',
      latestChapterNumber: chapters.length,
      updatedAt: full.updatedAt || new Date().toISOString().slice(0, 10),
      createdAt: full.createdAt || new Date().toISOString().slice(0, 10),
    };
  },

  async getNovel(slug) {
    // Prefer locally modified version if present
    const custom = this.getCustomNovels();
    if (custom[slug]) {
      this.novelCache[slug] = custom[slug];
      return custom[slug];
    }
    if (this.novelCache[slug]) return this.novelCache[slug];

    let novel = null;
    try {
      if (location.protocol !== 'file:') {
        const res = await fetch(`data/novels/${encodeURIComponent(slug)}.json?t=` + Date.now());
        if (res.ok) novel = await res.json();
      }
    } catch (_) {}

    if (!novel && window.__INKREALM_NOVELS__ && window.__INKREALM_NOVELS__[slug]) {
      novel = JSON.parse(JSON.stringify(window.__INKREALM_NOVELS__[slug]));
    }
    if (novel) this.novelCache[slug] = novel;
    return novel;
  },

  async getAllFullNovels() {
    const result = {};
    for (const item of this.catalog) {
      const full = await this.getNovel(item.slug);
      if (full) result[item.slug] = full;
    }
    return result;
  },

  saveCustomNovel(novelObj) {
    const custom = this.getCustomNovels();
    novelObj.totalWords = (novelObj.chapters || []).reduce((a, c) => a + (c.wordCount || this.countWords(c.content || '')), 0);
    novelObj.chapterCount = (novelObj.chapters || []).length;
    novelObj.updatedAt = new Date().toISOString().slice(0, 10);
    if (!novelObj.createdAt) novelObj.createdAt = novelObj.updatedAt;
    custom[novelObj.slug] = novelObj;
    this._write(STORAGE_KEYS.CUSTOM_NOVELS, custom);
    this.novelCache[novelObj.slug] = novelObj;

    // Update catalog in memory
    const summary = this.toCatalogSummary(novelObj);
    const idx = this.catalog.findIndex(n => n.slug === novelObj.slug);
    if (idx >= 0) this.catalog[idx] = summary;
    else this.catalog.unshift(summary);
    return novelObj;
  },

  deleteCustomNovel(slug) {
    const custom = this.getCustomNovels();
    delete custom[slug];
    this._write(STORAGE_KEYS.CUSTOM_NOVELS, custom);
    delete this.novelCache[slug];
    this.catalog = this.catalog.filter(n => n.slug !== slug);
  },

  getCustomNovels() {
    return this._read(STORAGE_KEYS.CUSTOM_NOVELS, {});
  },

  // Profile & Settings
  getProfile() {
    return this._read(STORAGE_KEYS.USER_PROFILE, { username: 'GuestReader', bio: 'Avid web novel explorer.' });
  },
  saveProfile(p) {
    this._write(STORAGE_KEYS.USER_PROFILE, p);
  },

  getSettings() {
    return { ...DEFAULT_SETTINGS, ...this._read(STORAGE_KEYS.SETTINGS, {}) };
  },
  saveSettings(partial) {
    const next = { ...this.getSettings(), ...partial };
    this._write(STORAGE_KEYS.SETTINGS, next);
    this.applyUiTheme();
    return next;
  },
  applyUiTheme() {
    const s = this.getSettings();
    document.documentElement.classList.toggle('light-ui', s.uiTheme === 'light');
  },

  // Library Shelves
  getLibrary() {
    return this._read(STORAGE_KEYS.LIBRARY, {});
  },
  setShelf(slug, shelf) {
    const lib = this.getLibrary();
    if (!shelf) delete lib[slug];
    else lib[slug] = { shelf, addedAt: new Date().toISOString().slice(0, 10) };
    this._write(STORAGE_KEYS.LIBRARY, lib);
    return lib;
  },
  getShelf(slug) {
    return this.getLibrary()[slug]?.shelf || null;
  },

  // Reading Progress & Stats
  getProgressAll() {
    return this._read(STORAGE_KEYS.PROGRESS, {});
  },
  getProgress(slug) {
    return this.getProgressAll()[slug] || null;
  },
  saveProgress(slug, chapterNumber, scrollPct = 0, wordCount = 0) {
    const all = this.getProgressAll();
    const prev = all[slug] || { readChapters: [] };
    const isNewChapter = !prev.readChapters.includes(chapterNumber);
    const readChapters = isNewChapter ? [...prev.readChapters, chapterNumber] : prev.readChapters;
    all[slug] = {
      chapterNumber,
      scrollPct: Math.min(100, Math.max(0, Math.round(scrollPct))),
      readChapters,
      lastReadAt: new Date().toISOString(),
    };
    this._write(STORAGE_KEYS.PROGRESS, all);

    if (isNewChapter) {
      this.recordReadingActivity(wordCount);
    }
  },

  getStats() {
    return this._read(STORAGE_KEYS.STATS, { chaptersReadCount: 0, wordsRead: 0, lastActiveDay: '', streakDays: 0 });
  },
  recordReadingActivity(words = 0) {
    const stats = this.getStats();
    const today = new Date().toISOString().slice(0, 10);
    if (stats.lastActiveDay !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      stats.streakDays = stats.lastActiveDay === yesterday ? stats.streakDays + 1 : 1;
      stats.lastActiveDay = today;
    }
    stats.chaptersReadCount += 1;
    stats.wordsRead += Number(words) || 0;
    this._write(STORAGE_KEYS.STATS, stats);
  },

  // Quotes / Highlights
  getHighlights() {
    return this._read(STORAGE_KEYS.HIGHLIGHTS, []);
  },
  addHighlight(item) {
    const list = this.getHighlights();
    list.unshift({ ...item, id: 'hl-' + Date.now(), createdAt: new Date().toISOString().slice(0, 10) });
    this._write(STORAGE_KEYS.HIGHLIGHTS, list);
    return list;
  },
  deleteHighlight(id) {
    const list = this.getHighlights().filter(h => h.id !== id);
    this._write(STORAGE_KEYS.HIGHLIGHTS, list);
  },

  // Power Stone Votes
  getVotes(slug) {
    const v = this._read(STORAGE_KEYS.VOTES, {});
    return v[slug] || 0;
  },
  addVote(slug) {
    const v = this._read(STORAGE_KEYS.VOTES, {});
    v[slug] = (v[slug] || 0) + 1;
    this._write(STORAGE_KEYS.VOTES, v);
    const cat = this.catalog.find(n => n.slug === slug);
    if (cat) cat.powerStones = (cat.powerStones || 0) + 1;
    return v[slug];
  },

  // Reviews
  getReviews(slug, baseReviews = []) {
    const local = this._read(STORAGE_KEYS.REVIEWS, {})[slug] || [];
    return [...local, ...baseReviews];
  },
  addReview(slug, review) {
    const all = this._read(STORAGE_KEYS.REVIEWS, {});
    all[slug] = [{ ...review, id: 'rev-' + Date.now(), date: new Date().toISOString().slice(0, 10), helpful: 0 }, ...(all[slug] || [])];
    this._write(STORAGE_KEYS.REVIEWS, all);
  },

  // Chapter Comments & Reactions
  getComments(chapterId, baseComments = []) {
    const local = this._read(STORAGE_KEYS.COMMENTS, {})[chapterId] || [];
    return [...local, ...baseComments];
  },
  addComment(chapterId, comment) {
    const all = this._read(STORAGE_KEYS.COMMENTS, {});
    all[chapterId] = [{ ...comment, id: 'cmt-' + Date.now(), date: new Date().toISOString().slice(0, 10), likes: 0 }, ...(all[chapterId] || [])];
    this._write(STORAGE_KEYS.COMMENTS, all);
  },

  getReactions(chapterId, base = { fire: 0, cry: 0, mindblown: 0, laugh: 0, heart: 0 }) {
    const all = this._read(STORAGE_KEYS.REACTIONS, {});
    const saved = all[chapterId] || { deltas: {}, picked: [] };
    const merged = {};
    ['fire', 'cry', 'mindblown', 'laugh', 'heart'].forEach(k => {
      merged[k] = (base[k] || 0) + (saved.deltas[k] || 0);
    });
    return { counts: merged, picked: saved.picked || [] };
  },
  toggleReaction(chapterId, key) {
    const all = this._read(STORAGE_KEYS.REACTIONS, {});
    const cur = all[chapterId] || { deltas: {}, picked: [] };
    if (cur.picked.includes(key)) {
      cur.picked = cur.picked.filter(k => k !== key);
      cur.deltas[key] = (cur.deltas[key] || 0) - 1;
    } else {
      cur.picked.push(key);
      cur.deltas[key] = (cur.deltas[key] || 0) + 1;
    }
    all[chapterId] = cur;
    this._write(STORAGE_KEYS.REACTIONS, all);
  },

  // GitHub Auto-Publisher Config
  getGithubConfig() {
    return this._read(STORAGE_KEYS.GITHUB, { owner: '', repo: '', branch: 'main', basePath: 'site', token: '' });
  },
  saveGithubConfig(cfg) {
    this._write(STORAGE_KEYS.GITHUB, cfg);
  },

  // Backup / Restore Entire User Profile
  exportUserBackup() {
    const payload = {
      exportedAt: new Date().toISOString(),
      profile: this.getProfile(),
      library: this.getLibrary(),
      progress: this.getProgressAll(),
      settings: this.getSettings(),
      highlights: this.getHighlights(),
      stats: this.getStats(),
      customNovels: this.getCustomNovels(),
    };
    return JSON.stringify(payload, null, 2);
  },
  importUserBackup(jsonText) {
    const data = JSON.parse(jsonText);
    if (data.profile) this._write(STORAGE_KEYS.USER_PROFILE, data.profile);
    if (data.library) this._write(STORAGE_KEYS.LIBRARY, data.library);
    if (data.progress) this._write(STORAGE_KEYS.PROGRESS, data.progress);
    if (data.settings) this._write(STORAGE_KEYS.SETTINGS, data.settings);
    if (data.highlights) this._write(STORAGE_KEYS.HIGHLIGHTS, data.highlights);
    if (data.stats) this._write(STORAGE_KEYS.STATS, data.stats);
    if (data.customNovels) this._write(STORAGE_KEYS.CUSTOM_NOVELS, data.customNovels);
  },

  countWords(str) {
    return (str || '').trim().split(/\s+/).filter(Boolean).length;
  },
  slugify(str) {
    return (str || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('novel-' + Date.now());
  },
  _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  },
  _write(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.error('Storage write failed:', e);
    }
  }
};
