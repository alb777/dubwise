// Loads the app in a headless browser, clicks and types like a player, and saves screenshots.
// Usage: node tests/browser/ui.mjs [screenshot-dir]   (BROWSER=chromium to pick another browser)
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { ROOT, withPage } from "./cdp.mjs";

// A stand-in for an OpenAI-compatible server, so the AI reader can be tried without a model. It reads every idea
// as a spy film, and fails on purpose while `failing` is set.
const SPY_FILM = {
    reading: "spy film: tense, dark, cinematic",
    style: "steppers",
    tempo: "lively",
    mode: "minor",
    echo: "high",
    density: "busy",
    bass: "root",
};
let aiRequests = 0;
let failing = false;
/** Answers after a pause while set, so a newer idea can come in while the AI is still reading. */
let slow = false;
/** The last idea the app asked the AI about. */
let askedAbout = "";
const aiServer = createServer((request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "content-type, authorization");
    if (request.method === "OPTIONS") return response.writeHead(204).end();
    aiRequests++;
    let body = "";
    request.on("data", (chunk) => {
        body += chunk;
    });
    request.on("end", () => {
        askedAbout = JSON.parse(body || "{}").messages?.at(-1)?.content ?? "";
    });
    if (failing)
        return response.writeHead(503, { "content-type": "application/json" }).end('{"error":{"message":"busy"}}');
    const answer = () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(SPY_FILM) } }] }));
    };
    if (slow) setTimeout(answer, 1500);
    else answer();
});
await new Promise((resolve) => aiServer.listen(0, "127.0.0.1", resolve));
const aiUrl = `http://127.0.0.1:${aiServer.address().port}/v1`;

const outDir = process.argv[2] ?? join(ROOT, "tests", "browser", "out");
mkdirSync(outDir, { recursive: true });
const failures = [];
/** @param {string} name @param {boolean} ok @param {unknown} [detail] */
const check = (name, ok, detail) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${JSON.stringify(detail)}`}`);
    if (!ok) failures.push(name);
};

/** JS that types a line into the console and presses Enter. */
const type = (line) => `(() => {
    const box = document.getElementById("command");
    box.value = ${JSON.stringify(line)};
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
})()`;
const lastLog = `(() => { const l = document.getElementById("log").lastElementChild; return l ? { text: l.textContent, kind: l.className } : null; })()`;

