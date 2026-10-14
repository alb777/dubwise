// @ts-check
/**
 * The selector: a companion in the console that talks dub, in English, Portuguese or Spanish, whichever the player
 * writes. It greets with the mood of the day, picks a mood for how the player feels, teaches dub techniques and plays
 * them on the riddim, tells the story behind a name, points to similar names and answers "what is" questions. All it
 * says is curated content, from selector-content.js; it makes nothing up. Text it does not take for talk, such as
 * ideas and commands, goes on to the console as before.
 */
import { ARTISTS } from "../skills/dubwise/scripts/artists.mjs";
import { readIntent } from "../skills/dubwise/scripts/composer.mjs";

/**
 * @typedef {import("../skills/dubwise/scripts/composer.mjs").Artist} Artist
 * @typedef {"en" | "pt" | "es"} Lang
 * @typedef {Record<Lang, string>} Text
 * @typedef {{ beat: number, command: string }} Step a console command, at a beat counted from the next bar
 * @typedef {{ name: string, title: Text, line: Text, idea: string, technique: string }} Mood
 * @typedef {{ name: string, words: string[], say: Text, moods: string[], negated?: string }} Feeling
 * @typedef {{ id: string, terms: string[], title: Text, history: Text, how: Text, steps: Step[] }} Technique
 * @typedef {{ name: string, story: Text, listen: Text }} Story
 * @typedef {{ terms: string[], answer: Text, technique?: string }} Question
 * @typedef {{ text: Text, idea?: string }} Challenge
 * @typedef {{ name: string, why: Text }} Favourite
 * @typedef {"hello" | "howAreYou" | "askBack" | "thanks" | "bye" | "lost" | "unknownName" | "me" | "today" | "forYou"
 *   | "another" | "moodHint" | "techniqueHint" | "lastTechnique" | "tryHint" | "here" | "challenge" | "challengeHint"
 *   | "challengeIdeaHint" | "storyHint" | "listen" | "similar" | "similarHint" | "noContext" | "favourite"
 *   | "favouriteHint" | "ready"} Voice
 * @typedef {{ lines: Record<Lang, Record<Voice, string[]>>, moods: Mood[], feelings: Feeling[],
 *   techniques: Technique[], stories: Story[], faq: Question[], challenges: Challenge[], favourites: Favourite[] }} Content
 * @typedef {{ intent: string, say: string[], idea?: string, steps?: Step[] }} Reply what kind of answer it is, what
 *   to print, then an idea to compose or commands to run
 * @typedef {{ kind: "mood" | "technique" | "story" | "challenge", idea?: string, mood?: Mood, technique?: Technique,
 *   artist?: Artist }} Offer what the last reply offered, which "play it", "try it", "another" or "why" act on
 */

