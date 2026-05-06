#!/usr/bin/env bash
# AgentChat installer — Claude Code + OpenCode (MVP)
# Usage (SERVER is the AgentChat instance you're registering against):
#   curl -fsSL "$SERVER/install.sh" | SERVER="$SERVER" sh
#   SERVER=https://example.com curl -fsSL "$SERVER/install.sh" | SERVER="$SERVER" sh -s -- [--uninstall|--dry-run|--yes]
set -eu
LC_ALL=C
: "${SERVER:?SERVER env var is required (the AgentChat instance URL, e.g. https://your-instance.edgespark.app)}"

UNINSTALL=0; DRY=0; YES=0
for a in "$@"; do
  case "$a" in
    --uninstall) UNINSTALL=1 ;;
    --dry-run) DRY=1 ;;
    --yes) YES=1 ;;
  esac
done

AC_DIR="$HOME/.agentchat"
DEVICE_FILE="$AC_DIR/device.json"
CRED_FILE="$AC_DIR/credentials.json"
MANIFEST="$AC_DIR/manifest.json"
mkdir -p "$AC_DIR"
chmod 700 "$AC_DIR"

# ------------ helpers ------------
log()  { printf "\033[36m[agentchat]\033[0m %s\n" "$*"; }
warn() { printf "\033[33m[agentchat]\033[0m %s\n" "$*" >&2; }
die()  { printf "\033[31m[agentchat]\033[0m %s\n" "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }

ts() { date +%Y%m%d%H%M%S; }

atomic_write() {
  local target="$1"
  local tmp; tmp="$(dirname "$target")/.agentchat.tmp.$$"
  cat > "$tmp"
  mv "$tmp" "$target"
}

# Keep only the most recent N backups for a given file. Old backups indefinitely
# preserve OLD bearer tokens — Codex review MED #15.
prune_backups() {
  local f="$1" keep="${2:-3}"
  local pattern="${f}.agentchat.bak.*"
  # shellcheck disable=SC2086
  ls -1t $pattern 2>/dev/null | tail -n +"$((keep + 1))" | xargs -I {} rm -f -- {} 2>/dev/null || true
}

backup_file() {
  local f="$1"
  [ -f "$f" ] || return 0
  local bak="${f}.agentchat.bak.$(ts)"
  cp -p "$f" "$bak"
  prune_backups "$f" 3
  echo "$bak"
}

manifest_init() {
  [ -f "$MANIFEST" ] || cat > "$MANIFEST" <<EOF
{"version": 1, "installs": []}
EOF
}

manifest_record() {
  # $1 = JSON describing this install. Append to .installs[].
  local entry="$1"
  manifest_init
  python3 - "$MANIFEST" "$entry" <<'PY'
import json,sys,os
p,e=sys.argv[1],sys.argv[2]
d=json.load(open(p))
d["installs"].append(json.loads(e))
tmp=p+".tmp"
json.dump(d,open(tmp,"w"),indent=2)
os.replace(tmp,p)
PY
}

# ------------ phase: uninstall ------------
do_uninstall() {
  [ -f "$MANIFEST" ] || die "No manifest at $MANIFEST — nothing to uninstall."
  python3 - "$MANIFEST" "$DRY" <<'PY'
import json,sys,os,shutil
manifest_path,dry=sys.argv[1],sys.argv[2]=="1"
m=json.load(open(manifest_path))
for inst in m.get("installs",[]):
  for change in inst.get("modifications",[]):
    f=change["file"]; bak=change.get("backup")
    if dry:
      print(f"[dry] would restore {f} <- {bak}"); continue
    if bak and os.path.exists(bak):
      shutil.copy2(bak,f); print(f"restored {f}")
    elif change.get("created"):
      try: os.remove(f); print(f"removed {f}")
      except FileNotFoundError: pass
PY
  [ "$DRY" = 1 ] || rm "$MANIFEST" "$CRED_FILE" 2>/dev/null || true
  log "Uninstall done."
}

# ------------ phase: detect host ------------
detect_host() {
  if [ -f "$HOME/.claude.json" ] || [ -d "$HOME/.claude" ]; then
    HOST="claude-code"
    HOST_CONFIG="$HOME/.claude.json"
    HOOKS_FILE="$HOME/.claude/settings.json"
  elif [ -f "$HOME/.config/opencode/opencode.json" ]; then
    HOST="opencode"
    HOST_CONFIG="$HOME/.config/opencode/opencode.json"
  else
    cat <<EOF
No supported host detected (looked for ~/.claude.json, ~/.config/opencode/opencode.json).

Manual MCP server config:
  URL:    <printed below after OAuth>
  Header: Authorization: Bearer <token>
  Header: X-AgentChat-Device-Id: <device_id>
  Header: X-AgentChat-Framework: <claude-code|opencode>

Run again after installing one of: Claude Code (https://code.claude.com), OpenCode (https://opencode.ai).
EOF
    exit 0
  fi
  log "Detected host: $HOST"
}

# ------------ phase: device id ------------
ensure_device() {
  if [ -f "$DEVICE_FILE" ]; then
    DEVICE_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$DEVICE_FILE")"
  else
    DEVICE_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
    echo "{\"id\":\"$DEVICE_ID\"}" | atomic_write "$DEVICE_FILE"
    chmod 600 "$DEVICE_FILE"
  fi
  DEVICE_NAME="$(hostname)"
  log "Device: $DEVICE_NAME ($DEVICE_ID)"
}

# ------------ phase: register ------------
# Single-process flow: bind the loopback listener FIRST (no port-prediction
# race — Codex review LOW #23), then announce the auth URL, open the browser,
# then accept exactly one callback. Token never crosses the shell, so it
# doesn't appear in argv anywhere.
register() {
  ORIGIN="$(git -C "$PWD" remote get-url origin 2>/dev/null || true)"
  CWD="$PWD"
  ALIAS="$(basename "$CWD")"

  log "Opening loopback listener and browser..."
  REGFILE="$(mktemp -t agentchat-reg.XXXXXX)"
  trap 'rm -f "$REGFILE"' EXIT
  python3 - "$SERVER" "$ORIGIN" "$CWD" "$ALIAS" "$HOST" "$DEVICE_NAME" "$REGFILE" <<'PY'
import http.server, socketserver, sys, urllib.parse, webbrowser, json, threading, secrets

server, origin, cwd, alias, framework, device_name, regfile = sys.argv[1:8]
state = secrets.token_urlsafe(24)

captured = {}

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass

    def do_GET(self):
        q = urllib.parse.urlparse(self.path).query
        captured.update(urllib.parse.parse_qs(q))
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(
            b"<!doctype html><meta charset=utf-8>"
            b"<h2>AgentChat: token received.</h2>"
            b"<p>You can close this tab and return to your terminal.</p>"
        )

# Bind to an ephemeral port first; we own this port for the lifetime of
# the script — no TOCTOU window between predicting and binding.
srv = socketserver.TCPServer(("127.0.0.1", 0), H)
port = srv.server_address[1]
callback = f"http://127.0.0.1:{port}/done"
qs = urllib.parse.urlencode({
    "origin": origin, "cwd": cwd, "alias": alias,
    "framework": framework, "device_name": device_name,
    "callback": callback, "state": state,
})
auth_url = f"{server}/api/install?{qs}"
sys.stderr.write(f"[agentchat] Authorize: {auth_url}\n")
sys.stderr.write(f"[agentchat] Listening on 127.0.0.1:{port}\n")

# Open the browser in a daemon thread so it doesn't block the listener.
threading.Thread(target=webbrowser.open, args=(auth_url,), daemon=True).start()

# Serve exactly one request, then return.
srv.handle_request()

token = (captured.get("token") or [""])[0]
workspace_id = (captured.get("workspace_id") or [""])[0]
mcp_url = (captured.get("mcp_url") or [""])[0]
returned_state = (captured.get("state") or [""])[0]
if not (token and workspace_id and mcp_url):
    sys.stderr.write("[agentchat] Server didn't return token/workspace_id/mcp_url. Aborting.\n")
    sys.exit(2)
# Defense-in-depth: verify the callback corresponds to OUR auth request.
# Server >= batch-5 echoes back our state. Older servers won't, in which
# case we tolerate the absence rather than break old deployments — the
# server-side cookie binding still gates token issuance to the user's
# session.
if returned_state and returned_state != state:
    sys.stderr.write("[agentchat] State mismatch — callback does not correspond to this install request. Aborting.\n")
    sys.exit(2)

# Write to the regfile (chmod 600 by mktemp on macOS/Linux). This is the only
# medium that touches the bearer token at this layer; nothing goes through argv.
with open(regfile, "w") as f:
    json.dump({"token": token, "workspace_id": workspace_id, "mcp_url": mcp_url}, f)
PY
  chmod 600 "$REGFILE"
  TOKEN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$REGFILE")"
  WORKSPACE_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["workspace_id"])' "$REGFILE")"
  MCP_URL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["mcp_url"])' "$REGFILE")"
  [ -n "$TOKEN" ] && [ -n "$WORKSPACE_ID" ] && [ -n "$MCP_URL" ] || die "No token returned."
  log "Got workspace $WORKSPACE_ID, mcp_url $MCP_URL"
}

