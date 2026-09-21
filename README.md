# Gambit

A chess app that plays against you at a chosen strength, then tells you what you
got wrong and why. No account, no subscription, no network — the engine, the
analysis and the lessons all run on the phone.

---

## Getting it onto the phone

The app lives at **<https://efem-code.github.io/gambit/>**.

Open that on the phone **in Chrome**, and tap the **Install** button that appears
along the bottom. It then has its own icon and opens fullscreen with no browser
bar, exactly like Anvil.

Two details that are not optional, both learned the hard way:

* **Chrome, not Brave.** Chrome installs a real web-app package; Brave only
  makes a home-screen shortcut, which opens in a browser tab with a URL bar.
  Anvil is installed by Chrome — `installerPackageName=com.android.chrome` — and
  that is the whole reason it looks like an app.
* **The https address, not localhost.** Android's app-install machinery keys on
  the *hostname and ignores the port*, so every app served from `localhost`
  fights over the same claim: Anvil, installed from plain `localhost`,
  registered itself for `http://localhost` on **every** port and **every** path.
  Serving Gambit from `gambit.localhost` avoided the clash but Chrome then
  refused to launch it fullscreen. A real domain fixes both at once.

To push a change:

```bash
./deploy.sh
```

That stamps a new build into `sw.js`, commits, and pushes. GitHub rebuilds in a
minute or two; next time you open the app it notices the new build and reloads
itself onto it — no cable, no reinstall. The build stamp matters: browsers
compare the service worker byte for byte, and an unchanged file means the phone
keeps running the version it already cached.

<details>
<summary>Running it locally while working on it</summary>

```bash
./phone.sh
```

Serves the folder over USB at `http://gambit.localhost:8778` for testing on the
phone without deploying. Fine for trying a change; not how you install it, for
the reasons above. On the Mac, the `gambit` entry in `.claude/launch.json` does
the same thing in a browser tab.
</details>

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
