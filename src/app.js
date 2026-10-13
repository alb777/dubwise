// @ts-check
/**
 * The dubwise page: step grid, channel strips, effects, siren pad, the console, colour themes, the guide and the
 * optional AI reader.
 * Every change, from a grid click, a slider or a console line, goes through commit(),
 * which updates the engine, the shareable URL and the screen together.
 */

import { compose, readIntent } from "../skills/dubwise/scripts/composer.mjs";
import {
    chordAt,
    DRUMS,
    emptyRiddim,
    fromHash,
    parse,
    SPEC,
    STEPS_PER_BAR,
    serialize,
    setLine,
    stepAt,
    toHash,
} from "../skills/dubwise/scripts/notation.mjs";
import {
    BROWSER_MODELS,
    browserModelCached,
    chromeAvailability,
    ENDPOINTS,
    loadKey,
    loadSettings,
    prepareBrowserModel,
    readIdea,
    saveKey,
    saveSettings,
    webgpuProblem,
    webgpuSupport,
} from "./ai.js";
import { aiPrompt, CHANNELS, COMMANDS, PRESETS, parseCommand, THEMES } from "./console.js";
import { createEngine } from "./engine.js";
import { GUIDE } from "./guide.js";
import { applyRiddim, createSequencer } from "./sequencer.js";

/** @typedef {import("../skills/dubwise/scripts/notation.mjs").Riddim} Riddim */
/** @typedef {import("../skills/dubwise/scripts/notation.mjs").ParseError} ParseError */
/** @typedef {import("./engine.js").Engine} Engine */
/** @typedef {import("./console.js").Channel} Channel */
/** @typedef {import("./ai.js").Settings} AISettings */
/** @typedef {import("../skills/dubwise/scripts/intent.mjs").Reading} Reading */

const FROM_LINK = "from-link";
const CUSTOM = "custom";
const THEME_KEY = "dubwise-theme";

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
const byId = (id) => /** @type {T} */ (document.getElementById(id));

const ui = {
    play: byId("play"),
    bpm: /** @type {HTMLInputElement} */ (byId("bpm")),
    keyinfo: byId("keyinfo"),
    preset: /** @type {HTMLSelectElement} */ (byId("preset")),
    share: byId("share"),
    bars: byId("bars"),
    grid: byId("grid"),
    strips: byId("strips"),
    echoTime: /** @type {HTMLSelectElement} */ (byId("echo-time")),
    feedback: /** @type {HTMLInputElement} */ (byId("feedback")),
    spring: /** @type {HTMLInputElement} */ (byId("spring")),
    filter: /** @type {HTMLInputElement} */ (byId("filter")),
    volume: /** @type {HTMLInputElement} */ (byId("volume")),
    siren: byId("siren"),
    log: byId("log"),
    prompt: /** @type {HTMLFormElement} */ (byId("prompt")),
    command: /** @type {HTMLTextAreaElement} */ (byId("command")),
    theme: byId("theme"),
    themeMenu: byId("theme-menu"),
    guide: byId("guide"),
    guideToggle: byId("guide-toggle"),
    guideClose: byId("guide-close"),
    guideSteps: byId("guide-steps"),
    aiToggle: byId("ai-toggle"),
    aiDialog: /** @type {HTMLDialogElement} */ (byId("ai-dialog")),
    aiForm: /** @type {HTMLFormElement} */ (byId("ai-form")),
    aiChrome: byId("ai-chrome"),
    aiNote: byId("ai-note"),
    aiStatus: byId("ai-status"),
    aiProgress: /** @type {HTMLProgressElement} */ (byId("ai-progress")),
    aiTry: byId("ai-try"),
};

const state = {
    riddim: emptyRiddim(),
    text: serialize(emptyRiddim()),
    bar: 0,
    follow: true,
    step: -1,
    /** @type {Set<Channel>} */
    muted: new Set(),
    /** @type {Channel | null} */
    solo: null,
    /** @type {string[]} */
    history: [],
    historyAt: 0,
    /** Riddim texts to go back to, newest last. @type {string[]} */
    undo: [],
    lastRequest: "",
    take: 0,
    /** The AI's reading of the last idea, kept for "again". @type {Reading | null} */
    reading: null,
    /** Whether the player was told about the AI reader yet, which happens once a visit. */
    toldAboutAI: false,
    ai: loadSettings(),
};

/** @type {Engine | null} */
let engine = null;
/** @type {ReturnType<typeof createSequencer> | null} */
let sequencer = null;
/** Steps scheduled ahead of time, shown when the audio clock reaches them. @type {{ step: number, time: number }[]} */
const stepQueue = [];

// ----- audio

