<?php
// Quick terminal view: what's due today or overdue.  php bin/due.php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';
$rows = q("SELECT c.full_name, a.name account, c.next_action, c.next_action_at FROM contacts c LEFT JOIN accounts a ON a.id=c.account_id
           WHERE c.do_not_contact=0 AND c.next_action_at <= ? ORDER BY c.next_action_at", [today()])->fetchAll();
if (!$rows) { echo "Nothing due.\n"; exit; }
foreach ($rows as $r) {
    printf("%s  %-24s %-28s %s\n", $r['next_action_at'] < today() ? 'OVERDUE' : 'today  ', mb_strimwidth($r['full_name'], 0, 24), mb_strimwidth((string) $r['account'], 0, 28), $r['next_action']);
}
