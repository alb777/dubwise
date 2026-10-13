// Records docs/demo.mp4 and docs/demo.gif: the real app, played by a script in a headless browser.
// The picture comes from the DevTools screencast and the sound from a tap on the page's own audio output,
// recorded with MediaRecorder, so what you hear is exactly what the app played.
// Needs ffmpeg and a Chromium-based browser (BROWSER=brave by default).
// Usage: node tools/record-video.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, withPage } from "../tests/browser/cdp.mjs";

const WIDTH = 1280;
const HEIGHT = 1000;
const work = join(tmpdir(), `dubwise-video-${process.pid}`);
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
})();`;

/** @type {{ file: string, time: number }[]} */
const frames = [];
let audioStart = 0;
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

        await send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: WIDTH, maxHeight: HEIGHT });
        await wait(1500);

        await click("#play");
        await wait(150);
        audioStart = await evaluate(`(() => {
            window.__chunks = [];
            window.__recorder = new MediaRecorder(window.__tap.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 192000 });
            window.__recorder.ondataavailable = (event) => window.__chunks.push(event.data);
            window.__recorder.start();
            return Date.now() / 1000;
        })()`);

        await wait(5500);
        await hold('.strip[data-channel="rim"] .throw', 450);
        await wait(2500);
        await sweep(-0.85);
        await wait(1500);
        await type("crie um riddim inspirado em augustus pablo");
        await wait(5000);
        await hold('.strip[data-channel="skank"] .throw', 500);
        await wait(2500);
        await siren(3200);
        await wait(2000);
        await type("mute bass");
        await wait(3300);
        await type("unmute bass");
        await wait(3000);
        await type("a dark steppers in E minor with lots of echo");
        await wait(5500);
        await hold('.strip[data-channel="rim"] .throw', 450);
        await wait(2500);
        await sweep(0.7);
        await wait(3000);

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
const clip = ["-ss", "13", "-t", "9"];
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
