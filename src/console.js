// @ts-check
/**
 * The dub console: turns what the player types into commands. Pure, so the tests can drive it.
 */
import { DRUMS, SPEC } from "../skills/dubwise/scripts/notation.mjs";

export const CHANNELS = /** @type {const} */ (["kick", "rim", "hat", "bass", "skank", "siren"]);
export const PRESETS = /** @type {const} */ (["one-drop", "rockers", "steppers"]);
const SETTINGS = new Set(["bpm", "key", "swing", "bars", "echo", "spring", "bass", "chords", ...DRUMS]);

export const COMMANDS = `commands
  play, stop                start or stop the riddim
  mute <ch>, unmute <ch>    channels: ${CHANNELS.join(" ")}
  solo <ch>, unsolo         hear one channel alone, or all again
  throw <ch>                send a channel into the echo for one beat
  filter <-1 to 1>          DJ filter: -1 dark, 0 open, 1 thin
  preset <name>             ${PRESETS.join(", ")}
  show                      print the riddim as text
  share                     copy a link that plays this riddim
  ai <idea>                 copy a prompt for any AI built from your idea, then paste its answer here
  help, notation, clear

Type a notation line (bpm 76, kick x...x...x...x...) to change the riddim while it plays,
or paste a whole riddim that starts with "dubwise 1".`;

/**
 * @typedef {typeof CHANNELS[number]} Channel
 * @typedef {{ type: "play" | "stop" | "show" | "share" | "help" | "notation" | "clear" | "unsolo" }
 *   | { type: "mute", channel: Channel, on: boolean }
 *   | { type: "solo" | "throw", channel: Channel }
 *   | { type: "filter", value: number }
 *   | { type: "preset", name: typeof PRESETS[number] }
 *   | { type: "ai", request: string }
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
        case "ai":
            if (!arg)
                return error("tell the AI what you want, for example: ai a dark steppers in D minor with lots of echo");
            return { type: "ai", request: arg };
    }
    if (SETTINGS.has(first)) return { type: "line", line: text };
    return error(`unknown command "${first}"; type help`);
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
