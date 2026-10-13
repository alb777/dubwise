// Runs tests/browser/check.html in a headless Chromium-based browser over the DevTools protocol and
// prints its JSON result. Exits non-zero when the check fails.
// Usage: node tests/browser/run.mjs [browser-binary]
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const BROWSER = process.argv[2] ?? process.env.BROWSER ?? "brave";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".txt": "text/plain" };

const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname));
    try {
        const body = await readFile(join(ROOT, path));
        response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
        response.end(body);
    } catch {
        response.writeHead(404).end();
    }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const page = `http://127.0.0.1:${server.address().port}/tests/browser/check.html`;

const browser = spawn(BROWSER, ["--headless=new", "--disable-gpu", "--remote-debugging-port=0", "about:blank"], {
    stdio: ["ignore", "ignore", "pipe"],
});
const endpoint = await new Promise((resolve, reject) => {
    browser.stderr.on("data", (chunk) => {
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(String(chunk));
        if (match) resolve(match[1]);
    });
    browser.on("exit", (code) => reject(new Error(`browser exited with ${code}`)));
});

const socket = new WebSocket(endpoint);
await new Promise((resolve) => socket.addEventListener("open", resolve));
let nextId = 0;
const pending = new Map();
const logs = [];
socket.addEventListener("message", (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
        pending.get(data.id)(data);
        pending.delete(data.id);
    }
    if (data.method === "Runtime.exceptionThrown") logs.push(data.params.exceptionDetails.exception?.description);
    if (data.method === "Runtime.consoleAPICalled")
        logs.push(data.params.args.map((a) => a.value ?? a.description).join(" "));
});
const send = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

const { result: target } = await send("Target.createTarget", { url: "about:blank" });
const { result: attached } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
const session = attached.sessionId;
await send("Runtime.enable", {}, session);
await send("Page.navigate", { url: page }, session);

let output = "pending";
for (let i = 0; i < 120 && output === "pending"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const reply = await send(
        "Runtime.evaluate",
        { expression: "document.getElementById('result')?.textContent ?? 'pending'", returnByValue: true },
        session,
    );
    output = reply.result?.result?.value ?? "pending";
}

browser.kill();
server.close();
if (logs.length) console.error(logs.join("\n"));
console.log(output);
const ok = output !== "pending" && JSON.parse(output).ok === true;
process.exit(ok ? 0 : 1);