/** Audio needs a user gesture, so the engine starts on the first press. */
function audio() {
    if (!engine) {
        const live = createEngine(new AudioContext({ latencyHint: "interactive" }));
        live.setVolume(Number(ui.volume.value));
        live.setFilter(Number(ui.filter.value));
        applyRiddim(live, state.riddim);
        engine = live;
        applyMix();
        sequencer = createSequencer(
            live,
            () => state.riddim,
            (step, time) => stepQueue.push({ step, time }),
        );
    }
    if (engine.context instanceof AudioContext) void engine.context.resume();
    return engine;
}

function togglePlay() {
    audio();
    if (sequencer?.playing) {
        sequencer.stop();
        stepQueue.length = 0;
        state.step = -1;
        renderPlayhead();
    } else {
        sequencer?.start();
    }
    const playing = Boolean(sequencer?.playing);
    ui.play.textContent = playing ? "stop" : "play";
    ui.play.setAttribute("aria-pressed", String(playing));
}

function applyMix() {
    for (const channel of CHANNELS) {
        const off = state.muted.has(channel) || (state.solo !== null && state.solo !== channel);
        engine?.setMute(channel, off);
    }
    renderStrips();
}

// ----- riddim state

/** @type {ReturnType<typeof setTimeout> | undefined} */
let hashTimer;

/** @param {Riddim} riddim */
function commit(riddim) {
    // Any change makes this a custom riddim; loading a preset or a link relabels it right after.
    if (!ui.preset.querySelector(`option[value="${CUSTOM}"]`)) ui.preset.add(new Option("custom", CUSTOM), 0);
    ui.preset.value = CUSTOM;
    state.riddim = riddim;
    state.text = serialize(riddim);
    state.bar = Math.min(state.bar, riddim.bars - 1);
    if (engine) applyRiddim(engine, riddim);
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => history.replaceState(null, "", toHash(state.text)), 250);
    render();
}

/** Keep the current riddim so "undo" can bring it back. */
function remember() {
    state.undo.push(state.text);
    if (state.undo.length > 50) state.undo.shift();
}

/** Compose the last idea at the current take, with the AI's reading if there is one, load it and start playing. */
function composeAndPlay() {
    const result = compose(state.lastRequest, state.take, state.reading);
    if (!result.understood) return print(result.summary, "err");
    remember();
    loadText(result.text);
    print(result.summary, "ok");
    print('"again" for another version, "undo" to go back, "show" for the notation', "dim");
    if (state.ai.provider === "off" && result.intent.unknown.length && !state.toldAboutAI) {
        state.toldAboutAI = true;
        print('an AI can read ideas like this one: open ✦ ai at the top, or type "ai"', "dim");
    }
    if (!sequencer?.playing) togglePlay();
}

/** The AI request in flight, dropped when a newer idea comes in. @type {AbortController | null} */
let asking = null;

/**
 * Compose a new idea. With the AI reader on, words the word lists do not know go to it first; `ai <idea>` asks
 * even when every word is known. If the AI fails, the idea is composed from dubwise's own reading.
 * @param {string} request @param {boolean} [askAnyway]
 */
async function composeIdea(request, askAnyway = false) {
    // Wake the audio while the key press still counts as a gesture: the AI can take longer than browsers allow.
    audio();
    asking?.abort();
    state.lastRequest = request;
    state.take = 0;
    state.reading = null;
    const { unknown } = readIntent(request);
    if (state.ai.provider !== "off" && (askAnyway || unknown.length)) {
        // The AI reads only what the word lists miss, so a known name in the same idea does not color its reading.
        const subject = unknown.length ? unknown.join(", ") : request;
        const controller = new AbortController();
        asking = controller;
        const line = print("asking the AI…", "dim");
        setAIState("busy");
        try {
            state.reading = await readIdea(state.ai, subject, {
                signal: controller.signal,
                onProgress: (fraction, text) => {
                    line.textContent = `loading the AI model, ${Math.round(fraction * 100)}% (${text.slice(0, 60)})`;
                },
            });
            setAIState("on");
            line.remove();
        } catch (error) {
            if (controller.signal.aborted) return;
            setAIState("error");
            line.remove();
            print(
                `the AI could not read it (${/** @type {Error} */ (error).message}), so dubwise used its own reading`,
                "err",
            );
        } finally {
            if (asking === controller) asking = null;
        }
    }
    composeAndPlay();
}

/** @param {string} text @returns {boolean} */
function loadText(text) {
    const result = parse(text);
    if (!result.riddim) {
        printErrors(result.errors);
        return false;
    }
    state.bar = 0;
    commit(result.riddim);
    return true;
}

/** @param {string} name */
async function loadPreset(name) {
    const response = await fetch(`skills/dubwise/assets/riddims/${name}.txt`);
    if (!response.ok) return print(`could not load preset ${name}`, "err");
    if (loadText(await response.text())) ui.preset.value = name;
}

function loadFromLink() {
    const text = fromHash(location.hash);
    if (text === null || text.trim() === state.text.trim()) return text !== null;
    if (!ui.preset.querySelector(`option[value="${FROM_LINK}"]`)) ui.preset.add(new Option("from link", FROM_LINK), 0);
    if (loadText(text)) ui.preset.value = FROM_LINK;
    return true;
}

