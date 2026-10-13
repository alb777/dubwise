// @ts-check
/**
 * The dubwise audio graph: synthesized voices, a channel per track with mute and sends,
 * a tape echo, a spring reverb and a DJ-style filter on the master.
 * Runs on an AudioContext or an OfflineAudioContext.
 */
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
 * Deterministic pseudo-random numbers in [0, 1), so renders are reproducible.
 * @param {number} seed
 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

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

    // Master: mix bus, DJ filter (lowpass then highpass), a gentle limiter.
    const mixBus = context.createGain();
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
    mixBus.connect(lowpass).connect(highpass).connect(limiter).connect(master).connect(context.destination);

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
        if (openHat) {
            openHat.gain.cancelScheduledValues(time);
            openHat.gain.setTargetAtTime(0.0001, time, 0.01);
            openHat = null;
        }
        const decay = open ? 0.3 : 0.05;
        const high = context.createBiquadFilter();
        high.type = "highpass";
        high.frequency.value = 7000;
        const amp = envelope(time, velocity * 0.6, decay);
        noiseSource(time, decay).connect(high).connect(amp).connect(channels.hat.input);
        if (open) openHat = amp;
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
            delay.delayTime.setTargetAtTime(Math.min(seconds, 1.9), time, 0.08);
            feedback.gain.setTargetAtTime(Math.min(amount, 0.95), time, 0.02);
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
