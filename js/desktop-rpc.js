import { invoke } from "@tauri-apps/api/core";

window.updateDiscordRPC = async function (media) {
    if (!media) return;

    const audio = document.querySelector("audio");

    if (!audio) {
        console.log("[RPC] no audio element");
        return;
    }

    const position = Math.floor(audio.currentTime || 0);
    const duration = Math.floor(audio.duration || 0);

    if (!duration || duration === Infinity) {
        console.log("[RPC] waiting for duration");
        return;
    }

    try {
        await invoke("discord_update_song", {
            title: media.title || "Unknown Song",
            artist: media.artist || "Unknown Artist",
            artwork: media.artwork?.[0]?.src || "",
            position,
            duration,
            playing: !audio.paused
        });

        console.log(
            "[RPC] updated",
            media.title,
            position,
            "/",
            duration
        );
    } catch (error) {
        if (
            String(error).includes("not allowed by ACL") ||
            String(error).includes("command") &&
            String(error).includes("not allowed")
        ) {
            return;
        }

        console.error("[RPC] failed to update Discord:", error);
    }
};