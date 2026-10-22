// @ts-check
/**
 * Free-text riddim composer. Reads an idea in English, Portuguese or Spanish, picks out style, tempo,
 * key, mood and artist references, and writes a valid riddim. Deterministic: the same idea and take
 * give the same riddim, and the next take gives another version.
 *
 * Artist references shape style, tempo and feel only. Nothing here holds or copies a real song.
 */
import { ARTISTS, NOT_NAMES } from "./artists.mjs";
import { editDistance } from "./distance.mjs";
import { bassMidi, leadMidi, parse, STEPS_PER_BAR, serialize } from "./notation.mjs";

export { editDistance };

/** @typedef {"one-drop" | "rockers" | "steppers"} Style */
/** @typedef {"major" | "minor"} Mode */
/** @typedef {"low" | "mid" | "high"} Amount */
/** @typedef {"sparse" | "normal" | "busy"} Density */
/** @typedef {"root" | "melodic"} BassMove */
/**
 * @typedef {"reggae" | "riddim" | "rap" | "rock" | "funk" | "classical"} Family
 * @typedef {"eighths" | "sixteenths" | "offbeat" | "flying"} Hat
 * @typedef {"three" | "backbeat" | "pickup"} Rim
 * @typedef {"chop" | "double" | "offbeat" | "bubble" | "none"} Skank
 * @typedef {{ name: string, aliases: string[], family: Family, style: Style, bpm: number, mode: Mode, echo: Amount,
 *   density: Density, bass: BassMove, traits: string, root?: string, chords?: string, hat?: Hat, rim?: Rim,
 *   skank?: Skank, echoTime?: string, swing?: number }} Artist
 * The optional fields are a reference's own signature: its key root, its chord movement as a notation chords line
 * (degrees per bar, up to eight bars), its hi-hat, rim and skank patterns, its echo time and its swing.
 * @typedef {{ style?: Style, bpm?: number, tempo?: "slow" | "fast", root?: string, mode?: Mode, echo?: Amount,
 *   density?: Density, bass?: BassMove, lead?: boolean, artist?: Artist, mixArtist?: Artist, matched: string[],
 *   unknown: string[], guessed: { typed: string, name: string }[], blend?: "lead" | "mix" }} Intent
 * `artist` is the first name in the idea and sets drums and tempo; `mixArtist`, a second name as in
 * "Iration Steppas meets King Tubby", sets echo, bass and mood. `unknown` holds the phrases nothing
 * here understood, such as "martin campbell" in "Martin Campbell style". `guessed` lists names typed with a slip,
 * such as "lemi irie" for Liemy irie. `blend` is the role an unknown name takes next to a known one, as in
 * "Chitãozinho e Xororó meets Lee Perry": an AI's reading of it then plays that role. `lead` asks for a
 * melodica line, and has nothing to do with the "lead" role of a blend.
 * @typedef {Pick<Intent, "style" | "tempo" | "mode" | "echo" | "density" | "bass">} Feel
 * @typedef {import("./intent.mjs").Reading} Reading
 */

/** Every alias with its artist, longest first, so "damian marley" is read before "marley". */
const ALIASES = ARTISTS.flatMap((artist) => artist.aliases.map((alias) => ({ artist, alias }))).sort(
    (a, b) => b.alias.length - a.alias.length,
);

