#!/usr/bin/env sh
# Runs the CRM without Docker on http://localhost:8765 (localhost only). Needs PHP 8.2+ with pdo_sqlite.
cd "$(dirname "$0")"
if [ ! -f data/crm.db ] && [ -f data/seed.json ]; then
    php bin/load_json.php data/seed.json
fi
exec php -S 127.0.0.1:8765 -t public
