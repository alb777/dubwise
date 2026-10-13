// @ts-check
/**
 * The selector: a companion in the console that talks dub. It greets the player with the mood of the day, picks a
 * mood for how they feel, teaches dub techniques and plays them on the riddim, tells the story behind a name and
 * answers "what is" questions. All it says is curated content, from selector-content.js; it makes nothing up. Text it
 * does not take for talk, such as ideas and commands, goes on to the console as before.
 */
import { readIntent } from "../skills/dubwise/scripts/composer.mjs";

/**
 * @typedef {{ beat: number, command: string }} Step a console command, at a beat counted from the next bar
 * @typedef {{ name: string, line: string, idea: string, technique: string }} Mood
 * @typedef {{ name: string, words: string[], say: string, moods: string[], negated?: string }} Feeling
 * @typedef {{ id: string, title: string, history: string, how: string, steps: Step[] }} Technique
 * @typedef {{ name: string, story: string, listen: string }} Story
 * @typedef {{ terms: string[], answer: string, technique?: string }} Question
 * @typedef {{ text: string, idea?: string }} Challenge
 * @typedef {"hello" | "howAreYou" | "askBack" | "thanks" | "bye" | "lost" | "unknownName" | "me"} Voice
 * @typedef {{ lines: Record<Voice, string[]>, moods: Mood[], feelings: Feeling[], techniques: Technique[],
 *   stories: Story[], faq: Question[], challenges: Challenge[] }} Content
 * @typedef {{ say: string[], idea?: string, steps?: Step[] }} Reply what to print, then an idea to compose or
 *   commands to run
 * @typedef {{ kind: "mood" | "technique" | "story" | "challenge", idea?: string, mood?: Mood,
 *   technique?: Technique }} Offer what the last reply offered, which "play it", "try it" or "another" act on
 */

const GREETINGS = phrases(
    "hi hello hey heya oi ola hola salve eae eai greetings wagwan blessings",
    "e ai|bom dia|boa tarde|boa noite|buenos dias|buenas tardes|buenas noches|buenas|good morning|good afternoon",
    "good evening|wah gwaan|whaa gwaan",
);
const HOW_ARE_YOU = phrases(
    "how are you|how are u|how r u|how you doing|how are you doing|hows it going|how s it going|how is it going",
    "whats up|what s up|sup|tudo bem|tudo bom|tudo certo|como vai|como voce esta|como vc esta|como vc ta",
    "como voce ta|como estas|que tal|como te va|como andas|wah gwaan|wagwan",
);
const ABOUT = phrases(
    "tell me about|tell me the story of|the story of|story of|who is|who was|whos|who s|who are|who were",
    "quem e|quem foi|quem sao|quem eram|me fala do|me fala da|me fala dos|me fala das|me fala de|me fala sobre",
    "fala do|fala da|fala de|fala sobre|me conta do|me conta da|me conta de|me conta sobre|conta sobre",
    "historia do|historia da|historia de|quien es|quien fue|quienes son|hablame de|hablame del|hablame sobre",
    "cuentame de|cuentame del|cuentame sobre",
);
const WHAT_IS = phrases(
    "what is a|what is an|what is the|what is|whats a|whats|what s a|what s|what are|what does|what do you mean by",
    "o que e um|o que e uma|o que e o|o que e a|o que e|o que sao|oque e|que e um|que e uma|que e",
    "que es un|que es una|que es el|que es la|que es|que son",
);
const TEACH = phrases(
    "teach me|teach|tip|tips|trick|tricks|technique|techniques|lesson|how do i dub|how to dub",
    "dica|dicas|me ensina|ensina|truque|truques|tecnica|tecnicas|aula",
    "ensename|ensena|truco|trucos|consejo|consejos|leccion",
);
const ME = phrases(
    "who are you|who are u|what are you|what can you do|quem e voce|quem e vc|quem e tu|o que voce faz",
    "o que vc faz|o que voce e|quien eres|quien es usted|que eres|que puedes hacer",
);
const CHALLENGE = phrases("challenge|challenges|desafio|desafios|reto|retos|dare|me desafia");
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
const FEELING_START = phrases(
    "i m|im|i am|i feel|i m feeling|feeling|estou|eu estou|to|eu to|tou|ando|me sinto|estoy|me siento",
);
const NOT = phrases("not|no|nao|nem|never|nunca");
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
 * @param {Content} content
 * @param {Date} [today] picks the mood of the day
 */
