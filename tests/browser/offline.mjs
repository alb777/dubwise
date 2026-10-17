// Checks the published app works offline: load it once, cut the network, reload, play with it.
// Usage: node tests/browser/offline.mjs [url]
import { withPage } from "./cdp.mjs";

const url = process.argv[2] ?? "https://alb777.github.io/dubwise/";
const failures = [];
const check = (name, ok, detail) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${JSON.stringify(detail)}`}`);
    if (!ok) failures.push(name);
};

await withPage(url, async ({ evaluate, send, wait, errors }) => {
    await wait(2500);
    await send("Page.reload");
    await wait(2500);
    const controlled = await evaluate("Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)");
    check("the service worker controls the page", controlled);

    await send("Network.enable");
    await send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
    });
    await send("Page.reload");
    await wait(2500);
    check("the page loads with the network off", (await evaluate("document.querySelectorAll('.cell').length")) === 96);
    check("the preset loads offline", (await evaluate("document.getElementById('bpm').value")) === "72");

    await evaluate(`(() => {
        const box = document.getElementById("command");
        box.value = "a dark steppers in D minor";
        box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    })()`);
    await wait(500);
    const summary = await evaluate(
        `[...document.querySelectorAll("#log .ok")].map((l) => l.textContent).find((t) => t.includes("steppers"))`,
    );
    check("the composer works offline", summary?.includes("D minor"), summary);
    check("no errors", errors.length === 0, errors);
});

console.log(failures.length ? `${failures.length} check(s) failed` : `offline checks passed on ${url}`);
process.exit(failures.length ? 1 : 0);