const GREETINGS = phrases(
    "hi hello hey heya oi ola hola salve eae eai greetings wagwan blessings",
    "e ai|bom dia|boa tarde|boa noite|buenos dias|buenas tardes|buenas noches|buenas|good morning|good afternoon",
    "good evening|wah gwaan|whaa gwaan",
);
const HOW_ARE_YOU = phrases(
    "how are you|how are u|how r u|how you doing|how are you doing|hows it going|how s it going|how is it going",
    "whats up|what s up|sup|tudo bem|tudo bom|tudo certo|beleza|como vai|como voce esta|como vc esta|como vc ta",
    "como voce ta|como estas|que tal|como te va|como andas|wah gwaan|wagwan",
);
const AND_YOU = phrases(
    "and you|and yourself|what about you|and how are you|e voce|e vc|e tu|e contigo|y tu|y usted|y vos|y contigo",
);
const ME = phrases(
    "who are you|who are u|what are you|what can you do|quem e voce|quem e vc|quem e tu|o que voce faz",
    "o que vc faz|o que voce e|quien eres|quien es usted|que eres|que puedes hacer",
);
const ABOUT = phrases(
    "tell me about|tell me the story of|the story of|story of|who is|who was|whos|who s|who are|who were",
    "quem e|quem foi|quem sao|quem eram|me fala do|me fala da|me fala dos|me fala das|me fala de|me fala sobre",
    "fala do|fala da|fala de|fala sobre|me conta do|me conta da|me conta de|me conta sobre|conta sobre",
    "historia do|historia da|historia de|quien es|quien fue|quienes son|hablame de|hablame del|hablame sobre",
    "cuentame de|cuentame del|cuentame sobre",
);
const ANY_STORY = phrases(
    "tell me a story|tell me another story|another story|a story|any story|me conta uma historia",
    "me conta outra historia|conta uma historia|conta outra historia|uma historia|outra historia",
    "cuentame una historia|cuentame otra historia|una historia|otra historia",
);
const WHAT_IS = phrases(
    "what is a|what is an|what is the|what is|whats a|whats|what s a|what s|what are|what does",
    "what do you mean by|what is the meaning of|the meaning of|o que e um|o que e uma|o que e o|o que e a|o que e",
    "o que sao|oque e|que e um|que e uma|que e|o que significa|o que quer dizer|significado de",
    "que es un|que es una|que es el|que es la|que es|que son|que significa",
);
const HOW_TO = phrases(
    "how do i make a|how do i make|how do i do a|how do i do|how do you make a|how do you make|how to make a",
    "how to make|how to do a|how to do|how do i play a|how do i play|how to play a|how to play",
    "como faco um|como faco uma|como faco|como fazer um|como fazer uma|como fazer|como faz um|como faz",
    "como toco um|como toco|como tocar|como se faz|como hago un|como hago una|como hago|como hacer un",
    "como hacer|como se hace",
);
const ORIGIN = phrases(
    "who invented the|who invented|who created the|who created|who started|who came up with",
    "quem inventou o|quem inventou a|quem inventou|quem criou o|quem criou a|quem criou|quem comecou",
    "quien invento el|quien invento la|quien invento|quien creo el|quien creo|quien empezo",
);
const TEACH = phrases(
    "teach me|teach|tip|tips|trick|tricks|technique|techniques|lesson|how do i dub|how to dub",
    "dica|dicas|me ensina|ensina|truque|truques|tecnica|tecnicas|aula",
    "ensename|ensena|truco|trucos|consejo|consejos|leccion",
);
const CHALLENGE = phrases("challenge|challenges|desafio|desafios|reto|retos|dare|me desafia");
const FAVOURITE = phrases("favourite|favorite|fave|favorito|favorita|preferido|preferida");
const SIMILAR = phrases(
    "who else|anyone else|something similar|similar|sounds like this|like this one|quem mais|algo parecido",
    "parecido|parecida|semelhante|quien mas|algo similar|se parece",
);
const MORE = phrases(
    "why|why so|how come|tell me more|more about it|explain|explain more|go on|more details|por que|porque",
    "por que isso|me explica|explica|explica melhor|me explica melhor|conta mais|me conta mais|fala mais",
    "mais detalhes|cuentame mas|explicame|explica mas|y eso|por que eso",
);
const MOOD = phrases(
    "mood|moods|humor|vibe of the day|vibe do dia|what should i play|what do i play|what to play",
    "o que eu toco|o que tocar|o que toco|que toco|que puedo tocar|surprise me|me surpreende|surpreenda me",
    "sorprendeme|suggest|suggestion|sugere|sugira|sugestao|sugiere|sugerencia|recommend|recomenda|recomienda",
);
const THANKS = phrases("thanks|thank you|thx|cheers|respect|big up|valeu|vlw|obrigado|obrigada|gracias");
const BYE = phrases(
    "bye|goodbye|good bye|see you|see ya|later|walk good|good night|tchau|xau|ate mais|ate logo|falou",
    "adios|hasta luego|chau|nos vemos",
);
/** Whole replies that take up the last offer, as in "play it" after a mood. */
const FOLLOW = new Set(
    phrases(
        "yes|yeah|yep|yup|sure|ok|okay|go|go on|lets go|let s go|play it|play that|play this|play the mood|try it",
        "do it|show me|yes please|sim|bora|vamos|vai|manda|manda ai|toca|toca ai|toca essa|pode|pode ser|claro",
        "isso|sim por favor|si|dale|venga|hazlo|muestrame|mostra|me mostra",
    ),
);
/** Whole replies that ask for another of the same. */
const NEXT = new Set(
    phrases(
        "another|another one|next|more|one more|outra|outro|mais um|mais uma|proximo|proxima|otra|otro",
        "siguiente|uno mas|una mas",
    ),
);
const PLAY = phrases("play|toca|toque|tocar|manda|pon|pone|ponme|dale");
const FEELING_START = phrases(
    "i m|im|i am|i feel|i m feeling|feeling|estou|eu estou|to|eu to|tou|ando|me sinto|estoy|me siento",
);
const NOT = phrases("not|no|nao|nem|never|nunca");
/** Words only one of the three languages uses, which tell the selector which one to answer in. */
const MARKS = {
    pt: phrases(
        "voce vc estou tou nao sim obrigado obrigada valeu oi tudo bem bom boa um uma o do da dos das pra pro com",
        "quem foi faco faz fazer conta fala qual seu sua isso essa esse ai bora toca dica desafio outra outro mais",
        "muito ola tchau beleza e eu vai vou sinto ensina truque surpreende surpreenda entediado entediada",
        "estressado estressada irritado irritada apaixonado apaixonada",
    ),
    es: phrases(
        "hola estoy usted gracias quien quienes cuentame hablame dale muy pero hago hacer consejo truco reto otra otro",
        "el los las una un es soy eres bien y chau adios quiero dime buenos buenas sorprendeme siento hasta luego",
        "estas dame ensename aburrido aburrida enojado enojada cual",
    ),
    en: phrases(
        "what who how are you is the an i im tell about thanks thank hi hello hey tip challenge story play try",
        "another favourite favorite why more please does it something similar sounds like else your this that with",
        "and of my give teach make invented",
    ),
};
/** Talk is short; a longer text is an idea for the composer, even when it says hello. */
const SHORT = 6;

