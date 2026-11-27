// InkRealm Browser Novel Importer, Smart Chapter Splitter, Cover Generator,
// Offline eBook Exporter, and 1-Click GitHub Auto-Publisher

window.InkImporter = {
  PALETTES: {
    'Xianxia': ['#0f172a', '#312e81', '#f59e0b', '#fde68a'],
    'LitRPG': ['#090d16', '#064e3b', '#10b981', '#a7f3d0'],
    'Fantasy': ['#1e1b4b', '#581c87', '#c084fc', '#f3e8ff'],
    'Sci-Fi': ['#020617', '#0c4a6e', '#38bdf8', '#e0f2fe'],
    'Mystery': ['#18181b', '#450a0a', '#ef4444', '#fecaca'],
    'Romance': ['#3b0764', '#831843', '#f472b6', '#fce7f3'],
    'Slice of Life': ['#14532d', '#0f766e', '#fbbf24', '#fef3c7'],
    'Steampunk': ['#292524', '#78350f', '#f97316', '#ffedd5'],
    'Horror': ['#09090b', '#3f0f1d', '#e11d48', '#ffe4e6'],
    'Historical': ['#1c1917', '#573619', '#d97706', '#fef3c7'],
  },

  // Natural sort comparator so ch2.txt comes before ch10.txt
  naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  },

  // Generate SVG data URL cover art right in browser
  generateCoverDataUrl(title, author, genre) {
    const [c1, c2, acc, light] = this.PALETTES[genre] || ['#0f172a', '#1e293b', '#6366f1', '#e0e7ff'];
    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const words = String(title || 'Untitled').split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length <= 15) cur = (cur + ' ' + w).trim();
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    const topLines = lines.slice(0, 4);
    const yStart = 220 - (topLines.length - 1) * 20;
    const titleSvg = topLines.map((ln, i) =>
      `<text x="200" y="${yStart + i*44}" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="34" fill="#ffffff">${esc(ln)}</text>`
    ).join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="400" height="600">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="60%" stop-color="${c2}"/><stop offset="100%" stop-color="${c1}"/></linearGradient>
        <radialGradient id="r" cx="50%" cy="35%" r="55%"><stop offset="0%" stop-color="${acc}" stop-opacity="0.4"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="400" height="600" fill="url(#g)"/><rect width="400" height="600" fill="url(#r)"/>
      <rect x="18" y="18" width="364" height="564" rx="10" fill="none" stroke="${acc}" stroke-opacity="0.5" stroke-width="1.5"/>
      <circle cx="200" cy="115" r="36" fill="none" stroke="${acc}" stroke-width="1.5" stroke-opacity="0.7"/>
      <polygon points="200,82 210,108 236,115 210,122 200,148 190,122 164,115 190,108" fill="${acc}"/>
      ${titleSvg}
      <line x1="110" y1="395" x2="290" y2="395" stroke="${acc}" stroke-opacity="0.5"/>
      <rect x="120" y="420" width="160" height="28" rx="14" fill="${acc}" fill-opacity="0.22" stroke="${acc}" stroke-opacity="0.5"/>
      <text x="200" y="439" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="700" fill="${light}" letter-spacing="2">${esc((genre || 'NOVEL').toUpperCase())}</text>
      <text x="200" y="535" text-anchor="middle" font-family="Georgia, serif" font-size="20" font-weight="600" fill="#ffffff">${esc(author || 'Author')}</text>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  },

  // Parse multiple uploaded files (.txt, .md, .docx, .epub, .json, .html)
  async parseFiles(fileList) {
    const files = Array.from(fileList).sort((a, b) => this.naturalCompare(a.name, b.name));
    if (!files.length) return { title: '', author: '', chapters: [] };

    // Single JSON novel export
    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.json')) {
      const data = JSON.parse(await files[0].text());
      return {
        title: data.title || '',
        author: data.author || '',
        genre: data.genre || 'Fantasy',
        synopsis: data.synopsis || '',
        tags: data.tags || [],
        chapters: (data.chapters || []).map((c, idx) => ({
          title: c.title || `Chapter ${idx + 1}`,
          volume: c.volume || 'Volume 1',
          content: c.content || '',
        }))
      };
    }

    // Single EPUB file
    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.epub')) {
      return await this.parseEpub(files[0]);
    }

    // Single DOCX file
    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.docx')) {
      const text = await this.parseDocx(files[0]);
      const baseName = files[0].name.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ');
      return { title: baseName, author: '', chapters: this.splitChaptersSmart(text) };
    }

    // Single TXT/MD/HTML file -> auto-split into chapters
    if (files.length === 1) {
      let text = await files[0].text();
      if (files[0].name.toLowerCase().endsWith('.html') || files[0].name.toLowerCase().endsWith('.htm')) {
        text = this.htmlToPlainText(text);
      }
      const baseName = files[0].name.replace(/\.(txt|md|html?)$/i, '').replace(/[_-]+/g, ' ');
      return { title: baseName, author: '', chapters: this.splitChaptersSmart(text) };
    }

    // Multiple files -> treat each file as a chapter (sorted naturally)
    const chapters = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = f.name.split('.').pop().toLowerCase();
      let content = '';
      if (ext === 'docx') content = await this.parseDocx(f);
      else if (ext === 'html' || ext === 'htm') content = this.htmlToPlainText(await f.text());
      else content = await f.text();

      const cleanedTitle = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
      chapters.push({
        title: cleanedTitle || `Chapter ${i + 1}`,
        volume: 'Volume 1',
        content: this.cleanText(content),
      });
    }
    return { title: '', author: '', chapters };
  },

  async parseDocx(file) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip failed to load. Please use the offline Python Publisher tool for .docx files.');
    const zip = await JSZip.loadAsync(file);
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) throw new Error('Invalid .docx file');
    const parser = new DOMParser();
    const xml = parser.parseFromString(docXml, 'application/xml');
    const paragraphs = Array.from(xml.getElementsByTagName('w:p'));
    const lines = paragraphs.map(p => {
      const texts = Array.from(p.getElementsByTagName('w:t')).map(t => t.textContent).join('');
      return texts.trim();
    }).filter(Boolean);
    return lines.join('\n\n');
  },

  async parseEpub(file) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip failed to load. Please use the offline Python Publisher tool for .epub files.');
    const zip = await JSZip.loadAsync(file);
    const containerXml = await zip.file('META-INF/container.xml')?.async('string');
    if (!containerXml) throw new Error('Invalid EPUB container');
    const parser = new DOMParser();
    const cDoc = parser.parseFromString(containerXml, 'application/xml');
    const opfPath = cDoc.querySelector('rootfile')?.getAttribute('full-path');
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const opfStr = await zip.file(opfPath)?.async('string');
    const opfDoc = parser.parseFromString(opfStr, 'application/xml');

    const title = opfDoc.querySelector('title')?.textContent?.trim() || file.name.replace(/\.epub$/i, '');
    const author = opfDoc.querySelector('creator')?.textContent?.trim() || '';

    const manifest = {};
    opfDoc.querySelectorAll('manifest item').forEach(item => {
      manifest[item.getAttribute('id')] = item.getAttribute('href');
    });
    const spineIds = Array.from(opfDoc.querySelectorAll('spine itemref')).map(r => r.getAttribute('idref'));

    const chapters = [];
    for (const id of spineIds) {
      const href = manifest[id];
      if (!href) continue;
      const fullPath = decodeURIComponent(opfDir + href);
      const htmlStr = await zip.file(fullPath)?.async('string');
      if (!htmlStr) continue;
      const hDoc = parser.parseFromString(htmlStr, 'text/html');
      const heading = hDoc.querySelector('h1, h2, h3, title')?.textContent?.trim();
      const bodyText = this.cleanText(this.htmlToPlainText(hDoc.body?.innerHTML || htmlStr));
      if (bodyText.length < 80) continue; // skip cover/copyright pages
      chapters.push({
        title: heading && heading.length < 100 ? heading : `Chapter ${chapters.length + 1}`,
        volume: 'Volume 1',
        content: bodyText,
      });
    }
    return { title, author, chapters };
  },

  htmlToPlainText(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html
      .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n');
    return (tmp.textContent || tmp.innerText || '').trim();
  },

  cleanText(raw) {
    return String(raw || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  },

  // Intelligent chapter splitter supporting English, Markdown, Roman numerals, and Chinese chapter headings
  splitChaptersSmart(rawText, customPattern = '') {
    const text = this.cleanText(rawText);
    const defaultRegex = /^(?:#{1,3}\s+)?(?:(?:chapter|ch\.?|part|episode|book|act|arc|volume|vol\.?)\s*(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b.*|prologue\b.*|epilogue\b.*|interlude\b.*|第[\d一二三四五六七八九十百千万零两]+[章回节部].*)$/gim;
    const regex = customPattern ? new RegExp(customPattern, 'gim') : defaultRegex;

    const matches = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      // Ensure heading is on its own line and not an overly long prose sentence
      if (m[0].trim().length <= 120) {
        matches.push({ title: m[0].replace(/^#{1,3}\s+/, '').trim(), index: m.index, end: m.index + m[0].length });
      }
    }

    if (matches.length === 0) {
      return [{ title: 'Chapter 1', volume: 'Volume 1', content: text }];
    }

    const chapters = [];
    // If substantial preface text exists before first match
    const lead = text.slice(0, matches[0].index).trim();
    if (lead.length > 200) {
      chapters.push({ title: 'Prologue', volume: 'Volume 1', content: lead });
    }

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].end;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const body = text.slice(start, end).trim();
      if (body.length > 0) {
        chapters.push({
          title: matches[i].title,
          volume: 'Volume 1',
          content: body,
        });
      }
    }
    return chapters;
  },

  // Export any novel as offline readable HTML eBook or TXT
  downloadNovelFile(novel, format = 'html') {
    let blob, filename;
    if (format === 'txt') {
      const parts = [
        `${novel.title.toUpperCase()}`,
        `By ${novel.author} | Genre: ${novel.genre} | Status: ${novel.status}`,
        '='.repeat(60),
        novel.synopsis,
        '='.repeat(60),
        ''
      ];
      (novel.chapters || []).forEach(ch => {
        parts.push(`\n\n### ${ch.title} ###\n\n${ch.content}\n`);
      });
      blob = new Blob([parts.join('\n')], { type: 'text/plain;charset=utf-8' });
      filename = `${novel.slug}.txt`;
    } else {
      const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const toc = (novel.chapters || []).map((ch, i) => `<li><a href="#ch-${i+1}">${esc(ch.title)}</a></li>`).join('');
      const body = (novel.chapters || []).map((ch, i) => `
        <article id="ch-${i+1}" style="margin-top:3rem;padding-top:2rem;border-top:1px solid #ddd;">
          <h2>${esc(ch.title)}</h2>
          ${ch.content.split(/\n\n+/).map(p => `<p>${esc(p)}</p>`).join('')}
        </article>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(novel.title)}</title>
        <style>body{max-width:740px;margin:2rem auto;padding:0 1.2rem;font-family:Georgia,serif;line-height:1.85;color:#1e293b;background:#faf8f5;}h1,h2{font-family:system-ui,sans-serif;}a{color:#4f46e5;}</style>
        </head><body><h1>${esc(novel.title)}</h1><p><strong>By ${esc(novel.author)}</strong> &bull; ${esc(novel.genre)}</p><p><em>${esc(novel.synopsis)}</em></p><hr><h3>Table of Contents</h3><ol>${toc}</ol>${body}</body></html>`;
      blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      filename = `${novel.slug}-ebook.html`;
    }
    this.triggerDownload(blob, filename);
  },

  triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  // Build live catalog.json string from current state (bundle.js omitted for scalability)
  async buildSiteDataFiles() {
    const allNovels = await InkStore.getAllFullNovels();
    const summaries = Object.values(allNovels).map(n => InkStore.toCatalogSummary(n));
    const catalogObj = {
      version: '2.0',
      generatedAt: new Date().toISOString(),
      totalNovels: summaries.length,
      novels: summaries,
    };
    return { catalogObj, allNovels };
  },

  // 1-Click Direct Push to GitHub Repository (Zero Antigravity needed!)
  async pushNovelToGitHub(novelObj, onStatus = () => {}) {
    const cfg = InkStore.getGithubConfig();
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      throw new Error('Configure GitHub Owner, Repo, and Personal Access Token first.');
    }
    const base = cfg.basePath ? cfg.basePath.replace(/^\/|\/$/g, '') + '/' : '';
    const { catalogObj } = await this.buildSiteDataFiles();

    const filesToPush = [
      { path: `${base}data/novels/${novelObj.slug}.json`, content: JSON.stringify(novelObj, null, 2), msg: `Add/Update novel: ${novelObj.title}` },
      { path: `${base}data/catalog.json`, content: JSON.stringify(catalogObj, null, 2), msg: `Update catalog for ${novelObj.title}` },
    ];

    for (const f of filesToPush) {
      onStatus(`Uploading ${f.path}...`);
      await this.githubPutFile(cfg, f.path, f.content, f.msg);
    }
    onStatus('Published live to GitHub!');
  },

  async githubPutFile(cfg, path, textContent, message) {
    const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
    const headers = {
      'Authorization': `Bearer ${cfg.token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };
    // Check if file exists to get SHA
    let sha = undefined;
    const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(cfg.branch || 'main')}`, { headers });
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    }
    const b64 = btoa(unescape(encodeURIComponent(textContent)));
    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ message, content: b64, branch: cfg.branch || 'main', sha }),
    });
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API error ${putRes.status}`);
    }
    return await putRes.json();
  }
};
