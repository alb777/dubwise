import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
    bassMidi,
    chordAt,
    chordMidi,
    emptyRiddim,
    fromHash,
    parse,
    serialize,
    stepAt,
    toHash,
    toUrl,
} from "../skills/dubwise/scripts/notation.mjs";

const RIDDIMS = join(import.meta.dirname, "..", "skills", "dubwise", "assets", "riddims");
const presets = readdirSync(RIDDIMS).map((name) => [name, readFileSync(join(RIDDIMS, name), "utf8")]);

/** Parse and fail the test with the errors when the text is not valid. */
function valid(text) {
    const { riddim, errors } = parse(text);
    assert.deepEqual(errors, []);
    return riddim;
}

/** Errors for a riddim body, with the header added. */
function errorsOf(body) {
    return parse(`dubwise 1\n${body}`).errors;
}

describe("presets", () => {
    it("ships at least three riddims", () => assert.ok(presets.length >= 3));
    for (const [name, text] of presets) {
        it(`${name} parses and survives a round trip`, () => {
            const riddim = valid(text);
            assert.deepEqual(valid(serialize(riddim)), riddim);
        });
    }
});

describe("parse", () => {
    it("reads every setting", () => {
        const riddim = valid(presets.find(([name]) => name === "one-drop.txt")[1]);
        assert.equal(riddim.bpm, 72);
        assert.deepEqual(riddim.key, { root: "A", mode: "minor" });
        assert.equal(riddim.swing, 0.15);
        assert.equal(riddim.bars, 2);
        assert.equal(riddim.drums.kick.length, 32);
        assert.equal(riddim.drums.kick[8], 1);
        assert.equal(riddim.drums.hat[28], 3);
        assert.equal(riddim.bass.length, 32);
        assert.deepEqual(riddim.chords, [["1"], ["4"]]);
        assert.deepEqual(riddim.echo, { num: 3, den: 16, feedback: 0.55 });
        assert.equal(riddim.spring, 0.3);
    });

    it("uses defaults for what is not set", () => {
        assert.deepEqual(valid("dubwise 1\n"), emptyRiddim());
    });

    it("keeps sharps apart from comments", () => {
        const riddim = valid(
            "dubwise 1\nkey F# minor # a comment\n# whole line\nbass #4 . . . . . . . . . . . . . . .\n",
        );
        assert.deepEqual(riddim.key, { root: "F#", mode: "minor" });
        assert.equal(riddim.bass[0], "#4");
    });

    it("loops shorter lines over the riddim length", () => {
        const riddim = valid("dubwise 1\nbars 4\nkick x...............\nrim ................ | ........x.......\n");
        assert.equal(riddim.bars, 4);
        assert.equal(stepAt(riddim.drums.kick, 48), 1);
        assert.equal(stepAt(riddim.drums.rim, 56), 1);
    });

    it("needs the header first", () => {
        assert.deepEqual(parse("bpm 70\n").errors, [{ line: 1, message: 'the first line must be "dubwise 1"' }]);
        assert.equal(parse("").errors.length, 1);
    });

    const cases = [
        ["bpm 300", 2, /bpm must be/],
        ["swing 0.9", 2, /swing must be/],
        ["key H minor", 2, /key must look like/],
        ["echo 3/12 0.5", 2, /echo must look like/],
        ["echo 3/16 1.2", 2, /echo must look like/],
        ["bars 9", 2, /bars must be/],
        ["tempo 70", 2, /unknown setting "tempo"/],
        ["kick x...", 2, /kick bar 1 has 4 steps/],
        ["kick o...............", 2, /"o" is not a step/],
        ["hat x.x.?...........", 2, /"\?" is not a step/],
        ["bass 1 . .", 2, /bass bar 1 has 3 steps/],
        ["bass - . . . . . . . . . . . . . . .", 2, /no note comes before/],
        ["bass 1 . - . . . . . . . . . . . . .", 2, /no note comes before/],
        ["bass 8 . . . . . . . . . . . . . . .", 2, /"8" is not a scale degree/],
        ["chords 1 4 5", 2, /use 1, 2 or 4 per bar/],
        ["chords 1x", 2, /"1x" is not a chord degree/],
    ];
    for (const [body, line, message] of cases) {
        it(`rejects "${body}"`, () => {
            const errors = errorsOf(body);
            assert.equal(errors.length, 1, JSON.stringify(errors));
            assert.equal(errors[0].line, line);
            assert.match(errors[0].message, message);
        });
    }

    it("rejects a setting given twice", () => {
        assert.match(errorsOf("bpm 70\nbpm 72")[0].message, /set twice/);
    });

    it("rejects lines whose bars do not divide the riddim", () => {
        const errors = errorsOf("bars 4\nkick ................ | ................ | ................");
        assert.match(errors[0].message, /kick has 3 bars, which does not divide the riddim's 4 bars/);
    });

    it("reports every error at once", () => {
        assert.equal(errorsOf("bpm 10\nswing 2\nkick x").length, 3);
    });
});

describe("pitch", () => {
    const aMinor = { root: "A", mode: "minor" };
    it("puts the bass root between E1 and D#2", () => {
        assert.equal(bassMidi("1", aMinor), 33);
        assert.equal(bassMidi("1", { root: "C", mode: "major" }), 36);
        assert.equal(bassMidi("1", { root: "E", mode: "major" }), 28);
        assert.equal(bassMidi("1", { root: "Eb", mode: "major" }), 39);
    });
    it("follows the scale, accidentals and octave marks", () => {
        assert.equal(bassMidi("3", aMinor), 36);
        assert.equal(bassMidi("3", { root: "A", mode: "major" }), 37);
        assert.equal(bassMidi("b3", { root: "A", mode: "major" }), 36);
        assert.equal(bassMidi("5,", aMinor), 28);
        assert.equal(bassMidi("1'", aMinor), 45);
        assert.equal(bassMidi(".", aMinor), null);
        assert.equal(bassMidi("-", aMinor), null);
    });
    it("builds diatonic triads with quality overrides", () => {
        assert.deepEqual(chordMidi("1", aMinor), [57, 60, 64]);
        assert.deepEqual(chordMidi("7", aMinor), [55, 59, 62]);
        assert.deepEqual(chordMidi("2", aMinor), [59, 62, 65]);
        assert.deepEqual(chordMidi("5M", aMinor), [64, 68, 71]);
        assert.deepEqual(chordMidi("4m", { root: "C", mode: "major" }), [65, 68, 72]);
    });
    it("finds the chord for a step", () => {
        const chords = [["1", "4"], ["5"]];
        assert.equal(chordAt(chords, 0), "1");
        assert.equal(chordAt(chords, 8), "4");
        assert.equal(chordAt(chords, 20), "5");
        assert.equal(chordAt(chords, 32), "1");
        assert.equal(chordAt([], 3), undefined);
    });
});

describe("url", () => {
    it("round trips text through the hash", () => {
        for (const [, text] of presets) assert.equal(fromHash(toHash(text)), text.trim());
    });
    it("ignores hashes without a riddim or with broken encoding", () => {
        assert.equal(fromHash(""), null);
        assert.equal(fromHash("#about"), null);
        assert.equal(fromHash("#r=%E0%A4%A"), null);
    });
    it("builds a link on the published app", () => {
        assert.ok(toUrl("dubwise 1").startsWith("https://alb777.github.io/dubwise/#r=dubwise%201"));
    });
});
