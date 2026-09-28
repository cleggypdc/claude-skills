(async (opts = {}) => {
  // site-qa-scan v2 — run in page context (Playwright evaluate, Chrome/built-in browser JS tool, DevTools). Returns JSON.
  // opts via window.__qaOpts = { links: true, scripts: true } before running: links HEAD-checks up to 60 same-origin links; { scripts: true } also scans same-origin JS files for comments/secrets.
  const MAX = 10, vw = innerWidth, vh = innerHeight;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Scroll once so lazy content renders, then return to top
  for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(vh * .8)) { scrollTo(0, y); await sleep(120); }
  scrollTo(0, 0); await sleep(600);

  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const sel = el => { if (!el || !el.tagName) return ''; if (el.id) return '#' + el.id; const c = [...el.classList].slice(0, 3).join('.'); return el.tagName.toLowerCase() + (c ? '.' + c : ''); };
  const txt = el => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const own = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim();
  const parseRGB = s => { const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const hsl = ({ r, g, b }) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return { h, s, l }; };
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const hex = c => c ? '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('') : null;
  const all = [...document.querySelectorAll('body *')].filter(el => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'TEMPLATE'].includes(el.tagName) && vis(el));
  const out = { url: location.href, viewport: `${vw}x${vh}`, checks: {}, fingerprint: {}, slopLeads: {}, proofread: [] };
  const add = (group, k, items, note) => { (out.checks[group] ||= {})[k] = { count: items.length, note, examples: items.slice(0, MAX) }; };

  // ───────── A. BREAKAGE ─────────
  const imgs = [...document.images];
  add('broken', 'images', imgs.filter(i => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src)).map(i => ({ sel: sel(i), alt: i.alt, src: (i.currentSrc || i.src).slice(0, 140), visible: vis(i) })), 'img failed to load (alt text or broken icon shows). Hot-linked third-party images are a common cause.');
  add('broken', 'hotlinkedImages', imgs.filter(i => { try { const h = new URL(i.src).host; return h && h !== location.host && !/cdn|cloudfront|website-files|imgix|cloudinary|googleusercontent|gstatic|ctfassets|sanity|shopify|wp\.com|unsplash/.test(h); } catch { return false; } }).map(i => ({ sel: sel(i), src: i.src.slice(0, 140) })), 'images served from someone else\'s site (not a CDN) — can break or be swapped at any time');
  add('broken', 'missingAlt', imgs.filter(i => vis(i) && !i.hasAttribute('alt') && i.getBoundingClientRect().width > 40).map(i => ({ sel: sel(i), src: (i.currentSrc || i.src).slice(-60) })), 'content images with no alt attribute (decorative images should have alt="")');
  add('broken', 'decorativeImgWithAlt', imgs.filter(i => /blur|glow|gradient|background|bg|decor|blob|shape/i.test(i.alt) ).map(i => ({ sel: sel(i), alt: i.alt })), 'decorative image carrying alt text — screen readers read it out, and it shows as text if it fails. Use CSS or alt="".');
  const junk = [];
  const junkRe = /\b(lorem ipsum|dolor sit amet|john doe|jane doe|acme (inc|corp)|example\.com|your (company|name|email) here|todo:?|tbd|fixme)\b|\{\{[^}]*\}\}|\[object Object\]|\bundefined\b|\bNaN\b|\bnull\b(?! and)|\b(?<dw>[a-z]{3,})\s+\k<dw>\b/gi;
  const tw0 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n0; const shortTexts = new Map();
  while ((n0 = tw0.nextNode())) {
    const t = n0.textContent.trim(), pe = n0.parentElement; if (!t || !pe || pe.closest('script,style,noscript,code,pre,textarea') || !vis(pe)) continue;
    let m; junkRe.lastIndex = 0; while ((m = junkRe.exec(t)) && junk.length < 30) junk.push({ sel: sel(pe), match: m[0], context: t.slice(Math.max(0, m.index - 30), m.index + 40) });
    if (t.length >= 3 && t.length <= 160 && /[a-z]/i.test(t) && shortTexts.size < 400) shortTexts.set(t, sel(pe));
  }
  const bodyFam = getComputedStyle(document.body).fontFamily;
  add('broken', 'unstyledElements', all.filter(e => own(e) && /^("?times new roman"?|serif|"?times"?)$/i.test(getComputedStyle(e).fontFamily.split(',')[0].trim()) && !/serif/i.test(bodyFam.split(',')[0]) ).map(e => ({ sel: sel(e), text: txt(e).slice(0, 40), font: getComputedStyle(e).fontFamily.slice(0, 30) })), 'text in the browser default font — usually a third-party element (cookie button, embed) nobody styled');
  add('broken', 'placeholderOrTemplateText', junk, 'lorem/placeholder data, unrendered {{tokens}}, undefined/NaN/null, doubled words');
  if (opts.links) {
    const links = [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href.split('#')[0]).filter(h => h.startsWith(location.origin)))].slice(0, 60);
    const bad = [];
    await Promise.all(links.map(async h => { try { const r = await fetch(h, { method: 'HEAD', redirect: 'follow' }); if (r.status >= 400) bad.push({ href: h, status: r.status }); } catch (e) { bad.push({ href: h, status: 'fetch failed' }); } }));
    add('broken', 'links', bad, `${links.length} same-origin links checked`);
  }

  // ───────── B. LAYOUT: gutters, overflow, overlays, contrast ─────────
  // Bands = the vertical stack of full-width sections (header, sections, footer)
  const full = el => el.getBoundingClientRect().width >= vw * .95;
  const bands = [];
  const expand = el => {
    const kids = [...el.children].filter(k => vis(k) && k.getBoundingClientRect().height > 8 && !['fixed', 'absolute'].includes(getComputedStyle(k).position));
    const fullKids = kids.filter(full), H = el.getBoundingClientRect().height;
    if (fullKids.length >= 2) fullKids.forEach(expand);
    else if (fullKids.length === 1 && fullKids[0].getBoundingClientRect().height > H * .5 && fullKids[0].children.length) expand(fullKids[0]);
    else if (full(el) && H >= 16) bands.push(el);
  };
  expand(document.body);
  const gutterRows = [];
  for (const b of bands) {
    const br = b.getBoundingClientRect(); let L = Infinity, R = -Infinity, boxR = -Infinity, centred = 0, textAtoms = 0, bleed = false;
    for (const a of b.querySelectorAll('*')) {
      if (!vis(a)) continue; const s = getComputedStyle(a);
      if (s.position === 'fixed' || (s.position === 'absolute' && !own(a))) continue;
      if (a.closest('[aria-hidden=true]') || (a.closest('svg') && a.tagName !== 'svg')) continue;
      let r;
      if (own(a)) { // measure the glyphs, not the block box
        const rg = document.createRange(); const tn = [...a.childNodes].filter(x => x.nodeType === 3 && x.textContent.trim());
        rg.setStartBefore(tn[0]); rg.setEndAfter(tn[tn.length - 1]); r = rg.getBoundingClientRect();
        if (!a.closest('button,a,[role=button],input,label')) { textAtoms++; if (s.textAlign === 'center') centred++; }
      } else if (a.matches('img,svg,video,canvas,input,select,textarea') || ((parseRGB(s.backgroundColor)?.a > .05 || parseFloat(s.borderLeftWidth) > 0) && a.getBoundingClientRect().height > 30)) {
        r = a.getBoundingClientRect(); if (r.width >= vw * .9) continue; // full-bleed backgrounds
      } else continue;
      if (!r.width) continue;
      if (r.left < -1 || r.right > vw + 1) { bleed = true; continue; } // carousels/marquees
      L = Math.min(L, r.left); R = Math.max(R, r.right); if (!own(a)) boxR = Math.max(boxR, r.right);
    }
    if (L === Infinity) continue;
    gutterRows.push({ sel: sel(b), top: Math.round(br.top + scrollY), height: Math.round(br.height), left: Math.round(L), right: boxR > -Infinity ? Math.round(vw - boxR) : null, centred: textAtoms > 0 && centred / textAtoms > .8, bleed });
  }
  const modeOf = arr => { const m = {}; arr.forEach(([v, w]) => { const k = Math.round(v / 4) * 4; m[k] = (m[k] || 0) + w; }); return +Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0]; };
  const aligned = gutterRows.filter(g => !g.centred);
  const gutter = modeOf(aligned.map(g => [g.left, g.height]));
  const offGutter = aligned.filter(g => Math.abs(g.left - gutter) > 8).map(g => ({ ...g, delta: g.left - gutter }));
  const asym = aligned.filter(g => g.right !== null && g.right < vw / 3 && Math.abs(g.left - g.right) > 12 && !g.bleed).map(g => ({ sel: g.sel, top: g.top, left: g.left, right: g.right }));
  const distinct = [...new Set(aligned.map(g => Math.round(g.left / 4) * 4))].sort((a, b) => a - b);
  add('layout', 'gutterInconsistency', offGutter, `dominant left gutter ${gutter}px; ${distinct.length} distinct left edges across ${aligned.length} left-aligned bands: ${distinct.join(', ')}px. Centred bands excluded.`);
  add('layout', 'asymmetricGutters', asym, 'left content edge vs right edge of boxed content (cards, images, panels) differ by >12px');
  out.gutterMap = gutterRows;
  const ovf = document.documentElement.scrollWidth - vw;
  add('layout', 'horizontalOverflow', ovf > 1 ? [{ overflowPx: ovf, culprits: all.filter(e => e.getBoundingClientRect().right > vw + 1 && !e.closest('[style*=overflow],[class*=marquee],[class*=carousel],[class*=slider]')).slice(0, 5).map(sel) }] : [], 'page scrolls sideways');
  // Fixed/sticky elements covering content (chat widgets, cookie bars, floating CTAs)
  const fixed = all.filter(e => { const s = getComputedStyle(e); if (!/fixed|sticky/.test(s.position)) return false; const r = e.getBoundingClientRect(); return !(r.top <= 1 && r.width >= vw * .9) && r.width * r.height > 1500; });
  const covers = [];
  for (const f of fixed.slice(0, 6)) {
    const hits = new Set();
    for (let y = 0; y < document.documentElement.scrollHeight && hits.size < 6; y += vh) {
      scrollTo(0, y); await sleep(60);
      const r = f.getBoundingClientRect();
      for (const [px, py] of [[r.left + 4, r.top + 4], [r.left + r.width / 2, r.top + r.height / 2], [r.right - 4, r.bottom - 4]]) {
        const under = document.elementsFromPoint(px, py).find(e => !f.contains(e) && !e.contains(f) && (own(e) || e.tagName === 'IMG') && vis(e));
        if (under) hits.add(`${sel(under)} "${txt(under).slice(0, 30)}" @y${y}`);
      }
    }
    if (hits.size) covers.push({ fixed: sel(f), size: `${f.getBoundingClientRect().width | 0}x${f.getBoundingClientRect().height | 0}`, covers: [...hits].slice(0, 5) });
  }
  scrollTo(0, 0);
  all.filter(e => getComputedStyle(e).position === 'fixed' && full(e) && e.getBoundingClientRect().height >= vh * .9 && (e.shadowRoot === null && e.tagName.includes('-') || getComputedStyle(e).pointerEvents === 'none')).forEach(e => covers.push({ fixed: sel(e), note: 'full-viewport overlay host (third-party widget, often closed shadow DOM) — its visible parts cannot be measured; check screenshots for what it covers' }));
  add('layout', 'fixedElementsCoveringContent', covers, 'fixed/sticky elements that sit on top of text or images at some scroll position');
  // Contrast (WCAG AA)
  const lowC = [], overImg = [];
  for (const el of all) {
    const t = own(el); if (!t || t.length < 2) continue;
    const s = getComputedStyle(el), fg = parseRGB(s.color); if (!fg) continue;
    let bg = null, img = false;
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const ps = getComputedStyle(p); if (ps.backgroundImage !== 'none' && !/gradient/.test(ps.backgroundImage)) { img = true; break; }
      const c = parseRGB(ps.backgroundColor); if (c && c.a >= .5) { bg = c; break; }
    }
    if (img) { if (overImg.length < MAX) overImg.push({ sel: sel(el), text: t.slice(0, 40) }); continue; }
    bg = bg || { r: 255, g: 255, b: 255 };
    if (hex(bg) === hex(fg)) { if (overImg.length < MAX) overImg.push({ sel: sel(el), text: t.slice(0, 40), note: 'text colour equals nearest ancestor background — it sits on a sibling layer; check visually' }); continue; }
    const size = parseFloat(s.fontSize), large = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700);
    const cr = ratio({ ...fg, r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) }, bg);
    if (cr < (large ? 3 : 4.5)) lowC.push({ sel: sel(el), text: t.slice(0, 40), ratio: +cr.toFixed(2), fg: hex(fg), bg: hex(bg), px: size });
  }
  const pairs = {}; lowC.forEach(x => { const k = `${x.fg} on ${x.bg}`; (pairs[k] ||= { pair: k, ratio: x.ratio, count: 0, samples: [] }); pairs[k].count++; if (pairs[k].samples.length < 3) pairs[k].samples.push(`${x.sel} "${x.text}" ${x.px}px`); });
  add('layout', 'lowContrast', Object.values(pairs).sort((a, b) => b.count - a.count), `${lowC.length} text elements below WCAG AA (4.5:1, or 3:1 large), grouped by colour pair — fix the token, not each element`);
  add('layout', 'textOverImages', overImg, 'text on a photo/image background — contrast cannot be computed; check the screenshot');

  // ───────── C. HEAD / META HYGIENE ─────────
  const metas = [...document.head.querySelectorAll('meta')], m = [];
  const mc = q => document.head.querySelectorAll(q).length, mv = q => document.head.querySelector(q)?.getAttribute('content') || '';
  const title = document.title.trim(), desc = mv('meta[name=description]');
  if (!title) m.push({ issue: 'missing <title>' }); else if (title.length < 25 || title.length > 65) m.push({ issue: `title length ${title.length} (aim 30-65)`, title });
  if (!desc) m.push({ issue: 'missing meta description' }); else if (desc.length < 70 || desc.length > 170) m.push({ issue: `description length ${desc.length} (aim 70-160)`, desc: desc.slice(0, 120) });
  if (mc('meta[name=description]') > 1) m.push({ issue: `${mc('meta[name=description]')} meta descriptions` });
  const dupKeys = {}; metas.forEach(x => { const k = x.getAttribute('name') || x.getAttribute('property'); if (k) dupKeys[k] = (dupKeys[k] || 0) + 1; });
  Object.entries(dupKeys).filter(([k, v]) => v > 1 && !/^(og:image|og:locale:alternate|article:tag|og:video)/.test(k)).forEach(([k, v]) => m.push({ issue: `duplicate meta "${k}" x${v}` }));
  const kw = mv('meta[name=keywords]'); if (kw) m.push({ issue: `meta keywords present (${kw.split(',').length} terms) — ignored by search engines, reads as stuffing`, sample: kw.slice(0, 100) });
  ['og:title', 'og:description', 'og:image'].forEach(p => { if (!mc(`meta[property="${p}"]`)) m.push({ issue: `missing ${p}` }); });
  if (!mc('meta[name="twitter:card"]')) m.push({ issue: 'missing twitter:card' });
  const canon = document.head.querySelector('link[rel=canonical]')?.href;
  if (!canon) m.push({ issue: 'missing canonical' }); else if (canon.replace(/\/$/, '') !== location.href.split(/[?#]/)[0].replace(/\/$/, '')) m.push({ issue: 'canonical differs from URL', canon });
  if (/noindex/i.test(mv('meta[name=robots]'))) m.push({ issue: 'robots noindex on this page — intended?' });
  if (!document.documentElement.lang) m.push({ issue: 'missing <html lang>' });
  if (!mc('meta[name=viewport]')) m.push({ issue: 'missing viewport meta' });
  const h1s = [...document.querySelectorAll('h1')].filter(vis); if (h1s.length !== 1) m.push({ issue: `${h1s.length} visible h1 elements` });
  const gen = mv('meta[name=generator]'); if (gen) m.push({ issue: 'generator meta leaks the stack', value: gen });
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]; ld.forEach((s, i) => { try { JSON.parse(s.textContent); } catch { m.push({ issue: `JSON-LD block ${i + 1} does not parse` }); } });
  if (ld.length > 6) m.push({ issue: `${ld.length} JSON-LD blocks — likely overlapping/duplicated schema` });
  const headKB = (document.head.outerHTML.length / 1024) | 0; if (headKB > 60 || metas.length > 45) m.push({ issue: `heavy <head>: ${headKB}KB, ${metas.length} meta, ${mc('link')} link, ${mc('script')} script tags` });
  const ogImg = mv('meta[property="og:image"]');
  if (ogImg) { try { const r = await fetch(ogImg, { method: 'HEAD', mode: 'no-cors' }); if (r.type !== 'opaque' && r.status >= 400) m.push({ issue: `og:image returns ${r.status}`, ogImg }); } catch { m.push({ issue: 'og:image not fetchable', ogImg }); } }
  add('meta', 'headHygiene', m, 'title/description, social cards, canonical, robots, lang, h1, stack leaks, schema, head weight');
  out.meta = { title, description: desc, ogTitle: mv('meta[property="og:title"]'), ogImage: ogImg, canonical: canon, jsonLd: ld.length, headKB };

  // ───────── D. SOURCE LEAKAGE (security) ─────────
  const aiRe = /\b(as an ai|here'?s (the|an?|your) (updated|revised|improved|new|complete)|i'?ve (added|updated|changed|fixed|removed)|let me|claude|chatgpt|gpt-?[345]|openai|github copilot|cursor ?ai|generated (by|with)|ai[- ]generated|v0(\.dev)?|lovable|bolt\.new|windsurf|replit agent|this (function|section|component|block|div|container) (handles|renders|is responsible|displays|contains|wraps)|two[- ]column layout|step \d+[:.]|you (can|may|might want to) (customi[sz]e|replace|adjust|change|add)|replace (this|with your|the placeholder)|feel free to|for demo(nstration)? purposes|in a real (app|application|implementation)|simulated?|mock(ed)? data)\b/i;
  const secretRe = /(sk-(proj-|ant-)?[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abpr]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY|service_role|(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"\s]{8,}['"]|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
  const infraRe = /(localhost(:\d+)?|127\.0\.0\.1|\b10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|\bstaging\b|\bstg\.|\bdev\.[a-z]|\.internal\b|\/Users\/\w+|[A-Z]:\\\\|\/home\/\w+|\b(TODO|FIXME|HACK|XXX)\b|temporar(y|ily)|remove (this )?before|disable[ds]? (auth|validation|csrf|check)|bypass|\b[A-Z]{2,6}-\d{2,5}\b|\b20\d\d-\d\d-\d\d\b)/;
  const comments = [];
  const cw = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT);
  let c; while ((c = cw.nextNode())) { const t = c.textContent.trim(); if (t) comments.push({ where: 'html', parent: sel(c.parentElement), text: t }); }
  const scanJS = (code, where) => { const re = /\/\*[\s\S]*?\*\/|(^|[^:'"\\])\/\/[^\n]*/g; let mm; while ((mm = re.exec(code)) && comments.length < 2000) { const t = mm[0].replace(/^[^/]*\/\/|^\/\*|\*\/$/g, '').trim(); if (t.length > 3 && !/^[#@]\s*source(Mapping)?URL/.test(t) && !/^!|license|copyright|@preserve/i.test(t)) comments.push({ where, text: t }); } };
  document.querySelectorAll('script:not([src])').forEach((s, i) => { if (!/json/.test(s.type)) scanJS(s.textContent, `inline script ${i + 1}`); });
  document.querySelectorAll('style').forEach((s, i) => { (s.textContent.match(/\/\*[\s\S]*?\*\//g) || []).forEach(t => comments.push({ where: `inline style ${i + 1}`, text: t.slice(2, -2).trim() })); });
  const secrets = [];
  const scanSecrets = (code, where) => { const mm = code.match(new RegExp(secretRe, 'g')) || []; mm.forEach(s => secrets.push({ where, match: s.slice(0, 12) + '…' + s.slice(-4) })); };
  scanSecrets(document.documentElement.outerHTML, 'document');
  const maps = [];
  if (opts.scripts) {
    const srcs = [...document.querySelectorAll('script[src]')].map(s => s.src).filter(s => s.startsWith(location.origin)).slice(0, 12);
    for (const s of srcs) { try { const code = await (await fetch(s)).text(); if (code.length < 3e6) { scanJS(code, s.split('/').pop()); scanSecrets(code, s.split('/').pop()); } const sm = code.match(/sourceMappingURL=([^\s'"]+)/); if (sm && !sm[1].startsWith('data:')) { const u = new URL(sm[1], s).href; const r = await fetch(u, { method: 'HEAD' }); if (r.ok) maps.push({ script: s, map: u }); } } catch { } }
  }
  const classify = x => ({ ...x, text: x.text.replace(/\s+/g, ' ').slice(0, 160), ai: aiRe.test(x.text), infra: infraRe.test(x.text) });
  const cl = comments.map(classify);
  add('leakage', 'secrets', secrets, 'credential-shaped strings in the delivered page/JS — rotate and remove. (Public-by-design keys like Stripe pk_ or Firebase web config are not flagged; Supabase anon JWTs are, so check.)');
  add('leakage', 'aiAuthoringComments', cl.filter(x => x.ai), 'comments that read like an AI assistant wrote or explained the code');
  add('leakage', 'internalInfoComments', cl.filter(x => x.infra && !x.ai), 'comments naming staging, internal hosts/paths, ticket IDs, dates, people, TODO/FIXME or disabled checks');
  add('leakage', 'exposedSourceMaps', maps, 'public .map files expose original source (and every comment in it)');
  const fp = [...document.querySelectorAll('[data-lov-id],[data-lovable],[data-v0],[data-bolt]')].length;
  out.checks.leakage.allComments = { count: cl.length, note: 'all comments shipped to the browser', examples: cl.slice(0, 25) };
  if (fp || gen) out.checks.leakage.builderFingerprints = { count: fp + (gen ? 1 : 0), note: 'AI/site-builder fingerprints', examples: [gen && { generator: gen }, fp && { dataAttributes: fp }].filter(Boolean) };

  // ───────── E. CONSISTENCY FINGERPRINT (compare across pages) ─────────
  const first = el => el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim() : null;
  const fontUse = {}; all.forEach(el => { if (own(el)) { const f = first(el); fontUse[f] = (fontUse[f] || 0) + 1; } });
  const hs = ['h1', 'h2', 'h3'].map(h => { const e = [...document.querySelectorAll(h)].find(vis); return e ? `${h}:${first(e)} ${getComputedStyle(e).fontSize}/${getComputedStyle(e).fontWeight}` : null; }).filter(Boolean);
  const btns = all.filter(e => e.matches('a,button,[role=button],input[type=submit]') && txt(e) && txt(e).length < 40 && (parseRGB(getComputedStyle(e).backgroundColor)?.a > .5 || parseFloat(getComputedStyle(e).borderTopWidth) > 0) && parseFloat(getComputedStyle(e).paddingLeft) >= 8);
  const ctaStyles = {}; btns.forEach(b => { const s = getComputedStyle(b); const k = `${hex(parseRGB(s.backgroundColor))} r${parseFloat(s.borderTopLeftRadius)} ${s.fontSize} ${s.fontWeight}`; (ctaStyles[k] ||= new Set()).add(txt(b)); });
  const radii = {}; all.forEach(e => { const r = parseFloat(getComputedStyle(e).borderTopLeftRadius); if (r >= 2 && r < 100 && e.getBoundingClientRect().width > 60) radii[r] = (radii[r] || 0) + 1; });
  const secPad = {}; bands.forEach(b => { const p = parseFloat(getComputedStyle(b).paddingTop); if (p) secPad[p] = (secPad[p] || 0) + 1; });
  out.fingerprint = { bodyFont: first(document.body), fontUse, headings: hs, ctaStyles: Object.fromEntries(Object.entries(ctaStyles).map(([k, v]) => [k, [...v].slice(0, 6)])), radii, gutter, distinctGutters: distinct, sectionPaddingTop: secPad, bodyText: `${getComputedStyle(document.body).fontSize}/${getComputedStyle(document.body).lineHeight}` };
  const ctaLabels = btns.map(txt).filter(t => /demo|start|sign ?up|get started|contact|trial|book|buy/i.test(t));
  const norm = t => t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !['a', 'an', 'the', 'free', 'your', 'now'].includes(w) && !/^\d+$|minute|min$/.test(w)).join('');
  const variants = {}; ctaLabels.forEach(t => { const k = norm(t); (variants[k] ||= new Set()).add(t); });
  add('consistency', 'ctaVariants', Object.values(variants).filter(v => v.size > 1).map(v => [...v]), 'same action labelled differently');
  add('consistency', 'ctaStyleCount', Object.keys(ctaStyles).length > 3 ? [out.fingerprint.ctaStyles] : [], `${Object.keys(ctaStyles).length} distinct button styles on one page`);
  add('consistency', 'radiusScale', Object.keys(radii).length > 4 ? [radii] : [], `${Object.keys(radii).length} distinct corner radii in use`);
  add('consistency', 'fontFamilies', Object.keys(fontUse).length > 3 ? [fontUse] : [], `${Object.keys(fontUse).length} font families rendering text`);

  // ───────── F. SLOP TELLS (leads to judge, not verdicts) ─────────
  const grads = all.filter(e => /gradient\(/.test(getComputedStyle(e).backgroundImage));
  const purple = grads.filter(e => (getComputedStyle(e).backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parseRGB).some(c => { const x = hsl(c); return x.s > .3 && x.h >= 245 && x.h <= 320; }));
  const gtext = grads.filter(e => (getComputedStyle(e).webkitBackgroundClip || getComputedStyle(e).backgroundClip) === 'text');
  out.slopLeads.gradients = { count: grads.length, purple: purple.length, gradientText: gtext.map(e => txt(e).slice(0, 40)), onButtons: grads.filter(e => e.matches('a,button')).length };
  const hueArea = {}; let colA = 0;
  all.forEach(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el), a = Math.min(r.width, vw) * Math.min(r.height, vh * 3); [[parseRGB(s.backgroundColor), a], [own(el) ? parseRGB(s.color) : null, Math.min(a, 4000)]].forEach(([c, w]) => { if (!c || c.a < .5) return; const x = hsl(c); if (x.s < .35 || x.l < .15 || x.l > .9) return; const f = Math.round(x.h / 30) % 12; hueArea[f] = (hueArea[f] || 0) + w; colA += w; }); });
  const names = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'azure', 'blue', 'violet', 'magenta', 'pink'];
  out.slopLeads.hueFamilies = Object.entries(hueArea).filter(([, a]) => a / colA > .03).sort((a, b) => b[1] - a[1]).map(([f, a]) => `${names[f]} ${(a / colA * 100) | 0}%`);
  const statusRe = /^(active|live|online|verified|new|beta|connected|synced|secure|official|trusted|ai[- ]powered)\b/i;
  out.slopLeads.infiniteAnimations = all.filter(e => getComputedStyle(e).animationName !== 'none' && /infinite/.test(getComputedStyle(e).animationIterationCount)).map(e => `${sel(e)} (${getComputedStyle(e).animationName}) "${txt(e).slice(0, 25)}"`).slice(0, 15);
  out.slopLeads.statusBadges = all.filter(e => e.getBoundingClientRect().width < 220 && e.getBoundingClientRect().height < 48 && statusRe.test(txt(e)) && e.children.length <= 2).map(e => `${sel(e)} "${txt(e)}"`).slice(0, 10);
  out.slopLeads.reducedMotionRespected = [...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => /prefers-reduced-motion/.test(r.conditionText || r.media?.mediaText || '')); } catch { return false; } });
  out.slopLeads.cards = { count: all.filter(e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return parseFloat(s.borderTopLeftRadius) >= 12 && r.width > 120 && r.height > 60 && (parseRGB(s.backgroundColor)?.a > .05 || s.boxShadow !== 'none' || parseFloat(s.borderTopWidth) > 0); }).length };
  const emo = /\p{Extended_Pictographic}/gu; const emoHits = [...shortTexts.keys()].filter(t => (t.match(emo) || []).some(ch => !/[©®™]/.test(ch)));
  out.slopLeads.emoji = emoHits.slice(0, 10);
  out.slopLeads.fonts = { body: first(document.body), headings: hs, defaultish: /^(inter|geist|system-ui|-apple-system|roboto|arial|helvetica|poppins|space grotesk|plus jakarta sans|manrope|dm sans|outfit|montserrat)$/i.test(first(document.body)), slashPrefixes: [...shortTexts.keys()].filter(t => /^\/\/\s?\S/.test(t)).slice(0, 5) };
  out.slopLeads.glass = all.filter(e => /blur/.test(getComputedStyle(e).backdropFilter || getComputedStyle(e).webkitBackdropFilter || '')).map(e => `${sel(e)} bg ${getComputedStyle(e).backgroundColor}`).slice(0, 8);
  const corpus = [...shortTexts.keys()].join(' \n ');
  const grab = re => { const h = []; let mm; re.lastIndex = 0; while ((mm = re.exec(corpus)) && h.length < 20) h.push(corpus.slice(Math.max(0, mm.index - 25), mm.index + mm[0].length + 25).replace(/\s+/g, ' ')); return h; };
  out.slopLeads.hype = grab(/\b(elevate[sd]?|seamless(ly)?|next[- ]gen(eration)?|supercharge[sd]?|unleash(es|ed)?|empower(s|ed|ing)?|cutting[- ]edge|revolutioni[sz]e[sd]?|effortless(ly)?|game[- ]chang(er|ing)|unlock (the|your)|experience the power|harness the power|state[- ]of[- ]the[- ]art|blazing(ly)? fast|at your fingertips|to the next level|welcome (back )?to your \w+|welcome back,)/gi);
  out.slopLeads.sloganFragments = [...shortTexts.keys()].filter(t => /^([A-Z][^.!?]{1,30}[.!?]\s*){2,3}$/.test(t) && t.split(/[.!?]/).filter(Boolean).length >= 2 && t.length < 90).slice(0, 12);
  out.slopLeads.promptResidue = grab(/\b(built|made|crafted|written|coded) (with|in|using|from) [^.\n]{2,40}|\bpowered by [^.\n]{2,30}|\bwhy it matters:?|\bwho (uses|is) it (for)?:?|\bkey (benefits|features):|\bmade with (❤|love)/gi);
  out.slopLeads.repeatedLabels = Object.entries([...document.querySelectorAll('h4,h5,h6,strong,b,p,span,div')].filter(e => vis(e) && own(e) && own(e).length < 40 && /:$/.test(own(e))).reduce((a, e) => { const k = own(e); a[k] = (a[k] || 0) + 1; return a; }, {})).filter(([, v]) => v >= 3).map(([k, v]) => `"${k}" x${v}`);

  // ───────── G. PROOFREAD CORPUS (for the model to read, not regex) ─────────
  out.proofread = [...shortTexts.keys()].filter(t => t.split(' ').length >= 2).slice(0, 250);

  out.summary = Object.fromEntries(Object.entries(out.checks).map(([g, v]) => [g, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.count]))]));
  window.__siteQA = out;
  return out;
})(window.__qaOpts || {})
