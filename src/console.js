// @ts-check
/**
 * The dub console: turns what the player types into commands. Pure, so the tests can drive it.
 */
import { editDistance, readIntent } from "../skills/dubwise/scripts/composer.mjs";
import { DRUMS, SPEC } from "../skills/dubwise/scripts/notation.mjs";

export const CHANNELS = /** @type {const} */ (["kick", "rim", "hat", "bass", "skank", "siren", "keys"]);
export const PRESETS = /** @type {const} */ (["one-drop", "rockers", "steppers"]);
/** Effects a selector plays live: tapped, held (spin) or switched on and off (phaser, kills). */
export const EFFECTS = /** @type {const} */ ([
    "crash",
    "spin",
    "horn",
    "phaser",
    "kill-low",
    "kill-high",
    "tape-stop",
    "pull-up",
]);
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
const SETTINGS = new Set(["bpm", "key", "swing", "bars", "echo", "spring", "bass", "lead", "chords", ...DRUMS]);
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
    "crash",
    "spin",
    "horn",
    "phaser",
    "kill",
    "rewind",
];

/** The command a word is one slip away from (two for long words), if any. @param {string} word */
function nearestCommand(word) {
    if (word.length < 3) return undefined;
    const limit = word.length >= 6 ? 2 : 1;
    let best;
    let bestDistance = limit + 1;
    for (const command of COMMAND_WORDS) {
        const edits = editDistance(word, command);
        if (edits < bestDistance) [best, bestDistance] = [command, edits];
    }
    return best;
}

export const COMMANDS = `commands
  play, stop                start or stop the riddim; "play <idea>" writes the idea and starts it
  mute <ch>, unmute <ch>    channels: ${CHANNELS.join(" ")}
  solo <ch>, unsolo         hear one channel alone, or all again
  throw <ch>                send a channel into the echo for one beat
  filter <-1 to 1>          DJ filter: -1 dark, 0 open, 1 thin
  crash, horn               kick the spring tank, blow the air horn
  spin                      spin the echo into a howl for two beats (hold the pad for longer)
  phaser, kill low|high     switch the phaser or a kill on and off
  tape stop, pull up        slow the riddim to a halt, or rewind it and play it again from the top
  keys, keys off            bring out the melodica keyboard, or put it away
  preset <name>             ${PRESETS.join(", ")}
  again                     another version of the last idea
  undo                      take back the last change
  show                      print the riddim as text
  share                     copy a link that plays this riddim
  prompt <idea>             copy a prompt for any chat AI, then paste its answer here
  ai                        choose an AI to read the ideas the word lists miss
  ai <idea>, ai off         ask the AI even when every word is known, or turn it off
  theme <name>              colours: ${Object.keys(THEMES).join(", ")}
  guide                     open the guide beside the app (or press ?)
  hi, mood, tip, challenge  talk to the selector, or ask: who is King Tubby? what is a dubplate?
  log, log save, log clear  what happened in this browser: show it, download it or empty it
  help, notation, clear

Describe a riddim in your own words and dubwise writes it, offline:
  inspired by Augustus Pablo / a dark steppers in D minor / Iration Steppas meets King Tubby
  (English, Portuguese or Spanish)
Ask for a melody (a theme for the melodica) and the riddim gets a lead line of its own.
Then steer the riddim playing: darker, a bit faster, more echo, busier, mais lento.
Type a notation line (bpm 76, kick x...x...x...x...) to change the riddim while it plays,
or paste a whole riddim that starts with "dubwise 1".`;

/**
 * @typedef {typeof CHANNELS[number]} Channel
 * @typedef {typeof EFFECTS[number]} Effect
 * @typedef {{ type: "play" | "stop" | "show" | "share" | "help" | "notation" | "clear" | "unsolo" | "again" | "undo"
 *     | "guide" | "ai" | "ai-off" }
 *   | { type: "mute", channel: Channel, on: boolean }
 *   | { type: "solo" | "throw", channel: Channel }
 *   | { type: "filter", value: number }
 *   | { type: "fx", effect: Effect, on?: boolean }
 *   | { type: "preset", name: typeof PRESETS[number] }
 *   | { type: "theme", name: keyof typeof THEMES }
 *   | { type: "log", action: "show" | "save" | "clear" }
 *   | { type: "keys", on?: boolean }
 *   | { type: "compose" | "prompt", request: string, ai?: boolean }
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
        case "play": {
            // "play a dark steppers" writes the idea and starts it. Bare "play", "play it" and "play again"
            // only move the transport, whatever the selector did not already take.
            const idea = arg.trim();
            if (!idea || /^(it|this|that|again)$/i.test(idea)) return { type: "play" };
            return { type: "compose", request: idea };
        }
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
        // Effects take no words after them, except where noted, so "crash bandicoot" is still an idea.
        case "crash":
        case "spin":
        case "horn":
            if (!arg) return { type: "fx", effect: word };
            break;
        case "phaser":
            if (!arg) return { type: "fx", effect: "phaser" };
            if (arg === "on" || arg === "off") return { type: "fx", effect: "phaser", on: arg === "on" };
            return error("phaser, or phaser on, or phaser off");
        case "kill": {
            const [band, state] = rest.map((item) => item.toLowerCase());
            if ((band === "low" || band === "high") && (state === undefined || state === "on" || state === "off"))
                return { type: "fx", effect: `kill-${band}`, ...(state && { on: state === "on" }) };
            return error("kill low or kill high, then on or off if you like");
        }
        case "tape":
            if (arg.toLowerCase() === "stop") return { type: "fx", effect: "tape-stop" };
            break;
        case "pull":
            if (arg.toLowerCase() === "up") return { type: "fx", effect: "pull-up" };
            break;
        case "pull-up":
        case "pullup":
        case "rewind":
            if (!arg) return { type: "fx", effect: "pull-up" };
            break;
        // "keys to the kingdom" stays an idea.
        case "keys": {
            const state = arg.toLowerCase();
            if (!state) return { type: "keys" };
            if (state === "on" || state === "off") return { type: "keys", on: state === "on" };
            break;
        }
        // "log cabin dub" stays an idea.
        case "log": {
            const action = arg.toLowerCase();
            if (!action) return { type: "log", action: "show" };
            if (action === "save" || action === "clear") return { type: "log", action };
            break;
        }
        case "prompt":
            if (!arg)
                return error("say what you want, for example: prompt a dark steppers in D minor with lots of echo");
            return { type: "prompt", request: arg };
        case "ai":
            if (!arg) return { type: "ai" };
            if (arg.toLowerCase() === "off") return { type: "ai-off" };
            return { type: "compose", request: arg, ai: true };
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
