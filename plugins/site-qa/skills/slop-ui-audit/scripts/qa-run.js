const { chromium } = require('playwright'); const fs = require('fs');
const [base, ...paths] = process.argv.slice(2);
const scan = fs.readFileSync(__dirname + '/site-qa-scan.js', 'utf8');
(async () => { const b = await chromium.launch(); const res = {};
  for (const pth of (paths.length ? paths : [''])) for (const [w, h] of [[1440, 900], [390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const name = `${(pth || 'home').replace(/\W+/g, '_')}-${w}`;
    try {
      await p.goto(new URL(pth, base).href, { waitUntil: 'networkidle', timeout: 60000 });
      await p.evaluate(() => { window.__qaOpts = { links: true, scripts: true }; });
      res[name] = await p.evaluate(scan);
      await p.screenshot({ path: `shot-${name}.png`, fullPage: true });
      console.log(name, JSON.stringify(res[name].summary));
    } catch (e) { console.log(name, 'ERROR', e.message.slice(0, 150)); }
    await p.close(); }
  // Cross-page consistency diff (same viewport)
  const diff = {}; const keys = ['bodyFont', 'headings', 'gutter', 'radii', 'ctaStyles', 'bodyText'];
  for (const k of keys) { const vals = {}; for (const [n, r] of Object.entries(res)) if (n.endsWith('-1440')) vals[n] = JSON.stringify(r.fingerprint[k]); if (new Set(Object.values(vals)).size > 1) diff[k] = vals; }
  res.__crossPage = diff; console.log('cross-page differences:', Object.keys(diff).join(', ') || 'none');
  fs.writeFileSync('qa-results.json', JSON.stringify(res, null, 1)); await b.close(); })();
