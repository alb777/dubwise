---
name: dubwise
description: Writes and edits dub reggae riddims in dubwise's own step notation from a free-text idea in English, Portuguese or Spanish, and turns one into a link that plays it. Use for riddim, dub, reggae or drum-pattern requests that should come out as dubwise notation or as a dubwise link.
---

# dubwise

dubwise is a dub sound system in the browser. Its composer turns an idea into a playable riddim: drums, bass, skank,
organ bubble, chords and an optional melodica line, plus tempo, key, swing and echo. This skill runs that same composer
without a browser, offline and deterministic, and writes dubwise notation.

References are read as style traits only: a name gives drums, tempo and mood, never a real bassline or melody.

## Run it

Node 20 or newer, no dependencies. From the dubwise repository root:

```
node skills/dubwise/cli.mjs compose "a dark steppers in D minor"
node skills/dubwise/cli.mjs compose "inspired by Augustus Pablo, a melody for the melodica" --take 1
node skills/dubwise/cli.mjs refine "a bit faster" --riddim riddim.txt
node skills/dubwise/cli.mjs check riddim.txt
node skills/dubwise/cli.mjs url riddim.txt
node skills/dubwise/cli.mjs spec
```

1. `compose <idea>`: writes a riddim. `--take N` gives another version of the same idea, `--json` adds the reader's
   intent and the share link.
2. `refine <change>`: changes the riddim you pass with `--riddim`, as in "darker", "more echo", "a bit faster" or
   "busier". It exits with code 3 when the words bring something new, which needs `compose` instead.
3. `check <file|->`: validates notation and names the bad line, exit code 1 when there is one.
4. `url <file|->`: prints the link that opens the app playing that riddim.
5. `spec`: prints the full notation reference.

The notation goes to stdout and a one-line reading of the idea goes to stderr, so `compose "..." > riddim.txt` keeps
only the riddim. Exit codes: 0 done, 1 bad idea or invalid notation, 2 bad usage, 3 not a change.

## Workflow

1. `compose` the idea. Keep the text when `check` says `ok`.
2. Steer it with `refine` while the change is relative, and compose a new idea when the user adds a name, a place or
   a melody.
3. To add a melody, the idea needs a word for it (melody, melodica, theme, keyboard, keys, piano). The composer then
   writes a `lead` line, which the app's melodica plays by itself.
4. `url` for the last answer when the user wants to listen, or keep the notation as the deliverable.

## The notation in short

One setting per line, `#` starts a comment, 16 steps per bar and bars split by `|`:

```
dubwise 1
bpm 72
key A minor
kick    ........x....... | ........x.......
hat     x.x.x.x.x.x.x.x.
bass    1 . . 1 . . 3 . 5 . . . 4 . 3 .
lead    . . 5 . . . . . 1' - . . . . 3' .
chords  1 | 4
echo    3/16 0.5
spring  0.3
```

Drums take `. rest`, `x hit`, `X accent` and `o open hat`. Bass, `lead` and chords are scale degrees, so one line
moves to any key; `-` holds a note, `'` and `,` move an octave. Run `spec` for the whole reference, with styles,
tempos and echo heads.

## Rules

1. Give the composer the user's idea with their own words, including names, places, films and languages. Do not
   rewrite it into a template first.
2. A name in the idea never reproduces a real song: describe the result by its style, never as the artist's track.
3. Answer with the notation, or with the one-line summary when the user only wants to know what it sounds like.
4. Change one thing at a time with `refine`, and keep the notation the user already has unless they ask for a new one.
