#!/usr/bin/env node
// content-audit v1.0 — audit a site's raw server HTML (what search and AI crawlers see, no JS) for semantic structure,
// meta and schema, entity consistency, answer-first copy, citations, boilerplate, cannibalisation and prose slop tells.
// No dependencies (Node 18+). Seeds from sitemap.xml (follows sitemap indexes), falls back to crawling links from the start URL.
// Usage: node content-audit.mjs https://example.com [--max 400] [--out ./content-out] [--concurrency 6] [--include /blog,/resources]
import fs from 'node:fs'; import path from 'node:path';
const args = process.argv.slice(2); const flag = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const start = args.find(a => /^https?:/.test(a)); if (!start) { console.error('usage: node content-audit.mjs <url> [--max 400] [--out ./content-out]'); process.exit(1); }
const MAXP = +flag('--max', 400), OUT = flag('--out', './content-out'), CONC = +flag('--concurrency', 6), INCL = flag('--include', '') ? String(flag('--include')).split(',') : [];
fs.mkdirSync(OUT, { recursive: true });
const UA = { 'user-agent': 'Mozilla/5.0 (site-qa content-audit; owner audit)' };
const get = async u => { try { const r = await fetch(u, { headers: UA, redirect: 'follow' }); return { status: r.status, url: r.url, type: r.headers.get('content-type') || '', body: await r.text() }; } catch (e) { return { status: 'ERR', url: u, type: '', body: '' }; } };
const pool = async (items, fn) => { const out = []; let i = 0; await Promise.all(Array.from({ length: CONC }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; };

// ── helpers ──
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&lsquo;/g, "'").replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const strip = s => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null; };
const tags = (h, name) => h.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
const count = (h, name) => tags(h, name).length;
const meta = (h, key) => { for (const t of tags(h, 'meta')) if ((attr(t, 'name') || attr(t, 'property') || '').toLowerCase() === key) return attr(t, 'content') || ''; return null; };
const host = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
const SOCIAL = /(linkedin|twitter|x\.com|facebook|instagram|youtube|youtu\.be|tiktok|spotify|github\.com|medium\.com|substack|termly|statuspage|cookiebot|onetrust|calendly|hubspot|typeform|google\.com\/maps|apple\.com|play\.google)/i;
const SLOP = { emDash: /—/g, notJust: /\bnot just\b/gi, notXbutY: /\b(isn't|is not|aren't|it's not|not) (just |only |about )?[\w ]{1,30}[,;—–] (it's|it is|they're|but|it)\b/gi, reveal: /\bnot [\w ]{1,25}\. (It's|It is|That's)\b/g, honest: /\bhonest(ly)?\b/gi, actually: /\bactually\b/gi, theReal: /\bthe real (question|problem|issue|answer|work)\b/gi, heresThe: /\bhere's (the|what|why|how)\b/gi, quietly: /\bquietly\b/gi, thatsIt: /\bthat's it\.\s/gi, buzz: /\b(seamless(ly)?|delve|leverag(e|ing)|robust|unlock|empower|game[- ]changer|cutting[- ]edge|navigat(e|ing) the|in today's|ever[- ]evolving|landscape)\b/gi, unsourcedTrend: /\b(tripled|doubled|quadrupled|skyrocketed)\b/gi, yearBait: /\bin 20\d\d\b/gi };
const ANSWERISH = /\b(is|are|means|refers to|is defined as|describes|measures)\b/i;

