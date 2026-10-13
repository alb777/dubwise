// @ts-check
/**
 * The optional AI reader. It reads ideas the composer's word lists do not cover and answers the form in
 * skills/dubwise/scripts/intent.mjs. It stays off until the player picks one of these:
 *   browser   an open model (Qwen3.5, Apache-2.0) run by WebLLM on WebGPU, downloaded once and then offline
 *   chrome    the model built into Chrome, when this browser has one
 *   endpoint  any OpenAI-compatible chat API: Ollama or LM Studio on this computer, or an online service
 * The choice lives in localStorage. An API key only lives in sessionStorage, so it leaves with the tab.
 */
import { READING_SCHEMA, readingMessages, sanitizeReading } from "../skills/dubwise/scripts/intent.mjs";

/** @typedef {import("../skills/dubwise/scripts/intent.mjs").Reading} Reading */
/** @typedef {"off" | "browser" | "chrome" | "endpoint"} Provider */
/** @typedef {keyof typeof BROWSER_MODELS} ModelSize */
/** @typedef {{ provider: Provider, size: ModelSize, url: string, model: string }} Settings */
/** @typedef {(fraction: number, text: string) => void} Progress */

/** The WebLLM build, pinned. sw.js caches this same URL for offline use; a test keeps the two in step. */
export const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm";

/** Models for the browser, with and without 16-bit float shaders, which not every GPU offers. */
export const BROWSER_MODELS = {
    better: { name: "Qwen3.5 2B", download: "1.1 GB", f16: "Qwen3.5-2B-q4f16_1-MLC", f32: "Qwen3.5-2B-q4f32_1-MLC" },
    small: {
        name: "Qwen3.5 0.8B",
        download: "0.45 GB",
        f16: "Qwen3.5-0.8B-q4f16_1-MLC",
        f32: "Qwen3.5-0.8B-q4f32_1-MLC",
    },
};

