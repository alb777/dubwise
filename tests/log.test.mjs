import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLog, describeEntry } from "../src/log.js";

/** A stand-in for localStorage. */
const memoryStorage = () => {
    const items = new Map();
    return {
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => items.set(key, String(value)),
    };
};
const blocked = {
    getItem: () => {
        throw new Error("SecurityError");
    },
    setItem: () => {
        throw new Error("SecurityError");
    },
};
const at = new Date("2026-10-15T08:31:02Z");

describe("the action log", () => {
    it("notes what happened, when and in which visit", () => {
        const log = createLog({ storage: memoryStorage(), now: () => at });
        log.add("typed", { text: "a volcano at night" });
        log.add("ai failed", { ai: "browser Qwen3.5 2B", seconds: 30, error: "no answer after 30 seconds" });
        const [typed, failed] = log.entries();
        assert.deepEqual(typed, {
            at: at.toISOString(),
            visit: typed.visit,
            event: "typed",
            text: "a volcano at night",
        });
        assert.equal(failed.error, "no answer after 30 seconds");
        assert.equal(failed.visit, typed.visit);
        assert.match(typed.visit, /^[a-z0-9]+$/);
    });

    it("keeps its entries for the next visit, and tells the visits apart", () => {
        const storage = memoryStorage();
        createLog({ storage }).add("typed", { text: "play" });
        const next = createLog({ storage });
        next.add("typed", { text: "stop" });
        const [first, second] = next.entries();
        assert.deepEqual([first.text, second.text], ["play", "stop"]);
        assert.notEqual(first.visit, second.visit);
    });

    it("keeps only the latest entries", () => {
        const log = createLog({ storage: memoryStorage(), limit: 3 });
        for (const text of ["1", "2", "3", "4", "5"]) log.add("typed", { text });
        assert.deepEqual(
            log.entries().map((entry) => entry.text),
            ["3", "4", "5"],
        );
    });

    it("adds to the entries of another tab instead of writing over them", () => {
        const storage = memoryStorage();
        const tab = createLog({ storage });
        const other = createLog({ storage });
        tab.add("typed", { text: "here" });
        other.add("typed", { text: "there" });
        assert.deepEqual(
            tab.entries().map((entry) => entry.text),
            ["here", "there"],
        );
    });

    it("cuts long texts short, as a pasted riddim", () => {
        const log = createLog({ storage: memoryStorage() });
        log.add("typed", { text: `dubwise 1\n${"kick x...".repeat(100)}` });
        const [{ text }] = log.entries();
        assert.equal(text.length, 301);
        assert.ok(text.endsWith("…"));
    });

    it("still holds this visit when storage is blocked", () => {
        const log = createLog({ storage: blocked });
        log.add("typed", { text: "play" });
        assert.deepEqual(
            log.entries().map((entry) => entry.text),
            ["play"],
        );
        log.clear();
        assert.deepEqual(log.entries(), []);
    });

    it("empties on clear", () => {
        const storage = memoryStorage();
        const log = createLog({ storage });
        log.add("typed", { text: "play" });
        log.clear();
        assert.deepEqual(createLog({ storage }).entries(), []);
    });

    it("reads as one console line per entry", () => {
        const line = describeEntry({
            at: at.toISOString(),
            visit: "k3x9q1",
            event: "ai read",
            seconds: 2.4,
            reading: { mode: "minor" },
        });
        assert.match(line, /^\d\d:\d\d:\d\d ai read: seconds 2.4, reading {"mode":"minor"}$/);
        assert.doesNotMatch(line, /k3x9q1/);
        assert.match(
            describeEntry({ at: at.toISOString(), visit: "k3x9q1", event: "visit" }),
            /^\d\d:\d\d:\d\d visit$/,
        );
    });
});