/** Words per meaning, accents stripped, matched as whole words or phrases. Longer phrases are checked first. */
const WORDS = {
    "one-drop": ["one drop", "onedrop", "one-drop", "roots", "raiz", "raices"],
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
    slow: [
        "slow",
        "lento",
        "lenta",
        "devagar",
        "calmo",
        "calma",
        "relaxed",
        "relaxado",
        "chill",
        "despacio",
        "laid back",
        "laidback",
        "mellow",
        "calm",
        "peaceful",
        "smooth",
        "tranquilo",
        "tranquila",
        "sereno",
        "serena",
        "suave",
        "slower",
        "slow down",
        "mais devagar",
    ],
    fast: [
        "fast",
        "rapido",
        "rapida",
        "acelerado",
        "quick",
        "upbeat",
        "veloz",
        "lively",
        "speedy",
        "hurry",
        "animado",
        "animada",
        "pressa",
        "prisa",
        "faster",
        "quicker",
        "speed up",
        "acelera",
        "acelerar",
    ],
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
        "sinister",
        "scary",
        "creepy",
        "spooky",
        "evil",
        "horror",
        "terror",
        "tense",
        "serious",
        "sinistro",
        "sinistra",
        "assustador",
        "assustadora",
        "macabro",
        "macabra",
        "tenebroso",
        "tenebrosa",
        "tenso",
        "tensa",
        "medo",
        "siniestro",
        "siniestra",
        "miedo",
        "oscura",
        "darker",
        "sadder",
        "heavier",
        "gloomier",
    ],
    major: [
        "good vibes",
        "good vibe",
        "boas vibes",
        "boa onda",
        "buena onda",
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
        "joyful",
        "cheerful",
        "fun",
        "funny",
        "playful",
        "positive",
        "radiant",
        "beautiful",
        "divertido",
        "divertida",
        "alegria",
        "felicidade",
        "felicidad",
        "luminoso",
        "luminosa",
        "radiante",
        "contente",
        "contento",
        "positiva",
        "brillante",
        "lindo",
        "linda",
        "bonito",
        "bonita",
        "hermoso",
        "hermosa",
        "brighter",
        "happier",
        "cheerier",
    ],
    dry: [
        "less echo",
        "less reverb",
        "menos eco",
        "menos reverb",
        "drier",
        "dryer",
        "sem eco",
        "no echo",
        "without echo",
        "dry",
        "seco",
        "seca",
        "clean",
        "limpo",
        "sin eco",
        "sem efeitos",
        "sem efeito",
        "sin efectos",
        "tight",
        "punchy",
        "crisp",
    ],
    wet: [
        "more echo",
        "wetter",
        "mais eco",
        "mas eco",
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
        "echoes",
        "ecos",
        "psychedelic",
        "psicodelico",
        "psicodelica",
        "trippy",
        "ethereal",
        "etereo",
        "eterea",
        "atmospheric",
        "atmosferico",
        "atmosferica",
        "trip",
        "journey",
        "voyage",
        "viagem",
        "viajar",
        "viaje",
    ],
    sparse: [
        "minimal",
        "minimalista",
        "sparse",
        "esparso",
        "vazio",
        "simple",
        "simples",
        "stripped",
        "cru",
        "empty",
        "bare",
        "raw",
        "spacious",
        "espacoso",
        "espacosa",
        "vacio",
        "sencillo",
        "minimo",
        "sparser",
        "emptier",
        "less busy",
    ],
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
        "bouncy",
        "bounce",
        "driving",
        "dancing",
        "dancar",
        "bailar",
        "bailable",
        "baile",
        "full",
        "lleno",
        "llena",
        "busier",
        "fuller",
        "more busy",
    ],
    melodic: [
        "melodic",
        "melodico",
        "walking",
        "caminhante",
        "andando",
        "melodioso",
        "melodiosa",
        "singing",
        "lyrical",
    ],
    // Words that ask for the riddim's own melodica line, read by the `lead` line of the notation.
    lead: [
        "melody",
        "melodies",
        "melodica",
        "melodia",
        "theme",
        "themes",
        "tema",
        "keyboard",
        "keyboards",
        "teclado",
        "keys",
        "piano",
        "organ",
        "orgao",
        "flute",
        "flauta",
        "solo",
        "lead",
    ],
    root: [
        "rooted",
        "sub bass",
        "subgrave",
        "heavy bass",
        "baixo pesado",
        "bajo pesado",
        "sub",
        "pounding",
        "root",
        "rumbling",
        "rumble",
        "booming",
        "retumbante",
    ],
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
        "sound system",
        "soundsystem",
        "instrumental",
        "drums",
        "drum",
        "bateria",
        "tambores",
        "tambor",
    ],
};
/** Words that only link or soften an idea, in English, Portuguese and Spanish. They are never reported as unknown. */
const FILLER = new Set(
    [
        "a an the and or of with for to in on at by from as like one some something anything thing stuff please",
        "me i my we us you your it its this that give want need would could can let lets more very really bit little",
        "kind sort type style vibe vibes feel feeling sound sounds inspired inspiration version track song tune music",
        "meets vs versus x",
        "um uma uns umas o os as e ou de do da dos das com sem para pra pro por no na nos nas em num numa algo algum",
        "alguma coisa tipo estilo inspirado inspirada inspiracao eu quero queria bem muito muita mais pouco so isso",
        "esse essa som musica versao favor bass baixo",
        "un una el la los las y del con sin en cosa quiero hazme muy mas como",
        "what when where while which who about into under day time play playing remind reminds",
        "que quando onde sob debaixo sobre dia vez tocar toca lembre lembra lembrar parece soa",
        "cuando donde bajo dia suena recuerde",
        "but mas pero around also too then just only bpm",
    ]
        .join(" ")
        .split(" "),
);
/** The words of several space-separated lines. @param {...string} lines */
const wordsOf = (...lines) => lines.join(" ").split(" ");
/**
 * Images that suggest a feel, so "rain on the window" or "a party on the beach" still steer the riddim. An image only
 * fills what the plain words above left open, and images earlier in this list win, so "a happy riddim for a rainy
 * day" stays happy and "the beach at night" turns minor.
 * @type {{ feel: Feel, words: string[] }[]}
 */
