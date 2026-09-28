---
name: slop-ui-audit
description: Audit a website for unconsidered UI and leaks - broken images, gutter drift, cross-page inconsistency, meta hygiene, AI/agent comments and secrets in shipped HTML/JS, plus AI 'slop' design tells - and produce a prioritised fix list.
---

# Site QA and slop audit

Finds the things that get past functional QA because nothing throws an error: broken images, sections that don't share a gutter, the same button styled four ways, a typo in a testimonial, agent changelogs and keys shipped in the page source, and the AI-default design tells from Pranav Desai's '10 Tells of Slop UI' (hereticpleb.vercel.app/blog/10-tells-of-slop). The aim is a site that looks like somebody decided things.

Use when asked to review, QA or audit a site or page, check for slop or an 'AI-generated look', check a site before launch, or scan a site's source for leaked comments, keys or secrets.

## Tools in this skill

All three live in `scripts/` next to this file. Copy them into the working directory before running.

| File | Runs in | Does |
|---|---|---|
| `scripts/leak-crawl.mjs` | Node 18+, no dependencies | Crawls the site (same host, depth 2, seeded from sitemap.xml), saves page text, scans HTML/JS/CSS/source maps for secrets and comments, optional exposed-file probe |
| `scripts/site-qa-scan.js` | Any page context (Playwright, Chrome/built-in browser JS tool, DevTools) | Measures one page: broken, layout/gutters, meta, leakage, consistency fingerprint, slop leads, proofread corpus |
| `scripts/qa-run.js` | Node + Playwright | Runs the scan across pages at 1440 and 390, saves screenshots, diffs pages for consistency |

## Principles

- **Rules first, judgement second.** The scripts measure; you interpret. Script output is leads, not verdicts. Downgrade false positives and say you did.
- **Priority order for the report:** 1 security leakage, 2 broken, 3 layout (gutters, overlap, overflow, contrast), 4 cross-page consistency, 5 meta, 6 slop tells. The first four are usually cheap to fix and objectively wrong; slop tells are taste and come last.
- Judge against the page's job: marketing page vs tool. Product mock-ups inside a marketing page get more latitude than the real UI.
- Every finding needs where (URL + selector + screenshot crop), why it matters, and a concrete fix (token, value, copy). Always include a 'What's working' section.
- British English, markdown report. Never print a full secret in the report; redact to prefix…suffix.
- Only run the crawler's `--probe` option on sites the person owns or is authorised to test.

## Step 1 - Quick leak crawl (whole site, no browser)

```bash
node leak-crawl.mjs https://example.com --depth 2 --max 150 --out ./leak-out   # add --probe only with authorisation
```

It follows the start URL's redirects (apex to www and so on) and crawls that host. It scans raw HTML, inline scripts and styles, and the site's own JS/CSS, including builder CDNs; analytics and widget hosts are skipped unless `--third-party` is set. It also scans any public source maps. It looks for:

- **Secrets:** provider key formats, JWTs, private keys, DB connection strings, basic-auth URLs, `password = '...'` style assignments. Publishable-by-design keys (Stripe `pk_`, GA/GTM IDs, reCAPTCHA site keys) are ignored.
- **AI-authored comments:** comments that read like an assistant wrote them ('Here's the updated…', 'I've added…', 'Two Column Layout with…', 'you can customise…', 'in production you should…').
- **Internal-info comments:** staging hosts, internal IPs and paths, people's names with dates, ticket/item IDs, TODO/FIXME, 'remove before launch', disabled checks, changelog paths.
- **Risky comments:** the overlap of the above with auth, keys, endpoints, admin, bypass or disabled.
- **Public source maps:** `.map` files expose original source; their `sourcesContent` is scanned too.
- **Exposed files** (`--probe` only): `/.env`, `/.git/HEAD`, `/.DS_Store` and similar. Catch-all 404 pages that return 200 are detected and ignored.

Read `leak-out/leak-report.md`. Then proofread the text files in `leak-out/text/` (typos, placeholder copy, inconsistent product names and figures across pages). A dictionary pass (e.g. `pyspellchecker`) narrows it down; the model does the rest.

