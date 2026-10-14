# Instru, in the margins

A personal archive of Hyunsu Go''s time as an 18th generation tenor in Instru, Seoul National University''s a cappella club. The public site is in English and is hosted with GitHub Pages.

## What is here

- A brief introduction, the September 2026 concert by team, and a date-grouped gallery.
- Eleven watercolor reinterpretations of private source photographs.
- A live pitch checker and a browser-based MuseScore rehearsal player.

The original photographs live in `assets/photos_raw/` **only on the local machine**. That path is Git-ignored. The site build copies only an explicit allowlist into `dist/`; it never copies source photos. Only `assets/illustrations/*.webp` is published.

## Structure

```text
index.html                 Archive and practice room
styles/archive.css         Responsive archive design
styles/tools.css           Pitch and score tool styling
src/archive.js             Gallery and photo carousels
src/app.js                 Practice room interface
src/musescore-parser.js    MuseScore timing, notation, ties and slurs
src/score-notation.js      Beat-spaced score view
src/score-player.js        Web Audio playback and part mixer
assets/illustrations/      Public watercolor illustrations
assets/scores/             Public MuseScore files
scripts/build-site.js      Public-file allowlist
```

## Run locally

Use Node.js 22 or newer:

```sh
npm test
npm run check
npm run build
python -m http.server 4173 --directory dist
```

Open `http://localhost:4173/`. The pitch checker requires a secure context and microphone permission. It starts only when the Pitch check tab is opened. A held reference-note button sustains the tone until released.

## Score playback

The player reads `.mscz` and `.mscx` files in the browser. It supports notes, rests, chords, dots, tuplets, ties, simple slur phrasing, tempo changes, and measure-level time and key changes. The score view uses consistent beat spacing. Part gain runs from −15 to +10 dB, with a separate mute button. Audio goes to the normal browser output, so the device''s media volume still controls the final level.

This is a rehearsal view rather than a complete MuseScore renderer or MuseSounds replacement. Complex articulations, repeats, and instrument samples may differ from MuseScore itself.
