#!/usr/bin/env bash
set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly COMPOSE_FILE="$ROOT/deploy/compose.production.yml"
readonly NGINX_TEMPLATE="$ROOT/deploy/nginx/site.conf.template"

readonly REQUIRED_CONFIG=(
  COMPOSE_PROJECT_NAME APP_VERSION CUSTOMER_TEMPLATE_KEY IMAGE_PREFIX
  ENV_DIR BUILD_SECRET_FILE APP_ROOT APP_USER PUBLIC_HOST PUBLIC_IP
  WEB_LOOPBACK_PORT WORKER_LOOPBACK_PORT
  MINIO_API_LOOPBACK_PORT MINIO_CONSOLE_LOOPBACK_PORT
  TLS_CERTIFICATE TLS_CERTIFICATE_KEY NGINX_SITE_AVAILABLE NGINX_SITE_ENABLED
  MIN_FREE_MEMORY_MB
)
readonly LEGACY_PATHS=(
  /var/www/chainreporter /var/www/rzwire /opt/embeddinggemma
  /usr/bin/node /var/www/rz-ecosystem
)
readonly LEGACY_NAMES=(
  chainreporter-backend chainreporter-frontend embeddinggemma rzwire
)
readonly LEGACY_HOST_PORTS=(3000 3001 8081)
readonly ENV_FILES=(postgres.env minio.env migrate.env reconcile.env web.env worker.env build.env)

