import { createModal } from './utils.js';

const MONODOWNLOAD_REPO_URL = 'https://github.com/atvalerie/monodownload';

let activeDownloadsBrokenModal: HTMLElement | null = null;
let interceptorsInstalled = false;

export function showDownloadsBrokenModal(): void {
    if (activeDownloadsBrokenModal?.isConnected) {
        return;
    }

    const content = document.createElement('div');
    content.innerHTML = `
        <p style="margin: 0 0 0.75rem 0;">Downloads are broken.</p>
        <p style="margin: 0 0 1.25rem 0; color: var(--muted-foreground); line-height: 1.6;">
            Use
            <a href="${MONODOWNLOAD_REPO_URL}" target="_blank" rel="noopener noreferrer">atvalerie/monodownload</a>
            instead.
        </p>
        <div class="modal-actions" style="margin-top: 0;">
            <button type="button" class="btn-primary" id="downloads-broken-close-btn">Close</button>
        </div>
    `;

    const { modal, close } = createModal({
        title: 'Downloads are broken',
        content,
        onClose: () => {
            activeDownloadsBrokenModal = null;
        },
    });

    activeDownloadsBrokenModal = modal;
    content.querySelector('#downloads-broken-close-btn')?.addEventListener('click', close);
}

export function cancelDownloadAttempt(): false {
    showDownloadsBrokenModal();
    return false;
}

export function installDownloadInterceptors(): void {
    if (interceptorsInstalled || typeof document === 'undefined') {
        return;
    }

    document.addEventListener(
        'click',
        (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const downloadLink = target.closest('a[download]');
            if (!downloadLink) {
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();
            showDownloadsBrokenModal();
        },
        true
    );

    interceptorsInstalled = true;
}
