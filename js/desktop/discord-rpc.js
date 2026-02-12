// js/desktop/discord-rpc.js
import { getTrackTitle, getTrackArtists } from '../utils.js';

export function initializeDiscordRPC(player) {
    const EXTENSION_ID = 'js.neutralino.discordrpc';

    function sendUpdate(track, isPaused = false) {
        if (!track) return;

        let coverUrl = 'monochrome';
        if (track.album?.cover) {
            const coverId = track.album.cover.replace(/-/g, '/');
            coverUrl = `https://resources.tidal.com/images/${coverId}/320x320.jpg`;
        }

        const data = {
            details: getTrackTitle(track),
            state: getTrackArtists(track),
            largeImageKey: coverUrl,
            largeImageText: track.album?.title || 'Monochrome',
            smallImageKey: isPaused ? 'pause' : 'play',
            smallImageText: isPaused ? 'Paused' : 'Playing',
            instance: false,
        };

        if (!isPaused && track.duration) {
            const now = Date.now();
            const elapsed = player.audio.currentTime * 1000;
            const remaining = (track.duration - player.audio.currentTime) * 1000;

            data.startTimestamp = Math.floor((now - elapsed) / 1000);
            data.endTimestamp = Math.floor((now + remaining) / 1000);
        }

        Neutralino.events.broadcast('discord:update', data).catch((e) => console.error('Broadcast failed', e));
        Neutralino.extensions
            .dispatch(EXTENSION_ID, 'discord:update', data)
            .catch((e) => console.error('Dispatch failed', e));
    }

    player.audio.addEventListener('play', () => {
        sendUpdate(player.currentTrack);
    });

    player.audio.addEventListener('pause', () => {
        sendUpdate(player.currentTrack, true);
    });

    player.audio.addEventListener('loadedmetadata', () => {
        if (!player.audio.paused) {
            sendUpdate(player.currentTrack);
        }
    });

    // Send initial status
    if (player.currentTrack) {
        sendUpdate(player.currentTrack, player.audio.paused);
    } else {
        Neutralino.events
            .broadcast('discord:update', {
                details: 'Idling',
                state: 'Monochrome',
                largeImageKey: 'monochrome',
                largeImageText: 'Monochrome',
                smallImageKey: 'pause',
                smallImageText: 'Paused',
            })
            .catch(() => {});
    }
}
