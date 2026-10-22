import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARTISTS } from "../skills/dubwise/scripts/artists.mjs";
import { compose, composeIntent, readIntent, refine } from "../skills/dubwise/scripts/composer.mjs";
import { bassMidi, leadMidi, parse } from "../skills/dubwise/scripts/notation.mjs";

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

    it("finds the words that ask for the melodica line", () => {
        assert.equal(readIntent("a theme in the keyboard").lead, true);
        assert.equal(readIntent("um riddim com melodica").lead, true);
        assert.equal(readIntent("play a melody for the organ").lead, true);
        assert.equal(readIntent("a dark steppers").lead, undefined);
        assert.deepEqual(readIntent("play beverly hills cop theme in the keyboard").unknown, ["beverly hills cop"]);
    });

    it("finds tempo and mood", () => {
        assert.equal(readIntent("steppers at 80 bpm").bpm, 80);
        assert.equal(readIntent("one drop 66bpm").bpm, 66);
        assert.equal(readIntent("bem lento").tempo, "slow");
        assert.equal(readIntent("alegre e ensolarado").mode, "major");
        assert.equal(readIntent("muito eco").echo, "high");
        assert.equal(readIntent("seco, sem eco").echo, "low");
        assert.equal(readIntent("less echo").echo, "low");
        assert.equal(readIntent("faster").tempo, "fast");
        assert.equal(readIntent("darker and slower").mode, "minor");
        assert.deepEqual(readIntent("something heavy rim but slow bpm").unknown, ["rim"]);
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

    it("bubbles the organ under the skank, on 16ths where the skank owns the offbeats", () => {
        const oneDrop = riddimFor("one drop").riddim.drums;
        assert.deepEqual(oneDrop.organ.slice(0, 8), [0, 0, 1, 0, 0, 0, 1, 0], "the organ answers the chops");
        const steppers = riddimFor("steppers").riddim.drums;
        assert.deepEqual(steppers.organ.slice(0, 4), [0, 1, 1, 0], "16ths where the skank sits on the offbeats");
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

    it("writes a melodica line when the idea asks for a melody", () => {
        const ideas = [
            "a dark steppers in D minor with a melody",
            "um riddim com melodica em C maior",
            "a theme for the keyboard in G minor",
        ];
        for (const idea of ideas) {
            const { riddim, result } = riddimFor(idea);
            assert.ok(riddim.lead.length >= 16, `${idea}: ${riddim.lead.length} steps`);
            assert.match(result.summary, /melodica line/, idea);
            assert.match(result.text, /^lead {3}/m, idea);
        }
    });

    it("keeps the melodica quiet when no melody is asked for", () => {
        const { riddim, result } = riddimFor("a dark steppers in D minor");
        assert.deepEqual(riddim.lead, []);
        assert.doesNotMatch(result.summary, /melodica line/);
    });

    it("gives the same melody to the same idea and another to the next take", () => {
        const first = compose("a slow melody in A minor", 0);
        assert.deepEqual(compose("a slow melody in A minor", 0), first);
        assert.notEqual(first.text, compose("a slow melody in A minor", 1).text);
    });

    it("keeps every melodica note in the melodica's register", () => {
        for (let take = 0; take < 40; take++) {
            const { riddim } = riddimFor("melodica steppers busy", take);
            for (const token of riddim.lead) {
                const midi = leadMidi(token, riddim.key);
                if (midi !== null)
                    assert.ok(midi >= 60 && midi <= 84, `${token} in ${riddim.key.root} is midi ${midi}`);
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
        ];
        // Every reference, alone and blended, with fewer takes each so the suite stays quick.
        const references = [
            ...ARTISTS.map((artist) => `inspired by ${artist.aliases[0]}`),
            ...ARTISTS.map((artist, i) => `${artist.aliases[0]} meets ${ARTISTS[(i + 3) % ARTISTS.length].aliases[0]}`),
        ];
        let count = 0;
        const write = (idea, takes) => {
            for (let take = 0; take < takes; take++, count++) riddimFor(idea, take);
        };
        for (const idea of ideas) write(idea, 25);
        for (const idea of references) write(idea, 5);
        assert.ok(count > 1000);
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
            ["make something like The Quantum Accountants", /I don't know "quantum accountants" yet/],
            ["a slow one drop for the quantum era", /I don't know "quantum era", so I went by the other words/],
            ["inspirado em Fulano de Tal", /I don't know "fulano de tal"/],
            ["a riddim for a cat chasing a laser in space", /I don't know "cat", so I went by the other words/],
            ["a melody for beverly hills cop", /I don't know "beverly hills cop", so I went by the other words/],
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

describe("references and images", () => {
    it("reads every alias as its own artist", () => {
        for (const artist of ARTISTS) {
            for (const alias of artist.aliases) {
                assert.equal(readIntent(`a riddim like ${alias}`).artist?.name, artist.name, alias);
            }
        }
    });

    it("prefers the longer name, so Damian Marley is not Bob Marley", () => {
        const intent = readIntent("Damian Marley meets Bob Marley");
        assert.equal(intent.artist?.name, "Damian Marley");
        assert.equal(intent.mixArtist?.name, "The Wailers");
    });

    it("does not read everyday words as names", () => {
        const ideas = [
            "a riddim with culture and soul",
            "uma mala cheia de dub",
            "the bug in my code",
            "a foundation riddim",
            "a riddim with covers",
            "barley in the field",
            // Each one a slip away from a name, found by running everyday phrases against the catalogue.
            "a great day at the beach",
            "a gorilla in the jungle",
            "the first riddim of the night",
            "an outcast in the city",
            "o malvado da novela",
            "salsa reggae night",
            "drive music",
            "happy house riddim",
            "uma brahma gelada",
            "something special",
        ];
        for (const idea of ideas) assert.equal(readIntent(idea).artist, undefined, idea);
    });

    it("reads a name typed with a slip and says so", () => {
        const cases = [
            ["lemi irie e drake", "Liemy irie", "lemi irie"],
            ["king tuby", "King Tubby", "king tuby"],
            ["roots like steel pulce", "Steel Pulse", "steel pulce"],
            ["bethoven", "Ludwig van Beethoven", "bethoven"],
            ["um som do emicda", "Emicida", "emicda"],
        ];
        for (const [idea, name, typed] of cases) {
            const intent = readIntent(idea);
            assert.equal(intent.artist?.name, name, idea);
            assert.deepEqual(intent.guessed, [{ typed, name }], idea);
            assert.match(compose(idea).summary, new RegExp(`read "${typed}" as ${name}`), idea);
        }
    });

    it("reads the bass words people type, with nothing left over", () => {
        for (const [idea, bass] of [
            ["steppers with melodic bass", "melodic"],
            ["a heavy one drop with root bass", "root"],
            ["rooted steppers", "root"],
            ["um steppers com baixo pesado", "root"],
        ]) {
            const intent = readIntent(idea);
            assert.equal(intent.bass, bass, idea);
            assert.deepEqual(intent.unknown, [], idea);
        }
    });

    it("lets plain words beat images, and earlier images beat later ones", () => {
        assert.equal(readIntent("a happy riddim for a rainy day").mode, "major");
        assert.equal(readIntent("a dry riddim in the rain").echo, "low");
        assert.equal(readIntent("the beach at night").mode, "minor");
    });

    it("keeps a named artist's drums under an image", () => {
        const intent = readIntent("Lee Perry robots");
        assert.equal(intent.style, undefined);
        assert.equal(intent.echo, "high");
        assert.match(riddimFor("Lee Perry robots").result.summary, /^one drop/);
    });

    it("reads a corpus of odd ideas", () => {
        const corpus = [
            ["make something like Koffee", { artist: "Koffee", unknown: [] }],
            ["something inspired by the new jamaican era", { artist: "reggae revival", unknown: [] }],
            ["dancehall riddim like the 90s", { artist: "dancehall", mixArtist: "the 90s" }],
            ["rocksteady love song", { artist: "rocksteady", mode: "major", unknown: [] }],
            [
                "a riddim for a cat chasing a laser in space",
                { style: "steppers", tempo: "fast", echo: "high", unknown: ["cat"] },
            ],
            ["uma base pra tocar no churrasco de domingo", { mode: "major", unknown: [] }],
            ["algo que lembre chuva na janela", { mode: "minor", echo: "high" }],
            ["un ritmo para bailar bajo la luna", { mode: "minor", echo: "high", density: "busy", unknown: [] }],
            ["what would a robot play at a sound system clash", { style: "steppers", unknown: [] }],
            ["Koffee x Chronixx x Protoje", { artist: "Koffee", mixArtist: "Chronixx" }],
            ["saudade de casa num dia de chuva", { style: "one-drop", tempo: "slow", mode: "minor" }],
            ["Natiruts na praia", { artist: "Natiruts", mode: "major", unknown: [] }],
            ["Paprika Korps meets Twinkle Brothers", { artist: "Paprika Korps", mixArtist: "Twinkle Brothers" }],
            ["a lullaby for a sleepy dragon", { style: "one-drop", tempo: "slow", unknown: ["dragon"] }],
            ["guerra de travesseiros", { style: "steppers", mode: "minor" }],
            ["furious robots in the factory", { style: "steppers", mode: "minor", bass: "root", unknown: [] }],
            ["una fiesta en la playa", { tempo: "fast", mode: "major", unknown: [] }],
            ["70s roots with lots of echo", { artist: "the 70s", style: "one-drop", echo: "high" }],
            ["ska punk party", { artist: "ska punk", tempo: "fast", unknown: [] }],
            ["o som das radiolas de São Luís", { artist: "reggae do Maranhão", unknown: [] }],
            ["nyabinghi drums at midnight", { artist: "nyabinghi", mode: "minor", unknown: [] }],
            ["um dub psicodélico pra viajar", { echo: "high", unknown: [] }],
            [
                "um dancehall paulista tipo Liemy irie",
                { artist: "dancehall paulista", mixArtist: "Liemy irie", unknown: [] },
            ],
            ["dancehall de São Paulo pra dançar", { artist: "dancehall paulista", density: "busy", unknown: [] }],
            ["Emecelee", { artist: "Emcee Lê", unknown: [] }],
            ["Fresh! Dancehall meets Bonsusound", { artist: "Fresh! Dancehall", mixArtist: "Bonsusound", unknown: [] }],
            ["Martin Campbell style", { artist: undefined, unknown: ["martin campbell"] }],
        ];
        for (const [idea, expected] of corpus) {
            const intent = readIntent(idea);
            const read = { ...intent, artist: intent.artist?.name, mixArtist: intent.mixArtist?.name };
            for (const [field, value] of Object.entries(expected))
                assert.deepEqual(read[field], value, `${idea}: ${field}`);
            riddimFor(idea);
        }
    });
});

describe("changing the riddim playing", () => {
    /** Rockers at 100 bpm in E minor, busy, dry echo. */
    const BASE = compose("a dark rockers in E minor at 100 bpm, dry, busy").text ?? "";
    /** Refine the base and parse the result. @param {string} request */
    const changed = (request) => {
        const result = refine(request, BASE);
        assert.ok(result, `${request} should change the riddim playing`);
        const { riddim, errors } = parse(result.text);
        assert.deepEqual(errors, [], request);
        return { riddim: /** @type {NonNullable<typeof riddim>} */ (riddim), summary: result.summary };
    };
    const base = /** @type {NonNullable<ReturnType<typeof parse>["riddim"]>} */ (parse(BASE).riddim);

    it("changes only what the words ask and keeps the bass line, chords and root", () => {
        const { riddim, summary } = changed("brighter");
        assert.deepEqual(riddim.key, { root: "E", mode: "major" });
        assert.deepEqual([riddim.bass, riddim.chords, riddim.bpm], [base.bass, base.chords, base.bpm]);
        assert.deepEqual(riddim.drums, base.drums);
        assert.equal(summary, "the same riddim, now in E major");
    });

    it("moves the tempo in steps, either way, in three languages", () => {
        assert.equal(changed("faster").riddim.bpm, 106);
        assert.equal(changed("more fast").riddim.bpm, 106);
        assert.equal(changed("a bit slower").riddim.bpm, 94);
        assert.equal(changed("less fast").riddim.bpm, 94);
        assert.equal(changed("menos rápido").riddim.bpm, 94);
        assert.equal(changed("más rápido").riddim.bpm, 106);
    });

    it("moves echo and drums one step at a time", () => {
        assert.equal(changed("more echo").riddim.echo.feedback, 0.5);
        assert.equal(changed("mais eco").riddim.spring, 0.3);
        const sparser = changed("sparser").riddim;
        assert.ok(sparser.drums.hat.filter(Boolean).length < base.drums.hat.filter(Boolean).length);
        assert.deepEqual(sparser.drums.kick, base.drums.kick);
        assert.deepEqual(changed("steppers now").riddim.drums.kick.slice(0, 4), [1, 0, 0, 0]);
    });

    it("brings the organ bubble along with a drum change", () => {
        assert.deepEqual(changed("steppers now").riddim.drums.organ.slice(0, 4), [0, 1, 1, 0]);
    });

    it("says when the riddim is already so, and how to make it darker", () => {
        const result = refine("more dark in the same style", BASE);
        assert.equal(result?.text, BASE);
        assert.match(result?.summary ?? "", /^already in E minor; for a darker sound try "filter -0\.5"/);
        assert.equal(refine("less echo", BASE)?.summary, "already dry echo");
    });

    it("leaves ideas with something new to the composer", () => {
        for (const idea of [
            "dark steppers",
            "darker like King Tubby",
            "more dark like a rainy night",
            "faster volcano",
            "more bass",
            "darker with a melody",
            "more",
        ]) {
            assert.equal(refine(idea, BASE), null, idea);
        }
    });
});

describe("a reference's own signature", () => {
    /** @type {import("../skills/dubwise/scripts/composer.mjs").Artist} A made-up reference with a full signature. */
    const SOUND = {
        name: "Test Sound",
        aliases: ["test sound"],
        family: "reggae",
        style: "rockers",
        bpm: 84,
        mode: "minor",
        echo: "high",
        density: "normal",
        bass: "root",
        traits: "a test",
        root: "G",
        chords: "1 | 4 | 7 | 1",
        hat: "flying",
        rim: "backbeat",
        skank: "bubble",
        echoTime: "3/8",
        swing: 0.12,
    };
    /** The riddim for an idea that names the sound, with some of the idea's own words. */
    const riddimOf = (words = {}, take = 0) => {
        const { riddim, errors } = parse(
            composeIntent({ ...readIntent("a riddim"), artist: SOUND, ...words }, 7, {}, take).text,
        );
        assert.deepEqual(errors, []);
        return /** @type {NonNullable<typeof riddim>} */ (riddim);
    };

    it("plays its key, chords, drum patterns, echo and swing", () => {
        const riddim = riddimOf();
        assert.deepEqual(riddim.key, { root: "G", mode: "minor" });
        assert.deepEqual(riddim.chords, [["1"], ["4"], ["7"], ["1"]]);
        assert.equal(riddim.bars, 4);
        assert.equal(riddim.bass.length, 64);
        assert.deepEqual(riddim.drums.hat.slice(0, 4), [0, 0, 3, 0], "flying cymbals open on the offbeats");
        assert.deepEqual([riddim.drums.rim[4], riddim.drums.rim[8], riddim.drums.rim[12]], [1, 0, 1], "rim on 2 and 4");
        assert.deepEqual(riddim.drums.skank.slice(0, 4), [0, 1, 1, 0], "the bubble's double stroke");
        assert.deepEqual([riddim.echo.num, riddim.echo.den], [3, 8]);
        assert.equal(riddim.swing, 0.12);
    });

    it("keeps its tempo exact on the first take and moves around it after", () => {
        assert.equal(riddimOf().bpm, 84);
        const takes = [1, 2, 3, 4, 5, 6].map((take) => riddimOf({}, take).bpm);
        assert.ok(takes.every((bpm) => bpm >= 82 && bpm <= 86) && takes.some((bpm) => bpm !== 84), String(takes));
    });

    it("walks the bass under every chord of a bar, as in a canon of four chords a bar", () => {
        for (const seed of [1, 2, 3, 4, 5]) {
            const intent = { ...readIntent("a riddim"), artist: { ...SOUND, chords: "1 5 6 3 | 4 1 4 5" } };
            const { riddim } = parse(composeIntent(intent, seed).text);
            const bass = riddim?.bass ?? [];
            for (const [b, bar] of (riddim?.chords ?? []).entries()) {
                for (const [c, chord] of bar.entries()) {
                    const notes = bass.slice(b * 16 + c * 4, b * 16 + c * 4 + 4).filter((t) => /\d/.test(t));
                    if (notes.length) assert.equal(notes[0].replace(/\D/g, ""), chord, `seed ${seed}, bar ${b + 1}`);
                }
            }
        }
    });

    it("flattens the root of a borrowed chord in the bass, as the bVII of a major key", () => {
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const artist = { ...SOUND, mode: /** @type {const} */ ("major"), chords: "1 | b7M" };
            const { riddim } = parse(composeIntent({ ...readIntent("a riddim"), artist }, seed).text);
            const sevens = (riddim?.bass ?? []).slice(16).filter((t) => /^[b#]?7/.test(t));
            assert.ok(
                sevens.every((t) => t.startsWith("b7")),
                `seed ${seed}: ${sevens.join(" ")}`,
            );
        }
    });

    it("lets the idea's own words win over it", () => {
        const busy = riddimOf({ density: "busy" });
        assert.ok(!busy.drums.hat.includes(3) || busy.drums.hat.indexOf(3) > 2, "a busy idea plays busy hats");
        assert.equal(riddimOf({ root: "E" }).key.root, "E");
        assert.equal(riddimOf({ style: "steppers" }).swing, 0);
    });
});
