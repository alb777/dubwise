import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARTISTS, compose, readIntent } from "../skills/dubwise/scripts/composer.mjs";
import { bassMidi, parse } from "../skills/dubwise/scripts/notation.mjs";

/** Compose, parse, and return both. */
function riddimFor(request, take = 0) {
    const result = compose(request, take);
    assert.equal(result.understood, true, result.summary);
    const { riddim, errors } = parse(result.text);
    assert.deepEqual(errors, []);
    return { riddim, result };
}

describe("reading an idea", () => {
    it("finds styles in several languages", () => {
        assert.equal(readIntent("a dark steppers").style, "steppers");
        assert.equal(readIntent("um one drop bem lento").style, "one-drop");
        assert.equal(readIntent("crie um rockers").style, "rockers");
        assert.equal(readIntent("algo militante, quatro por quatro").style, "steppers");
    });

    it("finds keys written as letters or solfege", () => {
        const cases = [
            ["a steppers in D minor", "D", "minor"],
            ["one drop em Gm", "G", "minor"],
            ["rockers in F# major", "F#", "major"],
            ["Em Ré menor, por favor", "D", "minor"],
            ["fa sustenido maior", "F#", "major"],
            ["un riddim en la menor", "A", "minor"],
        ];
        for (const [request, root, mode] of cases) {
            const intent = readIntent(request);
            assert.equal(intent.root, root, request);
            assert.equal(intent.mode, mode, request);
        }
    });

    it("does not read an article as a key", () => {
        assert.equal(readIntent("A dark steppers").root, undefined);
        assert.equal(readIntent("E agora um rockers").root, undefined);
    });

    it("finds tempo and mood", () => {
        assert.equal(readIntent("steppers at 80 bpm").bpm, 80);
        assert.equal(readIntent("one drop 66bpm").bpm, 66);
        assert.equal(readIntent("bem lento").tempo, "slow");
        assert.equal(readIntent("alegre e ensolarado").mode, "major");
        assert.equal(readIntent("muito eco").echo, "high");
        assert.equal(readIntent("seco, sem eco").echo, "low");
        assert.equal(readIntent("minimalista").density, "sparse");
        assert.equal(readIntent("baixo melódico").bass, "melodic");
    });

    it("recognises artists and scenes", () => {
        assert.equal(readIntent("crie um riddim inspirado em augustus pablo").artist?.name, "Augustus Pablo");
        assert.equal(readIntent("like King Tubby").artist?.name, "King Tubby");
        assert.equal(readIntent("estilo Jah Shaka").artist?.name, "Jah Shaka");
        assert.equal(readIntent("dub techno").artist?.name, "dub techno");
    });
});

