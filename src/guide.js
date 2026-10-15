// @ts-check
/**
 * The guide that opens beside the app. A step can run real console commands (`try`) and point at a control
 * (`show`, a CSS selector). Words in backticks are shown as code. tests/guide.test.mjs checks that every command
 * parses and every control exists, so the guide cannot drift away from the app.
 * @typedef {{ title: string, text: string, show?: string, try?: string[] }} Step
 */

/** @type {Step[]} */
export const GUIDE = [
    {
        title: "Start the sound",
        text: "Press play or the space bar. The menu next to bpm switches between the three classic riddims: one drop, rockers and steppers.",
        show: "#play",
        try: ["play", "preset steppers", "preset one-drop"],
    },
    {
        title: "Edit the drums",
        text: "Each row is a drum and each square a sixteenth note. Click a square to go through hit, accent and rest; the hat also has an open hit. Shift-click clears a square. The tabs above the grid switch bars, and follow keeps the view on the bar that plays.",
        show: "#grid",
        try: ["kick x...x...x...x..."],
    },
    {
        title: "Mix like a dub engineer",
        text: "Every channel has mute and solo. Hold throw to send a channel into the echo for as long as you hold it, the classic dub move. Drop the drums out, let the bass carry, bring them back.",
        show: "#strips",
        try: ["solo bass", "unsolo", "throw skank"],
    },
    {
        title: "Echo, spring, filter and siren",
        text: "echo time sets the delay in notes and feedback how long it repeats. spring is the reverb tank. filter sweeps from dark to thin; double-click it to open it again. Hold the siren pad and slide: sideways for pitch, up and down for speed.",
        show: ".fx",
        try: ["filter -0.7", "filter 0"],
    },
    {
        title: "Play the effects",
        text: "The pads below the siren are the rest of a dub desk. crash kicks the spring tank. Hold spin and the echo runs away into a howl. horn is the air horn. phaser sweeps the whole mix like Lee Perry's Mu-Tron, and the kills cut the lows or the highs. tape stop slows the riddim to a halt; pull up rewinds it and plays it again from the top, the selector's move.",
        show: "#pads",
        try: ["crash", "spin", "horn", "phaser", "phaser off", "pull up"],
    },
    {
        title: "Play the melodica",
        text: "keys, in the top bar, brings out a melodica under the desk, the instrument Augustus Pablo made a dub voice. Hold a key or slide along them, or play the computer keys A to K, with W E T Y U for the black ones and Z and X for the octave. A dot marks each note in the riddim's key and a bar its root. The strip beside the keys throws the melodica into the echo.",
        show: "#keys-toggle",
        try: ["keys"],
    },
    {
        title: "Describe a riddim",
        text: "Type an idea in English, Portuguese or Spanish and the composer writes it, offline: a style, a tempo, a key, a mood, an image or an artist. Two names, as in `X meets Y`, share the work. `again` plays another version, words like `darker`, `a bit faster` or `more echo` change the riddim playing, and `undo` goes back.",
        show: "#command",
        try: [
            "inspired by King Tubby",
            "Iration Steppas meets King Tubby",
            "a slow one drop for a rainy night",
            "again",
            "darker",
            "a bit faster",
            "undo",
        ],
    },
    {
        title: "Talk to the selector",
        text: "The selector lives in the console. Say hi and it gives you the mood of the day; tell it how you feel and it picks one for you. `tip` teaches a dub technique and `try it` plays it on your riddim. Ask `who is Scientist?` or `what is a dubplate?`, or for a `challenge`.",
        show: "#command",
        try: ["hi", "play it", "tip", "try it", "who is King Tubby?", "challenge"],
    },
    {
        title: "Let an AI read the rest",
        text: "Words the lists miss, like a volcano or a grandmother, are read by dubwise's own word map, offline. Names, films and places can go to an AI you choose: an open model in this browser, a server on your computer or an online service. Either one only fills what the idea leaves open and never writes the notes. `ai <idea>` asks the AI even when every word is known.",
        show: "#ai-toggle",
        try: ["ai"],
    },
    {
        title: "Live code the notation",
        text: "Every riddim is plain text. `show` prints it, and any line you type changes the riddim while it plays. Click a row name in the grid to put its line in the console.",
        show: "#log",
        try: ["show", "bpm 70", "echo 3/16 0.7"],
    },
    {
        title: "Share it",
        text: "`share` copies a link that plays your riddim for anyone. After the first visit dubwise also works offline, and your browser can install it as an app.",
        show: "#share",
        try: ["share"],
    },
    {
        title: "Pick your colours",
        text: "The flag in the top right corner dresses the sound system in another flag. This browser remembers the choice.",
        show: "#theme",
        try: [
            "theme jamaica",
            "theme ethiopia",
            "theme brazil",
            "theme south-africa",
            "theme britain",
            "theme trinidad",
            "theme poland",
            "theme dub",
        ],
    },
];
