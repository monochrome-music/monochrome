import { pb, syncManager } from './accounts/pocketbase.js';
import { authManager } from './accounts/auth.js';
import { Player } from './player.js';
import { navigate } from './router.js';
import { getTrackArtists, escapeHtml } from './utils.js';
import { audioContextManager } from './audio-context.js';
import { showNotification } from './downloads.js';
import { SVG_PAUSE } from './icons.js';

export const LISTENING_PARTIES_DISABLED_MESSAGE =
    'Listening parties are temporarily disabled while the new server implementation is being built. Library, profiles, themes, and playlists still work normally.';

export function areListeningPartiesDisabled() {
    const flags = window.__FEATURE_FLAGS__ || {};
    if (typeof flags.listeningParties === 'boolean') return !flags.listeningParties;
    if (typeof flags.listeningPartiesDisabled === 'boolean') return flags.listeningPartiesDisabled;
    return true;
}

const LISTENING_PARTIES_DISABLED = areListeningPartiesDisabled();

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
        this.heartbeatInterval = null;
        this.isJoining = false;
        this.isLeaving = false;
        this.isInternalSync = false;
        this.originalSafePlay = null;

        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('create-party-btn')?.addEventListener('click', () => this.createParty());
        document.getElementById('leave-party-btn')?.addEventListener('click', () => this.leaveParty());
        document.getElementById('copy-party-link-btn')?.addEventListener('click', () => this.copyInviteLink());
        document.getElementById('party-chat-send-btn')?.addEventListener('click', () => this.sendChatMessage());
        const chatInput = document.getElementById('party-chat-input');
        chatInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage().catch(console.error);
        });
        chatInput?.addEventListener('input', () => this._pingTyping());
        chatInput?.addEventListener('blur', () => this._clearTyping());

        if (LISTENING_PARTIES_DISABLED) {
            this.maintenanceMode = true;
            this.maintenanceMessage = LISTENING_PARTIES_DISABLED_MESSAGE;
            const createBtn = document.getElementById('create-party-btn');
            const nameInput = document.getElementById('party-name-input');
            const hostControls = document.getElementById('parties-host-controls');
            const disabledNotice = document.getElementById('parties-disabled-notice');
            if (createBtn) {
                createBtn.textContent = 'Temporarily Disabled';
                createBtn.disabled = true;
                createBtn.style.opacity = '0.5';
                createBtn.style.cursor = 'not-allowed';
            }
            if (nameInput) {
                nameInput.disabled = true;
                nameInput.placeholder = 'Hosting temporarily disabled';
            }
            if (hostControls) hostControls.style.display = 'none';
            if (disabledNotice) disabledNotice.style.display = 'block';
        }
    }

    async createParty() {
        if (this.maintenanceMode) {
            await Modal.alert('Under Maintenance', this.maintenanceMessage);
            return;
        }

        const nameInput = document.getElementById('party-name-input');
        const user = authManager.user;

        let pbUser = null;
        if (user) {
            pbUser = await syncManager._getUserRecord(user.$id);
            if (!pbUser) {
                await Modal.alert('Sync Error', 'Failed to sync user data. Please try again.');
                return;
            }
        }

        const ownerName = pbUser?.display_name?.trim() || pbUser?.username?.trim();
        const fallbackPartyName = ownerName ? `${ownerName}'s Party` : 'Listening Party';
        const name = nameInput.value.trim() || fallbackPartyName;
        const player = Player.instance;
        const currentTrack = player.currentTrack ? syncManager._minifyItem('track', player.currentTrack) : null;
        const guestHostToken = user ? null : this._generateHostToken();
        const partyData = {
            name: name,
            is_playing: player.currentTrack ? !player.activeElement.paused : false,
            playback_time: player.activeElement.currentTime || 0,
            playback_timestamp: Date.now(),
            queue: player.queue?.map((t) => syncManager._minifyItem('track', t)) || [],
        };
        if (pbUser?.id) partyData.host = pbUser.id;
        if (guestHostToken) partyData.guest_host_token = guestHostToken;
        if (currentTrack) partyData.current_track = currentTrack;

        const f_id = user ? user.$id : guestHostToken;

        try {
            const party = await pb.collection('parties').create(partyData, { f_id });
            if (guestHostToken) this._rememberHostToken(party.id, guestHostToken);
            navigate(`/party/${party.id}`);
        } catch (e) {
            console.error('Create error:', e);
            await Modal.alert('Error', 'Failed to create the party. Please try again.');
        }
    }

    async joinParty(partyId) {
        if (this.maintenanceMode) {
            await Modal.alert('Listening Parties Disabled', this.maintenanceMessage);
            navigate('/parties');
            return;
        }
        if (this.currentParty?.id === partyId || this.isJoining) return;
        this.isJoining = true;

        try {
            const user = authManager.user;
            const f_id = user ? user.$id : 'guest';
            const party = await pb.collection('parties').getOne(partyId, { expand: 'host', f_id });

            const pbUser = user ? await syncManager._getUserRecord(user.$id) : null;
            this.isHost = this._isPartyHost(party, pbUser);

            const existingMember = await this.findExistingMember(partyId, pbUser);

            let confirmed;
            if (existingMember) {
                confirmed = {
                    profile: { name: existingMember.name, avatar_url: existingMember.avatar_url },
                };
            } else {
                confirmed = await this.showJoinModal(user, pbUser);
                if (!confirmed) {
                    this.isJoining = false;
                    navigate('/parties');
                    return;
                }
            }

            this.currentParty = party;

            const profile = confirmed.profile || (await this.getMemberProfile(pbUser));
            const memberData = {
                party: partyId,
                name: profile.name,
                avatar_url: profile.avatar_url,
                is_host: !!this.isHost,
                last_seen: Date.now(),
            };
            if (pbUser?.id) memberData.user = pbUser.id;

            let member;
            if (existingMember) {
                try {
                    member = await pb
                        .collection('party_members')
                        .update(existingMember.id, { last_seen: Date.now(), is_host: !!this.isHost }, { f_id });
                } catch (_e) {
                    member = await pb.collection('party_members').create(memberData, { f_id });
                }
            } else {
                member = await pb.collection('party_members').create(memberData, { f_id });
            }
            this.memberId = member.id;
            if (!pbUser?.id) this._rememberGuestMember(partyId, member.id);

            this.setupSubscriptions(partyId);
            this.startHeartbeat();
            this.renderPartyUI();
            await this.loadInitialData(partyId);

            if (!this.isHost) {
                this.lockControls();
                this.setupGuestSyncInterception();
                if (party.current_track) {
                    await audioContextManager.resume();
                    await this.syncWithHost(party);
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

    _hasProfileName(pbUser) {
        return !!(pbUser?.display_name?.trim() || pbUser?.username?.trim());
    }

    _userProfileKey(userId) {
        return `party_user_profile_${userId}`;
    }

    _getStoredUserProfile(userId) {
        try {
            const raw = localStorage.getItem(this._userProfileKey(userId));
            return raw ? JSON.parse(raw) : null;
        } catch (_e) {
            return null;
        }
    }

    async _promptNickname({ title, body, cached }) {
        const defaultName = escapeHtml(cached || '');
        return new Promise((resolve, reject) => {
            Modal.show({
                title,
                content: `
                    <p style="margin-bottom: 1rem;">${body}</p>
                    <input type="text" id="guest-name-input" class="template-input" value="${defaultName}" placeholder="Your nickname" style="width: 100%; text-align: center;">
                `,
                actions: [
                    {
                        label: 'Join Party',
                        type: 'primary',
                        callback: (modal) => {
                            const name = modal.querySelector('#guest-name-input').value.trim() || 'Guest';
                            const profile = {
                                name,
                                avatar_url: `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(name)}`,
                            };
                            return { profile };
                        },
                    },
                    { label: 'Cancel', type: 'secondary', callback: () => false },
                ],
            })
                .then(resolve)
                .catch(reject);
        });
    }

    async showJoinModal(user, pbUser = null) {
        if (user && this._hasProfileName(pbUser)) {
            const confirmed = await Modal.confirm(
                'Join Party',
                `You are about to join a listening party. Everyone in the party will see your profile. Are you ready to listen together?`,
                'Join Party'
            );
            return confirmed ? { profile: null } : false;
        }

        if (user) {
            const stored = this._getStoredUserProfile(user.$id);
            const result = await this._promptNickname({
                title: 'Pick a Nickname',
                body: "You don't have a profile yet. Pick a nickname so other people in the party can see who you are.",
                cached: stored?.name || '',
            });
            if (result && result.profile) {
                try {
                    localStorage.setItem(this._userProfileKey(user.$id), JSON.stringify(result.profile));
                } catch (_e) {}
            }
            return result;
        }

        const cached = localStorage.getItem('party_guest_profile');
        const cachedName = cached ? JSON.parse(cached).name : '';
        const result = await this._promptNickname({
            title: 'Join as Guest',
            body: 'Enter a nickname to join the party!',
            cached: cachedName,
        });
        if (result && result.profile) {
            try {
                localStorage.setItem('party_guest_profile', JSON.stringify(result.profile));
            } catch (_e) {}
        }
        return result;
    }

    setupGuestSyncInterception() {
        const player = Player.instance;
        if (!this.originalSafePlay) this.originalSafePlay = player.safePlay.bind(player);
        player.safePlay = async (el) => {
            if (this.currentParty && !this.isHost && !this.currentParty.is_playing) return false;
            return await this.originalSafePlay(el);
        };
    }

    _guestMemberKey(partyId) {
        return `party_guest_member_${partyId}`;
    }

    _hostTokenKey(partyId) {
        return `party_host_token_${partyId}`;
    }

    _getHostToken(partyId) {
        try {
            return localStorage.getItem(this._hostTokenKey(partyId)) || null;
        } catch (_e) {
            return null;
        }
    }

    _rememberHostToken(partyId, token) {
        try {
            localStorage.setItem(this._hostTokenKey(partyId), token);
        } catch (_e) {}
    }

    _forgetHostToken(partyId) {
        try {
            localStorage.removeItem(this._hostTokenKey(partyId));
        } catch (_e) {}
    }

    _generateHostToken() {
        const bytes = new Uint8Array(24);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    _hostFid(party) {
        const user = authManager.user;
        if (user) return user.$id;
        const partyId = party?.id || this.currentParty?.id;
        return (partyId && this._getHostToken(partyId)) || 'guest';
    }

    _isPartyHost(party, pbUser) {
        if (pbUser && party?.host && pbUser.id === party.host) return true;
        if (!party?.guest_host_token) return false;
        const stored = this._getHostToken(party.id);
        return !!stored && stored === party.guest_host_token;
    }

    _getGuestMemberId(partyId) {
        try {
            return localStorage.getItem(this._guestMemberKey(partyId)) || null;
        } catch (_e) {
            return null;
        }
    }

    _rememberGuestMember(partyId, memberId) {
        try {
            localStorage.setItem(this._guestMemberKey(partyId), memberId);
        } catch (_e) {}
    }

    _forgetGuestMember(partyId) {
        try {
            localStorage.removeItem(this._guestMemberKey(partyId));
        } catch (_e) {}
    }

    async findExistingMember(partyId, pbUser) {
        const f_id = authManager.user ? authManager.user.$id : 'guest';
        try {
            if (pbUser?.id) {
                const rows = await pb.collection('party_members').getFullList({
                    filter: `party = "${partyId}" && user = "${pbUser.id}"`,
                    f_id,
                });
                return rows[0] || null;
            }
            const cachedId = this._getGuestMemberId(partyId);
            if (!cachedId) return null;
            try {
                const row = await pb.collection('party_members').getOne(cachedId, { f_id });
                if (row?.party === partyId) return row;
                this._forgetGuestMember(partyId);
                return null;
            } catch (_e) {
                this._forgetGuestMember(partyId);
                return null;
            }
        } catch (_e) {
            return null;
        }
    }

    async getMemberProfile(pbUser = null) {
        if (this.memberId && Array.isArray(this.members)) {
            const me = this.members.find((m) => m.id === this.memberId);
            if (me?.name) return { name: me.name, avatar_url: me.avatar_url };
        }

        const user = authManager.user;
        if (user) {
            if (this._hasProfileName(pbUser)) {
                const name = pbUser.display_name?.trim() || pbUser.username?.trim();
                const avatar =
                    pbUser?.avatar_url || `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(name)}`;
                return { name, avatar_url: avatar };
            }
            const stored = this._getStoredUserProfile(user.$id);
            if (stored?.name) return stored;
            return {
                name: 'Member',
                avatar_url: pbUser?.avatar_url || `https://api.dicebear.com/9.x/identicon/svg?seed=Member`,
            };
        }
        const cached = localStorage.getItem('party_guest_profile');
        return cached
            ? JSON.parse(cached)
            : { name: 'Guest', avatar_url: 'https://api.dicebear.com/9.x/identicon/svg?seed=Guest' };
    }

    setupSubscriptions(partyId) {
        this.unsubscribeFunctions.forEach((unsub) => unsub());
        this.unsubscribeFunctions = [];
        const f_id = authManager.user ? authManager.user.$id : 'guest';

        pb.collection('parties')
            .subscribe(
                partyId,
                async (e) => {
                    if (e.action === 'update') {
                        this.currentParty = e.record;
                        if (!this.isHost) await this.syncWithHost(e.record);
                        this.updatePartyHeader();
                    } else if (e.action === 'delete') {
                        if (this.isLeaving) return;
                        await Modal.alert('Party Ended', 'The host has ended the listening party.');
                        await this.leaveParty(false);
                    }
                },
                { f_id }
            )
            .then((unsub) => this.unsubscribeFunctions.push(unsub))
            .catch(console.error);

        pb.collection('party_members')
            .subscribe(
                '*',
                async (e) => {
                    if (e.record.party === partyId) await this.loadMembers();
                },
                { f_id }
            )
            .then((unsub) => this.unsubscribeFunctions.push(unsub))
            .catch(console.error);

        pb.collection('party_messages')
            .subscribe(
                '*',
                (e) => {
                    if (e.record.party === partyId && e.action === 'create') this.addChatMessage(e.record);
                },
                { f_id }
            )
            .then((unsub) => this.unsubscribeFunctions.push(unsub))
            .catch(console.error);

        pb.collection('party_requests')
            .subscribe(
                '*',
                async (e) => {
                    if (e.record.party === partyId) await this.loadRequests();
                },
                { f_id }
            )
            .then((unsub) => this.unsubscribeFunctions.push(unsub))
            .catch(console.error);
    }

    async loadInitialData(_partyId) {
        if (this.maintenanceMode) return;
        await this.loadMembers();
        await this.loadMessages();
        await this.loadRequests();
    }

    async loadMembers() {
        if (this.maintenanceMode || !this.currentParty) return;
        const f_id = authManager.user ? authManager.user.$id : 'guest';
        this.members = await pb
            .collection('party_members')
            .getFullList({ filter: `party = "${this.currentParty.id}"`, sort: '-is_host,name', f_id });
        this.renderMembers();
        this.renderTypingIndicator();
        this.updatePartyHeader();
    }

    _pingTyping() {
        if (!this.memberId || !this.currentParty) return;
        const now = Date.now();
        const lastPing = this._lastTypingPing || 0;
        if (now - lastPing < 1500) return;
        this._lastTypingPing = now;
        const f_id = authManager.user?.$id || 'guest';
        pb.collection('party_members')
            .update(this.memberId, { typing_until: now + 3000 }, { f_id })
            .catch(() => {});
    }

    _clearTyping() {
        if (!this.memberId || !this.currentParty) return;
        if ((this._lastTypingPing || 0) === 0) return;
        this._lastTypingPing = 0;
        const f_id = authManager.user?.$id || 'guest';
        pb.collection('party_members')
            .update(this.memberId, { typing_until: 0 }, { f_id })
            .catch(() => {});
    }

    renderTypingIndicator() {
        const el = document.getElementById('party-typing-indicator');
        const textEl = el?.querySelector('.party-typing-text');
        if (!el || !textEl) return;

        const now = Date.now();
        const typing = (this.members || []).filter(
            (m) => m.id !== this.memberId && typeof m.typing_until === 'number' && m.typing_until > now
        );

        clearTimeout(this._typingExpireTimer);

        if (!typing.length) {
            el.hidden = true;
            textEl.textContent = '';
            return;
        }

        let text;
        if (typing.length === 1) text = `${typing[0].name} is typing…`;
        else if (typing.length === 2) text = `${typing[0].name} and ${typing[1].name} are typing…`;
        else text = `${typing[0].name} and ${typing.length - 1} others are typing…`;
        textEl.textContent = text;
        el.hidden = false;

        const earliestExpiry = Math.min(...typing.map((m) => m.typing_until));
        const delay = Math.max(50, earliestExpiry - now + 50);
        this._typingExpireTimer = setTimeout(() => this.renderTypingIndicator(), delay);
    }

    async loadMessages() {
        const f_id = authManager.user ? authManager.user.$id : 'guest';
        const res = await pb
            .collection('party_messages')
            .getList(1, 50, { filter: `party = "${this.currentParty.id}"`, sort: '-created', f_id });
        this.messages = res.items.reverse();
        const container = document.getElementById('party-chat-messages');
        if (container) {
            container.innerHTML = '';
            this.messages.forEach((m) => this.addChatMessage(m));
        }
    }

    async loadRequests() {
        if (this.maintenanceMode || !this.currentParty) return;
        const f_id = authManager.user ? authManager.user.$id : 'guest';
        try {
            this.requests = await pb.collection('party_requests').getFullList({
                filter: `party = "${this.currentParty.id}"`,
                sort: 'created',
                f_id: f_id,
            });
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

        if (titleEl) titleEl.textContent = this.currentParty.name;
        if (countEl) countEl.textContent = this.members.length;

        if (metaEl) {
            const hostMember = (this.members || []).find((m) => m.is_host);
            const hostRecord = this.currentParty.expand?.host;
            const hostName =
                hostMember?.name?.trim() ||
                hostRecord?.display_name?.trim() ||
                hostRecord?.username?.trim() ||
                'Unknown';
            metaEl.textContent = `Host: ${hostName}`;
        }

        const track = this.currentParty.current_track;
        const display = document.getElementById('party-current-track-display');
        if (display) {
            if (track) {
                const api = Player.instance.api;
                const coverUrl = api.getCoverUrl(track.artwork || track.cover || track.album?.cover);
                display.innerHTML = `
                    <div class="party-now-playing">
                        <img src="${coverUrl}" class="party-now-playing-cover" alt="">
                        <div class="party-now-playing-info">
                            <div class="party-now-playing-title">${escapeHtml(track.title || '')}</div>
                            <div class="party-now-playing-artist">${escapeHtml(getTrackArtists(track) || '')}</div>
                        </div>
                        ${
                            !this.currentParty.is_playing
                                ? `<div class="party-now-playing-paused">${SVG_PAUSE(20)} Paused</div>`
                                : ''
                        }
                    </div>
                `;
            } else {
                display.innerHTML = `
                    <div class="party-now-playing-empty">
                        <div>Waiting for host to play music...</div>
                    </div>
                `;
            }
        }
    }

    renderMembers() {
        const list = document.getElementById('party-members-list');
        if (!list) return;
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
            const f_id = authManager.user ? authManager.user.$id : 'guest';
            list.querySelectorAll('.add-request-btn').forEach((btn) =>
                btn.addEventListener('click', async (e) => {
                    const reqId = e.currentTarget.dataset.reqId;
                    const req = this.requests.find((r) => r.id === reqId);
                    if (req) {
                        Player.instance.addToQueue(req.track);
                        showNotification(`Added "${req.track.title}" to queue`);
                        await pb.collection('party_requests').delete(req.id, { f_id });
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
        if (this.maintenanceMode) {
            await Modal.alert('Listening Parties Disabled', this.maintenanceMessage);
            return;
        }
        const input = document.getElementById('party-chat-input');
        if (!input || !input.value.trim()) return;
        const content = input.value.trim();
        input.value = '';
        this._clearTyping();
        const profile = await this.getMemberProfile();
        const f_id = authManager.user ? authManager.user.$id : 'guest';
        try {
            await pb
                .collection('party_messages')
                .create({ party: this.currentParty.id, sender_name: profile.name, content }, { f_id });
        } catch (_e) {}
    }

    async requestSong(track) {
        if (this.maintenanceMode) {
            showNotification('Listening parties are temporarily disabled');
            return;
        }
        if (!this.currentParty) return;
        const profile = await this.getMemberProfile();
        const f_id = authManager.user ? authManager.user.$id : 'guest';
        try {
            const minifiedTrack = syncManager._minifyItem('track', track);
            await pb.collection('party_requests').create(
                {
                    party: this.currentParty.id,
                    track: minifiedTrack,
                    requested_by: profile.name,
                },
                { f_id }
            );
            showNotification(`Requested "${track.title}"`);
        } catch (e) {
            console.error('Request error:', e);
        }
    }

    async syncWithHost(party) {
        if (this.isInternalSync) return;
        this.isInternalSync = true;
        try {
            const player = Player.instance;
            const el = player.activeElement;
            if (!party.current_track) {
                if (player.currentTrack) el.pause();
                return;
            }

            const currentId = String(player.currentTrack?.id || '');
            const targetId = String(party.current_track.id || '');

            if (currentId !== targetId) {
                const cleanedTrack = { ...party.current_track };
                if (!cleanedTrack.isTracker) {
                    delete cleanedTrack.audioUrl;
                    delete cleanedTrack.streamUrl;
                    delete cleanedTrack.remoteUrl;
                }
                player.setQueue([cleanedTrack], 0);
                await player.playTrackFromQueue(party.playback_time);
                if (!party.is_playing) el.pause();
                return;
            }

            if (party.is_playing) {
                if (el.paused) {
                    const _success = await player.safePlay(el);
                }
                const latency = (Date.now() - party.playback_timestamp) / 1000;
                const targetTime = party.is_playing ? party.playback_time + latency : party.playback_time;
                if (Math.abs(el.currentTime - targetTime) > 1.2) el.currentTime = targetTime;
            } else {
                if (!el.paused) el.pause();
                if (Math.abs(el.currentTime - party.playback_time) > 0.5) el.currentTime = party.playback_time;
            }
        } catch (e) {
            console.error('Sync error:', e);
        } finally {
            this.isInternalSync = false;
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
        const player = Player.instance;
        const updateParty = async () => {
            if (!this.currentParty || !this.isHost || this.isInternalSync) return;
            const el = player.activeElement;
            const sharedTrack = player.currentTrack ? syncManager._minifyItem('track', player.currentTrack) : null;
            try {
                await pb.collection('parties').update(
                    this.currentParty.id,
                    {
                        current_track: sharedTrack,
                        is_playing: !el.paused,
                        playback_time: el.currentTime,
                        playback_timestamp: Date.now(),
                        queue: player.queue?.map((t) => syncManager._minifyItem('track', t)) || [],
                    },
                    { f_id: this._hostFid(this.currentParty) }
                );
            } catch (_e) {}
        };
        ['play', 'pause', 'seeked'].forEach((ev) => {
            player.audio.addEventListener(ev, updateParty);
            if (player.video) player.video.addEventListener(ev, updateParty);
        });
        const originalPlayTrackFromQueue = player.playTrackFromQueue.bind(player);
        player.playTrackFromQueue = async (...args) => {
            const result = await originalPlayTrackFromQueue(...args);
            if (!this.isInternalSync) await updateParty();
            return result;
        };
        this.syncInterval = setInterval(updateParty, 2000);
    }

    setupGuestPlayerInterferenceCheck() {
        const player = Player.instance;
        const originalPlayTrackFromQueue = player.playTrackFromQueue.bind(player);
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
            return await originalPlayTrackFromQueue(...args);
        };
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(async () => {
            if (!this.memberId) return;
            try {
                await pb
                    .collection('party_members')
                    .update(this.memberId, { last_seen: Date.now() }, { f_id: authManager.user?.$id || 'guest' });
            } catch (_e) {}
        }, 30000);
    }

    async leaveParty(shouldCleanup = true) {
        if (this.isLeaving) return;
        this.isLeaving = true;

        const partyIdForCleanup = this.currentParty?.id;
        const memberIdForCleanup = this.memberId;
        const f_id = this.isHost ? this._hostFid(this.currentParty) : authManager.user?.$id || 'guest';

        try {
            if (this.isHost && shouldCleanup) {
                const end = await Modal.confirm(
                    'End Party?',
                    'Leaving will end the party for everyone. Are you sure?',
                    'End Party',
                    'danger'
                );
                if (!end) {
                    this.isLeaving = false;
                    return;
                }
                this.unsubscribeFunctions.forEach((unsub) => unsub());
                this.unsubscribeFunctions = [];

                try {
                    const cleanup = async (coll) => {
                        const items = await pb
                            .collection(coll)
                            .getFullList({ filter: `party = "${partyIdForCleanup}"`, f_id });
                        for (const i of items) {
                            try {
                                await pb.collection(coll).delete(i.id, { f_id });
                            } catch (e) {
                                console.error(`Failed to delete ${coll}/${i.id}:`, e);
                            }
                        }
                    };
                    await cleanup('party_members');
                    await cleanup('party_messages');
                    await cleanup('party_requests');
                    await pb.collection('parties').delete(partyIdForCleanup, { f_id });
                } catch (e) {
                    console.error('Failed to end party:', e);
                    showNotification('Failed to end party. Please try again.');
                }
            } else if (memberIdForCleanup) {
                try {
                    await pb.collection('party_members').delete(memberIdForCleanup, { f_id });
                } catch (e) {
                    if (e?.status !== 404) {
                        console.error('Failed to delete party member record:', e);
                        showNotification('Could not leave properly, other members may still see you as on.');
                    }
                }
            }
        } finally {
            this.restorePlayerMethods();
            this.unlockControls();
            this.unsubscribeFunctions.forEach((unsub) => unsub());
            this.unsubscribeFunctions = [];
            clearInterval(this.syncInterval);
            clearInterval(this.heartbeatInterval);
            clearTimeout(this._typingExpireTimer);
            this._typingExpireTimer = null;
            this._lastTypingPing = 0;
            const typingEl = document.getElementById('party-typing-indicator');
            if (typingEl) typingEl.hidden = true;
            if (partyIdForCleanup) {
                this._forgetGuestMember(partyIdForCleanup);
                this._forgetHostToken(partyIdForCleanup);
            }
            this.currentParty = null;
            this.isHost = false;
            this.memberId = null;
            this.hidePartyIndicator();
            this.isLeaving = false;
            navigate('/parties');
        }
    }

    restorePlayerMethods() {
        const player = Player.instance;
        if (this.originalSafePlay) {
            player.safePlay = this.originalSafePlay;
            this.originalSafePlay = null;
        }
    }

    copyInviteLink() {
        navigator.clipboard.writeText(`${window.location.origin}/party/${this.currentParty.id}`).catch(console.error);
        showNotification('Invite link copied!');
    }

    showPartyIndicator() {
        const btn = document.getElementById('now-playing-party-btn');
        if (!btn || !this.currentParty) return;
        btn.style.display = '';
        const name = this.currentParty.name || 'Listening Party';
        const count = this.members.length;
        const tooltip = `${name} (${count} listener${count === 1 ? '' : 's'})`;
        btn.title = tooltip;
        btn.setAttribute('aria-label', `Open listening party: ${tooltip}`);
        if (!btn.dataset.partyHandlerBound) {
            btn.addEventListener('click', () => {
                if (this.currentParty) navigate(`/party/${this.currentParty.id}`);
            });
            btn.dataset.partyHandlerBound = '1';
        }
    }

    hidePartyIndicator() {
        const btn = document.getElementById('now-playing-party-btn');
        if (!btn) return;
        btn.style.display = 'none';
        btn.removeAttribute('title');
        btn.setAttribute('aria-label', 'Open listening party');
    }
}

export const partyManager = new ListeningPartyManager();
