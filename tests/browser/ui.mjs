// Loads the app in a headless browser, clicks and types like a player, and saves screenshots.
// Usage: node tests/browser/ui.mjs [screenshot-dir]   (BROWSER=chromium to pick another browser)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, withPage } from "./cdp.mjs";

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
    }
    check("no errors while playing", page.errors.length === 0, page.errors);
});

console.log(failures.length ? `${failures.length} check(s) failed` : `all checks passed, screenshots in ${outDir}`);
process.exit(failures.length ? 1 : 0);
