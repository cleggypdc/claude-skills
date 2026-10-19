---
name: content-structure-audit
description: Audit a site's content and structure for search and AI answer engines - semantic HTML, meta, schema and entity graph, llms.txt and crawler access, answer-first copy, citations, boilerplate, cannibalisation and prose slop - and use the Wayback Machine to see which content strategies survived. Produces a prioritised fix list.
---

# Content structure audit

Finds what makes a site hard for search engines and AI answer engines to trust, quote and attribute. That includes missing entity markup, pages that bury the answer, claims with no source, doorway pages, boilerplate and prose that reads as generated. It also covers the semantic HTML underneath all of it.

It also lets you study a competitor or reference site without guessing at its strategy. The Wayback Machine shows what the site published over the years and what it later deleted. Content that survived several rebuilds earned its place. Sections that were removed wholesale are the experiments that failed.

Use when asked to audit SEO, AEO/GEO or "AI visibility", review content structure or metadata, check semantic HTML, reverse-engineer another site's content strategy, or check copy for AI slop. Pair it with `slop-ui-audit`: that skill covers what a visitor sees (layout, design tells, leaks); this one covers what a crawler reads.

## Tools in this skill

Both scripts are in `scripts/` and run on Node 18+ with no dependencies. Copy them into the working directory before running.

| File | Does |
|---|---|
| `scripts/content-audit.mjs` | Seeds from the sitemap (follows indexes), fetches **raw server HTML** and audits every page: semantic landmarks, heading order, leaked attributes, meta, JSON-LD and entity consistency, llms.txt coverage, AI-bot rules, answer-first openings, citations, dates and bylines, boilerplate, near-duplicate titles, and prose tells per 1,000 words. Writes `content-report.md`, `summary.json`, `pages.json` and `text/` |
| `scripts/wayback-survival.mjs` | Pulls the Wayback CDX index, compares it with the live sitemap and groups by first-seen year and section, giving survival %, average captures, the oldest survivors and samples of retired URLs. It also checks whether retired URLs now redirect or 404 |

```bash
node content-audit.mjs https://example.com --max 400 --out ./content-out
node wayback-survival.mjs example.com --out ./wayback-out --check 20
```

`web.archive.org` rate-limits, and some sandboxes block it. If the CDX fetch fails, run the script from the person's own machine (e.g. through a device shell) rather than giving up.

## Principles

- **Audit what the crawler sees.** Most AI crawlers don't run JavaScript, so the raw HTML is the page as far as they're concerned. Anything that only exists after hydration is invisible to them. `likelyClientRendered` lists pages with almost no server text.
- **Structure first, copy second.** Report order: 1 crawler access, 2 semantic HTML, 3 entity and schema, 4 meta and cannibalisation, 5 content evidence (answers, sources, dates, authors), 6 prose tells. The first four are cheap and objective; prose tells are taste.
- **Scrubbing tell-tale words is cosmetic.** A site can have no "delve" and no em dashes and still be slop. The real slop is structural: invented statistics, first-person anecdotes with no named author, made-up worked examples, glossary pages written for coverage, the same pitch on 100 pages. Judge those first.
- **Script output is leads, not verdicts.** `answerFirst` is a heuristic. Read the opening of a sample of pages before reporting it. Downgrade false positives, and say that you did.
- Every finding needs where (URL, and selector or snippet), why it matters, and a concrete fix (markup, template change, copy). Always include a "What's working" section.
- British English, markdown report.

## Step 1 - Crawl and audit (whole site, no browser)

Run `content-audit.mjs` and read `content-report.md`, then work through these checks.

**Crawler access**
- robots.txt: are AI bots (GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended) blocked by accident?
- llms.txt: does it exist, and what share of key pages does it list? A good llms.txt names every important page with one factual line each, grouped by hub. A one-line "Resources" entry covering 40 articles is a miss.
- Pages with almost no text in the raw HTML.

**Semantic HTML**
- One `<main>`, plus `<header>`, `<nav>` and `<footer>`.
- `<article>` on article pages and `<time datetime>` for dates.
- One H1, with no skipped heading levels.
- Lists and tables used for list and table content, with `<th>` on tables.
- Links are `<a href>` and controls are `<button>`, never clickable `<div>` or `<span>` elements.
- Form inputs have labels.
- Images carry `alt` and `width`/`height` (missing dimensions cause layout shift).
- `leakedAttributes`: framework props serialised into the DOM, such as `node="[object Object]"` from react-markdown passing `node` through, or `undefined`/`null` attribute values. These are invisible in the browser but sit in every crawler's copy of the page. The fix is in the component that renders them, not on individual pages.
- A high divs-per-semantic-element ratio (above about 8) means div soup. Website builders such as Webflow often output `<div>` where a `<footer>` belongs.

**Entity and schema** (the biggest gap on most small sites)
- Every page should carry one consistent JSON-LD graph:
  - `Organization`: legal name, logo, address, contact point, `sameAs` profiles, company number if UK.
  - `WebSite`.
  - `Person` for the named author or founder: `jobTitle`, `hasCredential` (degrees, chartered status) and `knowsAbout`.
- Articles reference the Person by `@id` and carry `datePublished` and `dateModified`.
- Check `orgNameVariants` and `sameAs` variants for drift (e.g. a short brand name in one block and the legal name in another, or two different YouTube URLs), and look for HTML-escaped entities inside JSON-LD (`&amp;` in a name).
- Page-type schema where it's true:
  - Article or BlogPosting;
  - BreadcrumbList;
  - SoftwareApplication with Offer on product and pricing pages;
  - DefinedTermSet on a single glossary page;
  - HowTo, VideoObject or DataDownload for real templates.
