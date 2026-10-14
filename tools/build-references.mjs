// Builds the curated content from its readable source, which is kept outside this repository:
// - skills/dubwise/scripts/artists.mjs, the catalogue of artists, scenes, eras and riddims the composer knows, with
//   the words never to read as a name typed with a slip (every common word within a slip of an alias, from the word
//   map's vocabulary, plus the source's own NOT_NAMES);
// - src/selector-content.js, what the selector says.
// Each holds its content as an obfuscated string, so it does not read as plain text here. It is not encrypted: the
// browser has to read it, so anyone can.
// Usage: node tools/build-references.mjs [source folder]   (default ~/dev/dubwise-data, whose artists.mjs must
// `export const ARTISTS = [...]` and may `export const NOT_NAMES = [...]`, and whose selector.mjs must
// `export const SELECTOR = {...}`), then npm run sw:version.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

// Not the composer: it reads the file this writes.
import { editDistance } from "../skills/dubwise/scripts/distance.mjs";

const SOURCE = resolve(process.argv[2] ?? join(homedir(), "dev", "dubwise-data"));
const ROOT = join(import.meta.dirname, "..");
const LEXICON = join(ROOT, "skills", "dubwise", "assets", "lexicon.bin");
/** The keystream seed. Changing it changes every byte of the output and nothing else. */
const SEED = 0x6475_6273;
const CHOICES = {
    style: ["one-drop", "rockers", "steppers"],
    mode: ["major", "minor"],
    echo: ["low", "mid", "high"],
    density: ["sparse", "normal", "busy"],
    bass: ["root", "melodic"],
    family: ["reggae", "riddim", "rap", "rock", "funk", "classical"],
};

const source = await import(pathToFileURL(join(SOURCE, "artists.mjs")).href);
const { ARTISTS } = source;
const problems = [];
const aliases = new Map();
for (const entry of ARTISTS) {
    const where = entry.name ?? JSON.stringify(entry).slice(0, 40);
    if (typeof entry.name !== "string" || !entry.name) problems.push(`${where}: no name`);
    for (const [field, allowed] of Object.entries(CHOICES)) {
        if (!allowed.includes(entry[field])) problems.push(`${where}: ${field} "${entry[field]}"`);
    }
    if (!Number.isInteger(entry.bpm) || entry.bpm < 50 || entry.bpm > 200) problems.push(`${where}: bpm ${entry.bpm}`);
    if (typeof entry.traits !== "string" || !entry.traits) problems.push(`${where}: no traits`);
    for (const alias of entry.aliases ?? []) {
        // Aliases are matched against the composer's normalized text: lower case, no accents, single spaces.
        if (alias !== alias.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim())
            problems.push(`${where}: alias "${alias}" is not normalized`);
        if (aliases.has(alias)) problems.push(`${where}: alias "${alias}" is also ${aliases.get(alias)}'s`);
        aliases.set(alias, entry.name);
    }
    if (!entry.aliases?.length) problems.push(`${where}: no aliases`);
}
if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
}

// The composer forgives a slip in a name: one edit in a one-word name of six letters or more, two in one word of a
// longer name if that word has four letters or more, first letters agreeing. A common word that close to an alias
// is a word, not a slip, so "great day" never reads as Green Day.
const common = commonWords();
const notNames = new Set(source.NOT_NAMES ?? []);
const byLetter = Map.groupBy(common, (word) => word[0]);
// A word in several names, such as "riddim" or "band", is an everyday word here too.
const uses = Map.groupBy(
    [...aliases.keys()].flatMap((alias) => alias.split(" ")),
    (word) => word,
);
const shared = new Set([...uses].flatMap(([word, all]) => (all.length >= 3 ? [word] : [])));
for (const alias of aliases.keys()) {
    const words = alias.split(" ");
    for (const [k, word] of words.entries()) {
        const reach = words.length === 1 ? 1 : 2;
        if (word.length < (words.length === 1 ? 6 : 4)) continue;
        // A slip in one word of a longer name only misleads when the rest is everyday words too, as in "great day".
        if (!words.every((other, j) => j === k || other.length < 3 || common.has(other) || shared.has(other))) continue;
        for (const candidate of byLetter.get(word[0]) ?? []) {
            if (candidate === word || Math.abs(candidate.length - word.length) > reach) continue;
            if (editDistance(candidate, word) <= reach) notNames.add(candidate);
        }
    }
}

const fields = ["name", "aliases", "family", "style", "bpm", "mode", "echo", "density", "bass", "traits"];
const artists = writeModule(
    join(ROOT, "skills", "dubwise", "scripts", "artists.mjs"),
    [
        "The catalogue of artists, scenes, eras and riddims the composer knows, as broad style traits, checked against",
        "public sources; it holds no songs.",
    ],
    {
        artists: ARTISTS.map((entry) => Object.fromEntries(fields.map((field) => [field, entry[field]]))),
        notNames: [...notNames].sort(),
    },
    `{ artists: import("./composer.mjs").Artist[], notNames: string[] }`,
    `const { artists, notNames } = await decode(DATA);
export const ARTISTS = artists;
/** Words never read as a name typed with a slip, such as "great" next to Green Day. */
export const NOT_NAMES = new Set(notNames);
`,
);
console.log(`${ARTISTS.length} references and ${notNames.size} words that are not names: ${artists}`);

