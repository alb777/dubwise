import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { THEMES } from "../src/console.js";

const css = readFileSync(join(import.meta.dirname, "..", "styles.css"), "utf8");

/** Colour tokens per theme: dub from :root, the others from their [data-theme] block. */
const palettes = new Map();
for (const [, selector, name, body] of css.matchAll(/(:root|\[data-theme="([a-z-]+)"\])\s*\{([^}]*)\}/g)) {
    const theme = selector === ":root" ? "dub" : name;
    const colours = palettes.get(theme) ?? {};
    for (const [, token, value] of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/g)) colours[token] = value;
    palettes.set(theme, colours);
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex) {
    const [r, g, b] = [1, 3, 5]
        .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}

/**
 * [foreground, background, minimum ratio]. 4.5 is WCAG AA for text, 3 for controls and graphics: borders that keep
 * a button visible, lit steps against empty ones.
 */
const RULES = [
    ["text", "bg", 7],
    ["text", "panel", 7],
    ["text", "panel-2", 7],
    ["text", "control", 4.5],
    ["muted", "bg", 4.5],
    ["muted", "panel", 4.5],
    ["muted", "panel-2", 4.5],
    ["accent", "panel", 4.5],
    ["accent", "panel-2", 3],
    ["accent", "lit", 4.5],
    ["hot", "panel", 4.5],
    ["hot", "panel-2", 3],
    ["cool", "panel", 4.5],
    ["cool", "panel-2", 4.5],
    ["on-accent", "accent", 4.5],
    ["on-hot", "hot", 4.5],
    ["on-cool", "cool", 4.5],
    ["control-line", "panel", 3],
    ["control-line", "panel-2", 3],
];

describe("colour themes", () => {
    it("has a block in styles.css for every theme and no other", () => {
        assert.deepEqual([...palettes.keys()].sort(), Object.keys(THEMES).sort());
    });

    it("sets every colour in every theme", () => {
        const tokens = Object.keys(palettes.get("dub")).sort();
        for (const [theme, colours] of palettes) assert.deepEqual(Object.keys(colours).sort(), tokens, theme);
    });

    it("keeps text readable and buttons visible in every theme", () => {
        const failures = [];
        for (const [theme, colours] of palettes) {
            for (const [fore, back, minimum] of RULES) {
                const ratio = contrast(colours[fore], colours[back]);
                if (ratio < minimum)
                    failures.push(`${theme}: ${fore} on ${back} is ${ratio.toFixed(2)}, needs ${minimum}`);
            }
        }
        assert.deepEqual(failures, []);
    });

    it("tells accents, mutes and solos apart from the lit steps", () => {
        for (const [theme, colours] of palettes) {
            assert.notEqual(colours.hot, colours.accent, `${theme}: hot and accent`);
            assert.notEqual(colours.cool, colours.accent, `${theme}: cool and accent`);
            assert.notEqual(colours.hot, colours.cool, `${theme}: hot and cool`);
        }
    });
});