- FAQPage schema no longer earns rich results except on authoritative government and health sites (Google, August 2023). Keep it only where the questions are real, since it still helps LLM extraction; don't treat it as a ranking lever.

**Meta and cannibalisation**
- Titles about 50 to 60 characters, in the pattern `Specific topic: qualifier | Brand`.
- Descriptions about 140 to 160 characters that state the answer, not a teaser.
- A self-referencing canonical and an og:image on every page.
- `nearDuplicateTitles`: pairs of pages competing for the same query. Merge them, differentiate them, or canonicalise one to the other. A hub page and its "What is X?" spoke with the same title is the most common case.
- Titles with "…in 2026" are freshness bait that dates the page and invites a rewrite every year.

**Content evidence**
- **Answer first.** Put a quotable 40 to 60 word answer directly under the H1, before any essay hook. Retrieval systems lift the first clean definition they find. A distinctive point of view can follow, and that combination beats either alone.
- **Sources.** `medianExternalCitations` of 0 is a finding on any page that makes claims about law, standards, statistics or other people's products. Add a "Sources and further reading" block that links primary sources: legislation, regulators, standards bodies, specifications and the original research.
- **Authorship and freshness.** A visible byline that links to an author page backed by Person schema, and a visible published or updated date in `<time>`.
- **Boilerplate.** Sentences repeated on 10% or more of pages. A CTA belongs in a component, not repeated as body copy. Repeated hedges (the same caveat pasted onto 20 pages) are boilerplate too.
- **Thin pages.** Under 300 words is fine for a tool page but not for an explainer.

**Prose tells** (the `slopPer1kWords` rates; compare against a human-written reference page from the same site if there is one)

| Marker | Rough threshold | Note |
|---|---|---|
| Em dashes | above about 3 per 1,000 words | The strongest single tell readers now notice. Replace most with commas, colons, brackets or full stops |
| "Not X — Y." / "It's not X, it's Y" reveals | any repeated use | Rewrite as a plain claim |
| "actually", "honest(ly)", "the real question", "here's the thing", "quietly" | above about 1 per 1,000 words | Verbal tics |
| Punchy fragments ("That's it. Nothing more to it.") | repeated | Template voice |
| Unsourced trends ("interest has doubled since last year") | any | Cite or cut |
| First-person anecdotes on unattributed pages ("In my experience…") | any | Name the author or cut |
| Invented worked examples ("a £20M programme…") presented as typical | any | Label them as illustrative, or use a real, permissioned case |

## Step 2 - Survival analysis (competitor or reference sites, and your own history)

Run `wayback-survival.mjs` on the reference site and read the section table:

- **Survival near 0% with about 1 average capture:** programmatic or doorway sections that were never revisited and later deleted. A typical example is hundreds of copies of one product page with only the industry or job title swapped into the H1. Treat these as a strategy that failed, even if the site is trying it again now.
- **High survival with many captures:** content that earned its place. Typically:
  - named customer stories;
  - webinars or recorded talks;
  - news, partnerships and appointments;
  - practitioner essays on one specific topic;
  - core company pages.
- **Sections first seen this year:** too new to judge. Say so rather than counting them as successes.
- **Retired URLs that 404:** the site threw away whatever links those pages had earned. When you prune, 301 each retired URL to its closest surviving page.

Survival shows what the owner chose to keep, not proven traffic. If Ahrefs, Semrush or Search Console data is available, use it to confirm.

## Step 3 - Judge

Separate **technique** (worth copying) from **slop** (avoid) explicitly. The useful lessons are usually structural:

- Hub and spoke per buyer problem: a hub with definitions, how-tos, mistakes, templates and a calculator around it.
- Persona or use-case pages that mirror how the buyer searches.
- Free tools and templates as linkable lead magnets, a few good ones rather than dozens.
- Co-citation with a respected third party: link to their guidance, earn their links back.
- Generalise each finding into a principle before recommending it ("every claim is either sourced or yours"), then map it onto the target site.

## If the source code is available

Fix in templates and components, not page by page:

- Put the sitewide JSON-LD graph in the base layout; put Article schema, the byline and `<time>` in the article layout.
- Grep the markdown renderer for prop leakage (e.g. `components={{ p: ({node, ...props}) => <p {...props}/> }}`). The `node` prop must be dropped, not spread.
- Generate llms.txt from the same content collection as the sitemap, so the two can't drift.
- Use one CTA component, and never repeat the CTA as body copy.
- For prose, grep content files: `rg -c '—' content/`, `rg -i "\bnot just\b|\bactually\b|\bquietly\b"`.

## Step 4 - Report

```markdown
# Content structure audit - <site> (<date>)

**Scope:** N pages from raw HTML · Wayback: M archived paths since <year> · **Confirmed issues:** access X · semantic X · entity X · meta X · evidence X · prose X

## Fix first (highest impact for least effort)
1. ...

## 1. Crawler access (robots, llms.txt, server rendering)
## 2. Semantic HTML
## 3. Entity and schema
## 4. Meta and cannibalisation
## 5. Content evidence (answers, sources, authors, dates, boilerplate)
## 6. Prose tells (judged)
## 7. What survived elsewhere (if a reference site was studied)
## What's working (keep it)
```

Include a small table comparing the target with the reference site where both were audited, and adjust anything the scripts got wrong.
