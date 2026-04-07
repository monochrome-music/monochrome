// js/label-utils.js

/**
 * Extracts a record label name from a TIDAL freeform copyright string.
 * Returns null if no label can be confidently identified.
 *
 * Handles formats observed in the wild:
 *   "℗ 2019 Interscope Records"                                   → "Interscope Records"
 *   "(P) 2016 Hypercolour"                                         → "Hypercolour"
 *   "(C) 2001 Blue Note Records"                                   → "Blue Note Records"
 *   "© 2003 Capitol Records, LLC"                                  → "Capitol Records, LLC"
 *   "2002 Riva Sound"                                              → "Riva Sound"
 *   "2025 Passyunk Productions LLC / EMPIRE"                       → "Passyunk Productions LLC / EMPIRE"
 *   "This compilation (P) 2010 Sony Music Entertainment"           → "Sony Music Entertainment"
 *   "℗ 1977 Barry Gibb under exclusive license to Capitol Music"   → "Capitol Music"
 *   "2019 Papyrus Records, under license to Dreamus"               → "Papyrus Records"
 *   "© 1995 ECM Records GmbH, under exclusive license to DG"      → "ECM Records GmbH"
 *   "Columbia Records, a division of Sony Music"                   → "Columbia Records"
 *   "XL Recordings Ltd"                                            → "XL Recordings Ltd"
 *   "Ninja Tune"                                                   → "Ninja Tune"
 *   "Hypercolour"                                                  → "Hypercolour"
 *   "(P) 1972, 1973, 1974 Sony Music Entertainment Inc."           → "Sony Music Entertainment Inc."
 */
export function extractLabelName(copyright) {
    if (!copyright || typeof copyright !== 'string') return null;

    let s = copyright.trim();

    // Strip leading boilerplate phrases: "This compilation", "Originally released YYYY", etc.
    s = s.replace(/^(this\s+compilation|originally\s+(released|recorded)\s+\d{4}[^.]*?\.\s*)/i, '').trim();

    // Rule 1: symbol/year + label + "under license to X" → return the label BEFORE "under license"
    const symbolYearLicenseMatch = s.match(/(?:[℗©]|\([PC]\))\s*(?:\d{4}[\s,]*)+(.+?),\s*under\s+(?:exclusive\s+)?license/i);
    if (symbolYearLicenseMatch) return symbolYearLicenseMatch[1].trim();

    // Rule 2: bare year(s) + label + "under license to X" → return label before "under license"
    const yearLicenseMatch = s.match(/^\d{4}(?:[,\s]+\d{4})*\s+(.+?),\s*under\s+(?:exclusive\s+)?license/i);
    if (yearLicenseMatch) return yearLicenseMatch[1].trim();

    // Rule 3: "under [exclusive] license to/from Label" with no preceding label → take what comes AFTER
    const licenseToMatch = s.match(/under\s+(?:exclusive\s+)?license\s+(?:to|from)\s+([^,.\n℗©(]+)/i);
    if (licenseToMatch) return licenseToMatch[1].trim();

    // Rule 4: phonogram/copyright symbol + one or more years + label
    // Handles "(P) 1972, 1973, 1974 Sony Music" style multi-year strings
    const symbolYearMatch = s.match(/(?:[℗©]|\([PC]\))\s*(?:\d{4}[\s,]*)+(.+?)(?:,\s*a\s+(?:division|subsidiary|label)\s+of|[.\n]|$)/i);
    if (symbolYearMatch) {
        const candidate = symbolYearMatch[1].trim().replace(/\s+/g, ' ');
        if (candidate.length > 0 && candidate.length < 80) return candidate;
    }

    // Rule 5: bare year(s) at start + label (no symbol) e.g. "2002 Riva Sound"
    const yearPrefixMatch = s.match(/^\d{4}(?:[,\s]+\d{4})*\s+(.+?)(?:,\s*a\s+(?:division|subsidiary|label)\s+of|[.\n]|$)/i);
    if (yearPrefixMatch) {
        const candidate = yearPrefixMatch[1].trim().replace(/\.$/, '');
        if (candidate.length > 0 && candidate.length < 80) return candidate;
    }

    // Rule 4: "Label, a division/subsidiary/label of ..." — take before the comma
    const divisionMatch = s.match(/^([^,℗©\d(]+?),\s*a\s+(?:division|subsidiary|label)\s+of/i);
    if (divisionMatch) return divisionMatch[1].trim();

    // Rule 5: "Label, under license to ..." — take the label BEFORE the comma
    const underLicenseFromMatch = s.match(/^([^,℗©\d(]+?),\s*under\s+(?:exclusive\s+)?license/i);
    if (underLicenseFromMatch) return underLicenseFromMatch[1].trim();

    // Rule 6: bare label name — no year, no symbols, no sentence punctuation
    if (!/\d{4}/.test(s) && !/[℗©]/.test(s) && !/\([PC]\)/i.test(s) && !s.includes('.') && s.length < 80) {
        return s;
    }

    return null;
}