/**
 * The line of the current riddim text for one setting, for editing in the console.
 * @param {string} name
 */
function currentLine(name) {
    const line = state.text.split("\n").find((l) => l.split(/\s+/)[0] === name);
    if (line) return line.replace(/\s+/, " ");
    if (name === "bass") return `bass ${Array(STEPS_PER_BAR).fill(".").join(" ")}`;
    if (name === "chords") return "chords 1";
    return `${name} ${".".repeat(STEPS_PER_BAR)}`;
}

/**
 * Toggle a drum step. A pattern shorter than the riddim is unrolled first, so the edit hits one bar only.
 * @param {typeof DRUMS[number]} drum @param {number} step @param {boolean} clear
 */
function editStep(drum, step, clear) {
    const riddim = structuredClone(state.riddim);
    const length = riddim.bars * STEPS_PER_BAR;
    const steps = riddim.drums[drum];
    const full = Array.from({ length }, (_, i) => stepAt(steps, i) ?? 0);
    const cycle = drum === "hat" ? [0, 1, 2, 3] : [0, 1, 2];
    full[step] = clear ? 0 : cycle[(cycle.indexOf(full[step]) + 1) % cycle.length];
    riddim.drums[drum] = full.every((v) => v === 0) ? [] : full;
    remember();
    commit(riddim);
}

// ----- rendering

function render() {
    const { riddim } = state;
    ui.bpm.value = String(riddim.bpm);
    ui.keyinfo.textContent = `${riddim.key.root} ${riddim.key.mode}`;
    const echo = `${riddim.echo.num}/${riddim.echo.den}`;
    if (![...ui.echoTime.options].some((o) => o.value === echo)) ui.echoTime.add(new Option(echo, echo));
    ui.echoTime.value = echo;
    ui.feedback.value = String(riddim.echo.feedback);
    ui.spring.value = String(riddim.spring);
    showOutputs();
    renderBars();
    renderGrid();
}

function showOutputs() {
    /** @param {HTMLInputElement} input @param {string} text */
    const out = (input, text) => {
        const output = input.parentElement?.querySelector("output");
        if (output) output.textContent = text;
    };
    out(ui.feedback, ui.feedback.value);
    out(ui.spring, ui.spring.value);
    out(ui.volume, ui.volume.value);
    const filter = Number(ui.filter.value);
    out(ui.filter, filter === 0 ? "open" : `${filter < 0 ? "dark" : "thin"} ${Math.round(Math.abs(filter) * 100)}`);
}

function renderBars() {
    ui.bars.replaceChildren();
    if (state.riddim.bars < 2) return;
    ui.bars.append("bar");
    for (let bar = 0; bar < state.riddim.bars; bar++) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.textContent = String(bar + 1);
        tab.setAttribute("aria-selected", String(bar === state.bar));
        tab.addEventListener("click", () => {
            state.bar = bar;
            state.follow = false;
            renderBars();
            renderGrid();
        });
        ui.bars.append(tab);
    }
    const follow = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = state.follow;
    box.addEventListener("change", () => {
        state.follow = box.checked;
    });
    follow.append(box, "follow");
    ui.bars.append(follow);
}

/** @param {string} name @param {string} title */
function rowName(name, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row-name";
    button.dataset.setting = name;
    button.textContent = name;
    button.title = title;
    return button;
}

function renderGrid() {
    const { riddim, bar } = state;
    const first = bar * STEPS_PER_BAR;
    const nodes = [];
    for (const drum of DRUMS) {
        nodes.push(rowName(drum, `click to edit the ${drum} line in the console`));
        for (let i = 0; i < STEPS_PER_BAR; i++) {
            const cell = document.createElement("button");
            cell.type = "button";
            cell.className = i % 4 === 0 ? "cell beat" : "cell";
            cell.dataset.drum = drum;
            cell.dataset.step = String(first + i);
            cell.dataset.col = String(i);
            cell.dataset.value = String(stepAt(riddim.drums[drum], first + i) ?? 0);
            cell.setAttribute("aria-label", `${drum} step ${i + 1}`);
            nodes.push(cell);
        }
    }
    nodes.push(rowName("bass", "click to edit the bass line in the console"));
    for (let i = 0; i < STEPS_PER_BAR; i++) {
        const token = stepAt(riddim.bass, first + i) ?? ".";
        const note = document.createElement("div");
        note.className = /[1-7]/.test(token) ? "note on" : "note";
        note.dataset.col = String(i);
        note.textContent = token === "." ? "" : token;
        nodes.push(note);
    }
    nodes.push(rowName("chords", "click to edit the chords in the console"));
    const slots = riddim.chords.length ? riddim.chords[bar % riddim.chords.length].length : 1;
    for (let slot = 0; slot < slots; slot++) {
        const chord = document.createElement("div");
        chord.className = "chord";
        chord.style.gridColumn = `span ${STEPS_PER_BAR / slots}`;
        chord.textContent = riddim.chords.length
            ? (chordAt(riddim.chords, first + (slot * STEPS_PER_BAR) / slots) ?? "")
            : "1";
        nodes.push(chord);
    }
    ui.grid.replaceChildren(...nodes);
    renderPlayhead();
}

