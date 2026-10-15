import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { READING_SCHEMA } from "../skills/dubwise/scripts/intent.mjs";
import {
    answerWithin,
    asError,
    onLiveGpu,
    readWithEndpoint,
    WEBLLM_URL,
    webgpuProblem,
    whileMoving,
} from "../src/ai.js";

const ANSWER = {
    reading: "spy film: tense, dark",
    style: "steppers",
    tempo: "lively",
    mode: "minor",
    echo: "high",
    density: "busy",
    bass: "root",
};

/** A stand-in for an OpenAI-compatible server: each test queues the replies it wants and reads what was asked. */
const queue = [];
const asked = [];
let server;
let url;

before(async () => {
    server = createServer(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += chunk;
        asked.push({ path: request.url, headers: request.headers, body: JSON.parse(body) });
        const [status, reply] = queue.shift() ?? [500, { error: { message: "nothing queued" } }];
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(reply));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${server.address().port}/v1/`;
});
after(() => server.close());

const answer = (content) => [200, { choices: [{ message: { role: "assistant", content } }] }];
const reset = () => {
    queue.length = 0;
    asked.length = 0;
};

describe("reading an idea with an OpenAI-compatible server", () => {
    it("asks for the schema at temperature 0 and returns the reading", async () => {
        reset();
        queue.push(answer(JSON.stringify(ANSWER)));
        const reading = await readWithEndpoint({ url, model: "qwen3.5:2b" }, "Martin Campbell style");
        assert.deepEqual(reading, ANSWER);
        const [{ path, headers, body }] = asked;
        assert.equal(path, "/v1/chat/completions");
        assert.equal(headers.authorization, undefined, "no key, no header");
        assert.equal(body.model, "qwen3.5:2b");
        assert.equal(body.temperature, 0);
        assert.deepEqual(body.response_format.json_schema.schema, READING_SCHEMA);
        assert.deepEqual(body.messages.at(-1), { role: "user", content: "Idea: Martin Campbell style" });
    });

    it("sends the key only as a bearer token", async () => {
        reset();
        queue.push(answer(JSON.stringify(ANSWER)));
        await readWithEndpoint({ url, model: "m", key: "secret" }, "idea");
        assert.equal(asked[0].headers.authorization, "Bearer secret");
        assert.doesNotMatch(JSON.stringify(asked[0].body), /secret/);
    });

    it("falls back to plain JSON mode when the server turns the schema down", async () => {
        reset();
        queue.push([400, { error: { message: "response_format json_schema is not supported" } }]);
        queue.push(answer(`\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``));
        assert.deepEqual(await readWithEndpoint({ url, model: "m" }, "idea"), ANSWER);
        assert.deepEqual(
            asked.map((a) => a.body.response_format.type),
            ["json_schema", "json_object"],
        );
    });

    it("explains a refusal in a few words", async () => {
        reset();
        queue.push([401, { error: { message: "Invalid API Key" } }]);
        await assert.rejects(readWithEndpoint({ url, model: "m" }, "idea"), /401 Invalid API Key/);
    });

    it("rejects an answer that does not fit the form", async () => {
        reset();
        queue.push(answer("I'd suggest something chill!"));
        await assert.rejects(readWithEndpoint({ url, model: "m" }, "idea"), /did not fit the form/);
    });
});

describe("failures", () => {
    it("say what happened, even when the model's worker sends plain text", () => {
        assert.equal(asError("Error: GPU device was lost").message, "GPU device was lost");
        assert.equal(asError(new Error("timeout")).message, "timeout");
        for (const silent of [undefined, null, "", {}, new Error("")]) {
            assert.equal(asError(silent).message, "the model failed without saying why", String(silent));
        }
    });
});

describe("waiting for an answer", () => {
    const never = () => new Promise(() => {});

    it("passes the answer on and stops nothing", async () => {
        const stops = [];
        assert.equal(await answerWithin(Promise.resolve("reading"), 1, undefined, (why) => stops.push(why)), "reading");
        await assert.rejects(
            answerWithin(Promise.reject(new Error("bad form")), 1, undefined, () => {}),
            /bad form/,
        );
        assert.deepEqual(stops, []);
    });

    it("gives up on an answer that hangs and says so", async () => {
        const stops = [];
        await assert.rejects(
            answerWithin(never(), 0.02, undefined, (why) => stops.push(why)),
            /no answer after 0.02 seconds/,
        );
        assert.deepEqual(stops, ["timeout"]);
    });

    it("gives up when a newer idea comes in, before or while it waits", async () => {
        const stops = [];
        const controller = new AbortController();
        const waiting = answerWithin(never(), 1, controller.signal, (why) => stops.push(why));
        controller.abort();
        await assert.rejects(waiting, { name: "AbortError" });
        await assert.rejects(
            answerWithin(never(), 1, controller.signal, (why) => stops.push(why)),
            { name: "AbortError" },
        );
        assert.deepEqual(stops, ["abort", "abort"]);
    });

    it("leaves no timer behind once answered", async () => {
        const stops = [];
        await answerWithin(Promise.resolve("reading"), 0.02, undefined, (why) => stops.push(why));
        await new Promise((resolve) => setTimeout(resolve, 40));
        assert.deepEqual(stops, []);
    });
});

