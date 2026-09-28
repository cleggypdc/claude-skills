<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

$r = $_GET['r'] ?? 'dashboard';
$a = $_POST['a'] ?? null;

// ---------- POST actions (post/redirect/get) ----------
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $a) {
    $back = $_POST['back'] ?? '?r=dashboard';
    try {
        switch ($a) {
            case 'log_activity':
                $type = $_POST['type'] ?? 'note';
                if (!isset(ACTIVITY_TYPES[$type])) {
                    throw new InvalidArgumentException('Unknown activity type');
                }
                $when = ($_POST['occurred_at'] ?? '') ?: date('Y-m-d H:i');
                apply_activity((int) $_POST['contact_id'], $type, trim($_POST['body'] ?? ''), str_replace('T', ' ', $when));
                flash('Logged: ' . ACTIVITY_TYPES[$type]);
                break;

            case 'update_contact':
                $stage = $_POST['stage'] ?? 'new';
                if (!isset(STAGES[$stage])) {
                    throw new InvalidArgumentException('Unknown stage');
                }
                $dnc = isset($_POST['do_not_contact']) ? 1 : 0;
                if (nn($_POST['email'] ?? '') && !in_array($_POST['email_status'] ?? '', EMAIL_SOURCES, true)) {
                    throw new InvalidArgumentException('Say where the email came from (never guessed)');
                }
                q("UPDATE contacts SET full_name=?, title=?, persona=?, email=?, email_status=?, linkedin_url=?, location=?, stage=?,
                    next_action=?, next_action_at=?, flag=?, notes=?, do_not_contact=?, segment=?, score=?, tools=?, updated_at=datetime('now') WHERE id=?", [
                    trim($_POST['full_name']), trim($_POST['title'] ?? ''), $_POST['persona'] ?? null,
                    nn($_POST['email'] ?? ''), nn($_POST['email_status'] ?? ''), nn($_POST['linkedin_url'] ?? ''), trim($_POST['location'] ?? ''),
                    $stage, $dnc ? null : nn($_POST['next_action'] ?? ''), $dnc ? null : nn($_POST['next_action_at'] ?? ''),
                    nn($_POST['flag'] ?? ''), trim($_POST['notes'] ?? ''), $dnc, nn($_POST['segment'] ?? ''),
                    ($_POST['score'] ?? '') === '' ? null : (int) $_POST['score'], nn($_POST['tools'] ?? ''), (int) $_POST['id'],
                ]);
                flash('Contact saved');
                break;

            case 'create_contact':
                $sig = trim($_POST['signal_fact'] ?? '') !== '' ? [[
                    'signal_type' => $_POST['signal_type'] ?? 'post', 'fact' => trim($_POST['signal_fact']), 'quote' => nn($_POST['signal_quote'] ?? ''),
                    'source_url' => trim($_POST['signal_url'] ?? ''), 'seen_at' => nn($_POST['signal_date'] ?? '') ?? today(),
                ]] : [];
                $res = create_contact_record(['contact' => [
                    'account_id' => (int) $_POST['account_id'], 'full_name' => $_POST['full_name'] ?? '', 'title' => nn($_POST['title'] ?? ''),
                    'persona' => $_POST['persona'] ?? 'other', 'profile_or_page_url' => nn($_POST['profile_or_page_url'] ?? ''),
                    'linkedin_url' => nn($_POST['linkedin_url'] ?? ''), 'email' => nn($_POST['email'] ?? ''), 'email_status' => nn($_POST['email_status'] ?? ''),
                    'location' => nn($_POST['location'] ?? ''), 'notes' => nn($_POST['notes'] ?? ''), 'segment' => $_POST['segment'] ?? DEFAULT_SEGMENT,
                    'tools' => nn($_POST['tools'] ?? ''),
                ], 'signals' => $sig]);
                flash($res['created'] ? 'Contact added' : 'Already in the CRM - opened the existing record');
                $back = '?r=contact&id=' . $res['id'];
                break;

            case 'save_account':
                $vals = [trim($_POST['name']), nn($_POST['domain'] ?? ''), $_POST['track'] ?? 'other', trim($_POST['geo'] ?? ''),
                    trim($_POST['employees_est'] ?? ''), (int) ($_POST['score'] ?? 3), trim($_POST['why'] ?? ''), trim($_POST['notes'] ?? '')];
                if (!empty($_POST['id'])) {
                    q("UPDATE accounts SET name=?, domain=?, track=?, geo=?, employees_est=?, score=?, why=?, notes=?, updated_at=datetime('now') WHERE id=?",
                        [...$vals, (int) $_POST['id']]);
                    $back = '?r=account&id=' . (int) $_POST['id'];
                } else {
                    q('INSERT INTO accounts (name, domain, track, geo, employees_est, score, why, notes) VALUES (?,?,?,?,?,?,?,?)', $vals);
                    $back = '?r=account&id=' . db()->lastInsertId();
                }
                flash('Account saved');
                break;

            case 'delete_activity':
                q('DELETE FROM activities WHERE id = ?', [(int) $_POST['id']]);
                flash('Activity deleted (stage and next action left as they were)');
                break;
        }
    } catch (Throwable $e) {
        if (db()->inTransaction()) {
            db()->rollBack();
        }
        flash('Error: ' . $e->getMessage());
    }
    header('Location: ' . $back);
    exit;
}

