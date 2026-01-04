/**
 * Converts an RGB color value to HSL.
 * Assumes r, g, and b are contained in the set [0, 255] and
 * returns h, s, and l in the set [0, 1].
 */
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    return [h, s, l];
}

/**
 * Converts an HSL color value to RGB hex string.
 */
function hslToHex(h, s, l) {
    let r, g, b;

    if (s === 0) {
        r = g = b = l; // achromatic
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    const toHex = x => {
        const hex = Math.round(x * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function getVibrantColorFromImage(imgElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = imgElement.naturalWidth || imgElement.width;
    canvas.height = imgElement.naturalHeight || imgElement.height;

    try {
        ctx.drawImage(imgElement, 0, 0);
        
        // Downscale for performance if image is large
        const maxDimension = 64; 
        if (canvas.width > maxDimension || canvas.height > maxDimension) {
            const scale = Math.min(maxDimension / canvas.width, maxDimension / canvas.height);
            const w = Math.floor(canvas.width * scale);
            const h = Math.floor(canvas.height * scale);
            const smallCanvas = document.createElement('canvas');
            smallCanvas.width = w;
            smallCanvas.height = h;
            smallCanvas.getContext('2d').drawImage(imgElement, 0, 0, w, h);
            ctx.drawImage(smallCanvas, 0, 0, canvas.width, canvas.height); 
            // Actually, better to just use the small canvas data
            var imageData = smallCanvas.getContext('2d').getImageData(0, 0, w, h);
        } else {
            var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }

        const pixels = imageData.data;
        const candidates = [];
        
        // Iterate through pixels
        for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const a = pixels[i + 3];

            if (a < 125) continue; // Skip transparent

            const [h, s, l] = rgbToHsl(r, g, b);

            // Filter out very dark, very bright, or very desaturated pixels for the "vibrant" candidate list
            // Vibrant: High saturation (s > 0.3), Moderate lightness (0.3 < l < 0.8)
            if (s >= 0.3 && l >= 0.3 && l <= 0.8) {
                candidates.push({ r, g, b, h, s, l });
            }
        }

        // If no candidates found with strict criteria, relax criteria
        if (candidates.length === 0) {
             for (let i = 0; i < pixels.length; i += 4) {
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const a = pixels[i + 3];
                if (a < 125) continue;
                const [h, s, l] = rgbToHsl(r, g, b);
                // Allow anything not practically black or white
                if (l > 0.1 && l < 0.95) {
                    candidates.push({ r, g, b, h, s, l });
                }
            }
        }

        // If still no candidates, return null (caller will handle fallback to default)
        if (candidates.length === 0) return null;

        // Sort by saturation (descending) then lightness (proximity to 0.5)
        candidates.sort((c1, c2) => {
            return c2.s - c1.s || (0.5 - Math.abs(c1.l - 0.5)) - (0.5 - Math.abs(c2.l - 0.5));
        });

        // Pick the top candidate (most vibrant)
        // Optionally averaging top N could be done, but simplified "best single pixel" is usually sufficient for "Vibrant"
        const best = candidates[0];
        
        return hslToHex(best.h, best.s, best.l);

    } catch (e) {
        throw e; // Re-throw to allow UI to handle CORS retry
    }
}