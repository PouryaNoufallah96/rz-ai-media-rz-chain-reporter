#!/usr/bin/env bash
# Documentation hygiene gate.
# 1. Every repository path cited must exist AND not be git-ignored, so a
#    citation can never point at a file another clone will not have.
# 2. No secret-shaped literals.
# 3. No pinned version numbers — they go stale silently. Name the tool, and say
#    where its version is declared. The one exception is "PostgreSQL 18", where
#    the version is the fact: the built-in time-ordered UUID function arrived
#    there, so 18 is a real floor rather than a snapshot of what is installed.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

TARGETS=$(git ls-files 'documentation/**/*.md' 'README.md' '**/README.md' 2>/dev/null; \
          find documentation -name '*.md' 2>/dev/null; \
          find apps packages -maxdepth 2 -name README.md 2>/dev/null)
TARGETS=$(printf '%s\n' $TARGETS | sort -u)
[ -z "$TARGETS" ] && { echo "docscan: no documentation files found"; exit 0; }

SECRETS='postgres(ql)?://[^ ]*:[^ @]*@|\bsk-[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]|xox[baprs]-|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY'
VERSIONS='(^|[^0-9.])[0-9]+\.[0-9]+\.[0-9]+([^0-9.]|$)|\b(Node|Node\.js|Next\.js|React|TypeScript|pnpm|Turborepo|Biome|Drizzle|Tailwind|Zod|Inngest|oRPC|Better Auth|Sentry|MinIO|Docker) v?[0-9]+'

fail=0
for f in $TARGETS; do
  [ -f "$f" ] || continue
  if hits=$(grep -nEI "$SECRETS" "$f"); then
    echo "SECRET SHAPE    $f"; echo "$hits" | sed 's/^/    /'; fail=1
  fi
  # version numbers go stale silently; IPv4 literals are masked first so ports
  # and loopback addresses are not mistaken for one
  if hits=$(sed -E 's/\b([0-9]{1,3}\.){3}[0-9]{1,3}\b/IPV4/g' "$f" | grep -nEI "$VERSIONS"); then
    echo "VERSION NUMBER  $f"; echo "$hits" | sed 's/^/    /'; fail=1
  fi
  # cited repository paths must be tracked
  for p in $(grep -ohE '`(apps|packages|deploy|customer-templates|documentation)/[A-Za-z0-9._/*<>-]+`' "$f" | tr -d '`'); do
    case "$p" in *'*'*|*'<'*|*/) continue;; esac
    if [ ! -e "$p" ]; then
      echo "MISSING PATH    $f -> $p"; fail=1
    elif git check-ignore -q "$p" 2>/dev/null; then
      echo "EXCLUDED PATH   $f -> $p"; fail=1
    fi
  done
  # relative markdown links must resolve
  for l in $(grep -ohE '\]\(\.{0,2}/?[A-Za-z0-9._/-]+\.md(#[A-Za-z0-9-]+)?\)' "$f" | sed -E 's/^\]\(//; s/\)$//; s/#.*$//'); do
    d=$(dirname "$f")
    [ -e "$d/$l" ] || [ -e "$l" ] || { echo "BROKEN LINK     $f -> $l"; fail=1; }
  done
done
[ $fail -eq 0 ] && echo "docscan: clean ($(printf '%s\n' $TARGETS | wc -l | tr -d ' ') files)"
exit $fail