function renderPlayhead() {
    const visible = state.step >= 0 && Math.floor(state.step / STEPS_PER_BAR) === state.bar;
    const column = String(state.step % STEPS_PER_BAR);
    for (const node of ui.grid.querySelectorAll("[data-col]")) {
        node.classList.toggle("now", visible && /** @type {HTMLElement} */ (node).dataset.col === column);
    }
}

/** Show each step when the audio clock reaches it. */
function animate() {
    const now = engine?.context.currentTime ?? 0;
    let moved = false;
    while (stepQueue.length && stepQueue[0].time <= now) {
        state.step = /** @type {{ step: number }} */ (stepQueue.shift()).step;
        moved = true;
    }
    if (moved) {
        const bar = Math.floor(state.step / STEPS_PER_BAR);
        if (state.follow && bar !== state.bar) {
            state.bar = bar;
            renderBars();
            renderGrid();
        } else {
            renderPlayhead();
        }
    }
    requestAnimationFrame(animate);
}

function renderStrips() {
    for (const strip of ui.strips.querySelectorAll(".strip")) {
        const channel = /** @type {Channel} */ (/** @type {HTMLElement} */ (strip).dataset.channel);
        strip.querySelector(".mute")?.setAttribute("aria-pressed", String(state.muted.has(channel)));
        strip.querySelector(".solo")?.setAttribute("aria-pressed", String(state.solo === channel));
    }
}

/** @param {HTMLElement} element @param {(on: boolean) => void} action */
function holdable(element, action) {
    element.addEventListener("pointerdown", (event) => {
        element.setPointerCapture(event.pointerId);
        element.classList.add("held");
        action(true);
    });
    for (const type of ["pointerup", "pointercancel"]) {
        element.addEventListener(type, () => {
            if (!element.classList.contains("held")) return;
            element.classList.remove("held");
            action(false);
        });
    }
}

function buildStrips() {
    for (const channel of CHANNELS) {
        const strip = document.createElement("div");
        strip.className = "strip";
        strip.dataset.channel = channel;
        const name = document.createElement("strong");
        name.textContent = channel;
        /** @param {string} className @param {string} label @param {string} title */
        const button = (className, label, title) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = className;
            b.textContent = label;
            b.title = title;
            return b;
        };
        const mute = button("mute", "mute", `mute ${channel}`);
        mute.addEventListener("click", () => setMuted(channel, !state.muted.has(channel)));
        const solo = button("solo", "solo", `hear only ${channel}`);
        solo.addEventListener("click", () => setSolo(state.solo === channel ? null : channel));
        const throwButton = button("throw", "throw", `hold to send ${channel} into the echo`);
        holdable(throwButton, (on) => audio().setThrow(channel, on));
        strip.append(name, mute, solo, throwButton);
        ui.strips.append(strip);
    }
}

/** @param {Channel} channel @param {boolean} on */
function setMuted(channel, on) {
    if (on) state.muted.add(channel);
    else state.muted.delete(channel);
    applyMix();
}

/** @param {Channel | null} channel */
function setSolo(channel) {
    state.solo = channel;
    applyMix();
}

// ----- theme and guide

/** @param {string | undefined} name @returns {name is keyof typeof THEMES} */
function isTheme(name) {
    return name !== undefined && Object.hasOwn(THEMES, name);
}

/** @param {keyof typeof THEMES} name @param {boolean} [save] */
function setTheme(name, save = true) {
    document.documentElement.dataset.theme = name;
    ui.theme.title = `colour theme: ${THEMES[name]}`;
    ui.theme.setAttribute("aria-label", ui.theme.title);
    for (const item of ui.themeMenu.querySelectorAll("button")) {
        item.setAttribute("aria-checked", String(item.dataset.value === name));
    }
    // The browser bar on phones follows the page background.
    const background = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
    if (!save) return;
    try {
        localStorage.setItem(THEME_KEY, name);
    } catch {
        // Storage can be blocked, as in some private windows; the theme still applies to this visit.
    }
}

/** One flag per theme. Each flag carries its own data-theme, so it is drawn by its theme, not the current one. */
function buildThemeMenu() {
    for (const [id, name] of Object.entries(THEMES)) {
        const item = document.createElement("button");
        item.type = "button";
        item.setAttribute("role", "menuitemradio");
        item.dataset.value = id;
        item.title = name;
        item.setAttribute("aria-label", name);
        const flag = document.createElement("span");
        flag.className = "flag";
        flag.dataset.theme = id;
        item.append(flag);
        item.addEventListener("click", () => {
            if (isTheme(id)) setTheme(id);
            showThemeMenu(false, true);
        });
        ui.themeMenu.append(item);
    }
}

