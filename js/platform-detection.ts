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
    !lowerCaseOriginalUserAgent.includes('android');
