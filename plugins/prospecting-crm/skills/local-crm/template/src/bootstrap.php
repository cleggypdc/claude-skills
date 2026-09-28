<?php
declare(strict_types=1);

$CFG = require (getenv('CRM_CONFIG') ?: dirname(__DIR__) . '/config/crm.php');
date_default_timezone_set(getenv('TZ') ?: ($CFG['timezone'] ?? 'UTC'));

define('APP_NAME', $CFG['app_name'] ?? 'CRM');
define('STAGES', $CFG['stages']);
define('OPEN_STAGES', $CFG['open_stages']);
define('ACTIVITY_RULES', $CFG['activities']);
define('ACTIVITY_TYPES', array_map(fn ($a) => $a['label'], $CFG['activities']));
define('PERSONAS', $CFG['personas']);
define('SEGMENTS', $CFG['segments']);
define('DEFAULT_SEGMENT', $CFG['default_segment'] ?? array_key_first($CFG['segments']));
define('TRACKS', $CFG['account_categories']);
define('REQUIRE_SOURCE_URL', (bool) ($CFG['require_source_url'] ?? true));
define('EMAIL_SOURCES', $CFG['email_sources']);

function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $path = getenv('CRM_DB') ?: dirname(__DIR__) . '/data/crm.db';
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void
{
    $v = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
    if ($v < 1) {
        $pdo->exec(<<<SQL
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
        SQL);
    }
    // Future schema changes: add `if ($v < 2) { ALTER ...; PRAGMA user_version = 2; }` here. Never edit the v1 block.
}

