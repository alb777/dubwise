import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { READING_SCHEMA } from "../skills/dubwise/scripts/intent.mjs";
import { readWithEndpoint, WEBLLM_URL } from "../src/ai.js";

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

describe("the in-browser model", () => {
    it("is cached by the service worker under the same pinned URL", () => {
        const sw = readFileSync(join(import.meta.dirname, "..", "sw.js"), "utf8");
        assert.ok(sw.includes(`const WEBLLM_URL = "${WEBLLM_URL}";`), "sw.js and src/ai.js pin different builds");
        assert.match(WEBLLM_URL, /@\d+\.\d+\.\d+\/\+esm$/, "an exact version");
    });
});
