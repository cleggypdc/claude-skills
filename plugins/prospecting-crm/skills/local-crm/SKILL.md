---
name: local-crm
description: Spin up a small single-user CRM for any business in Docker (PHP + SQLite), with per-business config, a JSON API for agents, and bulk load from research JSON. Runs locally, including WSL.
---

# Local CRM in Docker

Give the user a working CRM on their own machine in minutes: pipeline stages, a Today view of due follow-ups, per-contact timeline and drafts, activity logging that moves stages by rule, CSV export, and a token-protected JSON API so agents can add and update contacts. One SQLite file; no Composer, framework or external calls.

Use it standalone for any sector, or after the `icp-prospecting` skill to hold its results.

## 1. Brief

Ask (AskUserQuestion) only what changes the config:

- Business name and what a "contact" is for them (prospect, client, patient enquiry, donor, supplier...).
- Their pipeline in their own words (e.g. enquiry → quote sent → booked → done). Map to `stages` and `open_stages`.
- What they log (calls, site visits, quotes, emails...). Map to `activities` with rules.
- Segments/campaigns and personas worth comparing.
- Is it prospecting (keep `require_source_url` on) or an inbound/customer list (turn it off)?
- Where it runs: Docker Desktop + WSL, macOS, Linux, or plain PHP. Default Docker.

## 2. Get the template

In order:

1. The `template/` folder next to this SKILL.md (present when the skill is installed from its repo). Copy it; don't edit it in place.
2. A template folder or repo URL the user gives you, or a folder containing `config/crm.php` and `src/bootstrap.php`.
3. Otherwise build it from the spec below. Keep the file layout and contracts exactly, so data and API clients stay compatible across CRMs.

Then write `config/crm.php` for this business, and `data/seed.json` if there is data to load.

## 3. Spec

### Layout

```
config/crm.php     per-business config (mounted read-only; edits apply on next request)
public/index.php   UI: routes (?r=dashboard|contacts|contact|accounts|account|account_form|new_contact|export), POST actions, views
public/api.php     JSON API
public/style.css   light + dark (prefers-color-scheme), phone-friendly · public/app.js copy-to-clipboard for drafts
src/bootstrap.php  config → constants, PDO (WAL, foreign keys), migrations via PRAGMA user_version, apply_activity(), upsert_account(), create_contact_record()
bin/load_json.php  bulk load an array of records in one transaction (all or nothing)
bin/due.php        due/overdue list in the terminal
docker/entrypoint.sh, Dockerfile, docker-compose.yml, start.sh, README.md
data/              crm.db (created on first run, never shipped), seed.json (optional)
```

### Config (`config/crm.php` returns an array; this is the default)

```php
/**
 * CRM configuration. Edit per business; changes apply on the next request (config/ is mounted read-only in Docker).
 * Keys of stages/segments/personas are stored in the DB, so rename labels freely but don't rename keys that have data.
 */
return [
    'app_name' => 'Outbound CRM',
    'timezone' => 'Europe/London',

    // Pipeline, in order. 'open' stages are the ones a contact can move forward through.
    'stages' => [
        'new' => 'New',
        'queued' => 'Queued',
        'contacted' => 'Contacted',
        'replied' => 'Replied',
        'meeting' => 'Meeting',
        'opportunity' => 'Opportunity',
        'customer' => 'Customer',
        'not_now' => 'Not now',
        'not_interested' => 'Not interested',
    ],
    'open_stages' => ['new', 'queued', 'contacted', 'replied', 'meeting', 'opportunity'],

    // What can be logged against a contact, and what each one does.
    // stage: move forward to this stage (never backwards) | force: set it even from a closed stage
    // next: [text, days after the activity] sets the next action; null clears it; omit to leave it alone
    // dnc: true marks do-not-contact
    'activities' => [
        'note' => ['label' => 'Note'],
        'linkedin_connect' => ['label' => 'LinkedIn connect sent', 'stage' => 'contacted', 'next' => ['Check connect accepted; email if not', 7]],
        'connect_accepted' => ['label' => 'Connect accepted', 'next' => ['Send first message', 0]],
        'linkedin_message' => ['label' => 'LinkedIn message sent', 'stage' => 'contacted', 'next' => ['Send follow-up', 7]],
        'email_sent' => ['label' => 'Email sent', 'stage' => 'contacted', 'next' => ['Send follow-up', 7]],
        'followup_sent' => ['label' => 'Follow-up sent', 'stage' => 'contacted', 'next' => ['Last nudge or park as Not now', 14]],
        'call' => ['label' => 'Call'],
        'reply' => ['label' => 'Reply received', 'stage' => 'replied', 'next' => ['Respond to reply', 0]],
        'meeting_booked' => ['label' => 'Meeting booked', 'stage' => 'meeting', 'next' => ['Prep for meeting', 0]],
        'meeting_held' => ['label' => 'Meeting held', 'stage' => 'meeting', 'next' => ['Send meeting follow-up', 0]],
        'proposal_sent' => ['label' => 'Proposal / quote sent', 'stage' => 'opportunity', 'next' => ['Chase proposal', 5]],
        'won' => ['label' => 'Won', 'stage' => 'customer', 'force' => true, 'next' => null],
        'opted_out' => ['label' => 'Opted out / asked not to be contacted', 'stage' => 'not_interested', 'force' => true, 'dnc' => true, 'next' => null],
    ],

    // Who you sell to. Segments separate ICP versions or campaigns so you can compare reply rates.
    'segments' => ['icp_v1' => 'ICP v1'],
    'default_segment' => 'icp_v1',
    'personas' => ['founder', 'owner', 'manager', 'practitioner', 'buyer', 'champion', 'other'],
    'account_categories' => ['core', 'adjacent', 'other'],

    // Data rules (the prospecting playbook's guard rails).
    'require_source_url' => true,          // every contact must say where you found them
    'email_sources' => ['found_public', 'enrichment_free_tier', 'they_gave_it', 'existing_customer'], // email is rejected without one of these
];
```

