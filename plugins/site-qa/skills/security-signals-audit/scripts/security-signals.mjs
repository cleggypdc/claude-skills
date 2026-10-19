#!/usr/bin/env node
// security-signals v1.0 — does a site show the outward signs of good security posture? Passive by default: reads only what the
// site serves to every visitor (headers, cookies, HTML, its own JS, TLS certificate, public DNS). Owner-only checks behind --probe.
// No dependencies (Node 18+). Reports SIGNALS, never "secure".
// Usage: node security-signals.mjs https://example.com [--pages 10] [--out ./security-out] [--no-retire] [--probe]
//   --probe   ONLY on sites you own or are authorised to test: exposed-file probe, directory listings, Certificate
//             Transparency subdomain sweep for reachable staging/preview hosts. Without it, nothing unadvertised is requested.
// Run TLS checks from a machine without TLS interception: behind a corporate/sandbox proxy the certificate seen is the proxy's.
import fs from 'node:fs'; import path from 'node:path'; import tls from 'node:tls';
const args = process.argv.slice(2); const flag = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const start = args.find(a => /^https?:/.test(a)); if (!start) { console.error('usage: node security-signals.mjs <url> [--pages 10] [--probe]'); process.exit(1); }
const PAGES = +flag('--pages', 10), OUT = flag('--out', './security-out'), PROBE = !!flag('--probe', false), RETIRE = !args.includes('--no-retire');
fs.mkdirSync(OUT, { recursive: true });
const UA = { 'user-agent': 'Mozilla/5.0 (site-qa security-signals; passive check)' };
const get = async (u, o = {}) => { try { const r = await fetch(u, { headers: UA, redirect: 'follow', ...o }); return { status: r.status, url: r.url, headers: r.headers, cookies: r.headers.getSetCookie ? r.headers.getSetCookie() : (r.headers.get('set-cookie') || '').split(/,(?=\s*[^;,=\s]+=)/).filter(Boolean), body: o.method === 'HEAD' ? '' : await r.text() }; } catch (e) { return { status: 'ERR', url: u, headers: new Headers(), cookies: [], body: '', error: e.message }; } };
const F = []; // findings
const add = (area, id, severity, pass, detail, fix, gate = false) => F.push({ area, id, severity, pass, gate, detail, fix });
const root = new URL(start); const host = root.hostname; const apex = host.replace(/^www\./, '');

