/* Gambit — measure how strong the levels actually are.
 *
 * The Elo numbers on the levels were invented. This plays them against each
 * other under exactly the settings the app uses — same depth caps, same time
 * budgets, same noise and blunder rates, same move-choosing code — and works
 * out the real gaps between them.
 *
 * What this can and cannot establish: self-play measures the *spacing* between
 * levels precisely, and nothing else. Anchoring that ladder to human Elo needs
 * a reference opponent of known strength, which is not available offline, so
 * the absolute numbers stay an estimate however many games are played. The
 * spacing is the part that makes a rating track improvement honestly.
 *
 *   node calibrate.js <eloA> <eloB> <games> <out.json>
 */
global.Chess = require('./chess.js');
global.Engine = require('./engine.js');
global.Book = require('./book.js');

var C = global.Chess, E = global.Engine, B = global.Book;

/* One side's move, chosen exactly as worker.js chooses it. */
function pickMove(search, pos, cfg, useBook) {
  if (useBook) {
    var bm = B.probe(pos);
    if (bm) return bm;
  }
  var r = search.think(pos, { depth: cfg.depth, time: cfg.time, exactRoot: cfg.noise > 0 });
  if (!r.move) return 0;
  return E.chooseMove(r, cfg);
}

/* Returns 1 (white wins), 0 (black wins) or 0.5. */
function playGame(cfgWhite, cfgBlack, openingPlies) {
  var pos = C.fromFen(C.START_FEN);
  var searchW = new E.Search(), searchB = new E.Search();

  /* A few book moves so the sample is not the same game 24 times. */
  for (var i = 0; i < openingPlies; i++) {
    var bm = B.probe(pos);
    if (!bm) break;
    C.makeMove(pos, bm);
  }

  var resignCount = 0, lastSign = 0;
  for (var ply = 0; ply < 300; ply++) {
    var out = C.outcome(pos);
    if (out) {
      if (out === 'checkmate') return pos.side === C.WHITE ? 0 : 1;
      return 0.5;
    }
    var white = pos.side === C.WHITE;
    var cfg = white ? cfgWhite : cfgBlack;
    var search = white ? searchW : searchB;
    var m = pickMove(search, pos, cfg, ply < 12);
    if (!m) return 0.5;

    /* Adjudicate hopeless positions rather than playing them out. The test is
       the static evaluation, not a search: a search here costs more than the
       move itself and dominated the whole run. Requiring the same verdict for
       ten plies in a row is what keeps a tactical blip from ending a game. */
    var stat = E.evaluate(pos);
    var whitePov = white ? stat : -stat;
    var sign = whitePov > 1100 ? 1 : whitePov < -1100 ? -1 : 0;
    if (sign !== 0 && sign === lastSign) { if (++resignCount >= 10) return sign > 0 ? 1 : 0; }
    else resignCount = 0;
    lastSign = sign;

    C.makeMove(pos, m);
  }
  return 0.5;
}

var eloA = +process.argv[2], eloB = +process.argv[3];
var games = +process.argv[4], outFile = process.argv[5];
var cfgA = E.levelFor(eloA), cfgB = E.levelFor(eloB);

var scoreA = 0, w = 0, d = 0, l = 0;
var started = Date.now();
for (var g = 0; g < games; g++) {
  var aIsWhite = g % 2 === 0;
  var openingPlies = 4 + (g % 5) * 2;
  var res = aIsWhite ? playGame(cfgA, cfgB, openingPlies) : playGame(cfgB, cfgA, openingPlies);
  var aScore = aIsWhite ? res : 1 - res;
  scoreA += aScore;
  if (aScore === 1) w++; else if (aScore === 0.5) d++; else l++;
}

var pct = scoreA / games;
/* The standard conversion, with a floor and ceiling so a clean sweep does not
   produce an infinite gap. */
var clamped = Math.min(0.99, Math.max(0.01, pct));
var eloDiff = -400 * Math.log10(1 / clamped - 1);

var result = {
  a: eloA, b: eloB, games: games,
  wins: w, draws: d, losses: l,
  scoreA: +pct.toFixed(4),
  eloDiffAOverB: Math.round(eloDiff),
  seconds: Math.round((Date.now() - started) / 1000)
};
require('fs').writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