const themeMenuOpen = () => !ui.themeMenu.hidden;

/** @param {boolean} open @param {boolean} [focus] on closing, give the focus back to the button */
function showThemeMenu(open, focus = false) {
    ui.themeMenu.hidden = !open;
    ui.theme.setAttribute("aria-expanded", String(open));
    if (open) {
        const checked = ui.themeMenu.querySelector('[aria-checked="true"]');
        /** @type {HTMLElement | null} */ (checked ?? ui.themeMenu.firstElementChild)?.focus();
    } else if (focus) {
        ui.theme.focus();
    }
}

/** Text with the words in backticks shown as code. @param {string} text */
function withCode(text) {
    return text.split("`").map((part, i) => {
        if (i % 2 === 0) return part;
        const code = document.createElement("code");
        code.textContent = part;
        return code;
    });
}

/** Scroll a control into view and make it pulse. @param {string} selector */
function spotlight(selector) {
    const target = /** @type {HTMLElement | null} */ (document.querySelector(selector));
    if (!target) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    target.classList.remove("spotlight");
    void target.offsetWidth; // restarts the pulse when the same control is shown twice in a row
    target.classList.add("spotlight");
    setTimeout(() => target.classList.remove("spotlight"), 2000);
}

function buildGuide() {
    for (const step of GUIDE) {
        const item = document.createElement("li");
        const title = document.createElement("h3");
        title.textContent = step.title;
        const text = document.createElement("p");
        text.append(...withCode(step.text));
        const actions = document.createElement("div");
        actions.className = "guide-actions";
        for (const command of step.try ?? []) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "try";
            button.textContent = command;
            button.title = `run "${command}" in the console`;
            button.addEventListener("click", () => execute(command));
            actions.append(button);
        }
        const { show } = step;
        if (show) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "show";
            button.textContent = "show me";
            button.addEventListener("click", () => spotlight(show));
            actions.append(button);
        }
        item.append(title, text, actions);
        ui.guideSteps.append(item);
    }
}

const guideOpen = () => !ui.guide.hidden;

/** @param {boolean} open @param {boolean} [focus] move the keyboard focus into the guide or back to its button */
function showGuide(open, focus = false) {
    ui.guide.hidden = !open;
    document.body.classList.toggle("guide-open", open);
    ui.guideToggle.setAttribute("aria-expanded", String(open));
    if (focus) (open ? ui.guideClose : ui.guideToggle).focus();
}

// ----- AI reader

const PROVIDER_NAMES = {
    off: "off",
    browser: "the model in this browser",
    chrome: "Chrome's built-in model",
    endpoint: "your server",
};

/** @param {"off" | "on" | "busy" | "error"} mode */
function setAIState(mode) {
    ui.aiToggle.dataset.state = mode;
    ui.aiToggle.title = `AI reader: ${PROVIDER_NAMES[state.ai.provider]}`;
}

/** @param {AISettings} settings */
function setAISettings(settings) {
    state.ai = settings;
    saveSettings(settings);
    setAIState(settings.provider === "off" ? "off" : "on");
}

/** @param {string} name */
const aiField = (name) => /** @type {HTMLInputElement} */ (ui.aiForm.elements.namedItem(name));

/** The settings the dialog shows right now, saved or not. @returns {AISettings} */
function formSettings() {
    const data = new FormData(ui.aiForm);
    const provider = String(data.get("provider") ?? "off");
    const size = String(data.get("size") ?? "better");
    return {
        provider: provider === "browser" || provider === "chrome" || provider === "endpoint" ? provider : "off",
        size: size === "small" ? "small" : "better",
        url: String(data.get("url") ?? "").trim(),
        model: String(data.get("model") ?? "").trim(),
    };
}

/** @param {string} text @param {"" | "ok" | "err"} [kind] */
function aiStatus(text, kind = "") {
    ui.aiStatus.textContent = text;
    ui.aiStatus.className = `ai-status ${kind}`.trim();
}

/** Where a server's ideas go, or what a server on this computer needs before it answers. */
function describeEndpoint() {
    let host = "";
    try {
        host = new URL(formSettings().url).host;
    } catch {
        // No address yet.
    }
    if (!host) ui.aiNote.textContent = "Fill in the server's address.";
    else if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host))
        ui.aiNote.textContent = `Ollama has to let this page in: start it with OLLAMA_ORIGINS=${location.origin} ollama serve. LM Studio needs CORS turned on in its server settings.`;
    else ui.aiNote.textContent = `Your ideas go to ${host}. The key stays in this tab and is forgotten when it closes.`;
}

