#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_FILE="$SCRIPT_DIR/.secrets/render.env"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "Missing $SECRETS_FILE" >&2
  exit 1
fi

set -a
source "$SECRETS_FILE"
set +a

python3 - <<'PY'
import os
import urllib.request

url = os.environ["RENDER_DEPLOY_HOOK_URL"]
with urllib.request.urlopen(url, timeout=20) as response:
    print(response.status)
    print(response.read(200).decode("utf-8", "ignore"))
PY