describe("composing", () => {
    it("writes an Augustus Pablo inspired riddim", () => {
        const { riddim, result } = riddimFor("crie um riddim inspirado em augustus pablo");
        assert.equal(riddim.key.mode, "minor");
        assert.equal(riddim.drums.kick[0], 1, "rockers puts the kick on beat 1");
        assert.equal(riddim.drums.kick[8], 1);
        assert.ok(riddim.echo.feedback >= 0.6, "wide echo");
        assert.match(result.summary, /inspired by Augustus Pablo/);
    });

    it("follows the drum rules of each style", () => {
        const oneDrop = riddimFor("one drop").riddim.drums.kick;
        assert.equal(oneDrop[0], 0, "one drop leaves beat 1 empty");
        assert.equal(oneDrop[8], 1);
        const steppers = riddimFor("steppers").riddim.drums.kick;
        for (const beat of [0, 4, 8, 12]) assert.equal(steppers[beat], 1);
    });

    it("blends two references, X meets Y", () => {
        const intent = readIntent("Iration Steppas meets King Tubby");
        assert.equal(intent.artist?.name, "Iration Steppas");
        assert.equal(intent.mixArtist?.name, "King Tubby");
        const { riddim, result } = riddimFor("Iration Steppas meets King Tubby");
        for (const beat of [0, 4, 8, 12])
            assert.equal(riddim.drums.kick[beat], 1, "steppers drums from Iration Steppas");
        assert.ok(riddim.bpm >= 130, `fast tempo from Iration Steppas, got ${riddim.bpm}`);
        assert.equal(riddim.echo.feedback, 0.65, "wide echo from King Tubby");
        assert.match(result.summary, /Iration Steppas meets King Tubby: drums and tempo from Iration Steppas/);
    });

    it("lets the order decide who leads", () => {
        const { riddim } = riddimFor("King Tubby meets Iration Steppas");
        assert.equal(riddim.drums.kick[0], 0, "one drop drums from King Tubby");
        assert.ok(riddim.bpm < 90, `dub tempo from King Tubby, got ${riddim.bpm}`);
    });

    it("lets explicit words beat both references", () => {
        const { riddim } = riddimFor("Iration Steppas meets King Tubby in A major at 90 bpm, dry");
        assert.deepEqual(riddim.key, { root: "A", mode: "major" });
        assert.equal(riddim.bpm, 90);
        assert.equal(riddim.echo.feedback, 0.35);
    });

    it("honours an explicit key and tempo", () => {
        const { riddim } = riddimFor("a dark steppers in D minor at 80 bpm");
        assert.deepEqual(riddim.key, { root: "D", mode: "minor" });
        assert.equal(riddim.bpm, 80);
    });

    it("is deterministic per take and varies between takes", () => {
        const first = compose("crie um riddim inspirado em augustus pablo", 0);
        assert.deepEqual(compose("crie um riddim inspirado em augustus pablo", 0), first);
        const takes = new Set(
            [0, 1, 2, 3].map((take) => compose("crie um riddim inspirado em augustus pablo", take).text),
        );
        assert.ok(takes.size >= 3, "takes should differ");
    });

    it("keeps the bass in the dub register", () => {
        for (let take = 0; take < 40; take++) {
            const { riddim } = riddimFor("one drop melodic", take);
            for (const token of riddim.bass) {
                const midi = bassMidi(token, riddim.key);
                if (midi !== null)
                    assert.ok(midi >= 24 && midi <= 52, `${token} in ${riddim.key.root} is midi ${midi}`);
            }
        }
    });

    it("always writes a valid riddim", () => {
        const ideas = [
            "crie um riddim",
            "a dark steppers in D minor",
            "um one drop alegre bem lento com muito eco",
            "rockers minimal seco",
            "inspirado em lee perry, agitado",
            "dub techno em Fm",
            "steppers 140 bpm heavy bass",
            "un riddim en la menor",
            ...ARTISTS.map((artist) => `inspired by ${artist.aliases[0]}`),
            ...ARTISTS.map((artist, i) => `${artist.aliases[0]} meets ${ARTISTS[(i + 3) % ARTISTS.length].aliases[0]}`),
        ];
        let count = 0;
        for (const idea of ideas) {
            for (let take = 0; take < 25; take++) {
                riddimFor(idea, take);
                count++;
            }
        }
        assert.ok(count > 400);
    });

    it("never refuses an idea, however odd", () => {
        const ideas = [
            "Martin Campbell style",
            "make something like Koffee",
            "something inspired by the new jamaican era",
            "a riddim for a cat chasing a laser in space",
            "dancehall riddim like the 90s",
            "rocksteady love song",
            "hello there",
            "i like it",
            "asdf",
            "1234",
            "a b c d e f g",
            "uma base pra tocar no churrasco de domingo",
            "algo que lembre chuva na janela",
            "un ritmo para bailar bajo la luna",
            "🔥🔥 vibes 🔥🔥",
            "Koffee x Chronixx x Protoje",
            "what would a robot play at a sound system clash",
            "ダブ",
            "dub ".repeat(300),
        ];
        for (const idea of ideas) {
            for (let take = 0; take < 3; take++) riddimFor(idea, take);
        }
    });

    it("says which words it did not know", () => {
        const cases = [
            ["Martin Campbell style", /I don't know "martin campbell" yet, .*add a style, mood or tempo/],
            ["make something like Koffee", /I don't know "koffee" yet/],
            [
                "a slow one drop for the new jamaican era",
                /I don't know "new jamaican era", so I went by the other words/,
            ],
            ["inspirado em Fulano de Tal", /I don't know "fulano de tal"/],
            ["a riddim for a cat chasing a laser in space", /I don't know "cat chasing a laser", so I went by/],
        ];
        for (const [idea, note] of cases) assert.match(riddimFor(idea).result.summary, note, idea);
    });

    it("does not complain about words it understood", () => {
        const ideas = [
            "crie um riddim inspirado em augustus pablo",
            "a dark steppers in D minor at 80 bpm",
            "um one drop alegre bem lento com muito eco",
            "Em Ré menor, por favor",
            "rockers in F# major",
            "one drop 66bpm",
            "Iration Steppas meets King Tubby",
            "make me a heavy dark dub with lots of echo",
            "un riddim en la menor",
            "i like it",
        ];
        for (const idea of ideas) assert.doesNotMatch(riddimFor(idea).result.summary, /don't know/, idea);
    });

    it("declines only text with no words in it", () => {
        for (const text of ["?!", "🔥🔥🔥", "..."]) assert.equal(compose(text).understood, false, text);
    });
});
