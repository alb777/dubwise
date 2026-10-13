// @ts-check
/**
 * The dubwise audio graph: synthesized voices, a channel per track with mute and sends,
 * a tape echo, a spring reverb and a DJ-style filter on the master.
 * Runs on an AudioContext or an OfflineAudioContext.
 */
import { mulberry32 } from "../skills/dubwise/scripts/composer.mjs";
import { midiToFrequency } from "../skills/dubwise/scripts/notation.mjs";

export const TRACKS = /** @type {const} */ (["kick", "rim", "hat", "bass", "skank", "siren"]);

/** @typedef {typeof TRACKS[number]} Track */
/**
 * @typedef {{ track: "kick" | "rim", velocity: number }
 *   | { track: "hat", velocity: number, open: boolean }
 *   | { track: "bass", velocity: number, midi: number, steps: number }
 *   | { track: "skank", velocity: number, midis: number[] }} NoteEvent
 */

/** Mix level, echo send and spring send per track. */
const MIX = /** @type {Record<Track, { level: number, echo: number, spring: number }>} */ ({
    kick: { level: 0.95, echo: 0, spring: 0.04 },
    rim: { level: 0.5, echo: 0.2, spring: 0.35 },
    hat: { level: 0.45, echo: 0.05, spring: 0.1 },
    bass: { level: 0.85, echo: 0, spring: 0 },
    skank: { level: 0.42, echo: 0.22, spring: 0.3 },
    siren: { level: 0.3, echo: 0.55, spring: 0.4 },
});

const FILTER_LOW = 20000;
const FILTER_LOWPASS_MIN = 120;
const FILTER_HIGHPASS_MAX = 6000;

/**
 * Spring reverb impulse response: decaying noise through a feedback comb, which gives the metallic
 * flutter of a spring tank. Left and right use different comb lengths for width.
 * @param {BaseAudioContext} context
 * @param {() => number} random
 */
function springImpulse(context, random) {
    const seconds = 2.4;
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        const comb = Math.floor(context.sampleRate * (channel ? 0.0371 : 0.0329));
        for (let i = 0; i < length; i++) {
            const t = i / context.sampleRate;
            const noise = (random() * 2 - 1) * Math.exp(-3.2 * t);
            data[i] = noise + (i >= comb ? 0.62 * data[i - comb] : 0);
        }
    }
    return buffer;
}

/**
 * Safety clipper for the very end of the chain: unity gain up to 0.8, then a smooth knee that never
 * passes full scale. Its input is scaled down 4x so the curve covers peaks up to +12 dB.
 * Compressors differ between Web Audio implementations: node-web-audio-api let a 2.15 transient
 * through on a bass note where Chromium stayed at 0.72, so the output must not trust the limiter alone.
 */
const CLIP_INPUT_RANGE = 4;
function safetyCurve() {
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) {
        const x = ((i / (curve.length - 1)) * 2 - 1) * CLIP_INPUT_RANGE;
        const size = Math.abs(x);
        curve[i] = Math.sign(x) * (size <= 0.8 ? size : 0.8 + 0.2 * Math.tanh((size - 0.8) / 0.2));
    }
    return curve;
}

/**
 * Soft clipping curve, tanh without makeup gain so a feedback loop never gains more than its feedback.
 * @param {number} drive
 */
function tanhCurve(drive) {
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(drive * x) / drive;
    }
    return curve;
}

/**
 * @param {BaseAudioContext} context
 * @param {{ seed?: number }} [options]
 */
