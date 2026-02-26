#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
binary_path="${script_dir}/Monochrome"
runtime_dir="${XDG_RUNTIME_DIR:-/tmp}"
lock_file="${runtime_dir}/monochrome-launcher.lock"
debug_flag="${MONOCHROME_LAUNCHER_DEBUG:-0}"

is_truthy() {
    case "${1,,}" in
        1 | true | yes | on)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

debug_log() {
    if is_truthy "${debug_flag}"; then
        printf '[Monochrome-launcher] %s\n' "$*" >&2
    fi
}

is_dark_theme_name() {
    local theme_name="${1,,}"
    [[ "${theme_name}" == *":dark" || "${theme_name}" == *"-dark" ]]
}

theme_candidate_exists() {
    local theme_name="$1"
    if [[ "${theme_name}" == *:* ]]; then
        theme_name="${theme_name%%:*}"
    fi
    theme_dir_exists "${theme_name}"
}

theme_dir_exists() {
    local theme_name="$1"
    [ -d "/usr/share/themes/${theme_name}" ] || \
        [ -d "${HOME}/.themes/${theme_name}" ] || \
        [ -d "${HOME}/.local/share/themes/${theme_name}" ]
}

prefer_dark_variant() {
    local theme_name="$1"
    local candidate=""

    if [ -z "${theme_name}" ]; then
        return
    fi

    if is_dark_theme_name "${theme_name}"; then
        if theme_candidate_exists "${theme_name}"; then
            printf '%s\n' "${theme_name}"
        fi
        return
    fi

    candidate="${theme_name}-dark"
    if theme_candidate_exists "${candidate}"; then
        printf '%s\n' "${candidate}"
        return
    fi

    candidate="${theme_name}:dark"
    if theme_candidate_exists "${candidate}"; then
        printf '%s\n' "${candidate}"
    fi
}

detect_dark_preference() {
    local color_scheme=""
    local xdg_config_home="${XDG_CONFIG_HOME:-${HOME}/.config}"
    local gtk3_settings="${xdg_config_home}/gtk-3.0/settings.ini"
    local gtk4_settings="${xdg_config_home}/gtk-4.0/settings.ini"
    local prefer_dark=""

    if command -v gsettings >/dev/null 2>&1; then
        color_scheme="$(gsettings get org.gnome.desktop.interface color-scheme 2>/dev/null || true)"
        color_scheme="${color_scheme//\'/}"
        color_scheme="${color_scheme//\"/}"
        if [ "${color_scheme}" = "prefer-dark" ]; then
            return 0
        fi
    fi

    prefer_dark="$(read_gtk_setting "${gtk3_settings}" "gtk-application-prefer-dark-theme")"
    if [ -z "${prefer_dark}" ]; then
        prefer_dark="$(read_gtk_setting "${gtk4_settings}" "gtk-application-prefer-dark-theme")"
    fi

    if [ "${prefer_dark}" = "1" ] || [ "${prefer_dark,,}" = "true" ]; then
        return 0
    fi

    return 1
}

pick_dark_fallback_theme() {
    local candidates=(
        "adw-gtk3-dark"
        "Adwaita-dark"
        "Breeze-Dark"
        "Yaru-dark"
        "Pop-dark"
        "Arc-Dark"
        "Materia-dark"
        "Adwaita:dark"
        "Breeze:dark"
    )

    local candidate
    for candidate in "${candidates[@]}"; do
        if theme_candidate_exists "${candidate}"; then
            printf '%s\n' "${candidate}"
            return
        fi
    done
}

