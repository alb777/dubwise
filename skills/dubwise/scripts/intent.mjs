// @ts-check
/**
 * What an AI fills in when the composer's own word lists do not cover an idea. The model never writes notes: it
 * answers this small JSON form, sanitizeReading() keeps only valid values, groundReading() lets its own words overrule
 * its picks, and the composer uses them below what the idea says outright and below the artists it knows.
 */
import { readIntent } from "./composer.mjs";

/** @typedef {import("./composer.mjs").Style} Style */
/** @typedef {import("./composer.mjs").Mode} Mode */
/** @typedef {import("./composer.mjs").Amount} Amount */
/** @typedef {import("./composer.mjs").Density} Density */
/** @typedef {import("./composer.mjs").BassMove} BassMove */
/** @typedef {"slow" | "laid back" | "steady" | "lively" | "frantic"} Tempo */
/**
 * @typedef {{ reading?: string, style?: Style, tempo?: Tempo, mode?: Mode, echo?: Amount, density?: Density,
 *   bass?: BassMove, by?: string }} Reading
 * `by` names the reader in the reply when it is not an AI, such as "dubwise" for the word map in lexicon.mjs.
 * @typedef {{ role: "system" | "user" | "assistant", content: string }} Message
 */

/**
 * Tempo and key are left out of numbers on purpose: measured with Qwen3.5 2B, a small model picks C for almost every
 * key and tempos far above dub, while it chooses well among a few named tempos. The composer turns the name into bpm.
 */
const CHOICES = {
    style: ["one-drop", "rockers", "steppers"],
    tempo: ["slow", "laid back", "steady", "lively", "frantic"],
    mode: ["major", "minor"],
    echo: ["low", "mid", "high"],
    density: ["sparse", "normal", "busy"],
    bass: ["root", "melodic"],
};

/**
 * The form a model answers. `reading` comes first, so a small model puts the idea into words before it picks values.
 * Every field is required and closed, which constrained decoding (WebLLM, Ollama, OpenAI) can enforce.
 */
export const READING_SCHEMA = {
    type: "object",
    properties: {
        reading: { type: "string", maxLength: 100 },
        style: { type: "string", enum: CHOICES.style },
        tempo: { type: "string", enum: CHOICES.tempo },
        mode: { type: "string", enum: CHOICES.mode },
        echo: { type: "string", enum: CHOICES.echo },
        density: { type: "string", enum: CHOICES.density },
        bass: { type: "string", enum: CHOICES.bass },
    },
    required: ["reading", "style", "tempo", "mode", "echo", "density", "bass"],
    additionalProperties: false,
};

export const SYSTEM_PROMPT = `You turn an idea for a dub reggae riddim into settings for a drum machine. Answer with JSON only.

Fields:
- reading: a few English words on how you read the idea, like "spy film: tense, dark, cinematic".
- style: "one-drop" (kick on beat 3, laid back roots), "rockers" (kick on 1 and 3, driving) or "steppers" (kick on every beat, militant, electronic).
- tempo: "slow" (a heavy crawl), "laid back" (most roots and dub), "steady", "lively" (dancing) or "frantic" (a rave, a chase, panic).
- mode: "minor" for dark, sad, tense or mystic ideas, "major" for happy, sunny or romantic ones.
- echo: "high" for spacey, dreamy or wide, "low" for dry and tight, "mid" otherwise.
- density: "sparse" for calm or minimal, "busy" for energetic or crowded, "normal" otherwise.
- bass: "root" for a heavy, hypnotic bass that stays on the root, "melodic" for a bass that walks and sings.

The idea can be in any language and about anything: a person, a film, a place, a feeling, an animal. Translate its mood into these settings. Never refuse.`;