fail() {
  echo "deploy failed [$1]: $2" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
usage: deploy.sh check <config>
       deploy.sh deploy <config>
       deploy.sh deploy-prebuilt <config>
       deploy.sh rollback <previous-app-version> <config>
       deploy.sh render-nginx <config>

deploy builds from the checked-out source tree. deploy-prebuilt uses exact
images already loaded or pulled on the host. Every command requires an explicit
instance config; no mutation can fall back to another customer's deployment.
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

  case "$ENV_DIR" in
    /*) ;;
    *) ENV_DIR="$ROOT/deploy/${ENV_DIR#./}" ;;
  esac
  case "$BUILD_SECRET_FILE" in
    /*) ;;
    *) BUILD_SECRET_FILE="$ROOT/deploy/${BUILD_SECRET_FILE#./}" ;;
  esac
  export COMPOSE_PROJECT_NAME ENV_DIR BUILD_SECRET_FILE
}

compose() {
  docker compose --project-name "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" \
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

assert_matching_env_values() {
  local label="$1" left_file="$2" left_key="$3" right_file="$4" right_key="$5"
  local left right
  left="$(env_value "$left_file" "$left_key")"
  right="$(env_value "$right_file" "$right_key")"
  [ -n "$left" ] && [ -n "$right" ] \
    || fail MISSING_ENV_KEY "$label requires $left_key and $right_key"
  [ "$left" = "$right" ] \
    || fail ENV_VALUE_MISMATCH "$label differs between runtime env files"
}

assert_identifier() {
  printf '%s' "$2" | grep -Eq '^[a-z0-9][a-z0-9_-]*$' \
    || fail INVALID_IDENTIFIER "$1 is not a lowercase deployment identifier"
}

assert_port() {
  printf '%s' "$2" | grep -Eq '^[0-9]+$' \
    || fail INVALID_PORT "$1 must be numeric"
  [ "$2" -ge 1 ] && [ "$2" -le 65535 ] \
    || fail INVALID_PORT "$1 must be between 1 and 65535"
}

assert_version() {
  case "$APP_VERSION" in
    dev | latest | "") fail MUTABLE_VERSION "APP_VERSION must be an immutable tag" ;;
    *replace-me*) fail PLACEHOLDER_ENV_VALUE "$CONFIG_FILE still holds an APP_VERSION placeholder" ;;
  esac
  printf '%s' "$APP_VERSION" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$' \
    || fail MUTABLE_VERSION "APP_VERSION is not a usable image tag"
}

assert_instance_config() {
  assert_identifier COMPOSE_PROJECT_NAME "$COMPOSE_PROJECT_NAME"
  assert_identifier CUSTOMER_TEMPLATE_KEY "$CUSTOMER_TEMPLATE_KEY"
  printf '%s' "$IMAGE_PREFIX" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' \
    || fail INVALID_IMAGE_PREFIX "IMAGE_PREFIX is not usable"
  printf '%s' "$PUBLIC_HOST" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' \
    || fail INVALID_PUBLIC_HOST "PUBLIC_HOST is not a lowercase hostname"
  printf '%s' "$PUBLIC_IP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' \
    || fail INVALID_PUBLIC_IP "PUBLIC_IP must be an IPv4 address"
  case "$APP_ROOT" in
    /*) ;;
    *) fail INVALID_APP_ROOT "APP_ROOT must be absolute" ;;
  esac
  local path_name
  for path_name in TLS_CERTIFICATE TLS_CERTIFICATE_KEY NGINX_SITE_AVAILABLE NGINX_SITE_ENABLED; do
    case "${!path_name}" in
      /*) ;;
      *) fail INVALID_PATH "$path_name must be absolute" ;;
    esac
  done

  local name value seen=" "
  for name in WEB_LOOPBACK_PORT WORKER_LOOPBACK_PORT MINIO_API_LOOPBACK_PORT MINIO_CONSOLE_LOOPBACK_PORT; do
    value="${!name}"
    assert_port "$name" "$value"
    case "$seen" in
      *" $value "*) fail DUPLICATE_PORT "$name reuses loopback port $value" ;;
    esac
    seen="$seen$value "
  done
}

assert_no_legacy_target() {
  local path
  for path in "${LEGACY_PATHS[@]}"; do
    case "$APP_ROOT" in
      "$path" | "$path"/*) fail LEGACY_TARGET "APP_ROOT $APP_ROOT is a legacy path" ;;
    esac
  done
  for path in "${LEGACY_NAMES[@]}"; do
    [ "$COMPOSE_PROJECT_NAME" = "$path" ] \
      && fail LEGACY_TARGET "project name collides with $path"
  done
  local port
  for port in "${LEGACY_HOST_PORTS[@]}"; do
    [ "$WEB_LOOPBACK_PORT" = "$port" ] \
      && fail LEGACY_PORT "web must not bind host port $port"
    [ "$WORKER_LOOPBACK_PORT" = "$port" ] \
      && fail LEGACY_PORT "worker must not bind host port $port"
  done
  return 0
}

assert_env_files() {
  local file
  for file in "${ENV_FILES[@]}"; do
    [ -f "$ENV_DIR/$file" ] || fail MISSING_ENV_FILE "$ENV_DIR/$file does not exist"
  done
  [ "$BUILD_SECRET_FILE" = "$ENV_DIR/build.env" ] \
    || fail BUILD_SECRET_MISMATCH "BUILD_SECRET_FILE must be the instance env/build.env"

  assert_env_key "$ENV_DIR/migrate.env" MIGRATION_DATABASE_URL
  refuse_env_key "$ENV_DIR/migrate.env" DATABASE_URL

  local target
  for target in reconcile.env web.env worker.env; do
    assert_env_key "$ENV_DIR/$target" DATABASE_URL
    refuse_env_key "$ENV_DIR/$target" MIGRATION_DATABASE_URL
  done

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

  local configured_template configured_version
  for target in web.env worker.env; do
    configured_template="$(env_value "$ENV_DIR/$target" CUSTOMER_TEMPLATE_KEY)"
    [ "$configured_template" = "$CUSTOMER_TEMPLATE_KEY" ] \
      || fail TEMPLATE_MISMATCH "$target selects ${configured_template:-nothing}, expected $CUSTOMER_TEMPLATE_KEY"
  done
  configured_version="$(env_value "$ENV_DIR/build.env" APP_VERSION)"
  if [ "${SKIP_BUILD_VERSION_MATCH:-0}" != "1" ]; then
    [ "$configured_version" = "$APP_VERSION" ] \
      || fail VERSION_MISMATCH "build.env APP_VERSION does not match deploy config"
  fi

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

  assert_matching_env_values storage-user "$ENV_DIR/minio.env" MINIO_ROOT_USER "$ENV_DIR/web.env" S3_ACCESS_KEY_ID
  assert_matching_env_values storage-user "$ENV_DIR/minio.env" MINIO_ROOT_USER "$ENV_DIR/worker.env" S3_ACCESS_KEY_ID
  assert_matching_env_values storage-secret "$ENV_DIR/minio.env" MINIO_ROOT_PASSWORD "$ENV_DIR/web.env" S3_SECRET_ACCESS_KEY
  assert_matching_env_values storage-secret "$ENV_DIR/minio.env" MINIO_ROOT_PASSWORD "$ENV_DIR/worker.env" S3_SECRET_ACCESS_KEY
  assert_matching_env_values storage-bucket "$ENV_DIR/minio.env" S3_BUCKET "$ENV_DIR/web.env" S3_BUCKET
  assert_matching_env_values storage-bucket "$ENV_DIR/minio.env" S3_BUCKET "$ENV_DIR/worker.env" S3_BUCKET
  assert_matching_env_values cache-invalidation "$ENV_DIR/web.env" CACHE_INVALIDATION_WEBHOOK_SECRET "$ENV_DIR/worker.env" CACHE_INVALIDATION_WEBHOOK_SECRET
  assert_matching_env_values cache-invalidation "$ENV_DIR/web.env" CACHE_INVALIDATION_WEBHOOK_SECRET "$ENV_DIR/reconcile.env" CACHE_INVALIDATION_WEBHOOK_SECRET
  assert_matching_env_values inngest-signing "$ENV_DIR/web.env" INNGEST_SIGNING_KEY "$ENV_DIR/worker.env" INNGEST_SIGNING_KEY
  # Model provider keys are conditionally required per template. The worker prestart
  # refuses an unbound backend with EXIT_UNBOUND; this layer only checks agreement.
  local web_openrouter worker_openrouter
  web_openrouter="$(env_value "$ENV_DIR/web.env" OPENROUTER_API_KEY)"
  worker_openrouter="$(env_value "$ENV_DIR/worker.env" OPENROUTER_API_KEY)"
  if [ -n "$web_openrouter" ] || [ -n "$worker_openrouter" ]; then
    [ -n "$web_openrouter" ] && [ -n "$worker_openrouter" ] || fail MISSING_ENV_KEY "OPENROUTER_API_KEY must be present in both web.env and worker.env when either binds remote"
    [ "$web_openrouter" = "$worker_openrouter" ] || fail ENV_VALUE_MISMATCH "OPENROUTER_API_KEY differs between runtime env files"
  fi
  local web_ollama worker_ollama
  web_ollama="$(env_value "$ENV_DIR/web.env" OLLAMA_BASE_URL)"
  worker_ollama="$(env_value "$ENV_DIR/worker.env" OLLAMA_BASE_URL)"
  if [ -n "$web_ollama" ] || [ -n "$worker_ollama" ]; then
    [ -n "$web_ollama" ] && [ -n "$worker_ollama" ] || fail MISSING_ENV_KEY "OLLAMA_BASE_URL must be present in both web.env and worker.env when any task selects the local backend"
    [ "$web_ollama" = "$worker_ollama" ] || fail ENV_VALUE_MISMATCH "OLLAMA_BASE_URL differs between runtime env files"
  fi
  # Server actions are encrypted at build and decrypted at runtime. A divergence
  # here builds and starts cleanly, then fails every form submission with an
  # opaque "failed to find server action".
  assert_matching_env_values server-actions-key "$ENV_DIR/build.env" NEXT_SERVER_ACTIONS_ENCRYPTION_KEY "$ENV_DIR/web.env" NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
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

  printf '%s\n' "$rendered" | grep -Eq 'host_ip: "?0\.0\.0\.0"?' \
    && fail PUBLIC_BINDING "production compose publishes a non-loopback port"
  local port
  for port in "${LEGACY_HOST_PORTS[@]}"; do
    printf '%s\n' "$rendered" | grep -Eq "published: \"?$port\"?" \
      && fail LEGACY_PORT "production compose publishes legacy host port $port"
  done
  printf '%s\n' "$rendered" | grep -q 'INNGEST_DEV' \
    && fail INNGEST_DEV_ADMITTED "production compose admits INNGEST_DEV"
  printf '%s\n' "$rendered" | grep -q 'container_name' \
    && fail FIXED_CONTAINER_NAME "production compose pins a container name"
  return 0
}

render_nginx() {
  local rate_limit_zone_prefix="${COMPOSE_PROJECT_NAME//-/_}"
  sed \
    -e "s|@PUBLIC_HOST@|$PUBLIC_HOST|g" \
    -e "s|@WEB_LOOPBACK_PORT@|$WEB_LOOPBACK_PORT|g" \
    -e "s|@TLS_CERTIFICATE@|$TLS_CERTIFICATE|g" \
    -e "s|@TLS_CERTIFICATE_KEY@|$TLS_CERTIFICATE_KEY|g" \
    -e "s|@RATE_LIMIT_ZONE_PREFIX@|$rate_limit_zone_prefix|g" \
    "$NGINX_TEMPLATE"
}

assert_nginx() {
  local site upstream
  site="$(render_nginx)"
  printf '%s\n' "$site" | grep -q '@' \
    && fail NGINX_TEMPLATE "rendered site still holds a placeholder"
  printf '%s\n' "$site" | grep -q 'location ^~ /api/internal/' \
    || fail NGINX_INTERNAL "site does not block /api/internal/"
  printf '%s\n' "$site" | grep -q 'location ^~ /api/health' \
    || fail NGINX_HEALTH "site does not block /api/health"
  printf '%s\n' "$site" | grep -q "return 301 https://$PUBLIC_HOST" \
    || fail NGINX_REDIRECT "site does not redirect to HTTPS"
  printf '%s\n' "$site" | grep -q 'proxy_buffering off' \
    || fail NGINX_STREAMING "site buffers proxied responses"
  printf '%s\n' "$site" | grep -q 'access_log off' \
    || fail NGINX_MEDIA_LOG "site logs publishing-media grants"
  printf '%s\n' "$site" | grep -q "zone=${COMPOSE_PROJECT_NAME//-/_}_app:10m" \
    || fail NGINX_RATE_LIMIT_ZONE "site does not isolate the application rate-limit zone"
  printf '%s\n' "$site" | grep -q "zone=${COMPOSE_PROJECT_NAME//-/_}_auth:10m" \
    || fail NGINX_RATE_LIMIT_ZONE "site does not isolate the authentication rate-limit zone"
  upstream="$(printf '%s\n' "$site" | grep -c "proxy_pass http://127.0.0.1:$WEB_LOOPBACK_PORT;" || true)"
  [ "$upstream" -ge 1 ] || fail NGINX_UPSTREAM "site does not proxy the web loopback port"
  printf '%s\n' "$site" | grep -Eq "proxy_pass .*:($WORKER_LOOPBACK_PORT|5432|$MINIO_API_LOOPBACK_PORT|$MINIO_CONSOLE_LOOPBACK_PORT)" \
    && fail NGINX_EXPOSURE "site proxies worker health, PostgreSQL or MinIO"
  return 0
}

assert_static() {
  command -v docker >/dev/null || fail MISSING_TOOL "docker is not installed"
  assert_version
  assert_instance_config
  assert_no_legacy_target
  assert_env_files
  assert_compose
  assert_nginx
  echo "static assertions passed for $COMPOSE_PROJECT_NAME at $PUBLIC_HOST, version $APP_VERSION"
}

assert_host() {
  local tool
  for tool in nginx curl install id stat getent useradd; do
    command -v "$tool" >/dev/null || fail MISSING_TOOL "$tool is not installed"
  done
  [ "$(id -u)" -eq 0 ] || fail NOT_ROOT "deploy must run as root"
  [ -f "$TLS_CERTIFICATE" ] || fail MISSING_TLS "no certificate at $TLS_CERTIFICATE"
  [ -f "$TLS_CERTIFICATE_KEY" ] || fail MISSING_TLS "no certificate key at $TLS_CERTIFICATE_KEY"
  assert_env_file_modes

  local free_mb address
  free_mb="$(awk '/MemAvailable/ {print int($2 / 1024)}' /proc/meminfo)"
  [ "$free_mb" -ge "$MIN_FREE_MEMORY_MB" ] \
    || fail LOW_MEMORY "$free_mb MiB available, $MIN_FREE_MEMORY_MB MiB required"
  if [ "$PUBLIC_HOST" = "$PUBLIC_IP" ]; then
    address="$PUBLIC_IP"
  else
    address="$(getent hosts "$PUBLIC_HOST" | awk '{print $1; exit}')"
  fi
  [ "$address" = "$PUBLIC_IP" ] \
    || fail DNS_MISMATCH "$PUBLIC_HOST resolves to ${address:-nothing}, expected $PUBLIC_IP"
}

assert_source_tree() {
  local required
  for required in package.json pnpm-lock.yaml apps/web/Dockerfile apps/worker/Dockerfile packages/db/Dockerfile; do
    [ -f "$ROOT/$required" ] || fail MISSING_SOURCE "$ROOT/$required is required for a source build"
  done
  [ -f "$ROOT/customer-templates/$CUSTOMER_TEMPLATE_KEY/template.json" ] \
    || fail MISSING_TEMPLATE "source tree has no customer template $CUSTOMER_TEMPLATE_KEY"
}

image_ref() {
  printf '%s/%s:%s' "$IMAGE_PREFIX" "$1" "$APP_VERSION"
}

assert_images() {
  local component
  for component in web worker db-ops web-admin; do
    docker image inspect "$(image_ref "$component")" >/dev/null \
      || fail MISSING_IMAGE "no local image $(image_ref "$component")"
  done
}

prepare_host_paths() {
  id "$APP_USER" >/dev/null 2>&1 \
    || useradd --system --user-group --home "$APP_ROOT" --shell /usr/sbin/nologin "$APP_USER"
  install -d -o "$APP_USER" -g "$APP_USER" -m 750 \
    "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/backups"
}

build_images() {
  compose --env-file "$CONFIG_FILE" build web
  compose --env-file "$CONFIG_FILE" build admin
  compose --env-file "$CONFIG_FILE" build worker
  compose --env-file "$CONFIG_FILE" build migrate
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
  local reconcile_status=0
  reconcile_template --check || reconcile_status=$?
  [ "$reconcile_status" -eq 0 ] || [ "$reconcile_status" -eq 2 ] \
    || fail RECONCILE_CHECK_FAILED "template dry run failed with $reconcile_status"
  reconcile_template
  compose --env-file "$CONFIG_FILE" run --rm bindings
  compose --env-file "$CONFIG_FILE" run --rm --entrypoint node worker dist/prestart.js worker
}

run_rollback_checks() {
  local reconcile_status=0
  reconcile_template --check || reconcile_status=$?
  [ "$reconcile_status" -eq 0 ] || [ "$reconcile_status" -eq 2 ] \
    || fail RECONCILE_CHECK_FAILED "template dry run failed with $reconcile_status"
  [ "$reconcile_status" -eq 0 ] || reconcile_template
  compose --env-file "$CONFIG_FILE" run --rm --entrypoint node worker dist/prestart.js worker
}

run_binding_preflight() {
  compose --env-file "$CONFIG_FILE" run --rm --no-deps --entrypoint node \
    bindings dist/bindings-check.js preflight
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

running_writers() {
  compose --env-file "$CONFIG_FILE" ps --services --status running \
    | grep -E '^(web|worker)$' || true
}

activate_release() {
  local database_mode="$1" resume
  resume="$(running_writers)"
  if [ -n "$resume" ]; then
    # shellcheck disable=SC2086
    compose --env-file "$CONFIG_FILE" stop $resume
  fi

  local sequence_status
  set +e
  (
    set -e
    bootstrap_data_services
    if [ "$database_mode" = "forward" ]; then
      run_database_steps
    else
      run_rollback_checks
    fi
  )
  sequence_status=$?
  set -e
  if [ "$sequence_status" -ne 0 ]; then
    if [ -n "$resume" ]; then
      # shellcheck disable=SC2086
      compose --env-file "$CONFIG_FILE" start $resume || true
    fi
    fail RELEASE_PRESTART "database/template/prestart sequence failed; previous stopped writers were restarted"
  fi
  start_processes
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

current_release() {
  local pointer="$APP_ROOT/releases/current-release" version
  [ -f "$pointer" ] || return 0
  IFS= read -r version < "$pointer"
  printf '%s' "$version" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$' \
    || fail INVALID_RELEASE_POINTER "$pointer is invalid"
  [ -f "$APP_ROOT/releases/$version.json" ] \
    || fail INVALID_RELEASE_POINTER "$pointer names a missing release manifest"
  printf '%s\n' "$version"
}

record_release() {
  local previous="$1" manifest="$APP_ROOT/releases/$APP_VERSION.json"
  local metadata staged pointer_staged
  metadata="$(docker run --rm --entrypoint cat "$(image_ref web)" /app/prestart/build-metadata.json)"
  staged="$(mktemp "$APP_ROOT/releases/.release.XXXXXX")"
  pointer_staged="$(mktemp "$APP_ROOT/releases/.current.XXXXXX")"
  printf '{"appVersion":"%s","previousAppVersion":"%s","webImage":"%s","workerImage":"%s","dbOpsImage":"%s","adminImage":"%s","buildMetadata":%s}\n' \
    "$APP_VERSION" "$previous" "$(image_ref web)" "$(image_ref worker)" \
    "$(image_ref db-ops)" "$(image_ref web-admin)" "$metadata" > "$staged"
  printf '%s\n' "$APP_VERSION" > "$pointer_staged"
  chown "$APP_USER:$APP_USER" "$staged" "$pointer_staged"
  chmod 640 "$staged" "$pointer_staged"
  mv "$staged" "$manifest"
  mv "$pointer_staged" "$APP_ROOT/releases/current-release"
  echo "release manifest $manifest"
}

report_host_assertions() {
  cat <<REPORT
check mode does not execute host assertions; deploy modes run:
  root privileges and required host tools
  configured TLS certificate and key exist
  every file under $ENV_DIR is mode 600
  MemAvailable >= $MIN_FREE_MEMORY_MB MiB
  $PUBLIC_HOST equals or resolves to $PUBLIC_IP
REPORT
}

command="${1:-}"
[ -n "$command" ] || usage
shift

rollback_version=""
case "$command" in
  rollback)
    rollback_version="${1:-}"
    [ -n "$rollback_version" ] || usage
    shift
    ;;
  check | deploy | deploy-prebuilt | render-nginx) ;;
  *) usage ;;
esac

CONFIG_FILE="${1:-}"
[ -n "$CONFIG_FILE" ] || usage
[ "$#" -eq 1 ] || usage
load_config "$CONFIG_FILE"

case "$command" in
  check)
    assert_static
    report_host_assertions
    ;;
  render-nginx)
    assert_instance_config
    assert_no_legacy_target
    assert_nginx
    render_nginx
    ;;
  deploy)
    assert_static
    assert_source_tree
    assert_host
    build_images
    assert_images
    run_binding_preflight
    prepare_host_paths
    previous="$(current_release)"
    install_nginx_site
    activate_release forward
    record_release "$previous"
    ;;
  deploy-prebuilt)
    assert_static
    assert_host
    assert_images
    run_binding_preflight
    prepare_host_paths
    previous="$(current_release)"
    install_nginx_site
    activate_release forward
    record_release "$previous"
    ;;
  rollback)
    previous="$APP_VERSION"
    APP_VERSION="$rollback_version"
    SKIP_BUILD_VERSION_MATCH=1
    export APP_VERSION SKIP_BUILD_VERSION_MATCH
    assert_static
    assert_host
    assert_images
    run_binding_preflight
    activate_release rollback
    record_release "$previous"
    ;;
esac