`bootstrap.php` defines constants from it: APP_NAME, STAGES, OPEN_STAGES, ACTIVITY_RULES, ACTIVITY_TYPES (labels), PERSONAS, SEGMENTS, DEFAULT_SEGMENT, TRACKS (account_categories), REQUIRE_SOURCE_URL, EMAIL_SOURCES. Config path can be overridden with `CRM_CONFIG`, DB path with `CRM_DB`.

### Schema (migration v1; later changes go in `if ($v < 2)` blocks, never edit v1)

```sql
CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT UNIQUE,
    track TEXT,
    geo TEXT,
    employees_est TEXT,
    score INTEGER,
    why TEXT,
    triggers TEXT,
    source_urls TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE contacts (
    id INTEGER PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    title TEXT,
    persona TEXT,
    profile_or_page_url TEXT,
    linkedin_url TEXT,
    email TEXT,
    email_status TEXT,
    location TEXT,
    stage TEXT NOT NULL DEFAULT 'new',
    next_action TEXT,
    next_action_at TEXT,
    flag TEXT,
    notes TEXT,
    do_not_contact INTEGER NOT NULL DEFAULT 0,
    segment TEXT,
    score INTEGER,
    tools TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE signals (
    id INTEGER PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    signal_type TEXT,
    fact TEXT NOT NULL,
    quote TEXT,
    source_url TEXT NOT NULL,
    seen_at TEXT
);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    channel TEXT,
    variant TEXT,
    body TEXT,
    first_line_cites_signal_id INTEGER
);
CREATE TABLE activities (
    id INTEGER PRIMARY KEY,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    body TEXT,
    occurred_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_contacts_stage ON contacts(stage);
CREATE INDEX idx_contacts_next ON contacts(next_action_at);
CREATE INDEX idx_activities_contact ON activities(contact_id, occurred_at);
CREATE INDEX idx_contacts_segment ON contacts(segment);
PRAGMA user_version = 1;
```

### Rules (one code path for UI, API and bulk load)

- `create_contact_record({account?, contact, signals[], messages[]})` in one transaction: requires `full_name` (and `profile_or_page_url` when REQUIRE_SOURCE_URL); every signal needs `fact` + `source_url`; an `email` needs `email_status` in EMAIL_SOURCES; validates stage/segment keys. `upsert_account` matches by lower-cased domain, then case-insensitive name. De-dupe contacts by LinkedIn URL, then name + account: an existing match is returned untouched (`created: false`).
- `apply_activity(id, type, body, when)`: insert the activity, then apply the config rule: `stage` moves forward only while the contact is in an open stage (never backwards) unless `force`; `next` sets `[text, when + days]`, `null` clears, absent leaves it; `dnc` sets do-not-contact; a do-not-contact contact never keeps a next action.
- Every query uses prepared statements; every value rendered in HTML goes through `htmlspecialchars`.

### UI

- **Today**: stage tiles with counts (link to filtered list), due/overdue table (red overdue, amber today), next 7 days, "what is working" (touched / replied / reply rate / meetings grouped by segment and persona), recent activity feed.
- **Contacts**: filters (search, stage, segment, category, persona, flagged, include do-not-contact), sorted by person score then account score.
- **Contact**: account link, stage badge, source/LinkedIn/email links, flag line, next action; log-activity form (type + datetime + note); signals with quote; drafts with Copy buttons and LinkedIn character counts; timeline with delete; details form (all editable fields, do-not-contact checkbox).
- **Accounts**, **Account** (people + add person), **Account form**, **New contact** (with optional signal), **Export CSV**.
- Post/redirect/get with a session flash message. Alias `accounts.score AS account_score` in joins so it never overwrites `contacts.score`.

### API (`public/api.php`, JSON)

