# Claude skills

Skills for Claude (Claude Code, Cowork, claude.ai), kept in one place and grouped into plugins so you can install only what you need.

## Plugins and skills

### `prospecting-crm`

| Skill | What it does |
|---|---|
| [`icp-prospecting`](plugins/prospecting-crm/skills/icp-prospecting/SKILL.md) | Define an ideal customer profile for any business or sector, check it on 5 real people, then research prospects with a cited public signal for every row and draft outreach. Zero-budget, evidence-first, with UK/EU/US/CA/AU compliance notes. |
| [`local-crm`](plugins/prospecting-crm/skills/local-crm/SKILL.md) | Spin up a single-user CRM in Docker (PHP + SQLite) configured for the business, with a token-protected JSON API and bulk load from research JSON. Ships a tested [template](plugins/prospecting-crm/skills/local-crm/template/). |

`icp-prospecting` and `local-crm` share one record format, so prospecting output loads straight into a CRM instance.

### `site-qa`

| Skill | What it does |
|---|---|
| [`slop-ui-audit`](plugins/site-qa/skills/slop-ui-audit/SKILL.md) | Audit a website for what functional QA misses: broken and hot-linked images, gutter drift between sections, cross-page inconsistency, meta hygiene, AI/agent comments and secrets shipped in HTML/JS/source maps, and AI 'slop' design tells. Ships a no-dependency leak crawler and an in-page scanner in [`scripts/`](plugins/site-qa/skills/slop-ui-audit/scripts/). |

## Install

**Claude Code (as plugins):**

```
/plugin marketplace add cleggypdc/claude-skills
/plugin install prospecting-crm@cleggypdc-skills
/plugin install site-qa@cleggypdc-skills
```

**Claude Code (plain skills):** copy a skill folder (e.g. `plugins/site-qa/skills/slop-ui-audit`) into `~/.claude/skills/` or a project's `.claude/skills/`. Skills must sit directly under `skills/`; nested category folders aren't discovered.

**claude.ai / Cowork:** upload a skill folder (zipped) under Settings → Capabilities → Skills, or save it from a chat.

## Layout

```
.claude-plugin/marketplace.json      lists every plugin below
plugins/
  prospecting-crm/
    .claude-plugin/plugin.json
    skills/
      icp-prospecting/SKILL.md
      local-crm/SKILL.md
      local-crm/template/            the CRM itself: config/crm.php, public/, src/, bin/, Docker files
  site-qa/
    .claude-plugin/plugin.json
    skills/
      slop-ui-audit/SKILL.md
      slop-ui-audit/scripts/         leak-crawl.mjs, site-qa-scan.js, qa-run.js
```

To add a group, create `plugins/<name>/` with its own `.claude-plugin/plugin.json` (the `name` must match its marketplace entry) and a flat `skills/` folder, then add an entry to `.claude-plugin/marketplace.json` with `"source": "./plugins/<name>"`.

## Try the CRM template on its own

```sh
cd plugins/prospecting-crm/skills/local-crm/template
docker compose up -d --build     # http://localhost:8765
```

See [its README](plugins/prospecting-crm/skills/local-crm/template/README.md) for config, the API and loading data.

## Run the site audit tools on their own

```sh
cd plugins/site-qa/skills/slop-ui-audit/scripts
node leak-crawl.mjs https://your-site.example --depth 2          # secrets, agent comments, source maps; add --probe only on sites you own
npm i playwright && node qa-run.js https://your-site.example/ '' pricing about   # per-page scan + screenshots + cross-page diff
```