// ── 1. discover URLs ──
const root = new URL(start); const sitemapUrls = new Set();
const robots = await get(new URL('/robots.txt', root).href);
const smSeeds = [...(robots.body.match(/^sitemap:\s*(\S+)/gim) || []).map(l => l.split(/:\s*/).slice(1).join(':').trim()), new URL('/sitemap.xml', root).href];
const seenSm = new Set();
const readSm = async u => { if (seenSm.has(u) || seenSm.size > 50) return; seenSm.add(u); const r = await get(u); if (!/<(urlset|sitemapindex)/i.test(r.body)) return; const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => decode(m[1])); if (/<sitemapindex/i.test(r.body)) for (const l of locs) await readSm(l); else locs.forEach(l => sitemapUrls.add(l)); };
for (const s of smSeeds) await readSm(s);
let urls = [...sitemapUrls].filter(u => host(u) === host(root.href));
if (!urls.length) { const r = await get(root.href); urls = [r.url, ...new Set([...r.body.matchAll(/href="([^"#]+)"/g)].map(m => { try { return new URL(m[1], r.url).href; } catch { return null; } }).filter(u => u && host(u) === host(root.href)))]; }
if (INCL.length) urls = urls.filter(u => INCL.some(p => new URL(u).pathname.startsWith(p)) || new URL(u).pathname === '/');
urls = urls.slice(0, MAXP);
console.error(`auditing ${urls.length} URLs (${sitemapUrls.size} in sitemap)`);

// ── 2. per page ──
const pages = (await pool(urls, async u => {
  const r = await get(u); if (!/html/i.test(r.type)) return { url: u, status: r.status, skipped: true };
  const raw = r.body; const head = (raw.match(/<head[\s\S]*?<\/head>/i) || [''])[0];
  const ld = [], ldErrors = []; for (const m of raw.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { ld.push(JSON.parse(m[1])); } catch (e) { ldErrors.push(e.message.slice(0, 60)); } }
  const nodes = []; const walk = x => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x['@type']) nodes.push(x); Object.values(x).forEach(walk); } }; walk(ld);
  const types = [...new Set(nodes.flatMap(n => [].concat(n['@type'])))];
  const org = nodes.filter(n => [].concat(n['@type']).includes('Organization'));
  const art = nodes.find(n => /Article|BlogPosting|NewsArticle|TechArticle/.test([].concat(n['@type']).join()));
  const body = raw.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const mains = body.match(/<main\b[\s\S]*?<\/main>/gi) || [];
  const content = (mains[0] || body).replace(/<(header|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = strip(content); const words = text ? text.split(' ').length : 0;
  const hs = [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => ({ l: +m[1], t: strip(m[2]) }));
  const skips = []; for (let i = 1; i < hs.length; i++) if (hs[i].l > hs[i - 1].l + 1) skips.push(`h${hs[i - 1].l}→h${hs[i].l} "${hs[i].t.slice(0, 50)}"`);
  const h1i = content.search(/<h1\b/i); const afterH1 = h1i < 0 ? content : content.slice(h1i);
  const subject = (hs.find(h => h.l === 1)?.t || '').toLowerCase().replace(/^(what|who|why|how)('s| is| are| does| do)?( an?| the)? /, '').replace(/\?$/, '').split(/,| and | or /)[0].trim();
  const leakedAttrs = (body.match(/\s[a-z-]+=["'](\[object Object\]|undefined|null|NaN)["']/gi) || []);
  const firstP = strip((afterH1.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || ['', ''])[1]); const fpw = firstP ? firstP.split(' ').length : 0;
  const imgs = tags(body, 'img'); const as = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const ext = as.map(m => attr('<a ' + m[1] + '>', 'href') || '').filter(h => /^https?:/.test(h) && host(h) !== host(root.href) && !host(h).endsWith('.' + host(root.href)));
  const inputs = tags(body, 'input').filter(t => !/type=["']?(hidden|submit|button|image|reset)/i.test(t));
  const labelled = t => attr(t, 'aria-label') || attr(t, 'aria-labelledby') || (attr(t, 'id') && new RegExp(`<label[^>]*for=["']${attr(t, 'id').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(body));
  const slop = Object.fromEntries(Object.entries(SLOP).map(([k, re]) => [k, (text.match(re) || []).length]));
  const canonical = (tags(head, 'link').find(t => /rel=["']?canonical/i.test(t)) || ''); const canon = canonical ? attr(canonical, 'href') : null;
  const htmlTag = tags(raw, 'html')[0] || '';
  return {
    url: u, finalUrl: r.url, status: r.status, lang: attr(htmlTag, 'lang'), title: strip((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || ['', ''])[1]),
    description: meta(head, 'description'), robots: meta(head, 'robots'), canonical: canon, canonicalSelf: canon ? canon.replace(/\/$/, '') === r.url.replace(/\/$/, '') : null,
    og: { title: !!meta(head, 'og:title'), image: !!meta(head, 'og:image'), twitter: !!meta(head, 'twitter:card') },
    landmarks: Object.fromEntries(['header', 'nav', 'main', 'footer', 'article', 'aside', 'section'].map(t => [t, count(body, t)])),
    divs: count(body, 'div'), spans: count(body, 'span'),
    headings: hs.length, h1: hs.filter(h => h.l === 1).map(h => h.t), h2: hs.filter(h => h.l === 2).map(h => h.t).slice(0, 30), headingSkips: skips.slice(0, 8), emptyHeadings: hs.filter(h => !h.t).length,
    questionHeadings: hs.filter(h => h.l > 1 && /\?$/.test(h.t)).length,
    words, rawTextWords: strip(body).split(' ').length, firstParagraph: firstP.slice(0, 300), firstParagraphWords: fpw,
    answerFirst: (() => { const s1 = (firstP.split(/(?<=[.?!])\s/)[0] || '').toLowerCase(); if (fpw < 12 || fpw > 80 || !ANSWERISH.test(s1) || /^(the (standard|usual|short|common) answer|most |many |some )/.test(s1)) return false; const key = subject.split(' ').slice(0, 2).join(' '); return !key || s1.includes(key); })(),
    leakedAttributes: leakedAttrs.length, leakedAttributeSample: [...new Set(leakedAttrs.map(a => a.trim()))].slice(0, 3),
    lists: count(content, 'ul') + count(content, 'ol'), tables: count(content, 'table'), tableHeaders: count(content, 'th'), details: count(content, 'details'), time: count(body, 'time'), figure: count(content, 'figure'), blockquote: count(content, 'blockquote'),
    images: imgs.length, imgNoAlt: imgs.filter(t => attr(t, 'alt') === null).length, imgNoDims: imgs.filter(t => !attr(t, 'width') || !attr(t, 'height')).length, imgLazy: imgs.filter(t => /loading=["']?lazy/i.test(t)).length,
    links: as.length, anchorsNoHref: as.filter(m => !/href=/i.test(m[1])).length, genericLinkText: as.filter(m => /^(click here|here|read more|learn more|more|this|link)$/i.test(strip(m[2]))).map(m => strip(m[2])).length,
    clickableDivs: (body.match(/<(div|span)\b[^>]*\sonclick=/gi) || []).length, buttons: count(body, 'button'), inputs: inputs.length, inputsUnlabelled: inputs.filter(t => !labelled(t)).length,
    externalCitations: [...new Set(ext.filter(h => !SOCIAL.test(host(h))).map(host))], externalLinks: ext.length,
    ldTypes: types, ldErrors, orgNames: [...new Set(org.map(o => o.name).filter(Boolean))], orgSameAs: [...new Set(org.flatMap(o => [].concat(o.sameAs || [])))],
    article: art ? { author: !!art.author, datePublished: !!art.datePublished, dateModified: !!art.dateModified, headline: !!art.headline } : null,
    visibleDate: /\b(updated|published|last reviewed)\b[^.]{0,30}\b(20\d\d|\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i.test(text) || count(body, 'time') > 0,
    byline: /\b(written by|by [A-Z][a-z]+ [A-Z][a-z]+|author:)/.test(text) || !!(art && art.author),
    slop, text,
  };
})).filter(Boolean);

// ── 3. site-wide ──
const ok = pages.filter(p => !p.skipped && p.status === 200);
const llms = await get(new URL('/llms.txt', root).href); const llmsOk = llms.status === 200 && !/<html/i.test(llms.body.slice(0, 200));
const llmsLinks = llmsOk ? new Set([...llms.body.matchAll(/\]\((https?:[^)\s]+)\)/g)].map(m => m[1].replace(/\/$/, ''))) : new Set();
const AIBOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider'];
const botRules = Object.fromEntries(AIBOTS.map(b => { const m = robots.body.match(new RegExp(`user-agent:\\s*${b}[\\s\\S]*?(?=user-agent:|$)`, 'i')); return [b, m ? (/disallow:\s*\/\s*$/im.test(m[0]) ? 'blocked' : 'rules') : 'default']; }));
const dup = key => { const m = new Map(); ok.forEach(p => { const v = (p[key] || '').trim().toLowerCase(); if (v) m.set(v, [...(m.get(v) || []), p.url]); }); return [...m].filter(([, v]) => v.length > 1).map(([k, v]) => ({ value: k.slice(0, 90), urls: v })); };
const STOP = new Set('the a an and or for to of in on how what is are your with vs free guide uk'.split(' ').concat(host(root.href).split('.')[0]));
const toks = t => new Set((t.split(/[|–—-]/)[0].toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => !STOP.has(w)));
const near = []; for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) { const a = toks(ok[i].title), b = toks(ok[j].title); if (a.size < 2 || b.size < 2) continue; const inter = [...a].filter(x => b.has(x)).length, jac = inter / (a.size + b.size - inter); if (jac >= 0.6) near.push({ jaccard: +jac.toFixed(2), a: ok[i].url, b: ok[j].url, ta: ok[i].title, tb: ok[j].title }); }
const sent = new Map(); ok.forEach(p => new Set(p.text.split(/(?<=[.?!])\s+/).filter(s => s.length > 60 && s.length < 300)).forEach(s => sent.set(s, (sent.get(s) || 0) + 1)));
const boiler = [...sent].filter(([, n]) => n >= Math.max(5, ok.length * 0.1)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([s, n]) => ({ pages: n, sentence: s.slice(0, 200) }));
const totalWords = ok.reduce((s, p) => s + p.words, 0) || 1; const slopPer1k = Object.fromEntries(Object.keys(SLOP).map(k => [k, +(1000 * ok.reduce((s, p) => s + p.slop[k], 0) / totalWords).toFixed(2)]));
const pct = f => ok.length ? Math.round(100 * ok.filter(f).length / ok.length) : 0; const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const articles = ok.filter(p => p.article);
const summary = {
  site: root.href, date: new Date().toISOString().slice(0, 10), sitemapUrls: sitemapUrls.size, audited: ok.length, non200: pages.filter(p => p.status !== 200).map(p => ({ url: p.url, status: p.status })),
  crawlerAccess: { robotsTxt: robots.status === 200, aiBots: botRules, llmsTxt: llmsOk, llmsCoveragePct: llmsOk ? Math.round(100 * ok.filter(p => llmsLinks.has(p.url.replace(/\/$/, ''))).length / ok.length) : 0, likelyClientRendered: ok.filter(p => p.rawTextWords < 120).map(p => p.url) },
  semantic: { langPct: pct(p => p.lang), oneMainPct: pct(p => p.landmarks.main === 1), headerPct: pct(p => p.landmarks.header > 0), navPct: pct(p => p.landmarks.nav > 0), footerPct: pct(p => p.landmarks.footer > 0), articleOnContentPagesPct: (a => a.length ? Math.round(100 * a.filter(p => p.landmarks.article > 0).length / a.length) : null)(ok.filter(p => p.article || /\/(blog|resources|news|insights|guides|articles|learn|posts?)\//.test(new URL(p.url).pathname))), leakedAttributes: ok.reduce((s, p) => s + p.leakedAttributes, 0), leakedAttributeSample: [...new Set(ok.flatMap(p => p.leakedAttributeSample))].slice(0, 5), oneH1Pct: pct(p => p.h1.length === 1), pagesWithHeadingSkips: ok.filter(p => p.headingSkips.length).length, medianDivsPerSemantic: med(ok.map(p => +(p.divs / Math.max(1, Object.values(p.landmarks).reduce((a, b) => a + b, 0))).toFixed(1))), imgsMissingAlt: ok.reduce((s, p) => s + p.imgNoAlt, 0), imgsMissingDims: ok.reduce((s, p) => s + p.imgNoDims, 0), clickableDivs: ok.reduce((s, p) => s + p.clickableDivs, 0), unlabelledInputs: ok.reduce((s, p) => s + p.inputsUnlabelled, 0), genericLinkText: ok.reduce((s, p) => s + p.genericLinkText, 0), anchorsWithoutHref: ok.reduce((s, p) => s + p.anchorsNoHref, 0), timeElementPct: pct(p => p.time > 0) },
  meta: { titleMedianLen: med(ok.map(p => p.title.length)), titlesOver60: ok.filter(p => p.title.length > 60).length, descMissing: ok.filter(p => !p.description).length, descMedianLen: med(ok.map(p => (p.description || '').length)), canonicalPct: pct(p => p.canonical), canonicalNotSelf: ok.filter(p => p.canonical && !p.canonicalSelf).map(p => ({ url: p.url, canonical: p.canonical })), noindexInSitemap: ok.filter(p => /noindex/i.test(p.robots || '')).map(p => p.url), ogImagePct: pct(p => p.og.image), duplicateTitles: dup('title'), duplicateDescriptions: dup('description'), nearDuplicateTitles: near.sort((a, b) => b.jaccard - a.jaccard).slice(0, 30) },
  schema: { pagesWithAnyLd: pct(p => p.ldTypes.length), ldErrors: ok.filter(p => p.ldErrors.length).map(p => p.url), typeCounts: Object.fromEntries(Object.entries(ok.flatMap(p => p.ldTypes).reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1])), organizationPct: pct(p => p.orgNames.length), orgNameVariants: [...new Set(ok.flatMap(p => p.orgNames))], orgSameAsVariants: [...new Set(ok.flatMap(p => p.orgSameAs))], personPct: pct(p => p.ldTypes.includes('Person')), articlesMissingAuthor: articles.filter(p => !p.article.author).length, articlesMissingDates: articles.filter(p => !p.article.datePublished || !p.article.dateModified).length },
  content: { medianWords: med(ok.map(p => p.words)), thinPages: ok.filter(p => p.words < 300).map(p => ({ url: p.url, words: p.words })), answerFirstPct: pct(p => p.answerFirst), visibleDatePct: pct(p => p.visibleDate), bylinePct: pct(p => p.byline), medianExternalCitations: med(ok.map(p => p.externalCitations.length)), pagesWithNoCitations: ok.filter(p => !p.externalCitations.length).length, topCitedDomains: Object.entries(ok.flatMap(p => p.externalCitations).reduce((m, d) => (m[d] = (m[d] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 20), questionHeadingPages: pct(p => p.questionHeadings > 0), boilerplateSentences: boiler, slopPer1kWords: slopPer1k },
};
fs.writeFileSync(path.join(OUT, 'pages.json'), JSON.stringify(ok.map(({ text, ...p }) => p), null, 1));
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
fs.mkdirSync(path.join(OUT, 'text'), { recursive: true }); ok.forEach(p => fs.writeFileSync(path.join(OUT, 'text', (new URL(p.url).pathname.replace(/^\/|\/$/g, '').replace(/\//g, '__') || 'home') + '.txt'), p.title + '\n\n' + p.text));
const S = summary, line = (k, v) => `| ${k} | ${v} |`;
const md = [`# Content structure audit: ${S.site} (${S.date})`, '', `Audited ${S.audited} of ${S.sitemapUrls} sitemap URLs from raw server HTML.`, '',
  '## Crawler access', '| Check | Result |', '|---|---|', line('llms.txt', S.crawlerAccess.llmsTxt ? `yes, covers ${S.crawlerAccess.llmsCoveragePct}% of audited pages` : 'missing'), line('AI bots in robots.txt', Object.entries(S.crawlerAccess.aiBots).filter(([, v]) => v !== 'default').map(([b, v]) => `${b}: ${v}`).join(', ') || 'no specific rules (default allow)'), line('Pages with <120 words in raw HTML (likely client-rendered)', S.crawlerAccess.likelyClientRendered.length), '',
  '## Semantic HTML', '| Check | Result |', '|---|---|', ...Object.entries(S.semantic).map(([k, v]) => line(k, v)), '',
  '## Meta', '| Check | Result |', '|---|---|', ...['titleMedianLen', 'titlesOver60', 'descMissing', 'descMedianLen', 'canonicalPct', 'ogImagePct'].map(k => line(k, S.meta[k])), line('canonicalNotSelf', S.meta.canonicalNotSelf.length), line('noindexInSitemap', S.meta.noindexInSitemap.length), line('duplicateTitles', S.meta.duplicateTitles.length), line('duplicateDescriptions', S.meta.duplicateDescriptions.length), line('nearDuplicateTitles', S.meta.nearDuplicateTitles.length), '',
  '## Schema and entity', '| Check | Result |', '|---|---|', line('Pages with any JSON-LD %', S.schema.pagesWithAnyLd), line('Organization on page %', S.schema.organizationPct), line('Person on page %', S.schema.personPct), line('Organization name variants', S.schema.orgNameVariants.join(' / ') || 'none'), line('sameAs variants', S.schema.orgSameAsVariants.length), line('Articles missing author / dates', `${S.schema.articlesMissingAuthor} / ${S.schema.articlesMissingDates}`), line('JSON-LD parse errors', S.schema.ldErrors.length), line('Type counts', Object.entries(S.schema.typeCounts).slice(0, 14).map(([t, n]) => `${t} ${n}`).join(', ')), '',
  '## Content', '| Check | Result |', '|---|---|', ...['medianWords', 'answerFirstPct', 'visibleDatePct', 'bylinePct', 'medianExternalCitations', 'pagesWithNoCitations', 'questionHeadingPages'].map(k => line(k, S.content[k])), line('thinPages (<300 words)', S.content.thinPages.length), line('topCitedDomains', S.content.topCitedDomains.slice(0, 10).map(([d, n]) => `${d} ${n}`).join(', ')), '',
  '### Prose tells per 1,000 words', '| Marker | Rate |', '|---|---|', ...Object.entries(S.content.slopPer1kWords).map(([k, v]) => line(k, v)), '',
  '### Boilerplate sentences (on 10%+ of pages)', ...S.content.boilerplateSentences.slice(0, 12).map(b => `- ${b.pages} pages: ${b.sentence}`), '',
  '### Near-duplicate titles', ...S.meta.nearDuplicateTitles.slice(0, 15).map(n => `- ${n.jaccard}: "${n.ta}" vs "${n.tb}"`), ''].join('\n');
fs.writeFileSync(path.join(OUT, 'content-report.md'), md);
console.error(`done: ${OUT}/content-report.md, summary.json, pages.json, text/`);
