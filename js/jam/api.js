import { pb } from '../accounts/pocketbase.js';
import { authManager } from '../accounts/auth.js';

/**
 * Jam Session API
 * Handles interactions with PocketBase for jam_sessions and jam_invites collections.
 */

export const jamApi = {
    async createSession(track, state, position, queue, allowParticipantQueueing = true) {
        try {
            const user = authManager.user;
            if (!user) throw new Error("Must be logged in to create a jam session");

            const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

            const record = await pb.collection('jam_sessions').create({
                host: user.uid,
                current_track: track,
                playback_state: state,
                position: position,
                queue: queue,
                allow_participant_queueing: allowParticipantQueueing,
                participants: [user.uid], // Start with host
                token: token
            });

            return record;
        } catch (error) {
            console.error('[Jam API] Failed to create session:', error);
            throw error;
        }
    },

    async joinSession(sessionId) {
        try {
            const user = authManager.user;
            if (!user) throw new Error("Must be logged in to join a jam session");

            const record = await pb.collection('jam_sessions').getOne(sessionId);

            // Add user to participants if not already there
            let participants = record.participants || [];
            if (!participants.includes(user.uid)) {
                participants.push(user.uid);
                await pb.collection('jam_sessions').update(sessionId, {
                    participants: participants
                });
            }

            return record;
        } catch (error) {
            console.error('[Jam API] Failed to join session:', error);
            throw error;
        }
    },

    async leaveSession(sessionId) {
        try {
            const user = authManager.user;
            if (!user) return;

            const record = await pb.collection('jam_sessions').getOne(sessionId);
            let participants = record.participants || [];

            // Remove user from participants
            participants = participants.filter(id => id !== user.uid);

            if (participants.length === 0) {
                // If last participant leaves, delete session
                await pb.collection('jam_sessions').delete(sessionId);
            } else {
                await pb.collection('jam_sessions').update(sessionId, {
                    participants: participants
                });
            }
        } catch (error) {
            console.error('[Jam API] Failed to leave session:', error);
        }
    },

    async updateSessionState(sessionId, data) {
        try {
            await pb.collection('jam_sessions').update(sessionId, data);
        } catch (error) {
            console.error('[Jam API] Failed to update session:', error);
        }
    },

    async generateInvite(sessionId) {
        try {
            const record = await pb.collection('jam_sessions').getOne(sessionId);
            return { token: record.token };
        } catch (error) {
            console.error('[Jam API] Failed to get invite token:', error);
            throw error;
        }
    },

    async getSessionFromInvite(token) {
        try {
            const record = await pb.collection('jam_sessions').getFirstListItem(`token="${token}"`);
            return record.id;
        } catch (error) {
            console.error('[Jam API] Invalid invite token:', error);
            throw error;
        }
    }
};
