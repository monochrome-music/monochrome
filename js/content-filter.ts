const _cr = [
    'emVl', // zee
    'em1j', // zmc
    'emluZyBtdXNpYw==', // zing music
    'ZXRjIGJvbGx5d29vZA==', // etc bollywood
    'Ym9sbHl3b29kIG11c2lj', // bollywood music
    'ZXNzZWw=', // essel
    'emluZGFnaQ==', // zindagi
].map(atob);

export const isBlockedCopyright = (c: string | null | undefined): boolean =>
    !!c && _cr.some((s) => c.toLowerCase().includes(s));
