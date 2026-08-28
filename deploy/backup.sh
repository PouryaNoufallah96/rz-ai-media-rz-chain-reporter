#!/usr/bin/env bash
set -euo pipefail

readonly PROJECT="chainreporter-platform"
readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly COMPOSE_FILE="$ROOT/deploy/compose.production.yml"
readonly DEFAULT_CONFIG="/var/www/chainreporter-platform/deploy.env"

fail() {
  echo "backup failed [$1]: $2" >&2
  exit 1
}

usage() {
  cat >&2 <<USAGE
usage: backup.sh create [config]
       backup.sh rehearse <staging-directory> [config]
config defaults to $DEFAULT_CONFIG
USAGE
  exit 64
}

load_config() {
  local config="$1"
  [ -f "$config" ] || fail MISSING_CONFIG "no deployment config at $config"
  set -a
  # shellcheck disable=SC1090
  . "$config"
  set +a
  : "${APP_ROOT:?APP_ROOT is not set}"
  : "${APP_VERSION:?APP_VERSION is not set}"
  : "${CUSTOMER_TEMPLATE_KEY:?CUSTOMER_TEMPLATE_KEY is not set}"
  : "${ENV_DIR:?ENV_DIR is not set}"
  case "$ENV_DIR" in
    /*) ;;
    *) ENV_DIR="$ROOT/deploy/${ENV_DIR#./}" ;;
  esac
  export ENV_DIR
}

compose() {
  docker compose --project-name "$PROJECT" -f "$COMPOSE_FILE" \
    --project-directory "$ROOT/deploy" --env-file "$CONFIG_FILE" "$@"
}

running_writers() {
  compose ps --services --status running | grep -E '^(web|worker)$' || true
}

create() {
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

  local bucket
  bucket="$(sed -n 's/^S3_BUCKET=//p' "$ENV_DIR/minio.env" | head -n 1)"
  [ -n "$bucket" ] || fail MISSING_ENV_KEY "minio.env must define S3_BUCKET"
  install -d -m 700 "$staging/objects"
  compose run --rm --entrypoint /bin/sh -v "$staging/objects:/mirror" minio-init -c \
    "mc alias set platform http://minio:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" && mc mirror --overwrite \"platform/$bucket\" /mirror"

  printf '{"appVersion":"%s","customerTemplateKey":"%s","bucket":"%s","createdAt":"%s"}\n' \
    "$APP_VERSION" "$CUSTOMER_TEMPLATE_KEY" "$bucket" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$staging/release.json"

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
  (cd "$staging" && sha256sum --check --quiet manifest.sha256) \
    || fail MANIFEST_MISMATCH "manifest verification failed for $staging"

  local project="chainreporter-rehearsal-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  local postgres_volume="${project}_postgres_data"
  local minio_volume="${project}_minio_data"
  local database_user database_name bucket
  database_user="$(sed -n 's/^MIGRATION_ROLE=//p' "$ENV_DIR/postgres.env" | head -n 1)"
  database_name="$(sed -n 's/^POSTGRES_DB=//p' "$ENV_DIR/postgres.env" | head -n 1)"
  bucket="$(sed -n 's/^S3_BUCKET=//p' "$ENV_DIR/minio.env" | head -n 1)"

  rehearsal() {
    docker compose --project-name "$project" -f "$ROOT/deploy/compose.rehearsal.yml" \
      --project-directory "$ROOT/deploy" --env-file "$CONFIG_FILE" "$@"
  }

  drop_rehearsal() {
    rehearsal down
    docker volume inspect "$postgres_volume" >/dev/null 2>&1 && docker volume rm "$postgres_volume" >/dev/null
    docker volume inspect "$minio_volume" >/dev/null 2>&1 && docker volume rm "$minio_volume" >/dev/null
    return 0
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

  echo "rehearsal restored $restored_tables tables and $restored objects from $staging"
  echo "rehearsal volumes $postgres_volume and $minio_volume are the only volumes removed"
}

command="${1:-}"
[ -n "$command" ] || usage
shift || true

staging_directory=""
if [ "$command" = "rehearse" ]; then
  staging_directory="${1:-}"
  [ -n "$staging_directory" ] || usage
  shift
fi

CONFIG_FILE="${1:-$DEFAULT_CONFIG}"
load_config "$CONFIG_FILE"

case "$command" in
  create) create ;;
  rehearse) rehearse "$staging_directory" ;;
  *) usage ;;
esac