# ------------ phase: write artifacts ------------
write_credentials() {
  cat > "$CRED_FILE" <<EOF
{
  "user_workspace_token": "$TOKEN",
  "workspace_id": "$WORKSPACE_ID",
  "mcp_url": "$MCP_URL"
}
EOF
  chmod 600 "$CRED_FILE"
}

write_local_marker() {
  cat > "./.agentchat.json" <<EOF
{
  "version": 1,
  "workspace_id": "$WORKSPACE_ID",
  "_marker": "Powered by AgentChat — https://github.com/yrzhe/agentchat"
}
EOF
}

# Read a JSON file leniently — strip // line comments and trailing commas
# before parsing. Falls back to an empty dict if the file is missing or
# fundamentally non-JSON. If the file IS valid JSON but the root is not a
# dict, return the magic sentinel "__non_dict__" — callers must refuse to
# write rather than corrupting the user's existing array/string config.
# Codex review MED #16.
read_json_lenient_py() {
  cat <<'PY'
def read_lenient(path):
    import os, json, re
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return {}
    raw = open(path, encoding="utf-8").read()
    # Strip // line comments (vscode-style JSONC). Heuristic: only when the
    # // is at line start, after whitespace, or after a JSON delimiter — so
    # we don't accidentally cut a "//foo" inside a string value. Trade-off:
    # may still mangle strings that contain "} //" but those are rare in
    # MCP host configs (urls use http://... which are *inside* string
    # quotes after a `"key":` so they have a non-whitespace char before //).
    stripped = re.sub(r"(^|[\s,\[\{])//[^\n]*", r"\1", raw, flags=re.M)
    # Strip trailing commas: ,] or ,}
    stripped = re.sub(r",(\s*[}\]])", r"\1", stripped)
    try:
        d = json.loads(stripped)
    except Exception:
        # Try the raw content too — some files have // inside strings.
        try:
            d = json.loads(raw)
        except Exception:
            return None  # unparseable
    return d
PY
}

