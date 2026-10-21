#!/usr/bin/env node
// @ts-nocheck
/**
 * dubwise from the command line: the same composer and notation the app uses, without a browser. Meant for the
 * agent skill in SKILL.md and for a shell: compose a riddim from an idea, refine the one you have, check it and
 * share it.
 *
 *   node skills/dubwise/cli.mjs compose "a dark steppers in D minor"
 *   node skills/dubwise/cli.mjs compose "a melody for the melodica" --take 1 --json
 *   node skills/dubwise/cli.mjs refine "a bit faster" --riddim riddim.txt
 *   node skills/dubwise/cli.mjs check riddim.txt
 *   node skills/dubwise/cli.mjs url riddim.txt
 *   node skills/dubwise/cli.mjs spec
 *
 * The notation goes to stdout and the reading of the idea to stderr, so `> riddim.txt` keeps only the riddim.
 * Exit codes: 0 done, 1 bad idea or invalid notation, 2 bad usage, 3 not a change (compose a new one instead).
 *
 * Node's process, stdin and fs are left out of the project's type set (tsconfig has "types": []), so this file
 * opts out of the check and keeps the notation itself fully checked.
 */
import { readFileSync } from "node:fs";
import { compose, refine } from "./scripts/composer.mjs";
import { parse, SPEC, toUrl } from "./scripts/notation.mjs";

const USAGE = `dubwise: a dub riddim from words, the same composer the app uses.

node skills/dubwise/cli.mjs compose <idea...> [--take N] [--json]
node skills/dubwise/cli.mjs refine <change...> --riddim <file|->
node skills/dubwise/cli.mjs check <file|->
node skills/dubwise/cli.mjs url <file|->
node skills/dubwise/cli.mjs spec

Flags:
  --take N          composer take: 0 for the first version, 1, 2... for others
  --json            compose prints { understood, text, summary, intent, url } as JSON
  --riddim <file>   the notation to refine or read, or - for stdin

The notation goes to stdout, the reading of the idea to stderr.`;

/** @param {string} message @param {number} [code] */
function fail(message, code = 1) {
    console.error(message);
    process.exit(code);
}

/** Read notation from a file, or from stdin with "-". @param {string | null} path */
function readText(path) {
    if (!path || path === "-") return readFileSync(0, "utf8");
    try {
        return readFileSync(path, "utf8");
    } catch {
        return fail(`cannot read ${path}`);
    }
}

/** Parse notation and fail on every error, with its line. @param {string} text */
function readRiddim(text) {
    const { riddim, errors } = parse(text);
    if (!riddim) {
        for (const error of errors) console.error(`line ${error.line}: ${error.message}`);
        process.exit(1);
    }
    return riddim;
}

const [command, ...args] = process.argv.slice(2);
if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    process.exit(command ? 0 : 2);
}

const options = { take: 0, json: false, riddim: null };
/** @type {string[]} */
const words = [];
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--take") {
        options.take = Number(args[++i]);
        if (!Number.isInteger(options.take) || options.take < 0) fail("--take wants a whole number from 0", 2);
    } else if (arg === "--json") {
        options.json = true;
    } else if (arg === "--riddim") {
        options.riddim = args[++i] ?? "";
        if (!options.riddim) fail("--riddim wants a file, or - for stdin", 2);
    } else if (arg.startsWith("--")) {
        fail(`unknown option ${arg}`, 2);
    } else {
        words.push(arg);
    }
}

switch (command) {
    case "spec": {
        console.log(SPEC);
        break;
    }
    case "compose": {
        const idea = words.join(" ");
        if (!idea) fail('compose wants an idea, as in compose "a dark steppers in D minor"', 2);
        const result = compose(idea, options.take);
        if (!result.understood) fail(result.summary);
        if (options.json) {
            console.log(JSON.stringify({ ...result, url: toUrl(result.text) }, null, 2));
        } else {
            console.log(result.text);
            console.error(result.summary);
        }
        break;
    }
    case "refine": {
        const change = words.join(" ");
        if (!change) fail('refine wants a change, as in refine "a bit faster"', 2);
        const result = refine(change, readText(options.riddim));
        if (!result) {
            console.error(`"${change}" is not a change to this riddim: compose a new one instead`);
            process.exit(3);
        }
        console.log(result.text);
        console.error(result.summary);
        break;
    }
    case "check": {
        const riddim = readRiddim(readText(words[0]));
        console.log(
            `ok, ${riddim.bars} bar${riddim.bars === 1 ? "" : "s"}, ${riddim.bpm} bpm, ` +
                `${riddim.key.root} ${riddim.key.mode}${riddim.lead.length ? ", with a melody" : ""}`,
        );
        break;
    }
    case "url": {
        const text = readText(words[0]);
        readRiddim(text);
        console.log(toUrl(text));
        break;
    }
    default: {
        fail(`unknown command "${command}"`, 2);
    }
}
