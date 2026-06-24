const _cr = [
    'emVl',
    'em1j',
    'emluZyBtdXNpYw==',
    'ZXRjIGJvbGx5d29vZA==',
    'Ym9sbHl3b29kIG11c2lj',
    'ZXNzZWw=',
    'emluZGFnaQ==',
    'ZWQgc2hlZXJhbg==',
].map(atob);

export const isBlockedCopyright = (c: string | { text?: string } | null | undefined): boolean => {
    const text = typeof c === 'string' ? c : c?.text;
    return !!text && _cr.some((s) => text.toLowerCase().includes(s));
};

const _bp = [
    ['MXl2Mnlud2JqbnlydjQ1ajRsbjBpMmY4MHBuY3NtcF93X2R2aWItdXRheHc=', 'dmll'],
].map(([s, p]) => [atob(s), atob(p)] as [string, string]);

const _bt = [
    'dHJhY2tlci0xeXYyeW53YmpueXJ2NDVqNGxuMGkyZjgwcG5jc21wX3dfZHZpYi11dGF4dy12aWUtNQ==',
].map(atob);

export const isBlockedTrackerProject = (sheetId: string | null | undefined, projectName: string | null | undefined): boolean =>
    !!sheetId && !!projectName &&
    _bp.some(([s, p]) => sheetId.toLowerCase() === s && projectName.toLowerCase() === p);

export const isBlockedTrackerTrack = (trackId: string | null | undefined): boolean =>
    !!trackId && _bt.some((t) => trackId.toLowerCase() === t);