Also check the response headers of the home page (`curl -sI`): `Content-Security-Policy`, `X-Frame-Options` or `frame-ancestors`, `Permissions-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, and whether `/.well-known/security.txt` exists.

**Why agent comments are a security issue, and how to grade them:** shipped comments are information disclosure (CWE-615; OWASP WSTG-INFO-05). By themselves they're usually low severity, but they:

- leak internal structure (staging hosts, workspace paths, ticket IDs, who works on what);
- reveal that an AI agent edits the live site, and with what process. That's useful for social engineering, and it points attackers at the classic AI-code weaknesses: client-side-only auth checks, exposed service keys, missing row-level security;
- often sit right next to the real problem ('TODO re-enable auth', 'temporary admin bypass', a key an agent pasted 'for now').

Grade them as follows:

- **Critical:** any live secret. Rotate first, then remove from source and history.
- **High:** public source maps of app code; comments describing disabled or bypassed security; `.env`/`.git` exposure.
- **Medium:** internal hostnames, IPs, paths, staging endpoints; missing CSP or framing protection.
- **Low:** agent changelogs, names, dates, AI layout comments. Fix by stripping comments in the build/publish step, not by hand, and by telling the agent (in its instructions) to keep change notes in the repo or a changelog, never in shipped markup.

Browser API keys (e.g. Google Maps `AIza…`) are public by design but must be referrer-restricted. Flag them for a restriction check rather than as a leak.

## Step 2 - Per-page scan in a browser

Pick the 3-5 key page types (home, a product page, a long-form content page, a form, the demo/contact page). Run `site-qa-scan.js` on each at 1440 and 390 wide. If the site has a theme toggle, also screenshot dark mode. Where reachable, also scan empty, loading and error states; that's where decorative badges and 'Welcome to your Dashboard ✨' tend to live.

Browser tooling, first that works:

1. **Local Playwright.** Put `site-qa-scan.js` and `qa-run.js` side by side, then run `node qa-run.js https://site.com/ '' about pricing` (`''` is the home page; if `playwright` isn't resolvable, run `npm i playwright` or set `NODE_PATH=$(npm root -g)`). You get JSON per page and viewport, full-page screenshots, and an automatic cross-page consistency diff in `qa-results.json`.
2. **Playwright MCP:** `browser_evaluate` with the script contents (set `window.__qaOpts = {links:true, scripts:true}` first to also check links and scan JS).
3. **Claude in Chrome** (`javascript_tool`) or the **built-in browser** (`preview_start` then `javascript_tool`). Useful for logged-in pages. If the tool doesn't await promises, run the script, then read `window.__siteQA`.
4. **Screenshots only** (last resort): run the Step 3 checklist by eye and say that metrics are estimated. If the site needs a login and only screenshots are possible, ask the person for screenshots of the key screens rather than guessing.

Full-page screenshots taken after scrolling can misplace sticky headers and cookie banners. Confirm anything that looks off with a fresh viewport-only screenshot before reporting it.

What the scan returns:

- **`checks.broken`:**
  - images that failed to load;
  - images hot-linked from other people's sites;
  - missing alt text, and decorative images carrying alt text;
  - text in the browser default font (usually unstyled third-party buttons);
  - placeholder/lorem text, `{{tokens}}`, undefined/NaN, doubled words;
  - optional same-origin link check.
- **`checks.layout`:**
  - **gutter drift:** the left content edge of every full-width band, measured from the glyphs, not the boxes; centred bands are excluded. `gutterMap` lists every band with its top y, left and right edges;
  - asymmetric gutters;
  - horizontal overflow;
  - fixed elements covering content (full-screen overlay hosts such as canvases and third-party widgets are flagged for a screenshot check);
  - WCAG contrast failures grouped by colour pair;
  - text over images (needs an eye check).
- **`checks.meta`:** title and description length and duplicates, meta keywords (stuffing), og/twitter cards, canonical, robots noindex, lang, h1 count, generator leak, JSON-LD parse errors and duplication, head weight. For site-wide meta patterns (e.g. which pages lack a canonical), loop the crawler's page list with `curl`.
- **`checks.leakage`:** the same comment and secret detectors as the crawler, but on the rendered DOM, plus builder fingerprints.
- **`checks.consistency`** plus `fingerprint`: CTA label variants, distinct button styles, radius scale, font families. The runner diffs body font, headings, gutter, radii and CTA styles across pages.
- **`slopLeads`:** raw signals for the 10 tells (no score).
- **`proofread`:** up to 250 short visible strings (headings, labels, buttons, captions). Read them for typos; regex won't catch 'Seniro'.

## Step 3 - Judge

**Gutters** (the thing experienced eyes spot first). Read `gutterMap` top to bottom next to the full-page screenshot. A healthy page has one left edge (for example 48px desktop, 20px mobile) shared by the header logo, section content and footer. Deliberate exceptions are full-bleed media, centred statement bands and a narrower reading column on articles. Report each drift with the section, the actual edge and the target. The fix is always a single container token (e.g. `--gutter: clamp(20px, 4vw, 48px)` and one `max-width`), applied to every section wrapper, rather than per-section padding.

