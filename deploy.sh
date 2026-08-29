#!/usr/bin/env bash
set -euo pipefail

readonly PROJECT="chainreporter-platform"
readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly COMPOSE_FILE="$ROOT/deploy/compose.production.yml"
readonly NGINX_TEMPLATE="$ROOT/deploy/nginx/site.conf.template"
readonly DEFAULT_CONFIG="/var/www/chainreporter-platform/deploy.env"

readonly REQUIRED_CONFIG=(
  APP_VERSION CUSTOMER_TEMPLATE_KEY IMAGE_PREFIX ENV_DIR BUILD_SECRET_FILE
  APP_ROOT APP_USER PUBLIC_HOST PUBLIC_IP WEB_LOOPBACK_PORT WORKER_LOOPBACK_PORT
  TLS_CERTIFICATE TLS_CERTIFICATE_KEY NGINX_SITE_AVAILABLE NGINX_SITE_ENABLED
  MIN_FREE_MEMORY_MB
)
readonly LEGACY_PATHS=(/var/www/chainreporter /opt/embeddinggemma /usr/bin/node /var/www/rz-ecosystem)
readonly LEGACY_NAMES=(chainreporter-backend chainreporter-frontend embeddinggemma)
readonly LEGACY_HOST_PORTS=(3000 3001 8081)
readonly ENV_FILES=(postgres.env minio.env migrate.env reconcile.env web.env worker.env build.env)

fail() {
  echo "deploy failed [$1]: $2" >&2
  exit 1
}

