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

**Four more restrictions were asked for and are declared, not calibrated.** The
same trick — find the distinctive thing, crop it, compare it — extends to the
carousel, the gold counter at 4-2, an empty trait panel and 3-star pips. Each is
defined in  with the region it lives in, and each is waiting on
a picture rather than on code. The reason they are not calibrated is measured:
in the only footage available (a 640x360 YouTube copy) the augment text is
128x29px while a gold digit is 8x11, a trait hexagon 14x13 and a star pip 5x4.
At the 1080p a player actually captures those become 23x32, 42x38 and 15x13 —
workable. Calibrating against the small copy would produce numbers that look
fine and do not transfer, which is precisely what the first motion detector did.
So the lab grew a capture tool instead: scrub to the moment, check the box lands
on the thing, press capture. Thirty seconds per restriction, on footage at the
resolution it will really run at.

**Confirmed on a real machine.** A full game at native resolution produced
three augment findings at 02:35, 11:58 and 19:41 — 2-1, 3-2 and 4-2 — each
with the screen and the moment it closed. That also settled the one untested
assumption: the sampling clock kept real time for twenty minutes while the
browser tab sat behind the game, so moving it into a Web Worker did beat
background throttling.

**A clip button covers what no matcher will.** The machine watches for things
it has a picture of, and there will always be more restrictions than pictures.
One button — or the C key, since nobody alt-tabs out of a carousel — grabs the
frame and files it exactly like an automatic one. It is the honest general
case: the detector saves an umpire from watching, a human still decides what
mattered.

**Augment notes name the stage they apply to.** A game deals three augment
screens and a restriction usually governs one of them; printing the rolled
instruction against all three invites an argument about the two it has nothing
to do with. The nth screen is 2-1, then 3-2, then 4-2, which is enough to say
which.

**Constraints that shaped it**, all from the tournament side:

- It must not touch the game. `getDisplayMedia` reads pixels the OS already
  composited — the API a video call uses. No memory reads, no injected input, no
  overlay, no file near the client. Explicitly ruled out: anything that locks
  mouse or keyboard. That is functionally a RAT, needs privileges players should
  not grant a tournament, and its failure mode is someone stuck mid-game.
- The video never leaves the machine. Screenshots live in the tab; only short
  text notes are sent, and only when the player sends them.
- It flags, it never judges.

**Evidence travels with the note.** Text-only notes were close to useless — "augment screen at 04:12" tells a gamemaster where to look but not what they would have seen, and by then the game is over. A 480px still goes with each note. Stills rather than clips: a clip of useful length is megabytes, encoded on a machine currently running a game. Images are stored under their own keys and never inside the session document, because the dashboard re-reads that document every few seconds for every player in the lobby.

> **Open risk: validated on one player, one resolution, one patch.** The
> template came from a 640x360 stream copy. It is resolution-independent by
> construction (the crop is resampled), but a patch that restyles the text, a
> non-16:9 aspect, or a localised client would all break it. Have two or three
> people replay their own recordings in `/lab` before relying on it.

**Three of the five detectors need no picture.** Template matching is the
strongest tool here and it is what made the augment screen work, but it has a
cost: someone has to be at the moment, in the game, on the hardware, to capture
the template. That is a person and a game lining up, and it is why four
matchers sat declared-but-empty for weeks.

Three of them turn out not to need one, because the thing being asked is about
shape or colour rather than about appearance:

| Restriction | The question, restated | How it is answered |
| --- | --- | --- |
| Level/roll to 0 gold at 4-2 | Is the gold counter a lone zero | One glyph, a hole through the middle, and equal ink above and below it |
| Built Different | Is any trait active | Is anything in the trait strip warm and saturated rather than grey |
| No 3-star | Are there three star pips | Three small bright-gold blobs, level, evenly spaced |

These compute from first principles at any resolution with no calibration, and
`lib/features.test.js` checks the geometry against shapes drawn in code: a zero
rasterised from a 5x7 font is recognised at five capture scales, and 1 through
9 plus 10/20/48/60/80 are all rejected. The awkward case is a closed 4 — it has
an enclosed hole near the middle of its box, so hole-detection alone calls it a
zero. What separates them is that a zero is a ring, with the same stroke above
the hole and below it, where a 4 hangs a long stem below a small triangle.

