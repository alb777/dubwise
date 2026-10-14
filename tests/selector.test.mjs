import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARTISTS } from "../skills/dubwise/scripts/artists.mjs";
import { readIntent } from "../skills/dubwise/scripts/composer.mjs";
import { parseCommand } from "../src/console.js";
import { createSelector } from "../src/selector.js";
import { SELECTOR } from "../src/selector-content.js";

const DAY = new Date("2026-10-14T12:00:00");
/** A fresh selector on a fixed day. */
const selector = () => createSelector(SELECTOR, DAY);
/** Everything the selector says to some lines, one reply each. @param {...string} lines */
function chat(...lines) {
    const one = selector();
    return lines.map((line) => one.reply(line));
}

/**
 * How people talk to the selector, in three languages, and what each line should get: [line, intent, language].
 * Each line goes to a fresh selector, with nothing said before it.
 */
const TALK = [
    ["hi", "mood", "en"],
    ["hello!", "mood", "en"],
    ["hey there", "mood", "en"],
    ["good morning", "mood", "en"],
    ["wah gwaan", "mood", "en"],
    ["how are you?", "mood", "en"],
    ["how's it going?", "mood", "en"],
    ["what's up?", "mood", "en"],
    ["what's the mood today?", "mood", "en"],
    ["mood", "mood", "en"],
    ["surprise me", "mood", "en"],
    ["what should I play?", "mood", "en"],
    ["I'm tired", "mood", "en"],
    ["I feel happy", "mood", "en"],
    ["I'm not good", "mood", "en"],
    ["I'm stressed", "mood", "en"],
    ["oi", "mood", "pt"],
    ["olá!", "mood", "pt"],
    ["e aí, beleza?", "mood", "pt"],
    ["bom dia", "mood", "pt"],
    ["boa noite", "mood", "pt"],
    ["tudo bem?", "mood", "pt"],
    ["como vai?", "mood", "pt"],
    ["qual o mood de hoje?", "mood", "pt"],
    ["me surpreende", "mood", "pt"],
    ["o que eu toco?", "mood", "pt"],
    ["tô cansado", "mood", "pt"],
    ["estou feliz", "mood", "pt"],
    ["tô feliz hoje", "mood", "pt"],
    ["não estou bem", "mood", "pt"],
    ["tô estressado", "mood", "pt"],
    ["ando entediado", "mood", "pt"],
    ["me sinto calmo", "mood", "pt"],
    ["hola", "mood", "es"],
    ["buenos días", "mood", "es"],
    ["¿qué tal?", "mood", "es"],
    ["¿cómo estás?", "mood", "es"],
    ["¿qué toco?", "mood", "es"],
    ["sorpréndeme", "mood", "es"],
    ["estoy cansado", "mood", "es"],
    ["estoy feliz", "mood", "es"],
    ["no estoy bien", "mood", "es"],
    ["estoy aburrido", "mood", "es"],
    ["me siento tranquilo", "mood", "es"],
    ["tip", "technique", "en"],
    ["give me a tip", "technique", "en"],
    ["teach me something", "technique", "en"],
    ["how do I make a steppers?", "technique", "en"],
    ["how do I make a one drop beat?", "technique", "en"],
    ["how to do a drop out", "technique", "en"],
    ["who invented the one drop?", "technique", "en"],
    ["who invented dub?", "technique", "en"],
    ["dica", "technique", "pt"],
    ["me dá uma dica", "technique", "pt"],
    ["me ensina um truque", "technique", "pt"],
    ["como faço um steppers?", "technique", "pt"],
    ["como fazer um one drop", "technique", "pt"],
    ["como faço o drop out?", "technique", "pt"],
    ["quem inventou o one drop?", "technique", "pt"],
    ["quem inventou o dub?", "technique", "pt"],
    ["quem criou o phaser?", "technique", "pt"],
    ["consejo", "technique", "es"],
    ["dame un consejo", "technique", "es"],
    ["enséñame un truco", "technique", "es"],
    ["¿cómo hago un rockers?", "technique", "es"],
    ["¿cómo se hace el skank?", "technique", "es"],
    ["¿quién inventó el one drop?", "technique", "es"],
    ["who is King Tubby?", "story", "en"],
    ["tell me about Lee Perry", "story", "en"],
    ["who was Scientist", "story", "en"],
    ["tell me a story", "story", "en"],
    ["story of Studio One", "story", "en"],
    ["who is bethoven", "story", "en"],
    ["quem foi King Tubby?", "story", "pt"],
    ["me fala do Scientist", "story", "pt"],
    ["me conta uma história", "story", "pt"],
    ["quem é o Jah Shaka?", "story", "pt"],
    ["conta sobre Natiruts", "story", "pt"],
    ["¿quién es King Tubby?", "story", "es"],
    ["háblame de Lee Perry", "story", "es"],
    ["cuéntame una historia", "story", "es"],
    ["¿quién fue Augustus Pablo?", "story", "es"],
    ["what is dub?", "answer", "en"],
    ["what's a riddim?", "answer", "en"],
    ["what is a dubplate", "answer", "en"],
    ["what does skank mean?", "answer", "en"],
    ["what is lovers rock?", "answer", "en"],
    ["o que é dub?", "answer", "pt"],
    ["o que é um riddim?", "answer", "pt"],
    ["o que significa skank?", "answer", "pt"],
    ["o que é um sound system?", "answer", "pt"],
    ["o que é rocksteady?", "answer", "pt"],
    ["¿qué es el dub?", "answer", "es"],
    ["¿qué es un riddim?", "answer", "es"],
    ["¿qué significa skank?", "answer", "es"],
    ["¿qué es un sound system?", "answer", "es"],
    ["challenge", "challenge", "en"],
    ["give me a challenge", "challenge", "en"],
    ["me dá um desafio", "challenge", "pt"],
    ["desafio", "challenge", "pt"],
    ["dame un reto", "challenge", "es"],
    ["what's your favourite riddim?", "favourite", "en"],
    ["qual seu riddim favorito?", "favourite", "pt"],
    ["¿cuál es tu riddim favorito?", "favourite", "es"],
    ["who else sounds like this?", "similar", "en"],
    ["something similar to King Tubby", "similar", "en"],
    ["quem mais soa assim?", "similar", "pt"],
    ["algo parecido com Chronixx", "similar", "pt"],
    ["¿quién más suena así?", "similar", "es"],
    ["who are you?", "me", "en"],
    ["what can you do?", "me", "en"],
    ["quem é você?", "me", "pt"],
    ["o que você faz?", "me", "pt"],
    ["¿quién eres?", "me", "es"],
    ["thanks", "thanks", "en"],
    ["thank you!", "thanks", "en"],
    ["big up", "thanks", "en"],
    ["valeu", "thanks", "pt"],
    ["obrigado pela dica", "thanks", "pt"],
    ["gracias", "thanks", "es"],
    ["bye", "bye", "en"],
    ["see you", "bye", "en"],
    ["tchau", "bye", "pt"],
    ["até mais", "bye", "pt"],
    ["adiós", "bye", "es"],
    ["hasta luego", "bye", "es"],
    ["and you?", "howAreYou", "en"],
    ["e você?", "howAreYou", "pt"],
    ["¿y tú?", "howAreYou", "es"],
    ["do you like pizza?", "lost", "en"],
    ["você gosta de pizza?", "lost", "pt"],
    ["¿te gusta la pizza?", "lost", "es"],
    ["bora", "ready", "pt"],
    ["ok", "ready", "en"],
    ["dale", "ready", "es"],
];