Off (503) unless `CRM_API_TOKEN` is set; `Authorization: Bearer <token>` compared with `hash_equals` (401 otherwise). Route on PATH_INFO (`/api.php/contacts` works with `php -S`).

| Method | Path | Result |
|---|---|---|
| GET | `/meta` | stages, activity types and rules, personas, segments, account categories, email sources |
| GET | `/contacts?segment=&stage=&persona=&q=&limit=` | list (limit ≤500) |
| GET | `/contacts/{id}` | contact + signals + messages + activities |
| POST | `/contacts` | create_contact_record → 201 `{id, created, url}`, 200 if it existed |
| PATCH | `/contacts/{id}` | allow-listed fields only, same validation |
| POST | `/contacts/{id}/activities` | `{type, body?, occurred_at?}` → 201 `{stage, next_action, next_action_at}` |
| GET | `/accounts`, `/due` | lists |

422 for validation errors, 404 for unknown ids/routes, 400 for bad JSON or unknown activity type.

### Docker

```dockerfile
# Official PHP CLI image already ships pdo_sqlite. Override with --build-arg PHP_IMAGE=mirror.gcr.io/library/php:8.4-cli-alpine if Docker Hub rate-limits you.
ARG PHP_IMAGE=php:8.4-cli-alpine
FROM ${PHP_IMAGE}

WORKDIR /app
COPY public ./public
COPY src ./src
COPY bin ./bin
COPY config ./config
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# Config edits must apply without a restart, so no opcode cache (the app is tiny).
RUN echo "opcache.enable=0" > "$PHP_INI_DIR/conf.d/zz-crm.ini" \
    && chmod +x /usr/local/bin/entrypoint.sh && php -m | grep -q pdo_sqlite && mkdir -p /app/data && chmod 0777 /app/data

ENV CRM_DB=/app/data/crm.db
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8765/ >/dev/null || exit 1
ENTRYPOINT ["entrypoint.sh"]
# 0.0.0.0 inside the container; compose publishes it on 127.0.0.1 only.
CMD ["php", "-S", "0.0.0.0:8765", "-t", "public"]
```

```yaml
services:
  crm:
    build: .
    image: ${CRM_NAME:-crm}
    container_name: ${CRM_NAME:-crm}
    # Run as your user so files in ./data stay owned by you, not root.
    user: "${UID:-1000}:${GID:-1000}"
    ports:
      - "127.0.0.1:${CRM_PORT:-8765}:8765"
    volumes:
      - ./data:/app/data
      - ./config:/app/config:ro
    environment:
      TZ: ${TZ:-Europe/London}
      # Enables the JSON API at /api.php. Set CRM_API_TOKEN in .env next to this file.
      CRM_API_TOKEN: ${CRM_API_TOKEN:-}
    restart: unless-stopped
```

`docker/entrypoint.sh`: if `$CRM_DB` doesn't exist and `/app/data/seed.json` does, run `php /app/bin/load_json.php /app/data/seed.json`; then `exec "$@"`. `.dockerignore` and `.gitignore` exclude `data/crm.db*` and `.env`.

## 4. Test before handing over

Run it (Docker if available in the sandbox, else `php -S`) and check:

1. Every UI route returns 200; unknown route 404.
2. API: no token 401; create 201; same record again 200; missing source URL 422; email without source 422; signal without URL 422.
3. Activities: email → contacted + follow-up date; reply → replied, due today; a closed stage isn't reopened by a later email; opted-out → do-not-contact, next action cleared.
4. Bulk load twice: second run creates 0.
5. Edit `config/crm.php` while running: the change shows on the next request (the Dockerfile disables opcache for this).
6. Files in `./data` are owned by UID 1000, not root.
7. Screenshot Today and a contact page (Playwright) and look at them.

## 5. Deliver

- A zip of the folder **without** `data/crm.db`, so unzipping over an existing install never overwrites the user's data. Schema changes ship as migrations.
- Tell them: where to unzip (in WSL, under `~/`, not `/mnt/c`), `docker compose up -d --build`, the URL, how to enable the API (`.env` with `CRM_API_TOKEN`), how to load data, how to back up.
- If a folder on their computer is connected, write it there instead of only attaching the zip.

## Gotchas learned the hard way

- `php -S` in the official image caches PHP with opcache: config edits won't show until restart unless `opcache.enable=0`.
- Docker Hub rate limits (429) on `php:*` pulls: build with `--build-arg PHP_IMAGE=mirror.gcr.io/library/php:8.4-cli-alpine`.
- Bind-mounted data written as root is a pain in WSL: run as `${UID:-1000}:${GID:-1000}`.
- `SELECT c.*, a.score` silently overwrites the contact's score: always alias account columns.
- Set the timezone (`TZ`, default from config): UTC default puts late-evening activity on the wrong day.
- Only publish on `127.0.0.1`; the built-in server is for single-user local use, not the internet.
- From a cloud session you can't reach the user's localhost API: tell them, and hand over JSON plus `load_json.php`, or a script they run.