/** Say what the provider picked in the dialog needs, or that it is ready. */
async function describeProvider() {
    const settings = formSettings();
    if (settings.provider === "browser") {
        const model = BROWSER_MODELS[settings.size];
        const problem = webgpuProblem(await webgpuSupport());
        if (problem) return aiStatus(`${problem[0].toUpperCase()}${problem.slice(1)}.`, "err");
        return aiStatus(
            (await browserModelCached(settings.size))
                ? `${model.name} is downloaded and ready.`
                : `${model.name} downloads ${model.download} the first time it reads an idea, then works offline.`,
        );
    }
    if (settings.provider === "chrome") {
        const availability = await chromeAvailability();
        return aiStatus(
            availability === "available" ? "Chrome's model is ready." : `Chrome reports its model as ${availability}.`,
        );
    }
    if (settings.provider === "endpoint") describeEndpoint();
    aiStatus("");
}

async function openAISettings() {
    const settings = state.ai;
    for (const input of ui.aiForm.querySelectorAll('input[name="provider"]')) {
        const radio = /** @type {HTMLInputElement} */ (input);
        radio.checked = radio.value === settings.provider;
    }
    aiField("size").value = settings.size;
    aiField("url").value = settings.url;
    aiField("model").value = settings.model;
    aiField("key").value = loadKey();
    aiField("preset").value = Object.entries(ENDPOINTS).find(([, e]) => e.url === settings.url)?.[0] ?? "custom";
    ui.aiProgress.hidden = true;
    aiStatus("");
    ui.aiDialog.showModal();
    ui.aiChrome.hidden = (await chromeAvailability()) === "unavailable";
    void describeProvider();
}

/** Load the in-browser model right after it is picked, so the first idea does not wait for it. */
async function warmUpBrowserModel() {
    const line = print("loading the AI model…", "dim");
    setAIState("busy");
    try {
        await prepareBrowserModel(state.ai.size, (fraction, text) => {
            line.textContent =
                text === "warming up"
                    ? "warming up the AI model…"
                    : `loading the AI model, ${Math.round(fraction * 100)}%`;
        });
        line.textContent = "the AI model is loaded and ready";
        line.className = "ok";
        setAIState("on");
    } catch (error) {
        line.remove();
        setAIState("error");
        print(`the AI model did not load: ${/** @type {Error} */ (error).message}`, "err");
    }
}

/** @param {Reading} reading */
function describeReading(reading) {
    const settings = [reading.style, reading.tempo, reading.mode, reading.echo && `${reading.echo} echo`];
    return `read as "${reading.reading ?? "?"}": ${settings.filter(Boolean).join(", ")}`;
}

// ----- console

/** @param {string} text @param {"in" | "out" | "err" | "ok" | "dim"} [kind] */
function print(text, kind = "out") {
    const line = document.createElement("div");
    line.className = kind;
    line.textContent = text;
    ui.log.append(line);
    ui.log.scrollTop = ui.log.scrollHeight;
    return line;
}

/** @param {ParseError[]} errors */
function printErrors(errors) {
    for (const error of errors) print(error.line ? `line ${error.line}: ${error.message}` : error.message, "err");
}

/** @param {string} text @param {string} done */
async function copy(text, done) {
    try {
        await navigator.clipboard.writeText(text);
        print(done, "ok");
    } catch {
        print("could not reach the clipboard, copy it from here:", "dim");
        print(text);
    }
}

/** @param {string} input */
function execute(input) {
    const command = parseCommand(input);
    if (!command) return;
    print(`> ${input}`, "in");
    switch (command.type) {
        case "play":
            if (!sequencer?.playing) togglePlay();
            return;
        case "stop":
            if (sequencer?.playing) togglePlay();
            return;
        case "mute":
            return setMuted(command.channel, command.on);
        case "solo":
            return setSolo(command.channel);
        case "unsolo":
            return setSolo(null);
        case "throw": {
            const live = audio();
            const now = live.context.currentTime;
            live.setThrow(command.channel, true, now);
            live.setThrow(command.channel, false, now + 60 / state.riddim.bpm);
            return;
        }
        case "filter":
            ui.filter.value = String(command.value);
            engine?.setFilter(command.value);
            showOutputs();
            return;
        case "preset":
            remember();
            void loadPreset(command.name);
            return;
        case "compose":
            void composeIdea(command.request, command.ai);
            return;
        case "ai":
            void openAISettings();
            return;
        case "ai-off":
            setAISettings({ ...state.ai, provider: "off" });
            return print("the AI reader is off; ideas stay in this browser", "ok");
        case "again":
            if (!state.lastRequest) return print("describe a riddim first, then ask again for another version", "err");
            state.take += 1;
            return composeAndPlay();
        case "undo": {
            const previous = state.undo.pop();
            if (previous === undefined) return print("nothing to undo", "err");
            loadText(previous);
            return print("undone", "ok");
        }
        case "show":
            return print(state.text.trimEnd(), "dim");
        case "share":
            void copy(location.origin + location.pathname + toHash(state.text), "link copied, it opens this riddim");
            return;
        case "prompt":
            void copy(
                aiPrompt(command.request, state.text),
                "prompt copied. Paste it into any AI chat, then paste its answer here (it starts with dubwise 1).",
            );
            return;
        case "help":
            return print(COMMANDS, "dim");
        case "guide":
            showGuide(true);
            return print("the guide is open beside the app, Esc closes it", "dim");
        case "theme":
            setTheme(command.name);
            return print(`theme ${THEMES[command.name]}`, "ok");
        case "notation":
            return print(SPEC, "dim");
        case "clear":
            ui.log.replaceChildren();
            return;
        case "line": {
            const result = setLine(state.text, command.line);
            if (!result.riddim) return printErrors(result.errors.map((e) => ({ line: 0, message: e.message })));
            remember();
            commit(result.riddim);
            return print("ok", "ok");
        }
        case "lines": {
            let text = state.text;
            for (const line of command.lines) {
                const result = setLine(text, line);
                if (!result.riddim) return printErrors([{ line: 0, message: `${line}: ${result.errors[0].message}` }]);
                text = result.text;
            }
            remember();
            if (loadText(text)) print("ok", "ok");
            return;
        }
        case "riddim": {
            const before = state.text;
            if (loadText(command.text)) {
                state.undo.push(before);
                print("riddim loaded", "ok");
            }
            return;
        }
        case "error":
            return print(command.message, "err");
    }
}