usage() {
  cat >&2 <<USAGE
usage: deploy.sh check [config]
       deploy.sh deploy [config]
       deploy.sh rollback <previous-app-version> [config]
       deploy.sh render-nginx [config]
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

  local name
  for name in "${REQUIRED_CONFIG[@]}"; do
    [ -n "${!name:-}" ] || fail MISSING_CONFIG_VALUE "$name is not set in $config"
  done

  case "${ENV_DIR}" in
    /*) ;;
    *) ENV_DIR="$ROOT/deploy/${ENV_DIR#./}" ;;
  esac
  case "${BUILD_SECRET_FILE}" in
    /*) ;;
    *) BUILD_SECRET_FILE="$ROOT/deploy/${BUILD_SECRET_FILE#./}" ;;
  esac
  export ENV_DIR BUILD_SECRET_FILE
}

compose() {
  docker compose --project-name "$PROJECT" -f "$COMPOSE_FILE" \
    --project-directory "$ROOT/deploy" "$@"
}

env_value() {
  sed -n "s/^$2=//p" "$1" | head -n 1
}

assert_env_key() {
  grep -q "^$2=" "$1" || fail MISSING_ENV_KEY "$1 does not define $2"
}

refuse_env_key() {
  grep -q "^$2=" "$1" && fail FORBIDDEN_ENV_KEY "$1 must not define $2"
  return 0
}

assert_version() {
  case "$APP_VERSION" in
    dev | latest | "") fail MUTABLE_VERSION "APP_VERSION must be an immutable tag" ;;
  esac
  case "$APP_VERSION" in
    *replace-me*) fail PLACEHOLDER_ENV_VALUE "$CONFIG_FILE still holds a placeholder for APP_VERSION" ;;
  esac
  echo "$APP_VERSION" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$' \
    || fail MUTABLE_VERSION "APP_VERSION is not a usable image tag"
}

assert_no_legacy_target() {
  local path
  for path in "${LEGACY_PATHS[@]}"; do
    case "$APP_ROOT" in
      "$path" | "$path"/*) fail LEGACY_TARGET "APP_ROOT $APP_ROOT is a legacy path" ;;
    esac
  done
  for path in "${LEGACY_NAMES[@]}"; do
    [ "$PROJECT" = "$path" ] && fail LEGACY_TARGET "project name collides with $path"
  done
  local port
  for port in "${LEGACY_HOST_PORTS[@]}"; do
    [ "$WEB_LOOPBACK_PORT" = "$port" ] && fail LEGACY_PORT "web must not bind host port $port"
    [ "$WORKER_LOOPBACK_PORT" = "$port" ] && fail LEGACY_PORT "worker must not bind host port $port"
  done
  return 0
}

assert_env_files() {
  local file
  for file in "${ENV_FILES[@]}"; do
    [ -f "$ENV_DIR/$file" ] || fail MISSING_ENV_FILE "$ENV_DIR/$file does not exist"
  done

  assert_env_key "$ENV_DIR/migrate.env" MIGRATION_DATABASE_URL
  refuse_env_key "$ENV_DIR/migrate.env" DATABASE_URL

  local target
  for target in reconcile.env web.env worker.env; do
    assert_env_key "$ENV_DIR/$target" DATABASE_URL
    refuse_env_key "$ENV_DIR/$target" MIGRATION_DATABASE_URL
  done

  assert_env_key "$ENV_DIR/web.env" OPENROUTER_API_KEY
  assert_env_key "$ENV_DIR/web.env" BETTER_AUTH_SECRET
  assert_env_key "$ENV_DIR/web.env" CACHE_INVALIDATION_WEBHOOK_SECRET
  assert_env_key "$ENV_DIR/web.env" CORS_ORIGIN
  assert_env_key "$ENV_DIR/web.env" S3_ENDPOINT
  assert_env_key "$ENV_DIR/web.env" S3_SECRET_ACCESS_KEY
  assert_env_key "$ENV_DIR/build.env" NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
  assert_env_key "$ENV_DIR/worker.env" INNGEST_EVENT_KEY
  assert_env_key "$ENV_DIR/worker.env" INNGEST_SIGNING_KEY
  refuse_env_key "$ENV_DIR/worker.env" INNGEST_DEV
  refuse_env_key "$ENV_DIR/web.env" INNGEST_DEV
  refuse_env_key "$ENV_DIR/web.env" SENTRY_AUTH_TOKEN
  refuse_env_key "$ENV_DIR/worker.env" SENTRY_AUTH_TOKEN
  refuse_env_key "$ENV_DIR/worker.env" OLLAMA_BASE_URL
  refuse_env_key "$ENV_DIR/web.env" OLLAMA_BASE_URL

  local placeholder_file placeholder_key
  for placeholder_file in "${ENV_FILES[@]}"; do
    placeholder_key="$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*replace-me.*/\1/p' "$ENV_DIR/$placeholder_file" | head -n 1)"
    [ -z "$placeholder_key" ] \
      || fail PLACEHOLDER_ENV_VALUE "$ENV_DIR/$placeholder_file still holds a placeholder for $placeholder_key"
  done

  local superuser migration_role app_role
  superuser="$(env_value "$ENV_DIR/postgres.env" POSTGRES_USER)"
  migration_role="$(env_value "$ENV_DIR/postgres.env" MIGRATION_ROLE)"
  app_role="$(env_value "$ENV_DIR/postgres.env" APP_ROLE)"
  [ -n "$superuser" ] && [ -n "$migration_role" ] && [ -n "$app_role" ] \
    || fail MISSING_ENV_KEY "postgres.env must define POSTGRES_USER, MIGRATION_ROLE and APP_ROLE"
  [ "$migration_role" != "$app_role" ] || fail ROLE_NOT_SPLIT "migration and application roles are identical"
  [ "$superuser" != "$migration_role" ] || fail ROLE_NOT_SPLIT "migration role reuses the bootstrap superuser"
  [ "$superuser" != "$app_role" ] || fail ROLE_NOT_SPLIT "application role reuses the bootstrap superuser"

  grep -q "^MIGRATION_DATABASE_URL=postgresql://$migration_role:" "$ENV_DIR/migrate.env" \
    || fail ROLE_NOT_SPLIT "migrate.env does not connect as $migration_role"
  for target in reconcile.env web.env worker.env; do
    grep -q "^DATABASE_URL=postgresql://$app_role:" "$ENV_DIR/$target" \
      || fail ROLE_NOT_SPLIT "$target does not connect as $app_role"
  done
}

assert_env_file_modes() {
  local file mode
  for file in "${ENV_FILES[@]}"; do
    mode="$(stat -c '%a' "$ENV_DIR/$file")"
    [ "$mode" = "600" ] || fail ENV_FILE_MODE "$ENV_DIR/$file is mode $mode, expected 600"
  done
}

assert_compose() {
  local rendered
  rendered="$(compose --env-file "$CONFIG_FILE" config)" \
    || fail INVALID_COMPOSE "production compose does not resolve"

  echo "$rendered" | grep -Eq '"?0\.0\.0\.0"?' \
    && fail PUBLIC_BINDING "production compose publishes a non-loopback port"
  local port
  for port in "${LEGACY_HOST_PORTS[@]}"; do
    echo "$rendered" | grep -Eq "published: \"?$port\"?" \
      && fail LEGACY_PORT "production compose publishes legacy host port $port"
  done
  local path
  for path in "${LEGACY_PATHS[@]}" "${LEGACY_NAMES[@]}"; do
    echo "$rendered" | grep -Eq "$path([^-_A-Za-z0-9]|\$)" \
      && fail LEGACY_TARGET "production compose references $path"
  done
  echo "$rendered" | grep -q "INNGEST_DEV" \
    && fail INNGEST_DEV_ADMITTED "production compose admits INNGEST_DEV"
  echo "$rendered" | grep -q "container_name" \
    && fail FIXED_CONTAINER_NAME "production compose pins a container name"
  return 0
}

