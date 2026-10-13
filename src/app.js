// @ts-check
/**
 * Minimal player page: presets, play/stop, mute and throw per channel, the DJ filter and the siren.
 * A riddim in the URL fragment (#r=...) plays instead of a preset.
 */
import { emptyRiddim, fromHash, parse, toHash } from "../skills/dubwise/scripts/notation.mjs";
import { createEngine, TRACKS } from "./engine.js";
import { applyRiddim, createSequencer } from "./sequencer.js";

/** @typedef {import("./engine.js").Engine} Engine */
/** @typedef {import("./engine.js").Track} Track */

const PRESETS = ["one-drop", "rockers", "steppers"];
const FROM_LINK = "from-link";

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const presetSelect = /** @type {HTMLSelectElement} */ (byId("preset"));
const playButton = byId("play");
const filterInput = /** @type {HTMLInputElement} */ (byId("filter"));
const sirenButton = byId("siren");
const status = byId("status");

let riddim = emptyRiddim();
/** @type {Engine | null} */
let engine = null;
/** @type {ReturnType<typeof createSequencer> | null} */
let sequencer = null;
/** @type {Set<Track>} */
const muted = new Set();

/** @param {string} text @param {boolean} [isError] */
function setStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle("error", isError);
}

/** Audio needs a user gesture, so the engine starts on the first press. */
function audio() {
    if (!engine) {
        const context = new AudioContext({ latencyHint: "interactive" });
        engine = createEngine(context);
        for (const track of muted) engine.setMute(track, true);
        engine.setFilter(Number(filterInput.value));
        applyRiddim(engine, riddim);
        sequencer = createSequencer(engine, () => riddim);
    }
    if (engine.context instanceof AudioContext) void engine.context.resume();
    return engine;
}

/**
 * Load riddim text; shows the parse errors instead when it is not valid.
 * @param {string} text @param {boolean} updateHash
 */
function load(text, updateHash) {
    const result = parse(text);
    if (!result.riddim) {
        setStatus(result.errors.map((e) => (e.line ? `line ${e.line}: ${e.message}` : e.message)).join("\n"), true);
        return;
    }
    riddim = result.riddim;
    if (engine) applyRiddim(engine, riddim);
    if (updateHash) history.replaceState(null, "", toHash(text));
    setStatus(
        `${riddim.bpm} bpm, ${riddim.key.root} ${riddim.key.mode}, ${riddim.bars} bar${riddim.bars > 1 ? "s" : ""}`,
    );
}

/** @param {string} name */
async function loadPreset(name) {
    const response = await fetch(`skills/dubwise/assets/riddims/${name}.txt`);
    load(await response.text(), true);
}

function loadFromLink() {
    const text = fromHash(location.hash);
    if (text === null) return false;
    if (!presetSelect.querySelector(`option[value="${FROM_LINK}"]`))
        presetSelect.add(new Option("from link", FROM_LINK), 0);
    presetSelect.value = FROM_LINK;
    load(text, false);
    return true;
}

/** Button that does something while pressed and undoes it on release. @param {HTMLElement} button @param {(on: boolean) => void} action */
function holdButton(button, action) {
    button.addEventListener("pointerdown", (event) => {
        button.setPointerCapture(event.pointerId);
        button.classList.add("held");
        action(true);
    });
    for (const type of ["pointerup", "pointercancel"]) {
        button.addEventListener(type, () => {
            button.classList.remove("held");
            action(false);
        });
    }
}

for (const name of PRESETS) presetSelect.add(new Option(name.replace("-", " "), name));
presetSelect.addEventListener("change", () => {
    if (presetSelect.value !== FROM_LINK) void loadPreset(presetSelect.value);
});

playButton.addEventListener("click", () => {
    const live = audio();
    if (sequencer?.playing) {
        sequencer.stop();
        playButton.textContent = "Play";
    } else {
        sequencer?.start();
        applyRiddim(live, riddim);
        playButton.textContent = "Stop";
    }
});

const channels = byId("channels");
for (const track of TRACKS.filter((t) => t !== "siren")) {
    const channel = document.createElement("div");
    channel.className = "channel";
    const name = document.createElement("strong");
    name.textContent = track;
    const mute = document.createElement("button");
    mute.type = "button";
    mute.textContent = "mute";
    mute.setAttribute("aria-pressed", "false");
    mute.addEventListener("click", () => {
        const on = !muted.has(track);
        if (on) muted.add(track);
        else muted.delete(track);
        mute.setAttribute("aria-pressed", String(on));
        engine?.setMute(track, on);
    });
    const throwButton = document.createElement("button");
    throwButton.type = "button";
    throwButton.textContent = "throw";
    throwButton.title = "Hold to send this channel into the echo";
    holdButton(throwButton, (on) => audio().setThrow(track, on));
    channel.append(name, mute, throwButton);
    channels.append(channel);
}

filterInput.addEventListener("input", () => engine?.setFilter(Number(filterInput.value)));
filterInput.addEventListener("dblclick", () => {
    filterInput.value = "0";
    engine?.setFilter(0);
});

holdButton(sirenButton, (on) => {
    const live = audio();
    if (on) live.siren.start();
    else live.siren.stop();
});
sirenButton.addEventListener("pointermove", (event) => {
    if (!engine?.siren.playing) return;
    const box = sirenButton.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    // Pressure, where the device reports it, speeds up the wobble like leaning on a siren box.
    const pressure = event.pressure > 0 && event.pressure !== 0.5 ? event.pressure : 0.4;
    engine.siren.set({ pitch: 300 * 4 ** x, rate: 1 + pressure * 9 });
});

window.addEventListener("hashchange", () => loadFromLink());
if (!loadFromLink()) void loadPreset(PRESETS[0]);
