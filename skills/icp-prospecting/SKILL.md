---
name: icp-prospecting
description: Define an ideal customer profile for any business or sector, validate it on a small sample, then research real prospects with cited signals and draft outreach. Zero-budget, evidence-first.
---

# ICP prospecting

Turn "who should we sell to?" into a validated ICP, a list of real people with a public source for every row, one cited signal each, and outreach drafts. Works for any business: SaaS, agencies, trades, professional services, charities, local shops.

Pair with the `local-crm` skill to load the results into a Docker CRM the user runs locally.

## Non-negotiables

- Never invent a person, title, company fact, quote, email or URL. If you can't point at a URL, the row doesn't exist.
- Every contact has a public `profile_or_page_url`. Every signal has a `fact` (one checkable sentence) and a `source_url`.
- Emails stay empty unless found on a public page, given by the person, or returned by a free enrichment tier. Never guess `first.last@domain`, never SMTP-probe.
- No logged-in scraping or automation of LinkedIn or any site whose terms forbid it. LinkedIn URLs that appear in search results are fine as a name/title source.
- Nothing is sent. Sending is always the user's step.
- Not legal advice: say so when you flag compliance.

## Phase 0: Brief (ask, don't assume)

Use AskUserQuestion. Get, or confirm from their site:

1. What they sell, the price and how people buy it. **Price sets the motion:** a card-level price (under ~£50/seat/month or a one-off under ~£500) means one person decides, so target the *user*. A five- or six-figure deal means a committee, so target *buyer + champion*.
2. Their best 3-5 existing customers, if any. This is the strongest source there is: build the ICP as look-alikes of these, not from theory.
3. Who **does the work** the product helps with, and who **owns the budget**. These are often different people. Ask which they want to reach first.
4. What the target does today instead (spreadsheet, agency, DIY, a competitor, nothing). That's the real competitor, and the copy must beat it.
5. Geography and sector limits, and the channels they're willing to use (LinkedIn, email, phone, events, letters).
6. Their writing preferences (spelling, quote style, tone) for the drafts.

Fetch their homepage, pricing, about and any case studies before writing the ICP.

## Phase 1: ICP hypothesis, then calibrate on 5 people

Write `icp.json`:

```json
{
  "version": 1,
  "product": "", "motion": "bottom-up | sales-led | local-service | partnership",
  "who": "one sentence describing the person, not the company",
  "roles": [], "situations": ["the moments they feel the pain"],
  "size": "", "geo": [], "geo_priority": [],
  "signals": ["public, datable evidence they are in-market"],
  "disqualify": ["competitors", "people who would build it themselves", "students/recruiters/influencers", "..."],
  "score_rules": {"5": "", "4": "", "3": "", "1": "disqualified"},
  "work_scores": [4, 5]
}
```

Then **calibrate before scaling**: find 5 real people who fit, show them to the user (name, role, why, the signal), and ask "would you sell to these people?" Only fan out once they say yes. An ICP that is wrong at 5 people wastes the whole run at 50. Common misses this catches:

- Targeting owners and specialists who would build it themselves, or see it as a commodity, when the product is for the people doing the work.
- Targeting the budget holder for a product cheap enough that the user just buys it.
- Job titles that look right but don't have the problem.

Version the ICP (`version`, `supersedes`) whenever it changes, and keep old contacts in a separate segment rather than deleting them.

## Phase 2: Where to look (free and public first)

Prefer the person's **own words** (a post, talk, review, job ad they wrote, a planning application, a tender) over job titles. A signal is something datable that says they are in-market now.

| Target | Sources |
|---|---|
| Any UK company | Companies House (officers, filings, new incorporations, SH01 share allotments as funding signals), the company's own team/about/news pages |
| Other registries | OpenCorporates, SEC EDGAR (US public cos), national registers (KvK, Handelsregister, Brønnøysund, CRO) |
| Regulated professions | SRA (solicitors), ICAEW/ACCA/CIMA directories, FCA register, RICS, ARB (architects), GMC/GDC/GPhC, CQC, Ofsted, Gas Safe, NICEIC, TrustMark; US: state bar, NPI registry, FINRA BrokerCheck |
| Charities / non-profits | Charity Commission, OSCR, CCNI, 360Giving; US: ProPublica Nonprofit Explorer |
| Local businesses and trades | Google Maps (manual or browser, respect terms), Checkatrade, TrustATrader, Yell, Yelp, chambers of commerce, BID directories, trade association member lists |
| Selling to the public sector | Contracts Finder, Find a Tender, TED (EU), SAM.gov; council and NHS trust org charts; procurement pipelines |
| Hiring and growth signals | Careers pages, Greenhouse/Lever/Ashby/Workable public boards, Indeed, NHS Jobs, Civil Service Jobs |
| Change signals | Press releases, Google News RSS, planning portals (construction, property, hospitality), new premises, leadership appointments in trade press |
| Practitioners in their own words | Substack, Medium, personal blogs, podcasts, conference and meetup speaker lists, GitHub READMEs, LinkedIn posts seen in search results |
| Tools they use / switching pain | Job ads naming tools, BuiltWith/Wappalyzer free lookups, app marketplaces, G2/Capterra/Trustpilot reviews of competitors (a named reviewer complaining is a strong signal) |
| Events | Exhibitor and speaker lists (trade shows, sector conferences), awards shortlists |