// ── 1. Transport ──
const plain = await get(`http://${host}/`, { redirect: 'manual' });
const loc = plain.headers.get('location') || '';
add('Transport', 'https-redirect', 'high', /^https:/i.test(loc) || plain.status === 'ERR', plain.status === 'ERR' ? 'HTTP port not reachable (fine if HTTPS-only)' : `http:// → ${plain.status} ${loc || '(no redirect)'}`, 'Redirect all http:// requests to https:// with a 301.', true);
const home = await get(root.href);
const hsts = home.headers.get('strict-transport-security') || '';
const maxAge = +(hsts.match(/max-age=(\d+)/i) || [0, 0])[1];
add('Transport', 'hsts', 'high', maxAge >= 15552000, hsts ? `${hsts} (${Math.round(maxAge / 86400)} days)` : 'missing', 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains (add preload once every subdomain is HTTPS).', true);
add('Transport', 'hsts-preload-ready', 'info', /includesubdomains/i.test(hsts) && /preload/i.test(hsts) && maxAge >= 31536000, hsts || 'missing', 'Optional: includeSubDomains; preload with max-age ≥ 1 year, then submit to hstspreload.org.');
const cert = await new Promise(res => { const s = tls.connect(443, host, { servername: host, timeout: 10000 }, () => { const c = s.getPeerCertificate(); res({ protocol: s.getProtocol(), validTo: c.valid_to, issuer: c.issuer && (c.issuer.O || c.issuer.CN), san: c.subjectaltname, authorized: s.authorized, authError: s.authorizationError }); s.end(); }); s.on('error', e => res({ error: e.message })); s.on('timeout', () => { s.destroy(); res({ error: 'timeout' }); }); });
if (cert.error) add('Transport', 'certificate', 'high', false, `TLS error: ${cert.error}`, 'Check the certificate chain and that port 443 serves a valid certificate for this host.');
else { const days = Math.round((new Date(cert.validTo) - Date.now()) / 864e5); add('Transport', 'certificate', days < 14 ? 'high' : 'low', cert.authorized && days >= 14, `${cert.protocol}, issuer ${cert.issuer}, expires in ${days} days${cert.authorized ? '' : ' — NOT trusted: ' + cert.authError}`, 'Automate renewal (ACME) and alert at 21 days.'); add('Transport', 'tls-version', 'medium', /TLSv1\.[23]/.test(cert.protocol), cert.protocol, 'Disable TLS 1.0/1.1.'); }

// ── 2. Pages: headers, cookies, mixed content, scripts ──
let urls = [home.url];
const sm = await get(new URL('/sitemap.xml', root).href);
if (/<urlset/i.test(sm.body)) urls = [...new Set([home.url, ...[...sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]).filter(u => { try { return new URL(u).hostname === new URL(home.url).hostname; } catch { return false; } })])];
urls = urls.slice(0, PAGES);
const pages = [home, ...(await Promise.all(urls.slice(1).map(u => get(u))))].filter(p => p.status === 200);
const h = home.headers;
const csp = h.get('content-security-policy') || '', cspRO = h.get('content-security-policy-report-only') || '';
const dir = (n) => (csp.match(new RegExp(`(?:^|;)\\s*${n}\\s+([^;]*)`, 'i')) || [])[1];
const scriptSrc = dir('script-src') ?? dir('default-src');
const cspIssues = []; if (!csp) cspIssues.push(cspRO ? 'report-only, not enforced' : 'missing'); else { if (scriptSrc === undefined) cspIssues.push('no script-src or default-src'); if (/'unsafe-inline'/.test(scriptSrc || '') && !/'nonce-|'sha(256|384|512)-|'strict-dynamic'/.test(scriptSrc || '')) cspIssues.push("script-src allows 'unsafe-inline' without nonces/hashes"); if (/'unsafe-eval'/.test(scriptSrc || '')) cspIssues.push("script-src allows 'unsafe-eval'"); if (/(^|\s)(\*|https:|http:|data:)(\s|$)/.test(scriptSrc || '')) cspIssues.push('script-src allows a wildcard, scheme or data: source'); if (!dir('object-src') && !/'none'/.test(dir('default-src') || '')) cspIssues.push("no object-src 'none'"); if (!dir('base-uri')) cspIssues.push('no base-uri'); }
add('Headers', 'csp', 'medium', !cspIssues.length, csp ? `${cspIssues.join('; ') || 'reasonable'} — ${csp.slice(0, 160)}` : cspIssues[0], "Enforce a CSP: default-src 'self'; script-src 'self' (nonces or hashes for inline); object-src 'none'; base-uri 'self'; frame-ancestors 'self'. Start in Report-Only, then enforce.");
add('Headers', 'framing', 'medium', /frame-ancestors/i.test(csp) || /^(deny|sameorigin)$/i.test(h.get('x-frame-options') || ''), `frame-ancestors: ${dir('frame-ancestors') || 'none'}; X-Frame-Options: ${h.get('x-frame-options') || 'none'}`, "Add frame-ancestors 'self' to the CSP (or X-Frame-Options: SAMEORIGIN).");
add('Headers', 'nosniff', 'low', /nosniff/i.test(h.get('x-content-type-options') || ''), h.get('x-content-type-options') || 'missing', 'X-Content-Type-Options: nosniff');
add('Headers', 'referrer-policy', 'low', !!h.get('referrer-policy') && !/unsafe-url|no-referrer-when-downgrade/i.test(h.get('referrer-policy')), h.get('referrer-policy') || 'missing (browser default strict-origin-when-cross-origin)', 'Referrer-Policy: strict-origin-when-cross-origin');
add('Headers', 'permissions-policy', 'low', !!h.get('permissions-policy'), h.get('permissions-policy') ? h.get('permissions-policy').slice(0, 120) : 'missing', 'Permissions-Policy: camera=(), microphone=(), geolocation=() (allow only what the site uses).');
add('Headers', 'coop', 'info', !!h.get('cross-origin-opener-policy'), h.get('cross-origin-opener-policy') || 'missing', 'Cross-Origin-Opener-Policy: same-origin (unless the site relies on cross-window popups such as some OAuth flows).');
const banners = ['server', 'x-powered-by', 'x-aspnet-version', 'x-generator'].map(k => [k, h.get(k)]).filter(([k, v]) => v && (k !== 'server' || /\d/.test(v)));
add('Headers', 'version-banners', 'low', !banners.length, banners.map(([k, v]) => `${k}: ${v}`).join(', ') || 'none', 'Remove X-Powered-By and version numbers from Server headers.');