**They ship off anyway.** Passing on drawn shapes means the algorithm does what
it claims; it says nothing about TFT’s font, its antialiasing, its compression,
or whether the box is even on the right part of the screen. That is precisely
the position the motion detector was in immediately before real footage
destroyed it — 65 false augment calls in 15 minutes. So each one is listed on
`/lab` as "off", with a button to turn it on for that browser after scoring it
on a recording. The state a matcher is in is shown in three words — ready, off,
waiting — because conflating "untested" with "tested" is exactly how an
unscored detector ends up deciding a cash prize.

**Which edge is worth a note differs per restriction.** Reporting every state
change is a state dump, not an umpire’s note. Gold passes through zero most
rounds of a normal game, so its arrival is capped at six notes with 45 seconds
between them and reads as evidence rather than an alarm. Built Different is the
opposite: the long stretch with nothing active is the compliant state and the
moment a trait lights up is the breach, so it flags on the closing edge. Each
matcher declares this next to itself in `lib/matchers.js`, and the proctor
enforces it — which also stops one chatty detector eating the twelve
screenshots a game is allowed.

**The shop row is worth six restrictions on its own.** Lock a shop space, ban
5-costs, buy every 1-cost you see — three rules, six entries between minor and
major, and all of them are questions about the same five cards. None needs a
picture, because the shop announces itself two ways that survive any
resolution:

| What is asked | How it is answered |
| --- | --- |
| Which slot was locked | The one that survives a reroll |
| Was something bought | Exactly one slot empties, the rest untouched |
| What did it cost | The colour of its name bar |

The first two are change over time, not appearance — which parts of a picture
differ from the picture before it. That works at 360p or 4K, in any language,
through any skin, and it is the half that does the real work.

**The colour half is the weak half, and the reference footage showed exactly**
**how.** At 640x360 compression smears the low-saturation 1-cost bar toward blue
until its hue lands on top of a 3-cost — 185-203 against 207-216. Hue alone
cannot separate them. Saturation can, 0.35-0.44 against 0.54-0.61, which is why
the classifier reads both and why the fitted numbers live in a table in
`lib/shop.js` rather than scattered through the code. Scored against readings
labelled by eye off the same frames, it gets 14 of 15 and reports the fifteenth
as unreadable rather than guessing.

**Three things had to be built before it stopped lying.** Each was found by
running it over real footage, and each is in `lib/shop.test.js` so it stays
fixed:

- **The sell bar.** Dragging a unit replaces the entire shop with a dark
  "Sell for 1g" band, which read as four 1-costs — the grey rule had no
  saturation floor, so anything dim and bluish qualified. Measured: the sell bar
  sits at luminance 20, a real name bar at 42-99, an empty slot at 7-8. The gap
  between 18 and 30 is now where the answer is that there is nothing readable.
- **Transitions.** The shop dims through combat and fades on the way back, and
  read frame by frame that produced sixteen "rerolls" in two minutes. A reading
  now has to agree with the one before it before it counts, so a transition —
  whose frames never agree with each other — produces nothing. Sixteen events
  became three.
- **Overlays.** In the reference stream the fifth slot sits a quarter underneath
  the streamer’s webcam, and averaging across it turned an empty slot into a
  confident 2-cost. A real name bar is one flat colour across its width, so the
  quarters of the bar are compared and a slot that disagrees with itself is
  reported as covered. That matters beyond this one video: anyone running an
  overlay over their shop would otherwise get confident nonsense.

**What the gold counter needs that this footage cannot give.** Gold at zero and
gold on an econ threshold are both digit-shape questions, and the box was
measured off real footage — the earlier one was twice as tall as it needed to
be. But at 640x360 the digits are five pixels tall, and segmentation is a coin
flip: it read 50 correctly and 30 as a single glyph. These are written and
unproven, and they need a capture at 720p or better before they mean anything.

**What is not built, and why.** Two restrictions get no detector at all, and
saying so is more useful than shipping something that looks like one:

- *Declare left or right and only position on that side.* The board is drawn in
  perspective and units overlap; separating "on the wrong half" from "near the
  middle" is noise at any resolution I can test. A screenshot answers it in a
  second, which is what the clip button is for.
- *Cannot play a line found in a guide.* Nothing on screen distinguishes a line
  someone worked out from one they read. This is honour, and no amount of
  detection changes that.

The physical ones — hands, layers of clothing, drinking — are deliberately out
of scope: watching them would mean a webcam, and the constraint from the start
was that this streams the game and nothing else.