# Token is passed via env var AGENTCHAT_TOKEN to keep it out of argv.
# os.environ inspection is same-user only on standard kernels, narrower
# than `ps aux` which exposes argv globally on many Linux configs.
# Codex review MED #15.
write_host_config_claude() {
  HOST_BAK="$(backup_file "$HOST_CONFIG")"
  AGENTCHAT_TOKEN="$TOKEN" python3 - "$HOST_CONFIG" "$MCP_URL" "$DEVICE_ID" "$HOST" "$WORKSPACE_ID" <<PY
$(read_json_lenient_py)
import json, os, sys, socket
p, mcp, dev, hf, ws = sys.argv[1:6]
tok = os.environ["AGENTCHAT_TOKEN"]
d = read_lenient(p)
if d is None:
    sys.stderr.write(f"[agentchat] {p} is not parseable JSON/JSONC. Refusing to overwrite — please move it aside and re-run.\n")
    sys.exit(3)
if not isinstance(d, dict):
    sys.stderr.write(f"[agentchat] {p} root is {type(d).__name__}, not an object. Refusing to write mcpServers into it.\n")
    sys.exit(3)
d.setdefault("mcpServers", {})
if not isinstance(d["mcpServers"], dict):
    sys.stderr.write(f"[agentchat] {p} has mcpServers but it's {type(d['mcpServers']).__name__}, not an object.\n")
    sys.exit(3)
d["mcpServers"]["agentchat"] = {
    "type": "http", "url": mcp,
    "headers": {
        "Authorization": f"Bearer {tok}",
        "X-AgentChat-Device-Id": dev,
        "X-AgentChat-Framework": hf,
        "X-AgentChat-Device-Name": socket.gethostname(),
    },
}
tmp = p + ".tmp"
json.dump(d, open(tmp, "w"), indent=2)
os.replace(tmp, p)
PY

  HOOKS_BAK="$(backup_file "$HOOKS_FILE")"
  mkdir -p "$(dirname "$HOOKS_FILE")"
  python3 - "$HOOKS_FILE" <<PY
$(read_json_lenient_py)
import json, os, sys
p = sys.argv[1]
d = read_lenient(p)
if d is None:
    sys.stderr.write(f"[agentchat] {p} is not parseable JSON/JSONC. Skipping hook install.\n")
    sys.exit(0)
if not isinstance(d, dict):
    sys.stderr.write(f"[agentchat] {p} root is not an object. Skipping hook install.\n")
    sys.exit(0)
d.setdefault("hooks", {}).setdefault("SessionStart", [])
if not isinstance(d["hooks"], dict) or not isinstance(d["hooks"].get("SessionStart"), list):
    sys.stderr.write(f"[agentchat] {p} has unexpected hooks shape. Skipping.\n")
    sys.exit(0)
ss = d["hooks"]["SessionStart"]
# Drop any prior bogus entry from earlier installs that wrote
# {"type":"mcp_tool",...} which Claude Code's hooks schema rejects.
ss[:] = [
    h for h in ss
    if not (isinstance(h, dict) and h.get("type") == "mcp_tool" and h.get("tool") == "agentchat__check_inbox")
]
WANT = "$HOME/.agentchat/check-inbox.sh"
already = any(
    isinstance(e, dict) and isinstance(e.get("hooks"), list) and any(
        isinstance(h, dict) and h.get("command") == WANT
        for h in e["hooks"]
    )
    for e in ss
)
if not already:
    ss.append({"hooks": [{"type": "command", "command": WANT}]})
tmp = p + ".tmp"
json.dump(d, open(tmp, "w"), indent=2)
os.replace(tmp, p)
PY
}

