#!/bin/sh
# What the image runs, as /usr/local/bin/agora: the bot by default, or one of Agora's commands. Each reads .env as
# `pnpm start` does.
set -e
command="${1:-start}"
[ $# -gt 0 ] && shift
case "$command" in
  start) exec node --env-file-if-exists=.env src/main.ts ;;
  # Printed rather than written, since the container has nowhere to keep it.
  manifest) exec node --env-file-if-exists=.env src/manifest/cli.ts --stdout ;;
  clean-db) exec node --env-file-if-exists=.env src/storage/cli.ts "$@" ;;
  *) exec "$command" "$@" ;;
esac
