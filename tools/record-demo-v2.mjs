// Records docs/demo.mp4 and docs/demo.gif: the real app, played by a script in a headless browser.
// The picture comes from the DevTools screencast and the sound from a tap on the page's own audio output,
// recorded with MediaRecorder, so what you hear is exactly what the app played.
// Needs ffmpeg and a Chromium-based browser (BROWSER=brave by default).
// Usage: node tools/record-demo-v2.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, withPage } from "../tests/browser/cdp.mjs";

const WIDTH = 1280;
const HEIGHT = 1400;
const work = join(tmpdir(), `dubwise-demo-${process.pid}`);
mkdirSync(work, { recursive: true });

const TAP = `(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...rest) {
        const result = connect.call(this, destination, ...rest);
        if (destination instanceof AudioDestinationNode) {
            const context = this.context;
            if (!context.__tap) context.__tap = context.createMediaStreamDestination();
            window.__tap = context.__tap;
            connect.call(this, context.__tap);
        }
        return result;
    };
})()`;

const THEME = `localStorage.setItem("dubwise-theme", "ethiopia");`;

/** @type {{ file: string, time: number }[]} */
const frames = [];
let audioStart = 0;
let firstIdea = 0;
let audio = "";

await withPage(
    "/",
    async ({ evaluate, send, on, wait }) => {
        on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
            const file = join(work, `f${String(frames.length).padStart(5, "0")}.jpg`);
            writeFileSync(file, Buffer.from(data, "base64"));
            frames.push({ file, time: metadata.timestamp });
            void send("Page.screencastFrameAck", { sessionId });
        });

        /** @param {string} selector */
        const box = (selector) =>
            evaluate(`(() => {
                const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
                return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x, top: r.y, width: r.width, height: r.height };
            })()`);
        /** @param {string} type @param {number} x @param {number} y */
        const mouse = (type, x, y) =>
            send("Input.dispatchMouseEvent", {
                type,
                x,
                y,
                button: "left",
                buttons: type === "mouseReleased" ? 0 : 1,
                clickCount: 1,
            });
        /** @param {string} selector */
        const click = async (selector) => {
            const b = await box(selector);
            await mouse("mousePressed", b.x, b.y);
            await mouse("mouseReleased", b.x, b.y);
        };
        /** Hold a button down. @param {string} selector @param {number} ms */
        const hold = async (selector, ms) => {
            const b = await box(selector);
            await mouse("mousePressed", b.x, b.y);
            await wait(ms);
            await mouse("mouseReleased", b.x, b.y);
        };
        /** Type into the console a key at a time, then press Enter. @param {string} text */
        const type = async (text) => {
            await click("#command");
            await evaluate(`document.getElementById("command").scrollIntoView({block: "center"})`);
            if (!(await evaluate("document.activeElement?.id === 'command'")))
                throw new Error(`the console is out of the ${WIDTH}x${HEIGHT} window, so "${text}" would go nowhere`);
            for (const char of text) {
                await send("Input.insertText", { text: char });
                await wait(40);
            }
            await wait(300);
            for (const kind of ["keyDown", "keyUp"]) {
                await send("Input.dispatchKeyEvent", {
                    type: kind,
                    key: "Enter",
                    code: "Enter",
                    windowsVirtualKeyCode: 13,
                });
            }
        };
        /** Sweep the DJ filter. @param {number} to */
        const sweep = async (to) => {
            const set = (v) =>
                evaluate(
                    `(() => { const f = document.getElementById("filter"); f.value = "${v}"; f.dispatchEvent(new Event("input")); })()`,
                );
            const steps = 24;
            for (let i = 1; i <= steps; i++) {
                await set(((to * i) / steps).toFixed(3));
                await wait(70);
            }
            await wait(600);
            for (let i = steps - 1; i >= 0; i--) {
                await set(((to * i) / steps).toFixed(3));
                await wait(50);
            }
        };
        /** Play the siren pad. @param {number} ms */
        // Kept for reference; not used in this demo cut.
        const _siren = async (ms) => {
            const b = await box("#siren");
            const point = (t) => ({
                x: b.left + b.width * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.1))),
                y: b.top + b.height * (0.25 + 0.5 * (0.5 + 0.5 * Math.cos(t * 1.3))),
            });
            let p = point(0);
            await mouse("mousePressed", p.x, p.y);
            const started = Date.now();
            while (Date.now() - started < ms) {
                p = point((Date.now() - started) / 1000);
                await mouse("mouseMoved", p.x, p.y);
                await wait(40);
            }
            await mouse("mouseReleased", p.x, p.y);
        };

        // ===== MELODICA HELPERS =====
        // Key codes in order: A W S E D F T G Y H U J K O L ; '
        const KEY_CODES = [
            "KeyA",
            "KeyW",
            "KeyS",
            "KeyE",
            "KeyD",
            "KeyF",
            "KeyT",
            "KeyG",
            "KeyY",
            "KeyH",
            "KeyU",
            "KeyJ",
            "KeyK",
            "KeyO",
            "KeyL",
            "Semicolon",
            "Quote",
        ];
        // Map semitone offset (0-24) -> key index
        const SEMITONE_TO_KEY = {};
        for (let i = 0; i < KEY_CODES.length; i++) SEMITONE_TO_KEY[i] = KEY_CODES[i];

        /** Play a melodica phrase quantized to the riddim beat.
         * @param {number[]} semitones - semitone offsets from keyboard.base (C4=0)
         * @param {number} beatsPerNote - duration of each note in beats (1 beat = quarter note at current BPM)
         * @param {number} swing - swing factor 0..1 (0.15 = dubwise default)
         */
        const playMelodica = async (semitones, beatsPerNote = 1, swing = 0.15) => {
            // Get current BPM to compute beat duration
            const bpm = await evaluate("Number(document.getElementById('bpm').value)");
            const beatMs = 60000 / bpm; // ms per beat (quarter note)
            const stepMs = beatMs / 4; // 16th note
            const swingMs = stepMs * swing;

            for (let i = 0; i < semitones.length; i++) {
                const semi = semitones[i];
                const code = SEMITONE_TO_KEY[semi];
                if (!code) continue;

                // Press on the beat (with swing on even 16ths)
                const isOffbeat = i % 2 === 1;
                const delay = isOffbeat ? swingMs : 0;
                if (delay) await wait(delay);

                await send("Input.dispatchKeyEvent", {
                    type: "keyDown",
                    key: code.replace("Key", ""),
                    code,
                    windowsVirtualKeyCode: code.charCodeAt(3) - 65 + 65,
                });

                // Hold for the note duration (minus swing delay if any)
                const holdMs = beatsPerNote * beatMs - (isOffbeat ? delay : 0);
                await wait(Math.max(10, holdMs));

                await send("Input.dispatchKeyEvent", {
                    type: "keyUp",
                    key: code.replace("Key", ""),
                    code,
                    windowsVirtualKeyCode: code.charCodeAt(3) - 65 + 65,
                });

                // Small gap between notes (1/4 of beat)
                await wait(beatMs / 4);
            }
        };

        /** Play with mouse on visible keyboard (for visual flair). Same timing. */
        const playMouseMelodica = async (offsets, beatsPerNote = 1, swing = 0.15) => {
            const bpm = await evaluate("Number(document.getElementById('bpm').value)");
            const beatMs = 60000 / bpm;
            const stepMs = beatMs / 4;
            const swingMs = stepMs * swing;

            for (let i = 0; i < offsets.length; i++) {
                const offset = offsets[i];
                const b = await box(`#keyboard .key[data-offset="${offset}"]`);
                const x = b.left + b.width / 2;
                const y = b.top + b.height - 12;

                const isOffbeat = i % 2 === 1;
                const delay = isOffbeat ? swingMs : 0;
                if (delay) await wait(delay);

                await mouse("mousePressed", x, y);
                const holdMs = beatsPerNote * beatMs - (isOffbeat ? delay : 0);
                await wait(Math.max(10, holdMs));
                await mouse("mouseReleased", x, y);
                await wait(beatMs / 4);
            }
        };

        await send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: WIDTH, maxHeight: HEIGHT });
        await wait(1500);

        await click("#play");
        await wait(150);
        audioStart = await evaluate(`(() => {
            window.__chunks = [];
            window.__recorder = new MediaRecorder(window.__tap.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 192000 });
            window.__recorder.ondataavailable = (e) => window.__chunks.push(e.data);
            window.__recorder.start();
            return Date.now() / 1000;
        })()`);

        // ---- INTRO: one-drop playing ----
        await wait(4500);
        await hold('.strip[data-channel="rim"] .throw', 450);
        await wait(2000);

        // ---- SELECTOR: mood ----
        firstIdea = await evaluate("Date.now() / 1000");
        await type("hi");
        await wait(2000);
        await type("mood");
        await wait(2000);
        await type("play it");
        await wait(5000);

        // ---- RIDDIM 1: Augustus Pablo style (asks for melodica) ----
        await type("inspired by Augustus Pablo");
        await wait(7000); // let it settle

        // Open keys
        await type("keys");
        await wait(1200);

        // ===== MELODICA FREESTYLE 1: Augustus Pablo dub style =====
        // A minor scale: A(9) B(11) C(12) D(14) E(16) F(17) G(19) A(21)
        // Pablo style: slow melodic phrases, lots of space, root-5th-octave.
        // Short phrases with breathing room between them.
        await playMelodica([9, 14, 21], 1, 0.15); // A  - E  - A(8va)
        await wait(1500);
        await playMelodica([16, 14, 12], 1, 0.15); // E  - D  - C   (answer)
        await wait(1500);
        await playMelodica([9, 11, 12, 14], 1, 0.15); // A - B - C - E (turnaround)
        await wait(1000);

        // Throw keys into echo
        await hold('.strip[data-channel="keys"] .throw', 800);
        await wait(1500);

        // ===== MELODICA FREESTYLE 2: Answer phrase (higher, more syncopated) =====
        // Eighth notes (0.5 beat) with swing
        await playMelodica([21, 19, 16, 14], 0.5, 0.15); // A  G  E  D
        await wait(700);
        await playMelodica([12, 11, 9, 11], 0.5, 0.15); // C  B  A  B
        await wait(1200);

        // ===== MELODICA FREESTYLE 3: Mouse on screen (visual) - long sustained notes =====
        // Half notes (2 beats) - dubby held notes with spring reverb
        await playMouseMelodica([9, 14, 21], 2, 0.15); // A, E, A(8va) - root, 5th, octave
        await wait(1500);
        await playMouseMelodica([16, 14, 12], 2, 0.15); // E, D, C - answer held
        await wait(2000);

        // Close keys
        await type("keys off");
        await wait(800);

        // ---- RIDDIM 2: Steppers with selector ----
        await type("Beethoven in steppers");
        await wait(6000);
        await hold('[data-fx="spin"]', 2500);
        await wait(3000);

        // ---- RIDDIM 3: Funk carioca meets King Tubby ----
        await type("funk carioca meets King Tubby");
        await wait(5000);
        await click('[data-fx="horn"]');
        await wait(2500);
        await click('[data-fx="phaser"]');
        await wait(4000);
        await click('[data-fx="phaser"]');
        await wait(1000);

        // ---- SELECTOR TALK ----
        await type("who is King Tubby?");
        await wait(3000);
        await type("who else sounds like this?");
        await wait(3000);
        await type("tip");
        await wait(3000);
        await type("play it");
        await wait(5000);

        // ---- FINAL: Slow one drop, filter sweeps ----
        await type("a slow one drop for a rainy night");
        await wait(5000);
        await sweep(-0.85);
        await wait(500);
        await type("brighter");
        await wait(4000);
        await type("mute bass");
        await wait(2500);
        await type("unmute bass");
        await wait(3000);
        await click('[data-fx="pull-up"]');
        await wait(5000);
        await sweep(0.7);
        await wait(2500);

        // ---- OUTRO ----
        await type("bye");
        await wait(2000);

        audio = await evaluate(`new Promise((resolve) => {
            window.__recorder.onstop = async () => {
                const bytes = new Uint8Array(await new Blob(window.__chunks, { type: "audio/webm" }).arrayBuffer());
                let text = "";
                for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                resolve(btoa(text));
            };
            window.__recorder.stop();
        })`);
        await send("Page.stopScreencast");
    },
    {
        setup: async (send) => {
            await send("Emulation.setDeviceMetricsOverride", {
                width: WIDTH,
                height: HEIGHT,
                deviceScaleFactor: 1,
                mobile: false,
            });
            await send("Page.addScriptToEvaluateOnNewDocument", { source: TAP });
            await send("Page.addScriptToEvaluateOnNewDocument", { source: THEME });
        },
    },
);

