# Decisions

Why this works the way it does, including the calls that could reasonably have
gone the other way, and the risks still open. Written for whoever picks this up
next — including future me, who will not remember.

The rule running through all of it: **the randomizer must be provable, and
everything else must be honest about not being.** There is prize money involved,
so anything that could decide an outcome either has to be verifiable or has to
be clearly marked as advice to a human.

---

## Integrity: what is provable and what is not

| | Status | Why |
| --- | --- | --- |
| Rolls | **Provable** | Deterministic and seeded. Any disputed roll can be recomputed from its seed, rank and pool and shown to be correct. |
| Placements | Human | A gamemaster types what happened. Validated for shape (1-8, unique, real players), never for truth. |
| Penalties | Human | A deliberate act by a gamemaster, with a reason attached, visible to the whole lobby. |
| Proctor notes | Advisory | A machine observation. Never costs anyone anything on its own. |

The server rolls, never the browser. A player's client cannot decide its own
restrictions, claim a rank it was not given, or submit its own placement. This
is the one place worth being strict, because it is the only place where being
wrong is silent.

---

## The rules

**Rank distribution** comes from the tournament doc: Challenger 2 major + 1
minor, down to Platinum 1 minor.

**Gold and below play clean.** The doc stops at Platinum, and the ladder is
already tapering — 3 minor at Diamond, 2 at Emerald, 1 at Platinum — so the next
step down is none. Decided deliberately (2026-08-22) so anyone can enter without
being handed a handicap the ladder never asked for.

> **Open risk: sandbagging.** Rank is self-declared and is the only thing that
> decides your handicap, so "Gold" is now strictly better to claim than
> Challenger. Defences: a gamemaster can correct any rank from the roster, and a
> seat copies the rank at join time so nobody can edit it after being rolled.
> That is probably enough for a friend group. It is not enough for strangers,
> and the prize pool makes it worth an organiser eyeballing the roster before
> the first roll.

**"Reroll the lower one" for similar restrictions** is implemented with a
`family` tag on every restriction. Two restrictions sharing a family are
similar. Majors are drawn first and minors are drawn against them, so the one
rerolled is always the lower of the pair. Changing what counts as "similar" is a
one-word edit, which is the point — the doc says the rules are subject to
change.

**Restrictions that leave a blank get it rolled.** Which shop slot is locked,
which stage you sit out, which augment you take. Left to the player, a blank is a
choice, and a choice is an advantage. The augment ones are rolled all the way
down to left/middle/right, because that is what makes them checkable by an
umpire.

**Standings score 1st = 8 down to 8th = 1.** One line in `assets/session.js` if
the tournament settles on something else.

---

## Accounts

One account per name, first come first served, with a 6-digit passcode.

**Six digits is a party lock, not a password.** A million combinations stops a
friend opening your match history and stops nobody determined. It is propped up
accordingly: scrypt-hashed with a per-account salt, eight wrong attempts locks
the name out for fifteen minutes, cookies are HttpOnly and HMAC-signed, POSTs
check the Origin header. The worst case if it fails is that someone learns which
trait you are banned from playing.

**A seat copies your rank rather than reading it live**, so a gamemaster fixing
your rank for this tournament does not rewrite your account, and editing your
account later cannot change what you were already rolled against.

> **Open risk: name squatting.** Registration is first-come with no
> verification; nothing stops someone claiming a name that is not theirs. The
> admin wipe is the undo. If it matters, the fix is a gamemaster pre-seeding the
> roster so only known names can register.

> **Open risk: the organiser key is shared, not personal.** `/organiser` is
> gated on `ADMIN_KEY`, which is one credential, not an account. Nothing done
> there is attributable to a person, so handing it to a co-organiser means
> losing the ability to tell who deleted what. Per-organiser accounts would be
> the fix if the tournament grows.

There is no password reset without `ADMIN_KEY`, because there is no email. That
is a deliberate trade — no email means no signup friction and nothing to leak —
but it does mean an organiser has to be reachable when someone forgets.

---

## Lobbies

**Closing a lobby ends it.** No new players, no rolls, no placements, no
penalties, enforced server-side rather than hidden in the UI. Asked for
explicitly: a closed lobby should read as finished and uneditable, not merely
quiet. A gamemaster can reopen it or delete it outright.

**Penalties are decisions; proctor notes are observations.** They are stored
separately, rendered differently, and worded differently on purpose. A penalty
never happens automatically, and a machine note never becomes one without a
human. Confusing the two would be unfair in a way that costs money here.

**Penalties are visible to the whole lobby.** An umpire decision only the
penalised player knows about is a rumour.

---

## The proctor

Built, measured against 4h21m of real footage, and rebuilt once. The full
account is in the header of `lib/detect.js`; the short version:

