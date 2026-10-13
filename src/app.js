// @ts-check
/**
 * The dubwise page: step grid, channel strips, effects, siren pad, the console, colour themes and the guide.
 * Every change, from a grid click, a slider or a console line, goes through commit(),
 * which updates the engine, the shareable URL and the screen together.
 */

import { compose } from "../skills/dubwise/scripts/composer.mjs";
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
import { aiPrompt, CHANNELS, COMMANDS, PRESETS, parseCommand, THEMES } from "./console.js";
import { createEngine } from "./engine.js";
import { GUIDE } from "./guide.js";
import { applyRiddim, createSequencer } from "./sequencer.js";

/** @typedef {import("../skills/dubwise/scripts/notation.mjs").Riddim} Riddim */
/** @typedef {import("../skills/dubwise/scripts/notation.mjs").ParseError} ParseError */
/** @typedef {import("./engine.js").Engine} Engine */
/** @typedef {import("./console.js").Channel} Channel */

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
    theme: /** @type {HTMLSelectElement} */ (byId("theme")),
    guide: byId("guide"),
    guideToggle: byId("guide-toggle"),
    guideClose: byId("guide-close"),
    guideSteps: byId("guide-steps"),
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

/** Compose the last idea at the current take, load it and start playing. */
function composeAndPlay() {
    const result = compose(state.lastRequest, state.take);
    if (!result.understood) return print(result.summary, "err");
    remember();
    loadText(result.text);
    print(result.summary, "ok");
    print('"again" for another version, "undo" to go back, "show" for the notation', "dim");
    if (!sequencer?.playing) togglePlay();
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
    ui.theme.value = name;
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

// ----- console

/** @param {string} text @param {"in" | "out" | "err" | "ok" | "dim"} [kind] */
function print(text, kind = "out") {
    const line = document.createElement("div");
    line.className = kind;
    line.textContent = text;
    ui.log.append(line);
    ui.log.scrollTop = ui.log.scrollHeight;
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
            state.lastRequest = command.request;
            state.take = 0;
            return composeAndPlay();
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
for (const [id, name] of Object.entries(THEMES)) ui.theme.add(new Option(name, id));
const savedTheme = document.documentElement.dataset.theme;
setTheme(isTheme(savedTheme) ? savedTheme : "dub", false);
ui.theme.addEventListener("change", () => {
    if (isTheme(ui.theme.value)) setTheme(ui.theme.value);
});
ui.guideToggle.addEventListener("click", () => showGuide(!guideOpen(), true));
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
