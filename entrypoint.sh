#!/bin/sh
set -e

# The container starts as root so it can fix up ownership of the bind-mounted
# data volume (which, on first run, typically belongs to root on the host) —
# then it drops to the unprivileged "nextjs" user before running the app.
mkdir -p /app/data
chown -R nextjs:nodejs /app/data

exec gosu nextjs "$@"