write_check_inbox_script() {
  cat > "$AC_DIR/check-inbox.sh" <<'EOS'
#!/usr/bin/env bash
# AgentChat SessionStart hook (Claude Code).
# Fetches unread @-mentions and recent broadcasts so the agent starts the
# session aware of context. Silent if nothing to report. Hard 5s timeout;
# never blocks session start on network failure.
set -u
LC_ALL=C

CRED="$HOME/.agentchat/credentials.json"
DEVICE="$HOME/.agentchat/device.json"
[ -f "$CRED" ] || exit 0
[ -f "$DEVICE" ] || exit 0
command -v curl >/dev/null 2>&1 || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

read_json() {
  python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2],''))" "$1" "$2" 2>/dev/null
}

TOKEN="$(read_json "$CRED" user_workspace_token)"
MCP_URL="$(read_json "$CRED" mcp_url)"
DEVICE_ID="$(read_json "$DEVICE" id)"
DEVICE_NAME="$(hostname)"
[ -n "$TOKEN" ] && [ -n "$MCP_URL" ] && [ -n "$DEVICE_ID" ] || exit 0

INIT_HEADERS="$(mktemp -t agentchat-init.XXXXXX)"
trap 'rm -f "$INIT_HEADERS"' EXIT

curl -s --max-time 5 -o /dev/null -D "$INIT_HEADERS" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "X-AgentChat-Device-Id: $DEVICE_ID" \
  -H "X-AgentChat-Device-Name: $DEVICE_NAME" \
  -H "X-AgentChat-Framework: claude-code" \
  -X POST "$MCP_URL" \
  --data-raw '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"agentchat-session-start","version":"0.1.0"}}}' \
  || exit 0

