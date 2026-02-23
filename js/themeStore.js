import { syncManager } from './accounts/pocketbase.js';
import { authManager } from './accounts/auth.js';
import { navigate } from './router.js';

export class ThemeStore {
    constructor() {
        this.pb = syncManager.pb;
        this.modal = document.getElementById('theme-store-modal');
        this.grid = document.getElementById('community-themes-grid');
        this.uploadForm = document.getElementById('theme-upload-form');
        this.searchInput = document.getElementById('theme-store-search');
        this.loadingIndicator = document.getElementById('theme-store-loading');
        this._isCheckingAuth = false;
        this.previewShadow = null;
        this.init();
    }

    init() {
        document.getElementById('open-theme-store-btn')?.addEventListener('click', () => {
            this.modal.classList.add('active');
            this.loadThemes();
        });

        this.modal?.querySelector('.close-modal-btn')?.addEventListener('click', () => {
            this.modal.classList.remove('active');
        });


        const tabs = this.modal?.querySelectorAll('.search-tab');
        tabs?.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                this.modal.querySelectorAll('.search-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const contentId = tab.dataset.tab === 'browse' ? 'theme-store-browse' : 'theme-store-upload';
                document.getElementById(contentId)?.classList.add('active');
                if (tab.dataset.tab === 'upload') {
                    this.checkAuth();
                }
            });
        });

        let debounceTimer;
        this.searchInput?.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => this.loadThemes(e.target.value), 300);
        });


        this.uploadForm?.addEventListener('submit', (e) => this.handleUpload(e));

        if (authManager) {
            authManager.onAuthStateChanged(() => {
                if (this.modal.classList.contains('active')) {
                    this.checkAuth();
                }
            });
        }


        document.getElementById('theme-store-login-btn')?.addEventListener('click', () => {
            this.modal.classList.remove('active');
            document.getElementById('email-auth-modal')?.classList.add('active');
        });


        this.setupEditorTools();

        document.getElementById('theme-details-back-btn')?.addEventListener('click', () => {
            this.closeThemeDetails();
        });

        this.applySavedTheme();
    }

    applySavedTheme() {
        const theme = localStorage.getItem('monochrome-theme');
        const css = localStorage.getItem('custom_theme_css');
        if (theme === 'custom' && css) {
            const metadataStr = localStorage.getItem('community-theme');
            let metadata = null;
            if (metadataStr) {
                try { metadata = JSON.parse(metadataStr); } catch (e) { console.warn(e); }
            }

            if (metadata) {
                this.applyTheme({
                    css: css,
                    id: metadata.id,
                    name: metadata.name,
                    authorName: metadata.author
                });
            } else {
                this.applyTheme(css);
            }
        }
    }

    async loadThemes(query = '') {
        if (!this.grid) return;
        this.grid.innerHTML = '';
        this.loadingIndicator.style.display = 'block';

        let currentUserId = null;
        if (authManager.user) {
            try {

                const record = await syncManager._getUserRecord(authManager.user.uid);
                currentUserId = record?.id;
            } catch (e) {
                console.warn('Failed to resolve user ID for theme ownership check', e);
            }
        }

        try {
            const result = await this.pb.collection('themes').getList(1, 50, {
                sort: '-created',
                filter: query ? `name ~ "${query}" || description ~ "${query}"` : '',
                expand: 'author'
            });
            this.loadingIndicator.style.display = 'none';
            if (result.items.length === 0) {
                this.grid.innerHTML = '<div class="empty-state">No themes found.</div>';
                return;
            }
            result.items.forEach(theme => {
                this.grid.appendChild(this.createThemeCard(theme, currentUserId));
            });
        } catch (err) {
            console.error('Failed to load themes:', err);
            this.loadingIndicator.style.display = 'none';
            this.grid.innerHTML = '<div class="empty-state">Failed to load themes.</div>';
        }
    }

    createThemeCard(theme, currentUserId) {
        const div = document.createElement('div');
        div.className = 'card theme-card';
        const authorName = theme.expand?.author?.username
            || theme.expand?.author?.display_name
            || theme.authorName
            || 'Unknown';
        

        const shortDesc = theme.description ? 
            (theme.description.length > 80 ? theme.description.substring(0, 80) + '...' : theme.description) 
            : '';

        let authorHtml = this.escapeHtml(authorName);
        let isInternalProfile = false;

        if (theme.expand?.author?.username) {
            isInternalProfile = true;
            authorHtml = `<span class="author-link" style="cursor: pointer; text-decoration: underline;">${this.escapeHtml(authorName)}</span>`;
        } else if (theme.authorUrl) {
            authorHtml = `<a href="${this.escapeHtml(theme.authorUrl)}" target="_blank" style="color: inherit; text-decoration: underline;" onclick="event.stopPropagation();">${this.escapeHtml(authorName)}</a>`;
        }

        let deleteBtnHtml = '';
        if (currentUserId && theme.author === currentUserId) {
            deleteBtnHtml = `
                <button class="btn-icon delete-theme-btn" title="Delete Theme" style="position: absolute; top: 0.5rem; right: 0.5rem; background: rgba(0,0,0,0.6); color: white; border-radius: 50%; padding: 0.25rem; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; z-index: 10;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            `;
        }

        const previewStyle = this.extractPreviewStyles(theme.css);
        const previewHtml = `
            <div class="theme-card-preview" style="${previewStyle}; height: 140px; position: relative;">
                <div class="theme-card-preview-header" style="background-color: var(--card); border-bottom: 1px solid var(--border);"></div>
                <div class="theme-card-preview-body" style="background-color: var(--background);">
                    <div class="theme-card-preview-line" style="background-color: var(--foreground); width: 80%;"></div>
                    <div class="theme-card-preview-line" style="background-color: var(--muted-foreground); width: 60%;"></div>
                    <div class="theme-card-preview-line" style="background-color: var(--primary); width: 40%; margin-top: auto;"></div>
                </div>
            </div>`;

        div.innerHTML = `
            <div style="position: relative;">
                ${deleteBtnHtml}
                ${previewHtml}
            </div>
            <div class="card-info" style="margin-top: 0.75rem;">
                <div class="card-title">${this.escapeHtml(theme.name)}</div>
                <div class="card-subtitle">by ${authorHtml}</div>
                <p style="font-size: 0.8rem; color: var(--muted-foreground); margin-top: 0.25rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                    ${this.escapeHtml(shortDesc)}
                </p>
            </div>
        `;

        div.addEventListener('click', (e) => {
            if (e.target.closest('.delete-theme-btn')) {
                e.stopPropagation();
                this.deleteTheme(theme.id);
                return;
            }
            this.openThemeDetails(theme);
        });

        if (isInternalProfile) {
            const link = div.querySelector('.author-link');
            link?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.modal.classList.remove('active');
                navigate(`/user/@${theme.expand.author.username}`);
            });
        }

        return div;
    }

    async deleteTheme(themeId) {
        if (!confirm('Are you sure you want to delete this theme?')) return;
        
        try {
            const fbUser = authManager.user;
            if (!fbUser) throw new Error('Not authenticated');

            await this.pb.collection('themes').delete(themeId, { f_id: fbUser.uid });
            alert('Theme deleted successfully.');
            this.loadThemes();
        } catch (err) {
            console.error('Failed to delete theme:', err);
            alert('Failed to delete theme. You might not have permission.');
        }
    }

    openThemeDetails(theme) {
        const detailsView = document.getElementById('theme-store-details');
        const browseView = document.getElementById('theme-store-browse');
        const tabs = this.modal.querySelector('.search-tabs');


        document.getElementById('theme-details-name').textContent = theme.name;
        
        const authorName = theme.expand?.author?.username || theme.expand?.author?.display_name || theme.authorName || 'Unknown';
        const authorEl = document.getElementById('theme-details-author');
        
        if (theme.expand?.author?.username) {
            authorEl.innerHTML = `by <span style="cursor: pointer; text-decoration: underline; color: var(--primary);">${this.escapeHtml(authorName)}</span>`;
            authorEl.querySelector('span').onclick = () => {
                this.modal.classList.remove('active');
                navigate(`/user/@${theme.expand.author.username}`);
            };
        } else {
            authorEl.textContent = `by ${authorName}`;
        }
        
        document.getElementById('theme-details-created').textContent = new Date(theme.created).toLocaleDateString();
        document.getElementById('theme-details-updated').textContent = new Date(theme.updated).toLocaleDateString();
        document.getElementById('theme-details-installs').textContent = theme.installs || 0;
        document.getElementById('theme-details-desc').textContent = theme.description || 'No description provided.';


        const applyBtn = document.getElementById('theme-details-apply-btn');
        applyBtn.onclick = async () => {
            this.applyTheme(theme);
            this.modal.classList.remove('active');

            try {
                const latest = await this.pb.collection('themes').getOne(theme.id);
                await this.pb.collection('themes').update(theme.id, {
                    installs: (latest.installs || 0) + 1
                });
            } catch (e) {
                console.warn('Failed to update theme installs:', e);
            }
        };


        const previewContainer = document.getElementById('theme-details-preview-container');
        previewContainer.innerHTML = '';
        this.detailsPreviewShadow = previewContainer.attachShadow({ mode: 'open' });
        
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/styles.css';
        this.detailsPreviewShadow.appendChild(link);

        const styleTag = document.createElement('style');
        styleTag.textContent = theme.css.replace(/:root/g, ':host');
        this.detailsPreviewShadow.appendChild(styleTag);

        const wrapper = document.createElement('div');
        wrapper.className = 'preview-content';
        wrapper.style.padding = '1rem';
        wrapper.style.height = '100%';
        wrapper.style.background = 'var(--background)';
        wrapper.style.color = 'var(--foreground)';
        wrapper.style.overflow = 'hidden';
        wrapper.innerHTML = `
            <div class="card" style="margin-bottom: 1rem;">
                <div style="height: 60px; background: var(--muted); border-radius: var(--radius); margin-bottom: 0.5rem;"></div>
                <div class="card-title">Preview</div>
                <div class="card-subtitle">Subtitle</div>
            </div>
            <button class="btn-primary" style="margin-bottom: 0.5rem; width: 100%;">Button</button>
        `;
        this.detailsPreviewShadow.appendChild(wrapper);


        browseView.style.display = 'none';
        tabs.style.display = 'none';
        detailsView.style.display = 'flex';
    }

    closeThemeDetails() {
        const detailsView = document.getElementById('theme-store-details');
        const browseView = document.getElementById('theme-store-browse');
        const tabs = this.modal.querySelector('.search-tabs');

        detailsView.style.display = 'none';
        browseView.style.display = 'block';
        tabs.style.display = 'flex';
        

        document.getElementById('theme-details-preview-container').innerHTML = '';
    }

    extractPreviewStyles(css) {
        const vars = ['--background', '--foreground', '--primary', '--card', '--border', '--muted-foreground'];
        let style = '';
        vars.forEach(v => {
            const regex = new RegExp(`${v}\\s*:\\s*([^;]+)`);
            const match = css.match(regex);
            if (match) {
                style += `${v}: ${match[1]}; `;
            }
        });
        return style;
    }

    applyTheme(theme) {
        let css = theme.css;
        if (!css && typeof theme === 'string') {
            css = theme;
            theme = { name: 'Custom Theme', authorName: 'Unknown' };
        }

        localStorage.setItem('custom_theme_css', css);
        localStorage.setItem('monochrome-theme', 'custom');
        
        const metadata = {
            id: theme.id,
            name: theme.name,
            author: theme.authorName || theme.expand?.author?.username || theme.expand?.author?.display_name || 'Unknown',
        };
        localStorage.setItem('community-theme', JSON.stringify(metadata));

        let styleEl = document.getElementById('custom-theme-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'custom-theme-style';
            document.head.appendChild(styleEl);
        }

        const fontMatch = css.match(/--font-family:\s*([^;}]+)/);
        const urlMatch = css.match(/--font-url:\s*([^;}]+)/);

        if (fontMatch && fontMatch[1]) {
            const fontFamilyValue = fontMatch[1].trim();
            const mainFont = fontFamilyValue.split(',')[0].trim().replace(/['"]/g, '');
            
            const genericFamilies = [
                'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 
                'system-ui', 'inter', 'ibm plex mono', 'roboto', 'open sans', 
                'lato', 'montserrat', 'poppins', 'apple music', 'sf pro display',
                'courier new', 'times new roman', 'arial', 'helvetica', 'verdana',
                'tahoma', 'trebuchet ms', 'impact', 'gill sans'
            ];
            const isPresetOrGeneric = genericFamilies.some(generic => mainFont.toLowerCase() === generic);

            if (!isPresetOrGeneric) {
                const FONT_LINK_ID = 'monochrome-dynamic-font';
                let link = document.getElementById(FONT_LINK_ID);

                if (urlMatch && urlMatch[1]) {
                    const customUrl = urlMatch[1].trim().replace(/['"]/g, '');
                    console.log(`Applying custom font URL: ${customUrl}`);

                    if (customUrl.match(/\.(css)$/i) || customUrl.includes('fonts.googleapis.com')) {
                        if (!link) {
                            link = document.createElement('link');
                            link.id = FONT_LINK_ID;
                            link.rel = 'stylesheet';
                            document.head.appendChild(link);
                        }
                        link.href = customUrl;
                    } else {
                        if (link) link.remove();
                        const fontFace = `
@font-face {
    font-family: '${mainFont}';
    src: url('${customUrl}');
    font-weight: 100 900;
    font-display: swap;
}
`;
                        css = fontFace + css;
                    }
                } else {
                    console.log(`Applying custom font from theme (Google Fonts): ${mainFont}`);
                    const encodedFamily = encodeURIComponent(mainFont);
                    const url = `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@100;200;300;400;500;600;700;800;900&display=swap`;

                    if (!link) {
                        link = document.createElement('link');
                        link.id = FONT_LINK_ID;
                        link.rel = 'stylesheet';
                        document.head.appendChild(link);
                    }
                    link.href = url;
                }
            }
        }

        styleEl.textContent = css;


        const root = document.documentElement;
        ['background', 'foreground', 'primary', 'secondary', 'muted', 'border', 'highlight', 'font-family'].forEach(key => {
            root.style.removeProperty(`--${key}`);
        });
        root.setAttribute('data-theme', 'custom');

        document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('active'));
        document.querySelector('[data-theme="custom"]')?.classList.add('active');

        document.documentElement.style.display = 'none';
        document.documentElement.offsetHeight;
        document.documentElement.style.display = '';

        window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: 'custom' } }));
    }

    async checkAuth() {
        if (this._isCheckingAuth) return;
        this._isCheckingAuth = true;


        const isLoggedIn = !!authManager?.user;

        const authMessage = document.getElementById('theme-upload-auth-message');
        const form = document.getElementById('theme-upload-form');
        const websiteInput = document.getElementById('theme-upload-website');
        const websiteContainer = websiteInput?.parentElement;

        if (isLoggedIn) {
            authMessage.style.display = 'none';
            form.style.display = 'block';

            try {
                const userData = await syncManager.getUserData();
                if (userData?.profile?.username && websiteContainer) {
                    websiteContainer.style.display = 'none';
                } else if (websiteContainer) {
                    websiteContainer.style.display = 'block';
                }
            } catch (e) {
                console.warn('Failed to check profile for website input visibility', e);
            }
        } else {
            authMessage.style.display = 'flex';
            form.style.display = 'none';
        }

        this._isCheckingAuth = false;
    }

    async handleUpload(e) {
        e.preventDefault();

        const name = document.getElementById('theme-upload-name').value;
        const desc = document.getElementById('theme-upload-desc').value;
        const css = document.getElementById('theme-upload-css').value;
        const website = document.getElementById('theme-upload-website').value;

        const fbUser = authManager?.user;
        if (!fbUser) {
            alert('You must be logged in to upload themes.');
            return;
        }

        let userId = null;
        let userName = null;

        try {

            const dbUser = await syncManager._getUserRecord(fbUser.uid);
            if (!dbUser) {
                throw new Error('Could not find or create your user record. Please try again.');
            }

            userId = dbUser.id;
            userName = dbUser.username || dbUser.display_name || fbUser.email;

            if (userId.length !== 15) {
                throw new Error(
                    `Your user ID is corrupted (${userId.length} chars, expected 15). ` +
                    `Please go to Settings > System > Clear Cloud Data, then log out and back in.`
                );
            }

            console.log('Uploading theme:', { name, author: userId, authorName: userName });

            const formData = new FormData();
            formData.append('name', name);
            formData.append('description', desc);
            formData.append('css', css);
            formData.append('author', userId);
            formData.append('authorName', userName);
            if (website) formData.append('authorUrl', website);


            await this.pb.collection('themes').create(formData, { f_id: fbUser.uid });

            alert('Theme uploaded successfully!');
            e.target.reset();
            

            const previewWindow = document.getElementById('theme-preview-window');
            const togglePreviewBtn = document.getElementById('te-toggle-preview');
            if (previewWindow) previewWindow.style.display = 'none';
            if (togglePreviewBtn) {
                togglePreviewBtn.textContent = 'Preview';
                togglePreviewBtn.classList.remove('active');
            }

            this.modal.querySelector('[data-tab="browse"]').click();
            this.loadThemes();

        } catch (err) {
            console.error('Upload failed:', err);
            console.error('Response data:', err.data);

            const responseData = err.data?.data || {};

            if (Object.keys(responseData).length > 0) {
                let msg = 'Failed to upload theme:\n';
                for (const [key, value] of Object.entries(responseData)) {
                    msg += `• ${key}: ${value.message}\n`;
                }
                alert(msg);
            } else {
                const message = err.message || err.data?.message || 'Unknown error';
                const debugInfo = `\n\nDebug: User ID: ${userId} (${userId?.length} chars) | Status: ${err.status}`;
                alert(`Failed to upload theme: ${message}${debugInfo}`);
            }
        }
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    setupEditorTools() {
        const cssInput = document.getElementById('theme-upload-css');
        const insertTemplateBtn = document.getElementById('te-insert-template');
        const togglePreviewBtn = document.getElementById('te-toggle-preview');
        const previewWindow = document.getElementById('theme-preview-window');
        
        const colorMap = {
            'te-bg-color': '--background',
            'te-fg-color': '--foreground',
            'te-primary-color': '--primary',
            'te-sec-color': '--secondary',
            'te-accent-color': '--highlight',
            'te-card-color': '--card',
            'te-border-color': '--border',
            'te-muted-color': '--muted-foreground'
        };

        Object.entries(colorMap).forEach(([id, variable]) => {
            document.getElementById(id)?.addEventListener('input', (e) => {
                this.updateCssVariable(cssInput, variable, e.target.value);
                this.updatePreview();
            });
        });

        const styleMap = {
            'te-font-family': '--font-family',
            'te-radius': '--radius'
        };

        Object.entries(styleMap).forEach(([id, variable]) => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                if (e.target.value) {
                    this.updateCssVariable(cssInput, variable, e.target.value);
                    this.updatePreview();
                    e.target.value = "";
                }
            });
        });

        document.getElementById('te-font-custom')?.addEventListener('input', (e) => {
            this.updateCssVariable(cssInput, '--font-family', e.target.value);
            this.updatePreview();
        });

        insertTemplateBtn?.addEventListener('click', () => {
            if (cssInput.value.trim() && !confirm('Overwrite current CSS with template?')) return;
            cssInput.value = `:root {
    /* Base Colors */
    --background: #0a0a0a;
    --foreground: #ededed;
    
    /* UI Elements */
    --card: #1a1a1a;
    --card-foreground: #ededed;
    --border: #2a2a2a;
    
    /* Accents */
    --primary: #3b82f6;
    --primary-foreground: #ffffff;
    --secondary: #2a2a2a;
    --secondary-foreground: #ededed;
    
    /* Text */
    --muted: #2a2a2a;
    --muted-foreground: #a0a0a0;
    
    /* Special */
    --highlight: #3b82f6;
    --ring: #3b82f6;
    --radius: 8px;
    --font-family: 'Inter', sans-serif;
    --font-size-scale: 100%;
}`;
            this.updatePreview();
        });

        togglePreviewBtn?.addEventListener('click', () => {
            const isVisible = previewWindow.style.display !== 'none';
            if (isVisible) {
                previewWindow.style.display = 'none';
                togglePreviewBtn.textContent = 'Preview';
                togglePreviewBtn.classList.remove('active');
            } else {
                previewWindow.style.display = 'flex';
                togglePreviewBtn.textContent = 'Close Preview';
                togglePreviewBtn.classList.add('active');
                this.initPreviewWindow();
                this.updatePreview();
            }
        });

        cssInput?.addEventListener('input', () => this.updatePreview());
    }

    updateCssVariable(textarea, variable, value) {
        let css = textarea.value;
        const regex = new RegExp(`${variable}:\\s*[^;\\}]+(?:;|(?=\\}))`, 'g');
        const newLine = `${variable}: ${value};`;
        
        if (regex.test(css)) {
            css = css.replace(regex, newLine);
        } else {
            if (css.includes(':root {')) {
                css = css.replace(':root {', `:root {\n    ${newLine}`);
            } else {
                css += `\n:root {\n    ${newLine}\n}`;
            }
        }
        textarea.value = css;
    }

    initPreviewWindow() {
        const container = document.getElementById('theme-preview-window');
        if (!this.previewShadow) {
            this.previewShadow = container.attachShadow({ mode: 'open' });
            
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/styles.css';
            this.previewShadow.appendChild(link);

            this.previewStyleTag = document.createElement('style');
            this.previewShadow.appendChild(this.previewStyleTag);

            const wrapper = document.createElement('div');
            wrapper.className = 'preview-content';
            wrapper.style.padding = '1rem';
            wrapper.style.height = '100%';
            wrapper.style.background = 'var(--background)';
            wrapper.style.color = 'var(--foreground)';
            wrapper.style.overflow = 'auto';
            
            wrapper.innerHTML = `
                <h3 style="margin-top: 0;">Preview</h3>
                <div class="card" style="margin-bottom: 1rem;">
                    <div style="height: 100px; background: var(--muted); border-radius: var(--radius); margin-bottom: 0.5rem;"></div>
                    <div class="card-title">Card Title</div>
                    <div class="card-subtitle">Subtitle</div>
                </div>
                <button class="btn-primary" style="margin-bottom: 0.5rem;">Primary Button</button>
                <button class="btn-secondary">Secondary Button</button>
                <p style="color: var(--muted-foreground);">Muted text example.</p>
            `;
            this.previewShadow.appendChild(wrapper);
        }
    }

    updatePreview() {
        if (!this.previewShadow || !this.previewStyleTag) return;
        const css = document.getElementById('theme-upload-css').value;
        const scopedCss = css.replace(/:root/g, ':host');
        this.previewStyleTag.textContent = scopedCss;
    }
}