// @ts-check
/**
 * Free-text riddim composer. Reads an idea in English, Portuguese or Spanish, picks out style, tempo,
 * key, mood and artist references, and writes a valid riddim. Deterministic: the same idea and take
 * give the same riddim, and the next take gives another version.
 *
 * Artist references shape style, tempo and feel only. Nothing here holds or copies a real song.
 */
import { bassMidi, parse, STEPS_PER_BAR } from "./notation.mjs";

/** @typedef {"one-drop" | "rockers" | "steppers"} Style */
/** @typedef {"major" | "minor"} Mode */
/** @typedef {"low" | "mid" | "high"} Amount */
/** @typedef {"sparse" | "normal" | "busy"} Density */
/** @typedef {"root" | "melodic"} BassMove */
/**
 * @typedef {{ name: string, aliases: string[], style: Style, bpm: number, mode: Mode, echo: Amount,
 *   density: Density, bass: BassMove, traits: string }} Artist
 * @typedef {{ style?: Style, bpm?: number, tempo?: "slow" | "fast", root?: string, mode?: Mode, echo?: Amount,
 *   density?: Density, bass?: BassMove, artist?: Artist, unknownReference?: string, matched: string[] }} Intent
 */

/**
 * Style traits commonly associated with artists and scenes. Broad strokes, no songs.
 * @type {Artist[]}
 */
export const ARTISTS = [
    {
        name: "Augustus Pablo",
        aliases: ["augustus pablo", "pablo"],
        style: "rockers",
        bpm: 74,
        mode: "minor",
        echo: "high",
        density: "sparse",
        bass: "melodic",
        traits: "minor-key Far East mood, deep melodic bass, spacious echo",
    },
    {
        name: "King Tubby",
        aliases: ["king tubby", "tubbys", "tubby"],
        style: "one-drop",
        bpm: 72,
        mode: "minor",
        echo: "high",
        density: "sparse",
        bass: "melodic",
        traits: "heavy echo and spring, channels dropping in and out",
    },
    {
        name: "Lee Perry",
        aliases: ["lee scratch perry", "lee perry", "scratch perry", "upsetter", "black ark"],
        style: "one-drop",
        bpm: 68,
        mode: "minor",
        echo: "high",
        density: "busy",
        bass: "melodic",
        traits: "slow, dense and swampy, soaked in spring",
    },
    {
        name: "Scientist",
        aliases: ["scientist"],
        style: "one-drop",
        bpm: 72,
        mode: "minor",
        echo: "high",
        density: "sparse",
        bass: "root",
        traits: "sparse and dramatic, long echo throws",
    },
    {
        name: "Sly & Robbie",
        aliases: ["sly and robbie", "sly & robbie", "sly dunbar", "robbie shakespeare", "black uhuru"],
        style: "rockers",
        bpm: 76,
        mode: "minor",
        echo: "low",
        density: "busy",
        bass: "root",
        traits: "tight, driving rockers drums under a heavy bass",
    },
    {
        name: "Jah Shaka",
        aliases: ["jah shaka", "shaka"],
        style: "steppers",
        bpm: 74,
        mode: "minor",
        echo: "high",
        density: "busy",
        bass: "root",
        traits: "militant UK steppers, heavy sub, sirens",
    },
    {
        name: "Mad Professor",
        aliases: ["mad professor", "ariwa"],
        style: "steppers",
        bpm: 76,
        mode: "minor",
        echo: "high",
        density: "sparse",
        bass: "melodic",
        traits: "spacey UK dub, effects up front",
    },
    {
        name: "UK steppers",
        aliases: ["iration steppas", "zion train", "uk steppers", "uk dub"],
        style: "steppers",
        bpm: 76,
        mode: "minor",
        echo: "high",
        density: "busy",
        bass: "root",
        traits: "four on the floor and a heavy sub",
    },
    {
        name: "The Wailers",
        aliases: ["bob marley", "marley", "wailers", "carlton barrett", "family man"],
        style: "one-drop",
        bpm: 74,
        mode: "minor",
        echo: "low",
        density: "busy",
        bass: "melodic",
        traits: "roots one drop, melodic bass, skank on 2 and 4",
    },
    {
        name: "Burning Spear",
        aliases: ["burning spear"],
        style: "one-drop",
        bpm: 70,
        mode: "minor",
        echo: "low",
        density: "sparse",
        bass: "root",
        traits: "hypnotic roots one drop",
    },
    {
        name: "dub techno",
        aliases: ["basic channel", "rhythm and sound", "rhythm & sound", "dub techno"],
        style: "steppers",
        bpm: 118,
        mode: "minor",
        echo: "high",
        density: "sparse",
        bass: "root",
        traits: "minimal four on the floor, chords drowned in echo",
    },
];

