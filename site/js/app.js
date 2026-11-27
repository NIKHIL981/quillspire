// InkRealm 2.0 — Complete Interactive Web Novel Platform SPA

const AppState = {
  route: 'home',
  heroIdx: 0,
  heroTimer: null,
  browse: {
    query: '',
    genre: 'All',
    status: 'All',
    rating: 'All',
    minChapters: 0,
    includeTags: [],
    excludeTags: [],
    sort: 'trending',
  },
  rankingsTab: 'trending',
  rankingsGenre: 'All',
  libraryShelf: 'All',
  novelDetailTab: 'toc',
  tocSortAsc: true,
  tocQuery: '',
  reader: {
    novel: null,
    chapterIdx: 0,
    ttsActive: false,
    ttsParaIdx: -1,
    autoScrollActive: false,
    autoScrollRaf: null,
    scrollAccum: 0,
  },
  studio: {
    tab: 'bulk', // 'bulk' | 'novels' | 'editor' | 'github'
    editingSlug: null,
    editingChapterIdx: null,
    stagedImport: null, // { title, author, genre, status, tags, synopsis, cover, chapters }
    targetExistingSlug: '',
  }
};

// ------------------------- UTILITIES -------------------------
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const colors = {
    info: 'bg-indigo-600 text-white',
    success: 'bg-emerald-600 text-white',
    warn: 'bg-amber-600 text-white',
    error: 'bg-rose-600 text-white',
  };
  const el = document.createElement('div');
  el.className = `${colors[type] || colors.info} px-4 py-2.5 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2 fade-in`;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.25s'; setTimeout(() => el.remove(), 260); }, 3200);
}

function openModal(html) {
  const bd = document.getElementById('modal-backdrop');
  const box = document.getElementById('modal-box');
  box.innerHTML = html;
  bd.classList.remove('hidden');
  refreshIcons();
}
function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
}

function refreshIcons() {
  if (window.lucide) lucide.createIcons();
}

function allGenres() {
  const set = new Set(['Xianxia', 'LitRPG', 'Fantasy', 'Sci-Fi', 'Mystery', 'Romance', 'Slice of Life', 'Steampunk']);
  InkStore.catalog.forEach(n => { if (n.genre) set.add(n.genre); });
  return Array.from(set);
}

