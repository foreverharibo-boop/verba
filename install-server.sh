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
if [[ -e "$verba_dest" || -L "$verba_dest" ]]; then
    echo "verba-server가 이미 있습니다. 서버를 종료하고 기존 폴더를 plugins 밖으로 백업한 뒤 다시 설치해 주세요." >&2
    exit 1
fi
mkdir -p -- "$verba_st/plugins"
mkdir -- "$verba_dest"
for verba_file in package.json index.cjs jobs.cjs provider.cjs; do
    cp -- "$verba_source/server-plugin/$verba_file" "$verba_dest/"
done
cp -R -- "$verba_source/server-plugin/engines" "$verba_dest/engines"
cp -- "$verba_source/SERVER.md" "$verba_dest/README.md"
if [[ -f "$verba_source/LICENSE" ]]; then cp -- "$verba_source/LICENSE" "$verba_dest/"; fi
echo "Verba Server 0.1.0 실험판 설치 완료 (두 번역기 공용, 한 번만 설치)"
echo "config.yaml에서 enableServerPlugins: true를 확인하고 서버를 완전히 재시작해 주세요."
echo "동일한 실험판 확장을 설치한 뒤 자동번역 → 서버 번역 → 연결 확인을 누르고 켜세요."
echo "Silly Relay를 쓰는 경우 Relay 서버도 1.0.6으로 업데이트해야 합니다."
