import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compose } from "../skills/dubwise/scripts/composer.mjs";
import { READING_SCHEMA, readingMessages, sanitizeReading } from "../skills/dubwise/scripts/intent.mjs";
import { parse } from "../skills/dubwise/scripts/notation.mjs";

/** A reading as a model would answer for "Martin Campbell style", the film director. */
const SPY_FILM = {
    reading: "spy film: tense, dark, cinematic",
    style: "steppers",
    tempo: "lively",
    mode: "minor",
    echo: "high",
    density: "busy",
    bass: "root",
};

/** Compose with a reading, parse the riddim and return both. */
function riddimWith(idea, reading, take = 0) {
    const result = compose(idea, take, reading);
    assert.equal(result.understood, true, result.summary);
    const { riddim, errors } = parse(result.text);
    assert.deepEqual(errors, []);
    return { riddim, result };
}

describe("the form an AI fills in", () => {
    it("asks for every field, the reading first", () => {
        assert.deepEqual(READING_SCHEMA.required, Object.keys(READING_SCHEMA.properties));
        assert.equal(Object.keys(READING_SCHEMA.properties)[0], "reading");
    });

    it("puts the idea last, after worked answers that fit the form", () => {
        const messages = readingMessages("a cat chasing a laser");
        assert.equal(messages[0].role, "system");
        assert.deepEqual(messages.at(-1), { role: "user", content: "Idea: a cat chasing a laser" });
        for (const example of messages.filter((m) => m.role === "assistant")) {
            assert.deepEqual(sanitizeReading(example.content), JSON.parse(example.content));
        }
    });
});

describe("reading a model's answer", () => {
    it("keeps a valid answer whole", () => {
        assert.deepEqual(sanitizeReading(SPY_FILM), SPY_FILM);
        assert.deepEqual(sanitizeReading(JSON.stringify(SPY_FILM)), SPY_FILM);
    });

    it("finds the JSON inside a code fence or chatter", () => {
        const answer = `Sure! Here it is:\n\`\`\`json\n${JSON.stringify(SPY_FILM)}\n\`\`\``;
        assert.deepEqual(sanitizeReading(answer), SPY_FILM);
    });

    it("drops values outside the form and keeps the rest", () => {
        const answer = { ...SPY_FILM, style: "jungle", tempo: "warp 9", mode: "dorian", bpm: 400, extra: "ignored" };
        assert.deepEqual(sanitizeReading(answer), {
            reading: SPY_FILM.reading,
            echo: "high",
            density: "busy",
            bass: "root",
        });
    });

    it("tidies the reading", () => {
        const reading = sanitizeReading({ reading: `  slow\n\tand   deep ${"x".repeat(200)}` });
        assert.ok(reading?.reading?.startsWith("slow and deep x"));
        assert.equal(reading?.reading?.length, 100);
    });

    it("returns nothing for answers it cannot use", () => {
        for (const answer of ["", "no", "{broken", null, 42, [], { style: "polka" }]) {
            assert.equal(sanitizeReading(answer), null, JSON.stringify(answer));
        }
    });
});

describe("composing with a reading", () => {
    it("fills what the words left open and says how the AI read the idea", () => {
        const { riddim, result } = riddimWith("Martin Campbell style", SPY_FILM);
        for (const beat of [0, 4, 8, 12]) assert.equal(riddim.drums.kick[beat], 1, "steppers from the reading");
        assert.equal(riddim.key.mode, "minor");
        assert.ok(Math.abs(riddim.bpm - 80) <= 2, `a lively steppers, got ${riddim.bpm}`);
        assert.equal(riddim.echo.feedback, 0.65);
        assert.match(result.summary, /the AI read "martin campbell" as: spy film: tense, dark, cinematic/);
        assert.doesNotMatch(result.summary, /don't know/);
    });

    it("lets the idea's own words beat the reading", () => {
        const { riddim } = riddimWith("a happy one drop for Martin Campbell", SPY_FILM);
        assert.equal(riddim.drums.kick[0], 0, "one drop, as the words say");
        assert.equal(riddim.key.mode, "major");
    });

    it("lets a known artist beat the reading", () => {
        const { riddim } = riddimWith("King Tubby, Martin Campbell style", { ...SPY_FILM, echo: "low" });
        assert.equal(riddim.drums.kick[0], 0, "one drop drums from King Tubby");
        assert.equal(riddim.echo.feedback, 0.65, "wide echo from King Tubby");
    });

    it("gives an unknown name linked to a known one its own role", () => {
        const lead = riddimWith("Martin Campbell meets King Tubby", SPY_FILM);
        for (const beat of [0, 4, 8, 12])
            assert.equal(lead.riddim.drums.kick[beat], 1, "steppers drums from the reading");
        assert.equal(lead.riddim.echo.feedback, 0.65, "wide echo from King Tubby");
        assert.match(lead.result.summary, /drums and tempo from the AI's reading, echo and bass from King Tubby/);
        const mix = riddimWith("King Tubby com Martin Campbell", { ...SPY_FILM, echo: "low", mode: "major" });
        assert.equal(mix.riddim.drums.kick[0], 0, "one drop drums from King Tubby");
        assert.equal(mix.riddim.echo.feedback, 0.35, "dry echo from the reading");
        assert.equal(mix.riddim.key.mode, "major");
        assert.match(mix.result.summary, /drums and tempo from King Tubby .*, echo and bass from the AI's reading/);
    });

    it("keeps the known name in charge when there is no reading", () => {
        const { riddim } = riddimWith("Martin Campbell meets King Tubby", null);
        assert.equal(riddim.drums.kick[0], 0, "King Tubby leads without an AI");
    });

    it("stays the same for the same idea, take and reading", () => {
        assert.deepEqual(compose("Martin Campbell style", 2, SPY_FILM), compose("Martin Campbell style", 2, SPY_FILM));
    });

    it("turns a named tempo into a dub tempo for the style", () => {
        const tempo = (reading) => riddimWith("Martin Campbell style", { ...SPY_FILM, ...reading }).riddim.bpm;
        assert.ok(Math.abs(tempo({ tempo: "frantic" }) - 88) <= 2, "a frantic steppers is fast, still dub");
        assert.ok(Math.abs(tempo({ style: "one-drop", tempo: "slow" }) - 64) <= 2, "a slow one drop crawls");
    });

    it("lets the idea's own tempo words beat the reading's", () => {
        const { riddim } = riddimWith("a slow Martin Campbell", { ...SPY_FILM, tempo: "frantic" });
        assert.ok(Math.abs(riddim.bpm - 68) <= 2, `slow as the words say, got ${riddim.bpm}`);
    });

    it("mentions the reading even when every word was known", () => {
        assert.match(riddimWith("a dark steppers", SPY_FILM).result.summary, /the AI read it as: spy film/);
    });
});