// ---------- CSV export ----------
if ($r === 'export') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="crm-contacts-' . today() . '.csv"');
    $out = fopen('php://output', 'w');
    $rows = q('SELECT a.name AS account, a.track, a.geo, a.score AS account_score, c.full_name, c.title, c.persona, c.email, c.linkedin_url, c.profile_or_page_url,
        c.segment, c.score AS person_score, c.tools, c.stage, c.next_action, c.next_action_at, c.do_not_contact, c.flag,
        (SELECT MAX(occurred_at) FROM activities WHERE contact_id = c.id) AS last_activity
        FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id ORDER BY a.name, c.full_name')->fetchAll();
    fputcsv($out, array_keys($rows[0] ?? ['empty' => '']), escape: '');
    foreach ($rows as $row) {
        fputcsv($out, $row, escape: '');
    }
    exit;
}

// ---------- helpers ----------
function nn(string $s): ?string
{
    $s = trim($s);
    return $s === '' ? null : $s;
}

function flash(?string $msg = null): ?string
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
    if ($msg !== null) {
        $_SESSION['flash'] = $msg;
        return null;
    }
    $m = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $m;
}

function stage_badge(string $s): string
{
    return '<span class="badge st-' . h($s) . '">' . h(STAGES[$s] ?? $s) . '</span>';
}

function due_class(?string $d): string
{
    if (!$d) {
        return '';
    }
    return $d < today() ? 'overdue' : ($d === today() ? 'due' : '');
}

function options(array $opts, ?string $sel, bool $assoc = true): string
{
    $html = '';
    foreach ($opts as $k => $v) {
        $key = $assoc ? $k : $v;
        $html .= '<option value="' . h((string) $key) . '"' . ((string) $key === (string) $sel ? ' selected' : '') . '>' . h((string) $v) . '</option>';
    }
    return $html;
}

function link_out(?string $url, string $label = 'link'): string
{
    return $url ? '<a href="' . h($url) . '" target="_blank" rel="noopener">' . h($label) . ' ↗</a>' : '';
}

function layout(string $title, string $body): void
{
    $flash = flash();
    $nav = ['dashboard' => 'Today', 'contacts' => 'Contacts', 'accounts' => 'Accounts', 'new_contact' => '+ Contact', 'account_form' => '+ Account'];
    $r = $_GET['r'] ?? 'dashboard';
    echo '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    echo '<title>' . h($title) . ' · ' . h(APP_NAME) . '</title><link rel="stylesheet" href="style.css"></head><body><header><strong>' . h(APP_NAME) . '</strong><nav>';
    foreach ($nav as $k => $v) {
        echo '<a href="?r=' . $k . '"' . ($r === $k ? ' class="on"' : '') . '>' . $v . '</a>';
    }
    echo '<a href="?r=export">Export CSV</a></nav></header><main>';
    if ($flash) {
        echo '<div class="flash">' . h($flash) . '</div>';
    }
    echo $body . '</main><script src="app.js"></script></body></html>';
}

