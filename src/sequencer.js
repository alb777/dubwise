// @ts-check
/**
 * Turns a riddim into timed note events. The pure helpers are shared by the live scheduler
 * and the offline renderer, so what the tests render is what the app plays.
 */
import { bassMidi, chordAt, chordMidi, leadMidi, STEPS_PER_BAR, stepAt } from "../skills/dubwise/scripts/notation.mjs";

/** @typedef {import("../skills/dubwise/scripts/notation.mjs").Riddim} Riddim */
/** @typedef {import("./engine.js").Engine} Engine */
/** @typedef {import("./engine.js").NoteEvent} NoteEvent */

const LOOKAHEAD_SECONDS = 0.15;
const TICK_MS = 25;

/** Length of one 16th-note step. @param {number} bpm */
export function stepSeconds(bpm) {
    return 60 / bpm / 4;
}

/** Steps in one pass of the riddim. @param {Riddim} riddim */
export function totalSteps(riddim) {
    return riddim.bars * STEPS_PER_BAR;
}

/**
 * Swing delays every odd 16th by `swing` of a step.
 * @param {number} step @param {number} bpm @param {number} swing
 */
export function swingOffset(step, bpm, swing) {
    return step % 2 === 1 ? swing * stepSeconds(bpm) : 0;
}

/** Echo time in seconds from its note length. @param {Riddim} riddim */
export function echoSeconds(riddim) {
    return (60 / riddim.bpm) * 4 * (riddim.echo.num / riddim.echo.den);
}

/** @param {number} value */
function velocity(value) {
    return value === 2 ? 1 : 0.8;
}

/**
 * Everything that starts on one step.
 * @param {Riddim} riddim
 * @param {number} step position inside the riddim, 0-based
 * @returns {NoteEvent[]}
 */
export function eventsAt(riddim, step) {
    /** @type {NoteEvent[]} */
    const events = [];
    for (const track of /** @type {const} */ (["kick", "rim", "snare", "clap"])) {
        const value = stepAt(riddim.drums[track], step);
        if (value) events.push({ track, velocity: velocity(value) });
    }
    const hat = stepAt(riddim.drums.hat, step);
    if (hat) events.push({ track: "hat", velocity: velocity(hat), open: hat === 3 });
    // The skank and the organ bubble both stab the chord that the chords line gives for that step.
    for (const track of /** @type {const} */ (["skank", "organ"])) {
        const value = stepAt(riddim.drums[track], step);
        if (value) {
            const chord = chordAt(riddim.chords, step) ?? "1";
            events.push({ track, velocity: velocity(value), midis: chordMidi(chord, riddim.key) });
        }
    }
    const token = stepAt(riddim.bass, step);
    const midi = token === undefined ? null : bassMidi(token, riddim.key);
    if (midi !== null) {
        let steps = 1;
        while (steps < riddim.bass.length && stepAt(riddim.bass, step + steps) === "-") steps++;
        events.push({ track: "bass", velocity: 0.9, midi, steps });
    }
    const leadToken = stepAt(riddim.lead, step);
    const leadNote = leadToken === undefined ? null : leadMidi(leadToken, riddim.key);
    if (leadNote !== null) {
        let steps = 1;
        while (steps < riddim.lead.length && stepAt(riddim.lead, step + steps) === "-") steps++;
        events.push({ track: "keys", velocity: 0.85, midi: leadNote, steps });
    }
    return events;
}

/**
 * Point the engine's effects at a riddim's settings.
 * @param {Engine} engine @param {Riddim} riddim @param {number} [time]
 */
export function applyRiddim(engine, riddim, time) {
    engine.setEcho(echoSeconds(riddim), riddim.echo.feedback, time);
    engine.setEchoModel(riddim.echo.model, time);
    engine.setSpring(riddim.spring, time);
}

/**
 * Live scheduler. `getRiddim` is read on every tick, so edits and tempo changes land on the next step.
 * @param {Engine} engine
 * @param {() => Riddim} getRiddim
 * @param {(step: number, time: number) => void} [onStep] called when a step is scheduled, with its audio time
 */
export function createSequencer(engine, getRiddim, onStep) {
    /** @type {ReturnType<typeof setInterval> | null} */
    let timer = null;
    let step = 0;
    let nextTime = 0;

    function tick() {
        const riddim = getRiddim();
        while (nextTime < engine.context.currentTime + LOOKAHEAD_SECONDS) {
            const position = step % totalSteps(riddim);
            const seconds = stepSeconds(riddim.bpm);
            const time = nextTime + swingOffset(position, riddim.bpm, riddim.swing);
            for (const event of eventsAt(riddim, position)) engine.trigger(event, time, seconds);
            onStep?.(position, time);
            nextTime += seconds;
            step++;
        }
    }

    return {
        start() {
            if (timer) return;
            applyRiddim(engine, getRiddim());
            step = 0;
            nextTime = engine.context.currentTime + 0.05;
            tick();
            timer = setInterval(tick, TICK_MS);
        },
        stop() {
            if (timer) clearInterval(timer);
            timer = null;
        },
        get playing() {
            return timer !== null;
        },
    };
}

/**
 * Render a riddim offline, for tests and for exporting audio.
 * @param {new (channels: number, length: number, sampleRate: number) => OfflineAudioContext} OfflineContext
 * @param {(context: BaseAudioContext) => Engine} makeEngine
 * @param {Riddim} riddim
 * @param {{ seconds: number, sampleRate?: number, configure?: (engine: Engine) => void, playSteps?: number }} options
 *   `playSteps` stops scheduling notes after that many steps, to leave room for tails.
 */
export async function renderRiddim(OfflineContext, makeEngine, riddim, options) {
    const sampleRate = options.sampleRate ?? 44100;
    const context = new OfflineContext(2, Math.ceil(options.seconds * sampleRate), sampleRate);
    const engine = makeEngine(context);
    applyRiddim(engine, riddim, 0);
    options.configure?.(engine);
    const seconds = stepSeconds(riddim.bpm);
    const steps = options.playSteps ?? Math.floor(options.seconds / seconds);
    for (let step = 0; step < steps; step++) {
        const position = step % totalSteps(riddim);
        const time = 0.05 + step * seconds + swingOffset(position, riddim.bpm, riddim.swing);
        for (const event of eventsAt(riddim, position)) engine.trigger(event, time, seconds);
    }
    return context.startRendering();
}
