console.log("[RPC] listener loaded");

setInterval(() => {

    const media = navigator.mediaSession?.metadata;

    if (!media) {
        return;
    }

    console.log("[RPC] listener update:", media.title);

    if (window.updateDiscordRPC) {
        window.updateDiscordRPC(media);
    }

}, 1000);