/** Words per meaning, accents stripped, matched as whole words or phrases. Longer phrases are checked first. */
const WORDS = {
    "one-drop": ["one drop", "onedrop", "one-drop", "roots"],
    rockers: ["rockers", "rocker"],
    steppers: [
        "steppers",
        "stepper",
        "steppa",
        "steppas",
        "militant",
        "militante",
        "four on the floor",
        "quatro por quatro",
        "4/4",
    ],
    slow: ["slow", "lento", "lenta", "devagar", "calmo", "calma", "relaxed", "relaxado", "chill", "despacio"],
    fast: ["fast", "rapido", "rapida", "acelerado", "quick", "upbeat", "veloz"],
    minor: [
        "dark",
        "sombrio",
        "sombria",
        "escuro",
        "escura",
        "oscuro",
        "pesado",
        "pesada",
        "heavy",
        "triste",
        "sad",
        "melancolico",
        "melancolica",
        "melancholic",
        "mystic",
        "mistico",
        "mistica",
        "mystical",
        "eerie",
        "minor",
        "menor",
    ],
    major: [
        "happy",
        "alegre",
        "feliz",
        "bright",
        "sunny",
        "ensolarado",
        "solar",
        "uplifting",
        "positivo",
        "major",
        "maior",
    ],
    dry: ["sem eco", "no echo", "without echo", "dry", "seco", "seca", "clean", "limpo"],
    wet: [
        "muito eco",
        "lots of echo",
        "much echo",
        "echo",
        "eco",
        "delay",
        "spacey",
        "espacial",
        "cosmic",
        "cosmico",
        "space",
        "dubby",
        "reverb",
        "wet",
        "profundo",
        "deep",
    ],
    sparse: ["minimal", "minimalista", "sparse", "esparso", "vazio", "simple", "simples", "stripped", "cru"],
    busy: [
        "busy",
        "agitado",
        "agitada",
        "cheio",
        "cheia",
        "dense",
        "denso",
        "groovy",
        "dancante",
        "dance",
        "danceable",
        "bubble",
    ],
    melodic: ["melodic", "melodico", "melodica", "walking", "caminhante", "andando"],
    root: ["heavy bass", "baixo pesado", "bajo pesado", "sub", "pounding", "root"],
    generic: [
        "riddim",
        "dub",
        "reggae",
        "beat",
        "groove",
        "ritmo",
        "base",
        "create",
        "crie",
        "cria",
        "criar",
        "make",
        "faz",
        "faca",
        "fazer",
        "gera",
        "gere",
        "gerar",
        "generate",
        "compose",
        "componha",
        "compor",
        "crea",
        "haz",
    ],
};
/** Phrases that ask for a reference. An unknown name after them still counts as a request. */
const REFERENCE_MARKERS = [
    "inspired by",
    "inspirado em",
    "inspirada em",
    "inspirado no",
    "inspirado na",
    "inspirado por",
    "inspirado en",
    "in the style of",
    "no estilo de",
    "estilo de",
    "al estilo de",
];
const SOLFEGE = /** @type {Record<string, string>} */ ({
    do: "C",
    re: "D",
    mi: "E",
    fa: "F",
    sol: "G",
    la: "A",
    si: "B",
});
const KEY_PREFIXES = new Set(["in", "em", "en", "key", "tom", "tonalidade", "tono"]);
const STYLE_BPM = { "one-drop": 72, rockers: 76, steppers: 74 };
const STYLE_SWING = { "one-drop": 0.15, rockers: 0.08, steppers: 0 };
const MINOR_ROOTS = ["A", "D", "E", "G", "C", "B", "F#"];
const MAJOR_ROOTS = ["C", "G", "D", "F", "A", "E"];
const PROGRESSIONS = {
    minor: [
        [["1"], ["4"]],
        [["1"], ["7"]],
        [["1"], ["6"]],
        [
            ["1", "4"],
            ["5", "1"],
        ],
        [["1"], ["1"]],
    ],
    major: [
        [["1"], ["4"]],
        [["1"], ["5"]],
        [
            ["1", "4"],
            ["5", "4"],
        ],
        [["1"], ["2"]],
    ],
};
/** Where bass notes start inside a bar, per style. */
const BASS_RHYTHMS = {
    "one-drop": [
        [2, 6, 8, 12, 14],
        [2, 4, 8, 10, 12],
        [3, 6, 8, 11, 14],
        [2, 6, 8, 9, 12, 14],
    ],
    rockers: [
        [0, 3, 6, 8, 10, 12, 14],
        [0, 2, 6, 8, 11, 12, 14],
        [0, 3, 4, 8, 11, 12, 14],
    ],
    steppers: [
        [0, 3, 6, 8, 11, 14],
        [0, 3, 4, 8, 11, 12],
        [0, 2, 4, 8, 10, 12, 14],
    ],
};