/** Ready-made addresses for OpenAI-compatible services. The model name is the player's to fill in. */
export const ENDPOINTS = {
    ollama: { name: "Ollama on this computer", url: "http://localhost:11434/v1", key: false },
    lmstudio: { name: "LM Studio on this computer", url: "http://localhost:1234/v1", key: false },
    groq: { name: "Groq", url: "https://api.groq.com/openai/v1", key: true },
    openrouter: { name: "OpenRouter", url: "https://openrouter.ai/api/v1", key: true },
    gemini: { name: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai", key: true },
};

const SETTINGS_KEY = "dubwise-ai";
const API_KEY = "dubwise-ai-key";
/** @type {Settings} */
export const DEFAULT_SETTINGS = { provider: "off", size: "better", url: ENDPOINTS.ollama.url, model: "" };

/** Storage can be blocked, as in some private windows; the AI then just forgets between visits. */
const storage = {
    /** @param {Storage | undefined} area @param {string} key */
    get: (area, key) => {
        try {
            return area?.getItem(key) ?? null;
        } catch {
            return null;
        }
    },
    /** @param {Storage | undefined} area @param {string} key @param {string | null} value */
    set: (area, key, value) => {
        try {
            if (value === null) area?.removeItem(key);
            else area?.setItem(key, value);
        } catch {
            // Nothing to do: the setting holds for this visit only.
        }
    },
};

/** @returns {Settings} */
export function loadSettings() {
    try {
        const saved = JSON.parse(storage.get(globalThis.localStorage, SETTINGS_KEY) ?? "{}");
        const settings = { ...DEFAULT_SETTINGS, ...saved };
        if (!["off", "browser", "chrome", "endpoint"].includes(settings.provider)) settings.provider = "off";
        if (!(settings.size in BROWSER_MODELS)) settings.size = DEFAULT_SETTINGS.size;
        return settings;
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

/** @param {Settings} settings */
export function saveSettings(settings) {
    storage.set(globalThis.localStorage, SETTINGS_KEY, JSON.stringify(settings));
}

export const loadKey = () => storage.get(globalThis.sessionStorage, API_KEY) ?? "";
/** @param {string} key */
export const saveKey = (key) => storage.set(globalThis.sessionStorage, API_KEY, key || null);

/** The short reason in an error body, if the server sent one. @param {Response} response */
async function failure(response) {
    const text = await response.text().catch(() => "");
    let detail = text;
    try {
        const body = JSON.parse(text);
        detail = body?.error?.message ?? body?.message ?? text;
    } catch {
        // Not JSON: keep the text.
    }
    return new Error(`${response.status} ${String(detail).slice(0, 160)}`.trim());
}

/**
 * Ask an OpenAI-compatible chat API to read an idea. It asks for the JSON schema first and falls back to plain JSON
 * mode for servers that turn schemas down with a 400.
 * @param {{ url: string, model: string, key?: string }} endpoint
 * @param {string} idea @param {AbortSignal} [signal]
 * @returns {Promise<Reading>}
 */
export async function readWithEndpoint({ url, model, key }, idea, signal) {
    const formats = [
        { type: "json_schema", json_schema: { name: "riddim_reading", strict: true, schema: READING_SCHEMA } },
        { type: "json_object" },
    ];
    for (const [i, format] of formats.entries()) {
        const response = await fetch(`${url.replace(/\/+$/, "")}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
            body: JSON.stringify({ model, temperature: 0, messages: readingMessages(idea), response_format: format }),
            signal,
        });
        if (response.status === 400 && i < formats.length - 1) continue;
        if (!response.ok) throw await failure(response);
        const body = await response.json();
        const reading = sanitizeReading(body?.choices?.[0]?.message?.content);
        if (!reading) throw new Error("the answer did not fit the form");
        return reading;
    }
    throw new Error("the server took no JSON format");
}

// ----- the built-in Chrome model

const CHROME_LANGUAGES = {
    expectedInputs: [{ type: "text", languages: ["en", "es"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
};
/** @type {any} */
let chromeSession = null;

/** "available", "downloadable", "downloading" or "unavailable". @returns {Promise<string>} */
export async function chromeAvailability() {
    const model = /** @type {any} */ (globalThis).LanguageModel;
    if (!model) return "unavailable";
    try {
        return await model.availability(CHROME_LANGUAGES);
    } catch {
        return "unavailable";
    }
}

/** @param {string} idea @param {AbortSignal} [signal] @param {Progress} [onProgress] @returns {Promise<Reading>} */
async function readWithChrome(idea, signal, onProgress) {
    const model = /** @type {any} */ (globalThis).LanguageModel;
    if (!model) throw new Error("this browser has no built-in model");
    const [system, ...examples] = readingMessages(idea).slice(0, -1);
    chromeSession ??= await model.create({
        ...CHROME_LANGUAGES,
        initialPrompts: [system, ...examples],
        /** @param {EventTarget} monitor */
        monitor: (monitor) =>
            monitor.addEventListener("downloadprogress", (event) =>
                onProgress?.(/** @type {any} */ (event).loaded, "downloading Chrome's model"),
            ),
    });
    const session = await chromeSession.clone();
    try {
        const answer = await session.prompt(`Idea: ${idea}`, { responseConstraint: READING_SCHEMA, signal });
        const reading = sanitizeReading(answer);
        if (!reading) throw new Error("the answer did not fit the form");
        return reading;
    } finally {
        session.destroy();
    }
}

// ----- the open model in this browser

/** @type {{ size: ModelSize, engine: Promise<any>, stop: () => void } | null} */
let browserModel = null;

/**
 * Whether WebGPU runs on a graphics card here, and whether it offers 16-bit floats. `software` means it only runs on
 * the processor, as Chrome and Brave on Linux do with #enable-unsafe-webgpu but without Vulkan: far too slow for the
 * model, and the browser's GPU watchdog kills it.
 * @returns {Promise<{ gpu: boolean, f16: boolean, software: boolean }>}
 */
export async function webgpuSupport() {
    const gpu = /** @type {any} */ (navigator).gpu;
    const adapter = gpu ? await gpu.requestAdapter({ powerPreference: "high-performance" }).catch(() => null) : null;
    const software = Boolean(adapter?.info?.isFallbackAdapter ?? adapter?.isFallbackAdapter);
    return { gpu: Boolean(adapter) && !software, f16: Boolean(adapter?.features.has("shader-f16")), software };
}

/** What stops the in-browser model from running here, or "" when nothing does. @param {{ gpu: boolean, software: boolean }} support */
export function webgpuProblem({ gpu, software }) {
    if (software)
        return "WebGPU here runs on the processor, not the graphics card, far too slow for the model; in Chrome or Brave on Linux turn on chrome://flags/#enable-vulkan too, or pick a server";
    if (!gpu)
        return "this browser has no WebGPU; in Chrome or Brave on Linux turn on chrome://flags/#enable-unsafe-webgpu and #enable-vulkan, or pick a server";
    return "";
}

/**
 * Load the open model, downloading it the first time. It runs in a worker, so the riddim keeps time while it thinks.
 * @param {ModelSize} size @param {Progress} [onProgress]
 */
export function loadBrowserModel(size, onProgress) {
    if (browserModel?.size === size) return browserModel.engine;
    /** @type {Worker | undefined} */
    let worker;
    const engine = (async () => {
        const support = await webgpuSupport();
        const problem = webgpuProblem(support);
        if (problem) throw new Error(problem);
        const { f16 } = support;
        const webllm = await import(WEBLLM_URL);
        worker = new Worker(new URL("./ai-worker.js", import.meta.url), { type: "module" });
        const id = f16 ? BROWSER_MODELS[size].f16 : BROWSER_MODELS[size].f32;
        try {
            const engine = await webllm.CreateWebWorkerMLCEngine(worker, id, {
                /** @param {{ progress: number, text: string }} report */
                initProgressCallback: (report) => onProgress?.(report.progress, report.text),
            });
            // The GPU compiles its shaders on the first answer, about ten seconds. A two-token answer in the same
            // form does that now, so the first real idea is read in two or three seconds.
            onProgress?.(1, "warming up");
            await engine.chat.completions.create(request("warm up", 2));
            return engine;
        } catch (error) {
            worker?.terminate();
            // A download cut short surfaces as a cache or fetch error; say what it means instead.
            if (/cache|fetch|network/i.test(String(error)))
                throw new Error(
                    "the model could not be downloaded, the connection dropped; try again later or pick a server",
                );
            throw error instanceof Error ? error : new Error(String(error));
        }
    })();
    browserModel = { size, engine, stop: () => worker?.terminate() };
    engine.catch(() => {
        if (browserModel?.engine === engine) browserModel = null;
    });
    return engine;
}

/** Chrome turns the GPU off for good after a few crashes in a short time, so a lost GPU is tried again once a visit. */
let gpuRetries = 1;

/** Let go of the loaded model and its worker, as when the GPU that held them is gone; say whether to try again. */
function dropBrowserModel() {
    browserModel?.stop();
    browserModel = null;
    return gpuRetries-- > 0;
}

/** What browsers say when the GPU, and every model on it, is gone. */
const LOST_GPU = /instance reference no longer exists|device (was |is )?lost|devicelost|instancedropped/i;

/**
 * Run a request on the in-browser model. If the GPU was lost on the way, as when the browser restarts its graphics
 * process, `reset` starts again from the cache and says whether one more try is allowed.
 * @template T @param {() => Promise<T>} attempt @param {() => boolean} reset @returns {Promise<T>}
 */
export async function onLiveGpu(attempt, reset) {
    const lost = new Error(
        "the graphics card dropped the model; restart the browser, try the lighter model or pick a server",
    );
    try {
        return await attempt();
    } catch (error) {
        if (!LOST_GPU.test(String(error))) throw error;
        if (!reset()) throw lost;
    }
    try {
        return await attempt();
    } catch (error) {
        if (!LOST_GPU.test(String(error))) throw error;
        throw lost;
    }
}

/**
 * Load and warm the in-browser model ahead of the first idea, starting again once if the GPU is lost on the way.
 * @param {ModelSize} size @param {Progress} [onProgress]
 */
export function prepareBrowserModel(size, onProgress) {
    return onLiveGpu(() => loadBrowserModel(size, onProgress), dropBrowserModel);
}

/**
 * A reading request for the in-browser model. An answer takes about 75 tokens; a cap of 120 also stops Qwen3.5's habit
 * of padding JSON with spaces until the limit.
 * @param {string} idea @param {number} tokens
 */
function request(idea, tokens) {
    return {
        messages: readingMessages(idea),
        temperature: 0,
        max_tokens: tokens,
        response_format: { type: "json_object", schema: JSON.stringify(READING_SCHEMA) },
        extra_body: { enable_thinking: false },
    };
}

/** Whether a model is already downloaded, so turning it on costs no data. @param {ModelSize} size */
export async function browserModelCached(size) {
    try {
        const { f16 } = await webgpuSupport();
        const webllm = await import(WEBLLM_URL);
        return Boolean(await webllm.hasModelInCache(f16 ? BROWSER_MODELS[size].f16 : BROWSER_MODELS[size].f32));
    } catch {
        return false;
    }
}

/** @param {ModelSize} size @param {string} idea @param {Progress} [onProgress] @returns {Promise<Reading>} */
async function readWithBrowser(size, idea, onProgress) {
    const reply = await onLiveGpu(async () => {
        const engine = await loadBrowserModel(size, onProgress);
        return engine.chat.completions.create(request(idea, 120));
    }, dropBrowserModel);
    const reading = sanitizeReading(reply?.choices?.[0]?.message?.content);
    if (!reading) throw new Error("the answer did not fit the form");
    return reading;
}

// ----- one way in

/** Errors from the model's worker arrive as plain text; make every failure an Error that says what happened. @param {unknown} error */
export function asError(error) {
    if (error instanceof Error && error.message) return error;
    const text = String(error ?? "")
        .replace(/^Error\b:?\s*/, "")
        .trim();
    return new Error(text && text !== "[object Object]" ? text : "the model failed without saying why");
}

/** Readings already made, so "again" and repeated ideas ask once. @type {Map<string, Reading>} */
const readings = new Map();

/**
 * Read an idea with the chosen provider.
 * @param {Settings} settings @param {string} idea
 * @param {{ signal?: AbortSignal, onProgress?: Progress }} [options]
 * @returns {Promise<Reading>}
 */
export async function readIdea(settings, idea, { signal, onProgress } = {}) {
    const memo = `${settings.provider} ${settings.size} ${settings.url} ${settings.model} ${idea.trim().toLowerCase()}`;
    const known = readings.get(memo);
    if (known) return known;
    let reading;
    try {
        reading = await readWith(settings, idea, signal, onProgress);
    } catch (error) {
        throw asError(error);
    }
    readings.set(memo, reading);
    return reading;
}

/** @param {Settings} settings @param {string} idea @param {AbortSignal} [signal] @param {Progress} [onProgress] */
function readWith(settings, idea, signal, onProgress) {
    if (settings.provider === "endpoint") {
        if (!settings.model) throw new Error("name the model to use");
        const timeout = AbortSignal.timeout(60_000);
        return readWithEndpoint(
            { url: settings.url, model: settings.model, key: loadKey() },
            idea,
            signal ? AbortSignal.any([signal, timeout]) : timeout,
        );
    }
    if (settings.provider === "browser") return readWithBrowser(settings.size, idea, onProgress);
    if (settings.provider === "chrome") return readWithChrome(idea, signal, onProgress);
    throw new Error("the AI is off");
}
