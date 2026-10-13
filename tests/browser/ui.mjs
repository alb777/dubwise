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
    await evaluate(`(() => {
        const menu = document.getElementById("theme");
        menu.value = "brazil";
        menu.dispatchEvent(new Event("change"));
    })()`);
    check("a theme from the menu", (await evaluate(theme)) === "brazil");
    check(
        "the phone bar follows the theme",
        (await evaluate(`document.querySelector('meta[name="theme-color"]').content`)) === "#04122b",
    );
    await send("Page.reload");
    await wait(1000);
    check(
        "the theme survives a reload",
        (await evaluate(theme)) === "brazil" && (await evaluate("document.getElementById('theme').value")) === "brazil",
    );
    await evaluate("window.scrollTo(0, 0)");
    for (const name of await evaluate("[...document.getElementById('theme').options].map((o) => o.value)")) {
        await evaluate(type(`theme ${name}`));
        await wait(100);
        const shot = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(outDir, `theme-${name}.png`), Buffer.from(shot.data, "base64"));
    }
    await evaluate(type("theme dub"));

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
    }
    check("no errors while playing", page.errors.length === 0, page.errors);
});

console.log(failures.length ? `${failures.length} check(s) failed` : `all checks passed, screenshots in ${outDir}`);
process.exit(failures.length ? 1 : 0);
