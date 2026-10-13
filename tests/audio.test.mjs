import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { OfflineAudioContext } from "node-web-audio-api";

import { compose } from "../skills/dubwise/scripts/composer.mjs";
import { parse } from "../skills/dubwise/scripts/notation.mjs";
import { createEngine, TRACKS } from "../src/engine.js";
import { echoSeconds, eventsAt, renderRiddim, stepSeconds, swingOffset } from "../src/sequencer.js";

const RIDDIMS = join(import.meta.dirname, "..", "skills", "dubwise", "assets", "riddims");

/** @param {string} text */
function riddimOf(text) {
    const { riddim, errors } = parse(text);
    assert.deepEqual(errors, []);
    return riddim;
}
const preset = (name) => riddimOf(readFileSync(join(RIDDIMS, `${name}.txt`), "utf8"));

/** Render with the real engine. */
function render(riddim, options) {
    return renderRiddim(OfflineAudioContext, (context) => createEngine(context), riddim, options);
}

/** RMS in dBFS, peak and NaN check over a time window, across both channels. */
function measure(buffer, from = 0, to = buffer.duration) {
    const start = Math.floor(from * buffer.sampleRate);
    const end = Math.min(buffer.length, Math.floor(to * buffer.sampleRate));
    let sum = 0;
    let peak = 0;
    let nan = false;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = start; i < end; i++) {
            const x = data[i];
            if (Number.isNaN(x)) nan = true;
            sum += x * x;
            peak = Math.max(peak, Math.abs(x));
        }
    }
    const rms = Math.sqrt(sum / ((end - start) * buffer.numberOfChannels));
    return { db: 20 * Math.log10(rms || 1e-12), peak, nan };
}

/** Mute every track except `keep`. */
const soloing = (keep) => (engine) => {
    for (const track of TRACKS) if (track !== keep) engine.setMute(track, true, 0);
};

/** One rim hit on step 0 and nothing else. */
const singleRim = riddimOf(`dubwise 1\nbpm 80\nbars 4\nrim x...............\necho 3/16 0.6\n`);

describe("sequencer", () => {
    it("times steps, swing and echo", () => {
        assert.equal(stepSeconds(60), 0.25);
        assert.equal(swingOffset(2, 60, 0.2), 0);
        assert.equal(swingOffset(3, 60, 0.2), 0.05);
        assert.equal(echoSeconds(preset("one-drop")), 0.625);
    });

    it("puts the one drop on beat 3 and leaves beat 1 empty", () => {
        const oneDrop = preset("one-drop");
        assert.deepEqual(
            eventsAt(oneDrop, 0).map((e) => e.track),
            ["hat"],
        );
        assert.deepEqual(
            eventsAt(oneDrop, 8).map((e) => e.track),
            ["kick", "rim", "hat", "bass"],
        );
    });

    it("turns holds into longer bass notes and flags open hats", () => {
        const oneDrop = preset("one-drop");
        const held = eventsAt(oneDrop, 28).find((e) => e.track === "bass");
        assert.deepEqual(held, { track: "bass", velocity: 0.9, midi: 40, steps: 2 });
        assert.equal(eventsAt(oneDrop, 28).find((e) => e.track === "hat").open, true);
    });

    it("plays the tonic chord when no chords are given", () => {
        const riddim = riddimOf("dubwise 1\nkey C major\nskank x...............\n");
        assert.deepEqual(eventsAt(riddim, 0), [{ track: "skank", velocity: 0.8, midis: [60, 64, 67] }]);
    });
});

