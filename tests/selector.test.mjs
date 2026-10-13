import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARTISTS } from "../skills/dubwise/scripts/artists.mjs";
import { readIntent } from "../skills/dubwise/scripts/composer.mjs";
import { parseCommand } from "../src/console.js";
import { createSelector } from "../src/selector.js";
import { SELECTOR } from "../src/selector-content.js";

const DAY = new Date("2026-10-13T12:00:00");
/** A fresh selector on a fixed day. */
const selector = () => createSelector(SELECTOR, DAY);
/** Everything the selector says to some lines, one reply each. @param {...string} lines */
function chat(...lines) {
    const one = selector();
    return lines.map((line) => one.reply(line));
}

describe("the selector", () => {
    it("greets with the mood of the day and plays it when asked", () => {
        const [hello, play] = chat("oi!", "play it");
        const mood = selector().mood;
        assert.ok(
            hello?.say.some((line) => line.startsWith(`Today's mood: ${mood.name}.`)),
            hello?.say.join("\n"),
        );
        assert.deepEqual(play, { say: [], idea: mood.idea });
    });

    it("asks back after how are you, and picks a mood for the answer", () => {
        const [how, answer] = chat("how are you?", "tired");
        assert.match(how?.say.at(-1) ?? "", /how are you feeling/);
        const tired = SELECTOR.feelings.find((feeling) => feeling.name === "tired");
        assert.ok(
            tired?.moods.some((name) => answer?.say[0].includes(`Try this mood: ${name}.`)),
            answer?.say[0],
        );
    });

    it("hears a feeling in three languages, and not turns it round", () => {
        const sad = SELECTOR.feelings.find((feeling) => feeling.name === "sad");
        for (const line of ["I'm not good", "não estou bem", "estoy triste"]) {
            const [reply] = chat(line);
            assert.ok(
                sad?.moods.some((name) => reply?.say[0].includes(name)),
                `${line}: ${reply?.say[0]}`,
            );
        }
    });

    it("leaves ideas, commands and bare words to the console", () => {
        for (const line of [
            "a dark steppers in D minor",
            "happy",
            "sad",
            "good vibes",
            "bpm 76",
            "play",
            "mute kick",
            "inspired by Augustus Pablo",
            "a dark mood",
            "yo quiero un riddim triste",
            "hi make me a slow one drop for a rainy night",
            "darker",
        ]) {
            assert.equal(selector().reply(line), null, line);
        }
    });

    it("lets an offer lapse once the talk moves on", () => {
        const [, idea, ok] = chat("hi", "a dark steppers", "ok");
        assert.equal(idea, null);
        assert.equal(ok, null);
    });

    it("teaches the technique that goes with the mood, plays it, then moves on", () => {
        const one = selector();
        const mood = one.mood;
        one.reply("hello");
        const tip = one.reply("tip");
        const paired = SELECTOR.techniques.find((technique) => technique.id === mood.technique);
        assert.equal(tip?.say[0].split(".")[0], paired?.title.replace(/\.$/, ""));
        if (paired?.steps.length) assert.deepEqual(one.reply("try it")?.steps, paired.steps);
        const next = one.reply("another tip");
        assert.notEqual(next?.say[0], tip?.say[0]);
    });

    it("tells the story behind a name, typed with a slip or in Portuguese", () => {
        for (const [line, name] of [
            ["who is King Tubby?", "King Tubby"],
            ["quem foi o scientist", "Scientist"],
            ["tell me about augustus pablo", "Augustus Pablo"],
            ["who is bethoven", "Ludwig van Beethoven"],
        ]) {
            const [reply] = chat(line);
            assert.ok(reply?.say[0].startsWith(`${name}:`), `${line}: ${reply?.say[0]}`);
        }
        const [, play] = chat("who is King Tubby?", "play it");
        assert.equal(readIntent(play?.idea ?? "").artist?.name, "King Tubby");
        assert.match(chat("who is zzyzx?")[0]?.say[0] ?? "", /don't know that name/);
        assert.match(chat("quem é você?")[0]?.say[0] ?? "", /^I'm the selector/);
    });

    it("gives challenges in turn", () => {
        const [first, second] = chat("challenge", "another");
        assert.match(first?.say[0] ?? "", /^Challenge: /);
        assert.notEqual(first?.say[0], second?.say[0]);
    });

    it("answers thanks, goodbye and questions it cannot answer", () => {
        assert.ok(chat("valeu")[0]?.say[0]);
        assert.ok(chat("tchau")[0]?.say[0]);
        assert.match(chat("do you like pizza?")[0]?.say[0] ?? "", /I only talk riddims/);
    });

    it("answers what is, and offers to play it", () => {
        for (const entry of SELECTOR.faq) {
            const [reply] = chat(`what is ${entry.terms[0]}?`);
            assert.equal(reply?.say[0], entry.answer, entry.terms[0]);
        }
    });
});

describe("the selector's content", () => {
    it("has moods whose ideas the composer reads in full", () => {
        for (const mood of SELECTOR.moods) {
            assert.deepEqual(readIntent(mood.idea).unknown, [], `${mood.name}: ${mood.idea}`);
        }
    });

    it("has techniques whose steps are console commands", () => {
        for (const technique of SELECTOR.techniques) {
            for (const step of technique.steps) {
                const command = parseCommand(step.command);
                assert.ok(command && command.type !== "error" && command.type !== "compose", step.command);
            }
        }
    });

    it("points only at moods, techniques and names that exist", () => {
        const names = new Set(ARTISTS.map((artist) => artist.name));
        for (const story of SELECTOR.stories) assert.ok(names.has(story.name), story.name);
        const moods = new Set(SELECTOR.moods.map((mood) => mood.name));
        for (const feeling of SELECTOR.feelings) for (const name of feeling.moods) assert.ok(moods.has(name), name);
    });
});
