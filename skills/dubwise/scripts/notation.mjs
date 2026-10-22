// @ts-check
/**
 * dubwise riddim notation: parse, validate, serialize and turn into a shareable URL.
 *
 * One setting per line. Pattern lines split bars with "|", 16 steps per bar.
 *
 *   dubwise 1
 *   bpm 72
 *   key A minor
 *   kick   ........x....... | ........x.......
 *   hat    x.x.x.x.x.x.x.x.
 *   bass   1 . . 1 . . 3 . 5 . . . 4 . 3 .
 *   chords 1 | 4
 *
 * Pure module: no DOM, no Web Audio. Used by the app, the CLI and the tests.
 */

export const VERSION = 1;
export const STEPS_PER_BAR = 16;
export const MAX_BARS = 8;
export const DRUMS = /** @type {const} */ (["kick", "rim", "hat", "snare", "clap", "skank", "organ"]);
/** What each echo repeat goes through: tape (Nux Tape Echo), space (Boss RE-2 + spring), bbd (analog), digital (open). */
export const ECHO_MODELS = /** @type {const} */ (["tape", "space", "bbd", "digital"]);
export const DEFAULT_BASE_URL = "https://alb777.github.io/dubwise/";

const SETTINGS = new Set(["bpm", "key", "swing", "bars", "echo", "spring", "bass", "lead", "chords", ...DRUMS]);

/**
 * The notation in a few lines: the app's help, the prompt for an AI and the agent skill all quote this text.
 */
export const SPEC = `dubwise riddim notation, version ${VERSION}. One setting per line. "# " starts a comment.

dubwise 1             first line, always
bpm 72                50 to 200
key A minor           root A to G with an optional # or b, then major or minor
swing 0.15            0 to 0.6: every odd 16th is delayed by that share of a step
bars 2                1 to ${MAX_BARS}; defaults to the longest pattern; shorter patterns loop
kick   <steps>        16 steps per bar, bars split by |: . rest, x hit, X accent
rim    <steps>        same as kick
hat    <steps>        same, plus o for an open hat
skank  <steps>        chord chops, playing the chord the chords line gives for that step
organ  <steps>        the organ bubble, same steps as the skank: rounder chord stabs, a hammond under the chops
chords 1 | 4          1, 2 or 4 chord degrees per bar; diatonic to the key; m or M forces minor or major
bass   <tokens>       16 tokens per bar, space separated: . rest, - holds the previous note,
                      a scale degree 1 to 7 with an optional b or # (b3), ' an octave up, , an octave down (5,)
lead   <tokens>       the melodica's own line, same tokens as bass and octave marks; optional,
                      no line means no melody, and asking for a melody makes the composer write one
echo 3/16 0.55        tape echo time as a note length over 4, 8, 16 or 32, and feedback 0 to 0.95,
                      then the head the repeats go through: ${ECHO_MODELS.join(", ")} (default ${ECHO_MODELS[0]})
spring 0.3            spring reverb level 0 to 1

Steps count from 1: beat 1 is step 1, beat 2 is step 5, beat 3 is step 9, beat 4 is step 13.
Styles: one drop puts kick and rim together on beat 3 and leaves beat 1 empty; rockers puts the kick
on beats 1 and 3; steppers puts the kick on every beat. The skank usually sits on beats 2 and 4.
Dub tempos sit around 66 to 80 bpm.`;

/**
 * Set one line of riddim text, replacing that setting if it is already there, and parse the result.
 * @param {string} text current riddim text
 * @param {string} line a setting line such as "bpm 76" or "kick x...x...x...x..."
 */