/** Phrases from lines of "|"-separated or space-separated words, longest first. @param {...string} lines */
function phrases(...lines) {
    return lines
        .flatMap((line) => (line.includes("|") ? line.split("|") : line.split(" ")))
        .sort((a, b) => b.length - a.length);
}

/** Lower case, accents and punctuation gone, padded with spaces. @param {string} text */
function plain(text) {
    return ` ${text
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()} `;
}

/** @param {string} text @param {string[]} list */
const opens = (text, list) => list.find((phrase) => text.startsWith(` ${phrase} `));
/** @param {string} text @param {string[]} list */
const holds = (text, list) => list.some((phrase) => text.includes(` ${phrase} `));

/**
 * The language a line is written in, or null when it does not say: the marks of each language, and letters only
 * Portuguese (ã, õ, ç, â, ê, ô) or Spanish (ñ, ¿, ¡) use.
 * @param {string} input @param {string} text the line, plain
 * @returns {Lang | null}
 */
function languageOf(input, text) {
    const score = { en: 0, pt: /[ãõçâêô]/i.test(input) ? 2 : 0, es: /[ñ¿¡]/i.test(input) ? 2 : 0 };
    for (const word of text.trim().split(" ")) {
        for (const lang of /** @type {Lang[]} */ (["en", "pt", "es"])) if (MARKS[lang].includes(word)) score[lang]++;
    }
    const [best, second] = Object.entries(score).sort((a, b) => b[1] - a[1]);
    return best[1] > 0 && best[1] > second[1] ? /** @type {Lang} */ (best[0]) : null;
}

/** A term without a leading article or a trailing "beat" or "riddim", as in "a one drop beat". @param {string} term */
function bare(term) {
    return term
        .replace(/^(a|an|the|um|uma|o|un|una|el|la) /, "")
        .replace(/ (beat|riddim|rhythm|ritmo|batida)$/, "")
        .trim();
}

/**
 * The names whose riddims come out closest to this one's, in the catalogue's terms.
 * @param {Artist} artist @param {number} count
 */
function closest(artist, count) {
    const level = { low: 0, mid: 1, high: 2, sparse: 0, normal: 1, busy: 2 };
    const words = new Set(artist.traits.split(/\W+/).filter((word) => word.length > 3));
    /** Reggae and its riddims are next of kin; any other two families are far apart. @param {Artist} other */
    const kin = (other) => [other.family, artist.family].every((family) => family === "reggae" || family === "riddim");
    /** @param {Artist} other */
    const distance = (other) =>
        (other.family === artist.family ? 0 : kin(other) ? 1 : 4) +
        (other.style === artist.style ? 0 : 2) +
        (other.mode === artist.mode ? 0 : 1.5) +
        Math.abs(level[other.echo] - level[artist.echo]) +
        Math.abs(level[other.density] - level[artist.density]) +
        (other.bass === artist.bass ? 0 : 1) +
        Math.abs(other.bpm - artist.bpm) / 10 -
        other.traits.split(/\W+/).filter((word) => words.has(word)).length / 10;
    return ARTISTS.filter((other) => other !== artist)
        .map((other) => ({ other, far: distance(other) }))
        .sort((a, b) => a.far - b.far)
        .slice(0, count)
        .map(({ other }) => other);
}

