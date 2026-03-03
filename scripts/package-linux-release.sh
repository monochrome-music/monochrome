#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "${script_dir}/.." && pwd)"

dist_dir="${project_root}/dist/Monochrome"
release_dir="${project_root}/release/linux-x64"

binary_src="${dist_dir}/Monochrome-linux_x64"
binary_dest="${release_dir}/Monochrome"

if [ ! -x "${binary_src}" ]; then
    echo "Missing built binary: ${binary_src}" >&2
    echo "Run 'npm run build' first." >&2
    exit 1
fi

rm -rf "${release_dir}"
mkdir -p "${release_dir}"

cp "${project_root}/neutralino.config.json" "${release_dir}/neutralino.config.json"
cp "${dist_dir}/resources.neu" "${release_dir}/resources.neu"
cp -r "${dist_dir}/extensions" "${release_dir}/extensions"
cp "${binary_src}" "${binary_dest}"
cp "${project_root}/scripts/linux-wayland-launcher.sh" "${release_dir}/Monochrome-launcher"

cat > "${release_dir}/Monochrome.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Version=1.0
Name=Monochrome
Comment=Monochrome music streaming app
Exec=sh -c 'cd "$(dirname "%k")" && ./Monochrome-launcher --detach'
Terminal=false
Categories=Audio;Player;
StartupNotify=true
EOF

chmod +x "${binary_dest}" "${release_dir}/Monochrome-launcher" "${release_dir}/Monochrome.desktop"

echo "Linux release prepared at: ${release_dir}"
echo "Launch with: ${release_dir}/Monochrome-launcher"