export function setLine(text, line) {
    const name = line.trim().split(/\s+/)[0];
    const kept = text.split(/\r?\n/).filter((existing) => existing.trim().split(/\s+/)[0] !== name);
    const merged = `${kept.join("\n").trimEnd()}\n${line.trim()}\n`;
    return { text: merged, ...parse(merged) };
}
const NOTE_ROOTS = /** @type {Record<string, number>} */ ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const DRUM_SYMBOLS = /** @type {Record<string, number>} */ ({ ".": 0, x: 1, X: 2, o: 3 });
const BASS_NOTE = /^([b#]?)([1-7])([',]*)$/;
const CHORD = /^([b#]?)([1-7])([mM]?)$/;
const ECHO_DENOMINATORS = new Set([4, 8, 16, 32]);

/**
 * @typedef {"major" | "minor"} Mode
 * @typedef {{ root: string, mode: Mode }} Key
 * @typedef {typeof ECHO_MODELS[number]} EchoModel
 * @typedef {{ num: number, den: number, feedback: number, model: EchoModel }} Echo
 * @typedef {{
 *   bpm: number,
 *   key: Key,
 *   swing: number,
 *   bars: number,
 *   drums: Record<typeof DRUMS[number], number[]>,
 *   bass: string[],
 *   lead: string[],
 *   chords: string[][],
 *   echo: Echo,
 *   spring: number,
 * }} Riddim
 * @typedef {{ line: number, message: string }} ParseError
 */

/** @returns {Riddim} */
export function emptyRiddim() {
    return {
        bpm: 72,
        key: { root: "A", mode: "minor" },
        swing: 0,
        bars: 1,
        drums: { kick: [], rim: [], hat: [], snare: [], clap: [], skank: [], organ: [] },
        bass: [],
        lead: [],
        chords: [],
        echo: { num: 3, den: 16, feedback: 0.5, model: "tape" },
        spring: 0.25,
    };
}

/**
 * Strip a comment: "# " at the start of a line or " # " inside it. A bare "#" is a sharp, as in "F#" or "#4".
 * @param {string} line
 */
function stripComment(line) {
    if (/^\s*#(\s|$)/.test(line)) return "";
    const at = line.search(/\s#(\s|$)/);
    return (at === -1 ? line : line.slice(0, at)).trim();
}

/**
 * @param {string} value
 * @param {number} low
 * @param {number} high
 */
function numberIn(value, low, high) {
    const n = Number(value);
    return value !== "" && Number.isFinite(n) && n >= low && n <= high ? n : null;
}

/**
 * Parse riddim text. Never throws: returns the riddim, or null plus every error found with its line number.
 * @param {string} text
 * @returns {{ riddim: Riddim | null, errors: ParseError[] }}
 */
export function parse(text) {
    const riddim = emptyRiddim();
    /** @type {ParseError[]} */
    const errors = [];
    /** @type {Map<string, number>} */
    const barsByLine = new Map();
    const seen = new Set();
    let headerSeen = false;
    let explicitBars = 0;

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = stripComment(lines[i]);
        if (!line) continue;
        const lineNo = i + 1;
        /** @param {string} message */
        const fail = (message) => errors.push({ line: lineNo, message });
        const [name, ...rest] = line.split(/\s+/);
        const value = rest.join(" ");

        if (!headerSeen) {
            headerSeen = true;
            if (name !== "dubwise" || value !== String(VERSION)) {
                fail(`the first line must be "dubwise ${VERSION}"`);
            }
            continue;
        }
        if (!SETTINGS.has(name)) {
            fail(`unknown setting "${name}"; known: ${[...SETTINGS].join(", ")}`);
            continue;
        }
        if (seen.has(name)) {
            fail(`"${name}" is set twice`);
            continue;
        }
        seen.add(name);

        switch (name) {
            case "bpm": {
                const bpm = numberIn(value, 50, 200);
                if (bpm === null) fail("bpm must be a number from 50 to 200");
                else riddim.bpm = bpm;
                break;
            }
            case "swing": {
                const swing = numberIn(value, 0, 0.6);
                if (swing === null) fail("swing must be a number from 0 to 0.6");
                else riddim.swing = swing;
                break;
            }
            case "spring": {
                const spring = numberIn(value, 0, 1);
                if (spring === null) fail("spring must be a number from 0 to 1");
                else riddim.spring = spring;
                break;
            }
            case "bars": {
                const bars = numberIn(value, 1, MAX_BARS);
                if (bars === null || !Number.isInteger(bars)) fail(`bars must be a whole number from 1 to ${MAX_BARS}`);
                else explicitBars = bars;
                break;
            }
            case "key": {
                const key = /^([A-G])([#b]?)\s+(major|minor)$/.exec(value);
                if (!key) fail('key must look like "A minor" or "F# major"');
                else riddim.key = { root: key[1] + key[2], mode: /** @type {Mode} */ (key[3]) };
                break;
            }
            case "echo": {
                const echo = /^(\d+)\/(\d+)\s+([\d.]+)(?:\s+(\S+))?$/.exec(value);
                const num = echo ? Number(echo[1]) : 0;
                const den = echo ? Number(echo[2]) : 0;
                const feedback = echo ? numberIn(echo[3], 0, 0.95) : null;
                const model = echo ? (echo[4] ?? ECHO_MODELS[0]) : "";
                const known = /** @type {readonly string[]} */ (ECHO_MODELS).includes(model);
                if (!echo || !ECHO_DENOMINATORS.has(den) || num < 1 || num > den || feedback === null || !known) {
                    fail(
                        'echo must look like "3/16 0.5": a note length (over 4, 8, 16 or 32), feedback from 0 to 0.95, ' +
                            `then a head: ${ECHO_MODELS.join(", ")}`,
                    );
                } else {
                    riddim.echo = { num, den, feedback, model: /** @type {EchoModel} */ (model) };
                }
                break;
            }
            case "bass":
            case "lead": {
                const bars = splitBars(value);
                const tokens = [];
                for (const [b, bar] of bars.entries()) {
                    const steps = bar.split(/\s+/).filter(Boolean);
                    if (steps.length !== STEPS_PER_BAR) {
                        fail(
                            `${name} bar ${b + 1} has ${steps.length} steps, needs ${STEPS_PER_BAR} separated by spaces`,
                        );
                        continue;
                    }
                    tokens.push(...steps);
                }
                for (const [s, token] of tokens.entries()) {
                    if (token === ".") continue;
                    if (token === "-") {
                        if (s === 0 || tokens[s - 1] === ".")
                            fail(`${name} step ${s + 1}: "-" holds a note, but no note comes before it`);
                        continue;
                    }
                    if (!BASS_NOTE.test(token)) {
                        fail(`${name} step ${s + 1}: "${token}" is not a scale degree like 1, b3, 5' or 4,`);
                    }
                }
                riddim[name] = tokens;
                barsByLine.set(name, bars.length);
                break;
            }
            case "chords": {
                const bars = splitBars(value);
                const chords = [];
                for (const [b, bar] of bars.entries()) {
                    const tokens = bar.split(/\s+/).filter(Boolean);
                    if (![1, 2, 4].includes(tokens.length)) {
                        fail(`chords bar ${b + 1} has ${tokens.length} chords, use 1, 2 or 4 per bar`);
                        continue;
                    }
                    for (const token of tokens) {
                        if (!CHORD.test(token))
                            fail(`chords bar ${b + 1}: "${token}" is not a chord degree like 1, 4m or b7M`);
                    }
                    chords.push(tokens);
                }
                riddim.chords = chords;
                barsByLine.set("chords", bars.length);
                break;
            }
            default: {
                const drum = /** @type {typeof DRUMS[number]} */ (name);
                const bars = splitBars(value);
                const steps = [];
                for (const [b, bar] of bars.entries()) {
                    const chars = bar.replace(/\s+/g, "");
                    if (chars.length !== STEPS_PER_BAR) {
                        fail(`${drum} bar ${b + 1} has ${chars.length} steps, needs ${STEPS_PER_BAR}`);
                        continue;
                    }
                    for (const char of chars) {
                        if (!(char in DRUM_SYMBOLS) || (char === "o" && drum !== "hat")) {
                            fail(
                                `${drum} bar ${b + 1}: "${char}" is not a step; use . x X${drum === "hat" ? " o" : ""}`,
                            );
                            break;
                        }
                        steps.push(DRUM_SYMBOLS[char]);
                    }
                }
                riddim.drums[drum] = steps;
                barsByLine.set(drum, bars.length);
            }
        }
    }

    if (!headerSeen) errors.push({ line: 1, message: `the first line must be "dubwise ${VERSION}"` });

    const longest = Math.max(1, ...barsByLine.values());
    riddim.bars = explicitBars || longest;
    if (riddim.bars > MAX_BARS) errors.push({ line: 0, message: `a riddim has at most ${MAX_BARS} bars` });
    for (const [name, bars] of barsByLine) {
        if (riddim.bars % bars !== 0) {
            errors.push({
                line: 0,
                message: `${name} has ${bars} bars, which does not divide the riddim's ${riddim.bars} bars`,
            });
        }
    }

    errors.sort((a, b) => a.line - b.line);
    return errors.length ? { riddim: null, errors } : { riddim, errors };
}

/** @param {string} value */
function splitBars(value) {
    return value.split("|").map((bar) => bar.trim());
}

/**
 * Canonical text for a riddim. parse(serialize(r)) gives r back.
 * @param {Riddim} riddim
 */
export function serialize(riddim) {
    const symbol = [".", "x", "X", "o"];
    const lines = [`dubwise ${VERSION}`, `bpm ${riddim.bpm}`, `key ${riddim.key.root} ${riddim.key.mode}`];
    if (riddim.swing) lines.push(`swing ${riddim.swing}`);
    lines.push(`bars ${riddim.bars}`);
    for (const drum of DRUMS) {
        const steps = riddim.drums[drum];
        if (steps.length)
            lines.push(
                `${drum.padEnd(6)} ${chunk(
                    steps.map((s) => symbol[s]),
                    "",
                ).join(" | ")}`,
            );
    }
    if (riddim.bass.length) lines.push(`bass   ${chunk(riddim.bass, " ").join(" | ")}`);
    if (riddim.lead.length) lines.push(`lead   ${chunk(riddim.lead, " ").join(" | ")}`);
    if (riddim.chords.length) lines.push(`chords ${riddim.chords.map((bar) => bar.join(" ")).join(" | ")}`);
    // The default head stays out of the text, like swing 0: older links keep parsing and stay short.
    const head = riddim.echo.model === ECHO_MODELS[0] ? "" : ` ${riddim.echo.model}`;
    lines.push(`echo ${riddim.echo.num}/${riddim.echo.den} ${riddim.echo.feedback}${head}`);
    lines.push(`spring ${riddim.spring}`);
    return `${lines.join("\n")}\n`;
}

/**
 * @param {string[]} items
 * @param {string} separator
 */
function chunk(items, separator) {
    const bars = [];
    for (let i = 0; i < items.length; i += STEPS_PER_BAR) bars.push(items.slice(i, i + STEPS_PER_BAR).join(separator));
    return bars;
}

/**
 * The value at a global step for a pattern that loops over its own length.
 * @template T
 * @param {T[]} steps
 * @param {number} step
 * @returns {T | undefined}
 */
export function stepAt(steps, step) {
    return steps.length ? steps[step % steps.length] : undefined;
}

/**
 * The chord playing at a global step.
 * @param {string[][]} chords
 * @param {number} step
 */
export function chordAt(chords, step) {
    if (!chords.length) return undefined;
    const bar = chords[Math.floor(step / STEPS_PER_BAR) % chords.length];
    const slot = Math.floor(((step % STEPS_PER_BAR) * bar.length) / STEPS_PER_BAR);
    return bar[slot];
}

/** @param {Key} key */
function rootSemitone(key) {
    const base = NOTE_ROOTS[key.root[0]];
    return base + (key.root[1] === "#" ? 1 : key.root[1] === "b" ? -1 : 0);
}

/**
 * Semitones above the key root for a scale degree, with an optional accidental.
 * @param {Key} key
 * @param {number} degree 1-7
 * @param {string} accidental "", "b" or "#"
 */
function degreeSemitones(key, degree, accidental) {
    const scale = SCALES[key.mode];
    return scale[degree - 1] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
}

/** The pitch classes of a key's scale, root first, with C as 0. @param {Key} key */
export function scaleNotes(key) {
    const root = rootSemitone(key);
    return SCALES[key.mode].map((step) => (root + step + 12) % 12);
}

/** @param {number} midi */
export function midiToFrequency(midi) {
    return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * MIDI note for a bass token. The root sits between E1 and D#2, the range a dub bass lives in.
 * @param {string} token
 * @param {Key} key
 * @returns {number | null} null for rests and holds
 */
export function bassMidi(token, key) {
    const note = BASS_NOTE.exec(token);
    if (!note) return null;
    let root = 24 + rootSemitone(key);
    if (root < 28) root += 12;
    const octave = [...note[3]].reduce((sum, mark) => sum + (mark === "'" ? 12 : -12), 0);
    return root + degreeSemitones(key, Number(note[2]), note[1]) + octave;
}

/**
 * MIDI note for a melodica token. The root sits around middle C, where a melodica line lives.
 * @param {string} token
 * @param {Key} key
 * @returns {number | null} null for rests and holds
 */
export function leadMidi(token, key) {
    const note = BASS_NOTE.exec(token);
    if (!note) return null;
    const root = 60 + rootSemitone(key);
    const octave = [...note[3]].reduce((sum, mark) => sum + (mark === "'" ? 12 : -12), 0);
    return root + degreeSemitones(key, Number(note[2]), note[1]) + octave;
}

/**
 * MIDI notes of a chord token as a triad voiced around middle C, for the skank.
 * Without a suffix the quality comes from the key's scale; "m" forces minor, "M" forces major.
 * @param {string} token
 * @param {Key} key
 * @returns {number[]}
 */
export function chordMidi(token, key) {
    const chord = CHORD.exec(token);
    if (!chord) return [];
    const degree = Number(chord[2]);
    const scale = SCALES[key.mode];
    const rootOffset = degreeSemitones(key, degree, chord[1]);
    let third = (scale[(degree + 1) % 7] - scale[degree - 1] + 12) % 12;
    let fifth = (scale[(degree + 3) % 7] - scale[degree - 1] + 12) % 12;
    if (chord[3] === "m") [third, fifth] = [3, 7];
    if (chord[3] === "M") [third, fifth] = [4, 7];
    let root = 60 + rootSemitone(key) + rootOffset;
    while (root >= 67) root -= 12;
    while (root < 55) root += 12;
    return [root, root + third, root + fifth];
}

/**
 * Text to the URL fragment the app reads.
 * @param {string} text
 */
export function toHash(text) {
    return `#r=${encodeURIComponent(text.trim())}`;
}

/**
 * URL fragment back to text, or null when there is no riddim in it.
 * @param {string} hash
 */
export function fromHash(hash) {
    const match = /^#r=(.*)$/s.exec(hash);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return null;
    }
}

/**
 * Full link that opens the app playing this riddim.
 * @param {string} text
 * @param {string} [base]
 */
export function toUrl(text, base = DEFAULT_BASE_URL) {
    return base + toHash(text);
}
