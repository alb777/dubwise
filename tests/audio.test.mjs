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

    it("turns lead holds into longer melodica notes", () => {
        const riddim = riddimOf("dubwise 1\nkey C major\nlead 1 . . 1 . . 3 . 5 . . . 5 - 3 .\n");
        assert.deepEqual(eventsAt(riddim, 0), [{ track: "keys", velocity: 0.85, midi: 60, steps: 1 }]);
        assert.deepEqual(eventsAt(riddim, 12), [{ track: "keys", velocity: 0.85, midi: 67, steps: 2 }]);
        assert.deepEqual(eventsAt(riddim, 1), []);
    });
});

describe("audio", () => {
    it("mixes a full riddim without clipping or NaN", async () => {
        const result = measure(await render(preset("one-drop"), { seconds: 6.7 }));
        assert.equal(result.nan, false);
        assert.ok(result.peak <= 1, `peak ${result.peak}`);
        assert.ok(result.db > -35 && result.db < -8, `rms ${result.db.toFixed(1)} dBFS`);
    });

    for (const track of ["kick", "rim", "hat", "snare", "clap", "bass", "skank"]) {
        it(`${track} is audible on its own`, async () => {
            const riddim =
                track === "snare" || track === "clap"
                    ? riddimOf(`dubwise 1\nbpm 80\n${track} x...............\necho 1/4 0\nspring 0\n`)
                    : preset("steppers");
            const buffer = await render(riddim, { seconds: 3.3, configure: soloing(track) });
            const result = measure(buffer, 0.05);
            assert.ok(result.db > -45, `${track} rms ${result.db.toFixed(1)} dBFS`);
            assert.equal(result.nan, false);
        });
    }

    it("goes silent when every track is muted, sends included", async () => {
        const buffer = await render(preset("steppers"), { seconds: 2, configure: soloing("none") });
        assert.ok(measure(buffer, 0.1).peak < 1e-3);
    });

    it("plays the lead line on the melodica's channel", async () => {
        const riddim = riddimOf(
            "dubwise 1\nbpm 80\nkey C major\nlead 1 . . 1 . . 3 . 5 . . . 5 - 3 .\necho 1/4 0\nspring 0\n",
        );
        const buffer = await render(riddim, { seconds: 3.3, configure: soloing("keys") });
        const result = measure(buffer, 0.05);
        assert.ok(result.db > -45, `lead rms ${result.db.toFixed(1)} dBFS`);
        assert.equal(result.nan, false);
        assert.ok(result.peak <= 1, `peak ${result.peak}`);
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

    describe("the melodica keys", () => {
        const silent = riddimOf("dubwise 1\necho 1/4 0\n");
        /** Render the keys alone, dry, with `play` pressing and letting go. */
        const keys = (play, seconds = 2.5) =>
            render(silent, {
                seconds,
                configure: (engine) => {
                    engine.setSpring(0, 0);
                    engine.setThrow("keys", false, 0);
                    engine.setEcho(0.5, 0, 0);
                    play(engine);
                },
            });
        /** The loudest period between 2 and 20 ms, by autocorrelation, as a frequency. */
        const pitch = (buffer, from, to) => {
            const data = buffer.getChannelData(0).slice(from * buffer.sampleRate, to * buffer.sampleRate);
            let best = 0;
            let bestLag = 0;
            for (let lag = Math.floor(buffer.sampleRate / 500); lag < buffer.sampleRate / 50; lag++) {
                let sum = 0;
                for (let i = 0; i + lag < data.length; i++) sum += data[i] * data[i + lag];
                if (sum > best) [best, bestLag] = [sum, lag];
            }
            return buffer.sampleRate / bestLag;
        };

        it("sounds a key only while it is held, at its pitch", async () => {
            const buffer = await keys((engine) => {
                engine.keys.down(57, 0.3);
                engine.keys.up(57, 1.3);
            });
            const held = measure(buffer, 0.5, 1.2).db;
            const after = measure(buffer, 2, 2.5).db;
            assert.ok(held > -35, `melodica ${held.toFixed(1)} dBFS`);
            assert.ok(held - after > 30, `release ${held.toFixed(1)} vs ${after.toFixed(1)} dBFS`);
            const heard = pitch(buffer, 0.6, 0.8);
            assert.ok(Math.abs(heard - 220) < 4, `A3 heard at ${heard.toFixed(1)} Hz`);
        });

        it("plays chords without clipping, and lets every key go at once", async () => {
            const buffer = await keys((engine) => {
                for (const midi of [60, 64, 67, 72]) engine.keys.down(midi, 0.2);
                engine.keys.release(1.2);
            });
            const chord = measure(buffer, 0.4, 1.1);
            assert.ok(chord.peak <= 1 && !chord.nan, `chord peak ${chord.peak}`);
            assert.ok(chord.db - measure(buffer, 1.9, 2.5).db > 30);
        });

        it("ignores a key pressed twice, and a key let go that was never pressed", async () => {
            const buffer = await keys((engine) => {
                engine.keys.up(62, 0.1);
                engine.keys.down(62, 0.2);
                engine.keys.down(62, 0.4);
                engine.keys.up(62, 1);
            });
            assert.ok(measure(buffer, 1.8, 2.5).peak < 1e-3);
        });

        it("goes quiet with its channel muted", async () => {
            const buffer = await keys((engine) => {
                engine.setMute("keys", true, 0);
                engine.keys.down(60, 0.2);
            }, 1);
            assert.ok(measure(buffer, 0.3, 1).peak < 1e-3);
        });
    });

    it("kicks the spring tank with a crash, whatever the spring level", async () => {
        const silent = riddimOf("dubwise 1\necho 1/4 0\n");
        const crash = (on) =>
            render(silent, {
                seconds: 2,
                configure: (engine) => {
                    engine.setSpring(0, 0);
                    if (on) engine.springCrash(0.2);
                },
            });
        const crashed = measure(await crash(true), 0.3, 1.2);
        assert.ok(crashed.db > -40, `crash ${crashed.db.toFixed(1)} dBFS`);
        assert.ok(crashed.peak <= 1 && !crashed.nan);
        assert.ok(measure(await crash(false), 0.3, 1.2).peak < 1e-4);
    });

    it("spins the echo into a howl while held and lets it go", async () => {
        const spin = (held) =>
            render(singleRim, {
                seconds: 6,
                playSteps: 1,
                configure: (engine) => {
                    engine.setSpring(0, 0);
                    engine.setThrow("rim", true, 0);
                    if (held) {
                        engine.setSpin(true, 0.3);
                        engine.setSpin(false, 3);
                    }
                },
            });
        const spun = await spin(true);
        const plain = await spin(false);
        const howl = measure(spun, 2.2, 3).db - measure(plain, 2.2, 3).db;
        assert.ok(howl > 10, `spin ${howl.toFixed(1)} dB over the plain echo`);
        assert.ok(measure(spun).peak <= 1 && !measure(spun).nan);
        const release = measure(spun, 2.2, 3).db - measure(spun, 5.3, 6).db;
        assert.ok(release > 10, `the howl falls ${release.toFixed(1)} dB after letting go`);
    });

    it("kills the lows and the highs of the whole mix", async () => {
        const solo = (track, band, on) =>
            render(preset("steppers"), {
                seconds: 2,
                configure: (engine) => {
                    soloing(track)(engine);
                    engine.setKill(band, on, 0);
                },
            });
        const bass =
            measure(await solo("bass", "low", false), 0.1).db - measure(await solo("bass", "low", true), 0.1).db;
        assert.ok(bass > 20, `low kill ${bass.toFixed(1)} dB on the bass`);
        const hats =
            measure(await solo("hat", "high", false), 0.1).db - measure(await solo("hat", "high", true), 0.1).db;
        assert.ok(hats > 20, `high kill ${hats.toFixed(1)} dB on the hats`);
    });

    it("sweeps the mix through the phaser without a jump in level", async () => {
        const skank = (on) =>
            render(preset("steppers"), {
                seconds: 3,
                configure: (engine) => {
                    soloing("skank")(engine);
                    engine.setPhaser(on, 0);
                },
            });
        const [dry, phased] = [await skank(false), await skank(true)];
        const change = Math.abs(measure(phased, 0.1).db - measure(dry, 0.1).db);
        assert.ok(change < 4, `phaser changes the level by ${change.toFixed(1)} dB`);
        const a = dry.getChannelData(0);
        const b = phased.getChannelData(0);
        let difference = 0;
        let energy = 0;
        for (let i = 0; i < a.length; i++) {
            difference += (a[i] - b[i]) ** 2;
            energy += a[i] ** 2;
        }
        assert.ok(difference / energy > 0.1, `the phaser changed ${((100 * difference) / energy).toFixed(0)}% of it`);
    });

    it("stops the deck to silence or pulls it up backwards, then plays live again", async () => {
        // The held siren gives the deck a steady sound to slow down and spin back.
        const silent = riddimOf("dubwise 1\necho 1/4 0\n");
        for (const move of /** @type {const} */ (["stop", "pull-up"])) {
            let end = 0;
            let busy;
            const buffer = await render(silent, {
                seconds: 4,
                configure: (engine) => {
                    engine.siren.start(0.1);
                    end = engine.deckMove(move, 1) ?? 0;
                    busy = engine.deckMove(move, 1.1);
                    engine.deckReset(3);
                },
            });
            assert.equal(busy, null, `${move}: a second move waits for the first`);
            assert.ok(measure(buffer, 1.05, end - 0.3).db > -30, `${move} still sounds while it runs`);
            assert.ok(measure(buffer, end + 0.02, 2.95).peak < 1e-3, `${move} is silent after ${end.toFixed(2)} s`);
            assert.ok(measure(buffer, 3.1, 4).db > -30, `${move}: live again after the reset`);
            assert.ok(measure(buffer).peak <= 1 && !measure(buffer).nan);
        }
    });

    it("blows the air horn through the siren's channel", async () => {
        const silent = riddimOf("dubwise 1\necho 1/4 0\n");
        const horn = (muted) =>
            render(silent, {
                seconds: 1.5,
                configure: (engine) => {
                    engine.setSpring(0, 0);
                    engine.setMute("siren", muted, 0);
                    engine.horn(0.2);
                },
            });
        const blown = measure(await horn(false), 0.2, 1.2);
        assert.ok(blown.db > -30 && blown.peak <= 1, `horn ${blown.db.toFixed(1)} dBFS`);
        assert.ok(measure(await horn(true), 0.2, 1.2).peak < 1e-3);
    });

    describe("the echo heads", () => {
        const head = (model) => riddimOf(`dubwise 1\nbpm 80\nrim x...............\necho 3/16 0.6 ${model}\n`);
        /** The loudest sample difference from `from` on, between two renders of the same riddim. */
        const apart = (a, b, from = 1.2) => {
            const start = Math.floor(from * a.sampleRate);
            let max = 0;
            for (let channel = 0; channel < 2; channel++) {
                const x = a.getChannelData(channel);
                const y = b.getChannelData(channel);
                for (let i = start; i < x.length; i++) max = Math.max(max, Math.abs(x[i] - y[i]));
            }
            return max;
        };
        const models = /** @type {const} */ (["tape", "space", "bbd", "digital"]);

        it("colors every repeat, and each head sounds like its own", async () => {
            const rendered = [];
            for (const model of models) {
                const buffer = await render(head(model), {
                    seconds: 3.5,
                    configure: (engine) => engine.setSpring(0, 0),
                });
                const tail = measure(buffer, 1.2, 3.5);
                assert.equal(tail.nan, false, model);
                assert.ok(tail.db > -70, `${model} tail ${tail.db.toFixed(1)} dBFS`);
                rendered.push(buffer);
            }
            const [tape, space, bbd, digital] = rendered;
            assert.ok(apart(digital, bbd) > 0.005, "bbd darkens what digital leaves open");
            assert.ok(apart(tape, digital) > 0.005, "tape wobbles where digital stays still");
            assert.ok(apart(tape, space) > 0.005, "space blooms the repeats through a spring");
        });
    });

    for (const idea of [
        "crie um riddim inspirado em augustus pablo",
        "Iration Steppas meets King Tubby",
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
