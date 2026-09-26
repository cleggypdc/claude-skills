<?php
/**
 * JSON API for agents and scripts.  Base: http://localhost:8765/api.php
 * Auth: Authorization: Bearer $CRM_API_TOKEN  (API is off unless CRM_API_TOKEN is set)
 *
 *   GET    /contacts?segment=&stage=&persona=&q=&limit=   list
 *   GET    /contacts/{id}                                  contact + signals + drafts + activities
 *   POST   /contacts                                       {account, contact, signals[], messages[]} -> 201 | 200 existing
 *   PATCH  /contacts/{id}                                  update allowed fields
 *   POST   /contacts/{id}/activities                       {type, body?, occurred_at?} -> applies stage rules
 *   GET    /accounts                                       list
 *   GET    /due                                            due or overdue next actions
 *   GET    /meta                                           stages, activity types, personas, segments
 */
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

function out(int $code, $data): never
{
    http_response_code($code);
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
    exit;
}

$token = getenv('CRM_API_TOKEN') ?: '';
if ($token === '') {
    out(503, ['error' => 'API disabled: set CRM_API_TOKEN']);
}
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!hash_equals('Bearer ' . $token, $auth)) {
    out(401, ['error' => 'Missing or wrong bearer token']);
}

$method = $_SERVER['REQUEST_METHOD'];
$path = trim($_SERVER['PATH_INFO'] ?? (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: ''), '/');
$path = preg_replace('#^api\.php/?#', '', $path);
$seg = $path === '' ? [] : explode('/', $path);
$body = [];
if (in_array($method, ['POST', 'PATCH'], true)) {
    $raw = file_get_contents('php://input');
    $body = $raw === '' ? [] : json_decode($raw, true);
    if (!is_array($body)) {
        out(400, ['error' => 'Body must be a JSON object']);
    }
}

function contact_full(int $id): ?array
{
    $c = q('SELECT c.*, a.name AS account, a.domain AS account_domain FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = ?', [$id])->fetch();
    if (!$c) {
        return null;
    }
    $c['signals'] = q('SELECT id, signal_type, fact, quote, source_url, seen_at FROM signals WHERE contact_id = ? ORDER BY seen_at DESC', [$id])->fetchAll();
    $c['messages'] = q('SELECT id, channel, variant, body FROM messages WHERE contact_id = ? ORDER BY id', [$id])->fetchAll();
    $c['activities'] = q('SELECT id, type, body, occurred_at FROM activities WHERE contact_id = ? ORDER BY occurred_at DESC, id DESC', [$id])->fetchAll();
    return $c;
}

try {
    switch (true) {
        case $method === 'GET' && $seg === ['meta']:
            out(200, ['stages' => STAGES, 'activity_types' => ACTIVITY_TYPES, 'activity_rules' => ACTIVITY_RULES, 'personas' => PERSONAS, 'segments' => SEGMENTS, 'account_categories' => TRACKS, 'email_sources' => EMAIL_SOURCES]);

        case $method === 'GET' && $seg === ['contacts']:
            $where = ['1=1'];
            $p = [];
            foreach (['segment', 'stage', 'persona'] as $f) {
                if (!empty($_GET[$f])) {
                    $where[] = "c.$f = ?";
                    $p[] = $_GET[$f];
                }
            }
            if (!empty($_GET['q'])) {
                $where[] = '(c.full_name LIKE ? OR a.name LIKE ? OR c.title LIKE ?)';
                array_push($p, ...array_fill(0, 3, '%' . $_GET['q'] . '%'));
            }
            $limit = min(500, max(1, (int) ($_GET['limit'] ?? 100)));
            out(200, q('SELECT c.id, c.full_name, c.title, c.persona, c.segment, c.score, a.name AS account, c.stage, c.next_action, c.next_action_at,
                c.linkedin_url, c.profile_or_page_url, c.do_not_contact FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id
                WHERE ' . implode(' AND ', $where) . " ORDER BY c.id LIMIT $limit", $p)->fetchAll());

        case $method === 'GET' && count($seg) === 2 && $seg[0] === 'contacts':
            $c = contact_full((int) $seg[1]);
            $c ? out(200, $c) : out(404, ['error' => 'Contact not found']);

        case $method === 'POST' && $seg === ['contacts']:
            $r = create_contact_record($body);
            out($r['created'] ? 201 : 200, ['id' => $r['id'], 'created' => $r['created'], 'url' => '/?r=contact&id=' . $r['id']]);

        case $method === 'PATCH' && count($seg) === 2 && $seg[0] === 'contacts':
            $id = (int) $seg[1];
            if (!q('SELECT 1 FROM contacts WHERE id = ?', [$id])->fetchColumn()) {
                out(404, ['error' => 'Contact not found']);
            }
            $allowed = ['title', 'persona', 'linkedin_url', 'email', 'email_status', 'location', 'stage', 'next_action', 'next_action_at',
                'flag', 'notes', 'segment', 'score', 'tools', 'do_not_contact'];
            $set = array_intersect_key($body, array_flip($allowed));
            if (!$set) {
                out(400, ['error' => 'Nothing to update. Allowed: ' . implode(', ', $allowed)]);
            }
            if (isset($set['stage']) && !isset(STAGES[$set['stage']])) {
                out(400, ['error' => 'Unknown stage']);
            }
            if (isset($set['segment']) && !isset(SEGMENTS[$set['segment']])) {
                out(400, ['error' => 'Unknown segment']);
            }
            if (!empty($set['email']) && !in_array($set['email_status'] ?? '', EMAIL_SOURCES, true)) {
                out(400, ['error' => 'email needs email_status (' . implode(', ', EMAIL_SOURCES) . ')']);
            }
            $cols = implode(', ', array_map(fn ($k) => "$k = ?", array_keys($set)));
            q("UPDATE contacts SET $cols, updated_at = datetime('now') WHERE id = ?", [...array_values($set), $id]);
            out(200, contact_full($id));

        case $method === 'POST' && count($seg) === 3 && $seg[0] === 'contacts' && $seg[2] === 'activities':
            $type = $body['type'] ?? '';
            if (!isset(ACTIVITY_TYPES[$type])) {
                out(400, ['error' => 'type must be one of: ' . implode(', ', array_keys(ACTIVITY_TYPES))]);
            }
            apply_activity((int) $seg[1], $type, (string) ($body['body'] ?? ''), $body['occurred_at'] ?? date('Y-m-d H:i'));
            $c = contact_full((int) $seg[1]);
            out(201, ['stage' => $c['stage'], 'next_action' => $c['next_action'], 'next_action_at' => $c['next_action_at']]);

        case $method === 'GET' && $seg === ['accounts']:
            out(200, q('SELECT a.*, (SELECT COUNT(*) FROM contacts WHERE account_id = a.id) AS people FROM accounts a ORDER BY name')->fetchAll());

        case $method === 'GET' && $seg === ['due']:
            out(200, q('SELECT c.id, c.full_name, a.name AS account, c.next_action, c.next_action_at FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id
                WHERE c.do_not_contact = 0 AND c.next_action_at <= ? ORDER BY c.next_action_at', [today()])->fetchAll());

        default:
            out(404, ['error' => "No route for $method /$path"]);
    }
} catch (InvalidArgumentException $e) {
    out(422, ['error' => $e->getMessage()]);
} catch (RuntimeException $e) {
    out(404, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    if (db()->inTransaction()) {
        db()->rollBack();
    }
    out(500, ['error' => $e->getMessage()]);
}
