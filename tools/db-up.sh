#!/usr/bin/env bash
# Ensures a local Postgres 16 is running for development and tests.
# Uses the system Postgres binaries when Docker is unavailable (e.g. cloud dev containers).
set -euo pipefail
if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then echo "postgres: already running"; exit 0; fi
if docker info >/dev/null 2>&1; then
  docker run -d --name portico-pg -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16 >/dev/null
else
  PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
  PGDATA=/var/lib/postgresql/portico-data
  if [ ! -d "$PGDATA" ]; then
    mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA"
    su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
    printf "max_connections = 300\nfsync = off\nsynchronous_commit = off\n" >> "$PGDATA/postgresql.conf"
  fi
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l /var/lib/postgresql/portico.log -o '-p 5432 -k /tmp' start"
fi
for i in $(seq 1 30); do pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && { echo "postgres: ready"; exit 0; }; sleep 1; done
echo "postgres: failed to start" >&2; exit 1
