# TFT Restriction Randomizer

Rolls a player's major/minor restrictions before their game, per the tournament
doc. Two ways in:

- **Sessions** (`/session`) — a gamemaster opens a lobby, players sign in with
  their League name and a 6-digit passcode, the gamemaster rolls for everyone,
  and one live dashboard shows every player's restrictions.
- **Solo roller** (`/`) — the same engine with no account and no server, rolling
  in your browser. For playtesting restrictions in customs, or running a lobby
  by reading results out loud.

Static HTML/CSS/JS plus a handful of serverless functions. No build step, no
framework, no dependencies — same design language as
[dehpeh.dev](https://dehpeh.dev): same tokens, same type, same four themes.

## Run it locally

```bash
node tft-randomizer/server.mjs
```

<http://localhost:4700>. The dev server serves the static files and runs the
functions in `api/` on the same origin, so sessions work end to end with no
cloud account — state goes to a JSON file in your home directory. That is fine
for development and for running a tournament off one machine.

## Deploy it (Vercel + Upstash Redis)

1. Import the repo on Vercel. No build command, no framework preset — it is a
   static site with functions.
2. In the project, **Storage → Marketplace → Upstash for Redis** → create a free
   database and connect it. That sets `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` for you.
3. Add one more environment variable, `SESSION_SECRET` — 24+ random characters.
   It signs the login cookies; changing it later signs everyone out.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Deploy. Session links look like `https://your-domain/s/PLM73D`.

Without the Upstash variables a deployment would fall back to a per-instance
file that serverless functions do not share, so `SESSION_SECRET` throws on
Vercel if it is missing and the store falls back only outside it.

## How a tournament night runs

1. Gamemaster opens `/session`, fills in the lobby name, their own name, rank
   and a passcode, and gets a link.
2. Players open the link, enter their League name, a 6-digit passcode of their
   own, and their **peak rank**. That name and passcode are theirs in that lobby
   from then on; the gamemaster can correct a rank or clear a forgotten passcode
   from the roster.
3. Gamemaster picks the game tab and hits **Roll everyone without restrictions**.
   Every dashboard in the lobby shows the results within a few seconds — your
   own restrictions flicker in at the top, everyone else's fill the roster.
4. Late joiner? Roll again: `missing` only touches players with nothing yet.
   Restriction impossible in that lobby? **Reroll** that one slot. Whole game
   gone wrong? **Clear this game** and start it over.
5. **Copy for Discord** dumps the current game as plain text.

Games 1-3 exist by default and the gamemaster can add more.

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
pair. Each slot shows how many auto-rerolls it took, so the rule is visible
rather than silent.

That tag is the only knob the rule needs: if you decide "no 3-star allowed" and
"5/4 costs banned" are too similar to stack, give them the same family in
`restrictions.js` and the randomizer stops pairing them.

**Seeds.** Every roll carries a seed (`6NH3-HM77`). Same seed, same rank, same
pool reproduces it exactly — an umpire can check any disputed roll after the
fact, and the solo roller has a seed field to do it with.

**Pool editor.** Any restriction can be taken out of the draw: per-browser in
the solo roller, per-lobby for a gamemaster. Playtesters switch off whatever
turns out to be unworkable. The server refuses to go below 2 major and 3 minor,
since Challenger and Diamond could not be rolled otherwise.

**The server rolls.** A player's browser never decides its own restrictions and
cannot claim a rank it was not given. Rank, pool and rolls all live in the
session document.

## About the 6-digit passcode

Six digits is a million combinations — enough to stop a friend opening your
restrictions, not enough to stop anyone determined. It is treated as what it is:

- passcodes are scrypt-hashed with a per-player salt, never stored raw
- eight wrong attempts locks that name out of that lobby for 15 minutes
- the session code is unguessable, so you need it before you can start guessing
- session cookies are HttpOnly, SameSite=Lax, HMAC-signed, and scoped to one
  lobby, and POSTs check the Origin header

Do not reuse this pattern for anything that matters. Here the worst case is that
someone learns which trait you are banned from playing.

## Keyboard (solo roller)

`R` roll · `C` copy last result · `S` save to log · `T` cycle theme ·
`K` / `P` / `L` jump to ranks, pool, log.

## Editing the restrictions

Everything lives in [`restrictions.js`](restrictions.js) — one object per
restriction:

```js
{ id: 'mn-afk', family: 'afk', text: 'AFK 1 round every stage' }
```

Add, remove, or reword freely; `id` just has to be unique. That file loads both
in the browser and in the functions, so the rules exist exactly once. Rank counts
are the `RANKS` array in the same file.

## Files

| File | What it holds |
| --- | --- |
| `index.html`, `app.js` | Solo roller |
| `session.html`, `session.js` | Lobby: create, join, dashboard |
| `restrictions.js` | Restriction pool, rank table, seeded roll engine (browser + server) |
| `styles.css` | Design tokens and components, lifted from dehpeh.dev |
| `api/create.js` | Open a lobby, become its gamemaster |
| `api/join.js` | Claim a name with a passcode, or sign back in |
| `api/state.js` | What the dashboard polls |
| `api/roll.js` | Gamemaster rolls: everyone, only the unrolled, or one player |
| `api/gm.js` | Ranks, rerolls, pool, removals, handing over the lobby |
| `api/_store.js` | Upstash Redis, or a local JSON file when it is absent |
| `api/_auth.js` | Passcode hashing, lockouts, signed cookies |
| `api/_lib.js` | Request helpers and the session document shape |
| `server.mjs` | Local stand-in for Vercel: static files + `api/` on one origin |