export function createEngine(context, { seed = 7 } = {}) {
    const random = mulberry32(seed);

    // Master: mix bus, kill switches, DJ filter (lowpass then highpass), phaser, a gentle limiter, then the deck.
    const mixBus = context.createGain();
    const lowKill = context.createBiquadFilter();
    lowKill.type = "lowshelf";
    lowKill.frequency.value = 250;
    const highKill = context.createBiquadFilter();
    highKill.type = "highshelf";
    highKill.frequency.value = 2500;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = FILTER_LOW;
    lowpass.Q.value = 0.9;
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 20;
    highpass.Q.value = 0.9;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    const master = context.createGain();
    master.gain.value = 0.85;
    const clipIn = context.createGain();
    clipIn.gain.value = 1 / CLIP_INPUT_RANGE;
    const clipper = context.createWaveShaper();
    clipper.curve = safetyCurve();
    // Phaser, after the Mu-Tron Bi-Phase on Lee Perry's desk: six allpass stages swept by a slow LFO, mixed back in.
    const phaserDry = context.createGain();
    const phaserWet = context.createGain();
    phaserWet.gain.value = 0;
    const sweep = context.createOscillator();
    sweep.frequency.value = 0.35;
    const sweepDepth = context.createGain();
    sweepDepth.gain.value = 700;
    sweep.connect(sweepDepth);
    sweep.start();
    /** @type {AudioNode} */
    let stage = highpass;
    for (let i = 0; i < 6; i++) {
        const allpass = context.createBiquadFilter();
        allpass.type = "allpass";
        allpass.frequency.value = 900;
        sweepDepth.connect(allpass.frequency);
        stage = stage.connect(allpass);
    }
    stage.connect(phaserWet).connect(limiter);
    // The deck: a delay line the whole sound runs through, at no delay until a tape stop or a pull-up makes it lag
    // further and further behind, which slows the sound down or plays it backwards.
    const deck = context.createDelay(4);
    deck.delayTime.value = 0;
    const deckOut = context.createGain();
    mixBus.connect(lowKill).connect(highKill).connect(lowpass).connect(highpass).connect(phaserDry).connect(limiter);
    limiter.connect(master).connect(clipIn).connect(clipper).connect(deck).connect(deckOut);
    deckOut.connect(context.destination);

    // Tape echo: delay -> tone -> low cut -> tape saturation -> feedback -> delay.
    const echoIn = context.createGain();
    const delay = context.createDelay(2);
    delay.delayTime.value = 0.375;
    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2600;
    tone.Q.value = 0.6;
    const lowCut = context.createBiquadFilter();
    lowCut.type = "highpass";
    lowCut.frequency.value = 160;
    const tape = context.createWaveShaper();
    tape.curve = tanhCurve(1.4);
    tape.oversample = "2x";
    const feedback = context.createGain();
    feedback.gain.value = 0.5;
    const echoReturn = context.createGain();
    echoReturn.gain.value = 0.85;
    echoIn.connect(delay);
    delay.connect(tone).connect(lowCut).connect(tape).connect(feedback).connect(delay);
    tape.connect(echoReturn).connect(mixBus);
    // Wow and flutter wobble the delay time a little, like a worn tape transport.
    for (const [rate, depth] of [
        [0.4, 0.0018],
        [7, 0.00025],
    ]) {
        const lfo = context.createOscillator();
        lfo.frequency.value = rate;
        const amount = context.createGain();
        amount.gain.value = depth;
        lfo.connect(amount).connect(delay.delayTime);
        lfo.start();
    }

    // Spring reverb.
    const springIn = context.createGain();
    const convolver = context.createConvolver();
    convolver.normalize = true;
    convolver.buffer = springImpulse(context, random);
    const springLowCut = context.createBiquadFilter();
    springLowCut.type = "highpass";
    springLowCut.frequency.value = 250;
    const springHighCut = context.createBiquadFilter();
    springHighCut.type = "lowpass";
    springHighCut.frequency.value = 4500;
    const springReturn = context.createGain();
    springReturn.gain.value = 0.25;
    springIn.connect(convolver).connect(springLowCut).connect(springHighCut).connect(springReturn).connect(mixBus);
    // A crash is heard whatever the spring level, through a return of its own that opens only for the crash.
    const crashReturn = context.createGain();
    crashReturn.gain.value = 0;
    springHighCut.connect(crashReturn).connect(mixBus);

    // One channel per track: voices -> level -> mute -> master, with echo and spring sends after the mute,
    // like aux sends on a mixing desk: a muted channel stops feeding the echo, but tails already in it ring on.
    const channels =
        /** @type {Record<Track, { input: GainNode, mute: GainNode, echoSend: GainNode, springSend: GainNode, echoBase: number }>} */ ({});
    for (const track of TRACKS) {
        const input = context.createGain();
        const level = context.createGain();
        level.gain.value = MIX[track].level;
        const mute = context.createGain();
        const echoSend = context.createGain();
        echoSend.gain.value = MIX[track].echo;
        const springSend = context.createGain();
        springSend.gain.value = MIX[track].spring;
        input.connect(level).connect(mute).connect(mixBus);
        mute.connect(echoSend).connect(echoIn);
        mute.connect(springSend).connect(springIn);
        channels[track] = { input, mute, echoSend, springSend, echoBase: MIX[track].echo };
    }

    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const noiseData = noise.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = random() * 2 - 1;

    /** @param {number} time @param {number} duration */
    function noiseSource(time, duration) {
        const source = context.createBufferSource();
        source.buffer = noise;
        source.start(time, random() * 0.5, duration + 0.05);
        return source;
    }

    /**
     * A gain envelope: fast attack to `peak`, exponential decay over `decay` seconds.
     * @param {number} time @param {number} peak @param {number} decay
     */
    function envelope(time, peak, decay) {
        const amp = context.createGain();
        amp.gain.setValueAtTime(0.0001, time);
        amp.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + 0.003);
        amp.gain.exponentialRampToValueAtTime(0.0001, time + decay);
        return amp;
    }

    /** @param {number} time @param {number} velocity */
    function kick(time, velocity) {
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(46, time + 0.1);
        const amp = envelope(time, velocity, 0.5);
        osc.connect(amp).connect(channels.kick.input);
        osc.start(time);
        osc.stop(time + 0.55);
    }

    /** Cross-stick: a woody two-partial knock plus a band of noise. @param {number} time @param {number} velocity */
    function rim(time, velocity) {
        for (const [frequency, gain] of [
            [820, 0.6],
            [1570, 0.35],
        ]) {
            const osc = context.createOscillator();
            osc.type = "triangle";
            osc.frequency.value = frequency;
            const amp = envelope(time, velocity * gain, 0.06);
            osc.connect(amp).connect(channels.rim.input);
            osc.start(time);
            osc.stop(time + 0.08);
        }
        const band = context.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 2200;
        band.Q.value = 3;
        const amp = envelope(time, velocity * 0.7, 0.035);
        noiseSource(time, 0.05).connect(band).connect(amp).connect(channels.rim.input);
    }

    /** @type {GainNode | null} */
    let openHat = null;

    /** Hi-hat; a closed hat chokes a ringing open one. @param {number} time @param {number} velocity @param {boolean} open */
    function hat(time, velocity, open) {
        // The choke fades a gain of its own, so the open hat keeps decaying until the moment it is cut.
        // The setValueAtTime anchor is redundant by the spec, but node-web-audio-api blows the gain up without it.
        if (openHat) {
            openHat.gain.setValueAtTime(1, time);
            openHat.gain.setTargetAtTime(0, time, 0.01);
            openHat = null;
        }
        const decay = open ? 0.3 : 0.05;
        const high = context.createBiquadFilter();
        high.type = "highpass";
        high.frequency.value = 7000;
        const amp = envelope(time, velocity * 0.6, decay);
        const choke = context.createGain();
        noiseSource(time, decay).connect(high).connect(amp).connect(choke).connect(channels.hat.input);
        if (open) openHat = choke;
    }

    /** @type {GainNode | null} */
    let bassVoice = null;

    /**
     * Monophonic sub bass: sine plus a soft triangle and an octave so it still reads on small speakers.
     * @param {number} time @param {number} velocity @param {number} midi @param {number} duration
     */
    function bass(time, velocity, midi, duration) {
        if (bassVoice) {
            bassVoice.gain.cancelScheduledValues(time);
            bassVoice.gain.setTargetAtTime(0.0001, time, 0.006);
        }
        const frequency = midiToFrequency(midi);
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 700;
        filter.Q.value = 0.5;
        const amp = context.createGain();
        amp.gain.setValueAtTime(0.0001, time);
        amp.gain.exponentialRampToValueAtTime(velocity, time + 0.008);
        amp.gain.setValueAtTime(velocity, time + Math.max(duration - 0.05, 0.01));
        amp.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        for (const [type, ratio, gain] of /** @type {const} */ ([
            ["sine", 1, 1],
            ["triangle", 1, 0.3],
            ["sine", 2, 0.14],
        ])) {
            const osc = context.createOscillator();
            osc.type = type;
            osc.frequency.value = frequency * ratio;
            const mix = context.createGain();
            mix.gain.value = gain;
            osc.connect(mix).connect(filter);
            osc.start(time);
            osc.stop(time + duration + 0.05);
        }
        filter.connect(amp).connect(channels.bass.input);
        bassVoice = amp;
    }

    /** Skank: a short, thin chord chop on the offbeat. @param {number} time @param {number} velocity @param {number[]} midis */
    function skank(time, velocity, midis) {
        const low = context.createBiquadFilter();
        low.type = "highpass";
        low.frequency.value = 350;
        const high = context.createBiquadFilter();
        high.type = "lowpass";
        high.frequency.value = 2600;
        const amp = envelope(time, velocity * 0.5, 0.14);
        low.connect(high).connect(amp).connect(channels.skank.input);
        for (const midi of midis) {
            for (const [type, detune] of /** @type {const} */ ([
                ["sawtooth", 1],
                ["square", 1.003],
            ])) {
                const osc = context.createOscillator();
                osc.type = type;
                osc.frequency.value = midiToFrequency(midi) * detune;
                const mix = context.createGain();
                mix.gain.value = 0.16;
                osc.connect(mix).connect(low);
                osc.start(time);
                osc.stop(time + 0.16);
            }
        }
    }

    /**
     * One blast of an air horn: a brassy chord of saws that bends up into pitch, with some grit.
     * @param {number} time @param {number} length
     */
    function blast(time, length) {
        const grit = context.createWaveShaper();
        grit.curve = tanhCurve(3);
        const band = context.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 1400;
        band.Q.value = 0.8;
        const amp = context.createGain();
        amp.gain.setValueAtTime(0.0001, time);
        amp.gain.exponentialRampToValueAtTime(1.6, time + 0.01);
        amp.gain.setValueAtTime(1.6, time + length - 0.03);
        amp.gain.exponentialRampToValueAtTime(0.0001, time + length);
        grit.connect(band).connect(amp).connect(channels.siren.input);
        for (const ratio of [1, 1.26, 1.5]) {
            const osc = context.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(311 * ratio * 0.94, time);
            osc.frequency.exponentialRampToValueAtTime(311 * ratio, time + 0.04);
            const mix = context.createGain();
            mix.gain.value = 0.3;
            osc.connect(mix).connect(grit);
            osc.start(time);
            osc.stop(time + length + 0.02);
        }
    }

    /**
     * Play one sequencer event.
     * @param {NoteEvent} event
     * @param {number} time
     * @param {number} stepSeconds
     */
    function trigger(event, time, stepSeconds) {
        switch (event.track) {
            case "kick":
                return kick(time, event.velocity);
            case "rim":
                return rim(time, event.velocity);
            case "hat":
                return hat(time, event.velocity, event.open);
            case "bass":
                return bass(time, event.velocity, event.midi, event.steps * stepSeconds * 0.95);
            case "skank":
                return skank(time, event.velocity, event.midis);
        }
    }

    // The siren is played live: one voice, an LFO on its pitch.
    const siren = (() => {
        /** @type {{ osc: OscillatorNode, lfo: OscillatorNode, depth: GainNode, amp: GainNode } | null} */
        let voice = null;
        const settings = { pitch: 620, rate: 2.5, depth: 0.35, wave: /** @type {OscillatorType} */ ("square") };
        return {
            /** @param {number} [time] */
            start(time = context.currentTime) {
                if (voice) return;
                const osc = context.createOscillator();
                osc.type = "square";
                osc.frequency.value = settings.pitch;
                const lfo = context.createOscillator();
                lfo.type = settings.wave;
                lfo.frequency.value = settings.rate;
                const depth = context.createGain();
                depth.gain.value = settings.pitch * settings.depth;
                const tone = context.createBiquadFilter();
                tone.type = "lowpass";
                tone.frequency.value = 3200;
                const amp = context.createGain();
                amp.gain.setValueAtTime(0.0001, time);
                amp.gain.exponentialRampToValueAtTime(0.8, time + 0.03);
                lfo.connect(depth).connect(osc.frequency);
                osc.connect(tone).connect(amp).connect(channels.siren.input);
                osc.start(time);
                lfo.start(time);
                voice = { osc, lfo, depth, amp };
            },
            /**
             * @param {{ pitch?: number, rate?: number, depth?: number, wave?: OscillatorType }} next
             * @param {number} [time]
             */
            set(next, time = context.currentTime) {
                Object.assign(settings, next);
                if (!voice) return;
                voice.osc.frequency.setTargetAtTime(settings.pitch, time, 0.02);
                voice.lfo.frequency.setTargetAtTime(settings.rate, time, 0.02);
                voice.depth.gain.setTargetAtTime(settings.pitch * settings.depth, time, 0.02);
                voice.lfo.type = settings.wave;
            },
            /** @param {number} [time] */
            stop(time = context.currentTime) {
                if (!voice) return;
                voice.amp.gain.cancelScheduledValues(time);
                voice.amp.gain.setTargetAtTime(0.0001, time, 0.05);
                voice.osc.stop(time + 0.4);
                voice.lfo.stop(time + 0.4);
                voice = null;
            },
            get playing() {
                return voice !== null;
            },
        };
    })();

    /** The echo as last set, which an echo spin returns to. */
    const echoSettings = { seconds: 0.375, amount: 0.5 };
    /** When the deck is free for another move. */
    let deckFreeAt = 0;

    return {
        context,
        siren,
        trigger,
        /** @param {Track} track @param {boolean} muted @param {number} [time] */
        setMute(track, muted, time = context.currentTime) {
            channels[track].mute.gain.setTargetAtTime(muted ? 0 : 1, time, 0.008);
        },
        /** Throw a track into the echo while `on`. @param {Track} track @param {boolean} on @param {number} [time] */
        setThrow(track, on, time = context.currentTime) {
            const channel = channels[track];
            channel.echoSend.gain.setTargetAtTime(on ? 1 : channel.echoBase, time, 0.01);
        },
        /**
         * Echo time in seconds and feedback 0..0.95. Changing the time glides like tape, pitch and all.
         * @param {number} seconds @param {number} amount @param {number} [time]
         */
        setEcho(seconds, amount, time = context.currentTime) {
            Object.assign(echoSettings, { seconds: Math.min(seconds, 1.9), amount: Math.min(amount, 0.95) });
            delay.delayTime.setTargetAtTime(echoSettings.seconds, time, 0.08);
            feedback.gain.setTargetAtTime(echoSettings.amount, time, 0.02);
        },
        /**
         * Spin the echo while `on`: feedback past the edge, so the tape runs away and howls, and a delay sliding
         * shorter, so the pitch rises. Letting go brings the echo back as it was set.
         * @param {boolean} on @param {number} [time]
         */
        setSpin(on, time = context.currentTime) {
            feedback.gain.setTargetAtTime(on ? 1.1 : echoSettings.amount, time, on ? 0.1 : 0.05);
            delay.delayTime.setTargetAtTime(echoSettings.seconds * (on ? 0.6 : 1), time, on ? 0.8 : 0.3);
        },
        /** Kick the spring tank: a crash of noise and a thump straight into the springs. @param {number} [time] */
        springCrash(time = context.currentTime) {
            const hit = envelope(time, 1.2, 0.09);
            noiseSource(time, 0.1).connect(hit).connect(springIn);
            const thump = context.createOscillator();
            thump.frequency.setValueAtTime(90, time);
            thump.frequency.exponentialRampToValueAtTime(40, time + 0.12);
            thump.connect(envelope(time, 1, 0.15)).connect(springIn);
            thump.start(time);
            thump.stop(time + 0.2);
            // The anchor keeps node-web-audio-api from evaluating the fall before the crash.
            crashReturn.gain.setValueAtTime(0.8, time);
            crashReturn.gain.setTargetAtTime(0, time + 0.3, 0.7);
        },
        /** The air horn: two short blasts and a long one, through the siren's channel. @param {number} [time] */
        horn(time = context.currentTime) {
            for (const [start, length] of [
                [0, 0.12],
                [0.17, 0.12],
                [0.34, 0.6],
            ]) {
                blast(time + start, length);
            }
        },
        /** Cut the lows or the highs of the whole mix while `on`. @param {"low" | "high"} band @param {boolean} on @param {number} [time] */
        setKill(band, on, time = context.currentTime) {
            (band === "low" ? lowKill : highKill).gain.setTargetAtTime(on ? -40 : 0, time, 0.01);
        },
        /** Sweep the whole mix through the phaser while `on`. @param {boolean} on @param {number} [time] */
        setPhaser(on, time = context.currentTime) {
            phaserWet.gain.setTargetAtTime(on ? 0.7 : 0, time, 0.05);
            phaserDry.gain.setTargetAtTime(on ? 0.7 : 1, time, 0.05);
        },
        /**
         * Work the deck: "stop" slows the whole sound down to a halt, like a hand on the platter, and "pull-up" spins
         * it backwards, the selector's rewind. The sound is cut at the end until deckReset(). Returns the time the
         * move ends, or null while the last move is still running.
         * @param {"stop" | "pull-up"} move @param {number} [time]
         * @returns {number | null}
         */
        deckMove(move, time = context.currentTime) {
            if (time < deckFreeAt) return null;
            const seconds = move === "stop" ? 1.4 : 0.9;
            // The delay grows at `slope` times the time passed by the end: 1 brings the deck to a halt, 3 runs it
            // backwards at twice its speed.
            const slope = move === "stop" ? 1 : 3;
            const curve = Float32Array.from({ length: 64 }, (_, i) => {
                const t = (i / 63) * seconds;
                return (slope * t * t) / (2 * seconds);
            });
            deck.delayTime.setValueCurveAtTime(curve, time, seconds);
            deckOut.gain.setValueAtTime(1, time + seconds * 0.8);
            deckOut.gain.linearRampToValueAtTime(0, time + seconds);
            deckFreeAt = time + seconds;
            return deckFreeAt;
        },
        /** Back to the live sound after a deck move. @param {number} [time] */
        deckReset(time = context.currentTime) {
            const at = Math.max(time, deckFreeAt);
            deck.delayTime.setValueAtTime(0, at);
            deckOut.gain.setValueAtTime(0, at);
            deckOut.gain.linearRampToValueAtTime(1, at + 0.01);
        },
        /** Spring reverb return level 0..1. @param {number} level @param {number} [time] */
        setSpring(level, time = context.currentTime) {
            springReturn.gain.setTargetAtTime(level, time, 0.02);
        },
        /**
         * DJ filter: -1 is a dark lowpass, 0 is open, 1 is a thin highpass.
         * @param {number} value @param {number} [time]
         */
        setFilter(value, time = context.currentTime) {
            const v = Math.max(-1, Math.min(1, value));
            const low = v < 0 ? FILTER_LOW * (FILTER_LOWPASS_MIN / FILTER_LOW) ** -v : FILTER_LOW;
            const high = v > 0 ? 20 * (FILTER_HIGHPASS_MAX / 20) ** v : 20;
            lowpass.frequency.setTargetAtTime(low, time, 0.03);
            highpass.frequency.setTargetAtTime(high, time, 0.03);
        },
        /** Master volume 0..1. @param {number} level @param {number} [time] */
        setVolume(level, time = context.currentTime) {
            master.gain.setTargetAtTime(level, time, 0.02);
        },
    };
}

/** @typedef {ReturnType<typeof createEngine>} Engine */
