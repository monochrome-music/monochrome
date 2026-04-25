import { Player } from './player.js';
import { navigate } from './router.js';
import { getTrackArtists, escapeHtml } from './utils.js';
import { audioContextManager } from './audio-context.js';
import { showNotification } from './downloads.js';
import { SVG_PAUSE } from './icons.js';
import { partyBackend } from './party-backend.js';

class Modal {
    static async show({ title, content, actions = [] }) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal active';
            modal.style.zIndex = '10000';
            modal.innerHTML = `
                <div class="modal-overlay"></div>
                <div class="modal-content" style="max-width: 450px; text-align: center; padding: 2.5rem;">
                    <h3 style="margin-bottom: 1rem; font-size: 1.5rem;">${title}</h3>
                    <div class="modal-body" style="margin-bottom: 2rem; color: var(--muted-foreground); line-height: 1.5;">${content}</div>
                    <div class="modal-actions" style="display: flex; flex-direction: column; gap: 0.75rem;">
                        ${actions
                            .map(
                                (a, i) => `
                            <button class="btn-${a.type || 'secondary'} modal-action-btn" data-index="${i}" style="width: 100%; padding: 0.8rem; font-weight: 600;">${a.label}</button>
                        `
                            )
                            .join('')}
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const cleanup = (val) => {
                modal.remove();
                resolve(val);
            };

            modal.querySelectorAll('.modal-action-btn').forEach((btn) => {
                btn.onclick = () => {
                    const action = actions[btn.dataset.index];
                    if (action.callback) {
                        const result = action.callback(modal);
                        if (result !== false) cleanup(result ?? true);
                    } else {
                        cleanup(true);
                    }
                };
            });

            modal.querySelector('.modal-overlay').onclick = () => cleanup(false);
        });
    }

    static async alert(title, message) {
        return this.show({
            title,
            content: message,
            actions: [{ label: 'OK', type: 'primary' }],
        });
    }

    static async confirm(title, message, confirmLabel = 'Confirm', type = 'primary') {
        return this.show({
            title,
            content: message,
            actions: [
                { label: confirmLabel, type: type },
                { label: 'Cancel', type: 'secondary', callback: () => false },
            ],
        });
    }
}

const PARTY_GUEST_PROFILE_KEY = 'party_guest_profile';
const PARTY_HOSTED_IDS_KEY = 'party_guest_hosted_ids';

export class ListeningPartyManager {
    constructor() {
        this.currentParty = null;
        this.isHost = false;
        this.memberId = null;
        this.members = [];
        this.messages = [];
        this.requests = [];
        this.unsubscribeFunctions = [];
        this.syncInterval = null;
        this.pollInterval = null;
        this.heartbeatInterval = null;
        this.playbackRecoveryInterval = null;
        this.guestVisibilityHandler = null;
        this.guestCanPlayHandler = null;
        this.hostSyncCleanup = [];
        this.isJoining = false;
        this.isInternalSync = false;
        this.guestSyncInFlight = false;
        this.pendingGuestSyncState = null;
        this.guestTrackLoadState = {
            trackId: null,
            lastAttemptAt: 0,
        };
        this.originalSafePlay = null;
        this.originalPlayTrackFromQueue = null;
        this.playbackPromptOpen = false;
        this.pendingPlaybackResume = false;
        this.renderKeys = {
            header: '',
            track: '',
            members: '',
            requests: '',
        };

        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('create-party-btn')?.addEventListener('click', () => this.createParty());
        document.getElementById('leave-party-btn')?.addEventListener('click', () => this.leaveParty());
        document.getElementById('copy-party-link-btn')?.addEventListener('click', () => this.copyInviteLink());
        document.getElementById('party-chat-send-btn')?.addEventListener('click', () => this.sendChatMessage());
        document.getElementById('party-chat-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage().catch(console.error);
        });
    }

    getHostedPartyIds() {
        try {
            const ids = JSON.parse(localStorage.getItem(PARTY_HOSTED_IDS_KEY) || '[]');
            return Array.isArray(ids) ? ids : [];
        } catch {
            return [];
        }
    }

    addHostedPartyId(partyId) {
        const ids = this.getHostedPartyIds();
        if (!ids.includes(partyId)) {
            ids.push(partyId);
            localStorage.setItem(PARTY_HOSTED_IDS_KEY, JSON.stringify(ids.slice(-25)));
        }
    }

    removeHostedPartyId(partyId) {
        const ids = this.getHostedPartyIds().filter((id) => id !== partyId);
        localStorage.setItem(PARTY_HOSTED_IDS_KEY, JSON.stringify(ids));
    }

    isLocallyHostedParty(partyId) {
        return this.getHostedPartyIds().includes(partyId);
    }

    getCachedGuestProfile() {
        try {
            const cached = JSON.parse(localStorage.getItem(PARTY_GUEST_PROFILE_KEY) || 'null');
            if (cached?.name) return cached;
        } catch {
            // Ignore malformed cached guest profiles.
        }

        return null;
    }

    saveGuestProfile(name) {
        const safeName = name.trim() || 'Guest';
        const profile = {
            name: safeName,
            avatar_url: `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(safeName)}`,
        };
        localStorage.setItem(PARTY_GUEST_PROFILE_KEY, JSON.stringify(profile));
        return profile;
    }

    promptGuestProfile(title = 'Continue as Guest', description = 'Enter a nickname to use in listening parties.') {
        return new Promise((resolve, reject) => {
            const cached = this.getCachedGuestProfile();
            const defaultName = cached?.name || '';

            Modal.show({
                title,
                content: `
                    <p style="margin-bottom: 1rem;">${description}</p>
                    <input type="text" id="guest-name-input" class="template-input" value="${escapeHtml(defaultName)}" placeholder="Your nickname" style="width: 100%; text-align: center;">
                `,
                actions: [
                    {
                        label: 'Continue',
                        type: 'primary',
                        callback: (modal) => {
                            const name = modal.querySelector('#guest-name-input').value.trim() || 'Guest';
                            return { profile: this.saveGuestProfile(name) };
                        },
                    },
                    { label: 'Cancel', type: 'secondary', callback: () => false },
                ],
            })
                .then(resolve)
                .catch(reject);
        });
    }

    minifyItem(type, item) {
        if (!item) return item;

        if (type === 'track') {
            return {
                id: item.id,
                title: item.title || null,
                duration: item.duration || null,
                explicit: item.explicit || false,
                artist: item.artist || item.artists?.[0] || null,
                artists: item.artists?.map((a) => ({ id: a.id, name: a.name || null })) || [],
                album: item.album
                    ? {
                          id: item.album.id,
                          title: item.album.title || null,
                          cover: item.album.cover || null,
                          releaseDate: item.album.releaseDate || null,
                          artist: item.album.artist || null,
                      }
                    : null,
                cover: item.cover || item.album?.cover || null,
                artwork: item.artwork || item.cover || item.album?.cover || null,
                type: item.type || 'track',
            };
        }

        return item;
    }

    async createParty() {
        const nameInput = document.getElementById('party-name-input');
        const guestResult = await this.promptGuestProfile(
            'Host as Guest',
            'Choose the nickname your friends will see. This stays on this device.'
        );
        if (!guestResult) return;

        const profile = guestResult.profile || this.getCachedGuestProfile() || this.saveGuestProfile('Guest');
        const name = nameInput.value.trim() || `${profile.name}'s Party`;
        const player = Player.instance;
        const currentTrack = player.currentTrack ? this.minifyItem('track', player.currentTrack) : null;
        const partyData = {
            name: name,
            hostName: profile.name,
            hostAvatarUrl: profile.avatar_url,
            is_playing: player.currentTrack ? !player.activeElement.paused : false,
            playback_time: player.activeElement.currentTime || 0,
            playback_timestamp: Date.now(),
            queue: player.queue?.map((t) => this.minifyItem('track', t)) || [],
        };
        if (currentTrack) partyData.current_track = currentTrack;

        try {
            const party = await partyBackend.createParty(partyData);
            this.addHostedPartyId(party.id);
            navigate(`/party/${party.id}`);
        } catch (e) {
            console.error('Create error:', e);
            await Modal.alert(
                'Could Not Create Party',
                'The anonymous party backend is not available. Configure the fork deployment with a party backend before hosting parties.'
            );
        }
    }

    async joinParty(partyId) {
        if (this.currentParty?.id === partyId || this.isJoining) return;
        this.isJoining = true;

        try {
            const state = await partyBackend.getParty(partyId);
            const party = state.party;

            const confirmed = await this.showJoinModal();
            if (!confirmed) {
                this.isJoining = false;
                navigate('/parties');
                return;
            }

            this.currentParty = party;
            this.members = state.members || [];
            this.messages = state.messages || [];
            this.requests = state.requests || [];
            this.isHost = !!partyBackend.getHostToken(party.id) || this.isLocallyHostedParty(party.id);

            const profile = confirmed.profile || (await this.getMemberProfile());
            const memberData = {
                name: profile.name,
                avatar_url: profile.avatar_url,
                is_host: !!this.isHost,
                last_seen: Date.now(),
            };

            const member = await partyBackend.addMember(partyId, memberData);
            this.memberId = member.id;
            this.members = [member, ...this.members.filter((item) => item.id !== member.id)];

            this.setupSubscriptions(partyId);
            this.startHeartbeat();
            this.renderPartyUI();
            await this.loadInitialData(partyId);

            if (!this.isHost) {
                this.lockControls();
                this.setupGuestSyncInterception();
                this.setupGuestPlaybackRecovery();
                if (party.current_track) {
                    await audioContextManager.resume();
                    await this.syncWithHost(party);
                    await this.promptPlaybackUnlockIfNeeded(party);
                }
            }
        } catch (error) {
            console.error('Join error:', error);
            await Modal.alert('Error', 'Failed to join the party. It may have ended.');
            navigate('/parties');
        } finally {
            this.isJoining = false;
        }
    }

    setupGuestPlaybackRecovery() {
        this.teardownGuestPlaybackRecovery();

        const reconcilePlayback = async ({ allowPrompt = true } = {}) => {
            if (!this.currentParty || this.isHost || !this.currentParty.is_playing) return;

            const player = Player.instance;
            const el = player.activeElement;
            if (!el) return;

            if (document.visibilityState === 'hidden') {
                this.pendingPlaybackResume = true;
                return;
            }

            if (this.currentParty.current_track && String(player.currentTrack?.id || '') !== String(this.currentParty.current_track.id || '')) {
                await this.syncWithHost(this.currentParty);
                return;
            }

            const targetTime = this.getPartyPlaybackTargetTime(this.currentParty);
            if (Number.isFinite(targetTime) && Math.abs((el.currentTime || 0) - targetTime) > 0.75) {
                el.currentTime = targetTime;
            }

            if (el.paused) {
                const played = await player.safePlay(el);
                if (!played) {
                    this.pendingPlaybackResume = true;
                    if (allowPrompt) await this.promptPlaybackUnlockIfNeeded(this.currentParty);
                    return;
                }
            }

            this.pendingPlaybackResume = false;
            await this.forcePartyPlaybackPosition(this.currentParty);
        };

        this.guestVisibilityHandler = () => {
            if (document.visibilityState !== 'visible') return;
            if (!this.currentParty || this.isHost) return;

            if (this.pendingPlaybackResume || this.currentParty.is_playing) {
                void reconcilePlayback({ allowPrompt: true });
            }
        };

        this.guestCanPlayHandler = () => {
            if (!this.currentParty || this.isHost) return;
            if (this.pendingPlaybackResume || this.currentParty.is_playing) {
                void reconcilePlayback({ allowPrompt: false });
            }
        };

        document.addEventListener('visibilitychange', this.guestVisibilityHandler);
        Player.instance.activeElement.addEventListener('canplay', this.guestCanPlayHandler);

        this.playbackRecoveryInterval = setInterval(() => {
            if (!this.currentParty || this.isHost || !this.currentParty.is_playing) return;
            if (document.visibilityState !== 'visible') {
                this.pendingPlaybackResume = true;
                return;
            }
            void reconcilePlayback({ allowPrompt: false });
        }, 5000);

        this.unsubscribeFunctions.push(() => this.teardownGuestPlaybackRecovery());
    }

    teardownGuestPlaybackRecovery() {
        if (this.guestVisibilityHandler) {
            document.removeEventListener('visibilitychange', this.guestVisibilityHandler);
            this.guestVisibilityHandler = null;
        }
        if (this.guestCanPlayHandler) {
            Player.instance.activeElement.removeEventListener('canplay', this.guestCanPlayHandler);
            this.guestCanPlayHandler = null;
        }
        clearInterval(this.playbackRecoveryInterval);
        this.playbackRecoveryInterval = null;
    }

    async showJoinModal() {
        return new Promise((resolve, reject) => {
            const cached = this.getCachedGuestProfile();
            const defaultName = cached?.name || '';

            Modal.show({
                title: 'Join Party',
                content: `
                        <p style="margin-bottom: 1rem;">Enter a nickname to join the party!</p>
                        <input type="text" id="guest-name-input" class="template-input" value="${escapeHtml(defaultName)}" placeholder="Your nickname" style="width: 100%; text-align: center;">
                    `,
                actions: [
                    {
                        label: 'Join Party',
                        type: 'primary',
                        callback: (modal) => {
                            const name = modal.querySelector('#guest-name-input').value.trim() || 'Guest';
                            return { profile: this.saveGuestProfile(name) };
                        },
                    },
                    { label: 'Cancel', type: 'secondary', callback: () => false },
                ],
            })
                .then(resolve)
                .catch(reject);
        });
    }

    setupGuestSyncInterception() {
        const player = Player.instance;
        if (!this.originalSafePlay) this.originalSafePlay = player.safePlay.bind(player);
        player.safePlay = async (el) => {
            if (this.currentParty && !this.isHost && !this.currentParty.is_playing) return false;
            return await this.originalSafePlay(el);
        };
    }

    pauseAllPlayerMedia() {
        const player = Player.instance;
        [player.audio, player.video].filter(Boolean).forEach((media) => {
            try {
                media.pause();
            } catch {
                // Ignore media pause errors during sync transitions.
            }
        });
        player.updateMediaSessionPlaybackState();
    }

    isGuestTrackActuallyLoaded(party) {
        const player = Player.instance;
        if (String(player.currentTrack?.id || '') !== String(party?.current_track?.id || '')) {
            return false;
        }

        const el = player.activeElement;
        if (!el) return false;

        const hasSource = Boolean(el.currentSrc || el.src);
        const hasReadyMedia = el.readyState >= 2 || (Number.isFinite(el.duration) && el.duration > 0);
        const hasError = !!el.error;

        return hasSource && hasReadyMedia && !hasError;
    }

    shouldRetryGuestTrackLoad(party) {
        const targetId = String(party?.current_track?.id || '');
        if (!targetId) return false;
        if (this.isGuestTrackActuallyLoaded(party)) return false;

        const now = Date.now();
        const isSameAttempt = this.guestTrackLoadState.trackId === targetId;
        if (!isSameAttempt) {
            this.guestTrackLoadState = {
                trackId: targetId,
                lastAttemptAt: 0,
            };
            return true;
        }

        return now - this.guestTrackLoadState.lastAttemptAt > 1500;
    }

    async loadGuestPartyTrack(party, startTime) {
        const player = Player.instance;
        const cleanedTrack = { ...party.current_track };
        delete cleanedTrack.audioUrl;
        delete cleanedTrack.streamUrl;
        delete cleanedTrack.remoteUrl;

        this.guestTrackLoadState = {
            trackId: String(cleanedTrack.id || ''),
            lastAttemptAt: Date.now(),
        };

        this.pauseAllPlayerMedia();
        await player.setQueue([cleanedTrack], 0);
        await player.playTrackFromQueue(startTime);
        await this.forcePartyPlaybackPosition(party);
    }

    async getMemberProfile() {
        return this.getCachedGuestProfile() || this.saveGuestProfile('Guest');
    }

    setupSubscriptions(partyId) {
        this.unsubscribeFunctions.forEach((unsub) => unsub());
        this.unsubscribeFunctions = [];

        const unsubscribe = partyBackend.subscribeParty(partyId, {
            onOpen: () => {
                if (this.pollInterval) {
                    clearInterval(this.pollInterval);
                    this.pollInterval = null;
                }
            },
            onState: (state) => {
                void this.applyPartyState(state);
            },
            onDeleted: () => {
                void (async () => {
                    await Modal.alert('Party Ended', 'The host has ended the listening party.');
                    await this.leaveParty(false);
                })();
            },
            onClose: () => {
                if (!this.currentParty) return;
                console.warn('Party WebSocket disconnected; reconnecting...');
                this.startFallbackPolling(partyId);
            },
        });

        this.unsubscribeFunctions.push(unsubscribe);
    }

    async applyPartyState(state) {
        if (!state?.party || !this.currentParty) return;

        const knownMessageIds = new Set(this.messages.map((message) => message.id));
        this.currentParty = state.party;
        this.members = state.members || [];
        this.requests = state.requests || [];
        this.messages = state.messages || [];

        if (!this.isHost) await this.enqueueGuestSync(state.party);
        this.updatePartyHeader();
        this.renderMembers();
        this.renderRequests();

        const container = document.getElementById('party-chat-messages');
        if (container) {
            for (const message of this.messages) {
                if (!knownMessageIds.has(message.id)) this.addChatMessage(message);
            }
        }
    }

    async enqueueGuestSync(party) {
        this.pendingGuestSyncState = party;
        if (this.guestSyncInFlight) return;

        this.guestSyncInFlight = true;
        try {
            while (this.pendingGuestSyncState) {
                const nextParty = this.pendingGuestSyncState;
                this.pendingGuestSyncState = null;
                await this.syncWithHost(nextParty);
            }
        } finally {
            this.guestSyncInFlight = false;
        }
    }

    startFallbackPolling(partyId) {
        if (this.pollInterval) clearInterval(this.pollInterval);

        this.pollInterval = setInterval(() => {
            void (async () => {
                if (!this.currentParty) return;
                try {
                    const state = await partyBackend.getParty(partyId);
                    await this.applyPartyState(state);
                } catch (error) {
                    console.error('Party fallback poll error:', error);
                    clearInterval(this.pollInterval);
                    this.pollInterval = null;
                    if (!this.currentParty) return;
                    await Modal.alert('Party Ended', 'The party is no longer available.');
                    await this.leaveParty(false);
                }
            })();
        }, 3000);

        this.unsubscribeFunctions.push(() => {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        });
    }

    async loadInitialData() {
        this.renderMembers();
        this.renderRequests();
        const container = document.getElementById('party-chat-messages');
        if (container) {
            container.innerHTML = '';
            this.messages.forEach((m) => this.addChatMessage(m));
        }
    }

    async loadMembers() {
        const state = await partyBackend.getParty(this.currentParty.id);
        this.members = state.members || [];
        this.renderMembers();
    }

    async loadMessages() {
        const state = await partyBackend.getParty(this.currentParty.id);
        this.messages = state.messages || [];
        const container = document.getElementById('party-chat-messages');
        if (container) {
            container.innerHTML = '';
            this.messages.forEach((m) => this.addChatMessage(m));
        }
    }

    async loadRequests() {
        try {
            const state = await partyBackend.getParty(this.currentParty.id);
            this.requests = state.requests || [];
            this.renderRequests();
        } catch (e) {
            console.error('Failed to load requests:', e);
        }
    }

    renderPartyUI() {
        this.updatePartyHeader();
        this.renderMembers();
        this.renderRequests();
        this.showPartyIndicator();
        if (this.isHost) {
            this.unlockControls();
            this.setupHostPlayerSync();
        } else {
            this.lockControls();
            this.setupGuestPlayerInterferenceCheck();
        }
    }

    updatePartyHeader() {
        const titleEl = document.getElementById('party-title');
        const countEl = document.getElementById('party-member-count');
        const metaEl = document.getElementById('party-meta');
        const hostMember = this.members.find((member) => member.is_host);
        const hostName = this.currentParty.hostName || hostMember?.name || 'Guest host';
        const headerKey = JSON.stringify({
            name: this.currentParty.name,
            count: this.members.length,
            hostName,
        });

        if (this.renderKeys.header !== headerKey) {
            this.renderKeys.header = headerKey;
            if (titleEl) titleEl.textContent = this.currentParty.name;
            if (countEl) countEl.textContent = this.members.length;
            if (metaEl) metaEl.textContent = `Host: ${hostName}`;
        }

        const track = this.currentParty.current_track;
        const display = document.getElementById('party-current-track-display');
        if (display) {
            const trackKey = track
                ? JSON.stringify({
                      id: track.id,
                      title: track.title,
                      cover: track.artwork || track.cover || track.album?.cover,
                      isPlaying: this.currentParty.is_playing,
                  })
                : 'empty';
            if (this.renderKeys.track === trackKey) return;

            this.renderKeys.track = trackKey;
            if (track) {
                const api = Player.instance.api;
                const coverUrl = api.getCoverUrl(track.artwork || track.cover || track.album?.cover);
                display.innerHTML = `
                    <div class="track-item active" style="display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1.5rem; padding: 2rem; background: var(--background-secondary); border: 1px solid var(--border); border-radius: var(--radius)">
                        <img src="${coverUrl}" class="track-artwork" style="width: 250px; height: 250px; border-radius: var(--radius); object-fit: cover; box-shadow: 0 10px 30px rgba(0,0,0,0.3)">
                        <div class="track-info">
                            <div class="track-title" style="font-size: 1.8rem; font-weight: 700; margin-bottom: 0.5rem">${track.title}</div>
                            <div class="track-artist" style="font-size: 1.2rem; color: var(--muted-foreground)">${getTrackArtists(track)}</div>
                        </div>
                        ${
                            !this.currentParty.is_playing
                                ? `
                            <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--primary); font-weight: 600; text-transform: uppercase; letter-spacing: 1px; font-size: 0.9rem">
                                ${SVG_PAUSE(24)} Paused
                            </div>
                        `
                                : ''
                        }
                    </div>
                `;
            } else {
                display.innerHTML = `<div style="padding: 4rem 2rem; text-align: center; background: var(--background-secondary); border-radius: var(--radius); border: 1px dashed var(--border)"><div style="color: var(--muted-foreground); font-size: 1.2rem">Waiting for host to play music...</div></div>`;
            }
        }
    }

    renderMembers() {
        const list = document.getElementById('party-members-list');
        if (!list) return;
        const key = JSON.stringify(
            this.members.map((member) => ({
                id: member.id,
                name: member.name,
                avatar_url: member.avatar_url,
                is_host: member.is_host,
            }))
        );
        if (this.renderKeys.members === key) return;

        this.renderKeys.members = key;
        list.innerHTML = this.members
            .map(
                (m) =>
                    `<div class="member-item" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: var(--background-secondary); border-radius: var(--radius); border: 1px solid var(--border)"><img src="${m.avatar_url}" style="width: 40px; height: 40px; border-radius: 50%; background: var(--background-modifier-accent)"><div style="flex: 1; overflow: hidden"><div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${m.name}</div>${m.is_host ? '<div style="color: var(--primary); font-size: 0.7rem; font-weight: bold; text-transform: uppercase;">Host</div>' : '<div style="color: var(--muted-foreground); font-size: 0.7rem">Listening</div>'}</div></div>`
            )
            .join('');
    }

    renderRequests() {
        const list = document.getElementById('party-requests-list');
        if (!list) return;
        const key = JSON.stringify(
            this.requests.map((request) => ({
                id: request.id,
                trackId: request.track?.id,
                title: request.track?.title,
                cover: request.track?.artwork || request.track?.cover || request.track?.album?.cover,
                requested_by: request.requested_by,
            }))
        );
        if (this.renderKeys.requests === key) return;

        this.renderKeys.requests = key;
        if (this.requests.length === 0) {
            list.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--muted-foreground); font-size: 0.9rem">No requests yet. Right-click a song to request!</div>`;
            return;
        }

        list.innerHTML = this.requests
            .map((r) => {
                try {
                    const api = Player.instance.api;
                    const artists = getTrackArtists(r.track);
                    const coverUrl = api.getCoverUrl(r.track.artwork || r.track.cover || r.track.album?.cover);
                    return `<div class="track-item" style="display: flex; align-items: center; gap: 1rem; padding: 0.75rem; border-bottom: 1px solid var(--border)">
                    <img src="${coverUrl}" style="width: 48px; height: 48px; border-radius: 4px; object-fit: cover; flex-shrink: 0;">
                    <div class="track-info" style="flex: 1; min-width: 0;">
                        <div class="track-title" style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${r.track.title || 'Unknown Title'}</div>
                        <div class="track-artist" style="font-size: 0.8rem; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${artists} • Requested By ${r.requested_by || 'Member'}</div>
                    </div>
                    ${this.isHost ? `<button class="btn-primary btn-sm add-request-btn" data-req-id="${r.id}" style="padding: 0.4rem 1rem; font-size: 0.8rem; flex-shrink: 0; white-space: nowrap;">Add to Queue</button>` : ''}
                </div>`;
                } catch (_e) {
                    return '';
                }
            })
            .join('');

        if (this.isHost) {
            list.querySelectorAll('.add-request-btn').forEach((btn) =>
                btn.addEventListener('click', async (e) => {
                    const reqId = e.currentTarget.dataset.reqId;
                    const req = this.requests.find((r) => r.id === reqId);
                    if (req) {
                        Player.instance.addToQueue(req.track);
                        showNotification(`Added "${req.track.title}" to queue`);
                        await partyBackend.deleteRequest(this.currentParty.id, req.id);
                    }
                })
            );
        }
    }

    addChatMessage(msg) {
        const container = document.getElementById('party-chat-messages');
        if (!container) return;
        const div = document.createElement('div');
        div.className = 'chat-msg';

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        let content = escapeHtml(msg.content);

        content = content.replace(urlRegex, (url) => {
            if (url.match(/\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i)) {
                return `<a href="${url}" target="_blank" class="chat-link">${url}</a><img src="${url}" style="max-width: 100%; border-radius: 8px; margin-top: 8px; display: block; cursor: pointer" onclick="window.open('${url}')">`;
            }
            const ytMatch = url.match(
                /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
            );
            if (ytMatch) {
                return `<a href="${url}" target="_blank" class="chat-link">${url}</a><iframe style="width: 100%; aspect-ratio: 16/9; border-radius: 8px; margin-top: 8px; border: none" src="https://www.youtube.com/embed/${ytMatch[1]}" allowfullscreen></iframe>`;
            }
            if (url.match(/\.(mp4|webm|ogg)(\?.*)?$/i)) {
                return `<a href="${url}" target="_blank" class="chat-link">${url}</a><video controls style="max-width: 100%; border-radius: 8px; margin-top: 8px; display: block"><source src="${url}"></video>`;
            }
            if (url.includes('tenor.com/view/')) {
                return `<a href="${url}" target="_blank" class="chat-link">${url}</a><div class="tenor-embed" data-postid="${url.split('-').pop()}" data-share-method="host" data-aspect-ratio="1" data-width="100%"><script type="text/javascript" async src="https://tenor.com/embed.js"></script></div>`;
            }
            return `<a href="${url}" target="_blank" class="chat-link" style="color: var(--primary); text-decoration: underline;">${url}</a>`;
        });

        div.innerHTML = `
            <div style="font-weight: 600; font-size: 0.75rem; color: var(--primary); margin-bottom: 2px">${escapeHtml(msg.sender_name)}</div>
            <div style="background: var(--background-modifier-accent); padding: 0.6rem 0.8rem; border-radius: 0.75rem; display: inline-block; max-width: 100%; word-break: break-word; font-size: 0.9rem; line-height: 1.4">
                ${content}
            </div>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    async sendChatMessage() {
        const input = document.getElementById('party-chat-input');
        if (!input || !input.value.trim()) return;
        const content = input.value.trim();
        input.value = '';
        const profile = await this.getMemberProfile();
        try {
            const message = await partyBackend.addMessage(this.currentParty.id, { sender_name: profile.name, content });
            this.messages.push(message);
            this.addChatMessage(message);
        } catch (_e) {}
    }

    async requestSong(track) {
        if (!this.currentParty) return;
        const profile = await this.getMemberProfile();
        try {
            const minifiedTrack = this.minifyItem('track', track);
            await partyBackend.addRequest(this.currentParty.id, {
                track: minifiedTrack,
                requested_by: profile.name,
            });
            showNotification(`Requested "${track.title}"`);
        } catch (e) {
            console.error('Request error:', e);
        }
    }

    getPartyPlaybackTargetTime(party) {
        const baseTime = Number(party?.playback_time);
        if (!Number.isFinite(baseTime)) return 0;
        if (!party?.is_playing) return Math.max(0, baseTime);

        const playbackTimestamp = Number(party?.playback_timestamp);
        if (!Number.isFinite(playbackTimestamp)) return Math.max(0, baseTime);

        return Math.max(0, baseTime + (Date.now() - playbackTimestamp) / 1000);
    }

    async forcePartyPlaybackPosition(party) {
        const player = Player.instance;
        const el = player.activeElement;
        if (!el || !party?.current_track) return;

        const targetTime = this.getPartyPlaybackTargetTime(party);
        if (!Number.isFinite(targetTime)) return;

        if (el.readyState < 2) {
            await player.waitForCanPlayOrTimeout(el).catch(() => false);
        }

        if (Math.abs((el.currentTime || 0) - targetTime) > 0.25) {
            el.currentTime = targetTime;
        }

        el.dispatchEvent(new Event('timeupdate'));
        player.updateMediaSessionPositionState();
        player.updateMediaSessionPlaybackState();
    }

    async syncWithHost(party) {
        this.isInternalSync = true;
        try {
            const player = Player.instance;
            const el = player.activeElement;
            if (!party.current_track) {
                if (player.currentTrack) this.pauseAllPlayerMedia();
                return;
            }

            const currentId = String(player.currentTrack?.id || '');
            const targetId = String(party.current_track.id || '');

            if (currentId !== targetId) {
                await this.loadGuestPartyTrack(party, party.playback_time);
                if (!party.is_playing) this.pauseAllPlayerMedia();
                else if (el.paused) await this.promptPlaybackUnlockIfNeeded(party);
                return;
            }

            if (this.shouldRetryGuestTrackLoad(party)) {
                await this.loadGuestPartyTrack(party, party.playback_time);
                if (!party.is_playing) this.pauseAllPlayerMedia();
                else if (player.activeElement.paused) await this.promptPlaybackUnlockIfNeeded(party);
                return;
            }

            if (party.is_playing) {
                if (el.paused) {
                    const _success = await player.safePlay(el);
                    if (!_success) await this.promptPlaybackUnlockIfNeeded(party);
                }
                const targetTime = this.getPartyPlaybackTargetTime(party);
                if (Math.abs(el.currentTime - targetTime) > 1.2) el.currentTime = targetTime;
            } else {
                this.pauseAllPlayerMedia();
                const targetTime = this.getPartyPlaybackTargetTime(party);
                if (Math.abs(el.currentTime - targetTime) > 0.5) el.currentTime = targetTime;
            }
            el.dispatchEvent(new Event('timeupdate'));
            player.updateMediaSessionPositionState();
        } catch (e) {
            console.error('Sync error:', e);
        } finally {
            this.isInternalSync = false;
        }
    }

    async promptPlaybackUnlockIfNeeded(party) {
        const player = Player.instance;
        const el = player.activeElement;
        if (!party.is_playing || !el?.paused || this.playbackPromptOpen || this.isHost) return;
        if (document.visibilityState !== 'visible') {
            this.pendingPlaybackResume = true;
            return false;
        }

        this.playbackPromptOpen = true;
        try {
            const start = await Modal.confirm(
                'Start Listening',
                'Your browser blocked automatic party playback. Click start to sync with the host.',
                'Start Listening'
            );
            if (!start || !this.currentParty) return;

            await audioContextManager.resume();
            const targetTime = this.getPartyPlaybackTargetTime(this.currentParty);

            this.isInternalSync = true;
            const currentId = String(player.currentTrack?.id || '');
            const targetId = String(this.currentParty.current_track?.id || '');
            if (currentId !== targetId && this.currentParty.current_track) {
                await this.loadGuestPartyTrack(this.currentParty, targetTime);
            } else {
                if (Number.isFinite(targetTime) && targetTime > 0) el.currentTime = targetTime;
                await player.safePlay(el);
                await this.forcePartyPlaybackPosition(this.currentParty);
            }
            this.pendingPlaybackResume = false;
        } finally {
            this.isInternalSync = false;
            this.playbackPromptOpen = false;
        }
    }

    lockControls() {
        const selectors = [
            '.play-pause-btn',
            '#next-btn',
            '#prev-btn',
            '#shuffle-btn',
            '#repeat-btn',
            '#progress-bar',
            '#fs-play-pause-btn',
            '#fs-next-btn',
            '#fs-prev-btn',
            '#fs-shuffle-btn',
            '#fs-repeat-btn',
            '#fs-progress-bar',
        ];
        selectors.forEach((s) =>
            document.querySelectorAll(s).forEach((el) => {
                el.style.opacity = '0.5';
                el.style.pointerEvents = 'none';
            })
        );
    }

    unlockControls() {
        const selectors = [
            '.play-pause-btn',
            '#next-btn',
            '#prev-btn',
            '#shuffle-btn',
            '#repeat-btn',
            '#progress-bar',
            '#fs-play-pause-btn',
            '#fs-next-btn',
            '#fs-prev-btn',
            '#fs-shuffle-btn',
            '#fs-repeat-btn',
            '#fs-progress-bar',
        ];
        selectors.forEach((s) =>
            document.querySelectorAll(s).forEach((el) => {
                el.style.opacity = '1';
                el.style.pointerEvents = 'auto';
            })
        );
    }

    setupHostPlayerSync() {
        this.teardownHostPlayerSync();
        const player = Player.instance;
        const getPendingTrack = () => {
            const queue = player.getCurrentQueue ? player.getCurrentQueue() : player.queue;
            const pendingTrack = queue?.[player.currentQueueIndex] || null;
            if (!pendingTrack) return null;
            return this.minifyItem('track', pendingTrack);
        };

        const updateParty = async ({ forcePaused = false, pendingTrack = null, playbackTime = null } = {}) => {
            if (!this.currentParty || !this.isHost || this.isInternalSync) return;
            const el = player.activeElement;
            const sharedTrack = pendingTrack || (player.currentTrack ? this.minifyItem('track', player.currentTrack) : null);
            const derivedPlaybackTime =
                playbackTime ?? (Number.isFinite(el.currentTime) ? Math.max(0, el.currentTime) : 0);
            try {
                await partyBackend.updateParty(this.currentParty.id, {
                    current_track: sharedTrack,
                    is_playing: forcePaused ? false : !el.paused,
                    playback_time: derivedPlaybackTime,
                    playback_timestamp: Date.now(),
                    queue: player.queue?.map((t) => this.minifyItem('track', t)) || [],
                });
            } catch (_e) {}
        };
        ['play', 'pause', 'seeked'].forEach((ev) => {
            player.audio.addEventListener(ev, updateParty);
            if (player.video) player.video.addEventListener(ev, updateParty);
            this.hostSyncCleanup.push(() => {
                player.audio.removeEventListener(ev, updateParty);
                if (player.video) player.video.removeEventListener(ev, updateParty);
            });
        });
        if (!this.originalPlayTrackFromQueue) {
            this.originalPlayTrackFromQueue = player.playTrackFromQueue.bind(player);
        }
        player.playTrackFromQueue = async (...args) => {
            const startTime = Number(args[0]) || 0;
            const pendingTrack = getPendingTrack();
            const currentId = String(player.currentTrack?.id || '');
            const pendingId = String(pendingTrack?.id || '');
            const isTrackSwitch = !!pendingTrack && pendingId && pendingId !== currentId;

            if (!this.isInternalSync && isTrackSwitch) {
                await updateParty({
                    forcePaused: true,
                    pendingTrack,
                    playbackTime: startTime,
                });
            }

            const result = await this.originalPlayTrackFromQueue(...args);
            if (!this.isInternalSync) await updateParty();
            return result;
        };
        this.hostSyncCleanup.push(() => {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        });
        this.syncInterval = setInterval(updateParty, 2000);
    }

    teardownHostPlayerSync() {
        this.hostSyncCleanup.forEach((cleanup) => cleanup());
        this.hostSyncCleanup = [];
    }

    setupGuestPlayerInterferenceCheck() {
        const player = Player.instance;
        if (!this.originalPlayTrackFromQueue) {
            this.originalPlayTrackFromQueue = player.playTrackFromQueue.bind(player);
        }
        player.playTrackFromQueue = async (...args) => {
            if (this.currentParty && !this.isHost && !this.isInternalSync) {
                const leave = await Modal.confirm(
                    'Leave Party?',
                    'Playing a song will cause you to leave the listening party. Are you sure?',
                    'Leave and Play',
                    'danger'
                );
                if (!leave) return;
                await this.leaveParty();
            }
            return await this.originalPlayTrackFromQueue(...args);
        };
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(async () => {
            if (!this.memberId) return;
            try {
                await partyBackend.updateMember(this.currentParty.id, this.memberId, { last_seen: Date.now() });
            } catch (_e) {}
        }, 30000);
    }

    async leaveParty(shouldCleanup = true) {
        if (this.isHost && shouldCleanup) {
            const end = await Modal.confirm(
                'End Party?',
                'Leaving will end the party for everyone. Are you sure?',
                'End Party',
                'danger'
            );
            if (!end) return;
            try {
                await partyBackend.deleteParty(this.currentParty.id);
                this.removeHostedPartyId(this.currentParty.id);
            } catch (_e) {}
        } else if (this.memberId) {
            try {
                await partyBackend.deleteMember(this.currentParty.id, this.memberId);
            } catch (_e) {}
        }
        this.restorePlayerMethods();
        this.teardownHostPlayerSync();
        this.unlockControls();
        this.unsubscribeFunctions.forEach((unsub) => unsub());
        this.unsubscribeFunctions = [];
        clearInterval(this.pollInterval);
        clearInterval(this.syncInterval);
        clearInterval(this.heartbeatInterval);
        this.teardownGuestPlaybackRecovery();
        this.currentParty = null;
        this.isHost = false;
        this.memberId = null;
        this.renderKeys = {
            header: '',
            track: '',
            members: '',
            requests: '',
        };
        document.getElementById('party-indicator')?.remove();
        navigate('/parties');
    }

    restorePlayerMethods() {
        const player = Player.instance;
        if (this.originalSafePlay) {
            player.safePlay = this.originalSafePlay;
            this.originalSafePlay = null;
        }
        if (this.originalPlayTrackFromQueue) {
            player.playTrackFromQueue = this.originalPlayTrackFromQueue;
            this.originalPlayTrackFromQueue = null;
        }
    }

    copyInviteLink() {
        navigator.clipboard.writeText(`${window.location.origin}/party/${this.currentParty.id}`).catch(console.error);
        showNotification('Invite link copied!');
    }

    showPartyIndicator() {
        let indicator = document.getElementById('party-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'party-indicator';
            indicator.className = 'party-indicator-card';
            document.body.appendChild(indicator);
            indicator.onclick = () => navigate(`/party/${this.currentParty.id}`);
        }

        indicator.innerHTML = `
            <div class="party-indicator-content">
                <span class="party-indicator-label">Listening Party</span>
                <div class="party-indicator-name">${this.currentParty.name}</div>
            </div>
            <div class="party-indicator-count">${this.members.length}</div>
        `;
    }
}

export const partyManager = new ListeningPartyManager();