render_nginx() {
  sed \
    -e "s|@PUBLIC_HOST@|$PUBLIC_HOST|g" \
    -e "s|@WEB_LOOPBACK_PORT@|$WEB_LOOPBACK_PORT|g" \
    -e "s|@TLS_CERTIFICATE@|$TLS_CERTIFICATE|g" \
    -e "s|@TLS_CERTIFICATE_KEY@|$TLS_CERTIFICATE_KEY|g" \
    "$NGINX_TEMPLATE"
}

assert_nginx() {
  local site
  site="$(render_nginx)"
  echo "$site" | grep -q "@" && fail NGINX_TEMPLATE "rendered site still holds a placeholder"
  echo "$site" | grep -q "location ^~ /api/internal/" || fail NGINX_INTERNAL "site does not block /api/internal/"
  echo "$site" | grep -q "location ^~ /api/health" || fail NGINX_HEALTH "site does not block /api/health"
  echo "$site" | grep -q "return 301 https://$PUBLIC_HOST" || fail NGINX_REDIRECT "site does not redirect to HTTPS"
  echo "$site" | grep -q "proxy_buffering off" || fail NGINX_STREAMING "site buffers proxied responses"
  echo "$site" | grep -q "access_log off" || fail NGINX_MEDIA_LOG "site logs publishing-media grants"
  local upstream
  upstream="$(echo "$site" | grep -c "proxy_pass http://127.0.0.1:$WEB_LOOPBACK_PORT;" || true)"
  [ "$upstream" -ge 1 ] || fail NGINX_UPSTREAM "site does not proxy the web loopback port"
  echo "$site" | grep -Eq "proxy_pass .*:($WORKER_LOOPBACK_PORT|5432|9000|9001)" \
    && fail NGINX_EXPOSURE "site proxies worker health, PostgreSQL or MinIO"
  return 0
}

assert_static() {
  command -v docker >/dev/null || fail MISSING_TOOL "docker is not installed"
  assert_version
  assert_no_legacy_target
  assert_env_files
  assert_compose
  assert_nginx
  echo "static assertions passed for $PUBLIC_HOST at version $APP_VERSION"
}

assert_host() {
  local tool
  for tool in nginx curl install id stat; do
    command -v "$tool" >/dev/null || fail MISSING_TOOL "$tool is not installed"
  done
  [ "$(id -u)" -eq 0 ] || fail NOT_ROOT "deploy must run as root"
  [ -f "$TLS_CERTIFICATE" ] || fail MISSING_TLS "no certificate at $TLS_CERTIFICATE"
  [ -f "$TLS_CERTIFICATE_KEY" ] || fail MISSING_TLS "no certificate key at $TLS_CERTIFICATE_KEY"
  assert_env_file_modes

  local free_mb
  free_mb="$(awk '/MemAvailable/ {print int($2 / 1024)}' /proc/meminfo)"
  [ "$free_mb" -ge "$MIN_FREE_MEMORY_MB" ] \
    || fail LOW_MEMORY "$free_mb MiB available, $MIN_FREE_MEMORY_MB MiB required"

  local address
  address="$(getent hosts "$PUBLIC_HOST" | awk '{print $1; exit}')"
  [ "$address" = "$PUBLIC_IP" ] \
    || fail DNS_MISMATCH "$PUBLIC_HOST resolves to ${address:-nothing}, expected $PUBLIC_IP"
}

prepare_host_paths() {
  id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_ROOT" --shell /usr/sbin/nologin "$APP_USER"
  install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/backups"
}

build_images() {
  # web and admin share the same builder stage; one invocation lets the second
  # reuse the first's layers instead of repeating next build and tsc.
  compose --env-file "$CONFIG_FILE" build web admin
  compose --env-file "$CONFIG_FILE" build worker migrate
}

reconcile_template() {
  compose --env-file "$CONFIG_FILE" run --rm reconcile \
    pnpm --dir packages/db run template:reconcile "$@"
}

bootstrap_data_services() {
  compose --env-file "$CONFIG_FILE" up -d --wait postgres minio
  compose --env-file "$CONFIG_FILE" run --rm minio-init
}

