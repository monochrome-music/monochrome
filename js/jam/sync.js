import { pb } from '../accounts/pocketbase.js';
import { jamApi } from './api.js';

/**
 * Jam Sync Manager
 * Handles real-time synchronization between PocketBase and the local Player instance.
 */

export class JamSyncManager {
    constructor(player) {
        this.player = player;
        this.activeSessionId = null;
        this.unsubscribe = null;
        this.isHost = false;

        // Flag to prevent infinite loops when receiving updates
        this._isApplyingUpdate = false;

        // Host queue control
        this.allowParticipantQueueing = true;
    }

    async startSession() {
        if (this.activeSessionId) return;

        try {
            const track = this.player.currentTrack;
            const state = this.player.audio.paused ? 'paused' : 'playing';
            const position = this.player.audio.currentTime;
            const queue = this.player.queue || [];

            const session = await jamApi.createSession(track, state, position, queue);
            this.activeSessionId = session.id;
            this.isHost = true;

            await this.subscribeToSession();

            // Dispatch event for UI
            window.dispatchEvent(new CustomEvent('jam-session-started', {
                detail: { sessionId: this.activeSessionId }
            }));

            return this.activeSessionId;
        } catch (error) {
            console.error('[Jam Sync] Failed to start session:', error);
            throw error;
        }
    }

    async joinSession(sessionId) {
        if (this.activeSessionId === sessionId) return;

        if (this.activeSessionId) {
            await this.leaveSession();
        }

        try {
            const session = await jamApi.joinSession(sessionId);
            this.activeSessionId = session.id;
            this.isHost = false;

            // Apply initial state
            await this.applySessionState(session);

            await this.subscribeToSession();

            // Dispatch event for UI
            window.dispatchEvent(new CustomEvent('jam-session-joined', {
                detail: { sessionId: this.activeSessionId }
            }));

            return this.activeSessionId;
        } catch (error) {
            console.error('[Jam Sync] Failed to join session:', error);
            throw error;
        }
    }

    async leaveSession() {
        if (!this.activeSessionId) return;

        try {
            await jamApi.leaveSession(this.activeSessionId);

            if (this.unsubscribe) {
                await this.unsubscribe();
                this.unsubscribe = null;
            }

            const oldId = this.activeSessionId;
            this.activeSessionId = null;
            this.isHost = false;

            window.dispatchEvent(new CustomEvent('jam-session-left', {
                detail: { sessionId: oldId }
            }));
        } catch (error) {
            console.error('[Jam Sync] Failed to leave session:', error);
        }
    }

    async subscribeToSession() {
        if (!this.activeSessionId) return;

        this.unsubscribe = await pb.collection('jam_sessions').subscribe(this.activeSessionId, (e) => {
            console.log('[Jam Sync] Received update:', e.action, e.record);
            if (e.action === 'update') {
                if (!this.isHost) {
                    // Non-hosts apply full updates automatically
                    this.applySessionState(e.record);
                } else if (e.record.queue && JSON.stringify(e.record.queue) !== JSON.stringify(this.player.queue)) {
                    // Host received a queue update from a participant
                    if (this.allowParticipantQueueing) {
                        this._isApplyingUpdate = true;
                        this.player.setQueue(e.record.queue, this.player.currentQueueIndex >= 0 ? this.player.currentQueueIndex : 0);
                        this._isApplyingUpdate = false;
                    } else {
                        // Reject: rebroadcast Host's true queue to override the participant's change
                        this.broadcastStateUpdate({ queue: this.player.queue });
                    }
                }
            } else if (e.action === 'delete') {
                // Session was ended
                this.handleSessionEnded();
            }
        });
    }

    handleSessionEnded() {
        console.log('[Jam Sync] Session ended by host');
        this.leaveSession();
        alert("The Jam session has been ended.");
    }

    async applySessionState(record) {
        this._isApplyingUpdate = true;
        try {
            const { current_track, playback_state, position, queue } = record;

            // Sync Host Queue Control flag
            if (record.allow_participant_queueing !== undefined && this.allowParticipantQueueing !== record.allow_participant_queueing) {
                this.allowParticipantQueueing = record.allow_participant_queueing;
                window.dispatchEvent(new CustomEvent('jam-permissions-changed', {
                    detail: { allowParticipantQueueing: this.allowParticipantQueueing }
                }));
            }

            // Sync queue
            if (queue && JSON.stringify(queue) !== JSON.stringify(this.player.queue)) {
                this.player.setQueue(queue, 0);
            }

            // Sync track
            let shouldPlay = playback_state === 'playing';
            if (current_track) {
                const isDifferentTrack = !this.player.currentTrack || this.player.currentTrack.id !== current_track.id;

                if (isDifferentTrack) {
                    // Start playing the new track from its position in the queue
                    let trackIndex = -1;
                    if (queue) {
                        trackIndex = queue.findIndex(t => t.id === current_track.id);
                    }
                    if (trackIndex === -1 && this.player.queue) {
                        trackIndex = this.player.queue.findIndex(t => t.id === current_track.id);
                    }

                    if (trackIndex !== -1) {
                        await this.player.playTrackFromQueue(trackIndex, 0);
                    } else {
                        // Fallback: If track is not in queue at all, add it and play
                        this.player.setQueue([current_track], 0);
                        await this.player.playTrackFromQueue(0, 0);
                    }
                }
            }

            // Sync position if difference is > 2 seconds
            if (position !== undefined && typeof position === 'number') {
                if (Math.abs(this.player.audio.currentTime - position) > 2) {
                    this.player.audio.currentTime = position;
                }
            }

            // Sync play/pause state
            if (shouldPlay && this.player.audio.paused) {
                await this.player.audio.play().catch(e => console.error("Playback failed (autoplaying might be blocked):", e));
            } else if (!shouldPlay && !this.player.audio.paused) {
                this.player.audio.pause();
            }

        } catch (error) {
            console.error('[Jam Sync] Error applying state:', error);
        } finally {
            this._isApplyingUpdate = false;
        }
    }

    // --- Hooks called from Player interceptors ---

    async broadcastStateUpdate(data) {
        if (!this.activeSessionId || this._isApplyingUpdate) return;

        try {
            await jamApi.updateSessionState(this.activeSessionId, data);
        } catch (e) {
            console.error('[Jam Sync] Broadcast failed', e);
        }
    }

    async toggleParticipantQueueing(allow) {
        if (!this.isHost || !this.activeSessionId) return;
        this.allowParticipantQueueing = allow;
        await this.broadcastStateUpdate({ allow_participant_queueing: allow });
    }

    onPlay() {
        this.broadcastStateUpdate({ playback_state: 'playing', position: this.player.audio.currentTime });
    }

    onPause() {
        this.broadcastStateUpdate({ playback_state: 'paused', position: this.player.audio.currentTime });
    }

    onSeek(position) {
        this.broadcastStateUpdate({ position: position });
    }

    onTrackChanged(track) {
        this.broadcastStateUpdate({
            current_track: track,
            position: 0,
            playback_state: 'playing',
            queue: typeof this.player.getCurrentQueue === 'function' ? this.player.getCurrentQueue() : this.player.queue
        });
    }

    onQueueChanged() {
        this.broadcastStateUpdate({ queue: typeof this.player.getCurrentQueue === 'function' ? this.player.getCurrentQueue() : this.player.queue });
    }
}
