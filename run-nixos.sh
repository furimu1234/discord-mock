#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
使い方: ./run-nixos.sh [AppImageのパス] [アプリに渡す引数...]

引数なしでは release/desktop の Linux AppImage を起動します。
例: ./run-nixos.sh
    ./run-nixos.sh ./path/to/discord-mock.AppImage

ビルドは自動実行しません。必要な場合は先に pnpm build:linux を実行してください。
EOF
}

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  usage
  exit 0
fi

project_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

if (($#)); then
  appimage=$1
  shift
else
  shopt -s nullglob
  appimages=("$project_dir"/release/desktop/*-linux-x86_64.AppImage)
  if ((${#appimages[@]} == 0)); then
    printf '%s\n' 'AppImage がありません。先に pnpm build:linux を実行してください。' >&2
    exit 1
  fi
  if ((${#appimages[@]} > 1)); then
    printf '%s\n' 'AppImage が複数あります。起動するファイルのパスを指定してください。' >&2
    exit 1
  fi
  appimage=${appimages[0]}
fi

if [[ $appimage != /* ]]; then
  appimage="$PWD/$appimage"
fi
if [[ ! -f $appimage || ! -r $appimage ]]; then
  printf 'AppImage を読み取れません: %s\n' "$appimage" >&2
  exit 1
fi
if ! command -v nix-shell >/dev/null 2>&1; then
  printf '%s\n' 'nix-shell が見つかりません。NixOS / Nix の環境から実行してください。' >&2
  exit 127
fi

# --run is interpreted by Bash. Quote each argument, including paths with spaces.
printf -v launch_command '%q ' env -u ELECTRON_RUN_AS_NODE appimage-run "$appimage" "$@"
exec nix-shell "$project_dir/shell.nix" --arg desktop true --run "exec $launch_command"
