const _cr = [
    'emVl',     
    'em1j',
    'emluZyBtdXNpYw==', 
    'ZXRjIGJvbGx5d29vZA==',
    'Ym9sbHl3b29kIG11c2lj',  
    'ZXNzZWw=',    
    'emluZGFnaQ==',
].map(atob);

export const isBlockedCopyright = (c: string | null | undefined): boolean =>
    !!c && _cr.some((s) => c.toLowerCase().includes(s));