export function createSelector(content, today = new Date()) {
    const day = Math.floor((today.getTime() - today.getTimezoneOffset() * 60000) / 86400000);
    /** @type {Offer | null} */
    let offer = null;
    /** Whether the last reply asked how the player feels. */
    let asked = false;
    /** How many of each thing were said, so each comes in turn, starting from the day. @type {Record<string, number>} */
    const turns = {};
    const taught = new Set();
    /** @param {string} kind @param {number} length */
    const turn = (kind, length) => {
        turns[kind] = (turns[kind] ?? 0) + 1;
        return (day + turns[kind] - 1) % length;
    };
    /** @param {Voice} voice */
    const line = (voice) => content.lines[voice][turn(voice, content.lines[voice].length)];
    const moodOfTheDay = () => content.moods[day % content.moods.length];

    /** @param {Mood} mood @param {string} lead @returns {Reply} */
    function offerMood(mood, lead) {
        offer = { kind: "mood", idea: mood.idea, mood };
        return {
            say: [
                `${lead} ${mood.name}. ${mood.line}`,
                'Say "play it" to hear it, or "tip" for a technique that goes with it.',
            ],
        };
    }

    /** @param {Technique} technique @returns {Reply} */
    function teach(technique) {
        taught.add(technique.id);
        offer = { kind: "technique", technique };
        return {
            say: [
                [`${technique.title}.`, technique.history].filter(Boolean).join(" "),
                technique.how,
                technique.steps.length
                    ? 'Say "try it" and I will play it on your riddim from the next bar, or "another tip".'
                    : 'Say "another tip" for the next one.',
            ],
        };
    }

    /** The technique that goes with the mood on offer, else the next one not taught yet. */
    function nextTechnique() {
        const paired = content.techniques.find((technique) => technique.id === offer?.mood?.technique);
        if (paired && !taught.has(paired.id)) return paired;
        const fresh = content.techniques.filter((technique) => !taught.has(technique.id));
        const pool = fresh.length ? fresh : content.techniques;
        return pool[turn("technique", pool.length)];
    }

    /** @returns {Reply} */
    function challenge() {
        const next = content.challenges[turn("challenge", content.challenges.length)];
        offer = { kind: "challenge", idea: next.idea };
        const hint = next.idea
            ? 'Say "play it" for a riddim to start from, or "another challenge".'
            : 'Say "another challenge" for a different one.';
        return { say: [`Challenge: ${next.text}`, hint] };
    }

    /**
     * The story behind a name, or the traits the catalogue knows of it, or null for a name it does not know.
     * @param {import("../skills/dubwise/scripts/composer.mjs").Artist | undefined} artist @returns {Reply | null}
     */
    function tell(artist) {
        if (!artist) return null;
        offer = { kind: "story", idea: `inspired by ${artist.aliases[0]}` };
        const story = content.stories.find((entry) => entry.name === artist.name);
        const say = story
            ? [`${story.name}: ${story.story}`, `Listen for: ${story.listen}`]
            : [`${artist.name}: ${artist.traits}.`];
        say.push('Say "play it" for a riddim in that spirit, or "another" for another story.');
        return { say };
    }

    /** The next story told in turn, as an artist the composer knows. */
    function nextStory() {
        const story = content.stories[turn("story", content.stories.length)];
        return readIntent(story.name).artist;
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
        const mood =
            feeling && content.moods.find((m) => m.name === feeling.moods[turn(feeling.name, feeling.moods.length)]);
        say.push(...offerMood(mood ?? moodOfTheDay(), feeling ? `${feeling.say} Try this mood:` : "Today's mood:").say);
        asked = howAreYou && !feeling;
        if (asked) say.push(line("askBack"));
        return { say };
    }

    /** @param {string} input @returns {Reply | null} */
    function answer(input) {
        const text = plain(input);
        const words = text.trim();
        const short = words.split(" ").length <= SHORT;
        const prompted = asked;
        asked = false;

        if (offer && FOLLOW.has(words)) {
            const { technique, idea } = offer;
            if (technique?.steps.length) return { say: ["Here it comes, from the next bar."], steps: technique.steps };
            if (technique) return { say: [technique.how] };
            if (idea) return { say: [], idea };
        }
        if (offer && NEXT.has(words)) {
            if (offer.kind === "technique") return teach(nextTechnique());
            if (offer.kind === "challenge") return challenge();
            if (offer.kind === "story") return tell(nextStory());
            const at = content.moods.indexOf(/** @type {Mood} */ (offer.mood));
            return offerMood(content.moods[(at + 1) % content.moods.length], "How about this one:");
        }

        const howAreYou = short && holds(text, HOW_ARE_YOU);
        // "I'm tired" or "estou triste" say how the player feels, and so does "não estou bem".
        const opener = opens(text.replace(/^ (nao|no|not) /, " "), FEELING_START);
        const feeling = prompted || opener ? feelingIn(text) : undefined;
        if (short && holds(text, ME)) return { say: [line("me")] };
        if (!howAreYou && !feeling) {
            const subject = opens(text, ABOUT);
            if (subject)
                return tell(readIntent(text.slice(subject.length + 2)).artist) ?? { say: [line("unknownName")] };
            const what = opens(text, WHAT_IS);
            if (what) {
                const term = text
                    .slice(what.length + 2)
                    .trim()
                    .replace(/ (mean|means|significa)$/, "");
                const known = content.faq.find((entry) => entry.terms.includes(term));
                if (known) {
                    const technique = content.techniques.find((t) => t.id === known.technique && t.steps.length);
                    offer = technique ? { kind: "technique", technique } : null;
                    return {
                        say: technique ? [known.answer, 'Say "try it" to hear it on your riddim.'] : [known.answer],
                    };
                }
                return tell(readIntent(term).artist) ?? { say: [line("lost")] };
            }
        }
        if (holds(text, TEACH)) return teach(nextTechnique());
        if (holds(text, CHALLENGE)) return challenge();
        const greeting = short && Boolean(opens(text, GREETINGS));
        if (greeting || howAreYou || feeling) return greet({ greeting, howAreYou, feeling });
        const known = readIntent(input).matched.length > 0;
        if (holds(text, MOOD) && !known) return offerMood(offer?.mood ?? moodOfTheDay(), "Today's mood:");
        if (short && opens(text, THANKS)) return { say: [line("thanks")] };
        if (short && opens(text, BYE)) return { say: [line("bye")] };
        if (input.trim().endsWith("?") && !known) return { say: [line("lost")] };
        return null;
    }

    return {
        /**
         * What the selector says to a line typed in the console, or null when the line is not talk: then the
         * console takes it as before, and whatever the selector last offered lapses.
         * @param {string} input
         * @returns {Reply | null}
         */
        reply(input) {
            if (input.includes("\n") || !plain(input).trim()) return null;
            const said = answer(input);
            if (!said) offer = null;
            return said;
        },
        /** The mood of the day. */
        get mood() {
            return moodOfTheDay();
        },
    };
}
