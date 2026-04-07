// js/label-utils.js

/**
 * Extracts a record label name from a TIDAL freeform copyright string.
 * Returns null if no label can be confidently identified.
 *
 * Examples:
 *   "℗ 1977 Barry Gibb under exclusive license to Capitol Music Group" → "Capitol Music Group"
 *   "℗ 2019 Interscope Records" → "Interscope Records"
 *   "Columbia Records, a division of Sony Music" → "Columbia Records"
 */
export function extractLabelName(copyright) {
    if (!copyright || typeof copyright !== 'string') return null;

    // Rule 1: "under [exclusive] license to/from Label Name"
    const licenseMatch = copyright.match(/under\s+(?:exclusive\s+)?license\s+(?:to|from)\s+([^,.\n℗©]+)/i);
    if (licenseMatch) return licenseMatch[1].trim();

    // Rule 2: "℗ YYYY Label Name" — label directly after phonogram symbol + year
    // Also handles (P) and (C) ASCII variants
    const phonogramMatch = copyright.match(/(?:[℗©]|\([PC]\))\s*\d{4}\s+(.+?)(?:\s*,|\s*\.|$)/i);
    if (phonogramMatch) {
        const candidate = phonogramMatch[1].trim();
        // Skip if it looks like a person's name followed by more text (e.g. "Barry Gibb and...")
        if (!candidate.includes(' and ') && !candidate.includes(' & ') && candidate.length < 60) {
            return candidate;
        }
    }

    // Rule 3: "Label Name, a division of ..." — take the part before the comma
    const divisionMatch = copyright.match(/^([^,℗©\d]+?),\s*a\s+(?:division|subsidiary|label)\s+of/i);
    if (divisionMatch) return divisionMatch[1].trim();

    // Rule 4: "YYYY Label Name" — year at start, no symbol
    const yearPrefixMatch = copyright.match(/^\d{4}\s+(.+?)(?:\s*,|\s*\.|$)/);
    if (yearPrefixMatch) {
        const candidate = yearPrefixMatch[1].trim();
        if (!candidate.includes(' and ') && !candidate.includes(' & ') && candidate.length < 60) {
            return candidate;
        }
    }

    // Rule 5: bare label name — short string with no year or symbols
    const trimmed = copyright.trim();
    if (trimmed.length > 0 && trimmed.length < 60 && !/\d{4}/.test(trimmed) && !/[℗©]/.test(trimmed) && !trimmed.includes('.')) {
        return trimmed;
    }

    return null;
}