**Attempt one — motion — was wrong.** Looking for a large sudden change in the
middle of the screen found 65 "augment screens" in fifteen minutes where there
were two. Combat, spectating another board, a camera move and a team planner all
look the same to it. Not a tuning problem; the signal was wrong.

**Attempt two — the words — works.** The screen says "Choose One" in the same
place in the same font every time. Matching that text scored 0.95-1.00 on real
augment screens and never above 0.36 on anything else. Across four games it
found every augment decision with nothing false in between.

**Which card was taken is deliberately never claimed.** Motion across the three
cards at the moment of choosing measured 33/33/33 on every real augment. There
is nothing there to read, so the detector reports *when* and never *which*, and
the screenshot goes to a person. The self test asserts it never guesses.

**Stillness is off.** Zero false positives looked good until the reason showed
up: median motion during play was 8.6 against a threshold of 2.4, and that
motion is the game animating, not the player acting. TFT never holds still, so a
player doing nothing still produces a moving screen. Catching AFK needs the parts
that only move on input — shop row, gold counter, bench — and that is not built.

**Constraints that shaped it**, all from the tournament side:

- It must not touch the game. `getDisplayMedia` reads pixels the OS already
  composited — the API a video call uses. No memory reads, no injected input, no
  overlay, no file near the client. Explicitly ruled out: anything that locks
  mouse or keyboard. That is functionally a RAT, needs privileges players should
  not grant a tournament, and its failure mode is someone stuck mid-game.
- The video never leaves the machine. Screenshots live in the tab; only short
  text notes are sent, and only when the player sends them.
- It flags, it never judges.

> **Open risk: validated on one player, one resolution, one patch.** The
> template came from a 640x360 stream copy. It is resolution-independent by
> construction (the crop is resampled), but a patch that restyles the text, a
> non-16:9 aspect, or a localised client would all break it. Have two or three
> people replay their own recordings in `/lab` before relying on it.

**Why `/lab` exists.** A detector nobody has scored is a guess. It replays a
recording through the exact same `lib/detect.js` the live page runs — measuring
a copy would be worthless — and scores it against what a human says happened.
It caught three real bugs before any footage was involved.

---

## Hosting

**Vercel + Upstash Redis**, chosen to match the deployment style already in use
for dehpeh.dev. Two traps worth knowing:

- **Never put client scripts at the repo root.** Vercel's zero-config build
  treats a root-level `app.js`, `server.js` or `index.js` as a Node server
  entrypoint and puts it in front of everything as a catch-all. Browser code
  then runs as a server, crashes on boot, and *every* path returns
  `FUNCTION_INVOCATION_FAILED` — static files included. This took the whole site
  down once. Hence `assets/`, `lib/`, and `server.mjs` in `.vercelignore`.
- **Environment variables only reach builds that start after they are saved.**
  Adding one and not redeploying looks exactly like the variable not working.
  This wasted time twice.

`api/_store.js` accepts either naming Upstash might hand you
(`UPSTASH_REDIS_REST_*` or `KV_REST_API_*`) rather than depending on which
button you came in through. On Vercel, a missing secret or missing Redis throws
with a message naming which one, instead of silently falling back to a
per-instance file that serverless functions do not share.

**The local fallback is real, not a toy.** With no Redis configured,
`server.mjs` runs the whole thing from a JSON file. That is the backup plan if
Upstash is down on tournament night: run it off one machine.

**Dev-only endpoints** in `server.mjs` (`/dev-video`, `/dev-save`) are gated on
environment variables that are unset by default and live in a file that never
deploys. They exist so the lab can be pointed at a recording outside the repo.

---

## Deliberately not built

- **Automatic penalties from proctor output.** The whole design depends on a
  human between an observation and a consequence.
- **Naming which augment card was taken.** Measured, found impossible from
  pixels, not faked.
- **AFK detection.** Would need shop/gold/bench regions; the version that
  existed measured the wrong thing.
- **Per-organiser accounts.** One shared key is enough for now, and the
  attribution gap is written down above rather than papered over.
- **Anything that reads or writes to the game client.** Ban risk, and unnecessary.

---

## Still open

1. **Run the pre-tournament wipe** once everyone is ready to register for real.
2. **Prize eligibility for clean-playing ranks.** Gold and below carry no
   handicap and can win a cash prize. Decide deliberately rather than discover
   it on the night — a rank floor for prizes, or giving Gold 1 minor, are both
   one-line changes.
3. **Proctor validation by more than one person**, per the risk above.
4. **The site becomes the tournament hub.** The randomizer is a page, not the
   app: `/` can become the front page with dates, format and signups while
   everything here keeps working.