const SESSION = /sess|sid\b|auth|token|jwt|login|remember|csrf|xsrf|laravel|phpsessid|connect\.sid|_session/i;
const cookieRows = []; for (const p of pages) for (const c of p.cookies) { const name = c.split('=')[0].trim(); if (cookieRows.some(r => r.name === name)) continue; cookieRows.push({ name, secure: /;\s*secure/i.test(c), httpOnly: /;\s*httponly/i.test(c), sameSite: (c.match(/;\s*samesite=(\w+)/i) || [])[1] || 'unset', session: SESSION.test(name), on: new URL(p.url).pathname }); }
const badSession = cookieRows.filter(c => c.session && (!c.secure || !c.httpOnly));
add('Cookies', 'session-cookie-flags', 'high', !badSession.length, cookieRows.length ? cookieRows.map(c => `${c.name}${c.session ? ' (session-like)' : ''}: ${[c.secure && 'Secure', c.httpOnly && 'HttpOnly', 'SameSite=' + c.sameSite].filter(Boolean).join(' ')}`).join('; ') : 'no cookies set by public pages', 'Set session and auth cookies with Secure; HttpOnly; SameSite=Lax (or Strict).', true);
add('Cookies', 'cookie-flags', 'low', cookieRows.every(c => c.secure && c.sameSite !== 'unset'), `${cookieRows.filter(c => !c.secure || c.sameSite === 'unset').length} of ${cookieRows.length} cookies missing Secure or SameSite`, 'Add Secure and an explicit SameSite to every cookie.');