/** Two worked answers, which keep small models on the form. @type {Message[]} */
const EXAMPLES = [
    { role: "user", content: "Idea: a haunted lighthouse" },
    {
        role: "assistant",
        content:
            '{"reading":"haunted lighthouse: eerie, lonely, foggy","style":"one-drop","tempo":"slow","mode":"minor","echo":"high","density":"sparse","bass":"root"}',
    },
    { role: "user", content: "Idea: festa junina na roça" },
    {
        role: "assistant",
        content:
            '{"reading":"country party: joyful, bouncy, warm","style":"rockers","tempo":"lively","mode":"major","echo":"low","density":"busy","bass":"melodic"}',
    },
];

/** The chat messages that ask a model to read an idea. @param {string} idea @returns {Message[]} */
export function readingMessages(idea) {
    return [{ role: "system", content: SYSTEM_PROMPT }, ...EXAMPLES, { role: "user", content: `Idea: ${idea}` }];
}

/**
 * Keep only the valid parts of a model's answer, given as an object or as text that holds a JSON object
 * (with or without a code fence around it). Returns null when nothing usable is left.
 * @param {unknown} answer @returns {Reading | null}
 */
export function sanitizeReading(answer) {
    let value = answer;
    if (typeof value === "string") {
        const json = value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1);
        try {
            value = JSON.parse(json);
        } catch {
            return null;
        }
    }
    if (!value || typeof value !== "object") return null;
    const raw = /** @type {Record<string, unknown>} */ (value);
    /** @type {Record<string, string>} */
    const reading = {};
    for (const [field, allowed] of Object.entries(CHOICES)) {
        const choice = raw[field];
        if (typeof choice === "string" && allowed.includes(choice)) reading[field] = choice;
    }
    if (typeof raw.reading === "string") {
        // Small models can loop ("gritty, gritty, gritty"), so each word or phrase is kept once.
        const seen = new Set();
        const words = raw.reading
            .replace(/[\p{Cc}\s]+/gu, " ")
            .split(",")
            .map((item) => item.trim())
            .filter((item) => {
                const key = item.replace(/^[^:]*:\s*/, "").toLowerCase();
                if (key.length < 3 || seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .join(", ")
            .slice(0, 100);
        if (words) reading.reading = words;
    }
    return Object.keys(reading).length ? /** @type {Reading} */ (reading) : null;
}

/** Which way a named tempo leans: slower, neither or faster. @type {Record<Tempo, number>} */
const LEAN = { slow: -1, "laid back": -1, steady: 0, lively: 1, frantic: 1 };

/**
 * A model's reading with its settings taken from its own words wherever they say something. In a live log of Qwen3.5
 * 2B the words fitted each idea ("2pac: iconic, gritty, revolutionary") while the picks leaned to major and copied
 * the second worked example. So the words the composer knows set their fields, `read` (the word map in lexicon.mjs)
 * sets the ones still open, and the model's own picks fill the rest. A named tempo that leans the same way as the
 * words is kept, as it is finer than slow or lively.
 * @param {Reading} reading from sanitizeReading()
 * @param {(text: string) => Reading | null} [read]
 * @returns {Reading}
 */
export function groundReading(reading, read) {
    // The words after a "subject:" label describe it; the label only repeats the idea, names and all.
    const words = (reading.reading ?? "")
        .split(",")
        .map((item) => item.replace(/^[^:]*:\s*/, ""))
        .join(", ");
    if (!/[\p{L}\p{N}]/u.test(words)) return reading;
    const mapped = read?.(words);
    const { style, tempo, mode, echo, density, bass } = readIntent(words);
    /** @type {Reading} */
    const said = {
        tempo: tempo ? (tempo === "slow" ? "slow" : "lively") : mapped?.tempo,
        mode: mode ?? mapped?.mode,
        echo: echo ?? mapped?.echo,
        density: density ?? mapped?.density,
        style,
        bass,
    };
    const grounded = { ...reading };
    for (const [field, value] of Object.entries(said)) {
        if (value) Object.assign(grounded, { [field]: value });
    }
    if (said.tempo && reading.tempo && LEAN[said.tempo] === LEAN[reading.tempo]) grounded.tempo = reading.tempo;
    return grounded;
}
