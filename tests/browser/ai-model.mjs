// Runs the in-browser AI reader for real: WebLLM and Qwen3.5 on the GPU, in a headless browser, over ideas the word
// lists do not cover. It prints how each idea was read, how long it took, and how many readings make sense.
// The first run downloads the model (1.1 GB for "better", 0.45 GB for "small") into a profile kept for later runs.
// Usage: node tests/browser/ai-model.mjs [better|small]   (DUBWISE_AI_PROFILE sets where the profile lives)
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withPage } from "./cdp.mjs";

const size = process.argv[2] ?? "better";
const profile = process.env.DUBWISE_AI_PROFILE ?? join(tmpdir(), "dubwise-ai-check-profile");

/** Ideas with what a sensible reading would do. `slow` means a slow or laid back tempo, `fast` a lively or frantic one. */
const CORPUS = [
    ["Martin Campbell style", {}],
    ["cyberpunk Tokyo rain", { mode: "minor" }],
    ["a volcano waking up", { mode: "minor" }],
    ["children playing in the street on a sunny day", { mode: "major" }],
    ["Bob Ross painting happy little trees", { mode: "major" }],
    ["ambient meditation at dawn", { density: "sparse", slow: true }],
    ["angry bees", { density: "busy" }],
    ["minha avó cozinhando num domingo", { mode: "major" }],
    ["una noche de tango en Buenos Aires", { mode: "minor" }],
    ["the last train home after a long night", { slow: true }],
    ["Werner Herzog narrating a sunset", {}],
    ["a submarine full of cats", { echo: "high" }],
    ["festa de aniversário de criança", { mode: "major", density: "busy" }],
    ["funeral march for a robot", { mode: "minor" }],
    ["drum and bass at a rave", { fast: true }],
];

/** @param {any} reading @param {Record<string, unknown>} expect @returns {string[]} what did not match */
function misses(reading, expect) {
    const wrong = [];
    for (const [field, value] of Object.entries(expect)) {
        if (field === "slow" && !["slow", "laid back"].includes(reading.tempo))
            wrong.push(`tempo ${reading.tempo} not slow`);
        else if (field === "fast" && !["lively", "frantic"].includes(reading.tempo))
            wrong.push(`tempo ${reading.tempo} not fast`);
        else if (field !== "slow" && field !== "fast" && reading[field] !== value)
            wrong.push(`${field} ${reading[field]}, wanted ${value}`);
    }
    return wrong;
}

let failed = false;
await withPage(
    "/tests/browser/ai-check.html",
    async ({ evaluate, wait, errors }) => {
        await evaluate(`void (window.pending = readAll(${JSON.stringify(size)}, ${JSON.stringify(CORPUS.map(([idea]) => idea))})
            .then((results) => { window.results = results; }))`);
        let last = "";
        while (!(await evaluate("Boolean(window.results)"))) {
            const progress = await evaluate("window.progress ?? 'starting'");
            if (progress !== last) console.log(`  ${progress}`);
            last = progress;
            await wait(3000);
        }
        const results = await evaluate("window.results");
        let checked = 0;
        let sensible = 0;
        for (const [i, result] of results.entries()) {
            const expect = CORPUS[i][1];
            if (result.error) {
                failed = true;
                console.log(`FAIL ${result.idea}: ${result.error}`);
                continue;
            }
            const r = result.reading;
            const wrong = misses(r, expect);
            if (Object.keys(expect).length) {
                checked++;
                if (!wrong.length) sensible++;
            }
            const values = `${r.style} ${r.tempo} ${r.mode} echo ${r.echo} ${r.density} ${r.bass}`;
            console.log(
                `${wrong.length ? "MISS" : "ok  "} ${result.idea}  (${result.ms} ms)\n     "${r.reading}"  ${values}${wrong.length ? `\n     ${wrong.join("; ")}` : ""}`,
            );
        }
        console.log(`${sensible}/${checked} readings match what a person would expect (${size} model)`);
        if (errors.length) {
            failed = true;
            console.log("page errors:", errors);
        }
    },
    { gpu: true, profile },
);
process.exit(failed ? 1 : 0);
