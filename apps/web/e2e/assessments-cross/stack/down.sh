#!/usr/bin/env bash
# Tear down exactly what up.sh started: its processes (pid files), its containers and network. --purge also
# deletes the state directory (throwaway keys, logs, the C# build).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
P="${CROSS_PREFIX:-assessments-cross}"
STATE="${CROSS_STATE_DIR:-$HERE/../.state}"
for name in web suite-up v4forward proxies; do
  f="$STATE/$name.pid"
  [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null
  rm -f "$f"
done
sleep 3 # suite-up removes its own containers on SIGTERM
docker rm -f "$P-ats-api" "$P-ats-auth" "$P-ats-mail" "$P-ats-db" "$P-suite-rest" "$P-suite-db" >/dev/null 2>&1
docker network rm "$P-net" "$P-suite-net" >/dev/null 2>&1
if [ "${1:-}" = "--purge" ]; then rm -rf -- "$STATE"; fi
echo "[cross] down"
