// Renders every preset with the browser's own Web Audio and checks the levels.
// Usage: node tests/browser/audio.mjs   (BROWSER=chromium to pick another browser)
import { withPage } from "./cdp.mjs";

let output = "pending";
await withPage("/tests/browser/check.html", async (page) => {
    for (let i = 0; i < 120 && output === "pending"; i++) {
        await page.wait(500);
        output = await page.evaluate("document.getElementById('result')?.textContent ?? 'pending'");
    }
    if (page.errors.length) console.error(page.errors.join("\n"));
});
console.log(output);
process.exit(output !== "pending" && JSON.parse(output).ok === true ? 0 : 1);