function allTags() {
  const counts = {};
  InkStore.catalog.forEach(n => (n.tags || []).forEach(t => counts[t] = (counts[t] || 0) + 1));
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

function toggleUiTheme() {
  const cur = InkStore.getSettings().uiTheme;
  InkStore.saveSettings({ uiTheme: cur === 'dark' ? 'light' : 'dark' });
  updateUiThemeIcon();
}

function updateUiThemeIcon() {
  const btn = document.getElementById('ui-theme-btn');
  if (!btn) return;
  const isLight = InkStore.getSettings().uiTheme === 'light';
  btn.innerHTML = `<i data-lucide="${isLight ? 'moon' : 'sun'}" class="w-4 h-4"></i>`;
  refreshIcons();
}

function toggleMobileMenu() {
  document.getElementById('mobile-menu')?.classList.toggle('hidden');
}

function dismissAnnouncement() {
  document.getElementById('announcement-bar')?.classList.add('hidden');
  sessionStorage.setItem('inkrealm_ann_dismissed', '1');
}

// ------------------------- ROUTER -------------------------
async function handleRoute() {
  stopTTS();
  stopAutoScroll();
  if (AppState.heroTimer) { clearInterval(AppState.heroTimer); AppState.heroTimer = null; }

  const rawHash = (location.hash || '#home').slice(1);
  const parts = rawHash.split('/').filter(Boolean);
  const route = parts[0] || 'home';
  AppState.route = route;

  const isReader = route === 'read';
  document.getElementById('main-navbar').classList.toggle('hidden', isReader);
  document.getElementById('main-footer').classList.toggle('hidden', isReader);
  document.getElementById('read-progress-bar').classList.toggle('hidden', !isReader);

  document.querySelectorAll('.nav-link').forEach(el => {
    const active = el.dataset.nav === route;
    el.classList.toggle('bg-indigo-500/15', active);
    el.classList.toggle('text-indigo-400', active);
  });

  window.scrollTo({ top: 0, behavior: 'instant' });

  if (route === 'home') renderHome();
  else if (route === 'browse') renderBrowse();
  else if (route === 'rankings') renderRankings();
  else if (route === 'library') renderLibrary();
  else if (route === 'novel' && parts[1]) await renderNovelDetail(decodeURIComponent(parts[1]));
  else if (route === 'read' && parts[1]) await renderReader(decodeURIComponent(parts[1]), Number(parts[2] || 1));
  else if (route === 'studio' || route === 'admin') renderStudio();
  else renderHome();

  refreshIcons();
}

// ------------------------- SHARED CARD RENDERER -------------------------
function renderNovelCard(n, compact = false) {
  const shelf = InkStore.getShelf(n.slug);
  const statusColor = n.status === 'Completed' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
    : n.status === 'Hiatus' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
    : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';

  return `
  <a href="#novel/${encodeURIComponent(n.slug)}" class="surface-card cover-card rounded-2xl overflow-hidden flex flex-col group">
    <div class="relative aspect-[2/3] w-full overflow-hidden bg-slate-900">
      <img src="${esc(n.cover || InkImporter.generateCoverDataUrl(n.title, n.author, n.genre))}" alt="${esc(n.title)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" loading="lazy" />
      <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent"></div>
      <div class="absolute top-2.5 left-2.5 flex flex-wrap gap-1">
        <span class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md border backdrop-blur-md ${statusColor}">${esc(n.status)}</span>
      </div>
      ${shelf ? `<div class="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow" title="In Library: ${esc(shelf)}"><i data-lucide="bookmark-check" class="w-3.5 h-3.5"></i></div>` : ''}
      <div class="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between text-xs text-white/95 font-semibold">
        <span class="flex items-center gap-1 bg-black/50 backdrop-blur px-2 py-0.5 rounded-full"><i data-lucide="star" class="w-3 h-3 text-amber-400 fill-amber-400"></i> ${Number(n.rating || 4.8).toFixed(1)}</span>
        <span class="bg-black/50 backdrop-blur px-2 py-0.5 rounded-full">${n.chapterCount || 0} Ch</span>
      </div>
    </div>
    <div class="p-3.5 flex-1 flex flex-col">
      <div class="text-[11px] font-semibold text-indigo-400 mb-0.5">${esc(n.genre)}</div>
      <h3 class="font-bold text-sm leading-snug line-clamp-2 group-hover:text-indigo-400 transition">${esc(n.title)}</h3>
      <div class="text-xs text-muted mt-1 truncate">by ${esc(n.author)}</div>
      ${compact ? '' : `<p class="text-xs text-muted mt-2 line-clamp-2 flex-1">${esc(n.synopsis)}</p>`}
      <div class="mt-3 pt-2.5 border-t border-subtle flex items-center justify-between text-[11px] text-muted">
        <span class="flex items-center gap-1"><i data-lucide="eye" class="w-3 h-3"></i> ${fmtNum(n.views)}</span>
        <span class="flex items-center gap-1"><i data-lucide="flame" class="w-3 h-3 text-amber-400"></i> ${fmtNum((n.powerStones || 0) + InkStore.getVotes(n.slug))}</span>
      </div>
    </div>
  </a>`;
}

// ------------------------- HOME VIEW -------------------------
function renderHome() {
  const root = document.getElementById('app-root');
  const featured = InkStore.catalog.filter(n => n.featured);
  const heroList = featured.length ? featured : InkStore.catalog.slice(0, 4);
  if (AppState.heroIdx >= heroList.length) AppState.heroIdx = 0;

  // Continue Reading Strip
  const progressAll = InkStore.getProgressAll();
  const continueItems = Object.entries(progressAll)
    .map(([slug, prog]) => ({ novel: InkStore.catalog.find(n => n.slug === slug), prog }))
    .filter(x => x.novel)
    .sort((a, b) => (b.prog.lastReadAt || '').localeCompare(a.prog.lastReadAt || ''))
    .slice(0, 4);

  const trending = [...InkStore.catalog].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8);
  const latest = [...InkStore.catalog].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 8);
  const genres = allGenres();
  const collections = InkStore.config?.collections || [];

  root.innerHTML = `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-12 fade-in">
    <!-- Hero Spotlight Carousel -->
    <section id="hero-carousel" class="relative rounded-3xl overflow-hidden surface-card shadow-2xl">
      ${renderHeroSlide(heroList[AppState.heroIdx], heroList.length, AppState.heroIdx)}
    </section>

    <!-- Quick Genre Pills -->
    <section class="flex items-center gap-2 overflow-x-auto pb-2">
      <button onclick="goBrowseGenre('All')" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold bg-indigo-600 text-white shadow">All Genres</button>
      ${genres.map(g => `
        <button onclick="goBrowseGenre('${esc(g)}')" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold surface-card hover:border-indigo-500/60 hover:text-indigo-400 transition">${esc(g)}</button>
      `).join('')}
    </section>

    ${continueItems.length ? `
    <!-- Continue Reading -->
    <section>
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-extrabold flex items-center gap-2"><i data-lucide="history" class="w-5 h-5 text-indigo-400"></i> Continue Reading</h2>
        <a href="#library" class="text-xs font-semibold text-indigo-400 hover:underline">Full History &rarr;</a>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        ${continueItems.map(({ novel, prog }) => `
          <a href="#read/${encodeURIComponent(novel.slug)}/${prog.chapterNumber}" class="surface-card cover-card rounded-2xl p-3 flex gap-3 items-center">
            <img src="${esc(novel.cover)}" class="w-14 h-20 rounded-lg object-cover shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="font-bold text-sm truncate">${esc(novel.title)}</div>
              <div class="text-xs text-indigo-400 font-medium mt-0.5">Chapter ${prog.chapterNumber} &bull; ${prog.scrollPct || 0}%</div>
              <div class="w-full h-1.5 bg-slate-700/50 rounded-full mt-2 overflow-hidden">
                <div class="h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 rounded-full" style="width:${Math.max(6, prog.scrollPct || 0)}%"></div>
              </div>
              <div class="text-[11px] text-muted mt-1.5">${prog.readChapters?.length || 1} / ${novel.chapterCount} ch read</div>
            </div>
          </a>
        `).join('')}
      </div>
    </section>` : ''}

    <!-- Trending Novels -->
    <section>
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-xl font-extrabold flex items-center gap-2"><i data-lucide="flame" class="w-5 h-5 text-amber-400"></i> Trending Novels</h2>
          <p class="text-xs text-muted mt-0.5">Most read stories across ${esc(InkStore.config.siteName)}</p>
        </div>
        <a href="#rankings" class="text-xs font-semibold text-indigo-400 hover:underline">View Top Charts &rarr;</a>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
        ${trending.map(n => renderNovelCard(n)).join('')}
      </div>
    </section>

    <!-- Curated Collections -->
    ${collections.length ? `
    <section>
      <h2 class="text-xl font-extrabold flex items-center gap-2 mb-4"><i data-lucide="sparkles" class="w-5 h-5 text-fuchsia-400"></i> Curated Reading Collections</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        ${collections.map(col => {
          const matches = InkStore.catalog.filter(n => col.genres.includes(n.genre));
          return `
          <div class="surface-card rounded-2xl p-5 flex flex-col justify-between gap-4 hover:border-indigo-500/40 transition">
            <div>
              <div class="text-xs font-bold uppercase tracking-wider text-indigo-400">${col.genres.join(' &bull; ')}</div>
              <h3 class="text-lg font-extrabold mt-1">${esc(col.title)}</h3>
              <p class="text-xs text-muted mt-1">${esc(col.subtitle)}</p>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex -space-x-3">
                ${matches.slice(0, 3).map(m => `<img src="${esc(m.cover)}" class="w-10 h-14 rounded-md object-cover border-2 border-[var(--bg-card)] shadow" />`).join('')}
              </div>
              <button onclick="goBrowseGenre('${esc(col.genres[0])}')" class="px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 text-xs font-bold hover:bg-indigo-600 hover:text-white transition">Explore ${matches.length} Titles</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </section>` : ''}

    <!-- Latest Chapter Releases -->
    <section>
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-extrabold flex items-center gap-2"><i data-lucide="clock" class="w-5 h-5 text-emerald-400"></i> Latest Chapter Updates</h2>
        <a href="#browse" class="text-xs font-semibold text-indigo-400 hover:underline">Browse All &rarr;</a>
      </div>
      <div class="surface-card rounded-2xl divide-y divide-[var(--border-color)] overflow-hidden">
        ${latest.map(n => `
          <div class="p-3.5 sm:px-5 flex items-center justify-between gap-4 hover:bg-[var(--bg-hover)] transition">
            <a href="#novel/${encodeURIComponent(n.slug)}" class="flex items-center gap-3.5 min-w-0 flex-1">
              <img src="${esc(n.cover)}" class="w-10 h-14 rounded-lg object-cover shrink-0" />
              <div class="min-w-0">
                <div class="font-bold text-sm truncate hover:text-indigo-400">${esc(n.title)}</div>
                <div class="text-xs text-muted truncate mt-0.5">${esc(n.latestChapterTitle || ('Chapter ' + n.chapterCount))}</div>
              </div>
            </a>
            <div class="flex items-center gap-3 shrink-0">
              <span class="hidden sm:inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/10 text-indigo-400">${esc(n.genre)}</span>
              <span class="text-xs text-muted">${esc(n.updatedAt)}</span>
              <a href="#read/${encodeURIComponent(n.slug)}/${n.latestChapterNumber || 1}" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition">Read</a>
            </div>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- Author Callout Banner -->
    <section class="rounded-3xl p-6 sm:p-8 bg-gradient-to-r from-indigo-900/60 via-violet-900/50 to-fuchsia-900/40 border border-indigo-500/30 flex flex-col sm:flex-row items-center justify-between gap-6">
      <div>
        <span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-500/30 text-indigo-200 uppercase tracking-wider">Zero-Friction Publishing</span>
        <h3 class="text-2xl font-extrabold mt-2">Drop a Novel File & Publish in Seconds</h3>
        <p class="text-sm text-indigo-100/80 mt-1 max-w-xl">Upload .TXT, .MD, .DOCX, .EPUB, or chapter folders in the Publisher Studio — chapters auto-split, covers auto-generate, and 1-click GitHub Sync pushes live automatically.</p>
      </div>
      <a href="#studio" class="shrink-0 px-6 py-3 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-indigo-100 transition shadow-lg flex items-center gap-2">
        <i data-lucide="upload-cloud" class="w-4 h-4"></i> Open Publisher Studio
      </a>
    </section>
  </div>`;

  if (heroList.length > 1) {
    AppState.heroTimer = setInterval(() => {
      if (AppState.route !== 'home') return;
      AppState.heroIdx = (AppState.heroIdx + 1) % heroList.length;
      const box = document.getElementById('hero-carousel');
      if (box) { box.innerHTML = renderHeroSlide(heroList[AppState.heroIdx], heroList.length, AppState.heroIdx); refreshIcons(); }
    }, 6500);
  }
}

function renderHeroSlide(n, total, idx) {
  if (!n) return '<div class="p-10 text-center text-muted">No novels yet. Open Publisher Studio to add your first novel!</div>';
  return `
  <div class="relative p-6 sm:p-10 flex flex-col md:flex-row items-center gap-8 overflow-hidden">
    <div class="absolute inset-0 opacity-20 blur-3xl pointer-events-none" style="background: radial-gradient(circle at 20% 50%, #6366f1, transparent 60%), radial-gradient(circle at 80% 30%, #f59e0b, transparent 60%);"></div>
    <img src="${esc(n.cover)}" class="relative w-40 sm:w-48 aspect-[2/3] rounded-2xl object-cover shadow-2xl border border-white/15 shrink-0" />
    <div class="relative flex-1 text-center md:text-left space-y-3">
      <div class="flex flex-wrap items-center justify-center md:justify-start gap-2">
        <span class="px-3 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">FEATURED SPOTLIGHT</span>
        <span class="px-3 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300">${esc(n.genre)}</span>
        <span class="text-xs text-muted flex items-center gap-1"><i data-lucide="star" class="w-3.5 h-3.5 text-amber-400 fill-amber-400"></i> ${Number(n.rating || 4.8).toFixed(1)}</span>
      </div>
      <h1 class="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight">${esc(n.title)}</h1>
      <div class="text-sm text-muted">by <span class="font-semibold text-[var(--text-primary)]">${esc(n.author)}</span> &bull; ${n.chapterCount} Chapters &bull; ${fmtNum(n.totalWords)} Words</div>
      <p class="text-sm text-muted line-clamp-3 max-w-2xl">${esc(n.synopsis)}</p>
      <div class="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-2">
        <a href="#read/${encodeURIComponent(n.slug)}/1" class="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/30 transition flex items-center gap-2">
          <i data-lucide="book-open-text" class="w-4 h-4"></i> Start Reading
        </a>
        <a href="#novel/${encodeURIComponent(n.slug)}" class="px-5 py-2.5 rounded-xl surface-subtle hover:border-indigo-500/60 font-semibold text-sm transition">Details & Chapters</a>
      </div>
    </div>
    ${total > 1 ? `
    <div class="absolute bottom-4 right-5 flex items-center gap-1.5">
      ${Array.from({ length: total }).map((_, i) => `
        <button onclick="setHeroSlide(${i})" class="h-2 rounded-full transition-all ${i === idx ? 'w-7 bg-indigo-500' : 'w-2 bg-slate-500/50 hover:bg-slate-400'}"></button>
      `).join('')}
    </div>` : ''}
  </div>`;
}

function setHeroSlide(i) {
  AppState.heroIdx = i;
  const featured = InkStore.catalog.filter(n => n.featured);
  const heroList = featured.length ? featured : InkStore.catalog.slice(0, 4);
  const box = document.getElementById('hero-carousel');
  if (box) { box.innerHTML = renderHeroSlide(heroList[i], heroList.length, i); refreshIcons(); }
}

function goBrowseGenre(g) {
  AppState.browse.genre = g;
  location.hash = '#browse';
}

// ------------------------- BROWSE & ADVANCED SEARCH -------------------------
function renderBrowse() {
  const root = document.getElementById('app-root');
  const b = AppState.browse;
  const genres = ['All', ...allGenres()];
  const tags = allTags().slice(0, 24);

  let filtered = InkStore.catalog.filter(n => {
    if (b.genre !== 'All' && n.genre !== b.genre) return false;
    if (b.status !== 'All' && n.status !== b.status) return false;
    if (b.rating !== 'All' && n.contentRating !== b.rating) return false;
    if ((n.chapterCount || 0) < b.minChapters) return false;
    if (b.query) {
      const q = b.query.toLowerCase();
      const hay = `${n.title} ${n.author} ${n.genre} ${n.synopsis} ${(n.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const nTags = (n.tags || []).map(t => t.toLowerCase());
    if (b.includeTags.some(t => !nTags.includes(t.toLowerCase()))) return false;
    if (b.excludeTags.some(t => nTags.includes(t.toLowerCase()))) return false;
    return true;
  });

  if (b.sort === 'trending') filtered.sort((a, b2) => (b2.views || 0) - (a.views || 0));
  else if (b.sort === 'rating') filtered.sort((a, b2) => (b2.rating || 0) - (a.rating || 0));
  else if (b.sort === 'updated') filtered.sort((a, b2) => (b2.updatedAt || '').localeCompare(a.updatedAt || ''));
  else if (b.sort === 'chapters') filtered.sort((a, b2) => (b2.chapterCount || 0) - (a.chapterCount || 0));
  else if (b.sort === 'words') filtered.sort((a, b2) => (b2.totalWords || 0) - (a.totalWords || 0));

  root.innerHTML = `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6 fade-in">
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl sm:text-3xl font-extrabold">Browse & Advanced Filter</h1>
        <p class="text-sm text-muted mt-1">Click a tag once to <span class="text-emerald-400 font-semibold">Include</span>, click again to <span class="text-rose-400 font-semibold">Exclude</span>, third click resets.</p>
      </div>
      <div class="text-sm font-semibold text-indigo-400">${filtered.length} novels found</div>
    </div>

    <!-- Filter Panel -->
    <div class="surface-card rounded-2xl p-5 space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <input id="browse-q" value="${esc(b.query)}" oninput="updateBrowse('query', this.value)" placeholder="Search title, author, synopsis..." class="lg:col-span-2 px-3.5 py-2 rounded-xl surface-subtle text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <select onchange="updateBrowse('genre', this.value)" class="px-3 py-2 rounded-xl surface-subtle text-sm">
          ${genres.map(g => `<option value="${esc(g)}" ${b.genre === g ? 'selected' : ''}>Genre: ${esc(g)}</option>`).join('')}
        </select>
        <select onchange="updateBrowse('status', this.value)" class="px-3 py-2 rounded-xl surface-subtle text-sm">
          ${['All', 'Ongoing', 'Completed', 'Hiatus'].map(s => `<option value="${s}" ${b.status === s ? 'selected' : ''}>Status: ${s}</option>`).join('')}
        </select>
        <select onchange="updateBrowse('sort', this.value)" class="px-3 py-2 rounded-xl surface-subtle text-sm">
          <option value="trending" ${b.sort === 'trending' ? 'selected' : ''}>Sort: Trending</option>
          <option value="rating" ${b.sort === 'rating' ? 'selected' : ''}>Sort: Highest Rated</option>
          <option value="updated" ${b.sort === 'updated' ? 'selected' : ''}>Sort: Recently Updated</option>
          <option value="chapters" ${b.sort === 'chapters' ? 'selected' : ''}>Sort: Most Chapters</option>
          <option value="words" ${b.sort === 'words' ? 'selected' : ''}>Sort: Longest Word Count</option>
        </select>
      </div>

      <!-- Tri-state Tag Filter -->
      <div class="flex flex-wrap items-center gap-2 pt-1">
        <span class="text-xs font-bold text-muted uppercase tracking-wider mr-1">Tags:</span>
        ${tags.map(t => {
          const isInc = b.includeTags.includes(t);
          const isExc = b.excludeTags.includes(t);
          const cls = isInc ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
            : isExc ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 line-through'
            : 'surface-subtle text-muted hover:text-[var(--text-primary)]';
          return `<button onclick="cycleTagFilter('${esc(t)}')" class="px-2.5 py-1 rounded-lg text-xs font-medium border transition ${cls}">${isInc ? '+ ' : isExc ? '− ' : ''}${esc(t)}</button>`;
        }).join('')}
        ${(b.includeTags.length || b.excludeTags.length || b.query || b.genre !== 'All' || b.status !== 'All') ? `
          <button onclick="resetBrowseFilters()" class="ml-auto px-3 py-1 rounded-lg text-xs font-bold text-rose-400 hover:bg-rose-500/10">Reset All</button>
        ` : ''}
      </div>
    </div>

    <!-- Results Grid -->
    ${filtered.length ? `
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
        ${filtered.map(n => renderNovelCard(n)).join('')}
      </div>
    ` : `
      <div class="surface-card rounded-2xl p-12 text-center space-y-3">
        <i data-lucide="search-x" class="w-10 h-10 text-muted mx-auto"></i>
        <div class="font-bold text-lg">No matching novels found</div>
        <p class="text-sm text-muted">Try removing an excluded tag or clearing your search query.</p>
        <button onclick="resetBrowseFilters()" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold">Reset Filters</button>
      </div>
    `}
  </div>`;
}

function updateBrowse(key, val) {
  AppState.browse[key] = val;
  renderBrowse();
  refreshIcons();
}

function cycleTagFilter(tag) {
  const b = AppState.browse;
  if (b.includeTags.includes(tag)) {
    b.includeTags = b.includeTags.filter(t => t !== tag);
    b.excludeTags.push(tag);
  } else if (b.excludeTags.includes(tag)) {
    b.excludeTags = b.excludeTags.filter(t => t !== tag);
  } else {
    b.includeTags.push(tag);
  }
  renderBrowse();
  refreshIcons();
}

function resetBrowseFilters() {
  AppState.browse = { query: '', genre: 'All', status: 'All', rating: 'All', minChapters: 0, includeTags: [], excludeTags: [], sort: 'trending' };
  renderBrowse();
  refreshIcons();
}

// ------------------------- RANKINGS VIEW -------------------------
function renderRankings() {
  const root = document.getElementById('app-root');
  const tabs = [
    { id: 'trending', label: 'Most Viewed', icon: 'eye' },
    { id: 'power', label: 'Power Stone Leaders', icon: 'flame' },
    { id: 'rating', label: 'Highest Rated', icon: 'star' },
    { id: 'bookmarks', label: 'Most Bookmarked', icon: 'bookmark' },
    { id: 'completed', label: 'Completed Gems', icon: 'check-circle-2' },
  ];

  let list = [...InkStore.catalog];
  if (AppState.rankingsGenre !== 'All') list = list.filter(n => n.genre === AppState.rankingsGenre);
  if (AppState.rankingsTab === 'completed') list = list.filter(n => n.status === 'Completed');

  list.sort((a, b) => {
    if (AppState.rankingsTab === 'power') return ((b.powerStones || 0) + InkStore.getVotes(b.slug)) - ((a.powerStones || 0) + InkStore.getVotes(a.slug));
    if (AppState.rankingsTab === 'rating') return (b.rating || 0) - (a.rating || 0);
    if (AppState.rankingsTab === 'bookmarks') return (b.bookmarks || 0) - (a.bookmarks || 0);
    return (b.views || 0) - (a.views || 0);
  });

  root.innerHTML = `
  <div class="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6 fade-in">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl sm:text-3xl font-extrabold flex items-center gap-2"><i data-lucide="trophy" class="w-7 h-7 text-amber-400"></i> Top Charts & Rankings</h1>
        <p class="text-sm text-muted mt-1">Live leaderboards ranked by reader votes, ratings, and views.</p>
      </div>
      <select onchange="AppState.rankingsGenre=this.value;renderRankings();refreshIcons();" class="px-3.5 py-2 rounded-xl surface-card text-sm">
        <option value="All">All Genres</option>
        ${allGenres().map(g => `<option value="${esc(g)}" ${AppState.rankingsGenre === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
      </select>
    </div>

    <div class="flex flex-wrap gap-2">
      ${tabs.map(t => `
        <button onclick="AppState.rankingsTab='${t.id}';renderRankings();refreshIcons();"
          class="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition ${AppState.rankingsTab === t.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25' : 'surface-card hover:border-indigo-500/50'}">
          <i data-lucide="${t.icon}" class="w-4 h-4"></i> ${t.label}
        </button>
      `).join('')}
    </div>

    <div class="space-y-3">
      ${list.map((n, i) => {
        const medal = i === 0 ? 'bg-amber-400 text-slate-950' : i === 1 ? 'bg-slate-300 text-slate-950' : i === 2 ? 'bg-amber-700 text-white' : 'surface-subtle text-muted';
        const votes = (n.powerStones || 0) + InkStore.getVotes(n.slug);
        return `
        <div class="surface-card rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 hover:border-indigo-500/40 transition">
          <div class="flex items-center gap-4 flex-1 min-w-0">
            <div class="w-10 h-10 rounded-xl font-black text-lg flex items-center justify-center shrink-0 ${medal}">#${i + 1}</div>
            <a href="#novel/${encodeURIComponent(n.slug)}" class="shrink-0">
              <img src="${esc(n.cover)}" class="w-14 h-20 rounded-xl object-cover shadow" />
            </a>
            <div class="min-w-0 flex-1">
              <a href="#novel/${encodeURIComponent(n.slug)}" class="font-extrabold text-base hover:text-indigo-400 transition block truncate">${esc(n.title)}</a>
              <div class="text-xs text-muted mt-0.5">${esc(n.author)} &bull; <span class="text-indigo-400 font-semibold">${esc(n.genre)}</span> &bull; ${n.chapterCount} Chapters</div>
              <p class="text-xs text-muted line-clamp-2 mt-1.5">${esc(n.synopsis)}</p>
            </div>
          </div>
          <div class="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-2 shrink-0 border-t sm:border-t-0 border-subtle pt-3 sm:pt-0">
            <div class="flex items-center gap-3 text-xs font-bold">
              <span class="flex items-center gap-1 text-amber-400"><i data-lucide="star" class="w-3.5 h-3.5 fill-amber-400"></i> ${Number(n.rating || 4.8).toFixed(1)}</span>
              <span class="flex items-center gap-1 text-orange-400"><i data-lucide="flame" class="w-3.5 h-3.5"></i> ${fmtNum(votes)}</span>
              <span class="flex items-center gap-1 text-muted"><i data-lucide="eye" class="w-3.5 h-3.5"></i> ${fmtNum(n.views)}</span>
            </div>
            <a href="#read/${encodeURIComponent(n.slug)}/1" class="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold">Read Now</a>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// ------------------------- NOVEL DETAIL PAGE -------------------------
async function renderNovelDetail(slug) {
  const root = document.getElementById('app-root');
  root.innerHTML = `<div class="max-w-5xl mx-auto p-12 text-center text-muted">Loading novel...</div>`;

  const novel = await InkStore.getNovel(slug);
  if (!novel) {
    root.innerHTML = `<div class="max-w-xl mx-auto p-12 text-center space-y-4"><h2 class="text-2xl font-bold">Novel Not Found</h2><a href="#home" class="inline-block px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold">Return Home</a></div>`;
    return;
  }

  const prog = InkStore.getProgress(slug);
  const shelf = InkStore.getShelf(slug);
  const votes = (novel.powerStones || 0) + InkStore.getVotes(slug);
  const reviews = InkStore.getReviews(slug, novel.reviews || []);
  const chapters = novel.chapters || [];
  const totalWords = novel.totalWords || chapters.reduce((a, c) => a + (c.wordCount || 0), 0);
  const totalHours = Math.max(0.1, totalWords / (230 * 60)).toFixed(1);

  // Similar novels based on genre + tag overlap
  const similar = InkStore.catalog
    .filter(x => x.slug !== slug)
    .map(x => {
      let score = x.genre === novel.genre ? 3 : 0;
      const tset = new Set((novel.tags || []).map(t => t.toLowerCase()));
      (x.tags || []).forEach(t => { if (tset.has(t.toLowerCase())) score += 2; });
      return { x, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(o => o.x);

  const sub = novel.subRatings || { plot: 4.8, characters: 4.8, world: 4.8, style: 4.8 };
  const shelves = ['Reading', 'Plan to Read', 'Completed', 'On Hold', 'Dropped'];

  root.innerHTML = `
  <div class="fade-in">
    <!-- Atmospheric Banner -->
    <div class="relative border-b border-subtle overflow-hidden">
      <div class="absolute inset-0 opacity-20 blur-3xl pointer-events-none" style="background: radial-gradient(circle at 25% 40%, #6366f1, transparent 55%), radial-gradient(circle at 80% 50%, #ec4899, transparent 55%);"></div>
      <div class="relative max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col md:flex-row gap-8">
        <div class="mx-auto md:mx-0 shrink-0">
          <img src="${esc(novel.cover || InkImporter.generateCoverDataUrl(novel.title, novel.author, novel.genre))}" class="w-48 sm:w-56 aspect-[2/3] rounded-2xl object-cover shadow-2xl border border-white/15" />
        </div>
        <div class="flex-1 space-y-4">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 font-bold">${esc(novel.genre)}</span>
            <span class="px-2.5 py-1 rounded-lg surface-card font-semibold">${esc(novel.status)}</span>
            <span class="px-2.5 py-1 rounded-lg surface-card text-muted">${esc(novel.contentRating || 'Teen')}</span>
          </div>
          <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">${esc(novel.title)}</h1>
          <div class="text-sm text-muted">Author: <span class="font-bold text-[var(--text-primary)]">${esc(novel.author)}</span> &bull; Updated ${esc(novel.updatedAt)}</div>

          <!-- Stats Row -->
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
            <div class="surface-card rounded-xl p-2.5 text-center"><div class="text-lg font-extrabold text-amber-400">${Number(novel.rating || 4.8).toFixed(1)} ★</div><div class="text-[11px] text-muted">Rating</div></div>
            <div class="surface-card rounded-xl p-2.5 text-center"><div class="text-lg font-extrabold">${chapters.length}</div><div class="text-[11px] text-muted">Chapters</div></div>
            <div class="surface-card rounded-xl p-2.5 text-center"><div class="text-lg font-extrabold">${fmtNum(totalWords)}</div><div class="text-[11px] text-muted">Words (~${totalHours}h)</div></div>
            <div class="surface-card rounded-xl p-2.5 text-center"><div class="text-lg font-extrabold">${fmtNum(novel.views)}</div><div class="text-[11px] text-muted">Views</div></div>
            <div class="surface-card rounded-xl p-2.5 text-center"><div id="detail-votes" class="text-lg font-extrabold text-orange-400">${fmtNum(votes)}</div><div class="text-[11px] text-muted">Power Stones</div></div>
          </div>

          <p class="text-sm leading-relaxed text-muted">${esc(novel.synopsis)}</p>

          <!-- Tags -->
          <div class="flex flex-wrap gap-1.5">
            ${(novel.tags || []).map(t => `<button onclick="AppState.browse.includeTags=['${esc(t)}'];location.hash='#browse'" class="px-2.5 py-1 rounded-lg surface-card text-xs hover:text-indigo-400 transition">#${esc(t)}</button>`).join('')}
          </div>

          <!-- Action Buttons -->
          <div class="flex flex-wrap items-center gap-2.5 pt-2">
            <a href="#read/${encodeURIComponent(slug)}/${prog ? prog.chapterNumber : 1}" class="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/25 flex items-center gap-2">
              <i data-lucide="book-open" class="w-4 h-4"></i>
              ${prog ? `Continue Ch. ${prog.chapterNumber} (${prog.scrollPct || 0}%)` : 'Start Reading Ch. 1'}
            </a>

            <select onchange="handleShelfChange('${esc(slug)}', this.value)" class="px-3.5 py-2.5 rounded-xl surface-card text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">+ Add to Library</option>
              ${shelves.map(s => `<option value="${s}" ${shelf === s ? 'selected' : ''}>Shelf: ${s}</option>`).join('')}
            </select>

            <button onclick="voteNovel('${esc(slug)}')" class="px-4 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 font-bold text-sm flex items-center gap-1.5 transition">
              <i data-lucide="flame" class="w-4 h-4"></i> Vote Stone
            </button>

            <button onclick="openDownloadModal('${esc(slug)}')" class="px-4 py-2.5 rounded-xl surface-card hover:border-indigo-500/50 text-sm font-semibold flex items-center gap-1.5 transition">
              <i data-lucide="download" class="w-4 h-4"></i> Offline eBook
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Detail Tabs -->
    <div class="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div class="flex flex-wrap items-center gap-2 border-b border-subtle pb-3">
        ${[
          { id: 'toc', label: `Chapters (${chapters.length})`, icon: 'list' },
          { id: 'codex', label: `Lore & Glossary (${(novel.glossary || []).length})`, icon: 'scroll-text' },
          { id: 'reviews', label: `Reviews & Ratings (${reviews.length})`, icon: 'message-square-heart' },
        ].map(t => `
          <button onclick="AppState.novelDetailTab='${t.id}';renderNovelDetail('${esc(slug)}');"
            class="px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition ${AppState.novelDetailTab === t.id ? 'bg-indigo-600 text-white' : 'surface-card hover:border-indigo-500/50'}">
            <i data-lucide="${t.icon}" class="w-4 h-4"></i> ${t.label}
          </button>
        `).join('')}
      </div>

      ${AppState.novelDetailTab === 'toc' ? renderTocTab(novel, prog) : ''}
      ${AppState.novelDetailTab === 'codex' ? renderCodexTab(novel) : ''}
      ${AppState.novelDetailTab === 'reviews' ? renderReviewsTab(novel, reviews, sub) : ''}

      <!-- Similar Recommendations -->
      ${similar.length ? `
      <section class="pt-6 border-t border-subtle">
        <h3 class="text-lg font-extrabold mb-4">Readers Also Enjoyed</h3>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          ${similar.map(s => renderNovelCard(s, true)).join('')}
        </div>
      </section>` : ''}
    </div>
  </div>`;
  refreshIcons();
}

function renderTocTab(novel, prog) {
  const readSet = new Set(prog?.readChapters || []);
  let list = [...(novel.chapters || [])];
  if (AppState.tocQuery) {
    const q = AppState.tocQuery.toLowerCase();
    list = list.filter(c => c.title.toLowerCase().includes(q) || String(c.number).includes(q) || (c.volume || '').toLowerCase().includes(q));
  }
  if (!AppState.tocSortAsc) list.reverse();

  // Group by volume
  const grouped = {};
  list.forEach(c => {
    const v = c.volume || 'Volume 1';
    if (!grouped[v]) grouped[v] = [];
    grouped[v].push(c);
  });

  return `
  <div class="space-y-4">
    <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      <input value="${esc(AppState.tocQuery)}" oninput="AppState.tocQuery=this.value;renderNovelDetail('${esc(novel.slug)}')"
        placeholder="Filter chapters by title or number..." class="px-3.5 py-2 rounded-xl surface-card text-sm sm:w-80 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <button onclick="AppState.tocSortAsc=!AppState.tocSortAsc;renderNovelDetail('${esc(novel.slug)}')" class="px-4 py-2 rounded-xl surface-card text-xs font-bold flex items-center justify-center gap-2 hover:border-indigo-500/50">
        <i data-lucide="arrow-up-down" class="w-4 h-4"></i> Order: ${AppState.tocSortAsc ? 'Oldest First' : 'Newest First'}
      </button>
    </div>

    ${Object.entries(grouped).map(([vol, chs]) => `
      <div class="surface-card rounded-2xl overflow-hidden">
        <div class="px-5 py-3 bg-indigo-500/10 border-b border-subtle font-bold text-sm text-indigo-300 flex justify-between">
          <span>${esc(vol)}</span>
          <span class="text-xs text-muted">${chs.length} Chapters</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:gap-px bg-[var(--border-color)]">
          ${chs.map(c => {
            const isRead = readSet.has(c.number);
            return `
            <a href="#read/${encodeURIComponent(novel.slug)}/${c.number}" class="bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] p-3.5 px-5 flex items-center justify-between gap-3 transition">
              <div class="min-w-0 flex items-center gap-2.5">
                <span class="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${isRead ? 'bg-emerald-500/20 text-emerald-400' : 'surface-subtle text-muted'}">
                  ${isRead ? '✓' : c.number}
                </span>
                <div class="min-w-0">
                  <div class="text-sm font-semibold truncate ${isRead ? 'text-muted' : ''}">${esc(c.title)}</div>
                  <div class="text-[11px] text-muted">${c.wordCount || 0} words &bull; ~${c.readMinutes || 1} min &bull; ${esc(c.publishedAt || '')}</div>
                </div>
              </div>
              <i data-lucide="chevron-right" class="w-4 h-4 text-muted shrink-0"></i>
            </a>`;
          }).join('')}
        </div>
      </div>
    `).join('') || '<div class="p-8 text-center text-muted surface-card rounded-2xl">No chapters match your search.</div>'}
  </div>`;
}

function renderCodexTab(novel) {
  const items = novel.glossary || [];
  if (!items.length) {
    return `<div class="surface-card rounded-2xl p-10 text-center text-muted">No glossary or character codex entries added for this novel yet. Authors can add terms in the Studio!</div>`;
  }
  return `
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    ${items.map(g => `
      <div class="surface-card rounded-2xl p-5 space-y-1.5">
        <div class="flex items-center justify-between">
          <h4 class="font-bold text-base text-indigo-300">${esc(g.term)}</h4>
          <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/15 text-indigo-300">${esc(g.category || 'Lore')}</span>
        </div>
        <p class="text-sm text-muted leading-relaxed">${esc(g.desc)}</p>
      </div>
    `).join('')}
  </div>`;
}

function renderReviewsTab(novel, reviews, sub) {
  const dims = [
    { label: 'Plot & Pacing', val: sub.plot || 4.8 },
    { label: 'Characters', val: sub.characters || 4.8 },
    { label: 'Worldbuilding', val: sub.world || 4.8 },
    { label: 'Writing Style', val: sub.style || 4.8 },
  ];
  return `
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Rating Breakdown + Write Review -->
    <div class="space-y-4">
      <div class="surface-card rounded-2xl p-5 space-y-3">
        <div class="text-center pb-2 border-b border-subtle">
          <div class="text-4xl font-black text-amber-400">${Number(novel.rating || 4.8).toFixed(1)}</div>
          <div class="text-xs text-muted mt-1">Overall Score (${reviews.length} Reviews)</div>
        </div>
        ${dims.map(d => `
          <div>
            <div class="flex justify-between text-xs font-semibold mb-1"><span>${d.label}</span><span>${Number(d.val).toFixed(1)} / 5</span></div>
            <div class="h-2 rounded-full bg-slate-700/50 overflow-hidden"><div class="h-full bg-amber-400 rounded-full" style="width:${(d.val / 5) * 100}%"></div></div>
          </div>
        `).join('')}
      </div>

      <form onsubmit="submitReview(event, '${esc(novel.slug)}')" class="surface-card rounded-2xl p-5 space-y-3">
        <h4 class="font-bold text-sm">Write a Review</h4>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <label>Overall (1-5)<input id="rev-rating" type="number" min="1" max="5" value="5" class="mt-1 w-full px-2.5 py-1.5 rounded-lg surface-subtle" /></label>
          <label class="flex items-center gap-2 pt-5"><input id="rev-spoiler" type="checkbox" /> Contains Spoilers</label>
        </div>
        <textarea id="rev-text" required rows="3" placeholder="Share your honest thoughts on plot, characters, and pacing..." class="w-full px-3 py-2 rounded-xl surface-subtle text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
        <button type="submit" class="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold">Post Review</button>
      </form>
    </div>

    <!-- Reviews List -->
    <div class="lg:col-span-2 space-y-3">
      ${reviews.length ? reviews.map(r => `
        <div class="surface-card rounded-2xl p-5 space-y-2">
          <div class="flex items-center justify-between">
            <div class="font-bold text-sm flex items-center gap-2">
              <span class="w-7 h-7 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-xs">${esc((r.user || 'R')[0].toUpperCase())}</span>
              ${esc(r.user || 'Reader')}
            </div>
            <div class="text-xs text-amber-400 font-bold">${'★'.repeat(r.rating || 5)} <span class="text-muted font-normal ml-2">${esc(r.date || '')}</span></div>
          </div>
          <p class="text-sm leading-relaxed ${r.spoiler ? 'spoiler-blur' : ''}" onclick="this.classList.toggle('revealed')">${esc(r.text)}</p>
          ${r.spoiler ? '<div class="text-[11px] text-amber-400">Spoiler hidden — click text to reveal</div>' : ''}
        </div>
      `).join('') : '<div class="surface-card rounded-2xl p-10 text-center text-muted">No reviews yet. Be the first to review this novel!</div>'}
    </div>
  </div>`;
}

function handleShelfChange(slug, shelf) {
  InkStore.setShelf(slug, shelf || null);
  showToast(shelf ? `Added to "${shelf}" shelf!` : 'Removed from Library', 'success');
}

function voteNovel(slug) {
  InkStore.addVote(slug);
  const el = document.getElementById('detail-votes');
  const cat = InkStore.catalog.find(n => n.slug === slug);
  if (el && cat) el.textContent = fmtNum((cat.powerStones || 0) + InkStore.getVotes(slug));
  showToast('Power Stone voted! Thank you for supporting the author!', 'success');
}

function submitReview(e, slug) {
  e.preventDefault();
  const profile = InkStore.getProfile();
  InkStore.addReview(slug, {
    user: profile.username || 'Reader',
    rating: Number(document.getElementById('rev-rating').value) || 5,
    spoiler: document.getElementById('rev-spoiler').checked,
    text: document.getElementById('rev-text').value.trim(),
  });
  showToast('Review posted!', 'success');
  renderNovelDetail(slug);
}

async function openDownloadModal(slug) {
  const novel = await InkStore.getNovel(slug);
  if (!novel) return;
  openModal(`
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-extrabold">Download Offline Copy</h3>
        <button onclick="closeModal()" class="text-muted hover:text-white">&times;</button>
      </div>
      <p class="text-sm text-muted">Save <strong>${esc(novel.title)}</strong> (${(novel.chapters || []).length} chapters) for offline reading on any device.</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button onclick="downloadNow('${esc(slug)}','html')" class="p-4 rounded-xl surface-subtle hover:border-indigo-500 text-left space-y-1 transition">
          <div class="font-bold text-indigo-400 flex items-center gap-2"><i data-lucide="file-code" class="w-4 h-4"></i> Offline HTML eBook</div>
          <div class="text-xs text-muted">Formatted single-file book with clickable Table of Contents. Opens in any browser.</div>
        </button>
        <button onclick="downloadNow('${esc(slug)}','txt')" class="p-4 rounded-xl surface-subtle hover:border-indigo-500 text-left space-y-1 transition">
          <div class="font-bold text-emerald-400 flex items-center gap-2"><i data-lucide="file-text" class="w-4 h-4"></i> Plain Text (.TXT)</div>
          <div class="text-xs text-muted">Lightweight universal text file compatible with Kindle, e-readers, and TTS apps.</div>
        </button>
      </div>
    </div>
  `);
}

async function downloadNow(slug, fmt) {
  const novel = await InkStore.getNovel(slug);
  if (novel) InkImporter.downloadNovelFile(novel, fmt);
  closeModal();
  showToast(`Downloaded ${novel.slug}.${fmt === 'txt' ? 'txt' : 'html'}`, 'success');
}

// ------------------------- DISTRACTION-FREE CHAPTER READER -------------------------
async function renderReader(slug, chapterNumber) {
  const root = document.getElementById('app-root');
  const novel = await InkStore.getNovel(slug);
  if (!novel || !novel.chapters?.length) {
    root.innerHTML = `<div class="p-12 text-center space-y-4"><h2 class="text-xl font-bold">Chapter not available</h2><a href="#home" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm">Back Home</a></div>`;
    return;
  }

  let chIdx = novel.chapters.findIndex(c => Number(c.number) === Number(chapterNumber));
  if (chIdx < 0) chIdx = 0;
  const ch = novel.chapters[chIdx];

  AppState.reader.novel = novel;
  AppState.reader.chapterIdx = chIdx;

  // Record progress
  InkStore.saveProgress(slug, ch.number, 0, ch.wordCount || 0);

  const s = InkStore.getSettings();
  const prevCh = novel.chapters[chIdx - 1];
  const nextCh = novel.chapters[chIdx + 1];
  const paragraphs = (ch.content || '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const savedHighlights = InkStore.getHighlights().filter(h => h.slug === slug && h.chapterNumber === ch.number);
  const hlTexts = new Set(savedHighlights.map(h => h.text));
  const reactions = InkStore.getReactions(ch.id, ch.reactions);
  const comments = InkStore.getComments(ch.id, ch.comments || []);

  const fontClassMap = {
    merriweather: 'font-merriweather',
    lora: 'font-lora',
    crimson: 'font-crimson',
    inter: 'font-inter',
    mono: 'font-mono-read',
  };

  root.innerHTML = `
  <div id="reader-shell" class="reader-theme-${esc(s.readerTheme)} min-h-screen transition-colors duration-200 pb-28">
    <!-- Top Reader Bar -->
    <div class="sticky top-0 z-30 border-b px-4 py-2.5 flex items-center justify-between gap-3 backdrop-blur-md" style="background: color-mix(in srgb, var(--r-box) 90%, transparent); border-color: var(--r-border);">
      <div class="flex items-center gap-2 min-w-0">
        <a href="#novel/${encodeURIComponent(slug)}" class="p-2 rounded-lg hover:bg-indigo-500/15 transition" title="Back to Novel">
          <i data-lucide="arrow-left" class="w-4 h-4"></i>
        </a>
        <div class="min-w-0">
          <div class="text-xs opacity-70 truncate">${esc(novel.title)}</div>
          <div class="text-sm font-bold truncate">${esc(ch.title)}</div>
        </div>
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        <button onclick="openChapterDrawer()" class="px-2.5 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1 hover:bg-indigo-500/15" style="border-color: var(--r-border)" title="Chapters (G)">
          <i data-lucide="list" class="w-3.5 h-3.5"></i> <span class="hidden sm:inline">${chIdx + 1}/${novel.chapters.length}</span>
        </button>
        <button id="tts-btn" onclick="toggleTTS()" class="p-2 rounded-lg border hover:bg-indigo-500/15" style="border-color: var(--r-border)" title="Read Aloud (TTS)">
          <i data-lucide="volume-2" class="w-4 h-4"></i>
        </button>
        <button id="autoscroll-btn" onclick="toggleAutoScroll()" class="p-2 rounded-lg border hover:bg-indigo-500/15" style="border-color: var(--r-border)" title="Auto-Scroll (Space)">
          <i data-lucide="chevrons-down" class="w-4 h-4"></i>
        </button>
        <button onclick="toggleFullscreen()" class="hidden sm:inline-flex p-2 rounded-lg border hover:bg-indigo-500/15" style="border-color: var(--r-border)" title="Zen Fullscreen (F)">
          <i data-lucide="maximize-2" class="w-4 h-4"></i>
        </button>
        <button onclick="openReaderSettings()" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold flex items-center gap-1.5" title="Appearance & Settings">
          <i data-lucide="sliders" class="w-3.5 h-3.5"></i> <span class="hidden sm:inline">Aa</span>
        </button>
      </div>
    </div>

    <!-- Main Reading Canvas -->
    <article id="reader-article" class="mx-auto px-5 sm:px-8 pt-10" style="max-width: ${s.maxWidth}px;">
      <header class="mb-8 pb-6 border-b" style="border-color: var(--r-border);">
        <div class="text-xs font-bold uppercase tracking-widest opacity-60">${esc(ch.volume || 'Volume 1')}</div>
        <h1 class="text-2xl sm:text-3xl font-extrabold mt-1 leading-snug">${esc(ch.title)}</h1>
        <div class="text-xs opacity-60 mt-2 flex flex-wrap gap-3">
          <span>${ch.wordCount || InkStore.countWords(ch.content)} words</span>
          <span>&bull;</span>
          <span>~${ch.readMinutes || 1} min read</span>
          <span>&bull;</span>
          <span>Tip: Click any paragraph to save a quote/note</span>
        </div>
      </header>

      ${ch.authorNoteTop ? `
      <div class="mb-8 p-4 rounded-xl border text-sm" style="background: var(--r-box); border-color: var(--r-border);">
        <div class="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-1">Author's Note</div>
        <div class="opacity-90">${esc(ch.authorNoteTop)}</div>
      </div>` : ''}

      <!-- Chapter Body -->
      <div id="reader-body" class="reader-body ${fontClassMap[s.fontFamily] || 'font-merriweather'}"
        style="font-size:${s.fontSize}px; line-height:${s.lineHeight}; text-align:${s.textAlign}; --reader-para-gap:${s.paraGap}em;">
        ${paragraphs.map((p, idx) => `
          <p data-pidx="${idx}" onclick="onParagraphClick(${idx})" class="${hlTexts.has(p) ? 'highlighted-quote' : ''}">${formatInlineMarkdown(p)}</p>
        `).join('')}
      </div>

      ${ch.authorNoteBottom ? `
      <div class="mt-10 p-4 rounded-xl border text-sm" style="background: var(--r-box); border-color: var(--r-border);">
        <div class="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-1">Afterword from ${esc(novel.author)}</div>
        <div class="opacity-90">${esc(ch.authorNoteBottom)}</div>
      </div>` : ''}

      <!-- Chapter Reactions -->
      <div class="mt-10 pt-6 border-t space-y-4" style="border-color: var(--r-border);">
        <div class="text-xs font-bold uppercase tracking-wider opacity-60 text-center">React to this chapter</div>
        <div class="flex flex-wrap justify-center gap-2">
          ${[
            { k: 'fire', emoji: '🔥', label: 'Epic' },
            { k: 'heart', emoji: '❤️', label: 'Loved' },
            { k: 'mindblown', emoji: '🤯', label: 'Plot Twist' },
            { k: 'cry', emoji: '😭', label: 'Emotional' },
            { k: 'laugh', emoji: '😂', label: 'Funny' },
          ].map(r => {
            const active = reactions.picked.includes(r.k);
            return `
            <button onclick="handleReaction('${esc(ch.id)}','${r.k}')"
              class="px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition ${active ? 'bg-indigo-600 text-white border-indigo-500' : 'hover:bg-indigo-500/10'}" style="${active ? '' : 'border-color: var(--r-border); background: var(--r-box);'}">
              <span>${r.emoji}</span> <span>${r.label}</span> <span class="opacity-75">${reactions.counts[r.k]}</span>
            </button>`;
          }).join('')}
        </div>
      </div>

      <!-- Prev / TOC / Next Navigation -->
      <div class="mt-10 grid grid-cols-3 gap-3">
        ${prevCh
          ? `<a href="#read/${encodeURIComponent(slug)}/${prevCh.number}" class="py-3 px-4 rounded-xl border font-bold text-sm text-center hover:bg-indigo-500/15 transition flex items-center justify-center gap-1.5" style="border-color:var(--r-border);background:var(--r-box);">&larr; Prev</a>`
          : `<div class="py-3 px-4 rounded-xl border text-sm text-center opacity-35" style="border-color:var(--r-border);">First Ch.</div>`}
        <a href="#novel/${encodeURIComponent(slug)}" class="py-3 px-4 rounded-xl border font-bold text-sm text-center hover:bg-indigo-500/15 transition" style="border-color:var(--r-border);background:var(--r-box);">Index</a>
        ${nextCh
          ? `<a href="#read/${encodeURIComponent(slug)}/${nextCh.number}" class="py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm text-center transition">Next &rarr;</a>`
          : `<a href="#novel/${encodeURIComponent(slug)}" class="py-3 px-4 rounded-xl bg-emerald-600 text-white font-bold text-sm text-center">Caught Up!</a>`}
      </div>

      <!-- Chapter Comments -->
      <section class="mt-12 pt-8 border-t space-y-5" style="border-color: var(--r-border);">
        <h3 class="font-extrabold text-lg">Chapter Discussion (${comments.length})</h3>
        <form onsubmit="submitChapterComment(event, '${esc(ch.id)}')" class="space-y-2.5">
          <textarea id="cmt-text" required rows="2" placeholder="Discuss this chapter..." class="w-full p-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" style="background:var(--r-box);border-color:var(--r-border);color:inherit;"></textarea>
          <div class="flex items-center justify-between">
            <label class="text-xs flex items-center gap-1.5 opacity-80"><input id="cmt-spoiler" type="checkbox" /> Mark as Spoiler</label>
            <button type="submit" class="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold">Post Comment</button>
          </div>
        </form>
        <div class="space-y-3">
          ${comments.map(c => `
            <div class="p-4 rounded-xl border space-y-1.5" style="background:var(--r-box);border-color:var(--r-border);">
              <div class="flex items-center justify-between text-xs">
                <span class="font-bold">${esc(c.user || 'Reader')}</span>
                <span class="opacity-60">${esc(c.date || '')}</span>
              </div>
              <p class="text-sm ${c.spoiler ? 'spoiler-blur' : ''}" onclick="this.classList.toggle('revealed')">${esc(c.text)}</p>
            </div>
          `).join('')}
        </div>
      </section>
    </article>
  </div>`;

  // Track scroll progress
  window.onscroll = () => {
    if (AppState.route !== 'read') return;
    const docH = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docH > 0 ? Math.min(100, Math.round((window.scrollY / docH) * 100)) : 100;
    const bar = document.getElementById('read-progress-bar');
    if (bar) bar.style.width = pct + '%';
    InkStore.saveProgress(slug, ch.number, pct, 0);
  };
  refreshIcons();
}

function formatInlineMarkdown(p) {
  let safe = esc(p);
  safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\*(.+?)\*/g, '<em>$1</em>');
  safe = safe.replace(/`(.+?)`/g, '<code class="px-1.5 py-0.5 rounded bg-indigo-500/15 font-mono text-[0.9em]">$1</code>');
  return safe;
}

function onParagraphClick(pIdx) {
  const { novel, chapterIdx } = AppState.reader;
  if (!novel) return;
  const ch = novel.chapters[chapterIdx];
  const pEl = document.querySelector(`#reader-body p[data-pidx="${pIdx}"]`);
  const text = pEl?.textContent?.trim();
  if (!text) return;

  openModal(`
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-extrabold text-base flex items-center gap-2"><i data-lucide="highlighter" class="w-4 h-4 text-amber-400"></i> Save Quote & Reading Note</h3>
        <button onclick="closeModal()" class="text-muted hover:text-white">&times;</button>
      </div>
      <blockquote class="p-3.5 rounded-xl surface-subtle border-l-4 border-amber-400 text-sm italic leading-relaxed">"${esc(text)}"</blockquote>
      <textarea id="hl-note" rows="2" placeholder="Optional personal note or theory..." class="w-full p-3 rounded-xl surface-subtle text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
      <div class="flex justify-end gap-2">
        <button onclick="closeModal()" class="px-4 py-2 rounded-xl surface-subtle text-xs font-bold">Cancel</button>
        <button onclick="saveParagraphQuote(${pIdx})" class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold">Save Highlight</button>
      </div>
    </div>
  `);
}

function saveParagraphQuote(pIdx) {
  const { novel, chapterIdx } = AppState.reader;
  const ch = novel.chapters[chapterIdx];
  const pEl = document.querySelector(`#reader-body p[data-pidx="${pIdx}"]`);
  const text = pEl?.textContent?.trim();
  const note = document.getElementById('hl-note')?.value?.trim() || '';
  InkStore.addHighlight({ slug: novel.slug, novelTitle: novel.title, chapterNumber: ch.number, chapterTitle: ch.title, text, note });
  pEl?.classList.add('highlighted-quote');
  closeModal();
  showToast('Quote saved to your Library!', 'success');
}

function handleReaction(chId, key) {
  InkStore.toggleReaction(chId, key);
  const { novel, chapterIdx } = AppState.reader;
  renderReader(novel.slug, novel.chapters[chapterIdx].number);
}

function submitChapterComment(e, chId) {
  e.preventDefault();
  const text = document.getElementById('cmt-text').value.trim();
  const spoiler = document.getElementById('cmt-spoiler').checked;
  InkStore.addComment(chId, { user: InkStore.getProfile().username || 'Reader', text, spoiler });
  showToast('Comment posted!', 'success');
  const { novel, chapterIdx } = AppState.reader;
  renderReader(novel.slug, novel.chapters[chapterIdx].number);
}

function openChapterDrawer() {
  const { novel, chapterIdx } = AppState.reader;
  if (!novel) return;
  openModal(`
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-extrabold text-lg">Jump to Chapter</h3>
        <button onclick="closeModal()" class="text-muted hover:text-white">&times;</button>
      </div>
      <div class="max-h-96 overflow-y-auto divide-y divide-[var(--border-color)] rounded-xl border border-subtle">
        ${novel.chapters.map((c, i) => `
          <a href="#read/${encodeURIComponent(novel.slug)}/${c.number}" onclick="closeModal()" class="p-3 flex items-center justify-between text-sm hover:bg-indigo-500/15 ${i === chapterIdx ? 'bg-indigo-500/20 font-bold text-indigo-300' : ''}">
            <span class="truncate">${esc(c.title)}</span>
            <span class="text-xs text-muted shrink-0 ml-2">#${c.number}</span>
          </a>
        `).join('')}
      </div>
    </div>
  `);
}

function openReaderSettings() {
  const s = InkStore.getSettings();
  const themes = [
    { id: 'light', label: 'Paper', bg: '#ffffff', fg: '#1e293b' },
    { id: 'sepia', label: 'Sepia', bg: '#f6efe0', fg: '#3d2e1e' },
    { id: 'forest', label: 'Forest', bg: '#13221c', fg: '#d6e7dd' },
    { id: 'slate', label: 'Slate', bg: '#0f172a', fg: '#e2e8f0' },
    { id: 'oled', label: 'OLED', bg: '#000000', fg: '#d4d4d8' },
  ];
  openModal(`
    <div class="space-y-5">
      <div class="flex items-center justify-between">
        <h3 class="font-extrabold text-lg">Reader Appearance & Controls</h3>
        <button onclick="closeModal()" class="text-muted hover:text-white">&times;</button>
      </div>

      <div>
        <div class="text-xs font-bold text-muted uppercase mb-2">Color Theme</div>
        <div class="grid grid-cols-5 gap-2">
          ${themes.map(t => `
            <button onclick="updateReaderPref('readerTheme','${t.id}')" style="background:${t.bg};color:${t.fg};"
              class="py-2.5 rounded-xl text-xs font-bold border-2 ${s.readerTheme === t.id ? 'border-indigo-500 ring-2 ring-indigo-500/40' : 'border-slate-500/30'}">${t.label}</button>
          `).join('')}
        </div>
      </div>

      <div>
        <div class="text-xs font-bold text-muted uppercase mb-2">Font Family</div>
        <div class="grid grid-cols-3 sm:grid-cols-5 gap-2">
          ${[
            { id: 'merriweather', label: 'Merriweather' },
            { id: 'lora', label: 'Lora' },
            { id: 'crimson', label: 'Crimson' },
            { id: 'inter', label: 'Inter' },
            { id: 'mono', label: 'Mono' },
          ].map(f => `
            <button onclick="updateReaderPref('fontFamily','${f.id}')" class="py-2 px-2 rounded-xl text-xs font-semibold border ${s.fontFamily === f.id ? 'bg-indigo-600 text-white border-indigo-500' : 'surface-subtle'}">${f.label}</button>
          `).join('')}
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
        <label class="block">Font Size: <strong id="val-fs">${s.fontSize}px</strong>
          <input type="range" min="14" max="30" value="${s.fontSize}" oninput="updateReaderPref('fontSize', Number(this.value));document.getElementById('val-fs').textContent=this.value+'px'" class="w-full mt-1" />
        </label>
        <label class="block">Line Height: <strong id="val-lh">${s.lineHeight}</strong>
          <input type="range" min="1.3" max="2.4" step="0.05" value="${s.lineHeight}" oninput="updateReaderPref('lineHeight', Number(this.value));document.getElementById('val-lh').textContent=this.value" class="w-full mt-1" />
        </label>
        <label class="block">Reading Width: <strong id="val-mw">${s.maxWidth}px</strong>
          <input type="range" min="540" max="1100" step="20" value="${s.maxWidth}" oninput="updateReaderPref('maxWidth', Number(this.value));document.getElementById('val-mw').textContent=this.value+'px'" class="w-full mt-1" />
        </label>
        <label class="block">TTS Voice Speed: <strong id="val-tts">${s.ttsRate}x</strong>
          <input type="range" min="0.7" max="2.0" step="0.1" value="${s.ttsRate}" oninput="updateReaderPref('ttsRate', Number(this.value));document.getElementById('val-tts').textContent=this.value+'x'" class="w-full mt-1" />
        </label>
        <label class="block">Auto-Scroll Speed: <strong id="val-as">${s.autoScrollSpeed}</strong>
          <input type="range" min="0.4" max="4.0" step="0.2" value="${s.autoScrollSpeed}" oninput="updateReaderPref('autoScrollSpeed', Number(this.value));document.getElementById('val-as').textContent=this.value" class="w-full mt-1" />
        </label>
        <div>
          <div class="mb-1">Text Alignment</div>
          <div class="flex gap-2">
            <button onclick="updateReaderPref('textAlign','left')" class="flex-1 py-1.5 rounded-lg border ${s.textAlign === 'left' ? 'bg-indigo-600 text-white' : 'surface-subtle'}">Left</button>
            <button onclick="updateReaderPref('textAlign','justify')" class="flex-1 py-1.5 rounded-lg border ${s.textAlign === 'justify' ? 'bg-indigo-600 text-white' : 'surface-subtle'}">Justify</button>
          </div>
        </div>
      </div>
    </div>
  `);
}

function updateReaderPref(key, val) {
  const s = InkStore.saveSettings({ [key]: val });
  const shell = document.getElementById('reader-shell');
  const article = document.getElementById('reader-article');
  const body = document.getElementById('reader-body');
  if (shell) shell.className = `reader-theme-${s.readerTheme} min-h-screen transition-colors duration-200 pb-28`;
  if (article) article.style.maxWidth = s.maxWidth + 'px';
  if (body) {
    const fm = { merriweather: 'font-merriweather', lora: 'font-lora', crimson: 'font-crimson', inter: 'font-inter', mono: 'font-mono-read' };
    body.className = `reader-body ${fm[s.fontFamily] || 'font-merriweather'}`;
    body.style.fontSize = s.fontSize + 'px';
    body.style.lineHeight = s.lineHeight;
    body.style.textAlign = s.textAlign;
  }
}

// Text-to-Speech (Read Aloud with Paragraph Highlighting)
function toggleTTS() {
  if (!('speechSynthesis' in window)) return showToast('Text-to-Speech is not supported in this browser.', 'warn');
  if (AppState.reader.ttsActive) {
    stopTTS();
    showToast('Read Aloud stopped');
    return;
  }
  const paras = Array.from(document.querySelectorAll('#reader-body p'));
  if (!paras.length) return;
  AppState.reader.ttsActive = true;
  document.getElementById('tts-btn')?.classList.add('bg-indigo-600', 'text-white');
  speakPara(paras, 0);
}

function speakPara(paras, idx) {
  if (!AppState.reader.ttsActive || idx >= paras.length) {
    stopTTS();
    return;
  }
  paras.forEach(p => p.classList.remove('tts-active'));
  const el = paras[idx];
  el.classList.add('tts-active');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const utt = new SpeechSynthesisUtterance(el.textContent);
  utt.rate = InkStore.getSettings().ttsRate || 1.0;
  utt.onend = () => { if (AppState.reader.ttsActive) speakPara(paras, idx + 1); };
  utt.onerror = () => stopTTS();
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utt);
}

function stopTTS() {
  AppState.reader.ttsActive = false;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  document.querySelectorAll('.tts-active').forEach(el => el.classList.remove('tts-active'));
  document.getElementById('tts-btn')?.classList.remove('bg-indigo-600', 'text-white');
}

// Auto-Scroll
function toggleAutoScroll() {
  if (AppState.reader.autoScrollActive) {
    stopAutoScroll();
    showToast('Auto-scroll paused');
    return;
  }
  AppState.reader.autoScrollActive = true;
  document.getElementById('autoscroll-btn')?.classList.add('bg-indigo-600', 'text-white');
  showToast('Auto-scroll started (press Space to pause)');
  const step = () => {
    if (!AppState.reader.autoScrollActive) return;
    const speed = InkStore.getSettings().autoScrollSpeed || 1.2;
    AppState.reader.scrollAccum += speed * 0.65;
    if (AppState.reader.scrollAccum >= 1) {
      const px = Math.floor(AppState.reader.scrollAccum);
      window.scrollBy(0, px);
      AppState.reader.scrollAccum -= px;
    }
    AppState.reader.autoScrollRaf = requestAnimationFrame(step);
  };
  AppState.reader.autoScrollRaf = requestAnimationFrame(step);
}

function stopAutoScroll() {
  AppState.reader.autoScrollActive = false;
  if (AppState.reader.autoScrollRaf) cancelAnimationFrame(AppState.reader.autoScrollRaf);
  document.getElementById('autoscroll-btn')?.classList.remove('bg-indigo-600', 'text-white');
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

// ------------------------- PERSONAL LIBRARY & ANALYTICS -------------------------
function renderLibrary() {
  const root = document.getElementById('app-root');
  const lib = InkStore.getLibrary();
  const stats = InkStore.getStats();
  const highlights = InkStore.getHighlights();
  const shelves = ['All', 'Reading', 'Plan to Read', 'Completed', 'On Hold', 'Dropped', 'Quotes'];

  const savedNovels = Object.entries(lib)
    .map(([slug, meta]) => ({ novel: InkStore.catalog.find(n => n.slug === slug), meta }))
    .filter(x => x.novel && (AppState.libraryShelf === 'All' || x.meta.shelf === AppState.libraryShelf));

  root.innerHTML = `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8 fade-in">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl sm:text-3xl font-extrabold">My Library & Reading Stats</h1>
        <p class="text-sm text-muted mt-1">Track shelves, streaks, saved quotes, and backup your profile.</p>
      </div>
      <button onclick="openProfileModal()" class="px-4 py-2 rounded-xl surface-card hover:border-indigo-500 text-xs font-bold flex items-center gap-2 self-start">
        <i data-lucide="hard-drive-download" class="w-4 h-4 text-indigo-400"></i> Backup / Restore Data
      </button>
    </div>

    <!-- Reading Stats Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="surface-card rounded-2xl p-4"><div class="text-xs text-muted">Chapters Read</div><div class="text-2xl font-black mt-1 text-indigo-400">${stats.chaptersReadCount}</div></div>
      <div class="surface-card rounded-2xl p-4"><div class="text-xs text-muted">Words Read</div><div class="text-2xl font-black mt-1 text-emerald-400">${fmtNum(stats.wordsRead)}</div></div>
      <div class="surface-card rounded-2xl p-4"><div class="text-xs text-muted">Reading Streak</div><div class="text-2xl font-black mt-1 text-amber-400">${stats.streakDays} Days 🔥</div></div>
      <div class="surface-card rounded-2xl p-4"><div class="text-xs text-muted">Saved Quotes</div><div class="text-2xl font-black mt-1 text-fuchsia-400">${highlights.length}</div></div>
    </div>

    <!-- Shelf Filter Pills -->
    <div class="flex flex-wrap gap-2">
      ${shelves.map(s => `
        <button onclick="AppState.libraryShelf='${s}';renderLibrary();refreshIcons();"
          class="px-4 py-2 rounded-xl text-xs font-bold transition ${AppState.libraryShelf === s ? 'bg-indigo-600 text-white' : 'surface-card hover:border-indigo-500/50'}">${s}</button>
      `).join('')}
    </div>

    ${AppState.libraryShelf === 'Quotes' ? `
      <div class="space-y-3">
        ${highlights.length ? highlights.map(h => `
          <div class="surface-card rounded-2xl p-5 space-y-2">
            <div class="flex items-center justify-between text-xs text-muted">
              <a href="#read/${encodeURIComponent(h.slug)}/${h.chapterNumber}" class="font-bold text-indigo-400 hover:underline">${esc(h.novelTitle)} — ${esc(h.chapterTitle)}</a>
              <button onclick="InkStore.deleteHighlight('${h.id}');renderLibrary();refreshIcons();" class="text-rose-400 hover:underline">Delete</button>
            </div>
            <blockquote class="border-l-4 border-amber-400 pl-3.5 italic text-sm">"${esc(h.text)}"</blockquote>
            ${h.note ? `<div class="text-xs text-muted">Note: ${esc(h.note)}</div>` : ''}
          </div>
        `).join('') : '<div class="surface-card rounded-2xl p-10 text-center text-muted">No saved quotes yet. Click any paragraph while reading a chapter to highlight it!</div>'}
      </div>
    ` : `
      ${savedNovels.length ? `
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          ${savedNovels.map(({ novel }) => renderNovelCard(novel)).join('')}
        </div>
      ` : `
        <div class="surface-card rounded-2xl p-12 text-center space-y-3">
          <i data-lucide="bookmark-plus" class="w-10 h-10 text-muted mx-auto"></i>
          <div class="font-bold text-lg">This shelf is empty</div>
          <p class="text-sm text-muted">Open any novel and pick a shelf like "Reading" or "Plan to Read" to track it here.</p>
          <a href="#browse" class="inline-block px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold">Discover Novels</a>
        </div>
      `}
    `}
  </div>`;
}

// ------------------------- AUTHOR STUDIO & ZERO-ANTIGRAVITY PUBLISHER -------------------------
function renderStudio() {
  const root = document.getElementById('app-root');
  const st = AppState.studio;
  const gh = InkStore.getGithubConfig();

  root.innerHTML = `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6 fade-in">
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-500/20 text-indigo-300 uppercase tracking-wider">Publisher Control Center</span>
        <h1 class="text-2xl sm:text-3xl font-extrabold mt-1">Author Studio & Auto-Publisher</h1>
        <p class="text-sm text-muted mt-1">Import entire novels (.TXT, .MD, .DOCX, .EPUB, .JSON, or chapter folders), edit chapters, and publish live with 1 click.</p>
      </div>
      <button onclick="exportWholeSiteDataPack()" class="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 self-start shadow-lg">
        <i data-lucide="package" class="w-4 h-4"></i> Export catalog.json & bundle.js
      </button>
    </div>

    <!-- Studio Tabs -->
    <div class="flex flex-wrap gap-2 border-b border-subtle pb-3">
      ${[
        { id: 'bulk', label: 'Smart Novel Importer (Drag & Drop)', icon: 'upload-cloud' },
        { id: 'novels', label: `Manage Novels (${InkStore.catalog.length})`, icon: 'library' },
        { id: 'editor', label: 'Write / Edit Chapter', icon: 'pen-tool' },
        { id: 'github', label: '1-Click Live GitHub Sync', icon: 'git-branch' },
      ].map(t => `
        <button onclick="AppState.studio.tab='${t.id}';renderStudio();refreshIcons();"
          class="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition ${st.tab === t.id ? 'bg-indigo-600 text-white shadow' : 'surface-card hover:border-indigo-500/50'}">
          <i data-lucide="${t.icon}" class="w-4 h-4"></i> ${t.label}
        </button>
      `).join('')}
    </div>

    ${st.tab === 'bulk' ? renderStudioBulkTab() : ''}
    ${st.tab === 'novels' ? renderStudioNovelsTab() : ''}
    ${st.tab === 'editor' ? renderStudioEditorTab() : ''}
    ${st.tab === 'github' ? renderStudioGithubTab(gh) : ''}
  </div>`;
  refreshIcons();
}

function renderStudioBulkTab() {
  const staged = AppState.studio.stagedImport;
  return `
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Upload Zone -->
    <div class="surface-card rounded-2xl p-6 space-y-4">
      <h3 class="font-extrabold text-base flex items-center gap-2"><i data-lucide="file-up" class="w-5 h-5 text-indigo-400"></i> 1. Drop or Select Novel Files</h3>
      <p class="text-xs text-muted">Upload a single full-book <strong>.TXT / .MD / .DOCX / .EPUB / .JSON</strong> (auto-splits chapters!) OR select multiple chapter files at once.</p>

      <label class="block border-2 border-dashed border-indigo-500/40 hover:border-indigo-400 rounded-2xl p-6 text-center cursor-pointer transition bg-indigo-500/5">
        <i data-lucide="cloud-upload" class="w-10 h-10 text-indigo-400 mx-auto mb-2"></i>
        <div class="font-bold text-sm">Click to Choose File(s)</div>
        <div class="text-[11px] text-muted mt-1">.txt, .md, .docx, .epub, .html, .json</div>
        <input type="file" multiple accept=".txt,.md,.docx,.epub,.html,.htm,.json" onchange="handleBulkFileInput(event)" class="hidden" />
      </label>

      <div class="text-center text-xs text-muted">— OR paste raw novel text directly —</div>
      <textarea id="raw-paste-box" rows="5" placeholder="Chapter 1: The Beginning&#10;Your story text here...&#10;&#10;Chapter 2: Next Step&#10;More text..." class="w-full p-3 rounded-xl surface-subtle text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
      <button onclick="parseRawPastedText()" class="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold">Auto-Split Pasted Text into Chapters</button>
    </div>

    <!-- Staged Preview & Metadata -->
    <div class="lg:col-span-2 surface-card rounded-2xl p-6 space-y-5">
      ${!staged ? `
        <div class="h-full flex flex-col items-center justify-center text-center py-12 space-y-3 text-muted">
          <i data-lucide="sparkles" class="w-12 h-12 text-indigo-400/60"></i>
          <div class="font-bold text-base text-[var(--text-primary)]">Ready for Your Novel</div>
          <p class="text-xs max-w-md">Once you upload a file or paste text, our Smart Chapter Detector will automatically separate every chapter, clean formatting, calculate word counts, and generate cover art.</p>
        </div>
      ` : `
        <div class="flex items-center justify-between">
          <h3 class="font-extrabold text-base text-emerald-400">2. Detected ${staged.chapters.length} Chapters — Review & Publish</h3>
          <button onclick="AppState.studio.stagedImport=null;renderStudio();" class="text-xs text-rose-400 hover:underline">Clear</button>
        </div>

        <div class="p-3 rounded-xl surface-subtle flex flex-col sm:flex-row items-start sm:items-center gap-3 text-xs">
          <span class="font-bold">Publish Mode:</span>
          <select onchange="AppState.studio.targetExistingSlug=this.value;renderStudio();" class="px-3 py-1.5 rounded-lg surface-card flex-1">
            <option value="">Create as Brand-New Novel</option>
            ${InkStore.catalog.map(n => `<option value="${esc(n.slug)}" ${AppState.studio.targetExistingSlug === n.slug ? 'selected' : ''}>Append Chapters to Existing: ${esc(n.title)} (${n.chapterCount} ch)</option>`).join('')}
          </select>
        </div>

        ${!AppState.studio.targetExistingSlug ? `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label class="block font-semibold">Title<input id="imp-title" value="${esc(staged.title)}" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle" /></label>
          <label class="block font-semibold">Author<input id="imp-author" value="${esc(staged.author || InkStore.getProfile().username)}" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle" /></label>
          <label class="block font-semibold">Genre
            <select id="imp-genre" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle">
              ${allGenres().map(g => `<option value="${esc(g)}" ${staged.genre === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
            </select>
          </label>
          <label class="block font-semibold">Status
            <select id="imp-status" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle">
              ${['Ongoing', 'Completed', 'Hiatus'].map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </label>
          <label class="sm:col-span-2 block font-semibold">Tags (comma separated)<input id="imp-tags" value="${esc((staged.tags || ['Original', 'Web Novel']).join(', '))}" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle" /></label>
          <label class="sm:col-span-2 block font-semibold">Synopsis<textarea id="imp-synopsis" rows="2" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle">${esc(staged.synopsis || 'An original serialized web novel hosted on InkRealm.')}</textarea></label>
        </div>` : ''}

        <!-- Detected Chapters Preview List -->
        <div class="max-h-60 overflow-y-auto divide-y divide-[var(--border-color)] rounded-xl border border-subtle">
          ${staged.chapters.map((c, idx) => `
            <div class="p-2.5 px-3.5 flex items-center justify-between gap-2 text-xs">
              <div class="min-w-0 flex-1">
                <input value="${esc(c.title)}" onchange="AppState.studio.stagedImport.chapters[${idx}].title=this.value" class="bg-transparent font-bold w-full focus:outline-none focus:text-indigo-400" />
                <div class="text-[11px] text-muted truncate">${InkStore.countWords(c.content)} words &bull; ${esc(c.content.slice(0, 75))}...</div>
              </div>
              <button onclick="AppState.studio.stagedImport.chapters.splice(${idx},1);renderStudio();" class="text-rose-400 hover:bg-rose-500/10 p-1 rounded" title="Remove Chapter">&times;</button>
            </div>
          `).join('')}
        </div>

        <div class="flex flex-wrap gap-3 pt-2">
          <button onclick="commitStagedImport(false)" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 shadow">
            <i data-lucide="check-circle" class="w-4 h-4"></i> Publish to Site Now
          </button>
          <button onclick="commitStagedImport(true)" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow">
            <i data-lucide="rocket" class="w-4 h-4"></i> Publish & Auto-Push Live to GitHub
          </button>
        </div>
      `}
    </div>
  </div>`;
}

async function handleBulkFileInput(e) {
  const files = e.target.files;
  if (!files?.length) return;
  try {
    showToast('Parsing files & detecting chapters...');
    const parsed = await InkImporter.parseFiles(files);
    AppState.studio.stagedImport = {
      title: parsed.title || 'Untitled Novel',
      author: parsed.author || InkStore.getProfile().username || 'Author',
      genre: parsed.genre || 'Fantasy',
      synopsis: parsed.synopsis || '',
      tags: parsed.tags?.length ? parsed.tags : ['Web Novel'],
      chapters: parsed.chapters || [],
    };
    showToast(`Detected ${parsed.chapters.length} chapter(s)!`, 'success');
    renderStudio();
  } catch (err) {
    showToast('Import error: ' + err.message, 'error');
  }
}

function parseRawPastedText() {
  const raw = document.getElementById('raw-paste-box')?.value || '';
  if (!raw.trim()) return showToast('Paste some novel text first!', 'warn');
  const chapters = InkImporter.splitChaptersSmart(raw);
  AppState.studio.stagedImport = {
    title: 'My New Novel',
    author: InkStore.getProfile().username || 'Author',
    genre: 'Fantasy',
    synopsis: '',
    tags: ['Original'],
    chapters,
  };
  showToast(`Auto-split into ${chapters.length} chapter(s)!`, 'success');
  renderStudio();
}

async function commitStagedImport(alsoPushGitHub) {
  const staged = AppState.studio.stagedImport;
  if (!staged || !staged.chapters.length) return;
  const today = new Date().toISOString().slice(0, 10);
  let novelObj;

  if (AppState.studio.targetExistingSlug) {
    const existing = await InkStore.getNovel(AppState.studio.targetExistingSlug);
    if (!existing) return showToast('Target novel not found', 'error');
    const startNum = (existing.chapters?.length || 0) + 1;
    const newChs = staged.chapters.map((c, i) => {
      const wc = InkStore.countWords(c.content);
      return {
        id: `${existing.slug}-ch-${startNum + i}`,
        number: startNum + i,
        volume: c.volume || 'Volume 1',
        title: c.title || `Chapter ${startNum + i}`,
        wordCount: wc,
        readMinutes: Math.max(1, Math.round(wc / 230)),
        publishedAt: today,
        authorNoteTop: '',
        authorNoteBottom: '',
        content: c.content,
        reactions: { fire: 0, cry: 0, mindblown: 0, laugh: 0, heart: 0 },
        comments: [],
      };
    });
    existing.chapters = [...(existing.chapters || []), ...newChs];
    novelObj = InkStore.saveCustomNovel(existing);
  } else {
    const title = document.getElementById('imp-title')?.value.trim() || staged.title;
    const author = document.getElementById('imp-author')?.value.trim() || staged.author;
    const genre = document.getElementById('imp-genre')?.value || 'Fantasy';
    const status = document.getElementById('imp-status')?.value || 'Ongoing';
    const tags = (document.getElementById('imp-tags')?.value || '').split(',').map(t => t.trim()).filter(Boolean);
    const synopsis = document.getElementById('imp-synopsis')?.value.trim() || '';
    const slug = InkStore.slugify(title);

    const chapters = staged.chapters.map((c, i) => {
      const wc = InkStore.countWords(c.content);
      return {
        id: `${slug}-ch-${i + 1}`,
        number: i + 1,
        volume: c.volume || 'Volume 1',
        title: c.title || `Chapter ${i + 1}`,
        wordCount: wc,
        readMinutes: Math.max(1, Math.round(wc / 230)),
        publishedAt: today,
        authorNoteTop: '',
        authorNoteBottom: '',
        content: c.content,
        reactions: { fire: 0, cry: 0, mindblown: 0, laugh: 0, heart: 0 },
        comments: [],
      };
    });

    novelObj = InkStore.saveCustomNovel({
      slug, title, author, genre, tags, status,
      contentRating: 'Teen', featured: false,
      cover: InkImporter.generateCoverDataUrl(title, author, genre),
      views: 1, bookmarks: 0, powerStones: 0, rating: 5.0,
      subRatings: { plot: 5, characters: 5, world: 5, style: 5 },
      synopsis, glossary: [], reviews: [], chapters,
    });
  }

  AppState.studio.stagedImport = null;
  AppState.studio.targetExistingSlug = '';
  showToast(`Published "${novelObj.title}" (${novelObj.chapters.length} chapters)!`, 'success');

  if (alsoPushGitHub) {
    try {
      await InkImporter.pushNovelToGitHub(novelObj, msg => showToast(msg, 'info'));
      showToast('Live website updated via GitHub!', 'success');
    } catch (err) {
      showToast('Saved locally, but GitHub push failed: ' + err.message, 'warn');
    }
  }
  location.hash = `#novel/${encodeURIComponent(novelObj.slug)}`;
}

function renderStudioNovelsTab() {
  return `
  <div class="space-y-4">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      ${InkStore.catalog.map(n => `
        <div class="surface-card rounded-2xl p-4 flex items-center gap-4">
          <img src="${esc(n.cover)}" class="w-14 h-20 rounded-xl object-cover shrink-0" />
          <div class="min-w-0 flex-1">
            <div class="font-bold text-sm truncate">${esc(n.title)}</div>
            <div class="text-xs text-muted">${esc(n.author)} &bull; ${n.chapterCount} Ch &bull; ${fmtNum(n.totalWords)} words</div>
            <div class="flex flex-wrap gap-2 mt-2.5">
              <button onclick="openChapterEditorFor('${esc(n.slug)}')" class="px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs font-bold">+ Add Chapter</button>
              <a href="#novel/${encodeURIComponent(n.slug)}" class="px-3 py-1 rounded-lg surface-subtle text-xs font-semibold">View</a>
              <button onclick="pushSingleNovel('${esc(n.slug)}')" class="px-3 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-bold">Push GitHub</button>
              <button onclick="deleteNovelConfirm('${esc(n.slug)}')" class="px-3 py-1 rounded-lg bg-rose-500/15 text-rose-400 text-xs font-bold">Delete</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  </div>`;
}

function openChapterEditorFor(slug) {
  AppState.studio.editingSlug = slug;
  AppState.studio.tab = 'editor';
  renderStudio();
}

async function pushSingleNovel(slug) {
  const novel = await InkStore.getNovel(slug);
  if (!novel) return;
  try {
    await InkImporter.pushNovelToGitHub(novel, m => showToast(m));
    showToast('Pushed live to GitHub!', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function deleteNovelConfirm(slug) {
  if (!confirm('Remove this novel from local catalog?')) return;
  InkStore.deleteCustomNovel(slug);
  showToast('Novel removed from local session', 'warn');
  renderStudio();
}

function renderStudioEditorTab() {
  const selectedSlug = AppState.studio.editingSlug || InkStore.catalog[0]?.slug || '';
  return `
  <form onsubmit="saveWrittenChapter(event)" class="surface-card rounded-2xl p-6 space-y-4">
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
      <label class="font-semibold">Target Novel
        <select id="ed-slug" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle">
          ${InkStore.catalog.map(n => `<option value="${esc(n.slug)}" ${n.slug === selectedSlug ? 'selected' : ''}>${esc(n.title)}</option>`).join('')}
        </select>
      </label>
      <label class="font-semibold">Volume / Arc Name
        <input id="ed-volume" value="Volume 1" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle" />
      </label>
      <label class="font-semibold">Chapter Title
        <input id="ed-title" required placeholder="Chapter X: Title" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle" />
      </label>
    </div>
    <label class="block text-xs font-semibold">Author's Note (Top — Optional)
      <input id="ed-note-top" placeholder="Optional note before the chapter starts..." class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle" />
    </label>
    <label class="block text-xs font-semibold">
      <div class="flex justify-between mb-1"><span>Chapter Content (Separate paragraphs with blank lines; **bold**, *italic* supported)</span><span id="ed-wc" class="text-indigo-400">0 words</span></div>
      <textarea id="ed-body" required rows="14" oninput="document.getElementById('ed-wc').textContent=InkStore.countWords(this.value)+' words'" placeholder="Write your chapter here..." class="w-full p-4 rounded-xl surface-subtle text-sm font-merriweather leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
    </label>
    <div class="flex justify-end gap-3">
      <button type="submit" class="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold">Publish Chapter</button>
    </div>
  </form>`;
}

async function saveWrittenChapter(e) {
  e.preventDefault();
  const slug = document.getElementById('ed-slug').value;
  const novel = await InkStore.getNovel(slug);
  if (!novel) return showToast('Select a valid novel', 'error');
  const content = document.getElementById('ed-body').value.trim();
  const wc = InkStore.countWords(content);
  const nextNum = (novel.chapters?.length || 0) + 1;
  novel.chapters = novel.chapters || [];
  novel.chapters.push({
    id: `${slug}-ch-${nextNum}`,
    number: nextNum,
    volume: document.getElementById('ed-volume').value.trim() || 'Volume 1',
    title: document.getElementById('ed-title').value.trim() || `Chapter ${nextNum}`,
    wordCount: wc,
    readMinutes: Math.max(1, Math.round(wc / 230)),
    publishedAt: new Date().toISOString().slice(0, 10),
    authorNoteTop: document.getElementById('ed-note-top').value.trim(),
    authorNoteBottom: '',
    content,
    reactions: { fire: 0, cry: 0, mindblown: 0, laugh: 0, heart: 0 },
    comments: [],
  });
  InkStore.saveCustomNovel(novel);
  showToast(`Published Chapter ${nextNum} to "${novel.title}"!`, 'success');
  location.hash = `#read/${encodeURIComponent(slug)}/${nextNum}`;
}

function renderStudioGithubTab(gh) {
  return `
  <form onsubmit="saveGhSettings(event)" class="surface-card rounded-2xl p-6 max-w-2xl space-y-4">
    <div>
      <h3 class="font-extrabold text-base flex items-center gap-2"><i data-lucide="git-branch" class="w-5 h-5 text-emerald-400"></i> Zero-Antigravity 1-Click Live Publishing</h3>
      <p class="text-xs text-muted mt-1">Connect your GitHub repository once. Whenever you upload a new novel in the Studio, InkRealm commits the updated JSON files directly to GitHub — your Cloudflare Pages / Vercel / Netlify subdomain deploys live automatically in ~20 seconds!</p>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
      <label class="font-semibold">GitHub Username / Org<input id="gh-owner" value="${esc(gh.owner)}" placeholder="e.g. yourusername" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle" /></label>
      <label class="font-semibold">Repository Name<input id="gh-repo" value="${esc(gh.repo)}" placeholder="e.g. inkrealm-novels" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle" /></label>
      <label class="font-semibold">Branch<input id="gh-branch" value="${esc(gh.branch || 'main')}" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle" /></label>
      <label class="font-semibold">Site Folder Path (blank if root)<input id="gh-path" value="${esc(gh.basePath ?? 'site')}" placeholder="site" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle" /></label>
      <label class="sm:col-span-2 font-semibold">Fine-Grained Personal Access Token (stored only in your browser)<input id="gh-token" type="password" value="${esc(gh.token)}" placeholder="github_pat_..." class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle" /></label>
    </div>
    <button type="submit" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">Save GitHub Connection</button>
  </form>`;
}

function saveGhSettings(e) {
  e.preventDefault();
  InkStore.saveGithubConfig({
    owner: document.getElementById('gh-owner').value.trim(),
    repo: document.getElementById('gh-repo').value.trim(),
    branch: document.getElementById('gh-branch').value.trim() || 'main',
    basePath: document.getElementById('gh-path').value.trim(),
    token: document.getElementById('gh-token').value.trim(),
  });
  showToast('GitHub Auto-Publisher saved!', 'success');
}

async function exportWholeSiteDataPack() {
  const { catalogObj, bundleJs } = await InkImporter.buildSiteDataFiles();
  InkImporter.triggerDownload(new Blob([JSON.stringify(catalogObj, null, 2)], { type: 'application/json' }), 'catalog.json');
  setTimeout(() => {
    InkImporter.triggerDownload(new Blob([bundleJs], { type: 'application/javascript' }), 'bundle.js');
  }, 400);
  showToast('Downloaded catalog.json & bundle.js!', 'success');
}

// ------------------------- PROFILE & SHORTCUTS MODALS -------------------------
function openProfileModal() {
  const p = InkStore.getProfile();
  openModal(`
    <div class="space-y-5">
      <div class="flex items-center justify-between">
        <h3 class="font-extrabold text-lg">Reader Profile & Data Backup</h3>
        <button onclick="closeModal()" class="text-muted hover:text-white">&times;</button>
      </div>
      <div class="space-y-3 text-xs">
        <label class="block font-semibold">Display Name<input id="prof-name" value="${esc(p.username)}" class="mt-1 w-full px-3 py-2 rounded-xl surface-subtle text-sm" /></label>
        <button onclick="saveProfileName()" class="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold">Save Name</button>
      </div>
      <div class="pt-4 border-t border-subtle space-y-3">
        <div class="text-xs font-bold uppercase text-muted">Sync Across Devices (JSON Backup)</div>
        <div class="flex flex-wrap gap-2">
          <button onclick="downloadBackup()" class="px-4 py-2 rounded-xl surface-subtle hover:border-indigo-500 text-xs font-bold">Export My Library & Progress</button>
          <label class="px-4 py-2 rounded-xl surface-subtle hover:border-emerald-500 text-xs font-bold cursor-pointer">
            Import Backup JSON
            <input type="file" accept=".json" onchange="restoreBackup(event)" class="hidden" />
          </label>
        </div>
      </div>
    </div>
  `);
}

function saveProfileName() {
  const name = document.getElementById('prof-name').value.trim() || 'Reader';
  InkStore.saveProfile({ ...InkStore.getProfile(), username: name });
  document.getElementById('nav-username').textContent = name;
  closeModal();
  showToast('Profile updated!', 'success');
}

function downloadBackup() {
  const json = InkStore.exportUserBackup();
  InkImporter.triggerDownload(new Blob([json], { type: 'application/json' }), `inkrealm-backup-${new Date().toISOString().slice(0,10)}.json`);
  showToast('Backup downloaded!', 'success');
}

async function restoreBackup(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    InkStore.importUserBackup(await file.text());
    await InkStore.init();
    closeModal();
    showToast('Profile & Library restored!', 'success');
    handleRoute();
  } catch (err) {
    showToast('Invalid backup file', 'error');
  }
}

function openShortcutsModal() {
  openModal(`
    <div class="space-y-4">
      <div class="flex items-center justify-between"><h3 class="font-extrabold text-lg">Reader Keyboard Shortcuts</h3><button onclick="closeModal()">&times;</button></div>
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="p-2.5 rounded-xl surface-subtle flex justify-between"><span>Previous Chapter</span><kbd class="px-2 py-0.5 rounded bg-indigo-500/20 font-mono">←</kbd></div>
        <div class="p-2.5 rounded-xl surface-subtle flex justify-between"><span>Next Chapter</span><kbd class="px-2 py-0.5 rounded bg-indigo-500/20 font-mono">→</kbd></div>
        <div class="p-2.5 rounded-xl surface-subtle flex justify-between"><span>Toggle Auto-Scroll</span><kbd class="px-2 py-0.5 rounded bg-indigo-500/20 font-mono">Space</kbd></div>
        <div class="p-2.5 rounded-xl surface-subtle flex justify-between"><span>Cycle Reading Theme</span><kbd class="px-2 py-0.5 rounded bg-indigo-500/20 font-mono">T</kbd></div>
        <div class="p-2.5 rounded-xl surface-subtle flex justify-between"><span>Zen Fullscreen</span><kbd class="px-2 py-0.5 rounded bg-indigo-500/20 font-mono">F</kbd></div>
        <div class="p-2.5 rounded-xl surface-subtle flex justify-between"><span>Chapter Jumper</span><kbd class="px-2 py-0.5 rounded bg-indigo-500/20 font-mono">G</kbd></div>
      </div>
    </div>
  `);
}

// ------------------------- GLOBAL KEYBOARD SHORTCUTS -------------------------
window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.key === 'Escape') { closeModal(); return; }
  if (AppState.route !== 'read' || !AppState.reader.novel) return;

  const { novel, chapterIdx } = AppState.reader;
  if (e.key === 'ArrowLeft' && novel.chapters[chapterIdx - 1]) {
    location.hash = `#read/${encodeURIComponent(novel.slug)}/${novel.chapters[chapterIdx - 1].number}`;
  } else if (e.key === 'ArrowRight' && novel.chapters[chapterIdx + 1]) {
    location.hash = `#read/${encodeURIComponent(novel.slug)}/${novel.chapters[chapterIdx + 1].number}`;
  } else if (e.key === ' ') {
    e.preventDefault();
    toggleAutoScroll();
  } else if (e.key.toLowerCase() === 't') {
    const list = ['light', 'sepia', 'forest', 'slate', 'oled'];
    const cur = InkStore.getSettings().readerTheme;
    updateReaderPref('readerTheme', list[(list.indexOf(cur) + 1) % list.length]);
  } else if (e.key.toLowerCase() === 'f') {
    toggleFullscreen();
  } else if (e.key.toLowerCase() === 'g') {
    openChapterDrawer();
  }
});

// ------------------------- BOOTSTRAP -------------------------
window.addEventListener('hashchange', handleRoute);
window.addEventListener('DOMContentLoaded', async () => {
  await InkStore.init();

  // Apply Branding from config.json
  const cfg = InkStore.config;
  document.title = `${cfg.siteName} — ${cfg.tagline}`;
  document.getElementById('brand-name').textContent = cfg.siteName;
  document.getElementById('brand-tagline').textContent = cfg.tagline;
  document.getElementById('footer-brand').textContent = cfg.siteName;
  document.getElementById('nav-username').textContent = InkStore.getProfile().username || 'Reader';

  if (cfg.announcement && !sessionStorage.getItem('inkrealm_ann_dismissed')) {
    document.getElementById('announcement-text').textContent = cfg.announcement;
    document.getElementById('announcement-bar').classList.remove('hidden');
  }

  // Global search box
  const gs = document.getElementById('global-search-input');
  const ms = document.getElementById('mobile-search-input');
  const bindSearch = el => el?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      AppState.browse.query = el.value.trim();
      location.hash = '#browse';
    }
  });
  bindSearch(gs);
  bindSearch(ms);

  // Close modal on backdrop click
  document.getElementById('modal-backdrop')?.addEventListener('click', e => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });

  updateUiThemeIcon();
  handleRoute();
});