const { SELECTOR } = await import(pathToFileURL(join(SOURCE, "selector.mjs")).href);
const names = new Set(ARTISTS.map((/** @type {{ name: string }} */ entry) => entry.name));
const techniques = new Set(SELECTOR.techniques.map((/** @type {{ id: string }} */ technique) => technique.id));
const moods = new Set(SELECTOR.moods.map((/** @type {{ name: string }} */ mood) => mood.name));
const wrong = [
    ...SELECTOR.moods.filter((/** @type {{ technique: string }} */ mood) => !techniques.has(mood.technique)),
    ...[...SELECTOR.stories, ...SELECTOR.favourites].filter((/** @type {{ name: string }} */ x) => !names.has(x.name)),
    ...SELECTOR.feelings.filter(
        (/** @type {{ moods: string[] }} */ feeling) => !feeling.moods.every((m) => moods.has(m)),
    ),
    ...SELECTOR.faq.filter(
        (/** @type {{ technique?: string }} */ entry) => entry.technique && !techniques.has(entry.technique),
    ),
];
// Every text in every language, and every line the selector says in each language.
const LANGS = ["en", "pt", "es"];
/** @param {unknown} value @param {string} where */
function untranslated(value, where) {
    if (!value || typeof value !== "object") return [];
    const record = /** @type {Record<string, unknown>} */ (value);
    if ("en" in record && typeof record.en === "string")
        return LANGS.filter((lang) => typeof record[lang] !== "string" || (record.en && !record[lang])).map(
            (lang) => `${where} ${lang}`,
        );
    return Object.entries(record).flatMap(([key, inner]) => untranslated(inner, `${where}.${key}`));
}
const voices = Object.keys(SELECTOR.lines.en);
wrong.push(
    ...untranslated({ ...SELECTOR, lines: undefined }, "selector"),
    ...LANGS.flatMap((lang) =>
        voices.filter((voice) => !SELECTOR.lines[lang]?.[voice]?.length).map((voice) => `line ${voice} ${lang}`),
    ),
);
if (wrong.length) {
    console.error(
        `the selector's content has gaps:\n${wrong.map((w) => (typeof w === "string" ? w : JSON.stringify(w))).join("\n")}`,
    );
    process.exit(1);
}
const said = writeModule(
    join(ROOT, "src", "selector-content.js"),
    [
        "What the selector says, in English, Portuguese and Spanish: its voice, moods, techniques, stories, answers,",
        "challenges and favourites.",
    ],
    SELECTOR,
    `import("./selector.js").Content`,
    `export const SELECTOR = await decode(DATA);
`,
);
console.log(
    `${SELECTOR.moods.length} moods, ${SELECTOR.techniques.length} techniques, ${SELECTOR.stories.length} stories, ${SELECTOR.faq.length} answers, ${SELECTOR.challenges.length} challenges, ${SELECTOR.favourites.length} favourites, in ${LANGS.join(", ")}: ${said}`,
);

/**
 * Write a module that holds `payload` compressed and obfuscated, then reads it with `tail`. Returns where and how big.
 * @param {string} file @param {string[]} what comment lines on what it holds @param {unknown} payload
 * @param {string} type the JSDoc type of the payload @param {string} tail
 */
function writeModule(file, what, payload, type, tail) {
    // Compressed before it is mixed, since mixed bytes no longer compress on the way to the browser.
    const bytes = deflateRawSync(JSON.stringify(payload), { level: 9 });
    const next = keystream(SEED);
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= next();
    const data = Buffer.from(bytes).toString("base64");
    writeFileSync(
        file,
        `// @ts-check
// Generated by tools/build-references.mjs from a source kept outside this repository. Do not edit by hand.
${what.map((text) => `// ${text}`).join("\n")}
// It is obfuscated so it does not read as plain text here, not encrypted.

const DATA =
    "${data}";

/** The bytes of a small pseudo-random sequence, the same one the build mixed in. @param {number} seed */
function keystream(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) & 0xff;
    };
}

/** @param {string} text @returns {Promise<${type}>} */
async function decode(text) {
    const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const next = keystream(${SEED});
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= next();
    const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return JSON.parse(await new Response(inflated).text());
}

${tail}`,
    );
    return `${file} (${(data.length / 1024).toFixed(0)} KB)`;
}

/**
 * The common words of the word map's vocabulary, accents folded: whole-word tokens that score above the one score
 * its tokenizer gives most tokens, the rare ones.
 * @returns {Set<string>}
 */
function commonWords() {
    const file = readFileSync(LEXICON);
    const metaLength = file.readUInt32LE(0);
    const meta = JSON.parse(file.subarray(4, 4 + metaLength).toString());
    let at = 4 + metaLength;
    at += (8 - (at % 8)) % 8;
    const scores = new Int16Array(file.buffer.slice(file.byteOffset + at, file.byteOffset + at + meta.count * 2));
    at += meta.count * 2;
    const pieces = file
        .subarray(at, at + meta.piecesBytes)
        .toString()
        .split("\n");
    // Most tokens share one score, the tokenizer's estimate for anything rare; common words score above it.
    const counts = new Map();
    for (const score of scores) counts.set(score, (counts.get(score) ?? 0) + 1);
    const floor = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
    const words = new Set();
    for (const [i, piece] of pieces.entries()) {
        if (scores[i] <= floor || !piece.startsWith("▁")) continue;
        const word = piece.slice(1).normalize("NFD").replace(/\p{M}/gu, "");
        if (/^[a-z]{3,}$/.test(word)) words.add(word);
    }
    return words;
}

/** Same as the decoder's keystream in the output. @param {number} seed */
function keystream(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) & 0xff;
    };
}