read_gtk_setting() {
    local settings_file="$1"
    local setting_key="$2"

    if [ ! -f "${settings_file}"; then
        return
    fi

    awk -F '=' -v key="${setting_key}" '
        /^[[:space:]]*[#;]/ { next }
        {
            current_key = $1
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", current_key)
            if (current_key == key) {
                value = $2
                sub(/^[[:space:]]+/, "", value)
                sub(/[[:space:]]+$/, "", value)
                print value
                exit
            }
        }
    ' "${settings_file}"
}

detect_theme_from_gsettings() {
    if ! command -v gsettings >/dev/null 2>&1; then
        return
    fi

    local gtk_theme
    local color_scheme

    gtk_theme="$(gsettings get org.gnome.desktop.interface gtk-theme 2>/dev/null || true)"
    gtk_theme="${gtk_theme//\'/}"
    gtk_theme="${gtk_theme//\"/}"

    if [ -z "${gtk_theme}" ]; then
        return
    fi

    color_scheme="$(gsettings get org.gnome.desktop.interface color-scheme 2>/dev/null || true)"
    color_scheme="${color_scheme//\'/}"
    color_scheme="${color_scheme//\"/}"

    if [ "${color_scheme}" = "prefer-dark" ]; then
        gtk_theme="$(prefer_dark_variant "${gtk_theme}")"
    fi

    printf '%s\n' "${gtk_theme}"
}

detect_theme_from_gtk_settings() {
    local xdg_config_home="${XDG_CONFIG_HOME:-${HOME}/.config}"
    local gtk3_settings="${xdg_config_home}/gtk-3.0/settings.ini"
    local gtk4_settings="${xdg_config_home}/gtk-4.0/settings.ini"
    local gtk_theme=""
    local prefer_dark=""

    gtk_theme="$(read_gtk_setting "${gtk3_settings}" "gtk-theme-name")"
    if [ -z "${gtk_theme}" ]; then
        gtk_theme="$(read_gtk_setting "${gtk4_settings}" "gtk-theme-name")"
    fi

    prefer_dark="$(read_gtk_setting "${gtk3_settings}" "gtk-application-prefer-dark-theme")"
    if [ -z "${prefer_dark}" ]; then
        prefer_dark="$(read_gtk_setting "${gtk4_settings}" "gtk-application-prefer-dark-theme")"
    fi

    if [ -z "${gtk_theme}" ]; then
        return
    fi

    if [ "${prefer_dark}" = "1" ] || [ "${prefer_dark,,}" = "true" ]; then
        gtk_theme="$(prefer_dark_variant "${gtk_theme}")"
    fi

    printf '%s\n' "${gtk_theme}"
}

apply_system_gtk_theme() {
    if [ -n "${GTK_THEME:-}" ]; then
        debug_log "GTK_THEME preset by environment: ${GTK_THEME}"
        return
    fi

    local desktop_hint="${XDG_CURRENT_DESKTOP:-}:${DESKTOP_SESSION:-}"
    local desktop_hint_lower="${desktop_hint,,}"
    local gtk_theme=""
    local fallback_theme=""
    local prefers_dark=0

    debug_log "Desktop hint: ${desktop_hint}"

    if detect_dark_preference; then
        prefers_dark=1
        debug_log "Dark preference detected from system settings"
    fi

    if [[ "${desktop_hint_lower}" == *"gnome"* ]]; then
        gtk_theme="$(detect_theme_from_gsettings)"
    elif [[ "${desktop_hint_lower}" == *"kde"* || "${desktop_hint_lower}" == *"plasma"* ]]; then
        gtk_theme="$(detect_theme_from_gtk_settings)"
    fi

    if [ -z "${gtk_theme}" ]; then
        gtk_theme="$(detect_theme_from_gsettings)"
    fi

    if [ -z "${gtk_theme}" ]; then
        gtk_theme="$(detect_theme_from_gtk_settings)"
    fi

    if [ -n "${gtk_theme}" ] && ! theme_candidate_exists "${gtk_theme}"; then
        gtk_theme=""
    fi

    if [ "${prefers_dark}" -eq 1 ] && [ -n "${gtk_theme}" ] && ! is_dark_theme_name "${gtk_theme}"; then
        gtk_theme="$(prefer_dark_variant "${gtk_theme}")"
    fi

    if [ "${prefers_dark}" -eq 1 ] && [ -n "${gtk_theme}" ] && [[ "${gtk_theme,,}" == adwaita* ]] && theme_candidate_exists "adw-gtk3-dark"; then
        gtk_theme="adw-gtk3-dark"
        debug_log "Using adw-gtk3-dark to match GNOME dark headerbar styling"
    fi

    if [ -z "${gtk_theme}" ] || { [ "${prefers_dark}" -eq 1 ] && ! is_dark_theme_name "${gtk_theme}"; }; then
        fallback_theme="$(pick_dark_fallback_theme)"
        if [ -n "${fallback_theme}" ]; then
            gtk_theme="${fallback_theme}"
            debug_log "Using dark fallback GTK theme: ${gtk_theme}"
        fi
    fi

    if [ -n "${gtk_theme}" ]; then
        export GTK_THEME="${gtk_theme}"
        debug_log "Final GTK_THEME=${GTK_THEME}"
    else
        debug_log "No GTK theme override selected"
    fi
}

apply_decoration_preferences() {
    if [ -z "${GTK_CSD:-}" ]; then
        export GTK_CSD="1"
        debug_log "Forcing GTK_CSD=1 for client-side titlebar"
    else
        debug_log "GTK_CSD preset by environment: ${GTK_CSD}"
    fi
}

if [ ! -x "${binary_path}" ]; then
    echo "Monochrome binary not found or not executable: ${binary_path}" >&2
    exit 1
fi

if command -v flock >/dev/null 2>&1; then
    exec 9>"${lock_file}"
    if ! flock -n 9; then
        echo "Monochrome is already running." >&2
        exit 0
    fi
fi

apply_system_gtk_theme
apply_decoration_preferences

if [ -z "${GDK_BACKEND:-}" ]; then
    if [ "${XDG_SESSION_TYPE:-}" = "wayland" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
        export GDK_BACKEND="wayland"
    elif [ -n "${DISPLAY:-}" ]; then
        export GDK_BACKEND="x11"
    fi
fi

backend_value="${GDK_BACKEND:-}"
if [[ "${backend_value}" == *"wayland"* ]]; then
    export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
    if [ -e "/proc/driver/nvidia/version" ]; then
        export __NV_DISABLE_EXPLICIT_SYNC="${__NV_DISABLE_EXPLICIT_SYNC:-1}"
    fi
else
    export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
    export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"
fi

debug_log "Final backend env: GDK_BACKEND=${GDK_BACKEND:-unset}, GTK_THEME=${GTK_THEME:-unset}, GTK_CSD=${GTK_CSD:-unset}, WEBKIT_DISABLE_DMABUF_RENDERER=${WEBKIT_DISABLE_DMABUF_RENDERER:-unset}"

exec "${binary_path}" "$@"
