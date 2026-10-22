// Records docs/demo.mp4 and docs/demo.gif: the real app, played by a script in a headless browser.
// The picture comes from the DevTools screencast and the sound from a tap on the page's own audio output,
// recorded with MediaRecorder, so what you hear is exactly what the app played.
// Needs ffmpeg and a Chromium-based browser (BROWSER=brave by default).
// Usage: node tools/record-demo.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, withPage } from "../tests/browser/cdp.mjs";

const WIDTH = 1280;
const HEIGHT = 1440;
const work = join(tmpdir(), `dubwise-demo-${process.pid}`);
mkdirSync(work, { recursive: true });

// Whatever the app connects to the speakers also feeds a stream we can record. The app is not changed.
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

// The demo plays in the Ethiopia theme, picked before the page loads.
const THEME = `localStorage.setItem("dubwise-theme", "ethiopia");`;

/** @type {{ file: string, time: number }[]} */
const frames = [];
let audioStart = 0;
/** When the first idea starts to be typed, where the README loop begins. */
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
        /** Hold a button down, like a hand on the desk. @param {string} selector @param {number} ms */
        const hold = async (selector, ms) => {
            const b = await box(selector);
            await mouse("mousePressed", b.x, b.y);
            await wait(ms);
            await mouse("mouseReleased", b.x, b.y);
        };
        /** Type into the console a key at a time, then press Enter. @param {string} text */
        const type = async (text) => {
            await click("#command");
            // Ensure console is in view (keys panel may push it down)
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
        /** Sweep the DJ filter to `to` and back. @param {number} to */
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
        /** Play the siren: press the pad and draw a slow figure across it. @param {number} ms */
        const siren = async (ms) => {
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
        /** Play a melodica phrase on computer keys. @param {string[]} keys array of key codes like ["KeyA","KeyS","KeyD"] */
        const playKeys = async (keys, holdMs = 180, gapMs = 60) => {
            for (const code of keys) {
                await send("Input.dispatchKeyEvent", {
                    type: "keyDown",
                    key: code.replace("Key", ""),
                    code,
                    windowsVirtualKeyCode: code.charCodeAt(3) - 65 + 65,
                });
                await wait(holdMs);
                await send("Input.dispatchKeyEvent", {
                    type: "keyUp",
                    key: code.replace("Key", ""),
                    code,
                    windowsVirtualKeyCode: code.charCodeAt(3) - 65 + 65,
                });
                await wait(gapMs);
            }
        };
        /** Play a melodica phrase with mouse on the on-screen keyboard. @param {number[]} offsets semitone offsets from base */
        const playMouseKeys = async (offsets, holdMs = 180, gapMs = 60) => {
            for (const offset of offsets) {
                const b = await box(`#keyboard .key[data-offset="${offset}"]`);
                const x = b.left + b.width / 2;
                const y = b.top + b.height - 12;
                await mouse("mousePressed", x, y);
                await wait(holdMs);
                await mouse("mouseReleased", x, y);
                await wait(gapMs);
            }
        };

        await send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: WIDTH, maxHeight: HEIGHT });
        await wait(1500);

        // Start audio recording
        await click("#play");
        await wait(150);
        audioStart = await evaluate(`(() => {
            window.__chunks = [];
            window.__recorder = new MediaRecorder(window.__tap.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 192000 });
            window.__recorder.ondataavailable = (event) => window.__chunks.push(event.data);
            window.__recorder.start();
            return Date.now() / 1000;
        })()`);

        // ---- INTRO: preset one-drop playing ----
        await wait(4500);
        await hold('.strip[data-channel="rim"] .throw', 450);
        await wait(2000);

        // ---- SELECTOR CHAT ----
        firstIdea = await evaluate("Date.now() / 1000");
        await type("hi");
        await wait(2500);
        await type("mood");
        await wait(2500);
        await type("play it");
        await wait(5000);

        // ---- FIRST RIDDIM: Iration Steppas meets King Tubby ----
        await type("Iration Steppas meets King Tubby");
        await wait(6000);
        await hold('.strip[data-channel="skank"] .throw', 500);
        await wait(1500);
        await type("a bit faster");
        await wait(3500);
        await click('[data-fx="crash"]');
        await wait(2500);
        await siren(3000);
        await wait(1500);

        // ---- MELODICA KEYS: open and freestyle ----
        await type("keys");
        await wait(1000); // wait for keys to slide in

        // Freestyle 1: computer keys (A W S E D F T G Y H U J K O L ; ' )
        // Play a melodic phrase in the current scale (A minor from the riddim)
        // A=C4, W=C#4, S=D4, E=D#4, D=E4, F=F4, T=F#4, G=G4, Y=G#4, H=A4, U=A#4, J=B4, K=C5, O=C#5, L=D5, ;=D#5, '=E5
        // A minor scale: A, B, C, D, E, F, G -> keys: H, J, K, L, ;, ', (next octave)
        await playKeys(["KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote", "KeyO"], 200, 80);
        await wait(500);
        // Descending run
        await playKeys(["KeyL", "KeyK", "KeyJ", "KeyH", "KeyG", "KeyF", "KeyD"], 180, 60);
        await wait(800);

        // Freestyle 2: mouse on the on-screen keyboard (more visual)
        // Play a dubby melodica line: root, 3rd, 5th, 7th, octave
        // In A minor: A (offset 9), C (offset 12), E (offset 16), G (offset 19), A (offset 21)
        await playMouseKeys([9, 12, 16, 19, 21], 250, 100);
        await wait(500);
        // Echo throw on keys channel
        await hold('.strip[data-channel="keys"] .throw', 600);
        await wait(1500);
        // Another phrase: syncopated
        await playMouseKeys([9, 12, 9, 16, 14, 12, 9], 150, 50);
        await wait(1000);

        // Close keys
        await type("keys off");
        await wait(800);

        // ---- SECOND RIDDIM: Beethoven in steppers ----
        await type("Beethoven in steppers");
        await wait(6000);
        await hold('[data-fx="spin"]', 2500);
        await wait(3000);

        // ---- THIRD RIDDIM: Funk carioca meets King Tubby ----
        await type("funk carioca meets King Tubby");
        await wait(5000);
        await click('[data-fx="horn"]');
        await wait(2500);
        await click('[data-fx="phaser"]');
        await wait(4500);
        await click('[data-fx="phaser"]');
        await wait(1000);

        // ---- SELECTOR: who is, similar, tip ----
        await type("who is King Tubby?");
        await wait(3000);
        await type("who else sounds like this?");
        await wait(3000);
        await type("tip");
        await wait(3000);
        await type("play it");
        await wait(5000);

        // ---- FINAL RIDDIM: slow one drop for a rainy night ----
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

        // ---- OUTRO: selector goodbye ----
        await type("bye");
        await wait(2000);

        // Stop audio recording
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

// Screencast frames arrive when the page repaints, so each one lasts until the next.
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

// A silent loop for the README, which cannot play sound inline: the part where an idea becomes a riddim.
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
