# dubwise

A dub sound system in your browser. Describe a riddim in your own words and it plays: synthesized drums and bass, tape echo, spring reverb, siren and dub effects, with a console you can live-code. No samples, no account, no install, and it works offline.

**Play it: https://alb777.github.io/dubwise/**

[![CI](https://github.com/alb777/dubwise/workflows/ci/badge.svg)](https://github.com/alb777/dubwise/actions/workflows/ci.yml)

[![An idea typed into the console becomes a riddim](docs/demo.gif)](https://alb777.github.io/dubwise/docs/demo.mp4)

**[Watch the demo with sound](https://alb777.github.io/dubwise/docs/demo.mp4)**

## What you can do

1. **Describe a riddim** in English, Portuguese or Spanish: `inspired by Augustus Pablo`, `a slow one drop for a rainy night`, `Metallica meets King Tubby`. Then steer it: `darker`, `a bit faster`, `more echo`.
2. **Mix it like dub**: mute, solo, hold **throw** to send a channel into the echo, sweep the filter, play the siren.
3. **Hit the effects**: spring crash, echo spin, air horn, phaser, low and high kills, tape stop and pull up.
4. **Play the melodica**: **keys** brings out a keyboard under the desk. Play it with the mouse, a finger or the computer keys whose letters are printed on it, with the riddim's scale marked. Ask for a melody, a theme for the melodica, and the riddim writes its own line into the `lead` row, which the melodica plays by itself, lighting each key it plays.
5. **Edit and live-code**: click the grid, or type a line like `bpm 76` or `kick x...x...x...x...`.
6. **Talk to the selector**, in English, Portuguese or Spanish: say hi for the mood of the day, `tip` for a dub technique it plays on your riddim, `who is Scientist?` for the story behind a name, `who else sounds like this?` for names close to the riddim playing.
7. **Share it**: the whole riddim lives in the link.
8. **Learn as you play**: **guide** (or `?`) opens beside the app, and the flag in the corner picks one of 8 themes.

## The console

```
play, stop                start or stop the riddim; play <idea> writes the idea and starts it
mute <ch>, unmute <ch>    channels: kick rim hat bass skank siren keys
solo <ch>, unsolo         hear one channel alone, or all again
throw <ch>                send a channel into the echo for one beat
filter <-1 to 1>          DJ filter: -1 dark, 0 open, 1 thin
crash, horn, spin         spring crash, air horn, echo spin
phaser, kill low|high     switch the phaser or a kill on and off
tape stop, pull up        halt the riddim, or rewind it and play it from the top
keys, keys off            bring out the melodica keyboard, or put it away
preset <name>             one-drop, rockers, steppers
again, undo               another version of the last idea, or back one change
show, share, help, notation, clear
theme <name>, guide       change the colours, open the guide
hi, mood, tip, challenge  talk to the selector: who is King Tubby? what is a dubplate?
ai, prompt <idea>         pick an AI reader, or copy a prompt for any chat AI
log, log save, log clear  what happened in this browser: show it, download it or empty it
<anything else>           an idea: inspired by King Tubby, steppers at 76 bpm, darker...
```

The log keeps what you typed, how each idea was read, how long the AI took and what failed. It stays in your browser until you save it.

## How ideas become riddims

The composer runs in the page. It reads a style, tempo, key, mood, images (rain, a beach party, a march) and about 750 references: reggae, dub and dancehall artists, famous riddims, Brazilian funk, rap, rock and classical. A reference brings broad style traits only, never a real bassline or melody. `X meets Y` splits the work: the first sets drums and tempo, the second the echo and bass.

Words it doesn't know go to its own word map, a 4 MB table from [potion-multilingual-128M](https://huggingface.co/minishlab/potion-multilingual-128M) downloaded the first time it's needed. For names and films you can add an AI under **✦ ai**:

1. **In this browser**: Qwen3.5 through [WebLLM](https://github.com/mlc-ai/web-llm), 1.1 GB once. It needs WebGPU on the graphics card. On Linux, Chrome and Brave only get that with Vulkan, which on some setups breaks video in the whole browser, so don't turn it on in your everyday profile: start a separate one for dubwise, for example `brave --user-data-dir=$HOME/.config/brave-webgpu --enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan https://alb777.github.io/dubwise/`, or use a server.
2. **Chrome's built-in model**, when the browser has one.
3. **A server you choose**: Ollama (`OLLAMA_ORIGINS=https://alb777.github.io ollama serve`), LM Studio, or any OpenAI-compatible service with your key.

The AI only fills a small form that dubwise checks; it never writes the notes. Nothing leaves the browser until you pick a provider.

## Riddim notation

A riddim is plain text. This is the one drop preset:

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

Drums take 16 steps per bar (`.` rest, `x` hit, `X` accent, `o` open hat). Bass, chords and the melodica's `lead` line are scale degrees, so one line moves the riddim to any key; no lead line means no melody, and asking for a melody makes the composer write one. Type `notation` for the full reference.

## Development

Plain JavaScript modules, no build step and no runtime dependencies.

```bash
npm install
npm test                  # unit tests and offline audio renders
npm run check             # TypeScript on the JSDoc types, and Biome
npm run check:browser     # audio and UI checks in a headless browser
npm run check:ai          # the in-browser AI on your GPU (1.1 GB download)
npm run build:lexicon     # rebuild the word map, then npm run sw:version
npm run build:references  # rebuild the reference catalogue from its private source
python3 -m http.server    # then open http://localhost:8000
```

## License

MIT. Every sound is synthesized in code.
