/** The original user agent string before spoofing. */
export const originalUserAgent = navigator.userAgent;

/** A lowercase version of the original user agent string. */
const lowerCaseOriginalUserAgent = originalUserAgent.toLowerCase();

/** If the device is an iOS device. (iPhone, iPad, iPod, or Apple Vision) */
export const isIos =
    /iphone|ipad|ipod|applevision/.test(lowerCaseOriginalUserAgent) ||
    (lowerCaseOriginalUserAgent.includes('mac') && navigator.maxTouchPoints > 1);

/** If the browser is Safari (excluding Chrome, Chromium-based browsers, and Android browsers). */
export const isSafari =
    lowerCaseOriginalUserAgent.includes('safari') &&
    !lowerCaseOriginalUserAgent.includes('chrome') &&
    !lowerCaseOriginalUserAgent.includes('crios') &&
    !lowerCaseOriginalUserAgent.includes('android') &&
    !lowerCaseOriginalUserAgent.includes('linux');

/** If the browser is Chrome. */
export const isChrome = lowerCaseOriginalUserAgent.includes('chrome') || lowerCaseOriginalUserAgent.includes('crios');

/** If the browser is Firefox (excluding Chromium browsers with a modified user agent). */
export const isFirefox = lowerCaseOriginalUserAgent.includes('firefox') && !isChrome;

/** If the browser is Microsoft Edge. */
export const isEdge = lowerCaseOriginalUserAgent.includes('edg/') || lowerCaseOriginalUserAgent.includes('edge/');

/** If the browser is WebKitGTK. */
export const isWebKitGtk = lowerCaseOriginalUserAgent.includes('webkit') &&
    lowerCaseOriginalUserAgent.includes('mozilla') &&
    lowerCaseOriginalUserAgent.includes('linux');

type AmazonDecrypterBrowser = {
    isFirefox: boolean;
    isSafari: boolean;
    isWebKitGtk: boolean;
};

type NavigatorWithUserAgentData = Navigator & {
    userAgentData?: {
        brands?: Array<{ brand: string }>;
    };
};

/**
 * Choose the container emitted by the service-worker Amazon decrypter.
 *
 * Firefox cannot reliably consume the progressively rewritten fragmented MP4:
 * after enough playback it may request a sample past the bytes it has buffered
 * and abort with MediaResult/SampleIterator decoding errors. Segmented HLS
 * avoids that progressive-resource path while retaining seekable time ranges.
 */
export function getAmazonDecrypterCodec(
    quality: string,
    browser: AmazonDecrypterBrowser = { isFirefox, isSafari, isWebKitGtk }
): 'opus' | 'mp4a' | 'eac3' | 'ac4' | 'flac-hls' | 'flac-raw' | 'flac' {
    const normalizedQuality = quality.toUpperCase();
    if (normalizedQuality.startsWith('DOLBY_ATMOS_AC4_')) return 'ac4';
    if (normalizedQuality.startsWith('DOLBY_ATMOS_EAC3_') || normalizedQuality === 'DOLBY_ATMOS') return 'eac3';
    const isOpusQuality =
        normalizedQuality === 'HIGH' ||
        normalizedQuality === 'NORMAL' ||
        normalizedQuality === 'LOW' ||
        normalizedQuality.startsWith('SD_');
    if (isOpusQuality) return 'opus';
    if (browser.isSafari || browser.isFirefox || browser.isWebKitGtk) return 'flac-hls';

    return 'flac';
}

/** Check whether the runtime reports native support for an immersive MP4 codec. */
export function canBrowserStreamAtmosQuality(quality: string, mediaElement: HTMLMediaElement | null = null): boolean {
    const normalizedQuality = quality.toUpperCase();
    const isAc4 = normalizedQuality.startsWith('DOLBY_ATMOS_AC4_');
    const isEac3 = normalizedQuality.startsWith('DOLBY_ATMOS_EAC3_') || normalizedQuality === 'DOLBY_ATMOS';
    if (!isAc4 && !isEac3) return true;

    const probe = mediaElement || (typeof document !== 'undefined' ? document.createElement('audio') : null);
    if (!probe?.canPlayType) return false;

    const mimeTypes = isAc4
        ? ['audio/mp4; codecs="ac-4"', 'audio/mp4; codecs="ac-4.02.01.01"']
        : ['audio/mp4; codecs="ec-3"', 'audio/mp4; codecs="eac3"'];
    return mimeTypes.some(
        (mimeType) =>
            probe.canPlayType(mimeType) !== '' ||
            (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported?.(mimeType) === true)
    );
}

const chromiumBrandPattern = /chromium|chrome|edge|opera|brave/i;
const userAgentBrands = (navigator as NavigatorWithUserAgentData).userAgentData?.brands ?? [];

/** If this browser has Chromium's native ClearKey/CENC behavior we rely on for Amazon streams. */
export const canUseNativeAmazonCenc =
    !isIos &&
    !isSafari &&
    (userAgentBrands.some((brand) => chromiumBrandPattern.test(brand.brand)) || 'chrome' in globalThis);

export function getLocalFilesSupportInfo(): { supported: boolean; message: string | null } {
    const isFileSystemAccessSupported = 'showDirectoryPicker' in window;

    if (isFileSystemAccessSupported) {
        return { supported: true, message: null };
    }

    const brands = (navigator as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? [];
    const isBrave = brands.some((brand) => /brave/i.test(brand.brand));

    if (isBrave) {
        return {
            supported: false,
            message:
                "We've detected you're on Brave, which disabled the File System API by default. Paste brave://flags/#file-system-access-api into your address bar, change it to Enabled, and relaunch your browser.",
        };
    }

    if (isSafari || isFirefox) {
        return {
            supported: false,
            message:
                'Local Files is only available on Chromium-based browsers because Firefox and Safari explicitly do not support the File System Access API. We recommend <a href="https://helium.computer/" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline">Helium</a>.',
        };
    }

    return {
        supported: false,
        message:
            'Your browser doesn\'t support the File System Access API, which is required for Local Files. We recommend <a href="https://helium.computer/" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline">Helium</a>.',
    };
}
