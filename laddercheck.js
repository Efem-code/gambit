/* Gambit — how strong is each level, measured by the moves it picks?
 *
 * Self-play measures strength but costs hours a match at the top, where each
 * side thinks for seconds a move. This is the cheap instrument: play every
 * level through the exact code path the app uses, on the same positions, and
 * score each chosen move against a long reference search. Centipawns lost a
 * move is a much tighter signal than the result of ten games.
 *
 * It measures move quality, not match results, so it cannot produce an Elo
 * number on its own — it is for ordering the levels and seeing where the
 * ladder has run out of room.
 *
 * This is the instrument that caught the exactRoot bug. Self-play had the top
 * level losing 8-2 to the one below it, which ten games could not distinguish
 * from bad luck. Measured this way the answer took minutes and was not close:
 * the top level gave away 61 centipawns a move against the next level's 14,
 * because it was the one level with no score noise and the root window was
 * tied to whether a level had any. Turning the same level's root window back
 * on took it to 2.2, the best on the ladder.
 *
 *   node laddercheck.js [referenceMs] [cacheFile] [elo ...]
 */
var fs = require('fs');
global.Chess = require('./chess.js');
global.Engine = require('./engine.js');
global.Book = require('./book.js');
var C = global.Chess, E = global.Engine, B = global.Book;

var REF_MS = +(process.argv[2] || 10000);
var CACHE = process.argv[3] || '/tmp/gambit-topcheck-positions.json';
var ELOS = process.argv.slice(4).map(Number).filter(function (n) { return !isNaN(n); });
if (!ELOS.length) ELOS = [1600, 1800, 2000, 2200, 2400];

function collectPositions(n) {
  var out = [], cfg = E.levelFor(1600), guard = 0;
  while (out.length < n && guard++ < 40) {
    var search = new E.Search(), p = C.fromFen(C.START_FEN);
    for (var i = 0; i < 10; i++) { var bm = B.probe(p); if (!bm) break; C.makeMove(p, bm); }
    for (var ply = 0; ply < 70 && C.legalMoves(p).length; ply++) {
      var r = search.think(p, { depth: cfg.depth, time: cfg.time, exactRoot: true });
      if (!r.move) break;
      C.makeMove(p, E.chooseMove(r, cfg));
      if (ply > 8 && ply % 7 === 0 && C.legalMoves(p).length > 8) {
        out.push(C.toFen(p));
        if (out.length >= n) break;
      }
    }
  }
  return out;
}

var positions = fs.existsSync(CACHE)
  ? JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  : collectPositions(24);
if (!fs.existsSync(CACHE)) fs.writeFileSync(CACHE, JSON.stringify(positions));
console.log('Using ' + positions.length + ' positions, ' + (REF_MS / 1000) + 's reference.\n');

var stats = ELOS.map(function () { return { sum: 0, n: 0, worst: 0, agreed: 0 }; });

positions.forEach(function (fen, idx) {
  var p = C.fromFen(fen);
  var ref = new E.Search().think(p, { time: REF_MS, depth: 20, exactRoot: true });
  var exact = {};
  ref.rootMoves.forEach(function (rm) { exact[rm.move] = rm.score; });
  var bestScore = ref.rootMoves.length ? ref.rootMoves[0].score : 0;

  var row = '  ' + String(idx + 1).padStart(2) + '.';
  ELOS.forEach(function (elo, li) {
    var cfg = E.levelFor(elo);
    /* Exactly what worker.js does for a move, minus the opening book. */
    var r = new E.Search().think(C.fromFen(fen), {
      depth: cfg.depth, time: cfg.time, exactRoot: true
    });
    var chosen = E.chooseMove(r, cfg);
    var got = exact[chosen];
    if (got === undefined) { row += '      ?'; return; }
    var gave = Math.max(0, bestScore - got);
    var s = stats[li];
    s.sum += gave; s.n++;
    if (gave > s.worst) s.worst = gave;
    if (chosen === ref.move) s.agreed++;
    row += (gave ? ' -' + gave : '  =').padStart(7);
  });
  console.log(row);
});

console.log('\n  level   mean loss    worst   matched the reference');
ELOS.forEach(function (elo, li) {
  var s = stats[li];
  if (!s.n) return;
  console.log('  %s   %s cp   %s cp        %d/%d', String(elo).padStart(4),
    (s.sum / s.n).toFixed(1).padStart(7), String(s.worst).padStart(5), s.agreed, s.n);
});
console.log('\nEach level should lose less than the one below it. Where two levels');
console.log('lose the same amount, the ladder has stopped separating them.');
