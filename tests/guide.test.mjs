import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { compose } from "../skills/dubwise/scripts/composer.mjs";
import { parseCommand } from "../src/console.js";
import { GUIDE } from "../src/guide.js";

const html = readFileSync(join(import.meta.dirname, "..", "index.html"), "utf8");

describe("guide", () => {
    it("runs only commands the console understands", () => {
        for (const step of GUIDE) {
            for (const command of step.try ?? []) {
                const parsed = parseCommand(command);
                assert.ok(parsed && parsed.type !== "error", `${step.title}: "${command}" ${JSON.stringify(parsed)}`);
                if (parsed.type === "compose") assert.ok(compose(command).understood, command);
            }
        }
    });

    it("points only at controls on the page", () => {
        for (const { title, show } of GUIDE) {
            if (!show) continue;
            const [, kind, name] = /^([#.])([a-z-]+)$/.exec(show) ?? [];
            const found =
                kind === "#" ? html.includes(`id="${name}"`) : new RegExp(`class="[^"]*\\b${name}\\b[^"]*"`).test(html);
            assert.ok(found, `${title}: ${show} is not in index.html`);
        }
    });

    it("gives every step a title and some text", () => {
        for (const step of GUIDE) assert.ok(step.title && step.text, JSON.stringify(step));
    });
});
