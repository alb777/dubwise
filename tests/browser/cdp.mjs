// Drives a headless Chromium-based browser over the DevTools protocol against a local static server.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..");
const TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".txt": "text/plain",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
};

/** Static file server for the repo on a random local port. */
async function serve() {
    const server = createServer(async (request, response) => {
        let path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname));
        if (path.endsWith("/")) path += "index.html";
        try {
            const body = await readFile(join(ROOT, path));
            response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
            response.end(body);
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return server;
}

/**
 * Open `path` in a fresh headless browser and hand `fn` a small page API.
 * @param {string} path page path from the repo root, such as "/" or "/tests/browser/check.html", or a full URL
 * @param {(page: { evaluate: (expression: string) => Promise<any>, send: (method: string, params?: object) => Promise<any>, on: (method: string, handler: (params: any) => void) => void, errors: string[], wait: (ms: number) => Promise<void> }) => Promise<void>} fn
 * @param {{ setup?: (send: (method: string, params?: object) => Promise<any>) => Promise<void> }} [options]
 *   `setup` runs after the tab opens and before it navigates, for viewport sizes and injected scripts
 */
export async function withPage(path, fn, options = {}) {
    const server = await serve();
    const browser = spawn(
        process.env.BROWSER ?? "brave",
        [
            "--headless=new",
            "--disable-gpu",
            "--autoplay-policy=no-user-gesture-required",
            "--remote-debugging-port=0",
            "about:blank",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
    );
    try {
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
        const errors = [];
        /** @type {Map<string, (params: any) => void>} */
        const listeners = new Map();
        socket.addEventListener("message", (message) => {
            const data = JSON.parse(message.data);
            if (data.method && listeners.has(data.method)) listeners.get(data.method)(data.params);
            if (data.id && pending.has(data.id)) {
                pending.get(data.id)(data);
                pending.delete(data.id);
            }
            if (data.method === "Runtime.exceptionThrown") {
                errors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text);
            }
            if (data.method === "Runtime.consoleAPICalled" && data.params.type === "error") {
                errors.push(data.params.args.map((a) => a.value ?? a.description).join(" "));
            }
        });
        let sessionId;
        const send = (method, params = {}) =>
            new Promise((resolve, reject) => {
                const id = ++nextId;
                pending.set(id, (data) => (data.error ? reject(new Error(data.error.message)) : resolve(data.result)));
                socket.send(JSON.stringify({ id, method, params, sessionId }));
            });
        const { targetId } = await send("Target.createTarget", { url: "about:blank" });
        ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
        await send("Runtime.enable");
        await send("Page.enable");
        await options.setup?.(send);
        const url = /^https?:/.test(path) ? path : `http://127.0.0.1:${server.address().port}${path}`;
        await send("Page.navigate", { url });
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        await wait(800);
        const evaluate = async (expression) => {
            const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description);
            return reply.result.value;
        };
        const on = (method, handler) => listeners.set(method, handler);
        await fn({ evaluate, send, on, errors, wait });
        socket.close();
    } finally {
        browser.kill();
        server.close();
    }
}
