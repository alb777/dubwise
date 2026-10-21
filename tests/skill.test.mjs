// The agent skill: the CLI runs the same composer offline, and SKILL.md and llms.txt point at what exists.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fromHash, parse, SPEC } from "../skills/dubwise/scripts/notation.mjs";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "skills", "dubwise", "cli.mjs");

/**
 * Run the CLI and keep its output, exit code included.
 * @param {string[]} args @param {string} [input] stdin
 */
function run(args, input) {
    const { status, stdout, stderr } = spawnSync("node", [CLI, ...args], { input, encoding: "utf8" });
    return { code: status, stdout, stderr };
}

/** @param {string} args */
const compose = (...args) => run(["compose", ...args]);

describe("the dubwise CLI", () => {
    it("prints the notation reference", () => {
        const { code, stdout } = run(["spec"]);
        assert.equal(code, 0);
        assert.equal(stdout.trimEnd(), SPEC);
    });

    it("writes a valid riddim from an idea, with the reading on stderr", () => {
        const { code, stdout, stderr } = compose("a slow one drop for a rainy night");
        assert.equal(code, 0);
        assert.equal(parse(stdout).errors.length, 0);
        assert.match(stderr, /one drop at \d+ bpm/);
    });

    it("writes a melodica line when the idea asks for a melody", () => {
        const { stdout } = compose("a melodic theme for the keyboard in A minor");
        const riddim = parse(stdout).riddim;
        assert.ok(riddim);
        assert.ok(riddim.lead.length >= 16, `${riddim.lead.length} lead steps`);
    });

    it("gives another version for another take, and JSON when asked", () => {
        const first = compose("a dark steppers", "--take", "0");
        const second = compose("a dark steppers", "--take", "1");
        assert.notEqual(second.stdout, first.stdout);
        const { stdout } = compose("a dark steppers", "--take", "2", "--json");
        const answer = JSON.parse(stdout);
        assert.equal(answer.understood, true);
        assert.equal(parse(answer.text).errors.length, 0);
        assert.equal(fromHash(new URL(answer.url).hash), answer.text.trim());
    });

    it("turns down a request without words, and one without an idea", () => {
        assert.notEqual(compose("").code, 0);
        assert.equal(run(["compose"]).code, 2);
    });

    it("checks notation and names the line that is wrong", () => {
        const riddim = compose("a rockers in D minor").stdout;
        assert.match(run(["check", "-"], riddim).stdout, /^ok, \d+ bars?/);
        const broken = riddim.replace(/^bpm \d+$/m, "bpm 400");
        const { code, stderr } = run(["check", "-"], broken);
        assert.equal(code, 1);
        assert.match(stderr, /^line \d+: bpm must be a number from 50 to 200$/m);
    });

    it("refines the riddim it is given, and refuses an idea that brings something new", () => {
        const riddim = compose("a one drop in A minor").stdout;
        const faster = run(["refine", "a bit faster", "--riddim", "-"], riddim);
        assert.equal(faster.code, 0);
        assert.ok(parse(faster.stdout).riddim.bpm > parse(riddim).riddim.bpm);
        const fresh = run(["refine", "inspired by King Tubby", "--riddim", "-"], riddim);
        assert.equal(fresh.code, 3);
        assert.match(fresh.stderr, /compose a new one instead/);
    });

    it("turns the riddim it reads into a link that carries it", () => {
        const riddim = compose("a steppers in E minor").stdout;
        const { code, stdout } = run(["url", "-"], riddim);
        assert.equal(code, 0);
        assert.ok(stdout.startsWith("https://alb777.github.io/dubwise/#r="));
        assert.equal(fromHash(new URL(stdout.trim()).hash), riddim.trim());
    });
});

describe("the agent skill files", () => {
    /**
     * The frontmatter of a skill, as a plain map of its keys.
     * @param {string} text
     */
    const frontmatter = (text) => {
        const match = /^---\n([\s\S]*?)\n---/.exec(text);
        assert.ok(match, "no frontmatter");
        return Object.fromEntries(
            match[1]
                .split("\n")
                .map((line) => /^([a-z]+):\s*(.*)$/.exec(line))
                .filter(Boolean)
                .map(([, key, value]) => [key, value.trim()]),
        );
    };

    it("names the skill and says when to use it", () => {
        const skill = readFileSync(join(ROOT, "skills", "dubwise", "SKILL.md"), "utf8");
        const head = frontmatter(skill);
        assert.equal(head.name, "dubwise");
        assert.ok(head.description.length > 80);
        for (const command of ["compose", "refine", "check", "url", "spec"]) {
            assert.match(skill, new RegExp(`cli\\.mjs ${command}`), `${command} is not documented`);
        }
    });

    it("keeps llms.txt pointing at files that exist", () => {
        const llms = readFileSync(join(ROOT, "llms.txt"), "utf8");
        const links = [...llms.matchAll(/\]\(([^)]+)\)/g)]
            .map(([, link]) => link)
            .filter((link) => !/^https?:/.test(link));
        assert.ok(links.length >= 4, `${links.length} local links`);
        for (const link of links) assert.ok(existsSync(join(ROOT, link)), `${link} does not exist`);
    });
});
