# dubwise

A dub sound system in your browser. Describe a riddim in your own words and it plays: synthesized drums and bass, a tape echo, a spring reverb, a siren, and a console you can live-code. No samples, no account, no install, no AI service, and it works offline.

**Play it: https://alb777.github.io/dubwise/**

[![An idea typed into the console becomes a riddim](docs/demo.gif)](https://alb777.github.io/dubwise/docs/demo.mp4)

**[Watch the 80 second demo with sound](https://alb777.github.io/dubwise/docs/demo.mp4)**, in the Ethiopia theme: a one drop, then six ideas typed into the console, `Iration Steppas meets King Tubby`, `a slow one drop for a rainy night`, `Natiruts na praia`, `un ritmo para bailar bajo la luna`, `furious robots in the factory` and `Damian Marley meets Lee Perry`, with throws, the siren, filter sweeps and a bass drop-out in between. Recorded from the real app, sound included.

## What you can do

1. **Play a riddim.** One drop, rockers or steppers to start, at dub tempo.
2. **Mix it like dub.** Mute channels in and out, hold **throw** to send a channel into the tape echo, sweep the DJ filter, ride the spring.
3. **Play the siren.** Hold the pad, slide sideways for pitch, up and down for speed.
4. **Edit the pattern.** Click steps in the grid; shift-click clears one.
5. **Live-code it.** Type `bpm 76` or `kick x...x...x...x...` in the console and the riddim changes on the next step.
6. **Share it.** The whole riddim lives in the link, so `share` copies a URL that plays exactly what you hear.
7. **Describe it.** Type an idea (`inspired by Augustus Pablo`, `a dark steppers in D minor`) and dubwise writes the riddim on your machine. Blend two names the dub way, `Iration Steppas meets King Tubby`: the first sets drums and tempo, the second the echo and bass. It also understands Portuguese and Spanish, so `um one drop lento com muito eco` works too. `again` gives another version, `undo` goes back.
8. **Ask any AI.** `prompt <idea>` copies a prompt for any chat AI. Paste its answer back into the console and it plays.
9. **Learn it as you play.** The **guide** button (or `?`) opens a guide beside the app; its buttons run the real commands and point at the controls.
10. **Dress it in a flag.** Pick a theme: dub, Jamaica, Ethiopia, Brazil, South Africa, Great Britain, Trinidad & Tobago or Poland. Every theme is checked for readable text and visible buttons.

## The console

```
play, stop                start or stop the riddim
mute <ch>, unmute <ch>    channels: kick rim hat bass skank siren
solo <ch>, unsolo         hear one channel alone, or all again
throw <ch>                send a channel into the echo for one beat
filter <-1 to 1>          DJ filter: -1 dark, 0 open, 1 thin
preset <name>             one-drop, rockers, steppers
again, undo               another version of the last idea, or back one change
show, share, help, notation, clear
theme <name>              dub, jamaica, ethiopia, brazil, south-africa, britain, trinidad, poland
guide                     open the guide beside the app (or press ?)
prompt <idea>             a prompt for any chat AI, built from your idea
<anything else>           an idea for the composer: inspired by King Tubby, steppers at 76 bpm...
```

Click a row name in the grid (for example **bass**) to pull that line into the console for editing.

## Riddim notation

A riddim is plain text, one setting per line. This is the one drop preset:

```
dubwise 1
bpm 72
key A minor
swing 0.15
kick   ........x....... | ........x.......
rim    ........x....... | ........x.......
hat    x.x.x.x.x.x.x.x. | x.x.x.x.x.x.o.x.
skank  ....x.......x... | ....x.......x...
chords 1 | 4
bass   . . 1 . . . 1 . 3 . . . 5 . 4 . | . . 4 . . . 4 . 6 . . . 5 - 3 .
echo   3/16 0.55
spring 0.3
```

Drums take 16 steps per bar (`.` rest, `x` hit, `X` accent, `o` open hat). The bass and the chords use scale degrees, so a riddim moves to any key with one line. Type `notation` in the console for the full reference, or read `SPEC` in [notation.mjs](skills/dubwise/scripts/notation.mjs).

## How ideas become riddims

The composer runs in the page, with no model and no network. It reads the idea for a style (one drop, rockers, steppers), a tempo (`80 bpm`, `slow`), a key (`in D minor`, `Gm`), a mood (dark, happy, lots of echo, minimal, melodic bass), images that suggest a feel (rain at night, a beach party, a march, a lullaby) and references, then writes drums, chords and a bass line that follow the rules of the style. Two names, as in `X meets Y`, split the work: the first sets drums and tempo, the second echo, bass and mood. The same idea always gives the same riddim, and `again` walks through other versions.

References cover more than a hundred artists, scenes and eras, from Studio One and King Tubby to UK steppers, lovers rock, dancehall, the reggae revival and reggae from Brazil, Africa, Poland and France. They map to broad style traits only, checked against public sources: King Tubby means heavy echo and channels dropping out, Jah Shaka means militant steppers. Plain words beat images, and images set the mood without taking a named artist's drums. dubwise holds no songs, so it never copies a real bassline or melody, and a name it does not know is said out loud instead of guessed at. No idea is turned down: words it does not know still pick a take, and the reply names them so you can steer with a style, mood or tempo. The `prompt` command asks the same of any chat AI you hand the idea to.

## Offline

Open the page once and it keeps working without a connection. Browsers that support it offer to install it as an app.

## Development

No build step and no runtime dependencies: the app is plain JavaScript modules served as they are. The dev tools are for testing only.

```bash
npm install
npm test                # notation, sequencer, console, and offline audio renders measured with node-web-audio-api
npm run check           # TypeScript strict checking of the JSDoc types, and Biome
npm run check:browser   # audio and UI checks in a headless Chromium browser (BROWSER=chromium to pick one)
python3 -m http.server  # then open http://localhost:8000
```

## License

MIT. Every sound is synthesized in code; dubwise ships no samples and is not affiliated with any instrument maker.