**The augment detector was blind above 720p, and nothing had caught it.** A
full 36-minute game, played at 1440p and captured by OBS to 1080p, produced
zero augment detections. The detector that 4h21m of footage had called proven,
and that an on-device test had confirmed, found nothing at all.

It was not blind, it was mis-scaled. The three real augment screens scored
0.50, 0.55 and 0.57 against a threshold of 0.60 — above every real screen and
below nothing — while the rest of the game stayed under 0.31. The signal was
intact; only the number was wrong.

The cause was the resampling. `crop()` took the nearest source pixel per
template cell. On the 360p stream the template came from, the augment region
is about 128x29 going into 64x14, a 2x reduction that loses almost nothing. At
1080p the same region is about 384x86 — a 6x reduction, where taking one pixel
in six off thin white lettering is a coin toss per stroke. Averaging every
source pixel in the cell instead, with the same template and the same frames:

| Footage | Nearest-neighbour | Area-averaged | Noise floor |
| --- | --- | --- | --- |
| 1080p capture | 0.50-0.57 | **0.93-0.97** | 0.28 |
| 360p reference | 0.78-0.83 | **0.95-0.98** | 0.38 |

Both got better, including the footage the template was built from, which is
what a correct resampling fix should do. Rescanning the full game after it:
three augment screens, three detections, nothing false in 2,195 frames.

**The obvious fix would have hidden the bug again.** Rebuilding the template
from the 1080p footage scored 0.95-0.99 on it and would have shipped a
detector that worked at one resolution and silently failed at another — the
same failure, moved. What ruled it out was knowing the game ran at 1440p and
OBS wrote 1080p, which pointed at scaling rather than at the picture.

**The trait panel took three attempts, and the first two both looked right.**

1. *Warm and saturated.* Active traits are bronze and gold, inactive ones grey.
   Bronze is warm; silver, chromatic and prismatic are not. Measured on a real
   panel, an active Elderwood at silver sits at saturation 0.32 where the rule
   wanted 0.45 and a warm hue — every high tier was invisible. One game: 21
   false Built Different windows, 143 false activations.
2. *Hexagon against the gap beneath it.* Local contrast beats absolute
   brightness, and it does — over a mid-tone board. The panel is translucent,
   and over a bright sky the gaps are brighter than the hexagons, so every
   comparison goes negative and a frame with nine active traits reads as zero.
3. *Saturation, read as a run down the column.* An active hexagon is coloured
   whichever tier it is; an inactive one is grey; and sky, grass, lava and
   water do not make a grey hexagon coloured. Rows are not counted
   individually at all — pitch errors compound down a column of ten, and
   eyeballing it was worth two wrong answers already. TFT sorts active traits
   to the top, so the answer is how far the colour runs before it stops.

Across the full game that gives 69 frames reading "nothing active" out of
1,090: 62 in the first three minutes where it is true, four on the post-game
screen, and three isolated frames in between — none of which survives the
detector's two-sample hysteresis.

**What it still cannot do is count.** The run stops when the colour stops, and
below the last trait there is no panel, there is board — which is also
coloured. A nine-trait panel over open ground runs on to twelve. That is why
the banned-trait rule gets no detector: it needs to name one specific trait,
counting activations was the workaround, and a count that drifts by a trait
between frames makes "the count went up" fire on the drift. The panel prints
trait names in plain text, so a person reading a clip settles it in a second.
Built Different is unaffected, because the run starts at the top: an all-grey
panel stops at zero no matter what is underneath it.

**Three failures in one session, all of the same kind.** A hidden browser pane
freezes the video texture, so `drawImage` returns one stale frame while
`readyState` still reads 4 and `currentTime` still advances — an entire
evaluation came back with every frame scoring identically and a rebuilt
template scoring a perfect 1.00 on ordinary play, which is a template that
matches nothing. The dev server leaked a file handle per range request and
died of EMFILE partway through a ten-minute scan. And the resampling above.
None announced itself; each looked like a result until it was checked. Every
scan now fingerprints its frames and refuses to report a run that repeated one.

## What each restriction is actually watched by

The honest state of every rule. "Watched" means a detector exists and has
been scored on real footage; "off" means it exists and has not earned its
switch; "human" means no detector, by decision.

