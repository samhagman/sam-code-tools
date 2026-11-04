#!/usr/bin/env bash
# Pull the latest sam-code-tools plugins into this machine's install.
# Usage: update.sh [plugin ...]   (no args = every installed sam-code-tools plugin)
set -euo pipefail
M=sam-code-tools

before=$(claude plugin list --json | python3 -c "
import json,sys
for p in json.load(sys.stdin):
    if p['id'].endswith('@$M'): print(p['id'], p['version'])")

echo "Refreshing marketplace $M..."
claude plugin marketplace update "$M" >/dev/null

if [ $# -gt 0 ]; then ids=$(printf '%s@'"$M"'\n' "$@"); else ids=$(echo "$before" | awk 'NF{print $1}'); fi
[ -z "$ids" ] && { echo "No $M plugins installed."; exit 0; }

for id in $ids; do claude plugin update "$id" >/dev/null 2>&1 || echo "  could not update $id"; done

after=$(claude plugin list --json | python3 -c "
import json,sys
for p in json.load(sys.stdin):
    if p['id'].endswith('@$M'): print(p['id'], p['version'])")

changed=0
while read -r id v; do
  [ -z "$id" ] && continue
  old=$(echo "$before" | awk -v i="$id" '$1==i{print $2}')
  if [ "$old" != "$v" ]; then echo "UPDATED  $id  ${old:-new} -> $v"; changed=1; else echo "current  $id  $v"; fi
done <<< "$after"

if [ $changed = 1 ]; then echo "NEXT: run /reload-plugins in the session (a restart works too)."; fi
