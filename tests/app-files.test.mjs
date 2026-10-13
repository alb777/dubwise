import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { contentVersion, lexiconVersion } from "../tools/sw-version.mjs";

const ROOT = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

describe("offline app", () => {
    const sw = read("sw.js");
    const precache = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(sw)[1].replace(/,\s*\]/, "]"));

    it("precaches only files that exist", () => {
        for (const path of precache) {
            if (path === "./") continue;
            assert.ok(existsSync(join(ROOT, path)), `${path} is in the precache list but missing`);
        }
    });

    it("precaches every source module and preset", () => {
        const expected = [
            ...readdirSync(join(ROOT, "src")).map((name) => `src/${name}`),
            ...readdirSync(join(ROOT, "skills/dubwise/assets/riddims")).map(
                (n) => `skills/dubwise/assets/riddims/${n}`,
            ),
            ...readdirSync(join(ROOT, "skills/dubwise/scripts")).map((name) => `skills/dubwise/scripts/${name}`),
        ];
        for (const path of expected) assert.ok(precache.includes(path), `${path} is not precached`);
    });

    it("versions the offline cache by content, so updates reach returning visitors", () => {
        const stamped = /const VERSION = "([^"]*)";/.exec(sw)[1];
        assert.equal(stamped, contentVersion(sw), "a precached file changed: run npm run sw:version");
    });

    it("names the word map's cache by its content, so a rebuilt map replaces the old one", () => {
        const stamped = /const LEXICON_CACHE = "([^"]*)";/.exec(sw)[1];
        assert.equal(stamped, lexiconVersion(), "the word map changed: run npm run sw:version");
    });

    it("has a manifest with installable icons", () => {
        const manifest = JSON.parse(read("manifest.webmanifest"));
        for (const icon of manifest.icons) assert.ok(existsSync(join(ROOT, icon.src)), icon.src);
        assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.type === "image/png"));
        assert.equal(manifest.display, "standalone");
    });

    it("only references local files from the page", () => {
        const html = read("index.html");
        for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
            if (ref.startsWith("https://github.com/")) continue;
            assert.ok(existsSync(join(ROOT, ref)), `index.html references missing ${ref}`);
        }
    });
});