await withPage("/", async (page) => {
    const { evaluate, wait, send } = page;
    // A clean shot of the first screen, before any test input, for the README.
    await send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await wait(300);
    const first = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, "first-screen.png"), Buffer.from(first.data, "base64"));
    check("loads without errors", page.errors.length === 0, page.errors);
    check("draws 4 drum rows of 16 steps", (await evaluate("document.querySelectorAll('.cell').length")) === 64);
    check("draws the bass row", (await evaluate("document.querySelectorAll('.note').length")) === 16);
    check("draws 6 channel strips", (await evaluate("document.querySelectorAll('#strips .strip').length")) === 6);
    check("loads the one drop preset", (await evaluate("document.getElementById('bpm').value")) === "72");
    check(
        "shows bar tabs for a 2 bar riddim",
        (await evaluate("document.querySelectorAll('#bars button').length")) === 2,
    );

    await evaluate(`document.querySelector('.cell[data-drum="kick"][data-step="0"]').click()`);
    check(
        "a click toggles a step",
        (await evaluate(`document.querySelector('.cell[data-drum="kick"][data-step="0"]').dataset.value`)) === "1",
    );
    await wait(400);
    const hash = await evaluate("decodeURIComponent(location.hash)");
    check("the edit lands in the share link", hash.includes("kick   x.......x"), hash);

    await evaluate(type("bpm 80"));
    check("a console line changes the riddim", (await evaluate("document.getElementById('bpm').value")) === "80");
    check("the console confirms", (await evaluate(lastLog))?.kind === "ok");

    await evaluate(type("bpm 999"));
    const bad = await evaluate(lastLog);
    check("a bad line shows an error", bad?.kind === "err" && bad.text.includes("bpm must be"), bad);
    check("a bad line changes nothing", (await evaluate("document.getElementById('bpm').value")) === "80");

    await evaluate(type("help"));
    check("help prints the commands", (await evaluate(lastLog))?.text.startsWith("commands"));

    await wait(400); // the share link updates 250 ms after the last edit
    const before = await evaluate("decodeURIComponent(location.hash)");
    await evaluate(type("pla"));
    await wait(400);
    check("a typo is declined, not composed", (await evaluate(lastLog))?.kind === "err");
    check("a typo leaves the riddim alone", (await evaluate("decodeURIComponent(location.hash)")) === before);

    await evaluate(type("crie um riddim inspirado em augustus pablo"));
    await wait(400);
    const composed = await evaluate(
        `[...document.querySelectorAll("#log .ok")].map((l) => l.textContent).find((t) => t.includes("inspired by"))`,
    );
    check("free text composes a riddim", composed?.includes("inspired by Augustus Pablo"), composed);
    check(
        "the composed riddim starts playing",
        (await evaluate("document.getElementById('play').getAttribute('aria-pressed')")) === "true",
    );
    check(
        "a composed riddim is labelled custom",
        (await evaluate("document.getElementById('preset').value")) === "custom",
    );
    check(
        "the composed riddim is rockers",
        (await evaluate(`document.querySelector('.cell[data-drum="kick"][data-step="0"]').dataset.value`)) === "1",
    );
    await evaluate("document.getElementById('play').click()");

    await evaluate(type("undo"));
    await wait(400);
    check("undo brings the previous riddim back", (await evaluate("decodeURIComponent(location.hash)")) === before);

    await evaluate(type("mute bass"));
    check(
        "mute from the console lights the strip",
        (await evaluate(`document.querySelector('.strip[data-channel="bass"] .mute').getAttribute('aria-pressed')`)) ===
            "true",
    );

    await evaluate(`document.querySelector('.row-name[data-setting="bass"]').click()`);
    const prefilled = await evaluate("document.getElementById('command').value");
    check("a row name puts its line in the console", prefilled.startsWith("bass . . 1"), prefilled);
    await evaluate("document.getElementById('command').value = ''");

    await evaluate("document.getElementById('play').click()");
    await wait(1200);
    check(
        "play starts the transport",
        (await evaluate("document.getElementById('play').getAttribute('aria-pressed')")) === "true",
    );
    check("the playhead moves", (await evaluate("document.querySelectorAll('.now').length")) > 0);
    await evaluate("document.getElementById('play').click()");

    // The melodica keys: put away until asked for, then played with the pointer and the computer keys.
    const keysHidden = "document.getElementById('keys').hidden";
    check("the keys start put away", (await evaluate(keysHidden)) === true);
    await evaluate("document.getElementById('keys-toggle').click()");
    await wait(700);
    check(
        "the keys button brings out the keys",
        (await evaluate(keysHidden)) === false &&
            (await evaluate("document.getElementById('keys-toggle').getAttribute('aria-expanded')")) === "true",
    );
    check(
        "two octaves and the top C, with a strip of their own",
        (await evaluate("document.querySelectorAll('#keyboard .key').length")) === 25 &&
            (await evaluate(`document.querySelectorAll('#keys .strip[data-channel="keys"]').length`)) === 1,
    );
    const marks = await evaluate(`(() => {
        const names = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        const [root] = document.getElementById("keyinfo").textContent.split(" ");
        const keys = [...document.querySelectorAll("#keyboard .key")];
        return {
            root: (names[root[0]] + (root[1] === "#" ? 1 : root[1] === "b" ? -1 : 0) + 12) % 12,
            scale: keys.filter((k) => k.dataset.scale === "true").length,
            roots: keys.filter((k) => k.dataset.root === "true").map((k) => (60 + Number(k.dataset.offset)) % 12),
        };
    })()`);
    check(
        "the riddim's scale and its root are marked",
        marks.scale >= 14 && marks.scale <= 15 && marks.roots.length >= 2 && marks.roots.every((r) => r === marks.root),
        marks,
    );
    const keyPoint = (offset) =>
        evaluate(`(() => {
            const box = document.querySelector('#keyboard [data-offset="${offset}"]').getBoundingClientRect();
            return { x: box.left + box.width / 2, y: box.bottom - 12 };
        })()`);
    const held = "[...document.querySelectorAll('#keyboard .down')].map((k) => Number(k.dataset.offset))";
    const mouse = (type, { x, y }) =>
        send("Input.dispatchMouseEvent", {
            type,
            x,
            y,
            button: type === "mouseMoved" ? "none" : "left",
            buttons: type === "mouseReleased" ? 0 : 1,
            clickCount: 1,
        });
    const [c4, d4] = [await keyPoint(0), await keyPoint(2)];
    await mouse("mousePressed", c4);
    check("holding a key plays it", JSON.stringify(await evaluate(held)) === "[0]", await evaluate(held));
    await mouse("mouseMoved", d4);
    check("sliding plays the next key and lets the last go", JSON.stringify(await evaluate(held)) === "[2]");
    await mouse("mouseReleased", d4);
    check("letting go stops it", (await evaluate(held)).length === 0);
    const computer = (kind, code) =>
        evaluate(`document.body.dispatchEvent(new KeyboardEvent("${kind}", { code: "${code}", bubbles: true }))`);
    await computer("keydown", "KeyA");
    await computer("keydown", "KeyE");
    check("computer keys play by their place: A is C, E is D sharp", JSON.stringify(await evaluate(held)) === "[0,3]");
    await computer("keyup", "KeyA");
    await computer("keyup", "KeyE");
    check("and stop when let go", (await evaluate(held)).length === 0);
    const octave =
        "[document.getElementById('octave').textContent, document.querySelector('#keyboard .key').textContent]";
    await computer("keydown", "KeyX");
    check("X moves the keys an octave up", JSON.stringify(await evaluate(octave)) === '["C5","C5"]');
    await computer("keydown", "KeyZ");
    check("Z moves them back down", JSON.stringify(await evaluate(octave)) === '["C4","C4"]');
    check("the keys stay out for the next visit", (await evaluate("localStorage.getItem('dubwise-keys')")) === "true");
    await evaluate(type("keys off"));
    check("keys off puts them away", (await evaluate(keysHidden)) === true);
    await evaluate(type("keys"));
    check("keys brings them back", (await evaluate(keysHidden)) === false);

    // The guide opens beside the app, runs real commands and points at controls.
    const tryButton = (label) =>
        `[...document.querySelectorAll("#guide .try")].find((b) => b.textContent === "${label}")`;
    const guideHidden = "document.getElementById('guide').hidden";
    await evaluate("document.getElementById('guide-toggle').click()");
    check("the guide button opens the guide", (await evaluate(guideHidden)) === false);
    check("the guide lists its steps", (await evaluate("document.querySelectorAll('#guide-steps li').length")) >= 6);
    await evaluate(`${tryButton("solo bass")}.click()`);
    check(
        "a try button runs its command",
        (await evaluate(`document.querySelector('.strip[data-channel="bass"] .solo').getAttribute('aria-pressed')`)) ===
            "true",
    );
    await evaluate(`${tryButton("unsolo")}.click()`);
    await evaluate(
        `[...document.querySelectorAll("#guide li")].find((li) => li.textContent.includes("Mix like")).querySelector(".show").click()`,
    );
    check(
        "show me points at the control",
        await evaluate("document.getElementById('strips').classList.contains('spotlight')"),
    );
    await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    check("Escape closes the guide", (await evaluate(guideHidden)) === true);
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }))`);
    check("? opens the guide", (await evaluate(guideHidden)) === false);
    await evaluate("document.getElementById('guide-close').click()");

    // Themes change from the console or the menu, follow the phone bar and survive a reload.
    const theme = "document.documentElement.dataset.theme";
    const background = "getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()";
    await evaluate(type("theme jamaica"));
    check(
        "a theme from the console",
        (await evaluate(theme)) === "jamaica" && (await evaluate(background)) === "#0a0d09",
    );
    const menuHidden = "document.getElementById('theme-menu').hidden";
    const flagImage = (name) =>
        `getComputedStyle(document.querySelector('#theme-menu [data-value="${name}"] .flag')).backgroundImage`;
    await evaluate("document.getElementById('theme').click()");
    check("the theme button opens a menu of flags", (await evaluate(menuHidden)) === false);
    check(
        "each flag is drawn by its own theme",
        (await evaluate(flagImage("jamaica"))).includes("fed100") &&
            (await evaluate(flagImage("dub"))).includes("e0452b"),
    );
    await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    check("Escape closes the theme menu", (await evaluate(menuHidden)) === true);
    await evaluate("document.getElementById('theme').click()");
    await evaluate(`document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
    check("a click elsewhere closes the theme menu", (await evaluate(menuHidden)) === true);
    await evaluate("document.getElementById('theme').click()");
    await evaluate(`document.querySelector('#theme-menu [data-value="brazil"]').click()`);
    check("a flag picks its theme", (await evaluate(theme)) === "brazil" && (await evaluate(menuHidden)) === true);
    check(
        "the phone bar follows the theme",
        (await evaluate(`document.querySelector('meta[name="theme-color"]').content`)) === "#04122b",
    );
    // The model in this browser, picked on an earlier visit, in a browser without WebGPU like this headless one.
    await evaluate(`localStorage.setItem("dubwise-ai", JSON.stringify({ provider: "browser" }))`);
    await send("Page.reload");
    await wait(2000);
    check(
        "the theme survives a reload",
        (await evaluate(theme)) === "brazil" &&
            (await evaluate(`document.querySelector('#theme-menu [aria-checked="true"]').dataset.value`)) === "brazil",
    );
    const startup = await evaluate(
        `[...document.querySelectorAll("#log > div")].map((l) => [l.className, l.textContent])`,
    );
    check(
        "a saved AI this browser cannot run is noted quietly at start, not as an error",
        startup.some(([kind, text]) => kind === "dim" && text.includes("cannot run here")) &&
            !startup.some(([kind]) => kind === "err") &&
            (await evaluate("document.getElementById('ai-toggle').dataset.state")) === "error",
        startup,
    );
    await evaluate(type("ai off"));
    await evaluate("window.scrollTo(0, 0)");
    await evaluate("document.getElementById('theme').click()");
    const menuShot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, "theme-menu.png"), Buffer.from(menuShot.data, "base64"));
    await evaluate("document.getElementById('theme').click()");
    for (const name of await evaluate(
        "[...document.querySelectorAll('#theme-menu button')].map((b) => b.dataset.value)",
    )) {
        await evaluate(type(`theme ${name}`));
        await wait(100);
        const shot = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(outDir, `theme-${name}.png`), Buffer.from(shot.data, "base64"));
    }
    await evaluate(type("theme dub"));

    // The AI reader: offered when the word lists miss an idea, set up in its dialog, then reading what they miss.
    const lines = (kind) => `[...document.querySelectorAll("#log .${kind}")].map((l) => l.textContent)`;
    await evaluate(type("Martin Campbell style"));
    await wait(300);
    check(
        "with the AI off, an idea it could read brings a hint",
        (await evaluate(lines("dim"))).some((l) => l.includes("an AI can read ideas like this one")),
    );
    await evaluate("document.getElementById('ai-toggle').click()");
    await wait(300);
    check("the ai button opens its dialog", await evaluate("document.getElementById('ai-dialog').open"));
    check(
        "Chrome's model is offered exactly where the browser has one",
        await evaluate(`(async () => {
            const model = globalThis.LanguageModel;
            const availability = model
                ? await model.availability({
                      expectedInputs: [{ type: "text", languages: ["en", "es"] }],
                      expectedOutputs: [{ type: "text", languages: ["en"] }],
                  })
                : "unavailable";
            const shown = getComputedStyle(document.getElementById("ai-chrome")).display !== "none";
            return shown === (availability !== "unavailable");
        })()`),
    );
    await evaluate(`(() => {
        const form = document.getElementById("ai-form");
        form.querySelector('input[value="endpoint"]').click();
        form.elements.url.value = ${JSON.stringify(aiUrl)};
        form.elements.url.dispatchEvent(new Event("input"));
        form.elements.model.value = "test-model";
    })()`);
    await evaluate("document.getElementById('ai-try').click()");
    await wait(500);
    const tried = await evaluate("document.getElementById('ai-status').textContent");
    check(
        "a typed address picks my own address",
        (await evaluate("document.getElementById('ai-form').elements.preset.value")) === "custom",
    );
    check(
        "try shows how the AI reads an idea",
        tried.includes("spy film") && tried.includes("steppers, lively, minor"),
        tried,
    );
    const aiShot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, "ai-dialog.png"), Buffer.from(aiShot.data, "base64"));
    await evaluate(`document.querySelector('#ai-form button[value="save"]').click()`);
    await wait(200);
    check(
        "use it closes the dialog and turns the AI on",
        !(await evaluate("document.getElementById('ai-dialog').open")) &&
            (await evaluate("document.getElementById('ai-toggle').dataset.state")) === "on",
    );
    await evaluate(type("Martin Campbell style"));
    await wait(600);
    const read = (await evaluate(lines("ok"))).at(-1) ?? "";
    check("the AI reads what the word lists miss", read.includes('the AI read "martin campbell" as: spy film'), read);
    check(
        "the AI is asked only about the words dubwise does not know",
        askedAbout === "Idea: martin campbell",
        askedAbout,
    );
    // The mock picks a lively tempo, but its own words, "tense, dark", read slow, and the words win.
    const bpm = await evaluate("document.getElementById('bpm').value");
    check(
        "the riddim follows the reading's words over its picks",
        (await evaluate("document.getElementById('keyinfo').textContent")).endsWith(" minor") && bpm < 78,
        bpm,
    );
    // The dialog's try already read this idea, so composing it reused that reading. From here nothing should ask.
    const asked = aiRequests;
    await evaluate(type("again"));
    await wait(300);
    check("again reuses the reading instead of asking again", aiRequests === asked, aiRequests - asked);
    await evaluate(type("a dark steppers in D minor"));
    await wait(300);
    check("ideas the word lists cover do not go to the AI", aiRequests === asked, aiRequests - asked);
    failing = true;
    await evaluate(type("ai a lighthouse in a storm"));
    await wait(600);
    check(
        "when the AI fails, dubwise composes from its own reading",
        (await evaluate(lines("err"))).at(-1)?.includes("the AI could not read it (503 busy)") &&
            (await evaluate("document.getElementById('ai-toggle').dataset.state")) === "error",
    );
    failing = false;
    await evaluate(type("log"));
    const logged = (await evaluate(lastLog))?.text ?? "";
    check(
        "log shows what the AI read and where it failed",
        logged.includes("ai read: ai endpoint 127.0.0.1") &&
            logged.includes("ai failed:") &&
            logged.includes("503 busy"),
        logged,
    );
    check(
        "the log is kept in this browser",
        await evaluate(`JSON.parse(localStorage.getItem("dubwise-log")).some((entry) => entry.event === "visit")`),
    );
    slow = true;
    await evaluate(type("ai a ghost ship at dawn"));
    await wait(300);
    await evaluate(type("darker"));
    await wait(300);
    slow = false;
    check(
        "a newer idea drops the AI's answer and leaves nothing waiting",
        (await evaluate("document.getElementById('ai-toggle').dataset.state")) === "on" &&
            !(await evaluate(lines("dim"))).includes("asking the AI…"),
        await evaluate(lines("dim")),
    );
    await evaluate(type("ai off"));
    check("ai off turns it off", (await evaluate("document.getElementById('ai-toggle').dataset.state")) === "off");
    await evaluate(type("a volcano waking up"));
    await wait(1500);
    const own = (await evaluate(lines("ok"))).at(-1) ?? "";
    check(
        "with the AI off, dubwise's word map reads unknown words",
        own.includes('dubwise read "volcano waking up" as: minor'),
        own,
    );
    const keyBefore = await evaluate("document.getElementById('keyinfo').textContent");
    const bpmBefore = Number(await evaluate("document.getElementById('bpm').value"));
    await evaluate(type("a bit faster"));
    await wait(300);
    check(
        "a bit faster speeds up the riddim playing and keeps its key",
        Number(await evaluate("document.getElementById('bpm').value")) === bpmBefore + 6 &&
            (await evaluate("document.getElementById('keyinfo').textContent")) === keyBefore &&
            ((await evaluate(lines("ok"))).at(-1) ?? "").startsWith("the same riddim, now at"),
        await evaluate("document.getElementById('bpm').value"),
    );
    await evaluate(type("undo"));
    await wait(300);
    check("undo takes the change back", Number(await evaluate("document.getElementById('bpm').value")) === bpmBefore);

    // The dub effect pads: the switches flip, the one-shots play, and the deck moves stop or restart the riddim.
    const playing = () => evaluate("document.getElementById('play').getAttribute('aria-pressed') === 'true'");
    const pad = (name) => `document.querySelector('[data-fx="${name}"]')`;
    await evaluate(`${pad("phaser")}.click()`);
    check("the phaser pad switches on", (await evaluate(`${pad("phaser")}.getAttribute('aria-pressed')`)) === "true");
    await evaluate(type("phaser"));
    check(
        "phaser typed switches it off",
        (await evaluate(`${pad("phaser")}.getAttribute('aria-pressed')`)) === "false",
    );
    await evaluate(`${pad("crash")}.click(); ${pad("horn")}.click()`);
    await evaluate(type("kill low"));
    check(
        "kill low switches the low kill on",
        (await evaluate(`${pad("kill-low")}.getAttribute('aria-pressed')`)) === "true",
    );
    await evaluate(type("kill low off"));
    if (!(await playing())) await evaluate("document.getElementById('play').click()");
    await evaluate(`${pad("tape-stop")}.click()`);
    await wait(2000);
    check("tape stop halts the riddim", !(await playing()));
    await evaluate("document.getElementById('play').click()");
    await wait(300);
    await evaluate(type("pull up"));
    await wait(1200);
    const pulled = !(await playing());
    await wait(1500);
    check("pull up stops the riddim and plays it again from the top", pulled && (await playing()), pulled);

    // The selector answers talk in the console and plays what it offers.
    await evaluate(type("hi"));
    await wait(300);
    const greeting = (await evaluate(lines("sel"))).join(" ");
    check("the selector greets with the mood of the day", greeting.includes("Today's mood:"), greeting.slice(0, 120));
    await evaluate(type("play it"));
    await wait(800);
    const moodPlayed = (await evaluate(lines("ok"))).at(-1) ?? "";
    check("play it composes the mood", / bpm in /.test(moodPlayed), moodPlayed);
    await evaluate(type("who is King Tubby?"));
    await wait(300);
    const told = await evaluate(lines("sel"));
    check(
        "the selector tells the story behind a name",
        told.some((line) => line.startsWith("King Tubby: Osbourne Ruddock")),
        told.slice(-3),
    );

    for (const [name, width, height, mobile] of [
        ["desktop", 1280, 1000, false],
        ["phone", 390, 844, true],
    ]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
        await wait(300);
        const shown = await evaluate(
            "[...document.querySelectorAll('#keyboard .key')].filter((k) => k.getClientRects().length).length",
        );
        check(`${name}: ${mobile ? "one octave" : "two octaves"} of keys`, shown === (mobile ? 13 : 25), shown);
        const edge = await evaluate(`(() => {
            const main = document.querySelector("main");
            const inner = main.getBoundingClientRect().right - parseFloat(getComputedStyle(main).paddingRight);
            return document.getElementById("guide-toggle").getBoundingClientRect().right - inner;
        })()`);
        check(`${name}: the top buttons stay inside the margin`, edge <= 0.5, edge);
        // Compare with the device width: a mobile browser zooms out to fit a page that is too wide.
        const overflow = await evaluate(`document.documentElement.scrollWidth - ${width}`);
        check(`${name}: no sideways page scroll`, overflow <= 0, overflow);
        const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        writeFileSync(join(outDir, `${name}.png`), Buffer.from(shot.data, "base64"));
        await evaluate("document.getElementById('guide-toggle').click()");
        await wait(300);
        const guideOverflow = await evaluate(`document.documentElement.scrollWidth - ${width}`);
        check(`${name}: no sideways page scroll with the guide open`, guideOverflow <= 0, guideOverflow);
        const guideShot = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(outDir, `${name}-guide.png`), Buffer.from(guideShot.data, "base64"));
        await evaluate("document.getElementById('guide-close').click()");
        await evaluate("window.scrollTo(0, 0); document.getElementById('theme').click()");
        await wait(200);
        const themeShot = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(outDir, `${name}-theme-menu.png`), Buffer.from(themeShot.data, "base64"));
        await evaluate("document.getElementById('theme').click()");
    }
    check("no errors while playing", page.errors.length === 0, page.errors);
});

aiServer.close();
console.log(failures.length ? `${failures.length} check(s) failed` : `all checks passed, screenshots in ${outDir}`);
process.exit(failures.length ? 1 : 0);