Paid databases (Apollo, ZoomInfo, Clay, PDL) are out of scope unless the user explicitly brings one. Free tiers (Hunter, Apollo free, Tavily/Firecrawl) go last and only on the top-scored rows.

## Phase 3: Research at scale

Fan out with parallel subagents, one per slice (for example sector × geography, or persona). Write a shared brief file they all read: product summary, the frozen `icp.json`, the non-negotiables, where to look, and the exact output JSON (below).

- **Budget searches.** Web search is capped per session (about 200 calls), shared across all subagents. Give each agent an explicit budget (e.g. 45 searches for 4 agents), and tell it to prefer fetching list pages (speaker lists, member directories, registries) over many small searches.
- Target 10-15 people per agent, score 4-5 only. Tell agents to report what was thin rather than pad.
- `seen_at` must be the source's date, or null if the source is undated. **Never today's date as a default.**
- Ask for a verbatim `quote` (≤25 words) only if it's on the page, and an `evidence_note` for anything uncertain (inferred location, old source, possible creator/influencer/competitor).

Output record (this is also the `local-crm` load/API shape):

```json
{
  "account": {"name": "", "domain": null, "track": "", "geo": "", "employees_est": "", "score": null, "why": ""},
  "contact": {"full_name": "", "title": "", "persona": "", "segment": "icp_v1", "score": 4,
              "tools": "", "profile_or_page_url": "", "linkedin_url": null, "email": null, "email_status": null,
              "location": "", "flag": null, "notes": ""},
  "signals": [{"signal_type": "post|article|talk|repo|review|job_post|hire|news|filing|tender|planning",
               "fact": "", "quote": null, "source_url": "", "seen_at": "YYYY-MM-DD or null"}]
}
```

After the agents return:

1. Merge and **dedupe** (same person found by two agents: keep one, merge signals).
2. Normalise dates; drop anyone you can't confirm is a real, findable person.
3. **Verify**: re-fetch the source for every score-5 row and a sample of the rest. Confirm the quote is verbatim; if not, rewrite the draft without quote marks.
4. Flag rather than delete: old signal (>6 months), inferred location, creator/influencer, builds their own version, size outside range.

## Phase 4: Drafts

Write only where a signal exists.

- **First line cites their signal** in plain words ("Your post on X..."). No "I came across your profile".
- Say the gap in *their* current workaround, then one line on what the product does about it.
- Ask for the lightest next step that fits the motion: user-led product → "would you try it and tell me where it falls short?"; sales-led → a short call; local service → a quote or visit.
- No fake social proof, no invented stats, no "our AI found you".
- Caps: LinkedIn connect ≤300 characters, first message ≤90 words, follow-up ≤60 words. Check with a script, along with the user's style preferences (spelling, quote marks, no em dashes if they prefer).
- Hand-write the hook per person. Templates only for the middle.

## Phase 5: Deliver

- `icp.json` (versioned), the merged JSON records, and a review sheet in Markdown: per person, why, signal with link, flags, drafts.
- Load into the CRM with the `local-crm` skill (`bin/load_json.php` or `POST /api.php/contacts`), using a new `segment` per ICP version.
- Recommend a first wave of 10-15, ideally spread across segments so replies show which ICP is working.

## Compliance to flag (check current rules; not legal advice)

- **UK (PECR + UK GDPR):** cold B2B email to *corporate* subscribers (limited companies, LLPs, public bodies) is allowed with an opt-out in every message. **Sole traders and ordinary partnerships count as individuals** and need prior consent, which matters for trades, small firms and many law/accounting partnerships: use LinkedIn, phone (screen against TPS/CTPS) or post instead. Since 5 Feb 2026 (Data (Use and Access) Act 2025) PECR fines can reach £17.5m or 4% of turnover. Holding people's data triggers a UK GDPR Article 14 notice within a month, and legitimate interest needs a documented assessment.
- **EU:** GDPR plus national ePrivacy rules, which differ (Germany is strict on cold B2B email; France allows it if relevant to the role). Check the country.
- **US:** CAN-SPAM (accurate headers, physical address, working opt-out honoured within 10 business days).
- **Canada:** CASL needs consent; implied consent can come from a conspicuously published business address when the message is relevant to their role.
- **Australia:** Spam Act needs consent; inferred consent from conspicuous publication has similar limits.
- Honour opt-outs immediately: log them as do-not-contact in the CRM.

## Lessons from real runs

- The first ICP is usually aimed at the wrong person. The calibration checkpoint is the cheapest fix.
- People who have publicly built their own workaround prove the pain but may not buy: flag them, and prioritise people with a manual workaround they aren't selling.
- Watch for competitors writing about the same problem; note them in `icp.json`.
- Case-study pages from a vendor (e.g. a platform's customer stories) cluster your list around that vendor's customers: note it.
- Company pages and trade press are more reliable for titles than aggregators; anything from 2+ years ago needs rechecking.
