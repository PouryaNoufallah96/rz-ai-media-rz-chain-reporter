#!/bin/sh
set -eu

: "${MIGRATION_ROLE:?set MIGRATION_ROLE}"
: "${MIGRATION_PASSWORD:?set MIGRATION_PASSWORD}"
: "${APP_ROLE:?set APP_ROLE}"
: "${APP_PASSWORD:?set APP_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v migration_role="$MIGRATION_ROLE" -v migration_password="$MIGRATION_PASSWORD" \
  -v app_role="$APP_ROLE" -v app_password="$APP_PASSWORD" <<'SQL'
CREATE ROLE :"migration_role" LOGIN PASSWORD :'migration_password';
CREATE ROLE :"app_role" LOGIN PASSWORD :'app_password';

ALTER DATABASE :"db" OWNER TO :"migration_role";
ALTER SCHEMA public OWNER TO :"migration_role";

REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE :"db" TO :"migration_role";
GRANT CONNECT ON DATABASE :"db" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";

ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";
SQL