/**
 * Deterministic pseudo-random numbers in [0, 1).
 * @param {number} seed
 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** FNV-1a hash of a string. @param {string} text */
function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return h;
}

/** Lower case, accents stripped, punctuation turned into spaces. @param {string} text */
function normalize(text) {
    return ` ${text
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9#&/\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()} `;
}

/** @param {string} haystack normalized text @param {string} phrase */
function has(haystack, phrase) {
    return haystack.includes(` ${phrase} `);
}

/**
 * Read an idea and return what it asks for.
 * @param {string} request
 * @returns {Intent}
 */
export function readIntent(request) {
    const text = normalize(request);
    /** @type {Intent} */
    const intent = { matched: [] };
    /** @param {keyof typeof WORDS} meaning */
    const found = (meaning) => {
        const word = WORDS[meaning].find((w) => has(text, w));
        if (word) intent.matched.push(word);
        return Boolean(word);
    };

    for (const artist of ARTISTS) {
        const alias = artist.aliases.find((a) => has(text, a));
        if (alias) {
            intent.artist = artist;
            intent.matched.push(alias);
            break;
        }
    }
    if (!intent.artist) {
        const marker = REFERENCE_MARKERS.find((m) => has(text, m));
        if (marker) {
            const after = text.slice(text.indexOf(` ${marker} `) + marker.length + 2).trim();
            if (after) intent.unknownReference = after.split(" ").slice(0, 4).join(" ");
        }
    }
    for (const style of /** @type {const} */ (["one-drop", "rockers", "steppers"])) {
        if (found(style)) {
            intent.style = style;
            break;
        }
    }
    if (found("slow")) intent.tempo = "slow";
    else if (found("fast")) intent.tempo = "fast";
    if (found("minor")) intent.mode = "minor";
    else if (found("major")) intent.mode = "major";
    if (found("dry")) intent.echo = "low";
    else if (found("wet")) intent.echo = "high";
    if (found("sparse")) intent.density = "sparse";
    else if (found("busy")) intent.density = "busy";
    if (found("root")) intent.bass = "root";
    else if (found("melodic")) intent.bass = "melodic";

    const bpm = /(\d{2,3})\s*bpm|bpm\s*(\d{2,3})/.exec(text);
    if (bpm) {
        const value = Number(bpm[1] ?? bpm[2]);
        if (value >= 50 && value <= 200) {
            intent.bpm = value;
            intent.matched.push(bpm[0]);
        }
    }
    readKey(request, text, intent);
    found("generic");
    return intent;
}

/**
 * Keys written as letters ("in D minor", "Gm", "F# major") or solfege ("re menor", "fa sustenido maior").
 * A bare capital letter only counts after a word like "in" or "em", so "A dark riddim" is not A.
 * @param {string} original @param {string} text normalized @param {Intent} intent
 */
