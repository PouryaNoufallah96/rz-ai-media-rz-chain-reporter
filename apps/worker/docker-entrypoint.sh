#!/bin/sh
set -e

node /app/dist/prestart.js worker

exec "$@"
