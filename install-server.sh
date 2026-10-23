#!/usr/bin/env bash
set -euo pipefail

ST_ROOT="${1:-$HOME/SillyTavern}"
PLUGINS_DIR="$ST_ROOT/plugins"
DEST="$PLUGINS_DIR/verba-server"
REPO_URL="${VERBA_SERVER_REPO_URL:-https://github.com/foreverharibo-boop/verba.git}"
REPO_BRANCH="${VERBA_SERVER_REPO_BRANCH:-main}"
BACKUP_ROOT="$ST_ROOT/.verba-server-backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
TEMP="$PLUGINS_DIR/.verba-server-install-${STAMP}-$$"

if [ ! -d "$ST_ROOT" ] || [ ! -f "$ST_ROOT/server.js" ]; then
  echo "SillyTavern 경로를 찾지 못했습니다: $ST_ROOT" >&2
  echo "사용법: bash install-server.sh /실제/SillyTavern/경로" >&2
  exit 1
fi
command -v git >/dev/null 2>&1 || { echo "git이 필요합니다." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js가 필요합니다." >&2; exit 1; }
mkdir -p "$PLUGINS_DIR" "$BACKUP_ROOT"
trap 'rm -rf "$TEMP"' EXIT

backup_dir() {
  local source="$1"
  local label="$2"
  local target="$BACKUP_ROOT/${label}-${STAMP}"
  local n=1
  while [ -e "$target" ]; do target="$BACKUP_ROOT/${label}-${STAMP}-$n"; n=$((n+1)); done
  mv "$source" "$target"
  echo "기존 폴더를 보존했습니다: $target"
}

is_verba_server_dir() {
  local dir="$1"
  [ -d "$dir" ] || return 1
  node - "$dir" <<'NODE' >/dev/null 2>&1
const fs=require('node:fs'),path=require('node:path');
const dir=process.argv[2];
const candidates=[];
const pkg=path.join(dir,'package.json');
if(fs.existsSync(pkg)){
  try{const value=JSON.parse(fs.readFileSync(pkg,'utf8'));if(value.main)candidates.push(path.join(dir,value.main));}catch{}
}
for(const name of ['index.cjs','index.js','index.mjs','server-plugin/index.cjs'])candidates.push(path.join(dir,name));
const found=candidates.some(file=>fs.existsSync(file)&&/\bid\s*:\s*['"]verba-server['"]/.test(fs.readFileSync(file,'utf8')));
process.exit(found?0:1);
NODE
}

verify_install() {
  local dir="$1"
  node - "$dir" <<'NODE'
const fs=require('node:fs'),path=require('node:path');
const dir=process.argv[2];
const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
const entry=path.join(dir,pkg.main||'');
if(pkg.main!=='server-plugin/index.cjs'||!fs.existsSync(entry))throw Error('Verba Server 설치 검증 실패');
const source=fs.readFileSync(entry,'utf8');
if(!/\bid\s*:\s*['"]verba-server['"]/.test(source))throw Error('Verba Server 진입점 검증 실패');
const server=JSON.parse(fs.readFileSync(path.join(dir,'server-plugin/package.json'),'utf8'));
console.log(`Verba Server ${server.version}`);
NODE
}

accepted_remote() {
  local remote="$1"
  [ "$remote" = "$REPO_URL" ] \
    || [ "$remote" = "https://github.com/foreverharibo-boop/verba.git" ] \
    || [ "$remote" = "https://github.com/foreverharibo-boop/verba" ] \
    || [ "$remote" = "git@github.com:foreverharibo-boop/verba.git" ]
}

updated=false
if [ -e "$DEST" ] \
  && git -C "$DEST" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  && [ "$(git -C "$DEST" rev-parse --show-toplevel 2>/dev/null)" = "$DEST" ]; then
  remote="$(git -C "$DEST" remote get-url origin 2>/dev/null || true)"
  if accepted_remote "$remote"; then
    git -C "$DEST" fetch origin "$REPO_BRANCH"
    git -C "$DEST" checkout "$REPO_BRANCH"
    git -C "$DEST" pull --ff-only origin "$REPO_BRANCH"
    verify_install "$DEST" >/dev/null
    updated=true
  fi
fi

if [ "$updated" != true ]; then
  rm -rf "$TEMP"
  git clone --depth 1 --single-branch --branch "$REPO_BRANCH" "$REPO_URL" "$TEMP"
  verify_install "$TEMP" >/dev/null

  # Only after the new download is complete and verified do we move
  # old/duplicate copies out of the active plugin directory.
  for candidate in "$PLUGINS_DIR"/*; do
    [ -e "$candidate" ] || continue
    [ "$candidate" = "$DEST" ] && continue
    [ "$candidate" = "$TEMP" ] && continue
    if is_verba_server_dir "$candidate"; then
      backup_dir "$candidate" "duplicate-$(basename "$candidate")"
    fi
  done
  if [ -e "$DEST" ]; then backup_dir "$DEST" "legacy-verba-server"; fi
  mv "$TEMP" "$DEST"
else
  for candidate in "$PLUGINS_DIR"/*; do
    [ -e "$candidate" ] || continue
    [ "$candidate" = "$DEST" ] && continue
    if is_verba_server_dir "$candidate"; then
      backup_dir "$candidate" "duplicate-$(basename "$candidate")"
    fi
  done
fi

version="$(node -p "require(process.argv[1]).version" "$DEST/server-plugin/package.json")"
echo "Verba Server $version Git 설치·업데이트 완료"
echo
echo "앞으로 새 폴더를 받을 필요가 없습니다."
echo "- SillyTavern 시작 시 enableServerPluginsAutoUpdate가 켜져 있으면 자동 업데이트"
echo "- 수동 업데이트: cd \"$ST_ROOT\" && node plugins.js update"
echo "SillyTavern 서버를 완전히 재시작해 주세요."