| Restriction | How | State |
| --- | --- | --- |
| 1 augment chosen randomly | "Choose One" text, and the round indicator says which stage | watched |
| No augment freedom | same | watched |
| Lock 1 shop space (minor and major) | the locked slot is the one that survives a reroll | watched |
| 5 costs banned until stage 5 | name-bar colour for the cost, round indicator for the stage | watched |
| 5 and 4 costs banned | same | watched |
| Must buy every 1-cost | a 1-cost still in the row when the shop changed | watched |
| Must buy every 1 or 2-cost | same | watched |
| Carousel banned for 2 stages | the carousel is the stage-4 round | watched |
| Carousel banned permanently | same | watched |
| Roll to 0 gold at 4-2 | the gold counter, read as a lone ring | watched |
| Roll on an econ threshold | two digits ending in a zero | watched |
| AFK 1 round every stage | no shop change and nothing moving while the shop is up | watched |
| AFK a whole stage | same, every round in it | watched |
| Keep the 1-1 pet on the bench | a bench square held for minutes, then empty | watched |
| Built Different | colour running down the trait column | off, see below |
| No 3-star unit | not built — see below | human for now |
| Only Risky wisps | wants a picture of the wisp screen | not built |
| Ban a trait | needs the trait named, not counted | human |
| Declare left or right | perspective board, overlapping units | human |
| No line from a guide | not on screen at all | human |
| Hands, layers, drinking | would need a webcam | out of scope by design |

**Built Different is off** because it works on the frames it was built from and
reads 95 "nothing active" frames in the second game against 3 in the first,
which is not explained. Until it is, it stays off.

**The 3-star detector was removed rather than left switched off.** The idea was
that three star pips are three small bright-gold blobs, level and evenly
spaced, so no picture would be needed. Over a real game it fired on 16 of 75
samples — and a 3-star is permanent once it exists, so anything intermittent is
wrong by construction. Looking at what it caught settled it: a striped plant, a
wing, a patch of golden glow, a stretch of pink board. TFT boards are full of
small gold things in rows, and no threshold separates them from pips.

Doing it properly needs the search narrowed to where pips can actually be — the
board's hex centres, which are in perspective and would have to be measured —
or a template captured from a real 3-star, which needs a game containing one.
Neither is hard; both need work this has not had. Reporting nothing beats
reporting scenery, and dead code that looks like a feature is worse than an
empty row in this table.

**The three that are human, and why that is not laziness.** A banned trait has
to be named — counting activations was the workaround and the count drifts at
the bottom of the panel, so "the count went up" fires on drift. Left-or-right
positioning is a perspective board with overlapping units. And nothing on
screen distinguishes a comp somebody worked out from one they read. All three
are a glance at a clip, which is what the clip button is for.

**Reading the numbers changed the shape of this.** Before it, "5 costs banned
until stage 5" could only produce "a 5-cost was bought, check the stage" — the
actual question left to whoever read it. The round indicator is two percent of
the frame and turns four of these rows from a hint into an answer, including
the carousel, which needs no template at all once you know a carousel is the
stage-4 round.

**Every detector is gated on the roll.** A player without a shop restriction
is never told what their shop did. This is not tidiness: a feed with a note in
it that means nothing teaches a gamemaster to skim, and then the one that
mattered gets skimmed too.

---

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

1. **Re-run the wipe if registration starts over.** It has been run once, on a
   clean slate before the tournament; `api/admin.js` will do it again.
2. **Prize eligibility for clean-playing ranks.** Gold and below carry no
   handicap and can win a cash prize. Decide deliberately rather than discover
   it on the night — a rank floor for prizes, or giving Gold 1 minor, are both
   one-line changes.
3. **Proctor validation by more than one person**, per the risk above.
4. **Score the unproven detectors on a clean capture.** They are written,
   tested, and switched off. Turning one on is a button on `/lab`; earning it is
   a replay of a real game where it fires when it should and stays quiet when it
   should not. The shop model has cleared part of that bar already — it found a
   confirmed purchase and refused the sell bar on real footage — but on one
   stretch of one 360p stream. The gold detectors cannot clear it at all at that
   resolution. An OBS capture at native resolution is the thing that settles both,
   and the carousel and wisp matchers still want a picture nobody has taken.
5. **The site becomes the tournament hub.** The randomizer is a page, not the
   app: `/` can become the front page with dates, format and signups while
   everything here keeps working.
