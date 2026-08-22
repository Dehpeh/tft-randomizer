# TFT Restriction Randomizer

Rolls a player's major/minor restrictions before their game, per the tournament
doc. Static HTML/CSS/JS, no build step, no dependencies — same design language
as [dehpeh.dev](https://dehpeh.dev) (same tokens, same type, same four themes).

## Run it

```bash
node tft-randomizer/server.mjs
```

Then open <http://localhost:4700>. Opening `index.html` straight off disk works
too; the little server just gives it a real origin so the clipboard and
`localStorage` behave.

Deploying is a drag-and-drop: it is four static files, so Vercel, Netlify, or
GitHub Pages all serve it as-is.

## What it implements

**Distribution by rank** (from the doc):

| Rank | Rolls |
| --- | --- |
| Challenger | 2 major + 1 minor |
| Grandmaster | 1 major + 2 minor |
| Master | 1 major + 1 minor |
| Diamond | 3 minor |
| Emerald | 2 minor |
| Platinum | 1 minor |

**"If a player gets two similar restrictions, reroll the lower one."** Every
restriction carries a `family` tag — `shop`, `afk`, `hands`, `drink`, `econ`,
`costban`, `carousel`, `forcebuy`, `augment`, `traits`, and so on. Two
restrictions sharing a family are "similar". Majors are drawn first and minors
are drawn against them, so the one that gets rerolled is always the lower of the
pair. The slot shows how many auto-rerolls it took, so the rule is visible
rather than silent.

That tag is the only knob the rule needs: if you decide "no 3-star allowed" and
"5/4 costs banned" are too similar to stack, give them the same family in
`restrictions.js` and the randomizer stops pairing them.

**Seeds.** Every roll prints a seed (`6NH3-HM77`). Paste it back into the seed
field, with the same rank and the same enabled pool, and the identical
restrictions come out. That is the answer to "the randomizer screwed me" — an
umpire can reproduce any roll after the fact. Leave the field blank for a fresh
seed each time.

**Pool editor.** Click any restriction to take it out of the draw. Playtesters
can switch off anything that turns out to be unworkable in customs; the choice
persists in that browser. Note that a seed only reproduces a roll against the
same enabled pool.

**Log.** Save rolls to a local audit trail — copy the whole thing as text for
Discord, or download it as CSV. Stored in `localStorage`, so it is per-browser
and per-machine, not a shared server.

## Keyboard

`R` roll · `C` copy last result · `S` save to log · `T` cycle theme ·
`K` / `P` / `L` jump to ranks, pool, log.

## Editing the restrictions

Everything lives in [`restrictions.js`](restrictions.js) — one object per
restriction:

```js
{ id: 'mn-afk', family: 'afk', text: 'AFK 1 round every stage' }
```

Add, remove, or reword freely; `id` just has to be unique, and the page picks up
the change on reload. Rank counts are the `RANKS` array in the same file.

## Files

| File | What it holds |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Design tokens and components, lifted from dehpeh.dev |
| `restrictions.js` | Restriction pool, rank table, seeded roll engine (no DOM) |
| `app.js` | Page wiring: controls, spin animation, pool editor, log |
| `server.mjs` | Zero-dependency static server for local use |