/**
 * @param {Content} content
 * @param {Date} [today] picks the mood of the day
 */
export function createSelector(content, today = new Date()) {
    const day = Math.floor((today.getTime() - today.getTimezoneOffset() * 60000) / 86400000);
    /** @type {Lang} */
    let lang = "en";
    /** Whether the player said anything yet, so a first lone word may set the language. */
    let spoken = false;
    /** @type {Offer | null} */
    let offer = null;
    /** Whether the last reply asked how the player feels. */
    let asked = false;
    /** The name behind the riddim playing, when an idea named one. @type {Artist | undefined} */
    let playing;
    /** How many of each thing were said, so each comes in turn, starting from the day. @type {Record<string, number>} */
    const turns = {};
    const taught = new Set();
    /** @param {string} kind @param {number} length */
    const turn = (kind, length) => {
        turns[kind] = (turns[kind] ?? 0) + 1;
        return (day + turns[kind] - 1) % length;
    };
    /** @param {Text} text */
    const t = (text) => text[lang] || text.en;
    /** @param {Voice} voice @param {Record<string, string>} [fill] */
    const line = (voice, fill = {}) => {
        const lines = content.lines[lang][voice];
        return lines[turn(voice, lines.length)].replace(/\{(\w+)\}/g, (_, key) => fill[key] ?? "");
    };
    /** @param {string[]} names */
    const list = (names) => new Intl.ListFormat(lang, { type: "conjunction" }).format(names);
    const moodOfTheDay = () => content.moods[day % content.moods.length];
    /** @param {string} term */
    const techniqueFor = (term) => content.techniques.find((technique) => technique.terms.includes(bare(term)));
    /** @param {string} term */
    const questionFor = (term) => content.faq.find((entry) => entry.terms.includes(bare(term)));
    /** @param {Artist} artist */
    const ideaOf = (artist) => `inspired by ${artist.aliases[0]}`;

    /** @param {Mood} mood @param {Voice} lead @param {string} [before] @returns {Reply} */
    function offerMood(mood, lead, before) {
        offer = { kind: "mood", idea: mood.idea, mood };
        const first = [before, line(lead), `${t(mood.title)}.`, t(mood.line)].filter(Boolean).join(" ");
        return { intent: "mood", say: [first, line("moodHint")] };
    }

    /** @param {Technique} technique @returns {Reply} */
    function teach(technique) {
        taught.add(technique.id);
        offer = { kind: "technique", technique };
        const title = [`${t(technique.title)}.`, t(technique.history)].filter(Boolean).join(" ");
        const hint = technique.steps.length ? line("techniqueHint") : line("lastTechnique");
        return { intent: "technique", say: [title, t(technique.how), hint] };
    }

    /** The technique that goes with the mood on offer, else the next one not taught yet. */
    function nextTechnique() {
        const paired = content.techniques.find((technique) => technique.id === offer?.mood?.technique);
        if (paired && !taught.has(paired.id)) return paired;
        const fresh = content.techniques.filter((technique) => !taught.has(technique.id));
        const pool = fresh.length ? fresh : content.techniques;
        return pool[turn("technique", pool.length)];
    }

    /** An answer, offering to play the technique behind it. @param {Question} question @returns {Reply} */
    function explain(question) {
        const technique = content.techniques.find((one) => one.id === question.technique && one.steps.length);
        offer = technique ? { kind: "technique", technique } : null;
        return { intent: "answer", say: technique ? [t(question.answer), line("tryHint")] : [t(question.answer)] };
    }

    /** @returns {Reply} */
    function challenge() {
        const next = content.challenges[turn("challenge", content.challenges.length)];
        offer = { kind: "challenge", idea: next.idea };
        const hint = next.idea ? line("challengeIdeaHint") : line("challengeHint");
        return { intent: "challenge", say: [`${line("challenge")} ${t(next.text)}`, hint] };
    }

    /** The story behind a name, or the traits the catalogue knows of it. @param {Artist} artist @returns {Reply} */
    function tell(artist) {
        offer = { kind: "story", idea: ideaOf(artist), artist };
        const story = content.stories.find((entry) => entry.name === artist.name);
        const say = story
            ? [`${story.name}: ${t(story.story)}`, `${line("listen")} ${t(story.listen)}`]
            : [`${artist.name}: ${artist.traits}.`];
        return { intent: "story", say: [...say, line("storyHint")] };
    }

    /** The next story told in turn. */
    function nextStory() {
        const story = content.stories[turn("story", content.stories.length)];
        return /** @type {Artist} */ (ARTISTS.find((artist) => artist.name === story.name));
    }

    /**
     * Names close to the one in the talk, offering the closest; with "play" or "toca", playing it.
     * @param {string} input @param {string} text the input, plain @returns {Reply}
     */
    function similar(input, text) {
        const artist = readIntent(input).artist ?? offer?.artist ?? playing;
        if (!artist) return { intent: "similar", say: [line("noContext")] };
        const names = closest(artist, 3);
        offer = { kind: "story", idea: ideaOf(names[0]), artist: names[0] };
        const said = line("similar", { name: artist.name, names: list(names.map((other) => other.name)) });
        if (holds(text, PLAY)) return { intent: "similar", say: [said], idea: ideaOf(names[0]) };
        return { intent: "similar", say: [said, line("similarHint", { name: names[0].name })] };
    }

    /** @returns {Reply} */
    function favourite() {
        const pick = content.favourites[turn("favourite", content.favourites.length)];
        const artist = /** @type {Artist} */ (ARTISTS.find((entry) => entry.name === pick.name));
        offer = { kind: "story", idea: ideaOf(artist), artist };
        return {
            intent: "favourite",
            say: [`${line("favourite", { name: pick.name })} ${t(pick.why)}`, line("favouriteHint")],
        };
    }

    /** More on what was just said: the move behind a mood, the answer behind a technique, names close to a story. */
    function more() {
        if (offer?.kind === "story" && offer.artist) {
            const { artist } = offer;
            const story = content.stories.find((entry) => entry.name === artist.name);
            const close = line("similar", { name: artist.name, names: list(closest(artist, 3).map((o) => o.name)) });
            const first = story ? `${line("listen")} ${t(story.listen)}` : `${artist.traits}.`;
            return { intent: "more", say: [first, close] };
        }
        const technique = offer?.kind === "technique" ? offer.technique : undefined;
        if (technique) {
            const question = content.faq.find((entry) => entry.technique === technique.id);
            return question ? explain(question) : { intent: "technique", say: [t(technique.how)] };
        }
        if (offer) return teach(nextTechnique());
        return { intent: "ready", say: [line("ready")] };
    }

    /** The feeling in the text, turned by "not" where it turns, as "not good" into sad. @param {string} text */
    function feelingIn(text) {
        for (const feeling of content.feelings) {
            const word = feeling.words.find((w) => text.includes(` ${w} `));
            if (!word) continue;
            const before = text.slice(0, text.indexOf(` ${word} `) + 1);
            if (!holds(before, NOT)) return feeling;
            return content.feelings.find((other) => other.name === feeling.negated);
        }
        return undefined;
    }

    /**
     * A greeting, "how are you" or a feeling, answered with a mood: one for the feeling, else the mood of the day.
     * @param {{ greeting: boolean, howAreYou: boolean, feeling?: Feeling }} heard @returns {Reply}
     */
    function greet({ greeting, howAreYou, feeling }) {
        const say = [];
        if (greeting) say.push(line("hello"));
        if (howAreYou) say.push(line("howAreYou"));
        if (feeling) {
            const name = feeling.moods[turn(feeling.name, feeling.moods.length)];
            const mood = content.moods.find((one) => one.name === name) ?? moodOfTheDay();
            say.push(...offerMood(mood, "forYou", t(feeling.say)).say);
        } else {
            say.push(...offerMood(moodOfTheDay(), "today").say);
        }
        asked = howAreYou && !feeling;
        if (asked) say.push(line("askBack"));
        return { intent: "mood", say };
    }

    /**
     * What a term asks for: a technique to teach, an answer, or nothing known. Asked who invented it, the technique
     * behind an answer comes first, since its history says who.
     * @param {string} term @param {boolean} origin @returns {Reply}
     */
    function lookUp(term, origin) {
        const question = questionFor(term);
        const technique =
            techniqueFor(term) ??
            (origin ? content.techniques.find((one) => one.id === question?.technique) : undefined);
        if (technique) return teach(technique);
        return question ? explain(question) : { intent: "lost", say: [line("lost")] };
    }

    /** @param {string} input @returns {Reply | null} */
    function answer(input) {
        const text = plain(input);
        const words = text.trim();
        const short = words.split(" ").length <= SHORT;
        const prompted = asked;
        asked = false;

        if (short && opens(text, THANKS)) return { intent: "thanks", say: [line("thanks")] };
        if (offer && FOLLOW.has(words)) {
            const { technique, idea } = offer;
            if (technique?.steps.length) return { intent: "play", say: [line("here")], steps: technique.steps };
            if (technique) return { intent: "technique", say: [t(technique.how)] };
            if (idea) return { intent: "play", say: [], idea };
        }
        if (offer && NEXT.has(words)) {
            if (offer.kind === "technique") return teach(nextTechnique());
            if (offer.kind === "challenge") return challenge();
            if (offer.kind === "story") return tell(nextStory());
            const at = content.moods.indexOf(/** @type {Mood} */ (offer.mood));
            return offerMood(content.moods[(at + 1) % content.moods.length], "another");
        }
        if (FOLLOW.has(words) && !words.startsWith("play")) return { intent: "ready", say: [line("ready")] };
        if (short && holds(text, ME)) return { intent: "me", say: [line("me")] };
        if (short && opens(text, AND_YOU)) return { intent: "howAreYou", say: [line("howAreYou")] };

        const howAreYou = short && holds(text, HOW_ARE_YOU);
        // "I'm tired" or "estou triste" say how the player feels, and so does "não estou bem".
        const opener = opens(text.replace(/^ (nao|no|not) /, " "), FEELING_START);
        const feeling = prompted || opener ? feelingIn(text) : undefined;
        const known = readIntent(input).matched.length > 0;
        if (!howAreYou && !feeling) {
            // What the talk is about comes before how it is asked, so "what's your favourite riddim?" is not a term.
            if (holds(text, ANY_STORY)) return tell(nextStory());
            if (holds(text, FAVOURITE)) return favourite();
            if (holds(text, SIMILAR)) return similar(input, text);
            if (holds(text, MOOD) && !known) return offerMood(offer?.mood ?? moodOfTheDay(), "today");
            const subject = opens(text, ABOUT);
            if (subject) {
                const { artist } = readIntent(text.slice(subject.length + 2));
                return artist ? tell(artist) : { intent: "unknownName", say: [line("unknownName")] };
            }
            const how = opens(text, HOW_TO);
            if (how) return lookUp(text.slice(how.length + 2).trim(), false);
            const origin = opens(text, ORIGIN);
            if (origin) return lookUp(text.slice(origin.length + 2).trim(), true);
            const what = opens(text, WHAT_IS);
            if (what) {
                const term = text
                    .slice(what.length + 2)
                    .trim()
                    .replace(/ (mean|means|significa)$/, "");
                const question = questionFor(term);
                if (question) return explain(question);
                const { artist } = readIntent(term);
                return artist ? tell(artist) : lookUp(term, false);
            }
            if (short && (opens(text, MORE) || MORE.includes(words))) return more();
        }
        if (holds(text, TEACH)) return teach(nextTechnique());
        if (holds(text, CHALLENGE)) return challenge();
        const greeting = short && Boolean(opens(text, GREETINGS));
        if (greeting || howAreYou || feeling) return greet({ greeting, howAreYou, feeling });
        if (holds(text, MOOD) && !known) return offerMood(offer?.mood ?? moodOfTheDay(), "today");
        if (short && opens(text, BYE)) return { intent: "bye", say: [line("bye")] };
        if (input.trim().endsWith("?") && !known) return { intent: "lost", say: [line("lost")] };
        return null;
    }

    return {
        /**
         * What the selector says to a line typed in the console, in the language of the line, or null when the line
         * is not talk: then the console takes it as before, and whatever the selector last offered lapses.
         * @param {string} input
         * @returns {Reply | null}
         */
        reply(input) {
            const text = plain(input);
            if (input.includes("\n") || !text.trim()) return null;
            const said = languageOf(input, text);
            const before = lang;
            // A lone word, such as "tip" in the middle of a talk in Portuguese, keeps the language of the talk.
            if (said && (text.trim().includes(" ") || !spoken)) lang = said;
            spoken = true;
            const reply = answer(input);
            if (!reply) {
                offer = null;
                lang = before;
            }
            return reply;
        },
        /** The name behind the riddim now playing, if any, for "who else sounds like this?". */
        set playing(/** @type {Artist | undefined} */ artist) {
            playing = artist;
        },
        /** The language the selector answers in now. */
        get lang() {
            return lang;
        },
        /** The mood of the day. */
        get mood() {
            return moodOfTheDay();
        },
    };
}
