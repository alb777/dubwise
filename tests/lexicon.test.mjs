import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { compose } from "../skills/dubwise/scripts/composer.mjs";
import { parseLexicon } from "../skills/dubwise/scripts/lexicon.mjs";

const file = readFileSync(join(import.meta.dirname, "..", "skills", "dubwise", "assets", "lexicon.bin"));
const lexicon = parseLexicon(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));

/** Odd ideas none of whose words the composer knows, with what a person would expect of them. */
const ODD = [
    ["volcano waking up", { mode: "minor" }],
    ["vulcão acordando", { mode: "minor" }],
    ["grandma baking cookies", { mode: "major" }],
    ["abuela cocinando galletas", { mode: "major" }],
    ["lighthouse in a hurricane", { mode: "minor" }],
    ["sunrise over the mountains", { mode: "major" }],
    ["bebê dormindo", { tempo: "slow", density: "sparse" }],
    ["heist movie", { mode: "minor" }],
    ["fireworks over the bay", { mode: "major" }],
    ["snowfall in a quiet village", { density: "sparse", tempo: "slow" }],
    ["film in an abandoned hospital", { mode: "minor" }],
    ["velório", { mode: "minor" }],
    ["siesta", { tempo: "slow" }],
    ["jogo de futebol", { density: "busy" }],
    ["pelea de gallos", { mode: "minor", density: "busy" }],
    ["terremoto", { mode: "minor" }],
    ["cumpleaños feliz", { mode: "major" }],
    ["cyberpunk Tokyo", { mode: "minor" }],
    ["a submarine full of cats", { echo: "high" }],
    ["angry bees", { density: "busy" }],
    ["ambient meditation at dawn", { density: "sparse" }],
    ["una noche de tango en Buenos Aires", { mode: "minor" }],
    ["festa de aniversário de criança", { mode: "major", density: "busy" }],
    ["funeral march for a robot", { mode: "minor" }],
    ["drum and bass at a rave", { density: "busy" }],
    ["the last train home after a long night", { mode: "minor" }],
    ["minha avó cozinhando num domingo", { mode: "major" }],
    ["piquenique no parque", { mode: "major" }],
    ["tormenta en el mar", { mode: "minor" }],
    ["um dia de praia com os amigos", { mode: "major" }],
];

describe("dubwise's word map", () => {
    it("splits words into the model's tokens, accents and all", () => {
        assert.deepEqual(lexicon.tokens("vulcão"), ["▁vul", "cão"]);
    });

    it("reads ideas in three languages the way a person would", () => {
        const sensible = (idea, expect) =>
            Object.entries(expect).every(([field, value]) => lexicon.read(idea)?.[field] === value);
        const right = ODD.filter(([idea, expect]) => sensible(idea, expect)).length;
        assert.ok(right >= 26, `${right}/${ODD.length} read as expected`);
        for (const [idea, expect] of ODD.slice(0, 7)) assert.ok(sensible(idea, expect), idea);
    });

    it("says it read the idea itself, not an AI", () => {
        const reading = lexicon.read("volcano waking up");
        assert.equal(reading?.by, "dubwise");
        assert.match(reading?.reading ?? "", /^minor/);
        assert.match(compose("volcano waking up", 0, reading).summary, /dubwise read "volcano waking up" as: minor/);
    });

    it("reads only the unknown words of an idea when told which", () => {
        assert.deepEqual(
            lexicon.read("Lee Perry com vulcão acordando", ["vulcao acordando"]),
            lexicon.read("vulcão acordando"),
        );
    });

    it("reads nothing in text without letters or digits", () => {
        assert.equal(lexicon.read("!!! ???"), null);
    });
});
