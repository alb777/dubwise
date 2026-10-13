// Sets the service worker's cache VERSION to a hash of every file it precaches, so any change to the app
// reaches returning visitors. The test suite fails when the stamped version is stale.
// Usage: node tools/sw-version.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** The PRECACHE list from sw.js. */
export function precacheList(sw) {
    return JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(sw)[1].replace(/,\s*\]/, "]"));
}

/** Cache name for the word map, which is cached the first time an idea needs it rather than precached. */
export function lexiconVersion() {
    const hash = createHash("sha256").update(readFileSync(join(ROOT, "skills/dubwise/assets/lexicon.bin")));
    return `lexicon-${hash.digest("hex").slice(0, 10)}`;
}

/** Version string for the current contents of the precached files. */
export function contentVersion(sw) {
    const hash = createHash("sha256");
    for (const path of precacheList(sw)
        .filter((p) => p !== "./")
        .sort()) {
        hash.update(path);
        hash.update(readFileSync(join(ROOT, path)));
    }
    return `dubwise-${hash.digest("hex").slice(0, 10)}`;
}

if (import.meta.main) {
    const file = join(ROOT, "sw.js");
    const sw = readFileSync(file, "utf8");
    const version = contentVersion(sw);
    const lexicon = lexiconVersion();
    writeFileSync(
        file,
        sw
            .replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`)
            .replace(/const LEXICON_CACHE = "[^"]*";/, `const LEXICON_CACHE = "${lexicon}";`),
    );
    console.log(version, lexicon);
}
