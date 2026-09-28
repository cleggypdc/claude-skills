# Local CRM (PHP + SQLite, Docker)

A small single-user CRM for prospecting and follow-ups. One SQLite file, no Composer, no framework, no external calls. Configure it per business in `config/crm.php`.

## Run with Docker (WSL, macOS, Linux)

```sh
# In WSL keep it in the Linux filesystem (~/...), not /mnt/c: SQLite locking and speed are much better there
docker compose up -d --build
```

Open http://localhost:8765 (published on 127.0.0.1 only).

- Data: `./data/crm.db` on the host (bind mount), survives rebuilds. Back up by copying it with the app stopped, or `sqlite3 data/crm.db ".backup backup.db"`.
- Config: `./config/crm.php` is mounted read-only; edits apply on the next page load.
- Runs as UID/GID 1000 by default. If `id -u` differs: `UID=$(id -u) GID=$(id -g) docker compose up -d`.
- Several CRMs side by side: set `CRM_NAME` and `CRM_PORT` in `.env` per folder.
- Docker Hub rate limit on the base image: `docker compose build --build-arg PHP_IMAGE=mirror.gcr.io/library/php:8.4-cli-alpine`.
- Logs `docker compose logs -f` · stop `docker compose down` · due list `docker compose exec crm php bin/due.php`.

Without Docker: `./start.sh` (PHP 8.2+ with pdo_sqlite).

## Configure (`config/crm.php`)

- `app_name`, `timezone`
- `stages` (ordered) and `open_stages`
- `activities`: each has a label and optional rules: `stage` (move forward to), `force` (even from a closed stage), `next` (`[text, days]`, or `null` to clear), `dnc`
- `segments` (ICP versions or campaigns, so reply rates can be compared), `personas`, `account_categories`
- `require_source_url`: every contact must say where you found them (on for prospecting; turn off for inbound/customer lists)
- `email_sources`: an email is rejected unless its source is one of these, so emails are never guessed

Stage, segment and persona keys are stored in the DB: rename labels freely, don't rename keys that already have data.

## Load data

`data/seed.json` is loaded automatically on first start if present. Any time after: `php bin/load_json.php file.json` (Docker: `docker compose exec crm php bin/load_json.php data/file.json`). Existing contacts (same LinkedIn URL, or same name at the same account) are skipped, never overwritten.

Record shape (also the API's POST body):

```json
{
  "account": {"name": "Acme Ltd", "domain": "acme.example", "track": "core", "geo": "UK", "employees_est": "50-200", "score": 4, "why": "..."},
  "contact": {"full_name": "...", "title": "...", "persona": "manager", "segment": "icp_v1", "score": 5, "tools": "...",
              "profile_or_page_url": "https://...", "linkedin_url": null, "email": null, "email_status": null, "location": "UK", "flag": null, "notes": "..."},
  "signals": [{"signal_type": "post", "fact": "One checkable sentence.", "quote": "their exact words", "source_url": "https://...", "seen_at": "2026-09-01"}],
  "messages": [{"channel": "linkedin", "variant": "connect", "body": "..."}, {"channel": "email", "variant": "first", "body": "..."}]
}
```

## JSON API

Off unless `CRM_API_TOKEN` is set (`echo "CRM_API_TOKEN=$(openssl rand -hex 24)" >> .env && docker compose up -d`). Base `http://localhost:8765/api.php`, header `Authorization: Bearer <token>`.

| Method | Path | What |
|---|---|---|
| GET | `/meta` | stages, activities and their rules, personas, segments |
| GET | `/contacts?segment=&stage=&persona=&q=&limit=` | list |
| GET | `/contacts/{id}` | contact + signals + drafts + activities |
| POST | `/contacts` | create (shape above): 201 created, 200 if it already exists |
| PATCH | `/contacts/{id}` | update fields |
| POST | `/contacts/{id}/activities` | `{type, body?, occurred_at?}`, applies the configured rules |
| GET | `/accounts`, `/due` | lists |

Validation errors return 422 with a message. The same rules apply to the UI, the API and `load_json.php`.

## Layout

```
config/crm.php     per-business configuration
public/index.php   UI (routes, actions, views)
public/api.php     JSON API
public/style.css   light/dark styles · public/app.js copy buttons
src/bootstrap.php  PDO, schema migrations (PRAGMA user_version), rules, shared create logic
bin/load_json.php  bulk load · bin/due.php due list in the terminal
data/              crm.db (created on first run), seed.json (optional)
```
