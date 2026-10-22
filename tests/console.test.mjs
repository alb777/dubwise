import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parse, SPEC, serialize, setLine } from "../skills/dubwise/scripts/notation.mjs";
import { aiPrompt, COMMANDS, parseCommand } from "../src/console.js";

const base = serialize(parse("dubwise 1\nbpm 72\nkick ........x.......\n").riddim);

describe("setLine", () => {
    it("replaces a setting that is already there", () => {
        const { riddim, errors, text } = setLine(base, "bpm 80");
        assert.deepEqual(errors, []);
        assert.equal(riddim.bpm, 80);
        assert.equal(text.match(/^bpm /gm).length, 1);
    });
    it("adds a setting that is missing", () => {
        const { riddim } = setLine(base, "rim ........x.......");
        assert.equal(riddim.drums.rim[8], 1);
        assert.equal(riddim.drums.kick[8], 1);
    });
    it("reports the error for a bad line and keeps nothing applied", () => {
        const { riddim, errors } = setLine(base, "bpm 999");
        assert.equal(riddim, null);
        assert.match(errors[0].message, /bpm must be/);
    });
});

describe("parseCommand", () => {
    const cases = [
        ["", null],
        ["  play ", { type: "play" }],
        ["play a dark steppers", { type: "compose", request: "a dark steppers" }],
        [
            "play beverly hills cop theme in the keyboard",
            { type: "compose", request: "beverly hills cop theme in the keyboard" },
        ],
        ["play it", { type: "play" }],
        ["play again", { type: "play" }],
        ["STOP", { type: "stop" }],
        ["mute bass", { type: "mute", channel: "bass", on: true }],
        ["unmute rim", { type: "mute", channel: "rim", on: false }],
        ["solo skank", { type: "solo", channel: "skank" }],
        ["throw siren", { type: "throw", channel: "siren" }],
        ["filter -0.5", { type: "filter", value: -0.5 }],
        ["preset steppers", { type: "preset", name: "steppers" }],
        ["ai a dark steppers", { type: "compose", request: "a dark steppers", ai: true }],
        ["prompt a dark steppers", { type: "prompt", request: "a dark steppers" }],
        [
            "crie um riddim inspirado em augustus pablo",
            { type: "compose", request: "crie um riddim inspirado em augustus pablo" },
        ],
        ["Koffee", { type: "compose", request: "Koffee" }],
        ["slow", { type: "compose", request: "slow" }],
        ["sol maior", { type: "compose", request: "sol maior" }],
        ["hello there", { type: "compose", request: "hello there" }],
        ["again", { type: "again" }],
        ["undo", { type: "undo" }],
        ["theme jamaica", { type: "theme", name: "jamaica" }],
        ["theme South Africa", { type: "theme", name: "south-africa" }],
        ["theme trinidad and tobago", { type: "theme", name: "trinidad" }],
        ["guide", { type: "guide" }],
        ["faster", { type: "compose", request: "faster" }],
        ["ai", { type: "ai" }],
        ["ai off", { type: "ai-off" }],
        ["ai Martin Campbell style", { type: "compose", request: "Martin Campbell style", ai: true }],
        ["manual", { type: "guide" }],
        ["keys", { type: "keys" }],
        ["keys off", { type: "keys", on: false }],
        ["Keys ON", { type: "keys", on: true }],
        ["keys to the kingdom", { type: "compose", request: "keys to the kingdom" }],
        ["mute keys", { type: "mute", channel: "keys", on: true }],
        ["log", { type: "log", action: "show" }],
        ["log save", { type: "log", action: "save" }],
        ["LOG Clear", { type: "log", action: "clear" }],
        ["log cabin dub", { type: "compose", request: "log cabin dub" }],
        ["bpm 76", { type: "line", line: "bpm 76" }],
        ["kick x...x...x...x...", { type: "line", line: "kick x...x...x...x..." }],
        ["lead 1 . 2 . 3 . . . 1 . 2 . 3 . . .", { type: "line", line: "lead 1 . 2 . 3 . . . 1 . 2 . 3 . . ." }],
        ["bpm 76\nkey D minor", { type: "lines", lines: ["bpm 76", "key D minor"] }],
        ["dubwise 1\nbpm 70", { type: "riddim", text: "dubwise 1\nbpm 70" }],
    ];
    for (const [input, expected] of cases) {
        it(`reads ${JSON.stringify(input)}`, () => assert.deepEqual(parseCommand(input), expected));
    }

    const errors = [
        ["mute", /needs a channel/],
        ["mute drums", /needs a channel/],
        ["filter 3", /from -1 to 1/],
        ["filter", /from -1 to 1/],
        ["preset jungle", /presets:/],
        ["prompt", /say what you want/],
        ["pla", /did you mean "play"\?/],
        ["stpo", /did you mean "stop"\?/],
        ["mte bass", /did you mean "mute bass"\?/],
        ["notaion", /did you mean "notation"\?/],
        ["sol bass", /did you mean "solo bass"\?/],
        ["theme", /themes: dub, jamaica/],
        ["theme mars", /themes:/],
        ["thme jamaica", /did you mean "theme jamaica"\?/],
    ];
    for (const [input, message] of errors) {
        it(`rejects ${JSON.stringify(input)}`, () => {
            const command = parseCommand(input);
            assert.equal(command.type, "error");
            assert.match(command.message, message);
        });
    }

    it("reads the dub effects, and leaves ideas that start with their words to the composer", () => {
        for (const [input, effect, on] of [
            ["crash", "crash"],
            ["horn", "horn"],
            ["spin", "spin"],
            ["phaser", "phaser"],
            ["phaser off", "phaser", false],
            ["kill low", "kill-low"],
            ["kill high on", "kill-high", true],
            ["tape stop", "tape-stop"],
            ["pull up", "pull-up"],
            ["Pull Up", "pull-up"],
            ["rewind", "pull-up"],
        ]) {
            assert.deepEqual(parseCommand(input), { type: "fx", effect, ...(on !== undefined && { on }) }, input);
        }
        for (const idea of [
            "crash bandicoot meets king tubby",
            "tape echo heaven",
            "spin me round",
            "horns of jericho",
        ]) {
            assert.equal(parseCommand(idea)?.type, "compose", idea);
        }
        assert.match(/** @type {{ message: string }} */ (parseCommand("kill middle")).message, /kill low or kill high/);
    });
});