const IMAGERY = [
    {
        // Conflict and protest march in steppers.
        feel: { style: "steppers", mode: "minor", density: "busy", bass: "root" },
        words: wordsOf(
            "war battle fight fighting army soldier soldiers march marching revolution rebel rebels rebellion",
            "riot protest warrior warriors clash resistance uprising",
            "guerra batalha luta lutar exercito soldado soldados marcha revolucao rebelde rebeldes rebeliao",
            "protesto guerreiro guerreira guerreiros resistencia levante",
            "batalla lucha ejercito revolucion rebelion protesta guerrero guerreros",
        ),
    },
    {
        // Anger, streets and machines.
        feel: { mode: "minor", density: "busy", bass: "root" },
        words: [
            "rude boy",
            ...wordsOf(
                "angry anger rage furious aggressive tough city urban street streets concrete factory machine",
                "machines industrial traffic ghetto gangster rudeboy rudie badman",
                "raiva furioso furiosa agressivo agressiva cidade urbano urbana rua ruas concreto fabrica maquina",
                "maquinas transito favela quebrada periferia",
                "rabia agresivo agresiva ciudad calle calles trafico barrio",
            ),
        ],
    },
    {
        // Loneliness, longing and the cold.
        feel: { style: "one-drop", mode: "minor", tempo: "slow", density: "sparse" },
        words: [
            "broken heart",
            "coracao partido",
            "corazon roto",
            ...wordsOf(
                "lonely alone loneliness nostalgia nostalgic melancholy tears crying cry goodbye farewell",
                "heartbreak heartbroken longing autumn winter cold grief mourning funeral",
                "sozinho sozinha solidao saudade saudades nostalgico nostalgica lagrimas choro chorar chorando",
                "adeus despedida outono inverno frio fria luto",
                "soledad lagrima llorar llorando adios otono",
            ),
        ],
    },
    {
        // Night, rain and mystery.
        feel: { mode: "minor", echo: "high" },
        words: [
            "meia noite",
            ...wordsOf(
                "night midnight moon moonlight rain rainy storm stormy thunder fog foggy mist smoke smoky",
                "ghost ghosts haunted shadow shadows cave tunnel mystery mysterious darkness",
                "noite madrugada meia-noite lua luar chuva chuvoso chuvosa garoa tempestade trovao trovoada",
                "neblina nevoa fumaca fantasma fantasmas assombrado assombrada sombra sombras caverna tunel",
                "misterio misterioso misteriosa escuridao",
                "noche medianoche luna lluvia lluvioso lluviosa tormenta trueno niebla humo embrujado cueva",
                "oscuridad",
            ),
        ],
    },
    {
        // Prayer, sleep, dreams and the sea.
        feel: { style: "one-drop", tempo: "slow", density: "sparse", echo: "high" },
        words: wordsOf(
            "meditation meditate meditative spiritual prayer temple zen yoga sleep sleepy lullaby float",
            "floating hypnotic trance dream dreams dreamy ocean sea waves underwater submarine whale drift",
            "drifting clouds",
            "meditacao meditar espiritual oracao rezar templo sono dormir ninar flutuar flutuando hipnotico",
            "hipnotica transe sonho sonhos sonhando oceano mar ondas submarino baleia nuvens",
            "meditacion oracion sueno suenos flotar flotando olas ballena nubes",
        ),
    },
    {
        // Machines from the future and outer space.
        feel: { style: "steppers", echo: "high" },
        words: [
            "disco voador",
            "nave espacial",
            "sci fi",
            ...wordsOf(
                "galaxy planet planets rocket alien aliens ufo robot robots laser lasers satellite astronaut",
                "future futuristic cyber sci-fi spaceship mars martian",
                "galaxia planeta planetas foguete alienigena alienigenas robo robos satelite astronauta futuro",
                "futurista marte marciano",
                "cohete ovni extraterrestre nave",
            ),
        ],
    },
    {
        // Parties, chases and fire.
        feel: { tempo: "fast", density: "busy" },
        words: wordsOf(
            "party dancefloor rave club festival carnival run running chase chasing race racing energy",
            "energetic jump jumping fire hype crazy wild frantic frenetic rush punk punky rock festive celebration",
            "celebratory",
            "festa balada pista carnaval correr correndo corrida perseguicao perseguindo energia energetico",
            "energetica pular pulando fogo louco louca doido doida selvagem frenetico frenetica agito",
            "festivo festiva comemoracao",
            "fiesta rumba carrera persiguiendo persecucion saltar fuego loco loca salvaje celebracion",
        ),
    },
    {
        // Sun, love and Sunday afternoons.
        feel: { mode: "major" },
        words: [
            "por do sol",
            ...wordsOf(
                "sun sunshine summer beach island tropical morning sunday picnic barbecue bbq smile sweet love",
                "lovely romantic romance kiss wedding sunset flowers garden birthday children kids",
                "verao praia ilha manha domingo piquenique churrasco sorriso doce amor romantico romantica",
                "beijo casamento flores jardim aniversario criancas primavera",
                "verano playa isla manana sonrisa dulce beso boda atardecer jardin cumpleanos ninos",
            ),
        ],
    },
    {
        // Lazy afternoons and the herb.
        feel: { style: "one-drop", tempo: "slow", echo: "high" },
        words: wordsOf(
            "ganja herb weed spliff chalice lazy hammock sofa couch afternoon",
            "erva maconha baseado preguica preguicoso tarde",
            "hierba marihuana porro perezoso hamaca",
        ),
    },
];
/** The words and phrases of the plain word lists. */
const VOCABULARY_WORDS = new Set(Object.values(WORDS).flat());
/** Every word the composer knows, which a typo in a name is never taken for. */
const VOCABULARY = new Set([...Object.values(WORDS).flat(), ...IMAGERY.flatMap((image) => image.words), ...FILLER]);

/** The feel each word list gives, in the terms of an AI's reading. */
const WORD_FEELS = /** @type {Record<keyof typeof WORDS, import("./intent.mjs").Reading | null>} */ ({
    "one-drop": { style: "one-drop" },
    rockers: { style: "rockers" },
    steppers: { style: "steppers" },
    slow: { tempo: "slow" },
    fast: { tempo: "lively" },
    minor: { mode: "minor" },
    major: { mode: "major" },
    dry: { echo: "low" },
    wet: { echo: "high" },
    sparse: { density: "sparse" },
    busy: { density: "busy" },
    melodic: { bass: "melodic" },
    root: { bass: "root" },
    lead: null,
    generic: null,
});

/**
 * Every word and image the composer knows with the feel it gives, for a reader that matches unknown words to the
 * nearest known ones, such as the word vectors in lexicon.mjs.
 * @returns {{ word: string, feel: import("./intent.mjs").Reading }[]}
 */
export function knownFeelings() {
    /** @type {{ word: string, feel: import("./intent.mjs").Reading }[]} */
    const known = [];
    for (const [meaning, words] of Object.entries(WORDS)) {
        const feel = WORD_FEELS[/** @type {keyof typeof WORDS} */ (meaning)];
        if (feel) for (const word of words) known.push({ word, feel });
    }
    for (const { feel, words } of IMAGERY) {
        const { tempo, ...rest } = feel;
        /** @type {import("./intent.mjs").Reading} */
        const reading = { ...rest };
        if (tempo) reading.tempo = tempo === "fast" ? "lively" : "slow";
        for (const word of words) known.push({ word, feel: reading });
    }
    return known;
}

