#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "${script_dir}/.." && pwd)"

dist_dir="${project_root}/dist/Monochrome"
release_dir="${project_root}/release/mac"
app_dir="${release_dir}/Monochrome.app"
contents_dir="${app_dir}/Contents"
macos_dir="${contents_dir}/MacOS"
resources_dir="${contents_dir}/Resources"

binary_src="${dist_dir}/Monochrome-mac_universal"

if [ ! -f "${binary_src}" ]; then
    echo "Missing built binary: ${binary_src}" >&2
    echo "Run 'npm run build' first." >&2
    exit 1
fi

# Clean previous release
rm -rf "${release_dir}"
mkdir -p "${macos_dir}" "${resources_dir}"

# --- Generate .icns icon ---
assets_dir="${project_root}/public/assets"
iconset_dir="${project_root}/Monochrome.iconset"
rm -rf "${iconset_dir}"
mkdir -p "${iconset_dir}"

# Generate all required sizes from 1024.png using sips
source_icon="${assets_dir}/1024.png"
sips -z 16 16     "${source_icon}" --out "${iconset_dir}/icon_16x16.png"      > /dev/null 2>&1
sips -z 32 32     "${source_icon}" --out "${iconset_dir}/icon_16x16@2x.png"   > /dev/null 2>&1
sips -z 32 32     "${source_icon}" --out "${iconset_dir}/icon_32x32.png"      > /dev/null 2>&1
sips -z 64 64     "${source_icon}" --out "${iconset_dir}/icon_32x32@2x.png"   > /dev/null 2>&1
sips -z 128 128   "${source_icon}" --out "${iconset_dir}/icon_128x128.png"    > /dev/null 2>&1
sips -z 256 256   "${source_icon}" --out "${iconset_dir}/icon_128x128@2x.png" > /dev/null 2>&1
sips -z 256 256   "${source_icon}" --out "${iconset_dir}/icon_256x256.png"    > /dev/null 2>&1
sips -z 512 512   "${source_icon}" --out "${iconset_dir}/icon_256x256@2x.png" > /dev/null 2>&1
sips -z 512 512   "${source_icon}" --out "${iconset_dir}/icon_512x512.png"    > /dev/null 2>&1
cp "${source_icon}" "${iconset_dir}/icon_512x512@2x.png"

iconutil -c icns "${iconset_dir}" -o "${resources_dir}/Monochrome.icns"
rm -rf "${iconset_dir}"

# --- Create Info.plist ---
cat > "${contents_dir}/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.monochrome.app</string>
    <key>CFBundleName</key>
    <string>Monochrome</string>
    <key>CFBundleDisplayName</key>
    <string>Monochrome</string>
    <key>CFBundleExecutable</key>
    <string>Monochrome</string>
    <key>CFBundleIconFile</key>
    <string>Monochrome</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

# --- Copy application files into MacOS/ ---
cp "${binary_src}" "${macos_dir}/Monochrome"
cp "${project_root}/neutralino.config.json" "${macos_dir}/neutralino.config.json"
cp "${dist_dir}/resources.neu" "${macos_dir}/resources.neu"
cp -r "${dist_dir}/extensions" "${macos_dir}/extensions"

chmod +x "${macos_dir}/Monochrome"

echo "macOS release prepared at: ${app_dir}"
echo "Launch with: open ${app_dir}"