describe("loading the model", () => {
    const never = () => new Promise(() => {});
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    it("waits as long as it keeps moving, longer than any one silence allows", async () => {
        const loaded = await whileMoving(
            async (moved) => {
                for (let i = 0; i < 5; i++) {
                    await pause(15);
                    moved();
                }
                return "engine";
            },
            { first: 0.03, next: 0.03 },
            "loading the model",
        );
        assert.equal(loaded, "engine");
    });

    it("gives up when nothing comes at all, as when the worker never hears the request", async () => {
        await assert.rejects(
            whileMoving(never, { first: 0.02, next: 1 }, "loading the model"),
            /loading the model stopped: nothing moved for 0.02 seconds/,
        );
    });

    it("gives up when it stops moving halfway", async () => {
        await assert.rejects(
            whileMoving(
                async (moved) => {
                    moved();
                    return never();
                },
                { first: 1, next: 0.02 },
                "loading the model",
            ),
            /nothing moved for 0.02 seconds/,
        );
    });

    it("passes a failure on as it is, and leaves no timer behind", async () => {
        await assert.rejects(
            whileMoving(() => Promise.reject(new Error("cache full")), { first: 0.02, next: 0.02 }, "loading"),
            /cache full/,
        );
        assert.equal(await whileMoving(async () => "engine", { first: 0.02, next: 0.02 }, "loading"), "engine");
        await pause(40);
    });
});

describe("a lost GPU", () => {
    /** An attempt that fails with each of `errors` in turn, then answers. */
    const flaky = (...errors) => {
        let calls = 0;
        const attempt = async () => {
            const error = errors[calls++];
            if (error) throw error;
            return "reading";
        };
        return { attempt, calls: () => calls };
    };

    it("loads the model again and retries once", async () => {
        let resets = 0;
        const { attempt, calls } = flaky("OperationError: A valid external Instance reference no longer exists.");
        assert.equal(await onLiveGpu(attempt, () => ++resets > 0), "reading");
        assert.equal(resets, 1);
        assert.equal(calls(), 2);
    });

    it("says what to do when the GPU goes twice", async () => {
        const { attempt } = flaky(new Error("Device was lost"), new Error("GPU device lost"));
        await assert.rejects(
            onLiveGpu(attempt, () => true),
            /dropped the model; restart the browser/,
        );
    });

    it("gives up at once when the visit already used its retry", async () => {
        const { attempt, calls } = flaky(new Error("Device was lost"));
        await assert.rejects(
            onLiveGpu(attempt, () => false),
            /dropped the model; restart the browser/,
        );
        assert.equal(calls(), 1);
    });

    it("does not retry other failures", async () => {
        let resets = 0;
        const { attempt, calls } = flaky(new Error("the answer did not fit the form"));
        await assert.rejects(
            onLiveGpu(attempt, () => ++resets > 0),
            /did not fit the form/,
        );
        assert.equal(resets, 0);
        assert.equal(calls(), 1);
    });
});

describe("the in-browser model", () => {
    it("explains what keeps it from running", () => {
        // Never advice that breaks the player's everyday browser: Vulkan only in a separate profile.
        for (const support of [
            { gpu: false, software: true },
            { gpu: false, software: false },
        ]) {
            const problem = webgpuProblem(support);
            assert.match(problem, support.software ? /runs on the processor/ : /no WebGPU/);
            assert.match(problem, /separate browser profile.*breaks video.*not in your everyday one/);
            assert.doesNotMatch(problem, /chrome:\/\/flags/);
        }
        assert.equal(webgpuProblem({ gpu: true, software: false }), "");
    });

    it("runs in a worker that listens before anything slow loads, so the request for the model is not lost", () => {
        // The code without its comments, which may well talk about imports and awaits.
        const source = (name) =>
            readFileSync(join(import.meta.dirname, "..", "src", name), "utf8").replace(
                /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm,
                "",
            );
        const imports = (text) => [...text.matchAll(/^\s*import\b[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[1]);
        assert.deepEqual(imports(source("ai-worker.js")), ["./webllm.js"]);
        assert.deepEqual(imports(source("webllm.js")), []);
        assert.doesNotMatch(source("webllm.js"), /\bawait\b/);
    });

    it("is cached by the service worker under the same pinned URL", () => {
        const sw = readFileSync(join(import.meta.dirname, "..", "sw.js"), "utf8");
        assert.ok(sw.includes(`const WEBLLM_URL = "${WEBLLM_URL}";`), "sw.js and src/ai.js pin different builds");
        assert.match(WEBLLM_URL, /@\d+\.\d+\.\d+\/\+esm$/, "an exact version");
    });
});
