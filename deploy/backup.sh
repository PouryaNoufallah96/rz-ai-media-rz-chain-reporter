#!/usr/bin/env bash
set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly COMPOSE_FILE="$ROOT/deploy/compose.production.yml"

fail() {
  echo "backup failed [$1]: $2" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
usage: backup.sh create <config>
       backup.sh rehearse <staging-directory> <config>

Every command requires the exact instance config. There is no default project,
app root, or environment directory.
USAGE
  exit 64
}

load_config() {
  local config="$1" name
  [ -f "$config" ] || fail MISSING_CONFIG "no deployment config at $config"
  set -a
  # shellcheck disable=SC1090
  . "$config"
  set +a
  for name in COMPOSE_PROJECT_NAME APP_ROOT APP_VERSION CUSTOMER_TEMPLATE_KEY ENV_DIR; do
    [ -n "${!name:-}" ] || fail MISSING_CONFIG_VALUE "$name is not set in $config"
  done
  printf '%s' "$COMPOSE_PROJECT_NAME" | grep -Eq '^[a-z0-9][a-z0-9_-]*$' \
    || fail INVALID_PROJECT_NAME "COMPOSE_PROJECT_NAME is not usable"
  case "$ENV_DIR" in
    /*) ;;
    *) ENV_DIR="$ROOT/deploy/${ENV_DIR#./}" ;;
  esac
  export COMPOSE_PROJECT_NAME ENV_DIR
}

compose() {
  docker compose --project-name "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" \
    --project-directory "$ROOT/deploy" --env-file "$CONFIG_FILE" "$@"
}

require_running_data_services() {
  local service
  for service in postgres minio; do
    [ -n "$(compose ps -q --status running "$service")" ] \
      || fail SERVICE_NOT_RUNNING "$COMPOSE_PROJECT_NAME service $service is not running"
  done
}

running_writers() {
  compose ps --services --status running | grep -E '^(web|worker)$' || true
}

create() {
  require_running_data_services
  local staging="$APP_ROOT/backups/$(date -u +%Y%m%dT%H%M%SZ)"
  local resume
  resume="$(running_writers)"

  install -d -o root -g root -m 700 "$APP_ROOT/backups" "$staging"

  restore_writers() {
    [ -n "$resume" ] || return 0
    # shellcheck disable=SC2086
    compose start $resume
  }
  trap restore_writers EXIT

  if [ -n "$resume" ]; then
    # shellcheck disable=SC2086
    compose stop $resume
  fi

  local database_user database_name
  database_user="$(sed -n 's/^MIGRATION_ROLE=//p' "$ENV_DIR/postgres.env" | head -n 1)"
  database_name="$(sed -n 's/^POSTGRES_DB=//p' "$ENV_DIR/postgres.env" | head -n 1)"
  [ -n "$database_user" ] && [ -n "$database_name" ] \
    || fail MISSING_ENV_KEY "postgres.env must define MIGRATION_ROLE and POSTGRES_DB"

  compose exec -T postgres pg_dump --format=custom --no-owner \
    --username "$database_user" --dbname "$database_name" > "$staging/database.dump"
  [ -s "$staging/database.dump" ] || fail EMPTY_DATABASE_DUMP "database dump is empty"

  local bucket
  bucket="$(sed -n 's/^S3_BUCKET=//p' "$ENV_DIR/minio.env" | head -n 1)"
  [ -n "$bucket" ] || fail MISSING_ENV_KEY "minio.env must define S3_BUCKET"
  install -d -m 700 "$staging/objects"
  compose run --rm --entrypoint /bin/sh -v "$staging/objects:/mirror" minio-init -c \
    "mc alias set platform http://minio:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" && mc mirror --overwrite \"platform/$bucket\" /mirror"

  printf '{"composeProjectName":"%s","appVersion":"%s","customerTemplateKey":"%s","bucket":"%s","createdAt":"%s"}\n' \
    "$COMPOSE_PROJECT_NAME" "$APP_VERSION" "$CUSTOMER_TEMPLATE_KEY" "$bucket" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$staging/release.json"

  (cd "$staging" && find . -type f ! -name manifest.sha256 -print0 \
    | sort -z | xargs -0 sha256sum > manifest.sha256)
  (cd "$staging" && sha256sum --check --quiet manifest.sha256) \
    || fail MANIFEST_MISMATCH "manifest verification failed for $staging"

  chmod -R go-rwx "$staging"
  echo "backup $staging"
}

rehearse() {
  local staging="$1"
  [ -d "$staging" ] || fail MISSING_BACKUP "no backup directory at $staging"
  [ -f "$staging/manifest.sha256" ] && [ -f "$staging/release.json" ] \
    && [ -s "$staging/database.dump" ] \
    || fail INCOMPLETE_BACKUP "$staging is not a complete backup"
  (cd "$staging" && sha256sum --check --quiet manifest.sha256) \
    || fail MANIFEST_MISMATCH "manifest verification failed for $staging"
  grep -Fq "\"composeProjectName\":\"$COMPOSE_PROJECT_NAME\"" "$staging/release.json" \
    || fail INSTANCE_MISMATCH "backup was not created for $COMPOSE_PROJECT_NAME"
  grep -Fq "\"customerTemplateKey\":\"$CUSTOMER_TEMPLATE_KEY\"" "$staging/release.json" \
    || fail INSTANCE_MISMATCH "backup does not carry template $CUSTOMER_TEMPLATE_KEY"

  local project="${COMPOSE_PROJECT_NAME}-rehearsal-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  local restored_directory verification_directory
  restored_directory="$(mktemp -d)"
  verification_directory="$(mktemp -d)"
  local database_user database_name bucket
  database_user="$(sed -n 's/^MIGRATION_ROLE=//p' "$ENV_DIR/postgres.env" | head -n 1)"
  database_name="$(sed -n 's/^POSTGRES_DB=//p' "$ENV_DIR/postgres.env" | head -n 1)"
  bucket="$(sed -n 's/^S3_BUCKET=//p' "$ENV_DIR/minio.env" | head -n 1)"
  [ -n "$database_user" ] && [ -n "$database_name" ] && [ -n "$bucket" ] \
    || fail MISSING_ENV_KEY "rehearsal database and bucket settings are incomplete"
  grep -Fq "\"bucket\":\"$bucket\"" "$staging/release.json" \
    || fail INSTANCE_MISMATCH "backup bucket does not match this instance"

  rehearsal() {
    docker compose --project-name "$project" -f "$ROOT/deploy/compose.rehearsal.yml" \
      --project-directory "$ROOT/deploy" --env-file "$CONFIG_FILE" "$@"
  }

  drop_rehearsal() {
    rehearsal down --volumes --remove-orphans >/dev/null 2>&1 || true
    rm -rf -- "$restored_directory"
    rm -rf -- "$verification_directory"
  }
  trap drop_rehearsal EXIT

  rehearsal up -d --wait postgres minio
  rehearsal exec -T postgres pg_restore --no-owner --username "$database_user" \
    --dbname "$database_name" < "$staging/database.dump"

  local restored_tables
  restored_tables="$(rehearsal exec -T postgres psql --username "$database_user" --dbname "$database_name" \
    -t -A -c "select count(*) from information_schema.tables where table_schema = 'public';" | tr -d '\r')"
  [ "$restored_tables" -gt 0 ] || fail RESTORE_EMPTY "restored database has no public tables"

  rehearsal run --rm --entrypoint /bin/sh -v "$staging/objects:/mirror:ro" minio-init -c \
    "mc alias set rehearsal http://minio:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" && mc mb --ignore-existing \"rehearsal/$bucket\" && mc mirror --overwrite /mirror \"rehearsal/$bucket\""

  local expected restored
  expected="$(find "$staging/objects" -type f | wc -l | tr -d ' ')"
  restored="$(rehearsal run --rm --entrypoint /bin/sh minio-init -c \
    "mc alias set rehearsal http://minio:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" >/dev/null && mc ls --recursive \"rehearsal/$bucket\" | wc -l" | tr -d ' \r')"
  [ "$expected" = "$restored" ] \
    || fail OBJECT_COUNT_MISMATCH "expected $expected objects, restored $restored"

  rehearsal run --rm --entrypoint /bin/sh -v "$restored_directory:/restored" minio-init -c \
    "mc alias set rehearsal http://minio:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" >/dev/null && mc mirror --overwrite \"rehearsal/$bucket\" /restored"

  local expected_hashes restored_hashes
  expected_hashes="$verification_directory/expected.sha256"
  restored_hashes="$verification_directory/restored.sha256"
  (cd "$staging/objects" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum) > "$expected_hashes"
  (cd "$restored_directory" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum) > "$restored_hashes"
  cmp -s "$expected_hashes" "$restored_hashes" \
    || fail OBJECT_CONTENT_MISMATCH "restored object paths or bytes differ from the backup"

  echo "rehearsal restored $restored_tables tables and byte-verified $restored objects from $staging"
  echo "rehearsal project $project is removed by the exit trap"
}

command="${1:-}"
[ -n "$command" ] || usage
shift

staging_directory=""
case "$command" in
  create) ;;
  rehearse)
    staging_directory="${1:-}"
    [ -n "$staging_directory" ] || usage
    shift
    ;;
  *) usage ;;
esac

CONFIG_FILE="${1:-}"
[ -n "$CONFIG_FILE" ] || usage
[ "$#" -eq 1 ] || usage
load_config "$CONFIG_FILE"

case "$command" in
  create) create ;;
  rehearse) rehearse "$staging_directory" ;;
esac