// ----- wiring

buildStrips();
buildGuide();
buildThemeMenu();
const savedTheme = document.documentElement.dataset.theme;
setTheme(isTheme(savedTheme) ? savedTheme : "dub", false);
ui.theme.addEventListener("click", () => showThemeMenu(!themeMenuOpen()));
ui.themeMenu.addEventListener("keydown", (event) => {
    const items = [...ui.themeMenu.querySelectorAll("button")];
    const at = items.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    const moves = { ArrowRight: 1, ArrowDown: 4, ArrowLeft: -1, ArrowUp: -4 };
    if (event.key in moves) {
        event.preventDefault();
        const step = moves[/** @type {keyof typeof moves} */ (event.key)];
        items[(at + step + items.length) % items.length].focus();
    } else if (event.key === "Tab") {
        showThemeMenu(false);
    }
});
// A click anywhere else closes the menu.
document.addEventListener("pointerdown", (event) => {
    if (themeMenuOpen() && !ui.theme.parentElement?.contains(/** @type {Node} */ (event.target))) showThemeMenu(false);
});
ui.guideToggle.addEventListener("click", () => showGuide(!guideOpen(), true));
setAIState(state.ai.provider === "off" ? "off" : "on");
// With the in-browser model picked on an earlier visit, load and warm it while the page is idle, so ideas do not wait.
if (state.ai.provider === "browser") setTimeout(() => void warmUpBrowserModel(), 1000);
/** @type {HTMLSelectElement} */ (/** @type {unknown} */ (aiField("preset"))).replaceChildren(
    new Option("my own address", "custom"),
    ...Object.entries(ENDPOINTS).map(([id, endpoint]) => new Option(endpoint.name, id)),
);
ui.aiToggle.addEventListener("click", () => void openAISettings());
ui.aiForm.addEventListener("change", (event) => {
    const target = /** @type {HTMLInputElement} */ (event.target);
    if (target.name === "preset" && target.value in ENDPOINTS) {
        aiField("url").value = ENDPOINTS[/** @type {keyof typeof ENDPOINTS} */ (target.value)].url;
    }
    if (target.name !== "model" && target.name !== "key") void describeProvider();
});
aiField("url").addEventListener("input", () => {
    const url = aiField("url").value.trim();
    aiField("preset").value = Object.entries(ENDPOINTS).find(([, e]) => e.url === url)?.[0] ?? "custom";
    describeEndpoint();
});
ui.aiTry.addEventListener("click", async () => {
    const settings = formSettings();
    if (settings.provider === "off") return aiStatus("Pick who reads your ideas first.", "err");
    saveKey(aiField("key").value.trim());
    aiStatus("reading…");
    ui.aiProgress.hidden = settings.provider !== "browser";
    try {
        const reading = await readIdea(settings, "Martin Campbell style", {
            onProgress: (fraction) => {
                ui.aiProgress.value = fraction;
                aiStatus(`loading the model, ${Math.round(fraction * 100)}%`);
            },
        });
        aiStatus(describeReading(reading), "ok");
    } catch (error) {
        aiStatus(`It did not work: ${/** @type {Error} */ (error).message}`, "err");
    } finally {
        ui.aiProgress.hidden = true;
    }
});
ui.aiForm.addEventListener("submit", (event) => {
    const button = /** @type {HTMLButtonElement | null} */ (/** @type {SubmitEvent} */ (event).submitter);
    if (button?.value !== "save") return;
    const settings = formSettings();
    if (settings.provider === "endpoint" && (!settings.url || !settings.model)) {
        event.preventDefault();
        return aiStatus("Fill in the address and the model's name.", "err");
    }
    saveKey(aiField("key").value.trim());
    setAISettings(settings);
    print(
        settings.provider === "off"
            ? "the AI reader is off; ideas stay in this browser"
            : `the AI reader is on: ${PROVIDER_NAMES[settings.provider]} reads the words dubwise does not know`,
        "ok",
    );
    if (settings.provider === "browser") void warmUpBrowserModel();
});
ui.guideClose.addEventListener("click", () => showGuide(false, true));
for (const name of PRESETS) ui.preset.add(new Option(name.replace("-", " "), name));
ui.preset.addEventListener("change", () => {
    if (ui.preset.value !== FROM_LINK && ui.preset.value !== CUSTOM) void loadPreset(ui.preset.value);
});
ui.play.addEventListener("click", togglePlay);
ui.share.addEventListener("click", () => execute("share"));
ui.bpm.addEventListener("change", () => {
    const result = setLine(state.text, `bpm ${ui.bpm.value}`);
    if (result.riddim) commit(result.riddim);
    else ui.bpm.value = String(state.riddim.bpm);
});