/** Intent fields that steer the riddim. Any one of them means the idea was understood in part. */
const STEERING = /** @type {const} */ ([
    "style",
    "bpm",
    "tempo",
    "root",
    "mode",
    "echo",
    "density",
    "bass",
    "lead",
    "artist",
]);
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
/** How far an AI's named tempo moves a style's tempo, so "frantic" stays a fast dub, not a techno track. */
const TEMPO_SHIFT = { slow: -8, "laid back": -3, steady: 0, lively: 6, frantic: 14 };
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
    const intent = { matched: [], unknown: [], guessed: [] };
    // Artist names are taken out first, so "Iration Steppas" does not also read as the steppers style.
    let words = text;
    /** @param {keyof typeof WORDS} meaning */
    const found = (meaning) => {
        const word = WORDS[meaning].find((w) => has(words, w));
        if (word) intent.matched.push(word);
        return Boolean(word);
    };

    // Every artist named, in the order they appear: the first sets the drums, a second one the mix. Longer aliases
    // go first and are blanked out at the same length, so positions still give the order.
    /** @type {{ artist: Artist, alias: string, at: number }[]} */
    const named = [];
    for (const { artist, alias } of ALIASES) {
        if (!has(words, alias)) continue;
        if (!named.some((n) => n.artist === artist)) named.push({ artist, alias, at: words.indexOf(` ${alias} `) });
        words = words.replace(` ${alias} `, ` ${"|".padEnd(alias.length)} `);
    }
    // A name typed with a slip, like "lemi irie" for Liemy irie, still counts, and the reply says how it was read.
    for (const { artist, alias } of ALIASES) {
        if (named.some((n) => n.artist === artist)) continue;
        const typed = nearAlias(words, alias);
        if (!typed) continue;
        named.push({ artist, alias: typed, at: words.indexOf(` ${typed} `) });
        intent.guessed.push({ typed, name: artist.name });
        words = words.replace(` ${typed} `, ` ${"|".padEnd(typed.length)} `);
    }
    named.sort((a, b) => a.at - b.at);
    for (const { alias } of named) intent.matched.push(alias);
    intent.artist = named[0]?.artist;
    intent.mixArtist = named[1]?.artist;
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
    if (found("lead")) intent.lead = true;

    const bpm = /(\d{2,3})\s*bpm|bpm\s*(\d{2,3})/.exec(text);
    if (bpm) {
        const value = Number(bpm[1] ?? bpm[2]);
        if (value >= 50 && value <= 200) {
            intent.bpm = value;
            intent.matched.push(bpm[0]);
        }
    }
    readKey(request, text, intent);
    for (const { feel, words: images } of IMAGERY) {
        const image = images.find((w) => has(words, w));
        if (!image) continue;
        intent.matched.push(image);
        // What the idea already says wins over the image, and a named artist keeps their drums.
        const fill = intent.artist ? { ...feel, style: undefined } : feel;
        Object.assign(intent, { ...fill, ...intent });
    }
    found("generic");
    intent.unknown = unknownPhrases(words, intent.matched);
    intent.blend = blendRole(words, named, intent.matched);
    return intent;
}

/**
 * The words of an idea that name an artist with a slip of the keyboard, if any. A one-word name of six letters or
 * more may be one edit off. In a longer name every word but one must be exact, and that one may be two edits off.
 * First letters must agree, and words the composer already knows or common words (NOT_NAMES) never count, which
 * keeps "foundation" from reading as Groundation and "great day" as Green Day.
 * @param {string} words normalized idea with exact names blanked out @param {string} alias
 * @returns {string | undefined}
 */
function nearAlias(words, alias) {
    const wanted = alias.split(" ");
    if (wanted.length === 1 && alias.length < 6) return undefined;
    const tokens = words.split(" ").filter(Boolean);
    for (let i = 0; i + wanted.length <= tokens.length; i++) {
        const typed = tokens.slice(i, i + wanted.length);
        const off = typed.filter((word, k) => word !== wanted[k]);
        if (off.length !== 1 || typed.some((word, k) => word[0] !== wanted[k][0] || word === "|")) continue;
        const k = typed.indexOf(off[0]);
        if (VOCABULARY.has(off[0]) || NOT_NAMES.has(off[0]) || wanted[k].length < 4) continue;
        if (editDistance(off[0], wanted[k]) <= (wanted.length === 1 ? 1 : 2)) return typed.join(" ");
    }
    return undefined;
}

/** Words that link a lead and a mix, as in "X meets Y" or "X com Y". */
const LINKS = / (meets|x|vs|versus|with|com|con|feat|ft|featuring|encontra) /g;

/**
 * When an idea links one known name with words this composer does not know, as in "Chitãozinho e Xororó meets
 * Lee Perry", the role the unknown words take: "lead" before the link, "mix" after it.
 * @param {string} words @param {{ at: number }[]} named @param {string[]} matched
 * @returns {"lead" | "mix" | undefined}
 */
function blendRole(words, named, matched) {
    if (named.length !== 1) return undefined;
    for (const link of words.matchAll(LINKS)) {
        const at = link.index ?? 0;
        if (at < named[0].at && unknownPhrases(`${words.slice(0, at)} `, matched).length) return "lead";
        if (at > named[0].at && unknownPhrases(` ${words.slice(at + link[0].length)}`, matched).length) return "mix";
    }
    return undefined;
}

/**
 * The phrases of an idea that nothing here understood. Known words split the text into pieces, and each piece
 * loses its filler at both ends, so "for the new jamaican era" gives "new jamaican era" and "Fulano de Tal" stays whole.
 * @param {string} words normalized idea with artist names taken out @param {string[]} matched
 */