const origin = new URL(home.url).origin;
const scripts = []; const mixed = [];
for (const p of pages) { for (const m of p.body.matchAll(/<script\b([^>]*)>/gi)) { const src = (m[1].match(/\ssrc=["']([^"']+)/i) || [])[1]; if (!src) continue; let abs; try { abs = new URL(src, p.url).href; } catch { continue; } if (!scripts.some(s => s.src === abs)) scripts.push({ src: abs, integrity: /\sintegrity=/i.test(m[1]), thirdParty: new URL(abs).origin !== origin }); }
  for (const m of p.body.matchAll(/<(script|img|iframe|link|source|video|audio)\b[^>]*\s(src|href)=["'](http:\/\/[^"']+)/gi)) if (!/^<link/i.test(m[0]) || /stylesheet/i.test(m[0])) mixed.push(`${new URL(p.url).pathname}: ${m[3].slice(0, 80)}`); }
add('Transport', 'mixed-content', 'medium', !mixed.length, mixed.slice(0, 5).join('; ') || 'none', 'Load every sub-resource over https://.');
const cdnNoSri = scripts.filter(s => s.thirdParty && !s.integrity && /cdn|jsdelivr|unpkg|cdnjs|code\.jquery|bootstrapcdn|googleapis\.com\/ajax/i.test(s.src));
add('Supply chain', 'sri', 'medium', !cdnNoSri.length, cdnNoSri.map(s => s.src.slice(0, 90)).join('; ') || 'no unpinned CDN scripts', 'Self-host, or add integrity="sha384-…" crossorigin="anonymous" to versioned CDN scripts.');
const third = [...new Set(scripts.filter(s => s.thirdParty).map(s => new URL(s.src).host))];
add('Supply chain', 'third-party-scripts', 'info', true, third.join(', ') || 'none', 'Keep this list short; every third-party script runs with full page privileges.');

// same-origin JS: secrets + source maps (compact set; run slop-ui-audit leak-crawl.mjs for the full scan)
const SECRETS = [['OpenAI/Anthropic key', /\bsk-(?:proj-|ant-(?:api\d\d-)?)?[A-Za-z0-9_-]{24,}/], ['Stripe secret', /\b[sr]k_live_[A-Za-z0-9]{16,}/], ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/], ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/], ['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/], ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/], ['Supabase service role', /service_role/], ['DB connection string', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"<>]+:[^\s'"<>@]+@/]];
const secrets = [], maps = [], jsBodies = [];
for (const p of pages) for (const [k, re] of SECRETS) { const m = p.body.match(re); if (m) secrets.push(`${k} in ${new URL(p.url).pathname}: ${m[0].slice(0, 8)}…`); }
for (const s of scripts.filter(s => !s.thirdParty).slice(0, 40)) { const r = await get(s.src); if (r.status !== 200) continue; jsBodies.push({ src: s.src, body: r.body }); for (const [k, re] of SECRETS) { const m = r.body.match(re); if (m) secrets.push(`${k} in ${new URL(s.src).pathname}: ${m[0].slice(0, 8)}…`); } const sm = (r.body.match(/\/\/[#@]\s*sourceMappingURL=([^\s'"]+)/) || [])[1]; const mapUrl = sm && !sm.startsWith('data:') ? new URL(sm, s.src).href : s.src + '.map'; const mr = await get(mapUrl, { method: 'HEAD' }); if (mr.status === 200 && !/text\/html/i.test(mr.headers.get('content-type') || '')) maps.push(mapUrl); }
add('Leakage', 'secrets', 'critical', !secrets.length, secrets.join('; ') || 'none found in HTML or same-origin JS', 'Rotate the key first, then remove it from source and history. Keep secrets server-side.', true);
add('Leakage', 'source-maps', 'high', !maps.length, maps.slice(0, 5).join('; ') || 'none public', 'Stop publishing .map files for app code (or upload them privately to your error tracker).', true);

// known-vulnerable JS libraries (retire.js repository)
if (RETIRE) { const repo = await get('https://raw.githubusercontent.com/RetireJS/retire.js/master/repository/jsrepository.json'); let db = {}; try { db = JSON.parse(repo.body); } catch {}
  const cmp = (a, b) => { const x = a.split(/[.-]/), y = b.split(/[.-]/); for (let i = 0; i < Math.max(x.length, y.length); i++) { const p = parseInt(x[i] ?? 0) || 0, q = parseInt(y[i] ?? 0) || 0; if (p !== q) return p - q; } return 0; };
  const V = '([0-9]+(?:\\.[0-9]+)+(?:-?(?:alpha|beta|rc)[0-9.]*)?)'; const found = new Map();
  const targets = [...scripts.map(s => ({ uri: s.src, body: '' })), ...jsBodies.map(j => ({ uri: j.src, body: j.body.slice(0, 20000) }))];
  for (const [lib, d] of Object.entries(db)) { if (lib === 'retire-example' || !d.extractors) continue; const ex = d.extractors; for (const t of targets) { for (const pat of [...(ex.uri || []), ...(ex.filename || [])]) { try { const m = t.uri.match(new RegExp(pat.replace('§§version§§', V))); if (m && m[1]) found.set(lib + '@' + m[1], { lib, version: m[1], where: t.uri }); } catch {} } if (t.body) for (const pat of (ex.filecontent || [])) { try { const m = t.body.match(new RegExp(pat.replace('§§version§§', V))); if (m && m[1]) found.set(lib + '@' + m[1], { lib, version: m[1], where: t.uri }); } catch {} } } }
  const vulns = []; for (const { lib, version, where } of found.values()) for (const v of db[lib].vulnerabilities || []) { if (v.below && cmp(version, v.below) >= 0) continue; if (v.atOrAbove && cmp(version, v.atOrAbove) < 0) continue; vulns.push({ lib, version, severity: v.severity, ids: [...(v.identifiers?.CVE || [])].join(',') || v.identifiers?.summary || '', where }); }
  const worst = vulns.some(v => /high|critical/.test(v.severity)) ? 'high' : vulns.length ? 'medium' : 'low';
  add('Supply chain', 'vulnerable-libraries', worst, !vulns.length, [...found.values()].length ? [...found.values()].map(f => `${f.lib} ${f.version}`).join(', ') + (vulns.length ? ` — ${vulns.length} known issues: ${[...new Set(vulns.map(v => `${v.lib} ${v.version} (${v.severity}${v.ids ? ' ' + v.ids.slice(0, 40) : ''})`))].join('; ')}` : ' — no known issues') : 'no versioned libraries detected', 'Upgrade the flagged libraries to a fixed version.'); }

// ── 3. Disclosure ──
const sec = await get(new URL('/.well-known/security.txt', root).href);
const secOk = sec.status === 200 && /^contact:/im.test(sec.body) && !/<html/i.test(sec.body.slice(0, 200));
const exp = (sec.body.match(/^expires:\s*(.+)$/im) || [])[1];
add('Disclosure', 'security-txt', 'low', secOk && exp && new Date(exp) > new Date(), secOk ? `present; Expires: ${exp || 'missing'}` : 'missing', 'Publish /.well-known/security.txt (RFC 9116) with Contact: and Expires: (≤ 1 year ahead).');
const text = pages.map(p => p.body).join(' ');
add('Disclosure', 'privacy-policy', 'low', /href=["'][^"']*privacy/i.test(text), /href=["'][^"']*privacy/i.test(text) ? 'linked' : 'no privacy link found', 'Link a privacy policy from every page footer.');

// ── 4. Privacy: trackers in the initial HTML (lead — confirm in a browser) ──
const TRACKERS = /googletagmanager\.com\/gtag|google-analytics\.com|googletagmanager\.com\/gtm|connect\.facebook\.net|static\.hotjar\.com|clarity\.ms|snap\.licdn\.com|analytics\.tiktok\.com|bat\.bing\.com|js\.hs-scripts\.com|cdn\.segment\.com|plausible\.io|cdn\.usefathom\.com|posthog/i;
const CMP = /cookiebot|onetrust|termly|cookieyes|iubenda|osano|didomi|usercentrics|quantcast|consentmanager|klaro|cookie-?consent/i;
const trackers = [...new Set(scripts.map(s => s.src).filter(s => TRACKERS.test(s)).map(s => new URL(s).host)), ...(/gtag\(|fbq\(|_hjSettings|clarity\(/.test(text) ? ['inline tracker snippet'] : [])];
const cookieless = trackers.every(t => /plausible|usefathom/.test(t));
add('Privacy', 'trackers-before-consent', 'high', !trackers.length || cookieless || CMP.test(text), trackers.length ? `${trackers.join(', ')} in initial HTML; consent manager ${CMP.test(text) ? 'detected — confirm trackers wait for consent' : 'NOT detected'}` : 'no trackers in initial HTML', 'Load non-essential analytics and ad scripts only after consent (PECR/GDPR), or use a cookieless analytics tool. Confirm in a browser: record network requests before clicking anything.', true);

// ── 5. Email and DNS (DNS-over-HTTPS) ──
const doh = async (name, type) => { const r = await get(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { ...UA, accept: 'application/dns-json' } }); try { const j = JSON.parse(r.body); return { ad: !!j.AD, answers: (j.Answer || []).map(a => a.data.replace(/^"|"$/g, '').replace(/" "/g, '')) }; } catch { return { ad: false, answers: [] }; } };
const [mx, txt, dmarc, mtasts, tlsrpt, caa, soa] = await Promise.all([doh(apex, 'MX'), doh(apex, 'TXT'), doh('_dmarc.' + apex, 'TXT'), doh('_mta-sts.' + apex, 'TXT'), doh('_smtp._tls.' + apex, 'TXT'), doh(apex, 'CAA'), doh(apex, 'SOA')]);
const sendsMail = mx.answers.length > 0 && !mx.answers.every(a => /^0 \.$/.test(a));
const spf = txt.answers.filter(a => /^v=spf1/i.test(a));
add('Email & DNS', 'spf', sendsMail ? 'medium' : 'low', spf.length === 1 && !/[+?]all/i.test(spf[0] || ''), spf.length ? spf.join(' | ').slice(0, 160) : 'missing', spf.length > 1 ? 'Merge into a single SPF record.' : 'Publish one SPF record ending in ~all or -all (use "v=spf1 -all" on domains that never send mail).');
const dm = dmarc.answers.find(a => /^v=DMARC1/i.test(a)) || ''; const pol = (dm.match(/;\s*p=(\w+)/i) || [])[1] || 'missing';
add('Email & DNS', 'dmarc', sendsMail && pol !== 'quarantine' && pol !== 'reject' ? 'high' : 'low', /quarantine|reject/i.test(pol), dm ? `p=${pol} — ${dm.slice(0, 120)}` : 'missing', 'Publish DMARC with rua= reporting, monitor at p=none, then move to p=quarantine or p=reject.');
add('Email & DNS', 'mta-sts', 'info', !sendsMail || mtasts.answers.some(a => /v=STSv1/i.test(a)), mtasts.answers[0] || 'missing', 'Optional: MTA-STS and TLS-RPT (_smtp._tls) to require TLS for inbound mail.');
add('Email & DNS', 'caa', 'low', caa.answers.length > 0, caa.answers.join(', ') || 'missing', 'Publish CAA records naming only the CAs you use.');
add('Email & DNS', 'dnssec', 'info', soa.ad, soa.ad ? 'validated (AD flag set)' : 'not validated', 'Optional: enable DNSSEC at your DNS provider and registrar.');

// ── 6. Owner-only probes ──
if (PROBE) {
  const rand = await get(new URL(`/__qa_${Date.now()}_nope`, root).href); const catchAll = rand.status === 200; const body404 = rand.body.slice(0, 500);
  const FILES = ['/.env', '/.env.local', '/.env.production', '/.git/HEAD', '/.git/config', '/.svn/entries', '/.DS_Store', '/.htpasswd', '/config.json', '/wp-config.php.bak', '/backup.zip', '/db.sql', '/phpinfo.php', '/server-status', '/.vscode/settings.json', '/docker-compose.yml', '/package.json'];
  const exposed = []; for (const f of FILES) { const r = await get(new URL(f, root).href); if (r.status === 200 && r.body && !(catchAll && r.body.slice(0, 500) === body404) && !/<html|<!doctype/i.test(r.body.slice(0, 300))) exposed.push(f); }
  add('Exposure (owner-only)', 'exposed-files', 'high', !exposed.length, exposed.join(', ') || `none of ${FILES.length} common paths exposed${catchAll ? ' (catch-all 200 detected and ignored)' : ''}`, 'Block dotfiles and build artefacts at the server or CDN; move config out of the web root.');
  const listing = []; for (const d of ['/assets/', '/uploads/', '/images/', '/static/', '/files/', '/backup/']) { const r = await get(new URL(d, root).href); if (r.status === 200 && /<title>\s*Index of|Directory listing for/i.test(r.body)) listing.push(d); }
  add('Exposure (owner-only)', 'directory-listing', 'medium', !listing.length, listing.join(', ') || 'none', 'Turn off auto-indexing (nginx autoindex off; Apache Options -Indexes).');
  let ct = []; for (let i = 0; i < 3 && !ct.length; i++) { const r = await get(`https://crt.sh/?q=%25.${apex}&output=json`); try { ct = JSON.parse(r.body); } catch { await new Promise(s => setTimeout(s, 3000)); } }
  const names = [...new Set(ct.flatMap(c => String(c.name_value || '').split('\n')).map(n => n.replace(/^\*\./, '').toLowerCase()))].filter(n => n.endsWith(apex));
  const risky = names.filter(n => /(^|[.-])(staging|stage|stg|dev|test|uat|preview|beta|qa|demo|old|admin|internal|sandbox)([.-]|\d|$)/.test(n));
  const live = []; for (const n of risky.slice(0, 20)) { const r = await get(`https://${n}/`, { redirect: 'manual' }); if (typeof r.status === 'number' && r.status < 400 && r.status !== 0) live.push(`${n} (${r.status})`); }
  add('Exposure (owner-only)', 'staging-hosts', 'medium', !live.length, ct.length ? `${names.length} names in CT logs; ${risky.length} look non-production; reachable: ${live.join(', ') || 'none'}` : 'crt.sh unavailable — retry later', 'Put staging and preview hosts behind authentication (Cloudflare Access, basic auth or IP allow-list) and noindex them.');
}

// ── 7. Report ──
const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const fails = F.filter(f => !f.pass).sort((a, b) => order[a.severity] - order[b.severity]);
const gate = F.filter(f => f.gate); const gatePass = gate.every(f => f.pass);
const res = { site: root.href, date: new Date().toISOString().slice(0, 10), mode: PROBE ? 'passive + owner probes' : 'passive', gate: { pass: gatePass, items: gate.map(({ id, pass, detail }) => ({ id, pass, detail })) }, findings: F, cert, cookies: cookieRows, thirdPartyScripts: third };
fs.writeFileSync(path.join(OUT, 'security.json'), JSON.stringify(res, null, 1));
const md = [`# Security signals: ${host} (${res.date})`, '', `Mode: ${res.mode}. Pages read: ${pages.length}. These are outward **signals** of security posture, not proof that the site is secure.`, '',
  `**Gate: ${gatePass ? 'PASS' : 'FAIL'}** (${gate.filter(f => f.pass).length}/${gate.length})`, '', '| Gate item | Result | Detail |', '|---|---|---|', ...gate.map(f => `| ${f.id} | ${f.pass ? 'pass' : '**fail**'} | ${String(f.detail).replace(/\|/g, '\\|').slice(0, 160)} |`), '',
  '## Fix list (failed signals, most severe first)', '', '| Severity | Area | Signal | Found | Fix |', '|---|---|---|---|---|', ...fails.map(f => `| ${f.severity} | ${f.area} | ${f.id} | ${String(f.detail).replace(/\|/g, '\\|').slice(0, 140)} | ${f.fix} |`), '',
  '## Passing signals', ...F.filter(f => f.pass).map(f => `- ${f.area} / ${f.id}: ${String(f.detail).slice(0, 120)}`), ''].join('\n');
fs.writeFileSync(path.join(OUT, 'security-report.md'), md);
console.error(`gate ${gatePass ? 'PASS' : 'FAIL'}; ${fails.length} failed signals. ${OUT}/security-report.md`);
