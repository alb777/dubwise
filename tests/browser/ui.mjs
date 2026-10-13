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
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(SPY_FILM) } }] }));
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
    check("draws 6 channel strips", (await evaluate("document.querySelectorAll('.strip').length")) === 6);
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
    await send("Page.reload");
    await wait(1000);
    check(
        "the theme survives a reload",
        (await evaluate(theme)) === "brazil" &&
            (await evaluate(`document.querySelector('#theme-menu [aria-checked="true"]').dataset.value`)) === "brazil",
    );
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
    check(
        "the riddim follows the reading",
        (await evaluate("document.getElementById('keyinfo').textContent")).endsWith(" minor") &&
            (await evaluate("document.getElementById('bpm').value")) >= 78,
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

    for (const [name, width, height, mobile] of [
        ["desktop", 1280, 1000, false],
        ["phone", 390, 844, true],
    ]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
        await wait(300);
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
