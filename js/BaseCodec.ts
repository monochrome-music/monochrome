class BaseCodec {
    private readonly dictionary: string[];
    private readonly base: number;
    private readonly dictionarySet: Set<string>;

    constructor(dictionary: string) {
        if (new Set(dictionary).size !== dictionary.length) {
            throw new Error('Dictionary must not contain duplicate characters.');
        }

        if (dictionary.length < 2) {
            throw new Error('Dictionary must contain at least 2 symbols.');
        }

        this.dictionary = [...dictionary];
        this.dictionarySet = new Set(dictionary);
        this.base = dictionary.length;
    }

    /**
     * Encode overloads:
     * - number → sync encoding (base-N)
     * - string | Uint8Array | Blob → byte-level encoding
     */
    encode(input: number): string;
    encode(input: string | Uint8Array): string;
    encode(input: number | string | Uint8Array): string {
        if (typeof input === 'number') {
            return this.encodeNumber(input);
        }
        return this.encodeBytes(input);
    }

    /**
     * Converts a number to a base-N string using the provided dictionary.
     * Rounds the number first; prefixes '-' if negative.
     */
    encodeNumber(num: number): string {
        if (!Number.isFinite(num)) {
            throw new Error('Input must be a finite number.');
        }

        const negative = num < 0;
        num = Math.round(Math.abs(num));

        if (num === 0) {
            return this.dictionary[0];
        }

        let encoded = '';
        while (num > 0) {
            encoded = this.dictionary[num % this.base] + encoded;
            num = Math.floor(num / this.base);
        }

        return negative ? '-' + encoded : encoded;
    }

    /**
     * Asynchronously encodes binary input (string, bytes, or Blob) using base-N byte-level logic.
     */
    encodeBytes(input: string | Uint8Array | ArrayBuffer): string {
        let bytes: Uint8Array;

        if (typeof input === 'string') {
            bytes = new TextEncoder().encode(input);
        } else if (input instanceof Uint8Array) {
            bytes = input;
        } else if (input instanceof ArrayBuffer) {
            bytes = new Uint8Array(input);
        } else if (Array.isArray(input)) {
            bytes = new Uint8Array(input);
        } else {
            throw new Error('Unsupported input type for encode');
        }

        // Count leading zeros
        let zeroCount = 0;
        while (zeroCount < bytes.length && bytes[zeroCount] === 0) zeroCount++;

        const digits: string[] = [];
        let inputArray = Array.from(bytes);

        while (inputArray.length > 0 && !(inputArray.length === 1 && inputArray[0] === 0)) {
            const newInput: number[] = [];
            let remainder = 0;

            for (const byte of inputArray) {
                const acc = (remainder << 8) + byte;
                const digit = Math.floor(acc / this.base);
                remainder = acc % this.base;
                if (newInput.length > 0 || digit !== 0) newInput.push(digit);
            }

            digits.push(this.dictionary[remainder]);
            inputArray = newInput;
        }

        for (let i = 0; i < zeroCount; i++) digits.push(this.dictionary[0]);

        return digits.reverse().join('');
    }

    /**
     * Decodes a base-N string back to a number. Handles optional '-' prefix.
     */
    decodeNumber(str: string): number {
        if (typeof str !== 'string' || str.length === 0) {
            throw new Error('Input must be a non-empty string.');
        }

        const negative = str[0] === '-';
        if (negative) str = str.slice(1);

        let num = 0;

        if (new Set(str).isSubsetOf(this.dictionarySet) === false) {
            throw new Error('Input contains invalid characters.');
        }

        for (let i = 0; i < str.length; i++) {
            const val = this.dictionary.indexOf(str[i]);
            num = num * this.base + val;
        }

        return negative ? -num : num;
    }

    /**
     * Decodes a string or binary representation back to a Uint8Array.
     */
    decodeBytes(input: string): Uint8Array {
        if (input.length === 0) return new Uint8Array();

        let zeroCount = 0;
        while (zeroCount < input.length && input[zeroCount] === this.dictionary[0]) zeroCount++;

        const charToValue: Record<string, number> = Object.fromEntries(this.dictionary.map((c, i) => [c, i]));

        const bytes: number[] = [];
        let inputArray = Array.from(input, (c) => {
            const v = charToValue[c];
            if (v === undefined) throw new Error(`Invalid character: ${c}`);
            return v;
        });

        while (inputArray.length > 0 && !(inputArray.length === 1 && inputArray[0] === 0)) {
            const newInput: number[] = [];
            let remainder = 0;

            for (const digit of inputArray) {
                const acc = remainder * this.base + digit;
                const byte = Math.floor(acc / 256);
                remainder = acc % 256;
                if (newInput.length > 0 || byte !== 0) newInput.push(byte);
            }

            bytes.push(remainder);
            inputArray = newInput;
        }

        for (let i = 0; i < zeroCount; i++) bytes.push(0);

        return new Uint8Array(bytes.reverse());
    }
}

const dictionaries: Record<string, BaseCodec> = {};

export const Base64Dictionary = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const InvisibleDictionary = '\u200B\u200C\u200D\uFEFF';

export function baseCodecFrom(dictionary: string): BaseCodec {
    return dictionaries[dictionary] || (dictionaries[dictionary] = new BaseCodec(dictionary));
}

namespace BaseCodec {
    /**
     * Converts a number to a Base64 string.
     * Rounds the number first; prefixes '-' if negative.
     * @param {number} num - The number to convert.
     * @returns {string} The Base64-encoded representation.
     */
    export const encode = (num: number) => baseCodecFrom(Base64Dictionary).encodeNumber(num);

    /**
     * Decodes a Base64 string back to a number.
     * Handles optional '-' prefix.
     * @param {string} str - The Base64-encoded string.
     * @returns {number} The decoded number.
     */
    export const decode = (str: string) => baseCodecFrom(Base64Dictionary).decodeNumber(str);
}

export default BaseCodec;