function h(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function today(): string
{
    return date('Y-m-d');
}

function plus_days(int $n, ?string $from = null): string
{
    return date('Y-m-d', strtotime(($from ?? today()) . " +{$n} days"));
}

/**
 * Deterministic stage rules from config: an activity moves the contact forward and sets the next action.
 * Never moves a contact backwards unless the rule says force, and never schedules anything for a do-not-contact row.
 */
function apply_activity(int $contactId, string $type, string $body, string $when): void
{
    $rule = ACTIVITY_RULES[$type] ?? null;
    if (!$rule) {
        throw new InvalidArgumentException('Unknown activity type');
    }
    $c = q('SELECT * FROM contacts WHERE id = ?', [$contactId])->fetch();
    if (!$c) {
        throw new RuntimeException('Contact not found');
    }
    $pdo = db();
    $pdo->beginTransaction();
    q('INSERT INTO activities (contact_id, type, body, occurred_at) VALUES (?, ?, ?, ?)', [$contactId, $type, $body, $when]);

    $order = array_flip(array_keys(STAGES));
    $stage = $c['stage'];
    if (isset($rule['stage'])) {
        $to = $rule['stage'];
        if (!empty($rule['force']) || !in_array($stage, OPEN_STAGES, true) && !isset($order[$stage]) || (in_array($stage, OPEN_STAGES, true) && $order[$to] > $order[$stage])) {
            $stage = $to;
        }
    }
    $next = [$c['next_action'], $c['next_action_at']];
    if (array_key_exists('next', $rule)) {
        $next = $rule['next'] === null ? [null, null] : [$rule['next'][0], plus_days((int) $rule['next'][1], substr($when, 0, 10))];
    }
    $dnc = !empty($rule['dnc']) ? 1 : (int) $c['do_not_contact'];
    if ($dnc) {
        $next = [null, null];
    }
    q("UPDATE contacts SET stage = ?, next_action = ?, next_action_at = ?, do_not_contact = ?, updated_at = datetime('now') WHERE id = ?",
        [$stage, $next[0], $next[1], $dnc, $contactId]);
    $pdo->commit();
}

/** Find or create an account by domain, then by name. Returns its id. */
function upsert_account(array $a): int
{
    $name = trim((string) ($a['name'] ?? ''));
    if ($name === '') {
        throw new InvalidArgumentException('account.name is required');
    }
    $domain = ($a['domain'] ?? '') !== '' ? strtolower(trim($a['domain'])) : null;
    $id = $domain ? q('SELECT id FROM accounts WHERE domain = ?', [$domain])->fetchColumn() : false;
    $id = $id ?: q('SELECT id FROM accounts WHERE lower(name) = lower(?)', [$name])->fetchColumn();
    if ($id) {
        return (int) $id;
    }
    q('INSERT INTO accounts (name, domain, track, geo, employees_est, score, why, source_urls) VALUES (?,?,?,?,?,?,?,?)', [
        $name, $domain, $a['track'] ?? 'other', $a['geo'] ?? null, $a['employees_est'] ?? null,
        isset($a['score']) ? (int) $a['score'] : null, $a['why'] ?? null, isset($a['source_urls']) ? json_encode($a['source_urls']) : null,
    ]);
    return (int) db()->lastInsertId();
}

/**
 * Create a contact with its account, signals and drafts in one transaction.
 * Enforces the playbook rules: source URL required, signals need fact + URL, email never guessed.
 * Returns ['id' => int, 'created' => bool]; an existing match (LinkedIn URL, or name at the same account) is not modified.
 */
function create_contact_record(array $in): array
{
    $c = $in['contact'] ?? [];
    foreach (REQUIRE_SOURCE_URL ? ['full_name', 'profile_or_page_url'] : ['full_name'] as $f) {
        if (trim((string) ($c[$f] ?? '')) === '') {
            throw new InvalidArgumentException("contact.$f is required");
        }
    }
    if (!empty($c['email']) && !in_array($c['email_status'] ?? '', EMAIL_SOURCES, true)) {
        throw new InvalidArgumentException('contact.email_status must be one of ' . implode(', ', EMAIL_SOURCES) . ' (emails are never guessed)');
    }
    if (isset($c['stage']) && !isset(STAGES[$c['stage']])) {
        throw new InvalidArgumentException('Unknown stage');
    }
    if (isset($c['segment']) && !isset(SEGMENTS[$c['segment']])) {
        throw new InvalidArgumentException('Unknown segment: ' . implode(', ', array_keys(SEGMENTS)));
    }
    foreach ($in['signals'] ?? [] as $s) {
        if (trim((string) ($s['fact'] ?? '')) === '' || trim((string) ($s['source_url'] ?? '')) === '') {
            throw new InvalidArgumentException('Every signal needs fact and source_url');
        }
    }

    $pdo = db();
    $own = !$pdo->inTransaction();
    if ($own) {
        $pdo->beginTransaction();
    }
    try {
        $accountId = isset($in['account']) ? upsert_account($in['account']) : (isset($c['account_id']) ? (int) $c['account_id'] : null);
        $li = ($c['linkedin_url'] ?? '') ?: null;
        $existing = $li ? q('SELECT id FROM contacts WHERE linkedin_url = ?', [$li])->fetchColumn() : false;
        $existing = $existing ?: q('SELECT id FROM contacts WHERE lower(full_name) = lower(?) AND account_id IS ?', [trim($c['full_name']), $accountId])->fetchColumn();
        if ($existing) {
            if ($own) {
                $pdo->commit();
            }
            return ['id' => (int) $existing, 'created' => false];
        }
        q('INSERT INTO contacts (account_id, full_name, title, persona, profile_or_page_url, linkedin_url, email, email_status, location, stage,
            next_action, next_action_at, flag, notes, segment, score, tools) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
            $accountId, trim($c['full_name']), $c['title'] ?? null, $c['persona'] ?? 'other', ($c['profile_or_page_url'] ?? '') ?: null, $li,
            ($c['email'] ?? '') ?: null, ($c['email'] ?? '') ? $c['email_status'] : null, $c['location'] ?? null, $c['stage'] ?? 'new',
            $c['next_action'] ?? null, $c['next_action_at'] ?? null, $c['flag'] ?? null, $c['notes'] ?? null,
            $c['segment'] ?? DEFAULT_SEGMENT, isset($c['score']) ? (int) $c['score'] : null, $c['tools'] ?? null,
        ]);
        $id = (int) $pdo->lastInsertId();
        foreach ($in['signals'] ?? [] as $s) {
            q('INSERT INTO signals (account_id, contact_id, signal_type, fact, quote, source_url, seen_at) VALUES (?,?,?,?,?,?,?)',
                [$accountId, $id, $s['signal_type'] ?? 'post', trim($s['fact']), $s['quote'] ?? null, trim($s['source_url']), $s['seen_at'] ?? today()]);
        }
        foreach ($in['messages'] ?? [] as $m) {
            q('INSERT INTO messages (contact_id, channel, variant, body) VALUES (?,?,?,?)', [$id, $m['channel'] ?? 'linkedin', $m['variant'] ?? 'first', $m['body'] ?? '']);
        }
        if ($own) {
            $pdo->commit();
        }
        return ['id' => $id, 'created' => true];
    } catch (Throwable $e) {
        if ($own && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}