// ---------- views ----------
ob_start();
switch ($r) {
    case 'dashboard':
        $title = 'Today';
        $counts = q('SELECT stage, COUNT(*) n FROM contacts GROUP BY stage')->fetchAll(PDO::FETCH_KEY_PAIR);
        echo '<h1>Today</h1><div class="stages">';
        foreach (STAGES as $k => $v) {
            echo '<a class="stage-tile" href="?r=contacts&stage=' . $k . '"><span>' . h($v) . '</span><b>' . (int) ($counts[$k] ?? 0) . '</b></a>';
        }
        echo '</div>';

        $due = q("SELECT c.*, a.name account FROM contacts c LEFT JOIN accounts a ON a.id=c.account_id
                  WHERE c.do_not_contact=0 AND c.next_action_at IS NOT NULL AND c.next_action_at <= ? ORDER BY c.next_action_at", [today()])->fetchAll();
        echo '<h2>Due and overdue (' . count($due) . ')</h2>';
        echo contact_table($due, true);

        $week = q("SELECT c.*, a.name account FROM contacts c LEFT JOIN accounts a ON a.id=c.account_id
                   WHERE c.do_not_contact=0 AND c.next_action_at > ? AND c.next_action_at <= ? ORDER BY c.next_action_at", [today(), plus_days(7)])->fetchAll();
        echo '<h2>Next 7 days (' . count($week) . ')</h2>' . contact_table($week, true);

        // Reply rate by track and persona: of contacts touched, how many replied or further.
        $rates = q("SELECT c.segment, c.persona,
                SUM(CASE WHEN c.stage NOT IN ('new','queued') THEN 1 ELSE 0 END) touched,
                SUM(CASE WHEN c.stage IN ('replied','meeting','opportunity','customer') THEN 1 ELSE 0 END) replied,
                SUM(CASE WHEN c.stage IN ('meeting','opportunity','customer') THEN 1 ELSE 0 END) meetings
            FROM contacts c GROUP BY c.segment, c.persona HAVING touched > 0 ORDER BY c.segment, c.persona")->fetchAll();
        echo '<h2>What is working</h2>';
        if (!$rates) {
            echo '<p class="muted">Nothing sent yet. Log a LinkedIn connect or email on a contact to start the numbers.</p>';
        } else {
            echo '<table><tr><th>Segment</th><th>Persona</th><th>Touched</th><th>Replied</th><th>Reply rate</th><th>Meetings</th></tr>';
            foreach ($rates as $x) {
                echo '<tr><td>' . h(SEGMENTS[$x['segment']] ?? (string) $x['segment']) . '</td><td>' . h($x['persona']) . '</td><td>' . $x['touched'] . '</td><td>' . $x['replied'] . '</td><td>'
                    . round(100 * $x['replied'] / $x['touched']) . '%</td><td>' . $x['meetings'] . '</td></tr>';
            }
            echo '</table>';
        }

        $recent = q('SELECT ac.*, c.full_name, a.name account FROM activities ac JOIN contacts c ON c.id=ac.contact_id
                     LEFT JOIN accounts a ON a.id=c.account_id ORDER BY ac.occurred_at DESC, ac.id DESC LIMIT 15')->fetchAll();
        echo '<h2>Recent activity</h2>';
        if (!$recent) {
            echo '<p class="muted">No activity yet.</p>';
        }
        echo '<ul class="feed">';
        foreach ($recent as $x) {
            echo '<li><span class="muted">' . h(substr($x['occurred_at'], 0, 16)) . '</span> <a href="?r=contact&id=' . $x['contact_id'] . '">' . h($x['full_name'])
                . '</a> (' . h($x['account']) . ') · ' . h(ACTIVITY_TYPES[$x['type']] ?? $x['type']) . ($x['body'] ? ' · <span class="muted">' . h(mb_strimwidth($x['body'], 0, 90, '…')) . '</span>' : '') . '</li>';
        }
        echo '</ul>';
        break;

    case 'contacts':
        $title = 'Contacts';
        $where = ['1=1'];
        $p = [];
        foreach (['stage' => 'c.stage', 'track' => 'a.track', 'persona' => 'c.persona', 'segment' => 'c.segment'] as $k => $col) {
            if (!empty($_GET[$k])) {
                $where[] = "$col = ?";
                $p[] = $_GET[$k];
            }
        }
        if (!empty($_GET['q'])) {
            $where[] = '(c.full_name LIKE ? OR a.name LIKE ? OR c.title LIKE ? OR c.notes LIKE ?)';
            array_push($p, ...array_fill(0, 4, '%' . $_GET['q'] . '%'));
        }
        if (!empty($_GET['flagged'])) {
            $where[] = "c.flag IS NOT NULL AND c.flag <> ''";
        }
        if (empty($_GET['show_dnc'])) {
            $where[] = 'c.do_not_contact = 0';
        }
        $rows = q('SELECT c.*, a.name account, a.track, a.score AS account_score FROM contacts c LEFT JOIN accounts a ON a.id=c.account_id WHERE ' . implode(' AND ', $where)
            . ' ORDER BY COALESCE(c.score, a.score) DESC, a.name, c.full_name', $p)->fetchAll();
        echo '<h1>Contacts <span class="muted">(' . count($rows) . ')</span></h1>';
        echo '<form class="filters" method="get"><input type="hidden" name="r" value="contacts">'
            . '<input name="q" placeholder="Search name, company, title, notes" value="' . h($_GET['q'] ?? '') . '">'
            . '<select name="stage"><option value="">Any stage</option>' . options(STAGES, $_GET['stage'] ?? '') . '</select>'
            . '<select name="segment"><option value="">Any segment</option>' . options(SEGMENTS, $_GET['segment'] ?? '') . '</select>'
            . '<select name="track"><option value="">Any track</option>' . options(TRACKS, $_GET['track'] ?? '', false) . '</select>'
            . '<select name="persona"><option value="">Any persona</option>' . options(PERSONAS, $_GET['persona'] ?? '', false) . '</select>'
            . '<label><input type="checkbox" name="flagged" value="1"' . (!empty($_GET['flagged']) ? ' checked' : '') . '> Flagged</label>'
            . '<label><input type="checkbox" name="show_dnc" value="1"' . (!empty($_GET['show_dnc']) ? ' checked' : '') . '> Include do-not-contact</label>'
            . '<button>Filter</button> <a href="?r=contacts">Reset</a></form>';
        echo contact_table($rows, false);
        break;

    case 'contact':
        $c = q('SELECT c.*, a.name account, a.track, a.geo, a.score AS account_score, a.why, a.domain FROM contacts c LEFT JOIN accounts a ON a.id=c.account_id WHERE c.id=?', [(int) ($_GET['id'] ?? 0)])->fetch();
        if (!$c) {
            http_response_code(404);
            $title = 'Not found';
            echo '<p>Contact not found.</p>';
            break;
        }
        $title = $c['full_name'];
        $self = '?r=contact&id=' . $c['id'];
        echo '<p class="muted"><a href="?r=account&id=' . $c['account_id'] . '">' . h($c['account']) . '</a> · ' . h($c['track']) . ' · ' . h($c['geo']) . ($c['account_score'] ? ' · account score ' . (int) $c['account_score'] : '') . '</p>';
        echo '<h1>' . h($c['full_name']) . ' ' . stage_badge($c['stage']) . ($c['do_not_contact'] ? ' <span class="badge dnc">Do not contact</span>' : '') . '</h1>';
        echo '<p>' . h($c['title']) . ' · ' . h($c['persona']) . ' · ' . h(SEGMENTS[$c['segment']] ?? (string) $c['segment']) . ($c['score'] ? ' · person score ' . (int) $c['score'] : '') . ' · ' . link_out($c['profile_or_page_url'], 'source') . ' ' . link_out($c['linkedin_url'], 'LinkedIn')
            . ($c['email'] ? ' · <a href="mailto:' . h($c['email']) . '">' . h($c['email']) . '</a>' : ' · <span class="muted">no email</span>') . '</p>';
        if ($c['tools']) {
            echo '<p class="muted">Tools: ' . h($c['tools']) . '</p>';
        }
        if ($c['flag']) {
            echo '<p class="flagline">⚑ ' . h($c['flag']) . '</p>';
        }
        if ($c['next_action']) {
            echo '<p class="next ' . due_class($c['next_action_at']) . '">Next: <b>' . h($c['next_action']) . '</b> · ' . h($c['next_action_at']) . '</p>';
        }

        echo '<div class="cols"><section>';
        // Log activity
        echo '<h2>Log activity</h2><form method="post" class="stack"><input type="hidden" name="a" value="log_activity"><input type="hidden" name="contact_id" value="' . $c['id'] . '">'
            . '<input type="hidden" name="back" value="' . h($self) . '"><div class="row"><select name="type">' . options(ACTIVITY_TYPES, 'note') . '</select>'
            . '<input type="datetime-local" name="occurred_at" value="' . date('Y-m-d\TH:i') . '"></div>'
            . '<textarea name="body" rows="3" placeholder="What was said or sent (optional)"></textarea><button>Log</button></form>';

        // Signals
        echo '<h2>Signals</h2>';
        foreach (q('SELECT * FROM signals WHERE contact_id=? ORDER BY seen_at DESC', [$c['id']]) as $s) {
            echo '<div class="card"><span class="muted">' . h($s['seen_at']) . ' · ' . h($s['signal_type']) . '</span><p>' . h($s['fact']) . '</p>' . ($s['quote'] ? '<blockquote>' . h($s['quote']) . '</blockquote>' : '') . link_out($s['source_url'], 'source') . '</div>';
        }

        // Drafts
        $msgs = q('SELECT * FROM messages WHERE contact_id=? ORDER BY id', [$c['id']])->fetchAll();
        if ($msgs) {
            echo '<h2>Drafts</h2>';
            foreach ($msgs as $m) {
                echo '<div class="card"><div class="cardhead"><span class="muted">' . h($m['channel']) . ' / ' . h($m['variant'])
                    . ($m['channel'] === 'linkedin' ? ' · ' . mb_strlen($m['body']) . ' chars' : '') . '</span><button type="button" class="copy">Copy</button></div><pre>' . h($m['body']) . '</pre></div>';
            }
        }

        // Timeline
        echo '<h2>Timeline</h2>';
        $acts = q('SELECT * FROM activities WHERE contact_id=? ORDER BY occurred_at DESC, id DESC', [$c['id']])->fetchAll();
        if (!$acts) {
            echo '<p class="muted">Nothing logged yet.</p>';
        }
        echo '<ul class="feed">';
        foreach ($acts as $x) {
            echo '<li><span class="muted">' . h(substr($x['occurred_at'], 0, 16)) . '</span> <b>' . h(ACTIVITY_TYPES[$x['type']] ?? $x['type']) . '</b>'
                . ($x['body'] ? '<div class="pre">' . h($x['body']) . '</div>' : '')
                . '<form method="post" class="inline" onsubmit="return confirm(\'Delete this activity?\')"><input type="hidden" name="a" value="delete_activity"><input type="hidden" name="id" value="' . $x['id'] . '"><input type="hidden" name="back" value="' . h($self) . '"><button class="link">delete</button></form></li>';
        }
        echo '</ul></section><aside>';

        // Edit
        echo '<h2>Details</h2><form method="post" class="stack"><input type="hidden" name="a" value="update_contact"><input type="hidden" name="id" value="' . $c['id'] . '"><input type="hidden" name="back" value="' . h($self) . '">'
            . '<label>Name<input name="full_name" required value="' . h($c['full_name']) . '"></label>'
            . '<label>Title<input name="title" value="' . h($c['title']) . '"></label>'
            . '<label>Persona<select name="persona">' . options(PERSONAS, $c['persona'], false) . '</select></label>'
            . '<label>Segment<select name="segment">' . options(SEGMENTS, $c['segment']) . '</select></label>'
            . '<label>Person score (1-5)<input type="number" min="1" max="5" name="score" value="' . h((string) $c['score']) . '"></label>'
            . '<label>Tools they use<input name="tools" value="' . h($c['tools']) . '"></label>'
            . '<label>Stage<select name="stage">' . options(STAGES, $c['stage']) . '</select></label>'
            . '<label>Next action<input name="next_action" value="' . h($c['next_action']) . '"></label>'
            . '<label>Next action date<input type="date" name="next_action_at" value="' . h($c['next_action_at']) . '"></label>'
            . '<label>Email<input type="email" name="email" value="' . h($c['email']) . '"></label>'
            . '<label>Email source<select name="email_status"><option value="">-</option>' . options(EMAIL_SOURCES, $c['email_status'], false) . '</select></label>'
            . '<label>LinkedIn URL<input name="linkedin_url" value="' . h($c['linkedin_url']) . '"></label>'
            . '<label>Location<input name="location" value="' . h($c['location']) . '"></label>'
            . '<label>Flag<input name="flag" value="' . h($c['flag']) . '" placeholder="Anything to check before sending"></label>'
            . '<label>Notes<textarea name="notes" rows="5">' . h($c['notes']) . '</textarea></label>'
            . '<label class="check"><input type="checkbox" name="do_not_contact" value="1"' . ($c['do_not_contact'] ? ' checked' : '') . '> Do not contact</label>'
            . '<button>Save</button></form></aside></div>';
        break;

    case 'accounts':
        $title = 'Accounts';
        $rows = q("SELECT a.*, COUNT(c.id) people,
            SUM(CASE WHEN c.stage IN ('replied','meeting','opportunity','customer') THEN 1 ELSE 0 END) engaged
            FROM accounts a LEFT JOIN contacts c ON c.account_id=a.id GROUP BY a.id ORDER BY a.score DESC, a.name")->fetchAll();
        echo '<h1>Accounts <span class="muted">(' . count($rows) . ')</span></h1><table><tr><th>Account</th><th>Track</th><th>Geo</th><th>Score</th><th>People</th><th>Engaged</th></tr>';
        foreach ($rows as $x) {
            echo '<tr><td><a href="?r=account&id=' . $x['id'] . '">' . h($x['name']) . '</a></td><td>' . h($x['track']) . '</td><td>' . h($x['geo']) . '</td><td>' . h((string) $x['score'])
                . '</td><td>' . $x['people'] . '</td><td>' . (int) $x['engaged'] . '</td></tr>';
        }
        echo '</table>';
        break;

    case 'account':
        $acc = q('SELECT * FROM accounts WHERE id=?', [(int) ($_GET['id'] ?? 0)])->fetch();
        if (!$acc) {
            $title = 'Not found';
            echo '<p>Account not found.</p>';
            break;
        }
        $title = $acc['name'];
        echo '<h1>' . h($acc['name']) . ' <span class="muted">score ' . h((string) $acc['score']) . '</span></h1>';
        echo '<p class="muted">' . h($acc['track']) . ' · ' . h($acc['geo']) . ' · ' . h($acc['employees_est']) . ' · ' . link_out($acc['domain'] ? 'https://' . $acc['domain'] : null, $acc['domain'] ?? '') . ' · <a href="?r=account_form&id=' . $acc['id'] . '">edit</a></p>';
        echo '<p>' . h($acc['why']) . '</p>';
        if ($acc['notes']) {
            echo '<div class="card pre">' . h($acc['notes']) . '</div>';
        }
        $srcs = json_decode((string) $acc['source_urls'], true) ?: [];
        if ($srcs) {
            echo '<p class="muted">Sources: ';
            foreach ($srcs as $i => $u) {
                echo link_out($u, (string) ($i + 1)) . ' ';
            }
            echo '</p>';
        }
        echo '<h2>People</h2>' . contact_table(q('SELECT c.*, ? account FROM contacts c WHERE account_id=? ORDER BY full_name', [$acc['name'], $acc['id']])->fetchAll(), false);
        echo '<p><a href="?r=new_contact&account_id=' . $acc['id'] . '">+ Add a person at ' . h($acc['name']) . '</a></p>';
        break;

    case 'account_form':
        $acc = !empty($_GET['id']) ? q('SELECT * FROM accounts WHERE id=?', [(int) $_GET['id']])->fetch() : null;
        $acc = $acc ?: ['id' => '', 'name' => '', 'domain' => '', 'track' => TRACKS[0], 'geo' => '', 'employees_est' => '', 'score' => 4, 'why' => '', 'notes' => ''];
        $title = $acc['id'] ? 'Edit ' . $acc['name'] : 'New account';
        echo '<h1>' . h($title) . '</h1><form method="post" class="stack narrow"><input type="hidden" name="a" value="save_account"><input type="hidden" name="id" value="' . h((string) $acc['id']) . '">'
            . '<label>Name<input name="name" required value="' . h($acc['name']) . '"></label>'
            . '<label>Domain<input name="domain" placeholder="example.com" value="' . h($acc['domain']) . '"></label>'
            . '<label>Track<select name="track">' . options(TRACKS, $acc['track'], false) . '</select></label>'
            . '<label>Geo<input name="geo" value="' . h($acc['geo']) . '"></label>'
            . '<label>Employees (est.)<input name="employees_est" value="' . h($acc['employees_est']) . '"></label>'
            . '<label>Score (1-5)<input type="number" min="1" max="5" name="score" value="' . h((string) $acc['score']) . '"></label>'
            . '<label>Why<textarea name="why" rows="3">' . h($acc['why']) . '</textarea></label>'
            . '<label>Notes<textarea name="notes" rows="4">' . h($acc['notes']) . '</textarea></label><button>Save</button></form>';
        break;

    case 'new_contact':
        $title = 'New contact';
        $accs = q('SELECT id, name FROM accounts ORDER BY name')->fetchAll(PDO::FETCH_KEY_PAIR);
        if (!$accs) {
            echo '<p>Add an account first: <a href="?r=account_form">new account</a>.</p>';
            break;
        }
        echo '<h1>New contact</h1><form method="post" class="stack narrow"><input type="hidden" name="a" value="create_contact">'
            . '<label>Account<select name="account_id">' . options($accs, $_GET['account_id'] ?? '') . '</select></label>'
            . '<label>Full name<input name="full_name" required></label><label>Title<input name="title"></label>'
            . '<label>Segment<select name="segment">' . options(SEGMENTS, DEFAULT_SEGMENT) . '</select></label>'
            . '<label>Persona<select name="persona">' . options(PERSONAS, 'pm', false) . '</select></label>'
            . '<label>Tools they use<input name="tools" placeholder="Claude Projects, MCP (Notion), Copilot"></label>'
            . '<label>Source URL (where you found them)<input name="profile_or_page_url"' . (REQUIRE_SOURCE_URL ? ' required' : '') . '></label>'
            . '<label>LinkedIn URL<input name="linkedin_url"></label><label>Email (only if found, never guessed)<input type="email" name="email"></label><label>Email source<select name="email_status"><option value="">-</option>' . options(EMAIL_SOURCES, null, false) . '</select></label>'
            . '<label>Location<input name="location"></label>'
            . '<fieldset><legend>Signal (optional)</legend><label>Type<select name="signal_type">' . options(['post', 'article', 'talk', 'repo', 'podcast', 'hire', 'job_post', 'news', 'team_page'], 'post', false) . '</select></label>'
            . '<label>Fact (one checkable sentence)<textarea name="signal_fact" rows="2"></textarea></label><label>Their words (verbatim, optional)<input name="signal_quote"></label><label>Source URL<input name="signal_url"></label><label>Date<input type="date" name="signal_date"></label></fieldset>'
            . '<label>Notes<textarea name="notes" rows="3"></textarea></label><button>Add contact</button></form>';
        break;

    default:
        http_response_code(404);
        $title = 'Not found';
        echo '<p>Page not found.</p>';
}
$body = ob_get_clean();
layout($title ?? 'CRM', $body);

function contact_table(array $rows, bool $showNext): string
{
    if (!$rows) {
        return '<p class="muted">None.</p>';
    }
    $html = '<table><tr><th>Name</th><th>Account</th><th>Title</th><th>Stage</th><th>Next action</th><th></th></tr>';
    foreach ($rows as $c) {
        $html .= '<tr><td><a href="?r=contact&id=' . $c['id'] . '">' . h($c['full_name']) . '</a>' . ($c['do_not_contact'] ? ' <span class="badge dnc">DNC</span>' : '') . '</td>'
            . '<td>' . h($c['account'] ?? '') . '</td><td class="muted">' . h(mb_strimwidth((string) $c['title'], 0, 48, '…')) . '</td><td>' . stage_badge($c['stage']) . '</td>'
            . '<td class="' . due_class($c['next_action_at']) . '">' . ($c['next_action'] ? h($c['next_action']) . ' · ' . h($c['next_action_at']) : '<span class="muted">-</span>') . '</td>'
            . '<td>' . ($c['flag'] ? '<span title="' . h($c['flag']) . '">⚑</span>' : '') . '</td></tr>';
    }
    return $html . '</table>';
}
