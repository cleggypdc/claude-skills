#!/usr/bin/env node
// leak-crawl v1.1 — crawl a site (same origin, depth-limited), save page text, and scan HTML, inline + linked JS,
// CSS and public source maps for comments and credential-shaped strings. No dependencies (Node 18+).
// Usage: node leak-crawl.mjs https://example.com [--depth 2] [--max 150] [--out ./leak-out] [--third-party] [--probe]
//   Scans the site's own JS/CSS wherever it is hosted (incl. builder CDNs); known analytics/widget hosts are skipped.
//   --third-party  also scan analytics/widget scripts — noisy, off by default
//   --probe        also request a short list of commonly-exposed files (/.env, /.git/HEAD, ...) — only on sites you own/are authorised to test
import fs from 'node:fs'; import path from 'node:path';
const args = process.argv.slice(2); const flag = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
let root = new URL(args.find(a => /^https?:/.test(a)) || process.exit(console.error('usage: node leak-crawl.mjs <url> [--depth 2] [--max 150]') || 1));
const DEPTH = +flag('--depth', 2), MAXP = +flag('--max', 150), OUT = flag('--out', './leak-out'), THIRD = !!flag('--third-party', false), PROBE = !!flag('--probe', false);
fs.mkdirSync(path.join(OUT, 'text'), { recursive: true });
const UA = { 'user-agent': 'Mozilla/5.0 (site-qa leak-crawl; owner audit)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async (u, asText = true) => { try { const r = await fetch(u, { headers: UA, redirect: 'follow' }); return { ok: r.ok, status: r.status, type: r.headers.get('content-type') || '', url: r.url, body: asText ? await r.text() : '' }; } catch (e) { return { ok: false, status: 'ERR ' + e.message.slice(0, 60), body: '' }; } };

// ── detectors ──
const SECRETS = [
  ['OpenAI/Anthropic key', /\bsk-(?:proj-|ant-(?:api\d\d-)?)?[A-Za-z0-9_-]{24,}/g], ['Stripe secret', /\b[sr]k_live_[A-Za-z0-9]{16,}/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g], ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g], ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/g], ['Slack webhook', /hooks\.slack\.com\/services\/[A-Z0-9/]+/g], ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g], ['Supabase service role', /service_role/g],
  ['Mailgun/SendGrid', /\b(?:key-[0-9a-f]{32}|SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/g], ['Twilio', /\bSK[0-9a-f]{32}\b/g],
  ['DB connection string', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"<>]+:[^\s'"<>@]+@[^\s'"<>]+/g],
  ['Basic-auth URL', /https?:\/\/[^\s/'"<>:@]+:[^\s/'"<>@]{3,}@[^\s'"<>]+/g],
  ['Assigned secret', /\b(?:api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|pwd|auth[_-]?token|access[_-]?token|private[_-]?key)\b\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/gi],
];
const PUBLIC_OK = /\bpk_(live|test)_|firebaseapp\.com|G-[A-Z0-9]{6,}|UA-\d+-\d+|GTM-[A-Z0-9]+|recaptcha|sitekey/i; // publishable by design
const AI = /\b(as an ai|here'?s (the|an?|your) (updated|revised|improved|new|complete|fixed)|i'?ve (added|updated|changed|fixed|removed|implemented)|let me|claude|chatgpt|gpt-?[345]|openai|github copilot|cursor ?ai|generated (by|with)|ai[- ]generated|v0\.dev|lovable|bolt\.new|windsurf|replit agent|this (function|section|component|block|div|container|hook|handler) (handles|renders|is responsible|displays|contains|wraps|will)|(two|three)[- ]column layout|step \d+[:.]|you (can|may|might want to) (customi[sz]e|replace|adjust|change|add)|replace (this|with your|the placeholder)|feel free to|for demo(nstration)? purposes|in (a real|production,? you)|simulat(e|ed|ing)|mock(ed)? (data|response)|placeholder)\b/i;
const INFRA = /(localhost(:\d+)?|127\.0\.0\.1|\b10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|\bstaging\b|\bstg\.|\buat\b|\bdev\.[a-z]|\.internal\b|\.local\b|\/Users\/\w+|[A-Z]:\\|\/home\/\w+|\b(TODO|FIXME|HACK|XXX)\b|temporar(y|ily)|remove (this )?before|do not (ship|deploy)|disable[ds]? (auth|validation|csrf|check|rate)|bypass|hard-?coded|\b(admin|root) (user|password|login)|\b[A-Z]{2,6}-\d{2,5}\b|\b20\d\d-\d\d-\d\d\b|@[a-z0-9-]+\.(com|co\.uk|io)\b)/i;
const TRACKERS = /(googletagmanager|google-analytics|gstatic|googleapis|doubleclick|hs-scripts|hs-analytics|hsforms|hubspot|hs-banner|facebook|fbcdn|licdn|linkedin|hotjar|clarity\.ms|youtube|vimeo|code\.jquery|cdnjs|jsdelivr|unpkg|termly|cookiebot|onetrust|intercom|elevenlabs|js\.stripe|recaptcha|cloudflareinsights|segment\.(com|io)|sentry|posthog|mixpanel|calendly|typeform|vimeocdn|twitter|x\.com|tiktok|pinterest|bing\.com|ads)/i;
const RISK = /\b(api[_ -]?keys?|secrets?|passwords?|tokens?|auth(entication|ori[sz]ation)?|login|admin|bypass|disabled?|internal|staging|endpoints?|webhooks?|credentials?|env(ironment)? var|changelog|workspace)\b/i;

const findings = { pages: [], secrets: [], comments: [], sourceMaps: [], probes: [], errors: [] };
const seenSecret = new Set();
const scanSecrets = (text, where) => { const taken = []; for (const [kind, re] of SECRETS) { re.lastIndex = 0; let m; while ((m = re.exec(text))) { const s = m[0]; if (taken.some(([a, b]) => m.index < b && m.index + s.length > a)) continue; taken.push([m.index, m.index + s.length]); if (PUBLIC_OK.test(text.slice(Math.max(0, m.index - 40), m.index + s.length + 10))) continue; const k = kind + s; if (seenSecret.has(k)) continue; seenSecret.add(k); findings.secrets.push({ kind, where, redacted: s.length > 16 ? s.slice(0, 8) + '…' + s.slice(-4) : s.slice(0, 4) + '…', line: text.slice(0, m.index).split('\n').length }); } } };
const seenComment = new Set();
const looksLikeCode = t => /\bfunction\s*\(|=>|\$\{|\breturn\b|;\s*\w+\(/.test(t) && (t.match(/[{}();=]/g) || []).length > t.length / 20; // minified-code false positives
const addComment = (text, where, lang) => { const t = text.replace(/\s+/g, ' ').trim(); if (t.length < 4 || looksLikeCode(t) || /^(!|@license|@preserve|#\s*source(Mapping)?URL|eslint|prettier|istanbul|webpack|@ts-|jshint|global )/i.test(t) || /copyright|license|\(c\)\s*\d{4}/i.test(t)) return; const k = t.slice(0, 200); if (seenComment.has(k)) { const c = findings.comments.find(c => c.text.slice(0, 200) === k); if (c && c.where.length < 5 && !c.where.includes(where)) c.where.push(where); return; } seenComment.add(k); const ai = AI.test(t), infra = INFRA.test(t), risky = RISK.test(t) && (ai || infra); findings.comments.push({ text: t.slice(0, 300), where: [where], lang, ai, infra, risky }); scanSecrets(t, where + ' (comment)'); };
const jsComments = (code, where) => { const re = /\/\*[\s\S]*?\*\/|(?<![:'"`\\\w])\/\/[^\n]*/g; let m, n = 0; while ((m = re.exec(code)) && n++ < 3000) addComment(m[0].replace(/^\/\*+|\*+\/$|^\/\/+/g, ''), where, 'js'); };
const cssComments = (code, where) => (code.match(/\/\*[\s\S]*?\*\//g) || []).forEach(c => addComment(c.slice(2, -2), where, 'css'));
const htmlComments = (html, where) => (html.match(/<!--[\s\S]*?-->/g) || []).forEach(c => { if (!/^<!--\[if|^<!--\s*\/?(ko|ngIf)/.test(c)) addComment(c.slice(4, -3), where, 'html'); });
const pageText = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, ' ').replace(/<(br|\/p|\/h\d|\/li|\/div|\/section|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&[lr]dquo;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const scannedAssets = new Set();
const scanAsset = async (u, kind, from) => {
  if (scannedAssets.has(u)) return; scannedAssets.add(u);
  const r = await get(u); if (!r.ok) { findings.errors.push({ url: u, status: r.status, from }); return; }
  const name = u.replace(/^https?:\/\//, '').slice(0, 120);
  if (kind === 'js') { jsComments(r.body, name); scanSecrets(r.body, name); } else { cssComments(r.body, name); scanSecrets(r.body, name); }
  const sm = r.body.match(/[#@]\s*sourceMappingURL=([^\s'"*]+)/);
  if (sm && !sm[1].startsWith('data:')) { const mu = new URL(sm[1], u).href; const mr = await get(mu); if (mr.ok && /"mappings"/.test(mr.body)) { let srcs = 0; try { const j = JSON.parse(mr.body); srcs = (j.sources || []).length; (j.sourcesContent || []).forEach((c, i) => { if (!c) return; const w = `${mu.split('/').pop()} → ${j.sources[i]}`; if (/node_modules/.test(j.sources[i])) return; jsComments(c, w); scanSecrets(c, w); }); } catch { } findings.sourceMaps.push({ map: mu, sources: srcs, note: 'public source map — original source and all its comments are downloadable' }); } }
};

// ── crawl ──
{ const r0 = await get(root.href); if (r0.url) root = new URL(r0.url); } // follow apex→www etc. redirects so same-host checks use the real host
const queue = [[root.href.split('#')[0], 0]], seen = new Set([queue[0][0]]);
const sm = await get(new URL('/sitemap.xml', root).href); // seed from sitemap (depth 1) if present
if (sm.ok && /<urlset|<sitemapindex/.test(sm.body)) (sm.body.match(/<loc>([^<]+)<\/loc>/g) || []).map(x => x.slice(5, -6).trim()).filter(u => { try { return new URL(u).host === root.host && !/\.xml$/.test(u); } catch { return false; } }).slice(0, MAXP).forEach(u => { if (!seen.has(u)) { seen.add(u); queue.push([u, 1]); } });
while (queue.length && findings.pages.length < MAXP) {
  const [u, d] = queue.shift(); const r = await get(u);
  if (!r.ok || !/html/.test(r.type)) { if (!r.ok) findings.errors.push({ url: u, status: r.status }); continue; }
  const html = r.body, slug = (new URL(r.url).pathname.replace(/\/$/, '') || '/index').replace(/[^\w-]+/g, '_').slice(0, 100);
  fs.writeFileSync(path.join(OUT, 'text', slug + '.txt'), `URL: ${r.url}\n\n` + pageText(html));
  findings.pages.push({ url: r.url, depth: d, bytes: html.length });
  htmlComments(html, new URL(r.url).pathname); scanSecrets(html.replace(/<script[^>]*type=["']application\/ld\+json["'][\s\S]*?<\/script>/gi, ''), new URL(r.url).pathname);
  (html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi) || []).forEach((s, i) => { if (!/application\/(ld\+)?json/.test(s)) jsComments(s.replace(/^<script[^>]*>|<\/script>$/gi, ''), `${new URL(r.url).pathname} inline script ${i + 1}`); });
  (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).forEach(s => cssComments(s, `${new URL(r.url).pathname} inline style`));
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) { try { const a = new URL(m[1], r.url); if (THIRD || !TRACKERS.test(a.host)) await scanAsset(a.href, 'js', r.url); } catch { } }
  for (const m of html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["']|<link[^>]+href=["']([^"']+)["'][^>]*rel=["']?stylesheet/gi)) { try { const a = new URL(m[1] || m[2], r.url); if (THIRD || !TRACKERS.test(a.host)) await scanAsset(a.href, 'css', r.url); } catch { } }
  if (d < DEPTH) for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)/gi)) { try { const a = new URL(m[1], r.url); a.hash = ''; if (a.host === root.host && /^https?:$/.test(a.protocol) && !/\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|mp4|mp3)$/i.test(a.pathname) && !seen.has(a.href)) { seen.add(a.href); queue.push([a.href, d + 1]); } } catch { } }
  await sleep(150);
}
const miss = PROBE ? await get(new URL('/__leak-crawl-' + Date.now() + '.json', root).href) : null; // SPA/soft-404 fingerprint
if (PROBE) for (const p of ['/.env', '/.env.local', '/.env.production', '/.git/HEAD', '/.git/config', '/.DS_Store', '/config.json', '/env.js', '/.vscode/settings.json', '/phpinfo.php', '/server-status']) { const r = await get(new URL(p, root).href); const soft404 = (miss && r.body.length === miss.body.length) || (/^\s*<!doctype html|^\s*<html/i.test(r.body) && !/\.(html?|php)$/.test(p)); if (r.ok && !soft404 && r.body.length) findings.probes.push({ path: p, status: r.status, bytes: r.body.length, preview: r.body.slice(0, 60).replace(/[A-Za-z0-9]{6,}/g, s => s.slice(0, 3) + '…') }); }

// ── report ──
const ai = findings.comments.filter(c => c.ai), infra = findings.comments.filter(c => c.infra && !c.ai), risky = findings.comments.filter(c => c.risky);
fs.writeFileSync(path.join(OUT, 'leak-findings.json'), JSON.stringify(findings, null, 1));
const md = [`# Leak scan — ${root.host} (${new Date().toISOString().slice(0, 10)})`, '',
  `Pages: ${findings.pages.length} (depth ≤ ${DEPTH}) · assets scanned: ${scannedAssets.size} · comments shipped: ${findings.comments.length} · errors: ${findings.errors.length}`, '',
  `## Secrets (${findings.secrets.length})`, ...(findings.secrets.length ? findings.secrets.map(s => `- **${s.kind}** in \`${s.where}\` line ${s.line}: \`${s.redacted}\``) : ['None found.']), '',
  `## Public source maps (${findings.sourceMaps.length})`, ...findings.sourceMaps.map(s => `- ${s.map} (${s.sources} sources)`), '',
  ...(PROBE ? [`## Exposed files (${findings.probes.length})`, ...(findings.probes.length ? findings.probes.map(p => `- \`${p.path}\` ${p.status}, ${p.bytes} bytes`) : ['None.']), ''] : []),
  `## Risky comments (${risky.length}) — AI/internal comments that mention auth, keys, endpoints, staging or disabled checks`, ...risky.slice(0, 40).map(c => `- \`${c.where[0]}\`: ${c.text.slice(0, 180)}`), '',
  `## AI-authored comments (${ai.length})`, ...ai.slice(0, 40).map(c => `- \`${c.where[0]}\`${c.where.length > 1 ? ` (+${c.where.length - 1} more)` : ''}: ${c.text.slice(0, 180)}`), '',
  `## Internal-info comments (${infra.length}) — staging, hosts, paths, people, dates, ticket IDs, TODOs`, ...infra.slice(0, 40).map(c => `- \`${c.where[0]}\`${c.where.length > 1 ? ` (+${c.where.length - 1} more)` : ''}: ${c.text.slice(0, 180)}`), '',
  `## Fetch errors (${findings.errors.length})`, ...findings.errors.slice(0, 30).map(e => `- ${e.status} ${e.url}${e.from ? ` (linked from ${e.from})` : ''}`), '',
  `Page text for proofreading: \`${path.join(OUT, 'text')}/\` · full data: \`${path.join(OUT, 'leak-findings.json')}\``].join('\n');
fs.writeFileSync(path.join(OUT, 'leak-report.md'), md);
console.log(md.split('\n').slice(0, 4).join('\n')); console.log(`secrets ${findings.secrets.length}, maps ${findings.sourceMaps.length}, risky ${risky.length}, ai ${ai.length}, infra ${infra.length}, errors ${findings.errors.length}`);