function readKey(original, text, intent) {
    const tokens = original
        .replace(/[,.!?;:()]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
        const letter = /^([A-G])([#b]?)(m|min|minor|maj|major)?$/.exec(tokens[i]);
        if (!letter) continue;
        const next = (tokens[i + 1] ?? "").toLowerCase();
        // Portuguese "Em" means "in": "Em Re menor" names the key in the next word.
        if (tokens[i] === "Em" && (/^[A-G][#b]?m?$/.test(tokens[i + 1] ?? "") || normalize(next).trim() in SOLFEGE))
            continue;
        const modeWord = letter[3] ?? (/^(minor|menor|major|maior|min|maj)$/.test(next) ? next : "");
        const prefixed = KEY_PREFIXES.has((tokens[i - 1] ?? "").toLowerCase());
        if (!modeWord && !prefixed) continue;
        intent.root = letter[1] + letter[2];
        if (modeWord) intent.mode = /^(m|min|minor|menor)$/.test(modeWord) ? "minor" : "major";
        intent.matched.push(tokens[i]);
        return;
    }
    const solfege = / (do|re|mi|fa|sol|la|si) (?:(sustenido|bemol|#|b) )?(maior|menor|major|minor|mayor) /.exec(text);
    if (solfege) {
        const accidental = solfege[2] === "sustenido" || solfege[2] === "#" ? "#" : solfege[2] ? "b" : "";
        intent.root = SOLFEGE[solfege[1]] + accidental;
        intent.mode = /^(menor|minor)$/.test(solfege[3]) ? "minor" : "major";
        intent.matched.push(solfege[0].trim());
    }
}

/** Scale degree number (can go below 1 or above 7) to a bass token. @param {number} degree */
function degreeToken(degree) {
    const octave = Math.floor((degree - 1) / 7);
    const base = ((((degree - 1) % 7) + 7) % 7) + 1;
    return `${base}${octave > 0 ? "'".repeat(octave) : ",".repeat(-octave)}`;
}

/**
 * Move a degree by octaves until it sounds between E1 and E3, where a dub bass lives.
 * @param {number} degree @param {{ root: string, mode: Mode }} key
 */
function fitBass(degree, key) {
    let fitted = degree;
    while ((bassMidi(degreeToken(fitted), key) ?? 40) < 28) fitted += 7;
    while ((bassMidi(degreeToken(fitted), key) ?? 40) > 52) fitted -= 7;
    return fitted;
}

/**
 * @template T
 * @param {() => number} random
 * @param {readonly T[]} items
 * @returns {T}
 */
function pick(random, items) {
    return items[Math.floor(random() * items.length)];
}

/**
 * Write one bar of bass under a chord.
 * @param {() => number} random @param {Style} style @param {Density} density @param {BassMove} move
 * @param {number} chord chord root as a scale degree @param {number} nextChord the next bar's chord root
 * @param {{ root: string, mode: Mode }} key
 */
function bassBar(random, style, density, move, chord, nextChord, key) {
    let starts = [...pick(random, BASS_RHYTHMS[style])];
    if (density === "sparse")
        starts = starts.filter((s, i) => i === 0 || s === 8 || i === starts.length - 1 || random() < 0.4);
    const tokens = Array(STEPS_PER_BAR).fill(".");
    // Chords on degrees 5 to 7 are played below the tonic, which keeps the bass between E1 and D2.
    const low = (/** @type {number} */ degree) => (degree > 4 ? degree - 7 : degree);
    const root = low(chord);
    const nextRoot = low(nextChord);
    const tones = [root, root + 2, root + 4];
    let current = root;
    for (const [i, step] of starts.entries()) {
        const last = i === starts.length - 1;
        let degree;
        if (i === 0) degree = root;
        else if (last && move === "melodic") degree = nextRoot + (random() < 0.5 ? 1 : -1);
        else if (move === "root") degree = random() < 0.75 ? root : pick(random, [root - 3, root + 7, root + 4]);
        else {
            const strong = step % 4 === 0;
            const candidates = strong ? tones : [current - 1, current + 1, ...tones];
            degree = pick(random, candidates);
        }
        degree = fitBass(Math.max(-3, Math.min(8, degree)), key);
        tokens[step] = degreeToken(degree);
        current = degree;
        const gap = (starts[i + 1] ?? STEPS_PER_BAR) - step;
        if (gap >= 3 && random() < 0.45) tokens[step + 1] = "-";
    }
    return tokens;
}

/**
 * Turn an intent into a riddim.
 * @param {Intent} intent @param {number} seed
 */
export function composeIntent(intent, seed) {
    const random = mulberry32(seed);
    const artist = intent.artist;
    const style =
        intent.style ??
        artist?.style ??
        (intent.mode === "major"
            ? "one-drop"
            : pick(random, /** @type {const} */ (["one-drop", "rockers", "steppers"])));
    const mode = intent.mode ?? artist?.mode ?? "minor";
    const root = intent.root ?? pick(random, mode === "minor" ? MINOR_ROOTS : MAJOR_ROOTS);
    const shift = intent.tempo === "slow" ? -6 : intent.tempo === "fast" ? 8 : 0;
    const bpm =
        intent.bpm ??
        Math.round(
            Math.min(200, Math.max(50, (artist?.bpm ?? STYLE_BPM[style]) + shift + Math.floor(random() * 5) - 2)),
        );
    const density = intent.density ?? artist?.density ?? "normal";
    const echo = intent.echo ?? artist?.echo ?? "mid";
    const move = intent.bass ?? artist?.bass ?? (style === "steppers" ? "root" : "melodic");
    const chords = artist?.name === "dub techno" ? [["1"], ["1"]] : pick(random, PROGRESSIONS[mode]);

    const kick = { "one-drop": "........x.......", rockers: "x.......x.......", steppers: "x...x...x...x..." }[style];
    const rim = density === "busy" && style !== "steppers" ? "........x.....x." : "........x.......";
    const hat = { sparse: "..x...x...x...x.", normal: "x.x.x.x.x.x.x.x.", busy: "x.xxx.xxx.xxx.xx" }[density];
    const lastHat = density === "sparse" ? hat : `${hat.slice(0, 12)}o${hat.slice(13)}`;
    const skank =
        style === "steppers" ? "..x...x...x...x." : density === "busy" ? "....x.x.....x.x." : "....x.......x...";
    const bass = chords.flatMap((bar, b) => {
        const degree = Number(bar[0].replace(/\D/g, ""));
        const next = Number(chords[(b + 1) % chords.length][0].replace(/\D/g, ""));
        return bassBar(random, style, density, move, degree, next, { root, mode });
    });
    const feedback = { low: 0.35, mid: 0.5, high: 0.65 }[echo];
    const spring = { low: 0.15, mid: 0.3, high: 0.45 }[echo];
    const echoTime = style === "steppers" && random() < 0.5 ? "1/4" : "3/16";

    const chunk = (/** @type {string[]} */ tokens) =>
        [tokens.slice(0, STEPS_PER_BAR), tokens.slice(STEPS_PER_BAR)].map((bar) => bar.join(" ")).join(" | ");
    const text = [
        "dubwise 1",
        `bpm ${bpm}`,
        `key ${root} ${mode}`,
        STYLE_SWING[style] ? `swing ${STYLE_SWING[style]}` : "",
        `kick   ${kick} | ${kick}`,
        `rim    ${rim} | ${rim}`,
        `hat    ${hat} | ${lastHat}`,
        `skank  ${skank} | ${skank}`,
        `chords ${chords.map((bar) => bar.join(" ")).join(" | ")}`,
        `bass   ${chunk(bass)}`,
        `echo   ${echoTime} ${feedback}`,
        `spring ${spring}`,
    ]
        .filter(Boolean)
        .join("\n");

    const label = { "one-drop": "one drop", rockers: "rockers", steppers: "steppers" }[style];
    let summary = `${label} at ${bpm} bpm in ${root} ${mode}, ${move === "melodic" ? "melodic" : "rooted"} bass, ${
        { low: "dry", mid: "some", high: "wide" }[echo]
    } echo`;
    if (artist) summary += `, inspired by ${artist.name}: ${artist.traits}`;
    return { text: `${text}\n`, summary };
}

/**
 * Compose a riddim from free text.
 * @param {string} request the idea, in English, Portuguese or Spanish
 * @param {number} [take] 0 for the first version, 1, 2... for others
 * @returns {{ understood: false, summary: string } | { understood: true, text: string, summary: string, intent: Intent }}
 */
export function compose(request, take = 0) {
    const intent = readIntent(request);
    if (!intent.matched.length && !intent.unknownReference) {
        return {
            understood: false,
            summary:
                'I could not find a style, mood, key, tempo or artist in that. Try "a dark steppers in D minor" or "inspired by Augustus Pablo".',
        };
    }
    const { text, summary } = composeIntent(intent, hash(normalize(request)) + take * 7919);
    const { errors } = parse(text);
    if (errors.length) throw new Error(`composer wrote an invalid riddim: ${JSON.stringify(errors)}`);
    const note =
        intent.unknownReference && !intent.artist
            ? ` (I don't know "${intent.unknownReference}", so I went by the other words)`
            : "";
    return { understood: true, text, summary: summary + note, intent };
}
