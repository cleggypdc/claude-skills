#!/usr/bin/env node
// wayback-survival v1.0 — what did a site publish over the years, and what is still there? Pages that survived
// several rebuilds earned their place; sections that vanished wholesale are the experiments that failed.
// Pulls the Wayback Machine CDX index (HTML, status 200), compares it with the live sitemap, groups by first-seen
// year and top-level section, and checks what retired URLs return now (301 vs 404). No dependencies (Node 18+).
// Usage: node wayback-survival.mjs example.com [--out ./wayback-out] [--from 2019] [--check 20]
// Note: web.archive.org rate-limits and some sandboxes block it; if fetch fails, run from a normal machine.
import fs from 'node:fs'; import path from 'node:path';
const args = process.argv.slice(2); const flag = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const domain = (args.find(a => !a.startsWith('--') && /\./.test(a)) || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
if (!domain) { console.error('usage: node wayback-survival.mjs example.com [--out ./wayback-out]'); process.exit(1); }
const OUT = flag('--out', './wayback-out'), FROM = flag('--from', ''), CHECK = +flag('--check', 20); fs.mkdirSync(OUT, { recursive: true });
const get = async (u, opts = {}) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (site-qa wayback-survival)' }, ...opts }); if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 4000 * (i + 1))); continue; } return { status: r.status, location: r.headers.get('location'), body: opts.method === 'HEAD' ? '' : await r.text() }; } catch (e) { if (i === 2) return { status: 'ERR ' + e.message, body: '' }; } } return { status: 'ERR', body: '' }; };
const norm = u => { try { const x = new URL(u.replace(/^http:/, 'https:')); return (decodeURIComponent(x.pathname).replace(/\/+$/, '') || '/').toLowerCase(); } catch { return null; } };
const section = p => { const s = p.split('/').filter(Boolean); if (!s.length) return '/'; return /^[a-z]{2}(-[a-z]{2})?$/.test(s[0]) && s[1] ? `${s[0]}/${s[1]}` : s[0]; };

const cdx = await get(`https://web.archive.org/cdx/search/cdx?url=${domain}/*&output=json&fl=timestamp,original,statuscode&filter=mimetype:text/html&filter=statuscode:200${FROM ? '&from=' + FROM : ''}`);
let rows; try { rows = JSON.parse(cdx.body).slice(1); } catch { console.error('CDX fetch failed:', cdx.status, cdx.body.slice(0, 200)); process.exit(2); }
const hist = new Map();
for (const [ts, orig] of rows) { if (/%0a|\s/i.test(orig)) continue; const p = norm(orig); if (!p || /\.(xml|txt|json|js|css|png|jpe?g|svg|pdf)$/.test(p)) continue; const h = hist.get(p) || { first: ts, last: ts, captures: 0 }; h.first = ts < h.first ? ts : h.first; h.last = ts > h.last ? ts : h.last; h.captures++; hist.set(p, h); }

const live = new Set(); const seen = new Set();
const readSm = async u => { if (seen.has(u) || seen.size > 50) return; seen.add(u); const r = await get(u); const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, '&')); if (/<sitemapindex/i.test(r.body)) for (const l of locs) await readSm(l); else locs.forEach(l => { const p = norm(l); if (p) live.add(p); }); };
const robots = await get(`https://www.${domain}/robots.txt`); for (const m of robots.body.matchAll(/^sitemap:\s*(\S+)/gim)) await readSm(m[1]); if (!live.size) await readSm(`https://www.${domain}/sitemap.xml`); if (!live.size) await readSm(`https://${domain}/sitemap.xml`);

const groups = new Map();
for (const [p, h] of hist) { const k = `${h.first.slice(0, 4)}\t${section(p)}`; const g = groups.get(k) || { total: 0, alive: 0, captures: 0, sample: [] }; g.total++; g.captures += h.captures; if (live.has(p)) g.alive++; else if (g.sample.length < 6) g.sample.push(p); groups.set(k, g); }
const table = [...groups].map(([k, g]) => { const [year, sec] = k.split('\t'); return { year, section: sec, published: g.total, stillLive: g.alive, survivalPct: Math.round(100 * g.alive / g.total), avgCaptures: +(g.captures / g.total).toFixed(1), retiredSample: g.sample }; }).sort((a, b) => a.year.localeCompare(b.year) || b.published - a.published);
const survivors = [...hist].filter(([p, h]) => live.has(p) && h.first.slice(0, 4) < String(new Date().getFullYear())).map(([p, h]) => ({ path: p, firstSeen: h.first.slice(0, 8), captures: h.captures })).sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
const retired = [...hist].filter(([p]) => !live.has(p)).map(([p]) => p);
const checks = []; for (const p of retired.sort(() => Math.random() - 0.5).slice(0, CHECK)) { const r = await get(`https://www.${domain}${p}`, { method: 'HEAD', redirect: 'manual' }); checks.push({ path: p, status: r.status, location: r.location }); }
const newOnly = [...live].filter(p => !hist.has(p)).length;
const res = { domain, date: new Date().toISOString().slice(0, 10), archivedPaths: hist.size, livePaths: live.size, liveNotYetArchived: newOnly, bySection: table, survivors, retiredStatusSample: checks };
fs.writeFileSync(path.join(OUT, 'wayback.json'), JSON.stringify(res, null, 1));
const redirected = checks.filter(c => /^30/.test(String(c.status))).length, gone = checks.filter(c => /^(404|410)$/.test(String(c.status))).length;
const md = [`# Wayback survival: ${domain} (${res.date})`, '', `${hist.size} archived HTML paths; ${live.size} in today's sitemap (${newOnly} not yet archived).`, '',
  '| First seen | Section | Published | Still live | Survival | Avg captures |', '|---|---|---|---|---|---|',
  ...table.filter(t => t.published >= 3).map(t => `| ${t.year} | ${t.section} | ${t.published} | ${t.stillLive} | ${t.survivalPct}% | ${t.avgCaptures} |`), '',
  `Retired URLs sampled: ${checks.length} (${redirected} redirect, ${gone} 404/410, ${checks.length - redirected - gone} other).`, '',
  '## Oldest survivors', ...survivors.slice(0, 60).map(s => `- ${s.firstSeen} ${s.path} (${s.captures} captures)`), '',
  '## Retired, by section (samples)', ...table.filter(t => t.survivalPct < 50 && t.published >= 5).map(t => `- ${t.year} ${t.section}: ${t.retiredSample.join(', ')}`)].join('\n');
fs.writeFileSync(path.join(OUT, 'wayback-report.md'), md);
console.error(`done: ${OUT}/wayback-report.md, wayback.json`);