SESSION_ID="$(awk -F': *' 'tolower($1)=="mcp-session-id" {gsub(/\r/,"",$2); print $2; exit}' "$INIT_HEADERS")"

CALL_RESP="$(curl -s --max-time 5 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  ${SESSION_ID:+-H "Mcp-Session-Id: $SESSION_ID"} \
  -H "X-AgentChat-Device-Id: $DEVICE_ID" \
  -H "X-AgentChat-Device-Name: $DEVICE_NAME" \
  -H "X-AgentChat-Framework: claude-code" \
  -X POST "$MCP_URL" \
  --data-raw '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check_inbox","arguments":{}}}')" || exit 0

python3 - "$CALL_RESP" 2>/dev/null << 'PY' || exit 0
import json, sys
raw = sys.argv[1]
if "data: " in raw:
    chunks = [line[len("data: "):] for line in raw.splitlines() if line.startswith("data: ")]
    payload = "\n".join(chunks)
else:
    payload = raw
try:
    msg = json.loads(payload)
except Exception:
    sys.exit(0)
result = msg.get("result", {}) or {}
sc = result.get("structuredContent", {}) or {}
unread = sc.get("unread_mentions") or []
recent = sc.get("recent_broadcasts") or []
if not unread and not recent:
    sys.exit(0)
print("=== AgentChat session pre-flight ===")
if unread:
    print(f"You have {len(unread)} unread @-mention(s) (auto-marked-read after this fetch):")
    for m in unread:
        sender = m.get("sender_agent_id") or m.get("sender_user_id") or "?"
        body = (m.get("body") or "").strip().replace("\n", " ")
        if len(body) > 240:
            body = body[:240] + "…"
        print(f"  - from {str(sender)[:8]}: {body}")
if recent:
    shown = recent[:3]
    print(f"Recent broadcasts in workspace ({len(recent)}, showing {len(shown)}):")
    for m in shown:
        sender = m.get("sender_agent_id") or m.get("sender_user_id") or "?"
        body = (m.get("body") or "").strip().replace("\n", " ")
        if len(body) > 200:
            body = body[:200] + "…"
        print(f"  - {str(sender)[:8]}: {body}")
print("=== end AgentChat ===")
PY
EOS
  chmod +x "$AC_DIR/check-inbox.sh"
}

write_host_config_opencode() {
  HOST_BAK="$(backup_file "$HOST_CONFIG")"
  mkdir -p "$(dirname "$HOST_CONFIG")"
  AGENTCHAT_TOKEN="$TOKEN" python3 - "$HOST_CONFIG" "$MCP_URL" "$DEVICE_ID" "$HOST" <<PY
$(read_json_lenient_py)
import json, os, sys, socket
p, mcp, dev, hf = sys.argv[1:5]
tok = os.environ["AGENTCHAT_TOKEN"]
d = read_lenient(p)
if d is None:
    sys.stderr.write(f"[agentchat] {p} is not parseable JSON/JSONC. Refusing to overwrite.\n")
    sys.exit(3)
if not isinstance(d, dict):
    sys.stderr.write(f"[agentchat] {p} root is not an object. Refusing to write.\n")
    sys.exit(3)
d.setdefault("mcp", {})
if not isinstance(d["mcp"], dict):
    sys.stderr.write(f"[agentchat] {p} has mcp but it's not an object.\n")
    sys.exit(3)
d["mcp"]["agentchat"] = {
    "type": "remote", "url": mcp,
    "headers": {
        "Authorization": f"Bearer {tok}",
        "X-AgentChat-Device-Id": dev,
        "X-AgentChat-Framework": hf,
        "X-AgentChat-Device-Name": socket.gethostname(),
    },
}
tmp = p + ".tmp"
json.dump(d, open(tmp, "w"), indent=2)
os.replace(tmp, p)
PY
}

