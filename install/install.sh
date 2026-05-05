#!/usr/bin/env bash
# AgentChat installer — Claude Code + OpenCode (MVP)
# Usage:
#   curl -fsSL https://agentchat.app/install.sh | sh
#   SERVER=https://other.com curl -fsSL ... | sh -s -- [--uninstall|--dry-run|--yes]
set -eu
LC_ALL=C
SERVER="${SERVER:-https://agentchat.app}"

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

backup_file() {
  local f="$1"
  [ -f "$f" ] || return 0
  local bak="${f}.agentchat.bak.$(ts)"
  cp -p "$f" "$bak"
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
register() {
  ORIGIN="$(git -C "$PWD" remote get-url origin 2>/dev/null || true)"
  CWD="$PWD"
  ALIAS="$(basename "$CWD")"

  # Open a local listener for OAuth callback
  PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
  CALLBACK="http://127.0.0.1:${PORT}/done"

  # URL-encode params
  Q="$(python3 - <<PY "$ORIGIN" "$CWD" "$ALIAS" "$HOST" "$DEVICE_NAME" "$CALLBACK"
import sys, urllib.parse
print(urllib.parse.urlencode(dict(zip(["origin","cwd","alias","framework","device_name","callback"], sys.argv[1:]))))
PY
)"
  AUTH_URL="$SERVER/install?$Q"

  log "Opening browser to authorize: $AUTH_URL"
  if command -v open >/dev/null 2>&1; then open "$AUTH_URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$AUTH_URL"; fi
  echo "If the browser didn't open, visit the URL above."

  # Listen ONE callback then exit
  log "Waiting for callback on :$PORT ..."
  RESPONSE="$(python3 - "$PORT" <<'PY'
import http.server,socketserver,sys,urllib.parse
class H(http.server.BaseHTTPRequestHandler):
  def log_message(self,*a,**k): pass
  def do_GET(self):
    q=urllib.parse.urlparse(self.path).query
    sys.stdout.write(q); sys.stdout.flush()
    self.send_response(200); self.send_header("content-type","text/html"); self.end_headers()
    self.wfile.write(b"<h2>You can close this tab.</h2>")
    raise SystemExit
with socketserver.TCPServer(("127.0.0.1",int(sys.argv[1])),H) as srv: srv.handle_request()
PY
)"
  TOKEN="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.parse_qs(sys.argv[1]).get("token",[""])[0])' "$RESPONSE")"
  WORKSPACE_ID="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.parse_qs(sys.argv[1]).get("workspace_id",[""])[0])' "$RESPONSE")"
  MCP_URL="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.parse_qs(sys.argv[1]).get("mcp_url",[""])[0])' "$RESPONSE")"
  [ -n "$TOKEN" ] && [ -n "$WORKSPACE_ID" ] && [ -n "$MCP_URL" ] || die "Server didn't return a token. Aborting."
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
  "_marker": "Powered by AgentChat — https://agentchat.app"
}
EOF
}

write_host_config_claude() {
  HOST_BAK="$(backup_file "$HOST_CONFIG")"
  python3 - "$HOST_CONFIG" "$MCP_URL" "$TOKEN" "$DEVICE_ID" "$HOST" "$WORKSPACE_ID" <<'PY'
import json,sys,os,pathlib
p=sys.argv[1]; mcp=sys.argv[2]; tok=sys.argv[3]; dev=sys.argv[4]; hf=sys.argv[5]; ws=sys.argv[6]
d=json.load(open(p)) if os.path.exists(p) and os.path.getsize(p)>0 else {}
d.setdefault("mcpServers",{})
d["mcpServers"]["agentchat"]={
  "type":"http","url":mcp,
  "headers":{"Authorization":f"Bearer {tok}","X-AgentChat-Device-Id":dev,"X-AgentChat-Framework":hf,"X-AgentChat-Device-Name":__import__('socket').gethostname()},
}
tmp=p+".tmp"; json.dump(d,open(tmp,"w"),indent=2); os.replace(tmp,p)
PY

  HOOKS_BAK="$(backup_file "$HOOKS_FILE")"
  mkdir -p "$(dirname "$HOOKS_FILE")"
  python3 - "$HOOKS_FILE" <<'PY'
import json,os,sys
p=sys.argv[1]
d=json.load(open(p)) if os.path.exists(p) and os.path.getsize(p)>0 else {}
d.setdefault("hooks",{}).setdefault("SessionStart",[])
existing=[h for h in d["hooks"]["SessionStart"] if h.get("type")=="mcp_tool" and h.get("tool")=="agentchat__check_inbox"]
if not existing: d["hooks"]["SessionStart"].append({"type":"mcp_tool","tool":"agentchat__check_inbox"})
tmp=p+".tmp"; json.dump(d,open(tmp,"w"),indent=2); os.replace(tmp,p)
PY
}

write_host_config_opencode() {
  HOST_BAK="$(backup_file "$HOST_CONFIG")"
  mkdir -p "$(dirname "$HOST_CONFIG")"
  python3 - "$HOST_CONFIG" "$MCP_URL" "$TOKEN" "$DEVICE_ID" "$HOST" <<'PY'
import json,os,sys,socket
p=sys.argv[1]; mcp=sys.argv[2]; tok=sys.argv[3]; dev=sys.argv[4]; hf=sys.argv[5]
d=json.load(open(p)) if os.path.exists(p) and os.path.getsize(p)>0 else {}
d.setdefault("mcp",{})
d["mcp"]["agentchat"]={
  "type":"remote","url":mcp,
  "headers":{"Authorization":f"Bearer {tok}","X-AgentChat-Device-Id":dev,"X-AgentChat-Framework":hf,"X-AgentChat-Device-Name":socket.gethostname()},
}
tmp=p+".tmp"; json.dump(d,open(tmp,"w"),indent=2); os.replace(tmp,p)
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
  write_local_marker
  if [ "$HOST" = "claude-code" ]; then write_host_config_claude; else write_host_config_opencode; fi
  write_agents_md
  record_manifest

  log "Done. To uninstall: SERVER=$SERVER curl -fsSL $SERVER/install.sh | sh -s -- --uninstall"
}
main "$@"