describe("help and AI prompt", () => {
    it("lists every command the parser knows", () => {
        for (const word of [
            "play",
            "mute",
            "solo",
            "throw",
            "filter",
            "preset",
            "again",
            "undo",
            "show",
            "share",
            "prompt",
            "clear",
            "crash",
            "horn",
            "spin",
            "phaser",
            "kill",
            "tape stop",
            "pull up",
            "log save",
            "log clear",
            "keys",
        ]) {
            assert.match(COMMANDS, new RegExp(`\\b${word}\\b`));
        }
    });
    it("gives the AI the spec, the current riddim and the request", () => {
        const prompt = aiPrompt("a dark steppers in D minor", base);
        assert.ok(prompt.includes(SPEC));
        assert.ok(prompt.includes(base.trim()));
        assert.match(prompt, /Request: a dark steppers in D minor/);
        assert.match(prompt, /never copy a real song's bassline or melody/);
    });
    it("documents every setting the parser accepts", () => {
        for (const setting of [
            "bpm",
            "key",
            "swing",
            "bars",
            "kick",
            "rim",
            "hat",
            "skank",
            "organ",
            "chords",
            "bass",
            "lead",
            "echo",
            "spring",
        ]) {
            assert.match(SPEC, new RegExp(`^${setting}\\b`, "m"));
        }
    });
});