/** Lines that are not talk: ideas and commands the console takes as before. */
const NOT_TALK = [
    "a dark steppers in D minor",
    "um one drop lento com muito eco",
    "un ritmo para bailar bajo la luna",
    "inspired by Augustus Pablo",
    "Iration Steppas meets King Tubby",
    "funk carioca meets King Tubby",
    "dub techno em Fm",
    "hi make me a slow one drop for a rainy night",
    "yo quiero un riddim triste",
    "a dark mood",
    "good vibes",
    "happy",
    "sad",
    "darker",
    "mais rápido",
    "más eco",
    "bpm 76",
    "kick x...x...x...x...",
    "play",
    "play it",
    "stop",
    "mute kick",
    "help",
    "guide",
    "theme jamaica",
    "preset steppers",
    "again",
    "undo",
    "share",
    "crash",
    "spin",
    "pull up",
    "phaser",
    "filter -0.5",
];

describe("the selector", () => {
    for (const [line, intent, lang] of TALK) {
        it(`answers "${line}" with ${intent}, in ${lang}`, () => {
            const one = selector();
            assert.equal(one.reply(line)?.intent, intent);
            assert.equal(one.lang, lang);
        });
    }

    it("leaves ideas and commands to the console", () => {
        for (const line of NOT_TALK) assert.equal(selector().reply(line), null, line);
    });

    it("greets with the mood of the day and plays it when asked", () => {
        const [hello, play] = chat("oi!", "toca");
        const { mood } = selector();
        assert.ok(
            hello?.say.some((line) => line.includes(`${mood.title.pt}.`)),
            hello?.say.join("\n"),
        );
        assert.deepEqual(play, { intent: "play", say: [], idea: mood.idea });
    });

    it("asks back after how are you, and picks a mood for the answer", () => {
        const [how, answer] = chat("how are you?", "tired");
        assert.equal(how?.say.at(-1), SELECTOR.lines.en.askBack[0]);
        const tired = SELECTOR.feelings.find((feeling) => feeling.name === "tired");
        assert.ok(
            tired?.moods.some((name) => answer?.say[0].includes(name)),
            answer?.say[0],
        );
    });

    it("picks a mood for the feeling, every time", () => {
        const happy = SELECTOR.feelings.find((feeling) => feeling.name === "happy");
        for (let i = 0; i < 6; i++) {
            const [reply] = chat("tô feliz hoje");
            const titles = SELECTOR.moods.filter((mood) => happy?.moods.includes(mood.name)).map((m) => m.title.pt);
            assert.ok(
                titles.some((title) => reply?.say[0].includes(title)),
                reply?.say[0],
            );
        }
    });

    it("keeps the language of the talk for a lone word", () => {
        const one = selector();
        one.reply("oi, tudo bem?");
        one.reply("tip");
        assert.equal(one.lang, "pt");
    });

    it("lets an offer lapse once the talk moves on", () => {
        const [, idea, ok] = chat("hi", "a dark steppers", "play it");
        assert.equal(idea, null);
        assert.equal(ok, null);
    });

    it("teaches the technique that goes with the mood, plays it, then moves on", () => {
        const one = selector();
        one.reply("hello");
        const tip = one.reply("tip");
        const paired = SELECTOR.techniques.find((technique) => technique.id === one.mood.technique);
        assert.ok(tip?.say[0].startsWith(`${paired?.title.en}.`), tip?.say[0]);
        if (paired?.steps.length) assert.deepEqual(one.reply("try it")?.steps, paired.steps);
        assert.notEqual(one.reply("another tip")?.say[0], tip?.say[0]);
    });

    it("tells the story behind a name, then why, then names close to it", () => {
        const [story, why] = chat("who is King Tubby?", "why?");
        assert.ok(story?.say[0].startsWith("King Tubby: "), story?.say[0]);
        assert.equal(why?.intent, "more");
        assert.match(why?.say[1] ?? "", /^Close to King Tubby: /);
        const [, play] = chat("who is King Tubby?", "play it");
        assert.equal(readIntent(play?.idea ?? "").artist?.name, "King Tubby");
        assert.match(chat("who is zzyzx?")[0]?.say[0] ?? "", /don't know that name/);
    });

    it("finds names close to the one playing, in the same family", () => {
        const one = selector();
        one.playing = ARTISTS.find((artist) => artist.name === "Metallica");
        const close = one.reply("who else sounds like this?");
        const names = ARTISTS.filter((artist) => close?.say[0].includes(artist.name) && artist.name !== "Metallica");
        assert.ok(names.length >= 3 && names.every((artist) => artist.family === "rock"), close?.say[0]);
        assert.ok(one.reply("toca algo parecido")?.idea, "toca plays the closest at once");
    });

    it("gives challenges in turn", () => {
        const [first, second] = chat("challenge", "another");
        assert.notEqual(first?.say[0], second?.say[0]);
    });

    it("answers every question in its list", () => {
        for (const entry of SELECTOR.faq) {
            const [reply] = chat(`what is ${entry.terms[0]}?`);
            assert.equal(reply?.say[0], entry.answer.en, entry.terms[0]);
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

    it("quotes in each language only words the selector reads back", () => {
        // Every quoted word in a hint must work when typed: "toca", "dica", "dale", "consejo"...
        for (const lang of /** @type {const} */ (["en", "pt", "es"])) {
            for (const [voice, lines] of Object.entries(SELECTOR.lines[lang])) {
                for (const quoted of lines.flatMap((line) => [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]))) {
                    const one = selector();
                    one.reply(lang === "pt" ? "oi" : lang === "es" ? "hola" : "hi");
                    assert.ok(one.reply(quoted), `${lang} ${voice}: "${quoted}" is not read back`);
                }
            }
        }
    });
});