if (frames.length < 100 || !audio)
    throw new Error(`recording failed: ${frames.length} frames, ${audio.length} audio bytes`);
const audioFile = join(work, "audio.webm");
writeFileSync(audioFile, Buffer.from(audio, "base64"));

const list = ["ffconcat version 1.0"];
for (let i = 0; i < frames.length; i++) {
    list.push(`file '${frames[i].file}'`);
    if (i < frames.length - 1) list.push(`duration ${(frames[i + 1].time - frames[i].time).toFixed(4)}`);
}
list.push(`file '${frames.at(-1).file}'`);
const listFile = join(work, "frames.txt");
writeFileSync(listFile, `${list.join("\n")}\n`);

const offset = Math.max(0, audioStart - frames[0].time).toFixed(3);
const mp4 = join(ROOT, "docs", "demo.mp4");
const ffmpeg = (args) =>
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
ffmpeg([
    ...["-f", "concat", "-safe", "0", "-i", listFile],
    ...["-itsoffset", offset, "-i", audioFile],
    ...["-map", "0:v", "-map", "1:a", "-vf", "fps=30,format=yuv420p"],
    ...["-c:v", "libx264", "-preset", "slow", "-crf", "24", "-c:a", "aac", "-b:a", "192k"],
    ...["-movflags", "+faststart", "-shortest", mp4],
]);

const gif = join(ROOT, "docs", "demo.gif");
const palette = join(work, "palette.png");
const clip = ["-ss", Math.max(0, firstIdea - frames[0].time - 0.5).toFixed(2), "-t", "9"];
ffmpeg([...clip, "-i", mp4, "-vf", "fps=10,scale=800:-1:flags=lanczos,palettegen=stats_mode=diff", palette]);
ffmpeg([
    ...clip,
    "-i",
    mp4,
    "-i",
    palette,
    "-lavfi",
    "fps=10,scale=800:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4",
    gif,
]);

rmSync(work, { recursive: true, force: true });
const size = (file) => `${(statSync(file).size / 1024 / 1024).toFixed(1)} MB`;
console.log(`${frames.length} frames, audio offset ${offset} s`);
console.log(`docs/demo.mp4 ${size(mp4)}, docs/demo.gif ${size(gif)}`);
