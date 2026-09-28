#!/bin/sh
set -e
# First run: create the DB and load data/seed.json if present (API-shaped records, see README).
if [ ! -f "$CRM_DB" ] && [ -f /app/data/seed.json ]; then
    echo "No CRM database yet - loading data/seed.json"
    php /app/bin/load_json.php /app/data/seed.json
fi
exec "$@"
