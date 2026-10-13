// @ts-check
/**
 * dubwise's own word map, which reads words the composer's lists do not know by where they sit among the words it
 * does know. The map, assets/lexicon.bin, is built by tools/build-lexicon.mjs from potion-multilingual-128M (MIT),
 * a static embedding model: no model runs here. A phrase is the mean of its tokens' vectors, and each trait (minor or
 * major, slow or lively, sparse or busy, dry or wide echo) goes to the side whose known words lie closer, when the gap
 * is clear. Measured on 30 odd ideas in three languages, it read 27 right; names it may read loosely.
 */
import { knownFeelings } from "./composer.mjs";

/** @typedef {import("./intent.mjs").Reading} Reading */

/** How much closer one side of a trait must be before the trait is set. */
const MARGIN = 0.05;
/** The longest token, in characters, worth looking for. */
const LONGEST = 24;
/** The cost of a character no token covers, so a word made of unknown letters still gets read. */
const UNKNOWN = -20;
const TRAITS = /** @type {const} */ ({
    mode: ["minor", "major"],
    tempo: ["slow", "lively"],
    density: ["sparse", "busy"],
    echo: ["low", "high"],
});
const SAID = { low: "dry echo", high: "wide echo" };

/** Lower case, accents kept, everything but letters and digits turned into spaces. @param {string} text */
function words(text) {
    return text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(" ")
        .filter(Boolean);
}

/** A word as the composer compares it: lower case, no accents. @param {string} word */
function folded(word) {
    return word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Read a word map from the contents of lexicon.bin.
 * @param {ArrayBuffer} buffer
 * @returns {{ read: (text: string, only?: string[]) => Reading | null, tokens: (word: string) => string[] }}
 */
export function parseLexicon(buffer) {
    const metaLength = new DataView(buffer).getUint32(0, true);
    /** @type {{ count: number, dims: number, scales: number[], piecesBytes: number }} */
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, metaLength)));
    let at = 4 + metaLength;
    at += (8 - (at % 8)) % 8;
    const scores = new Int16Array(buffer, at, meta.count);
    at += meta.count * 2;
    const pieces = new TextDecoder().decode(new Uint8Array(buffer, at, meta.piecesBytes)).split("\n");
    at += meta.piecesBytes;
    const packed = new Uint8Array(buffer, at, (meta.count * meta.dims) / 2);
    const { dims, scales } = meta;
    const index = new Map(pieces.map((piece, i) => [piece, i]));

    /** The best split of a word into known tokens (Unigram, by Viterbi), as token numbers. @param {string} word */
    function split(word) {
        const text = `▁${word}`;
        const best = new Float64Array(text.length + 1).fill(Number.NEGATIVE_INFINITY);
        /** @type {[number, number][]} start of the last token and its number, -1 for an uncovered character */
        const back = new Array(text.length + 1);
        best[0] = 0;
        for (let i = 0; i < text.length; i++) {
            if (best[i] === Number.NEGATIVE_INFINITY) continue;
            for (let length = 1; length <= LONGEST && i + length <= text.length; length++) {
                const token = index.get(text.slice(i, i + length));
                if (token === undefined) continue;
                const score = best[i] + scores[token] / 1000;
                if (score > best[i + length]) {
                    best[i + length] = score;
                    back[i + length] = [i, token];
                }
            }
            if (best[i] + UNKNOWN > best[i + 1]) {
                best[i + 1] = best[i] + UNKNOWN;
                back[i + 1] = [i, -1];
            }
        }
        const tokens = [];
        for (let end = text.length; end > 0; end = back[end][0]) if (back[end][1] >= 0) tokens.push(back[end][1]);
        return tokens.reverse();
    }

    /** The unit vector of some words, or null when no token of theirs is known. @param {string[]} list */
    function embed(list) {
        const tokens = list.flatMap(split);
        if (!tokens.length) return null;
        const sum = new Float64Array(dims);
        for (const token of tokens) {
            for (let c = 0; c < dims; c++) {
                const at = token * dims + c;
                const nibble = (packed[at >> 1] >> ((at & 1) * 4)) & 0x0f;
                sum[c] += (nibble >= 8 ? nibble - 16 : nibble) * scales[c];
            }
        }
        return unit(sum);
    }

    // Each side of each trait is the mean direction of the known words on that side, around all known words.
    const anchors = knownFeelings().flatMap(({ word, feel }) => {
        const vector = embed(words(word));
        return vector ? [{ feel, vector }] : [];
    });
    const center = new Float64Array(dims);
    for (const { vector } of anchors) for (let c = 0; c < dims; c++) center[c] += vector[c] / anchors.length;
    const poles = Object.entries(TRAITS).map(([field, sides]) => ({
        field,
        sides: sides.map((value) => {
            const sum = new Float64Array(dims);
            for (const { feel, vector } of anchors) {
                if (feel[/** @type {keyof Reading} */ (field)] !== value) continue;
                for (let c = 0; c < dims; c++) sum[c] += vector[c] - center[c];
            }
            return { value, vector: unit(sum) };
        }),
    }));

    return {
        /**
         * Read some words. With \`only\`, the composer's unknown phrases, just the words of \`text\` in them are read,
         * accents and all, so a known name in the same idea does not color the reading.
         */
        read(text, only) {
            const wanted = only && new Set(only.flatMap((phrase) => phrase.split(" ")));
            const picked = words(text).filter((word) => !wanted || wanted.has(folded(word)));
            const vector = embed(picked);
            if (!vector) return null;
            const centered = unit(vector.map((value, c) => value - center[c]));
            /** @type {Record<string, string>} */
            const reading = {};
            const said = [];
            for (const { field, sides } of poles) {
                const [a, b] = sides.map((side) => dot(side.vector, centered));
                if (Math.abs(a - b) < MARGIN) continue;
                const value = a > b ? sides[0].value : sides[1].value;
                reading[field] = value;
                said.push(SAID[/** @type {keyof typeof SAID} */ (value)] ?? value);
            }
            if (!said.length) return null;
            return /** @type {Reading} */ ({ ...reading, reading: said.join(", "), by: "dubwise" });
        },
        /** The tokens a word splits into, for tests and curiosity. @param {string} word */
        tokens: (word) => split(words(word)[0] ?? "").map((token) => pieces[token]),
    };
}

/** @param {ArrayLike<number>} a @param {ArrayLike<number>} b */
function dot(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
}

/** @param {Float64Array} vector */
function unit(vector) {
    const length = Math.sqrt(dot(vector, vector)) || 1;
    return vector.map((value) => value / length);
}
