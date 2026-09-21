# Gambit

A chess app that plays against you at a chosen strength, then tells you what you
got wrong and why. No account, no subscription, no network — the engine, the
analysis and the lessons all run on the phone.

---

## Getting it onto the phone

The phone is already set up for this over USB, the same way Anvil was.

```bash
./phone.sh
```

Then on the phone, in your browser's **⋮ menu → Add to Home screen** (Brave) or
**Install app** (Chrome).

It gets its own icon, opens without a browser bar, and works in aeroplane mode
from then on. Unplug once it has loaded.

Re-run `./phone.sh` to push an update; the service worker refreshes itself on the
next launch, so you do not have to reinstall.

<details>
<summary>Why USB, and why the odd hostname</summary>

`phone.sh` uses `adb reverse`, which makes the Mac's server reachable from the
phone on loopback. Browsers treat loopback as a secure origin even over plain
http, which is what lets the service worker register and the install option
appear. A LAN address like `http://192.168.1.20:8778` is *not* a secure origin,
so the browser would refuse the service worker — no offline mode and no
home-screen install. That is the whole reason for the cable.

The URL is `http://gambit.localhost:8778`, not `http://localhost:8778`. Chromium
resolves any `*.localhost` name to loopback and still treats it as secure, and
the distinction matters more than it looks: **an installed web app claims its
entire host on Android, ignoring the port.** Anvil, installed from plain
`localhost`, registered an intent filter for `http://localhost` on *every* port
and *every* path — so opening any other localhost app on this phone pops an
"Open with Anvil?" chooser instead of the app you asked for. Giving each app its
own hostname keeps them out of each other's way. If you ever reinstall Anvil,
put it on `anvil.localhost` for the same reason.

If you want it without a cable, the folder is a plain static site: push it to any
free HTTPS host (GitHub Pages, Netlify, Cloudflare Pages) and install from there.
</details>

To work on it on the Mac: `python3 -m http.server 8778` in this folder, or the
`gambit` entry in `.claude/launch.json`.

---

## What it does

**Play.** Eleven strength levels from 400 to full strength. Choose a colour, or
random. Hint, take back, resign, flip. Your own rating moves after every game on
the usual Elo formula, so beating a level above you counts for a lot and beating
one below you barely registers.

**Review.** After any game, every position is analysed and each of your moves is
graded — Brilliant, Great, Best, Good, Inaccuracy, Mistake, Blunder — with an
accuracy percentage, an evaluation graph, and a sentence explaining what actually
happened:

> 3… Nf6 — **Blunder**. This allows mate in 1. g6 was necessary.
> Best: g6 Qf3 Nf6

> 12. Nd4 — **Mistake**. This leaves the bishop on c5 undefended — Qxc5 wins it.
> Bd3 held everything together.

"Jump to my mistakes" steps through only your own errors. "Show the better move"
puts the position back and draws both moves on the board. "Play on from here"
starts a fresh game from that position so you can try it again properly.

**Two piece sets.** The default is Staunton — the standard tournament shape, the
one every diagram you will ever see uses. The alternative is a carved stone set
in the medieval tradition: seated royalty, a cowled bishop, a chiselled knight, a
rough tower, all hewn angles instead of turned curves. It is drawn from the
historical sets (the Lewis Chessmen and their descendants), not from any film's
props. Settings → Piece style.

**Learn.** 26 lessons, 67 steps, every one of them a position you have to play a
move in — how each piece moves, castling, en passant, promotion and
under-promotion, check/mate/stalemate, opening principles, piece values, six
tactics lessons (fork, pin, skewer, discovered attack, back rank, counting
attackers), five mating patterns (ladder, king and queen, king and rook,
smothered, Scholar's mate and its refutation), and three endgames (opposition,
the square of the pawn, king and pawn).

---

## How strong it actually is

The engine is a straightforward negamax search: alpha-beta, a transposition
table, null-move pruning, late move reductions, quiescence search, and a tapered
evaluation using PeSTO's piece-square tables plus pawn structure, bishop pair,
rook files and king shelter. On this hardware it runs at roughly 50k nodes per
second and reaches depth 8 in a couple of seconds.

**The Elo numbers on the levels are targets, not measurements.** Nothing here has
been calibrated against rated humans or other engines. They were set by shaping
three things per level — search depth, how much noise is added to each move's
score before choosing, and how often a deliberately bad move is thrown in — and
they are in roughly the right order, but do not read "1400" as a FIDE rating. The
rating the app gives *you* is internally consistent (it moves sensibly as you win
and lose) but inherits the same uncertainty.

Weak levels work by scoring every legal move honestly and then picking with
noise, rather than by searching badly. A shallow search alone produces an
opponent that is either trivially weak or suddenly tactically merciless; adding
noise to honest scores makes the mistakes look like the mistakes a human of that
strength makes.

The opening book is 43 named lines, six to eight moves deep. It exists for
variety and for naming what you played, not for strength — the engine is on its
own by move seven.

---

## Correctness

Move generation is verified with perft against the six standard test positions,
to depth 4 or 5, including Kiwipete and the tricky promotion and en-passant
positions. All node counts match exactly, which is what gives confidence that
castling rights, en passant, pins and discovered checks are all handled properly.

```bash
node -e "
const C=require('./chess.js');
console.log(C.perft(C.fromFen(C.START_FEN),5) === 4865609 ? 'ok' : 'BROKEN');
"
```

Every tutorial position and move is checked at load: the FEN must parse, the side
not to move must not be in check, every accepted move must be legal, and a move
written with `+` or `#` must really give check or mate. Problems are logged to the
console rather than leaving you stuck on a step that cannot be completed.

```bash
node -e "
global.Chess=require('./chess.js');
const p=require('./tutorials.js').verify();
console.log(p.length ? p : 'all lessons verified');
"
```

---

## Files

| | |
|---|---|
| `chess.js` | Rules: 0x88 board, make/unmake, SAN, FEN, perft |
| `engine.js` | Evaluation, search, and the strength levels |
| `book.js` | Opening book, replayed and validated at load |
| `review.js` | Per-move classification, accuracy, and the explanations |
| `worker.js` | Runs the engine off the UI thread |
| `board.js` | The board widget: tap or drag, arrows, animation |
| `pieces.js` | Staunton piece artwork as inline SVG |
| `tutorials.js` | Lesson content, plus `verify()` |
| `store.js` | localStorage persistence |
| `app.js` | Screens and flow |
| `phone.sh` | USB install |
| `make-icons.py` | Launcher icons (slow — a minute or two) |

Pieces are hand-drawn SVG rather than the Unicode chess characters, which Android
renders through whichever symbol font is installed — at inconsistent weights, and
sometimes as emoji.

---

## Your data

Everything is in `localStorage` on the phone: games, ratings, lesson progress,
settings. It is never uploaded. Settings → **Export all data** writes a JSON
backup; **Reset everything** deletes it. Clearing the browser's site data, or
uninstalling, loses it — export first if you care about a game.
