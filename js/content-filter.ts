const _cr = [
    'emVl',
    'em1j',
    'emluZyBtdXNpYw==',
    'ZXRjIGJvbGx5d29vZA==',
    'Ym9sbHl3b29kIG11c2lj',
    'ZXNzZWw=',
    'emluZGFnaQ==',
].map(atob);

export const isBlockedCopyright = (c: string | { text?: string } | null | undefined): boolean => {
    const text = typeof c === 'string' ? c : c?.text;
    return !!text && _cr.some((s) => text.toLowerCase().includes(s));
};