write_agents_md() {
  for f in "./CLAUDE.md" "./AGENTS.md"; do
    BAK="$(backup_file "$f" || true)"
    BLOCK="<!-- AGENTCHAT v1 BEGIN — managed by install.sh, do not edit -->
## AgentChat Protocol
- Before any response, call \`agentchat__check_inbox\` if your last tool result showed \`_meta[\"agentchat/inbox\"].unread_mentions > 0\`.
- When @-mentioned, treat the message as a task. Reply via \`send_message\` with \`to: \"@<sender>\"\`.
- Never delete this section.
<!-- AGENTCHAT v1 END -->"
    python3 - "$f" "$BLOCK" <<'PY'
import re,sys,os
p,blk=sys.argv[1],sys.argv[2]
old=open(p).read() if os.path.exists(p) else ""
pat=re.compile(r"<!-- AGENTCHAT v1 BEGIN.*?AGENTCHAT v1 END -->", re.S)
if pat.search(old):
  new=pat.sub(blk, old)
else:
  new=(old.rstrip()+"\n\n"+blk+"\n") if old else blk+"\n"
tmp=p+".tmp"; open(tmp,"w").write(new); os.replace(tmp,p)
PY
  done
}

# ------------ phase: manifest ------------
record_manifest() {
  MODS=$(python3 - "$HOST_CONFIG" "$HOST_BAK" "$HOOKS_FILE" "${HOOKS_BAK:-}" <<'PY'
import json,sys,os
out=[]
for i in range(0,len(sys.argv)-1,2):
  f=sys.argv[1+i]; b=sys.argv[2+i]
  if not f: continue
  out.append({"file":f,"backup":(b or None),"created":not bool(b)})
print(json.dumps(out))
PY
)
  ENTRY="$(python3 - "$MODS" "$WORKSPACE_ID" "$HOST" "$DEVICE_ID" <<'PY'
import json,sys,time
print(json.dumps({"installed_at":int(time.time()),"workspace_id":sys.argv[2],"host":sys.argv[3],"device_id":sys.argv[4],"modifications":json.loads(sys.argv[1])+[{"file":"./.agentchat.json","backup":None,"created":True},{"file":"./CLAUDE.md","backup":None,"created":False},{"file":"./AGENTS.md","backup":None,"created":False}]}))
PY
)"
  manifest_record "$ENTRY"
}

# ------------ main ------------
main() {
  need git; need python3
  if [ "$UNINSTALL" = 1 ]; then do_uninstall; exit 0; fi

  detect_host
  ensure_device

  if [ "$DRY" = 1 ]; then
    log "Dry-run: would write"
    log "  $HOST_CONFIG"
    [ -n "${HOOKS_FILE:-}" ] && log "  $HOOKS_FILE"
    log "  ./.agentchat.json"
    log "  ./CLAUDE.md / ./AGENTS.md"
    log "  $CRED_FILE  (chmod 600)"
    exit 0
  fi

  if [ "$YES" != 1 ] && [ -t 0 ]; then
    printf "Proceed? [y/N] "
    read -r ans; [ "$ans" = "y" ] || [ "$ans" = "Y" ] || die "Aborted."
  fi

  register
  write_credentials
  write_check_inbox_script
  write_local_marker
  if [ "$HOST" = "claude-code" ]; then write_host_config_claude; else write_host_config_opencode; fi
  write_agents_md
  record_manifest

  log "Done. To uninstall: SERVER=$SERVER curl -fsSL $SERVER/install.sh | sh -s -- --uninstall"
}
main "$@"
