import { jamApi } from './api.js';

export class JamUI {
    constructor(jamSyncManager) {
        this.jamSyncManager = jamSyncManager;
        this.initUI();
    }

    initUI() {
        // Find existing Jam button and attach listener
        const jamBtn = document.getElementById('jam-btn');
        if (jamBtn) {
            jamBtn.addEventListener('click', () => this.showJamModal());
        }

        // Add Jam Modal to body
        const modalHtml = `
            <div id="jam-modal" class="modal">
                <div class="modal-overlay"></div>
                <div class="modal-content">
                    <h3 style="text-align: center; margin-bottom: 10px">Jam Sessions</h3>
                    
                    <div id="jam-idle-state">
                        <p style="text-align: center; margin-bottom: 15px; color: var(--text-secondary); font-size: 0.9rem;">
                            Start a Jam session to listen in sync with friends.
                        </p>
                        <button id="start-jam-btn" class="btn-primary" style="width: 100%; margin-bottom: 15px;">Start a Jam Session</button>
                        
                        <div style="display: flex; align-items: center; margin: 15px 0;">
                            <div style="flex: 1; height: 1px; background: var(--border);"></div>
                            <span style="padding: 0 10px; color: var(--text-secondary); font-size: 0.8rem; font-weight: 600;">OR JOIN</span>
                            <div style="flex: 1; height: 1px; background: var(--border);"></div>
                        </div>
                        
                        <input type="text" id="jam-invite-input" placeholder="Paste Invite Link or Token" class="template-input" style="width: 100%; margin-bottom: 10px;">
                        <button id="join-jam-btn" class="btn-secondary" style="width: 100%;">Join Session</button>
                    </div>

                    <div id="jam-active-state" style="display: none;">
                        <div style="background: var(--bg-secondary); border-radius: 8px; padding: 12px; margin-bottom: 15px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid var(--primary-alpha);">
                            <div class="pulse-dot" style="width: 8px; height: 8px; border-radius: 50%; background: var(--primary);"></div>
                            <span style="font-weight: 600; color: var(--primary); font-size: 0.9rem;">Active Jam Session</span>
                        </div>
                        
                        <label style="display: block; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 5px;">Invite Link</label>
                        <div style="display: flex; gap: 8px; margin-bottom: 15px;">
                            <input type="text" id="jam-invite-link" readonly class="template-input" style="flex: 1;">
                            <button id="copy-jam-link-btn" class="btn-secondary" style="padding: 0 15px;">Copy</button>
                        </div>

                        <div id="jam-host-controls" style="display: none; margin-bottom: 15px; padding: 10px; border-radius: 8px; background: rgba(0,0,0,0.1); border: 1px solid var(--border);">
                            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: var(--text-primary); font-size: 0.9rem;">
                                <input type="checkbox" id="jam-allow-queue-check" checked style="width: 16px; height: 16px; accent-color: var(--primary);">
                                Allow participants to add to queue
                            </label>
                        </div>
                        
                        <button id="leave-jam-btn" class="btn-secondary danger" style="width: 100%;">Leave Session</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        this.setupEventListeners();

        // Handle invite links in URL on load
        this.checkUrlForInvite();
    }

    setupEventListeners() {
        const modal = document.getElementById('jam-modal');
        const overlay = modal.querySelector('.modal-overlay');

        overlay.addEventListener('click', () => modal.classList.remove('active'));

        document.getElementById('start-jam-btn').addEventListener('click', async () => {
            try {
                const sessionId = await this.jamSyncManager.startSession();
                const invite = await jamApi.generateInvite(sessionId);
                this.updateActiveUI(invite.token);
            } catch (err) {
                console.error(err);
                alert("Failed to start Jam session. Make sure you are logged in.");
            }
        });

        document.getElementById('join-jam-btn').addEventListener('click', async () => {
            const input = document.getElementById('jam-invite-input').value.trim();
            if (!input) return;

            // Extract token if it's a full URL
            let token = input;
            try {
                const url = new URL(input);
                token = url.searchParams.get('jam') || input;
            } catch {
                // Not a URL, use raw token
            }

            try {
                const sessionId = await jamApi.getSessionFromInvite(token);
                if (sessionId) {
                    await this.jamSyncManager.joinSession(sessionId);
                    this.updateActiveUI(token);
                }
            } catch {
                alert("Invalid or expired invite.");
            }
        });

        document.getElementById('leave-jam-btn').addEventListener('click', async () => {
            await this.jamSyncManager.leaveSession();
            this.updateIdleUI();
        });

        document.getElementById('copy-jam-link-btn').addEventListener('click', async () => {
            const linkInput = document.getElementById('jam-invite-link');
            try {
                await navigator.clipboard.writeText(linkInput.value);
                const btn = document.getElementById('copy-jam-link-btn');
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            } catch (err) {
                console.error('Failed to copy text: ', err);
            }
        });

        window.addEventListener('jam-session-left', () => {
            this.updateIdleUI();
            modal.classList.remove('active');
        });

        // Host Queue Control Toggle
        const queueCheck = document.getElementById('jam-allow-queue-check');
        if (queueCheck) {
            queueCheck.addEventListener('change', async (e) => {
                const allow = e.target.checked;
                await this.jamSyncManager.toggleParticipantQueueing(allow);
            });
        }

        // Listen for remote updates to the queue control permission
        window.addEventListener('jam-permissions-changed', (e) => {
            const allow = e.detail.allowParticipantQueueing;
            const check = document.getElementById('jam-allow-queue-check');
            if (check) check.checked = allow;

            // Optionally, show a toast to participants if they are disallowed
            if (!this.jamSyncManager.isHost && !allow) {
                import('../downloads.js').then(m => m.showNotification && m.showNotification("Host disabled participant queueing."));
            }
        });
    }

    async checkUrlForInvite() {
        const urlParams = new URLSearchParams(window.location.search);
        const jamToken = urlParams.get('jam');
        if (jamToken) {
            try {
                const sessionId = await jamApi.getSessionFromInvite(jamToken);
                if (sessionId) {
                    const joinSession = async () => {
                        await this.jamSyncManager.joinSession(sessionId);
                        this.updateActiveUI(jamToken);
                        const newUrl = new URL(window.location.href);
                        newUrl.searchParams.delete('jam');
                        window.history.replaceState({}, '', newUrl);

                        const notification = await import('../downloads.js').then(m => m.showNotification);
                        if (notification) notification("Joined Jam Session!");
                    };

                    const player = this.jamSyncManager.player;
                    if (player && player.currentTrack !== undefined) {
                        joinSession().catch(e => console.error("Failed to join jam session", e));
                    } else {
                        let attempts = 0;
                        const initInterval = setInterval(() => {
                            if (this.jamSyncManager.player && this.jamSyncManager.player.currentTrack !== undefined) {
                                clearInterval(initInterval);
                                joinSession().catch(e => console.error("Failed to join jam session", e));
                            } else if (attempts > 50) {
                                clearInterval(initInterval);
                                console.error("Player initialization timed out");
                            }
                            attempts++;
                        }, 100);
                    }
                }
            } catch (e) {
                console.error("Failed to join Jam from URL", e);
            }
        }
    }

    showJamModal() {
        document.getElementById('jam-modal').classList.add('active');
        if (this.jamSyncManager.activeSessionId) {
            if (this.currentJamToken) {
                this.updateActiveUI(this.currentJamToken);
            }
        } else {
            document.getElementById('jam-invite-input').value = '';
        }
    }

    updateActiveUI(token) {
        this.currentJamToken = token;
        document.getElementById('jam-idle-state').style.display = 'none';
        document.getElementById('jam-active-state').style.display = 'block';

        const inviteUrl = `${window.location.origin}${window.location.pathname}?jam=${token}`;
        document.getElementById('jam-invite-link').value = inviteUrl;

        const jamBtn = document.getElementById('jam-btn');
        if (jamBtn) jamBtn.classList.add('active-jam');

        // Show host controls only to the host
        const hostControls = document.getElementById('jam-host-controls');
        const queueCheck = document.getElementById('jam-allow-queue-check');
        if (hostControls) {
            if (this.jamSyncManager.isHost) {
                hostControls.style.display = 'block';
                if (queueCheck) queueCheck.checked = this.jamSyncManager.allowParticipantQueueing;
            } else {
                hostControls.style.display = 'none';
            }
        }
    }

    updateIdleUI() {
        document.getElementById('jam-idle-state').style.display = 'block';
        document.getElementById('jam-active-state').style.display = 'none';
        const jamBtn = document.getElementById('jam-btn');
        if (jamBtn) jamBtn.classList.remove('active-jam');
    }
}
