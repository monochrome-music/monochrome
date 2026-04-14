const _cr = [
    'emVl',
    'em1j',
    'emVlIG11c2lj',
    'emVlIGVudGVydGFpbm1lbnQ=',
    'emVlbA==',
    'Ym9sbHl3b29kIG11c2ljIGluZGlh',
    'emVlIHJlY29yZHM=',
    'emluZyBtdXNpYw==',
    'ZXRjIGJvbGx5d29vZA==',
    'emVlIHN0dWRpb3M=',
    'emluZGFnaSBtdXNpYw==',
    'emVlNQ==',
    'Ym9sbHl3b29kIG11c2lj',
    'ZXNzZWw=',
].map(atob);

export const isBlockedCopyright = (c: string | null | undefined): boolean =>
    !!c && _cr.some((s) => c.toLowerCase().includes(s));
