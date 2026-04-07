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

    return null;
}