function unknownPhrases(words, matched) {
    const known = [
        ...Object.values(WORDS).flat(),
        ...IMAGERY.flatMap((image) => image.words),
        ...matched.map((m) => normalize(m).trim()),
    ]
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
    let rest = words;
    for (const phrase of known) while (has(rest, phrase)) rest = rest.replace(` ${phrase} `, " | ");
    const filler = (/** @type {string} */ word) => FILLER.has(word) || !/[a-z]/.test(word);
    const phrases = [];
    for (const piece of rest.split("|")) {
        const tokens = piece.split(" ").filter(Boolean);
        while (tokens.length && filler(tokens[0])) tokens.shift();
        while (tokens.length && filler(tokens[tokens.length - 1])) tokens.pop();
        if (tokens.length) phrases.push(tokens.slice(0, 6).join(" "));
    }
    return phrases.slice(0, 3);
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
 * Write one bar of bass under its chords: one, two or four, each taking an equal part of the bar.
 * @param {() => number} random @param {Style} style @param {Density} density @param {BassMove} move
 * @param {{ degree: number, sign: string }[]} chords chord roots as scale degrees, with "b" or "#" on a borrowed one
 * @param {number} nextChord the next bar's first chord root
 * @param {{ root: string, mode: Mode }} key
 */
function bassBar(random, style, density, move, chords, nextChord, key) {
    let starts = [...pick(random, BASS_RHYTHMS[style])];
    if (density === "sparse")
        starts = starts.filter((s, i) => i === 0 || s === 8 || i === starts.length - 1 || random() < 0.4);
    const tokens = Array(STEPS_PER_BAR).fill(".");
    // Chords on degrees 5 to 7 are played below the tonic, which keeps the bass between E1 and D2.
    const low = (/** @type {number} */ degree) => (degree > 4 ? degree - 7 : degree);
    const nextRoot = low(nextChord);
    let current = low(chords[0].degree);
    let segment = -1;
    for (const [i, step] of starts.entries()) {
        const last = i === starts.length - 1;
        // The chord under this step, and whether this is the first note under it, which lands on its root.
        const under = Math.floor((step * chords.length) / STEPS_PER_BAR);
        const root = low(chords[under].degree);
        const tones = [root, root + 2, root + 4];
        const first = under !== segment;
        segment = under;
        let degree;
        if (first) degree = root;
        else if (last && move === "melodic") degree = nextRoot + (random() < 0.5 ? 1 : -1);
        else if (move === "root") degree = random() < 0.75 ? root : pick(random, [root - 3, root + 7, root + 4]);
        else {
            const strong = step % 4 === 0;
            const candidates = strong ? tones : [current - 1, current + 1, ...tones];
            degree = pick(random, candidates);
        }
        degree = fitBass(Math.max(-3, Math.min(8, degree)), key);
        // A borrowed chord, such as the bVII of a major key, flattens or sharpens its root wherever the bass plays it.
        const borrowed = (((degree - root) % 7) + 7) % 7 === 0 ? chords[under].sign : "";
        tokens[step] = borrowed + degreeToken(degree);
        current = degree;
        const gap = (starts[i + 1] ?? STEPS_PER_BAR) - step;
        if (gap >= 3 && random() < 0.45) tokens[step + 1] = "-";
    }
    return tokens;
}

/** Where melodica notes start inside a bar, by density: few notes, and air between them for the echo. */
const LEAD_RHYTHMS = {
    sparse: [
        [0, 8],
        [0, 10],
        [4, 12],
        [0, 12],
    ],
    normal: [
        [0, 6, 10],
        [0, 8, 12],
        [2, 8, 14],
        [0, 4, 10],
    ],
    busy: [
        [0, 3, 6, 10, 13],
        [0, 4, 8, 11, 14],
        [2, 5, 8, 12, 15],
    ],
};

/**
 * Move a degree by octaves until it sounds between C4 and C6, the register a melodica line lives in.
 * @param {number} degree @param {{ root: string, mode: Mode }} key
 */
function fitLead(degree, key) {
    let fitted = degree;
    while ((leadMidi(degreeToken(fitted), key) ?? 72) < 60) fitted += 7;
    while ((leadMidi(degreeToken(fitted), key) ?? 72) > 84) fitted -= 7;
    return fitted;
}

/**
 * One bar of melodica over its chords: a chord tone where the ear expects one, steps in between and air
 * for the echo to bloom. A phrase of its own; nothing here holds or copies a real tune.
 * @param {() => number} random @param {Density} density
 * @param {{ degree: number, sign: string }[]} chords chord roots as scale degrees, as the bass reads them
 * @param {{ root: string, mode: Mode }} key
 */
function leadBar(random, density, chords, key) {
    const starts = pick(random, LEAD_RHYTHMS[density]);
    const tokens = Array(STEPS_PER_BAR).fill(".");
    let current = chords[0].degree + 4;
    for (const [i, step] of starts.entries()) {
        const under = Math.floor((step * chords.length) / STEPS_PER_BAR);
        const root = chords[under].degree;
        let degree;
        if (i === 0) degree = root + 4;
        else if (step % 4 === 0) degree = pick(random, [root, root + 2, root + 4]);
        else degree = current + pick(random, [-2, -1, -1, 1, 1, 2]);
        degree = fitLead(degree, key);
        // A borrowed chord, such as the bVII of a major key, flattens or sharpens its root here too.
        const borrowed = (((degree - root) % 7) + 7) % 7 === 0 ? chords[under].sign : "";
        tokens[step] = borrowed + degreeToken(degree);
        current = degree;
        const gap = (starts[i + 1] ?? STEPS_PER_BAR) - step;
        if (gap >= 5 && random() < 0.5) tokens[step + 1] = "-";
    }
    return tokens;
}

/** One bar of each signature pattern, by name. */
const HATS = {
    eighths: "x.x.x.x.x.x.x.x.",
    sixteenths: "XxxxXxxxXxxxXxxx",
    offbeat: "..x...x...x...x.",
    flying: "..o...o...o...o.",
};
const RIMS = { three: "........x.......", backbeat: "....x.......x...", pickup: "........x.....x." };
const SKANKS = {
    chop: "....x.......x...",
    double: "....x.x.....x.x.",
    offbeat: "..x...x...x...x.",
    bubble: ".xx..xx..xx..xx.",
    none: "................",
};
/** The organ's bubble, staggered against the skank: on the offbeats, or on 16ths where the skank owns the offbeats. */
const ORGANS = { eighths: "..x...x...x...x.", sixteenths: ".xx..xx..xx..xx." };

/**
 * One bar of each drum for a style at a density, or in a reference's own patterns. The hat's last bar opens on the
 * last offbeat.
 * @param {Style} style @param {Density} density @param {{ hat?: Hat, rim?: Rim, skank?: Skank }} [signature]
 */
function drumLines(style, density, signature = {}) {
    const kick = { "one-drop": "........x.......", rockers: "x.......x.......", steppers: "x...x...x...x..." }[style];
    const rim = RIMS[signature.rim ?? (density === "busy" && style !== "steppers" ? "pickup" : "three")];
    const hat = signature.hat
        ? HATS[signature.hat]
        : { sparse: HATS.offbeat, normal: HATS.eighths, busy: "x.xxx.xxx.xxx.xx" }[density];
    // The last bar opens the hat on beat 4, or on the hit after it when beat 4 is empty, as in offbeat hats.
    const open = hat[12] !== "." ? 12 : hat[14] !== "." ? 14 : -1;
    const keep = hat.includes("o") || open < 0 || (density === "sparse" && !signature.hat);
    const lastHat = keep ? hat : `${hat.slice(0, open)}o${hat.slice(open + 1)}`;
    const skank =
        SKANKS[signature.skank ?? (style === "steppers" ? "offbeat" : density === "busy" ? "double" : "chop")];
    // The organ bubbles under the skank, so it moves to 16ths when the skank already sits on every offbeat.
    const organ = skank === SKANKS.offbeat ? ORGANS.sixteenths : ORGANS.eighths;
    return { kick, rim, hat, lastHat, skank, organ };
}

/**
 * Turn an intent into a riddim. A `suggestion`, an AI's reading of the idea, only fills what neither the idea's own
 * words nor a known artist decide. A named reference's own signature (key, chords, drum patterns, echo time, swing)
 * plays as it is, unless the idea's words say otherwise; its tempo is exact on the first take, and other takes move
 * around it.
 * @param {Intent} intent @param {number} seed @param {Reading} [suggestion] @param {number} [take]
 */
export function composeIntent(intent, seed, suggestion = {}, take = 0) {
    const random = mulberry32(seed);
    // With a reading, unknown words linked to a known name take their own role and the reading plays it.
    const blend = Object.keys(suggestion).length ? intent.blend : undefined;
    const artist = blend === "lead" ? undefined : intent.artist;
    const mix = blend === "lead" ? intent.artist : blend === "mix" ? undefined : (intent.mixArtist ?? artist);
    const style =
        intent.style ??
        artist?.style ??
        suggestion.style ??
        (intent.mode === "major"
            ? "one-drop"
            : pick(random, /** @type {const} */ (["one-drop", "rockers", "steppers"])));
    const mode = intent.mode ?? mix?.mode ?? suggestion.mode ?? "minor";
    const drawnRoot = pick(random, mode === "minor" ? MINOR_ROOTS : MAJOR_ROOTS);
    const root = intent.root ?? mix?.root ?? drawnRoot;
    const shift = intent.tempo === "slow" ? -6 : intent.tempo === "fast" ? 8 : 0;
    // The idea's own tempo words and a named artist set the tempo first; an AI's named tempo counts only without them.
    const moved = intent.tempo || artist ? shift : TEMPO_SHIFT[suggestion.tempo ?? "steady"];
    const center = (artist?.bpm ?? STYLE_BPM[style]) + moved;
    const jitter = Math.floor(random() * 5) - 2;
    const exact = artist && !moved && !take;
    const bpm = intent.bpm ?? Math.round(Math.min(200, Math.max(50, center + (exact ? 0 : jitter))));
    const density = intent.density ?? artist?.density ?? suggestion.density ?? "normal";
    const echo = intent.echo ?? mix?.echo ?? suggestion.echo ?? "mid";
    const move = intent.bass ?? mix?.bass ?? suggestion.bass ?? (style === "steppers" ? "root" : "melodic");
    const drawnChords = pick(random, PROGRESSIONS[mode]);
    const chords = mix?.chords ? mix.chords.split("|").map((bar) => bar.trim().split(/\s+/)) : drawnChords;
    // The drums play a reference's own patterns unless the idea asks for a density of its own.
    const signature = intent.density ? {} : { hat: artist?.hat, rim: artist?.rim, skank: artist?.skank };
    const swing = intent.style ? STYLE_SWING[style] : (artist?.swing ?? STYLE_SWING[style]);

    const { kick, rim, hat, lastHat, skank, organ } = drumLines(style, density, signature);
    /** A chord token's root degree and its "b" or "#", as "b7M" gives 7 and "b". @param {string} chord */
    const rootOf = (chord) => ({ degree: Number(chord.replace(/\D/g, "")), sign: /^[b#]/.exec(chord)?.[0] ?? "" });
    const bass = chords.flatMap((bar, b) => {
        const next = rootOf(chords[(b + 1) % chords.length][0]).degree;
        return bassBar(random, style, density, move, bar.map(rootOf), next, { root, mode });
    });
    const feedback = { low: 0.35, mid: 0.5, high: 0.65 }[echo];
    const spring = { low: 0.15, mid: 0.3, high: 0.45 }[echo];
    const drawnEcho = style === "steppers" && random() < 0.5 ? "1/4" : "3/16";
    const echoTime = mix?.echoTime ?? drawnEcho;
    // Drawn after every other random pick, so an idea that does not ask for a melody composes exactly as it always did.
    const lead = intent.lead ? chords.flatMap((bar) => leadBar(random, density, bar.map(rootOf), { root, mode })) : [];

    const bars = chords.length;
    /** A bar's pattern for every bar, the last one as `last`. @param {string} bar @param {string} [last] */
    const every = (bar, last = bar) => [...Array(bars - 1).fill(bar), last].join(" | ");
    const chunk = (/** @type {string[]} */ tokens) =>
        Array.from({ length: bars }, (_, b) => tokens.slice(b * STEPS_PER_BAR, (b + 1) * STEPS_PER_BAR).join(" ")).join(
            " | ",
        );
    const text = [
        "dubwise 1",
        `bpm ${bpm}`,
        `key ${root} ${mode}`,
        swing ? `swing ${swing}` : "",
        `kick   ${every(kick)}`,
        `rim    ${every(rim)}`,
        `hat    ${every(hat, lastHat)}`,
        `skank  ${every(skank)}`,
        `organ  ${every(organ)}`,
        `chords ${chords.map((bar) => bar.join(" ")).join(" | ")}`,
        `bass   ${chunk(bass)}`,
        lead.length ? `lead   ${chunk(lead)}` : "",
        `echo   ${echoTime} ${feedback}`,
        `spring ${spring}`,
    ]
        .filter(Boolean)
        .join("\n");

    const label = { "one-drop": "one drop", rockers: "rockers", steppers: "steppers" }[style];
    let summary = `${label} at ${bpm} bpm in ${root} ${mode}, ${move === "melodic" ? "melodic" : "rooted"} bass, ${
        { low: "dry", mid: "some", high: "wide" }[echo]
    } echo${lead.length ? ", melodica line" : ""}`;
    const reader = suggestion.by ? `${suggestion.by}'s reading` : "the AI's reading";
    if (blend === "lead" && mix) {
        summary += `, drums and tempo from ${reader}, echo and bass from ${mix.name} (${mix.traits})`;
    } else if (blend === "mix" && artist) {
        summary += `, drums and tempo from ${artist.name} (${artist.traits}), echo and bass from ${reader}`;
    } else if (artist && intent.mixArtist) {
        const other = intent.mixArtist;
        summary += `, ${artist.name} meets ${other.name}: drums and tempo from ${artist.name} (${artist.traits}), echo and bass from ${other.name} (${other.traits})`;
    } else if (artist) {
        summary += `, inspired by ${artist.name}: ${artist.traits}`;
    }
    return { text: `${text}\n`, summary };
}

/**
 * Compose a riddim from free text.
 * @param {string} request the idea, in English, Portuguese or Spanish
 * @param {number} [take] 0 for the first version, 1, 2... for others
 * @param {Reading | null} [reading] an AI's reading of the idea, from sanitizeReading() in intent.mjs
 * @returns {{ understood: false, summary: string } | { understood: true, text: string, summary: string, intent: Intent }}
 */
export function compose(request, take = 0, reading = null) {
    // Any idea gets a riddim, however odd. Only text without a single word in it is turned down.
    if (!/[\p{L}\p{N}]/u.test(request)) {
        return {
            understood: false,
            summary:
                'Describe a riddim in words, for example "a dark steppers in D minor" or "inspired by Augustus Pablo".',
        };
    }
    const intent = readIntent(request);
    const { text, summary } = composeIntent(intent, hash(normalize(request)) + take * 7919, reading ?? {}, take);
    const { errors } = parse(text);
    if (errors.length) throw new Error(`composer wrote an invalid riddim: ${JSON.stringify(errors)}`);
    let note = intent.guessed.length
        ? ` (${intent.guessed.map(({ typed, name }) => `read "${typed}" as ${name}`).join(", ")})`
        : "";
    const phrases = intent.unknown.map((phrase) => `"${phrase}"`).join(", ");
    if (reading?.reading) {
        note += ` (${reading.by ?? "the AI"} read ${phrases || "it"} as: ${reading.reading})`;
    } else if (intent.unknown.length) {
        note += STEERING.some((field) => intent[field] !== undefined)
            ? ` (I don't know ${phrases}, so I went by the other words)`
            : ` (I don't know ${phrases} yet, so your words picked this take; add a style, mood or tempo to steer it)`;
    }
    return { understood: true, text, summary: summary + note, intent };
}

/** Words that make an idea a change to the riddim playing, as in "darker", "more echo" or "in the same style". */
const RELATIVE = new Set([
    "speed up",
    "slow down",
    ...wordsOf(
        "more less even still now bit little same keep faster quicker slower darker sadder heavier gloomier brighter",
        "happier cheerier wetter drier dryer busier fuller sparser emptier",
        "mais menos ainda agora pouco mesmo mesma manter mantem mantenha acelera acelerar",
        "mas aun ahora poco mismo misma mantener",
    ),
]);
/** Words only an image has, which make an idea a new one. */
const IMAGE_ONLY = new Set(IMAGERY.flatMap((image) => image.words).filter((word) => !VOCABULARY_WORDS.has(word)));
/** The other way of each word list, for "less fast" or "menos escuro". */
const OPPOSITE = /** @type {const} */ ({
    slow: "fast",
    fast: "slow",
    minor: "major",
    major: "minor",
    dry: "wet",
    wet: "dry",
    sparse: "busy",
    busy: "sparse",
});
const DENSITIES = /** @type {const} */ (["sparse", "normal", "busy"]);
const ECHO_LEVELS = [
    { echo: "dry", feedback: 0.35, spring: 0.15 },
    { echo: "some", feedback: 0.5, spring: 0.3 },
    { echo: "wide", feedback: 0.65, spring: 0.45 },
];
const STEP_VALUES = { ".": 0, x: 1, X: 2, o: 3 };

/**
 * Change the riddim playing instead of composing a new one, for an idea made only of relative words, such as
 * "darker", "more echo", "a bit faster" or "more dark in the same style". Bass and chords are scale degrees in the
 * notation, so a new mode plays the same line in the other mode, and the drums change only for a new style or
 * density. Returns null when the idea brings something new (a name, an image, a melody, a word the composer
 * does not know).
 * @param {string} request @param {string} text the notation of the riddim playing
 * @returns {{ text: string, summary: string } | null}
 */
export function refine(request, text) {
    let words = normalize(request);
    if (![...RELATIVE].some((word) => has(words, word))) return null;
    // "less fast" asks for the other way, unless the list has the phrase itself, as with "less echo".
    for (const [meaning, other] of Object.entries(OPPOSITE)) {
        for (const word of WORDS[/** @type {keyof typeof OPPOSITE} */ (meaning)]) {
            for (const negation of ["less", "menos"]) {
                const phrase = `${negation} ${word}`;
                if (has(words, phrase) && !VOCABULARY_WORDS.has(phrase)) {
                    words = words.replace(` ${phrase} `, ` ${WORDS[other][0]} `);
                }
            }
        }
    }
    // The request itself when nothing was turned around, since a key such as "E minor" is read in its own case.
    const intent = readIntent(words === normalize(request) ? request : words);
    const fresh = intent.unknown.some((phrase) => phrase.split(" ").some((word) => !RELATIVE.has(word)));
    if (intent.artist || intent.bass || intent.lead || fresh || intent.matched.some((word) => IMAGE_ONLY.has(word)))
        return null;
    const { riddim } = parse(text);
    if (!riddim) return null;
    /** @type {string[]} */
    const changes = [];
    /** @type {string[]} */
    const already = [];
    /** @param {boolean} changed @param {string} said */
    const tell = (changed, said) => (changed ? changes : already).push(said);
    if (intent.root || intent.mode) {
        const key = { root: intent.root ?? riddim.key.root, mode: intent.mode ?? riddim.key.mode };
        tell(key.root !== riddim.key.root || key.mode !== riddim.key.mode, `in ${key.root} ${key.mode}`);
        riddim.key = key;
    }
    if (intent.bpm || intent.tempo) {
        const bpm = intent.bpm ?? Math.min(200, Math.max(50, riddim.bpm + (intent.tempo === "fast" ? 6 : -6)));
        tell(bpm !== riddim.bpm, `at ${bpm} bpm`);
        riddim.bpm = bpm;
    }
    if (intent.echo) {
        const distance = (/** @type {number} */ i) => Math.abs(ECHO_LEVELS[i].feedback - riddim.echo.feedback);
        const now = [1, 2].reduce((best, i) => (distance(i) < distance(best) ? i : best), 0);
        const next = Math.max(0, Math.min(2, now + (intent.echo === "high" ? 1 : -1)));
        const level = ECHO_LEVELS[next];
        tell(next !== now || level.feedback !== riddim.echo.feedback, `${level.echo} echo`);
        riddim.echo.feedback = level.feedback;
        riddim.spring = level.spring;
    }
    if (intent.style || intent.density) {
        const kicks = riddim.drums.kick.slice(0, STEPS_PER_BAR).filter(Boolean).length;
        const style = intent.style ?? (kicks >= 4 ? "steppers" : kicks === 2 ? "rockers" : "one-drop");
        const hats = riddim.drums.hat.slice(0, STEPS_PER_BAR).filter(Boolean).length;
        const now = hats <= 4 ? 0 : hats >= 10 ? 2 : 1;
        const density = intent.density
            ? DENSITIES[Math.max(0, Math.min(2, now + (intent.density === "busy" ? 1 : -1)))]
            : DENSITIES[now];
        const lines = drumLines(style, density);
        const steps = (/** @type {string} */ bar, /** @type {string} */ last) =>
            Array.from({ length: riddim.bars }, (_, b) => (b === riddim.bars - 1 ? last : bar))
                .join("")
                .split("")
                .map((step) => STEP_VALUES[/** @type {keyof typeof STEP_VALUES} */ (step)]);
        const drums = {
            kick: steps(lines.kick, lines.kick),
            rim: steps(lines.rim, lines.rim),
            hat: steps(lines.hat, lines.lastHat),
            snare: riddim.drums.snare ?? [],
            clap: riddim.drums.clap ?? [],
            skank: steps(lines.skank, lines.skank),
            organ: steps(lines.organ, lines.organ),
        };
        const label = { "one-drop": "one drop", rockers: "rockers", steppers: "steppers" }[style];
        tell(JSON.stringify(drums) !== JSON.stringify(riddim.drums), `${label} drums, ${density}`);
        riddim.drums = drums;
        riddim.swing = STYLE_SWING[style];
    }
    if (!changes.length && !already.length) return null;
    const summary = [
        changes.length ? `the same riddim, now ${changes.join(", ")}` : "",
        already.length ? `already ${already.join(", ")}` : "",
    ]
        .filter(Boolean)
        .join(", ");
    if (changes.length) return { text: serialize(riddim), summary };
    const darker = intent.mode === "minor" ? '; for a darker sound try "filter -0.5", "more echo" or "slower"' : "";
    return { text, summary: summary + darker };
}
