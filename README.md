# Claude skills

Skills for Claude (Claude Code, Cowork, claude.ai), kept in one place.

| Skill | What it does |
|---|---|
| [`icp-prospecting`](skills/icp-prospecting/SKILL.md) | Define an ideal customer profile for any business or sector, check it on 5 real people, then research prospects with a cited public signal for every row and draft outreach. Zero-budget, evidence-first, with UK/EU/US/CA/AU compliance notes. |
| [`local-crm`](skills/local-crm/SKILL.md) | Spin up a single-user CRM in Docker (PHP + SQLite) configured for the business, with a token-protected JSON API and bulk load from research JSON. Ships a tested [template](skills/local-crm/template/). |

They share one record format, so `icp-prospecting` output loads straight into a `local-crm` instance.

## Install

**Claude Code (as a plugin):**

```
/plugin marketplace add <owner>/<repo>
/plugin install prospecting-crm@cleggypdc-skills
```

**Claude Code (plain skills):** copy the folders into `~/.claude/skills/` (or a project's `.claude/skills/`).

**claude.ai / Cowork:** upload a skill folder (zipped) under Settings → Capabilities → Skills, or save it from a chat.

## Layout

```
.claude-plugin/        plugin + marketplace manifests
skills/
  icp-prospecting/SKILL.md
  local-crm/SKILL.md
  local-crm/template/  the CRM itself: config/crm.php, public/, src/, bin/, Docker files
```

## Try the CRM template on its own

```sh
cd skills/local-crm/template
docker compose up -d --build     # http://localhost:8765
```

See [its README](skills/local-crm/template/README.md) for config, the API and loading data.
