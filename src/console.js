// @ts-check
/**
 * The dub console: turns what the player types into commands. Pure, so the tests can drive it.
 */
import { readIntent } from "../skills/dubwise/scripts/composer.mjs";
import { DRUMS, SPEC } from "../skills/dubwise/scripts/notation.mjs";

export const CHANNELS = /** @type {const} */ (["kick", "rim", "hat", "bass", "skank", "siren"]);
export const PRESETS = /** @type {const} */ (["one-drop", "rockers", "steppers"]);
/** Colour themes and their names. Each one is a [data-theme] block in styles.css; dub is the default. */
export const THEMES = /** @type {const} */ ({
    dub: "dub",
    jamaica: "Jamaica",
    ethiopia: "Ethiopia",
    brazil: "Brazil",
    "south-africa": "South Africa",
    britain: "Great Britain",
    trinidad: "Trinidad & Tobago",
    poland: "Poland",
});
const SETTINGS = new Set(["bpm", "key", "swing", "bars", "echo", "spring", "bass", "chords", ...DRUMS]);
const COMMAND_WORDS = [
    "play",
    "stop",
    "show",
    "share",
    "help",
    "notation",
    "clear",
    "unsolo",
    "again",
    "undo",
    "mute",
    "unmute",
    "solo",
    "throw",
    "filter",
    "preset",
    "prompt",
    "theme",
    "guide",
    "manual",
];

/** Edits between two words, a swap of neighbours counting as one, so "stpo" is one edit from "stop". */
function distance(/** @type {string} */ a, /** @type {string} */ b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
}

/** The command a word is one slip away from (two for long words), if any. @param {string} word */
function nearestCommand(word) {
    if (word.length < 3) return undefined;
    const limit = word.length >= 6 ? 2 : 1;
    let best;
    let bestDistance = limit + 1;
    for (const command of COMMAND_WORDS) {
        const edits = distance(word, command);
        if (edits < bestDistance) [best, bestDistance] = [command, edits];
    }
    return best;
}

export const COMMANDS = `commands
  play, stop                start or stop the riddim
  mute <ch>, unmute <ch>    channels: ${CHANNELS.join(" ")}
  solo <ch>, unsolo         hear one channel alone, or all again
  throw <ch>                send a channel into the echo for one beat
  filter <-1 to 1>          DJ filter: -1 dark, 0 open, 1 thin
  preset <name>             ${PRESETS.join(", ")}
  again                     another version of the last idea
  undo                      take back the last change
  show                      print the riddim as text
  share                     copy a link that plays this riddim
  prompt <idea>             copy a prompt for any chat AI, then paste its answer here
  theme <name>              colours: ${Object.keys(THEMES).join(", ")}
  guide                     open the guide beside the app (or press ?)
  help, notation, clear

Describe a riddim in your own words and dubwise writes it, offline:
  inspired by Augustus Pablo / a dark steppers in D minor / Iration Steppas meets King Tubby
  (English, Portuguese or Spanish)
Type a notation line (bpm 76, kick x...x...x...x...) to change the riddim while it plays,
or paste a whole riddim that starts with "dubwise 1".`;

/**
 * @typedef {typeof CHANNELS[number]} Channel
 * @typedef {{ type: "play" | "stop" | "show" | "share" | "help" | "notation" | "clear" | "unsolo" | "again" | "undo"
 *     | "guide" }
 *   | { type: "mute", channel: Channel, on: boolean }
 *   | { type: "solo" | "throw", channel: Channel }
 *   | { type: "filter", value: number }
 *   | { type: "preset", name: typeof PRESETS[number] }
 *   | { type: "theme", name: keyof typeof THEMES }
 *   | { type: "compose" | "prompt", request: string }
 *   | { type: "line", line: string }
 *   | { type: "lines", lines: string[] }
 *   | { type: "riddim", text: string }
 *   | { type: "error", message: string }} Command
 */

/** @param {string} word @returns {word is Channel} */
function isChannel(word) {
    return /** @type {readonly string[]} */ (CHANNELS).includes(word);
}

/**
 * @param {string} input what was typed or pasted
 * @returns {Command | null} null for blank input
 */
export function parseCommand(input) {
    const text = input.trim();
    if (!text) return null;
    if (/^dubwise\b/.test(text)) return { type: "riddim", text };
    if (text.includes("\n")) {
        return {
            type: "lines",
            lines: text
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean),
        };
    }

    const [first, ...rest] = text.split(/\s+/);
    const word = first.toLowerCase();
    const arg = rest.join(" ");
    /** @param {string} message @returns {Command} */
    const error = (message) => ({ type: "error", message });

    switch (word) {
        case "play":
        case "stop":
        case "show":
        case "share":
        case "help":
        case "notation":
        case "clear":
        case "unsolo":
        case "again":
        case "undo":
            return { type: word };
        case "mute":
        case "unmute":
        case "solo":
        case "throw": {
            if (!isChannel(arg)) return error(`${word} needs a channel: ${CHANNELS.join(", ")}`);
            if (word === "solo" || word === "throw") return { type: word, channel: arg };
            return { type: "mute", channel: arg, on: word === "mute" };
        }
        case "filter": {
            const value = Number(arg);
            if (arg === "" || !Number.isFinite(value) || value < -1 || value > 1)
                return error("filter takes a number from -1 to 1");
            return { type: "filter", value };
        }
        case "preset": {
            const name = /** @type {readonly string[]} */ (PRESETS).find((p) => p === arg);
            if (!name) return error(`presets: ${PRESETS.join(", ")}`);
            return { type: "preset", name: /** @type {typeof PRESETS[number]} */ (name) };
        }
        case "guide":
        case "manual":
            return { type: "guide" };
        case "theme": {
            // A theme goes by its id or its name, so "theme south africa" and "theme trinidad and tobago" work.
            const slug = (/** @type {string} */ text) => text.toLowerCase().replace(/&/g, "and").replace(/\s+/g, "-");
            const name = /** @type {(keyof typeof THEMES)[]} */ (Object.keys(THEMES)).find(
                (id) => id === slug(arg) || slug(THEMES[id]) === slug(arg),
            );
            if (!name) return error(`themes: ${Object.keys(THEMES).join(", ")}`);
            return { type: "theme", name };
        }
        case "prompt":
            if (!arg)
                return error("say what you want, for example: prompt a dark steppers in D minor with lots of echo");
            return { type: "prompt", request: arg };
        case "ai":
            if (!arg) return error("describe the riddim, for example: ai inspired by Augustus Pablo");
            return { type: "compose", request: arg };
    }
    if (SETTINGS.has(first)) return { type: "line", line: text };
    // A word or two that is one slip from a command is a typo, unless the composer reads something in it,
    // so "pla" never replaces the riddim while "slow" or "sol maior" still compose.
    const meant = rest.length <= 1 ? nearestCommand(word) : undefined;
    if (meant && !readIntent(text).matched.length) return error(`did you mean "${[meant, ...rest].join(" ")}"?`);
    // Anything else is an idea for the composer.
    return { type: "compose", request: text };
}

/**
 * A prompt any chat AI can answer with a valid riddim.
 * @param {string} request the player's idea, in any language
 * @param {string} current the riddim playing now
 */
export function aiPrompt(request, current) {
    return `You are composing a riddim for dubwise, a dub sound system that runs in the browser.
Reply with only the riddim text, starting with the line "dubwise 1". No explanation, no code fences.

${SPEC}

The riddim playing now, change it or start over as the request needs:
${current.trim()}

Request: ${request}

Take tempo, style, groove and mood from any song or artist the request mentions, but never copy a real song's bassline or melody.`;
}
