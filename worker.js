/* Gambit — engine worker.
 *
 * Search runs here so the board stays responsive: on a phone a two-second
 * think on the main thread means two seconds of frozen scrolling.
 */
importScripts('chess.js', 'engine.js', 'book.js', 'review.js');

var search = new Engine.Search();

function pvSan(fen, moves) {
  var p = Chess.fromFen(fen), out = [], n = 0;
  for (var i = 0; i < moves.length; i++) {
    var legal = Chess.legalMoves(p), ok = false;
    for (var j = 0; j < legal.length; j++) if (legal[j] === moves[i]) { ok = true; break; }
    if (!ok) break;
    out.push(Chess.moveToSan(p, moves[i]));
    Chess.makeMove(p, moves[i]); n++;
  }
  while (n--) Chess.unmakeMove(p);
  return out;
}

var PIECE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
var VALUE = [0, 100, 320, 330, 500, 900, 20000];

/* What the opponent gets to do about a move — the part a warning has to name.
   "This is bad" teaches nothing; "this drops the rook on d4 to Bxd4" does. */
function punishment(p, move) {
  var legal = Chess.legalMoves(p), ok = false;
  for (var i = 0; i < legal.length; i++) if (legal[i] === move) { ok = true; break; }
  if (!ok) return null;

  Chess.makeMove(p, move);
  var reply = search.think(p, { time: 250, depth: 8 });
  var out = null;
  if (reply.move) {
    var san = Chess.moveToSan(p, reply.move);
    var victim = (reply.move & Chess.F_CAP) ? p.board[Chess.mTo(reply.move)] : 0;
    if (victim && Chess.typeOf(victim) !== Chess.PAWN) {
      var to = Chess.mTo(reply.move);
      var attacker = p.board[Chess.mFrom(reply.move)];
      var defenders = Review.countAttackers(p, to, p.side ^ 8);
      if (defenders === 0 || VALUE[Chess.typeOf(victim)] > VALUE[Chess.typeOf(attacker)]) {
        out = { san: san, piece: PIECE_NAMES[Chess.typeOf(victim)], square: Chess.sqName(to) };
      }
    }
    if (!out) out = { san: san, piece: '', square: '' };
  }
  Chess.unmakeMove(p);
  return out;
}

self.onmessage = function (e) {
  var msg = e.data, p;

  if (msg.type === 'move') {
    p = Chess.fromFen(msg.fen);
    var cfg = Engine.levelFor(msg.elo);

    if (msg.useBook !== false) {
      var bm = Book.probe(p);
      if (bm) {
        self.postMessage({
          type: 'move', id: msg.id, move: bm, uci: Chess.moveToUci(bm),
          san: Chess.moveToSan(p, bm), score: 0, depth: 0, book: true,
          opening: Book.nameOf(p)
        });
        return;
      }
    }

    /* Weaker levels need every root move scored honestly before noise is
       applied, or the "mistakes" they make are arbitrary rather than plausible. */
    var r = search.think(p, {
      depth: cfg.depth, time: cfg.time, exactRoot: cfg.noise > 0
    });
    if (!r.move) { self.postMessage({ type: 'move', id: msg.id, move: 0 }); return; }
    var chosen = Engine.chooseMove(r, cfg);
    self.postMessage({
      type: 'move', id: msg.id, move: chosen, uci: Chess.moveToUci(chosen),
      san: Chess.moveToSan(p, chosen), score: r.score, depth: r.depth,
      nodes: r.nodes, ms: r.ms, book: false
    });
    return;
  }

  if (msg.type === 'eval') {
    p = Chess.fromFen(msg.fen);
    var res = search.think(p, { time: msg.time || 800, depth: msg.depth || 64, exactRoot: !!msg.exactRoot });
    self.postMessage({
      type: 'eval', id: msg.id, move: res.move,
      san: res.move ? Chess.moveToSan(p, res.move) : '',
      score: res.score, depth: res.depth, nodes: res.nodes,
      pv: res.pv, pvSan: pvSan(msg.fen, res.pv),
      top: (res.rootMoves || []).slice(0, msg.top || 3).map(function (rm) {
        return { move: rm.move, san: Chess.moveToSan(p, rm.move), score: rm.score };
      })
    });
    return;
  }

  /* Score one specific move against the best one. Coach mode asks this before
     letting a move be played; the puzzle trainer asks it when an answer is not
     the stored solution, so a move that is just as good is still accepted. */
  if (msg.type === 'probe') {
    p = Chess.fromFen(msg.fen);
    var pr = search.think(p, { time: msg.time || 500, depth: msg.depth || 12, exactRoot: true });
    var playedScore = null, rm = pr.rootMoves || [];
    for (var k = 0; k < rm.length; k++) if (rm[k].move === msg.move) { playedScore = rm[k].score; break; }
    self.postMessage({
      type: 'probe', id: msg.id,
      best: pr.move, bestSan: pr.move ? Chess.moveToSan(p, pr.move) : '',
      bestScore: pr.score, playedScore: playedScore,
      bestLineSan: pvSan(msg.fen, pr.pv).slice(0, 4),
      punish: punishment(p, msg.move)
    });
    return;
  }

  if (msg.type === 'review') {
    var result = Review.analyze(msg.fen, msg.moves, {
      time: msg.time || 700,
      onProgress: function (done, total) {
        self.postMessage({ type: 'progress', id: msg.id, done: done, total: total });
      }
    });
    result.moves.forEach(function (m) { m.bestLineSan = pvSan(m.fenBefore, m.bestLine); });
    self.postMessage({ type: 'review', id: msg.id, result: result });
    return;
  }

  if (msg.type === 'stop') { search.stop = true; }
};