run_database_steps() {
  compose --env-file "$CONFIG_FILE" run --rm migrate
  compose --env-file "$CONFIG_FILE" run --rm --entrypoint node bindings dist/bindings-check.js preflight
  local reconcile_status=0
  reconcile_template --check || reconcile_status=$?
  [ "$reconcile_status" -eq 0 ] || [ "$reconcile_status" -eq 2 ] \
    || fail RECONCILE_CHECK_FAILED "template dry run failed with $reconcile_status"
  reconcile_template
  compose --env-file "$CONFIG_FILE" run --rm bindings
  compose --env-file "$CONFIG_FILE" run --rm --entrypoint node worker dist/prestart.js worker
}

await_ready() {
  local url="$1" attempt
  for attempt in $(seq 1 30); do
    if curl -fsS --max-time 5 "$url" >/dev/null; then
      echo "ready $url"
      return 0
    fi
    sleep 5
  done
  fail NOT_READY "$url did not become ready"
}

start_processes() {
  compose --env-file "$CONFIG_FILE" up -d web worker
  await_ready "http://127.0.0.1:$WEB_LOOPBACK_PORT/api/health/ready"
  await_ready "http://127.0.0.1:$WORKER_LOOPBACK_PORT/health/ready"
}

install_nginx_site() {
  local staged
  staged="$(mktemp)"
  trap 'rm -f "$staged"' RETURN
  render_nginx > "$staged"
  install -m 644 "$staged" "$NGINX_SITE_AVAILABLE"
  ln -sfn "$NGINX_SITE_AVAILABLE" "$NGINX_SITE_ENABLED"
  nginx -t
  nginx -s reload
}

record_release() {
  local previous="$1" manifest="$APP_ROOT/releases/$APP_VERSION.json" metadata
  metadata="$(docker run --rm --entrypoint cat "$IMAGE_PREFIX/web:$APP_VERSION" /app/prestart/build-metadata.json)"
  printf '{"appVersion":"%s","previousAppVersion":"%s","webImage":"%s","workerImage":"%s","dbOpsImage":"%s","buildMetadata":%s}\n' \
    "$APP_VERSION" "$previous" \
    "$IMAGE_PREFIX/web:$APP_VERSION" "$IMAGE_PREFIX/worker:$APP_VERSION" "$IMAGE_PREFIX/db-ops:$APP_VERSION" \
    "$metadata" > "$manifest"
  chown "$APP_USER:$APP_USER" "$manifest"
  echo "release manifest $manifest"
}

current_release() {
  ls -1 "$APP_ROOT/releases" 2>/dev/null | sed -n 's/\.json$//p' | tail -n 1
}

report_host_assertions() {
  cat <<REPORT
check mode does not execute host assertions; deploy mode runs:
  root privileges, nginx/curl/install/id/stat present
  $TLS_CERTIFICATE and $TLS_CERTIFICATE_KEY exist
  every $ENV_DIR file is mode 600
  MemAvailable >= $MIN_FREE_MEMORY_MB MiB
  $PUBLIC_HOST resolves to $PUBLIC_IP
REPORT
}

command="${1:-}"
[ -n "$command" ] || usage
shift || true

rollback_version=""
if [ "$command" = "rollback" ]; then
  rollback_version="${1:-}"
  [ -n "$rollback_version" ] || usage
  shift
fi

CONFIG_FILE="${1:-$DEFAULT_CONFIG}"
load_config "$CONFIG_FILE"

case "$command" in
  check)
    assert_static
    report_host_assertions
    ;;
  render-nginx)
    render_nginx
    ;;
  deploy)
    previous="$(current_release)"
    assert_static
    assert_host
    prepare_host_paths
    build_images
    bootstrap_data_services
    run_database_steps
    start_processes
    install_nginx_site
    record_release "$previous"
    ;;
  rollback)
    previous="$APP_VERSION"
    APP_VERSION="$rollback_version"
    export APP_VERSION
    assert_static
    assert_host
    docker image inspect "$IMAGE_PREFIX/web:$APP_VERSION" >/dev/null \
      || fail MISSING_IMAGE "no web image tagged $APP_VERSION"
    docker image inspect "$IMAGE_PREFIX/worker:$APP_VERSION" >/dev/null \
      || fail MISSING_IMAGE "no worker image tagged $APP_VERSION"
    reconcile_status=0
    reconcile_template --check || reconcile_status=$?
    [ "$reconcile_status" -eq 0 ] || [ "$reconcile_status" -eq 2 ] \
      || fail RECONCILE_CHECK_FAILED "template dry run failed with $reconcile_status"
    [ "$reconcile_status" -eq 0 ] || reconcile_template
    start_processes
    record_release "$previous"
    ;;
  *)
    usage
    ;;
esac
