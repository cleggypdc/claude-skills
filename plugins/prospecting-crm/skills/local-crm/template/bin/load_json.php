<?php
// Load contacts from a JSON file (array of API-shaped records) without the web server.
//   php bin/load_json.php data/v2_contacts.json
// Same rules and de-duplication as POST /api.php/contacts; existing contacts are left untouched.
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

$file = $argv[1] ?? '';
$rows = is_file($file) ? json_decode(file_get_contents($file), true) : null;
if (!is_array($rows)) {
    fwrite(STDERR, "Usage: php bin/load_json.php path/to/contacts.json\n");
    exit(1);
}
$created = $existing = 0;
$pdo = db();
$pdo->beginTransaction();
try {
    foreach ($rows as $i => $r) {
        $res = create_contact_record($r);
        $res['created'] ? $created++ : $existing++;
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "Row $i failed, nothing loaded: {$e->getMessage()}\n");
    exit(1);
}
echo "created $created, already present $existing\n";
