// @ts-check
/**
 * What an AI fills in when the composer's own word lists do not cover an idea. The model never writes notes: it
 * answers this small JSON form, sanitizeReading() keeps only valid values, and the composer uses them below what the
 * idea says outright and below the artists it knows.
 */

/** @typedef {import("./composer.mjs").Style} Style */
/** @typedef {import("./composer.mjs").Mode} Mode */
/** @typedef {import("./composer.mjs").Amount} Amount */
/** @typedef {import("./composer.mjs").Density} Density */
/** @typedef {import("./composer.mjs").BassMove} BassMove */
/** @typedef {"slow" | "laid back" | "steady" | "lively" | "frantic"} Tempo */
/**
 * @typedef {{ reading?: string, style?: Style, tempo?: Tempo, mode?: Mode, echo?: Amount, density?: Density,
 *   bass?: BassMove }} Reading
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
        const words = raw.reading
            .replace(/[\p{Cc}\s]+/gu, " ")
            .trim()
            .slice(0, 100);
        if (words) reading.reading = words;
    }
    return Object.keys(reading).length ? /** @type {Reading} */ (reading) : null;
}