ui.grid.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.dataset.drum) {
        audio();
        editStep(
            /** @type {typeof DRUMS[number]} */ (target.dataset.drum),
            Number(target.dataset.step),
            event.shiftKey,
        );
    } else if (target.dataset.setting) {
        ui.command.value = currentLine(target.dataset.setting);
        ui.command.focus();
        autosize();
    }
});

ui.echoTime.addEventListener("change", () => {
    const [num, den] = ui.echoTime.value.split("/").map(Number);
    commit({ ...state.riddim, echo: { ...state.riddim.echo, num, den } });
});
ui.feedback.addEventListener("input", () => {
    commit({ ...state.riddim, echo: { ...state.riddim.echo, feedback: Number(ui.feedback.value) } });
});
ui.spring.addEventListener("input", () => commit({ ...state.riddim, spring: Number(ui.spring.value) }));
ui.filter.addEventListener("input", () => {
    engine?.setFilter(Number(ui.filter.value));
    showOutputs();
});
ui.filter.addEventListener("dblclick", () => {
    ui.filter.value = "0";
    engine?.setFilter(0);
    showOutputs();
});
ui.volume.addEventListener("input", () => {
    engine?.setVolume(Number(ui.volume.value));
    showOutputs();
});

const sirenDot = /** @type {HTMLElement} */ (ui.siren.querySelector(".dot"));
/** @param {PointerEvent} event */
function moveSiren(event) {
    const box = ui.siren.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    sirenDot.style.left = `${x * 100}%`;
    sirenDot.style.top = `${y * 100}%`;
    engine?.siren.set({ pitch: 300 * 4 ** x, rate: 0.5 + (1 - y) * 11 });
}
holdable(ui.siren, (on) => {
    const live = audio();
    if (on) live.siren.start();
    else live.siren.stop();
});
ui.siren.addEventListener("pointerdown", moveSiren);
ui.siren.addEventListener("pointermove", (event) => {
    if (ui.siren.classList.contains("held")) moveSiren(event);
});

function autosize() {
    ui.command.style.height = "auto";
    ui.command.style.height = `${ui.command.scrollHeight}px`;
}
ui.command.addEventListener("input", autosize);
ui.command.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const input = ui.command.value;
        if (input.trim()) {
            state.history.push(input);
            state.historyAt = state.history.length;
        }
        ui.command.value = "";
        autosize();
        execute(input);
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !ui.command.value.includes("\n")) {
        if (!state.history.length) return;
        event.preventDefault();
        const step = event.key === "ArrowUp" ? -1 : 1;
        state.historyAt = Math.max(0, Math.min(state.history.length, state.historyAt + step));
        ui.command.value = state.history[state.historyAt] ?? "";
        autosize();
    }
});
ui.prompt.addEventListener("submit", (event) => event.preventDefault());

document.addEventListener("keydown", (event) => {
    // The AI dialog handles its own keys, Escape included.
    if (ui.aiDialog.open) return;
    if (event.key === "Escape" && themeMenuOpen()) {
        showThemeMenu(false, true);
        return;
    }
    if (event.key === "Escape" && guideOpen()) {
        showGuide(false, ui.guide.contains(document.activeElement));
        return;
    }
    const typing = event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (typing) return;
    if (event.key === "?") {
        event.preventDefault();
        showGuide(!guideOpen(), true);
    } else if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
    } else if (event.key === "/") {
        event.preventDefault();
        ui.command.focus();
    }
});

window.addEventListener("hashchange", () => loadFromLink());
if (!loadFromLink()) void loadPreset(PRESETS[0]);
print(
    "dubwise is ready. Press play, click steps to edit, describe a riddim (inspired by Augustus Pablo) or press ? for the guide",
    "dim",
);
requestAnimationFrame(animate);

if ("serviceWorker" in navigator && location.protocol === "https:") {
    void navigator.serviceWorker.register("sw.js");
}