**Broken, layout, consistency:** confirm each on the screenshot, crop evidence, and give the exact fix. Also check hover and focus states (missing, or only a colour shift) and dark mode if the site supports it (inverted bands that become white slabs are a common miss).

**Mock content:** product mock-ups on marketing pages age. Flag hard-coded dates that are about to pass, named model versions and real-world names that may not suit the audience.

**Slop tells** - judge the leads:

| # | Tell | Judge | Considered fix |
|---|---|---|---|
| 1 | Gradients everywhere | Is there one intentional gradient moment, or is it the default fill? Photo overlays are fine; gradient text and glow blobs usually aren't. Purple to pink/indigo is the classic tell. | Flat brand colour for actions; at most one gradient, tied to brand hues. |
| 2 | Rainbow palette | Does colour carry meaning? Two accents taking turns as 'the brand colour'? Pills coloured for variety? Aim for 70/30/10. | One accent, one neutral scale; semantic colours for state only. |
| 3 | Pulsing badges | For each badge: what's its inverse state, and can the user ever see it? Infinite animation on static claims? `reducedMotionRespected`? | Delete badges with no inverse state; animate only real change; honour `prefers-reduced-motion`. |
| 4 | Fingernail cards | Is everything a rounded card? How many radii are in use? Cards nested in cards with the same radius? | Radius scale of 2-3 values; inner radius = outer minus gap; lists or tables instead of card grids for uniform items. |
| 5 | Emoji | Does any emoji carry information? | Remove from headings, buttons and nav; use one icon set. |
| 6 | Misalignment | Covered by the layout checks plus a zoom on icon rows and tables at 390. | Shared grid; `align-items:center`; monospace for ASCII. |
| 7 | Fonts | Any typographic voice? Same face everywhere? Does the body font change between pages? `//` prefixes as costume? | A deliberate pairing, loaded once as a token. |
| 8 | Prompt residue | 'Built with…', 'Why it matters:', 'Who uses it:' repeated on every section: headings from the brief, not for the reader. | Delete, or replace with a real quote or proof point. |
| 9 | Glassmorphism | Is blur solving layering, or decoration? Blur on an opaque background does nothing. | Solid surfaces; one blurred overlay at most, contrast-checked. |
| 10 | Hype and slogans | Buzzwords, but also the formula 'Every X. Every Y. Z.' repeated in every heading, and 'actually' tics. | One slogan (the hero); every other heading says something specific. |

## If the source code is available

Grep for the root cause so fixes land in tokens and components, not one-off overrides:

- Gradients: `bg-gradient-to-|from-purple|from-violet|via-pink|linear-gradient\(|bg-clip-text`
- Pulse: `animate-pulse|animate-ping|@keyframes pulse|infinite`
- Radius: `rounded-(2xl|3xl|\[)|border-radius:\s*(1[6-9]|[2-9]\d)px`
- Glass: `backdrop-blur|backdrop-filter|bg-white/(5|10|20)`
- Fonts: `Inter|Geist|JetBrains|font-mono|fontFamily`
- Gutters: every `padding-inline`, `px-`, `max-w-` and container class on section wrappers. There should be one.
- Copy: `Built with|Powered by|Seamless|Elevate|Supercharge|Unleash|Empower|cutting-edge|Welcome back`
- Emoji in templates: `rg -P '\p{Extended_Pictographic}'` across `.tsx|.jsx|.vue|.php|.twig|.html`
- Comment stripping: check the build minifies HTML with comments removed, runs terser with `comments: false`, and doesn't publish source maps. For hosted builders (Webflow, WordPress custom code), check custom-code embeds, which ship verbatim.

Recommend changes at the design-token level (colour, radius, font, gutter, motion) first; component fixes second; one-offs last.

## Step 4 - Report

```markdown
# Site QA audit - <site> (<date>)

**Scope:** N pages crawled (depth 2), M pages scanned in a browser at 1440/390 · **Confirmed issues:** security X · broken X · layout X · consistency X · meta X · slop X

## Fix first (highest impact for least effort)
1. ...

## 1. Security leakage
## 2. Broken
## 3. Layout - gutters, overlap, overflow, contrast
(include a gutter table: section | left edge | target)
## 4. Cross-page consistency
## 5. Meta
## 6. Slop tells (judged)
## What's working (keep it)
```

Save evidence crops beside the report. Adjust anything the scripts got wrong, and say what you changed.
