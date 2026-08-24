# TFT Restriction Randomizer

Rolls a player's major/minor restrictions before their game, per the tournament
doc, then keeps the results.

| Page | What it is |
| --- | --- |
| `/` | Landing: where to go |
| `/session` | Lobbies — open one as gamemaster, or join with a code |
| `/s/CODE` | One lobby's live dashboard |
| `/me` | Your account: matches, placements, and what each restriction costs you |
| `/roller` | Solo roller — same engine, no account, nothing saved server-side |
| `/organiser` | Organiser dashboard — every player, lobby and result (needs `ADMIN_KEY`) |
| `/proctor` | Optional: a player shares their game window and their own browser watches it |
| `/lab` | Measure the proctor: self test, replay a recording, score it against what happened |

**Why any of it works the way it does — including the calls that could have
gone otherwise and the risks still open — is written down in
[DECISIONS.md](DECISIONS.md).**

Static HTML/CSS/JS plus a handful of serverless functions. No build step, no
framework, no dependencies — same design language as
[dehpeh.dev](https://dehpeh.dev): same tokens, same type, five themes including a monochrome dark one.

## Run it locally

```bash
node tft-randomizer/server.mjs
```

<http://localhost:4700>. The dev server serves the static files and runs the
functions in `api/` on the same origin, so accounts, lobbies and placements all
work end to end with no cloud account — state goes to a JSON file in your home
directory. Fine for development and for running a tournament off one machine.

## Deploy it (Vercel + Upstash Redis)

1. Import the repo on Vercel. No build command, no framework preset — it is a
   static site with functions.
2. **Storage → Create Database → Upstash for Redis**, connect it to the project.
   That sets the REST url and token. Whether they arrive as
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` or `KV_REST_API_URL` /
   `KV_REST_API_TOKEN`, `api/_store.js` accepts either pair.
3. Add `SESSION_SECRET` — 24+ random characters. It signs the login cookies;
   changing it later signs everyone out.
4. Optionally add `ADMIN_KEY` — another long random string. It enables the two
   things nobody else can do: resetting a forgotten passcode, and wiping
   everything before the tournament starts. Leave it unset and `/api/admin`
   stays disabled entirely.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Both required variables are checked rather than assumed: on Vercel, a missing
`SESSION_SECRET` and a missing Redis each throw with a message saying which one,
instead of falling back to a per-instance file that serverless functions do not
share and letting sessions appear to vanish at random.

**Do not move the client scripts back to the repo root.** Vercel's zero-config
build treats a root-level `app.js` (or `server.js`, `index.js`) as a Node server
entrypoint and puts it in front of everything as a catch-all function — browser
code gets invoked as a server, crashes on boot, and every path returns
`FUNCTION_INVOCATION_FAILED`, static files included. That is why the client lives
in `assets/`, the shared engine in `lib/`, and `server.mjs` is in `.vercelignore`.

## Accounts

One account per name, first come first served, with a 6-digit passcode.
The account carries your display name, your peak rank, and every lobby you have
played. Registering claims the name; after that the same name needs the same
passcode.

A seat in a lobby copies your rank rather than reading it live, so a gamemaster
correcting your rank for this tournament does not rewrite your account, and
editing your account later cannot change what you were already rolled against.

### About the 6-digit passcode

Six digits is a million combinations — enough to stop a friend opening your
match history, not enough to stop anyone determined. It is treated as what it is:

- passcodes are scrypt-hashed with a per-account salt, never stored raw
- eight wrong attempts locks that name out for 15 minutes
- login cookies are HttpOnly, SameSite=Lax and HMAC-signed
- POSTs check the Origin header
- there is no password reset without `ADMIN_KEY`, because there is no email

Do not reuse this pattern for anything that matters. Here the worst case is
someone learning which trait you are banned from playing.

## How a tournament night runs

1. Everyone registers at `/me` (or on the way into a lobby) with a name, a
   6-digit passcode, and their **peak rank**. Whatever they type is what the
   lobby sees them as — Riot ID, Discord handle, first name.
2. Gamemaster opens a lobby at `/session` and shares the `/s/CODE` link.
3. Players click it and take a seat. The gamemaster can correct any rank from
   the roster.
4. Gamemaster picks the game tab and hits **Roll everyone without restrictions**.
   Every dashboard shows the results within a few seconds — your own
   restrictions flicker in at the top, everyone else's fill the roster.
5. Play. Late joiner? Roll again: `missing` only touches players with nothing
   yet. Restriction impossible in that lobby? **Reroll** that one slot.
6. Afterwards the gamemaster enters **placements** — 1st through 8th, each place
   usable once — and submits. Standings and everyone's stats update from there.

Games 1-3 exist by default and the gamemaster can add more.

## What it implements

**Distribution by rank.** Challenger through Platinum comes from the doc; everything
below it plays clean, so anyone can enter the tournament without being handed a
handicap the ladder never asked for:

| Rank | Rolls |
| --- | --- |
| Challenger | 2 major + 1 minor |
| Grandmaster | 1 major + 2 minor |
| Master | 1 major + 1 minor |
| Diamond | 3 minor |
| Emerald | 2 minor |
| Platinum | 1 minor |
| Gold and below, Unranked | nothing — they play clean |

**"If a player gets two similar restrictions, reroll the lower one."** Every
restriction carries a `family` tag — `shop`, `afk`, `hands`, `drink`, `econ`,
`costban`, `carousel`, `forcebuy`, `augment`, `traits`, and so on. Two
restrictions sharing a family are "similar". Majors are drawn first and minors
are drawn against them, so the one that gets rerolled is always the lower of the
pair. Each slot shows how many auto-rerolls it took, so the rule is visible
rather than silent.

That tag is the only knob the rule needs: if you decide "no 3-star allowed" and
"5/4 costs banned" are too similar to stack, give them the same family in
`lib/restrictions.js` and the randomizer stops pairing them.

**Seeds.** Every roll carries a seed (`6NH3-HM77`). Same seed, same rank, same
pool reproduces it exactly — an umpire can check any disputed roll after the
fact, and the solo roller has a seed field to do it with.

**Pool editor.** Any restriction can be taken out of the draw: per-browser in the
solo roller, per-lobby for a gamemaster. The server refuses to go below 2 major
and 3 minor, since Challenger and Diamond could not be rolled otherwise.

**Rolled details.** Some restrictions leave a blank a player would otherwise
fill in themselves — which shop slot is locked, which stage you sit out, which
augment you take. Left to the player that is a choice, and a choice is an
advantage, so the randomizer fills it from the same seeded stream and shows it
as a rolled result beside the restriction.

The augment ones are rolled all the way down to the pick, because that is what
makes them checkable: `1 augment is chosen randomly` comes out as **At 3-2,
Take middle**, and `No augment freedom` names left/middle/right for all three
stages. An umpire compares the augment taken against what is on the board — no
asking the player what they meant to pick.

**Closed lobbies.** Closing a lobby ends it: no new players, no rolls, no
placements, no penalties, enforced server-side rather than only hidden in the
UI. The board dims and says so. A gamemaster can reopen it, or delete it and
everything in it.

**Penalties.** A gamemaster can record a penalty against a player for a game —
a rule broken, a restriction ignored. It never changes a placement by itself;
the gamemaster decides what it costs. Penalties are visible to the whole lobby,
on the player's own record, and in the organiser dashboard.

**Placements and standings.** Placements are validated like a result, not a
form: every entry names a player in that lobby, sits in 1-8, and is unique — a
lobby where two people came fourth is a typo. Standings score 1st = 8 points
down to 8th = 1 point (`pointsFor` in `assets/session.js`, one line to change).

**Stats.** `/me` shows games played, average placement, firsts, top-4 rate, best
and worst, your full match history with what you were carrying, and every
restriction ranked by your average placement while carrying it. All computed
server-side from the same documents the gamemaster sees.

**The server rolls.** A player's browser never decides its own restrictions,
cannot claim a rank it was not given, and cannot submit its own placement.

## Proctor (beta)

Opt-in, and deliberately modest about what it claims. A player opens
, shares their TFT window through the browser's own screen-share
API, and their machine measures a few things twice a second:

- **Stillness.** Frame differencing needs no calibration and cannot really be
  wrong: if nothing changed for forty seconds, they were not playing. That is
  the AFK restrictions covered.
- **Augment screens.** The overlay is a large, sudden, sustained change in the
  middle of the screen, and it always lands in the same place, so the band is
  preset — nobody is asked where their augment screen is. Splitting that band
  into thirds locates the click: the card that was taken animates while the
  other two do not. That is an inference, so it reads "most movement on the
  left" beside what the roll said, with a screenshot. A two-second check for a
  human, not a verdict.

It never touches the game: no memory reads, no injected input, no overlay, no
file near the client. It is the API a video call uses to share a screen.

The video never leaves the machine. Screenshots live in the tab and die with it.
Only short text notes are sent, and only when the player sends them. Notes land
in the gamemaster's panel marked as observations, kept visually separate from
penalties, which stay a human decision.

Gold at 4-2, locked shop slots and star levels are the obvious next ones. All
three need digit and sprite templates calibrated against real footage at several
UI scales — that calibration is the actual work, not the plumbing.

## Measuring the proctor — and what it found

A detector nobody has scored is a guess, so  scores it. It runs the same
 the live page runs — measuring a copy would be worthless.

**Self test.** Synthetic frames: play, go still, play, open an overlay, animate
one card, close it. It proves the state machine fires in the right order and
names the right card. It proves nothing about real TFT, but it caught a real
bug — the first detector treated any large change as the overlay closing, so a
card animating under the cursor read as a close. It fired three times per
augment and could never name a card. Closing is now decided by resemblance to
two reference frames (the board before, the overlay after) rather than by size.

**Replay.** Drop in an OBS recording. It seeks through the file a fixed step at
a time, which makes a run deterministic and repeatable: change a threshold, run
the same file, compare like with like. The augment band is draggable here
because a stream layout can put the game in a corner with overlays around it,
and the preset assumes the game fills the frame.

**Score.** Mark what actually happened — time and which card — and it reports
found, named right, **named wrong**, said unsure, and false alarms. Named wrong
is the number that matters near a prize: a confident wrong answer is worse than
no answer. Nothing is uploaded; the video never leaves the machine.

### What it found, and what came of it

A 4h21m stream VOD was replayed through it, seven games' worth.

**The first augment detector was wrong.** It looked for a large sudden change in
the middle of the screen and found 65 augment screens in fifteen minutes, where
there were two. Combat, spectating another board, a camera move and a team
planner all look identical to it. Raising the threshold only trades false alarms
for missed augments: the signal was wrong, not mistuned.

**The second one works, because it reads the words instead.** The screen says
"Choose One" in the same place in the same font every time; matching that text
scores 0.95-1.00 on real augment screens and never above 0.36 on anything else.
Measured across four separate games:

| Game | Augment screens found | Decisions | False positives |
| --- | --- | --- | --- |
| 1 | 4 | 3 | 0 |
| 2 | 4 | 3 | 0 |
| 3 | 5 | 4 | 0 |
| 5 | 4 | 3 | 0 |

Every game shows them at roughly 2m, 11m and 18-19m — 2-1, 3-2 and 4-2, exactly
as TFT deals them. Where a game shows one more detection than decisions, the
player rerolled a card: that re-renders the screen and reads as two detections
seconds apart.

**Which card was taken is not attempted.** Motion across the three cards at the
moment of choosing measured 33/33/33 on every real augment. There is nothing
there to read, so the detector says *when* and never *which*, and the screenshot
goes to a person. That is still the whole job done: the umpire gets the right
frame every time instead of scrubbing a VOD.

**Stillness stays off.** Zero false positives in fifteen minutes of play looks
good until you see why: median frame-to-frame motion while playing was 8.6
against a threshold of 2.4, and that motion is the game animating, not the
player acting. TFT never holds still, so a player doing nothing still produces a
moving screen. Catching AFK needs the parts that only move on input — the shop
row, the gold counter, the bench — and that is not built.

## Organiser dashboard

, behind the same . Everyone who signed up, what they
have been dealt, where they finished, what has been called against them, and
which lobbies exist. From there you can reset a forgotten passcode, delete an
account, or delete a lobby, and export the whole tournament as CSV — one row per
player per game, restrictions and penalties included.

The key is entered per session and kept in that tab only; closing the tab logs
you out. It is a shared credential, not an account, so nothing done there is
attributable to a person.

## Admin: resets

Both need `ADMIN_KEY` set, and both are meant to be run from a terminal.

Wipe everything before the tournament starts — every account, every lobby:

```bash
curl -X POST https://your-domain/api/admin -H 'content-type: application/json' -d '{"key":"YOUR_ADMIN_KEY","op":"wipe","confirm":"WIPE"}'
```

Give someone a new passcode when they forget theirs:

```bash
curl -X POST https://your-domain/api/admin -H 'content-type: application/json' -d '{"key":"YOUR_ADMIN_KEY","op":"resetPasscode","name":"Their#NAME","passcode":"123456"}'
```

`{"op":"deleteAccount","name":"..."}` removes one account. Keep `ADMIN_KEY` off
Discord: it is the only thing standing between a curl command and the whole
database.

## Keyboard

`T` cycles the theme anywhere. On the solo roller: `R` roll, `C` copy last
result, `S` save to log, `P` / `L` jump to pool and log.

## Editing the restrictions

Everything lives in [`lib/restrictions.js`](lib/restrictions.js) — one object per
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
| `index.html` | Landing page |
| `roller.html`, `assets/app.js` | Solo roller |
| `session.html`, `assets/session.js` | Lobbies: sign in, seat, dashboard, placements, standings |
| `me.html`, `assets/me.js` | Account, match history, stats |
| `assets/nav.js` | Theme switch and account chip, shared by every page |
| `lib/restrictions.js` | Restriction pool, rank table, seeded roll engine (browser + server) |
| `lib/matchers.js` | What the proctor looks for: one picture of one thing in one place |
| `assets/styles.css` | Design tokens and components, lifted from dehpeh.dev |
| `api/auth.js` | Register, sign in, sign out, set your own rank |
| `api/create.js` | Open a lobby, become its gamemaster |
| `api/join.js` | Take a seat |
| `api/state.js` | What the dashboard polls |
| `api/roll.js` | Gamemaster rolls: everyone, only the unrolled, or one player |
| `api/gm.js` | Ranks, rerolls, placements, pool, removals, handing over the lobby |
| `api/flag.js` | Proctor notes, text only |
| `api/evidence.js` | A proctor note with the still that goes with it |
| `api/me.js` | Your matches and the numbers derived from them |
| `api/admin.js` | Passcode resets and the pre-tournament wipe (needs `ADMIN_KEY`) |
| `api/_store.js` | Upstash Redis, or a local JSON file when it is absent |
| `api/_auth.js` | Passcode hashing, lockouts, signed cookies |
| `api/_lib.js` | Request helpers and the shape of an account and a lobby |
| `server.mjs` | Local stand-in for Vercel: static files + `api/` on one origin |