describe("audio", () => {
    it("mixes a full riddim without clipping or NaN", async () => {
        const result = measure(await render(preset("one-drop"), { seconds: 6.7 }));
        assert.equal(result.nan, false);
        assert.ok(result.peak <= 1, `peak ${result.peak}`);
        assert.ok(result.db > -35 && result.db < -8, `rms ${result.db.toFixed(1)} dBFS`);
    });

    for (const track of ["kick", "rim", "hat", "bass", "skank"]) {
        it(`${track} is audible on its own`, async () => {
            const buffer = await render(preset("steppers"), { seconds: 3.3, configure: soloing(track) });
            const result = measure(buffer, 0.05);
            assert.ok(result.db > -45, `${track} rms ${result.db.toFixed(1)} dBFS`);
            assert.equal(result.nan, false);
        });
    }

    it("goes silent when every track is muted, sends included", async () => {
        const buffer = await render(preset("steppers"), { seconds: 2, configure: soloing("none") });
        assert.ok(measure(buffer, 0.1).peak < 1e-3);
    });

    it("throws a hit into the tape echo", async () => {
        const options = (thrown) => ({
            seconds: 3,
            playSteps: 1,
            configure: (engine) => {
                engine.setSpring(0, 0);
                engine.setThrow("rim", thrown, 0);
            },
        });
        const tail = (buffer) => measure(buffer, 0.6, 2.8).db;
        const thrown = tail(await render(singleRim, options(true)));
        const dry = tail(await render(singleRim, options(false)));
        assert.ok(thrown - dry > 6, `echo tail ${thrown.toFixed(1)} dB vs ${dry.toFixed(1)} dB without the throw`);
        assert.ok(thrown > -60, `echo tail ${thrown.toFixed(1)} dBFS`);
    });

    it("rings the spring before the first echo repeat", async () => {
        const options = (level) => ({
            seconds: 1,
            playSteps: 1,
            configure: (engine) => engine.setSpring(level, 0),
        });
        // The first echo repeat lands at 3/16 of a bar (0.56 s at 80 bpm); measure the gap before it.
        const tail = (buffer) => measure(buffer, 0.2, 0.5).db;
        const wet = tail(await render(singleRim, options(1)));
        const dry = tail(await render(singleRim, options(0)));
        assert.ok(wet - dry > 10, `spring tail ${wet.toFixed(1)} dB vs ${dry.toFixed(1)} dB dry`);
    });

    it("darkens the hats with the DJ filter", async () => {
        const hats = (filter) =>
            render(preset("steppers"), {
                seconds: 2,
                configure: (engine) => {
                    soloing("hat")(engine);
                    engine.setFilter(filter, 0);
                },
            });
        const open = measure(await hats(0), 0.1).db;
        const closed = measure(await hats(-1), 0.1).db;
        assert.ok(open - closed > 20, `filter cut ${(open - closed).toFixed(1)} dB`);
    });

    it("chokes an open hat with the next hat, and only then", async () => {
        const hats = (line) =>
            render(riddimOf(`dubwise 1\nbpm 120\nhat    ${line}\necho 1/4 0\nspring 0\n`), {
                seconds: 0.4,
                playSteps: 2,
                configure: soloing("hat"),
            });
        // Rendering starts at 0.05 s, so the closed hat lands at 0.175 s and is over by 0.24 s.
        const ringing = await hats("o...............");
        const choked = await hats("ox..............");
        const before = measure(choked, 0.05, 0.17).db - measure(ringing, 0.05, 0.17).db;
        assert.ok(Math.abs(before) < 0.1, `the open hat is ${before.toFixed(1)} dB off before the choke`);
        const cut = measure(ringing, 0.24, 0.35).db - measure(choked, 0.24, 0.35).db;
        assert.ok(cut > 15, `choke cut ${cut.toFixed(1)} dB`);
    });

    it("sounds the siren only while it is held", async () => {
        const silent = riddimOf("dubwise 1\necho 1/4 0\n");
        const buffer = await render(silent, {
            seconds: 3,
            configure: (engine) => {
                engine.setSpring(0, 0);
                engine.setThrow("siren", false, 0);
                engine.setEcho(0.5, 0, 0);
                engine.siren.start(0.5);
                engine.siren.stop(1.5);
            },
        });
        const held = measure(buffer, 0.7, 1.4).db;
        const after = measure(buffer, 2.3, 3).db;
        assert.ok(held > -40, `siren ${held.toFixed(1)} dBFS`);
        assert.ok(held - after > 30, `siren release ${held.toFixed(1)} vs ${after.toFixed(1)} dBFS`);
    });

    for (const idea of [
        "crie um riddim inspirado em augustus pablo",
        "dub techno em Fm",
        "steppers in E minor heavy bass",
    ]) {
        it(`mixes a composed riddim without clipping: ${idea}`, async () => {
            const result = measure(await render(riddimOf(compose(idea).text), { seconds: 6 }));
            assert.equal(result.nan, false);
            assert.ok(result.peak <= 1, `peak ${result.peak}`);
            assert.ok(result.db > -35 && result.db < -8, `rms ${result.db.toFixed(1)} dBFS`);
        });
    }

    it("renders the same audio twice", async () => {
        const a = await render(preset("rockers"), { seconds: 1.5 });
        const b = await render(preset("rockers"), { seconds: 1.5 });
        assert.deepEqual(a.getChannelData(0), b.getChannelData(0));
    });
});
