#!/usr/bin/env bash
set -euo pipefail
verba_source="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
verba_st="${1:-$HOME/SillyTavern}"
if [[ ! -f "$verba_st/server.js" || ! -f "$verba_st/config.yaml" ]]; then
    echo "사용법: bash install-server.sh 실리태번폴더" >&2
    exit 1
fi
verba_st="$(cd -- "$verba_st" && pwd)"
verba_dest="$verba_st/plugins/verba-server"
if [[ -L "$verba_st/plugins" || -L "$verba_dest" || ( -e "$verba_dest" && ! -d "$verba_dest" ) ]]; then
    echo "plugins와 verba-server는 실제 폴더여야 합니다. 연결된 경로를 확인해 주세요." >&2
    exit 1
fi
# Prepare and validate the entire replacement before touching installed files.
# This is temporary staging, not a backup of the previous installation.
verba_stage="$(mktemp -d "$verba_st/.verba-install.XXXXXX")"
trap 'rm -rf -- "$verba_stage"' EXIT
mkdir -- "$verba_stage/engines"
verba_files=(package.json index.cjs jobs.cjs scene-report-compat.cjs provider.cjs engines/manifest.json engines/verba.mjs engines/verba-deep.mjs)
for verba_file in "${verba_files[@]}"; do
    cp -- "$verba_source/server-plugin/$verba_file" "$verba_stage/$verba_file"
done
cp -- "$verba_source/SERVER.md" "$verba_stage/README.md"
verba_files+=(README.md)
if [[ -f "$verba_source/LICENSE" ]]; then
    cp -- "$verba_source/LICENSE" "$verba_stage/LICENSE"
    verba_files+=(LICENSE)
fi
verba_version="$(node -e '
const fs=require("node:fs"),path=require("node:path"),root=process.argv[1];
const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
const manifest=JSON.parse(fs.readFileSync(path.join(root,"engines/manifest.json"),"utf8"));
if(pkg.name!=="verba-server" || !pkg.version || !manifest.engines.verba || !manifest.engines["verba-deep"])process.exit(1);
process.stdout.write(pkg.version);
' "$verba_stage")"
for verba_file in index.cjs jobs.cjs scene-report-compat.cjs provider.cjs engines/verba.mjs engines/verba-deep.mjs; do
    node --check "$verba_stage/$verba_file"
done
if [[ -L "$verba_dest/engines" || ( -e "$verba_dest/engines" && ! -d "$verba_dest/engines" ) ]]; then
    echo "기존 engines 경로가 실제 폴더가 아닙니다." >&2
    exit 1
fi
for verba_file in "${verba_files[@]}"; do
    if [[ -L "$verba_dest/$verba_file" || ( -e "$verba_dest/$verba_file" && ! -f "$verba_dest/$verba_file" ) ]]; then
        echo "교체할 파일의 경로를 확인해 주세요: $verba_file" >&2
        exit 1
    fi
done
mkdir -p -- "$verba_dest/engines"
# Only managed program files are replaced. Keep other files and ST settings.
# Run with SillyTavern stopped: the set of files is not a live-update transaction.
for verba_file in "${verba_files[@]}"; do
    mv -f -- "$verba_stage/$verba_file" "$verba_dest/$verba_file"
done
echo "Verba Server $verba_version 실험판 설치·업데이트 완료 (두 번역기 공용, 한 번만 설치)"
echo "config.yaml에서 enableServerPlugins: true를 확인하고 서버를 완전히 재시작해 주세요."
echo "동일한 실험판 확장의 개발자 모드에서 서버 번역 → 연결 확인을 누르고 켜세요. 자동 시작에는 답변 자동번역도 켜야 합니다."
echo "Silly Relay를 쓰는 경우 Relay 서버 1.0.6 이상이 필요합니다."
