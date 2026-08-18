#!/bin/sh
set -e

node /app/prestart/prestart.js web

exec "$@"
