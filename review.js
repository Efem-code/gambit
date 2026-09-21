/* Gambit — game review.
 *
 * Analyses a finished game one position at a time and says, in words, what went
 * wrong. The whole point of the app: a centipawn number tells you that a move
 * was bad, not why, and "why" is the part you can learn from.
 *
 * One search per position. The opponent's best reply to your move is simply the
 * best move of the next position, which is already being analysed — so the
 * explanations cost nothing extra.
 */
var Review = (function () {
'use strict';

var C = (typeof Chess !== 'undefined') ? Chess : require('./chess.js');
var E = (typeof Engine !== 'undefined') ? Engine : require('./engine.js');
var B = (typeof Book !== 'undefined') ? Book : require('./book.js');

var PIECE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
var VALUE = [0, 100, 320, 330, 500, 900, 20000];

/* Lichess's win-percentage model. Converting centipawns to an expected score
   before comparing moves is what stops a blunder in a already-lost position
   from being punished as hard as the same blunder in an equal one. */
function winPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
function moveAccuracy(before, after) {
  var acc = 103.1668 * Math.exp(-0.04354 * (before - after)) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

function mateIn(score) {
  if (score > E.MATE - 1000) return Math.ceil((E.MATE - score) / 2);
  if (score < -E.MATE + 1000) return -Math.ceil((E.MATE + score) / 2);
  return null;
}

/* How many pieces of each side hit a square — a cheap stand-in for a full
   static exchange evaluation, good enough to say "this is hanging". */
function countAttackers(p, target, by) {
  var n = 0, b = p.board, i, s, d, piece;
  var pd = (by === C.WHITE) ? -16 : 16;
  for (i = -1; i <= 1; i += 2) {
    s = target + pd + i;
    if (C.onBoard(s) && b[s] === (C.PAWN | by)) n++;
  }
  var KN = [-33, -31, -18, -14, 14, 18, 31, 33];
  for (i = 0; i < 8; i++) { s = target + KN[i]; if (C.onBoard(s) && b[s] === (C.KNIGHT | by)) n++; }
  var KG = [-17, -16, -15, -1, 1, 15, 16, 17];
  for (i = 0; i < 8; i++) { s = target + KG[i]; if (C.onBoard(s) && b[s] === (C.KING | by)) n++; }
  var BD = [-17, -15, 15, 17], RD = [-16, -1, 1, 16];
  for (i = 0; i < 4; i++) {
    d = BD[i]; s = target + d;
    while (C.onBoard(s)) {
      piece = b[s];
      if (piece) {
        if (C.colorOf(piece) === by && (C.typeOf(piece) === C.BISHOP || C.typeOf(piece) === C.QUEEN)) n++;
        break;
      }
      s += d;
    }
  }
  for (i = 0; i < 4; i++) {
    d = RD[i]; s = target + d;
    while (C.onBoard(s)) {
      piece = b[s];
      if (piece) {
        if (C.colorOf(piece) === by && (C.typeOf(piece) === C.ROOK || C.typeOf(piece) === C.QUEEN)) n++;
        break;
      }
      s += d;
    }
  }
  return n;
}

/* How many enemy pieces a freshly-moved piece now attacks — used to call a
   move a fork rather than just "strong". */
function forkTargets(p, from) {
  var b = p.board, piece = b[from];
  if (!piece) return [];
  var them = C.colorOf(piece) ^ 8, type = C.typeOf(piece), hits = [], i, d, s;
  function consider(s) {
    var t = b[s];
    if (t && C.colorOf(t) === them && C.typeOf(t) !== C.PAWN) {
      /* Only count it if taking would actually win something. */
      if (VALUE[C.typeOf(t)] > VALUE[type] || countAttackers(p, s, them) === 0) hits.push(s);
    }
  }
  if (type === C.KNIGHT || type === C.KING) {
    var dirs = type === C.KNIGHT ? [-33, -31, -18, -14, 14, 18, 31, 33] : [-17, -16, -15, -1, 1, 15, 16, 17];
    for (i = 0; i < 8; i++) { s = from + dirs[i]; if (C.onBoard(s)) consider(s); }
  } else if (type === C.PAWN) {
    var pd = C.colorOf(piece) === C.WHITE ? 16 : -16;
    for (i = -1; i <= 1; i += 2) { s = from + pd + i; if (C.onBoard(s)) consider(s); }
  } else {
    var sl = type === C.BISHOP ? [-17, -15, 15, 17] : type === C.ROOK ? [-16, -1, 1, 16]
           : [-17, -16, -15, -1, 1, 15, 16, 17];
    for (i = 0; i < sl.length; i++) {
      d = sl[i]; s = from + d;
      while (C.onBoard(s)) { if (b[s]) { consider(s); break; } s += d; }
    }
  }
  return hits;
}

/* ------------------------------------------------------------ Classifying */

var CLASSES = {
  brilliant:  { label: 'Brilliant', symbol: '!!', tone: 'brilliant' },
  great:      { label: 'Great',     symbol: '!',  tone: 'great' },
  best:       { label: 'Best',      symbol: '',   tone: 'best' },
  excellent:  { label: 'Excellent', symbol: '',   tone: 'good' },
  good:       { label: 'Good',      symbol: '',   tone: 'good' },
  book:       { label: 'Book',      symbol: '',   tone: 'book' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', tone: 'inaccuracy' },
  mistake:    { label: 'Mistake',   symbol: '?',  tone: 'mistake' },
  blunder:    { label: 'Blunder',   symbol: '??', tone: 'blunder' },
  forced:     { label: 'Forced',    symbol: '',   tone: 'book' }
};

function classify(ctx) {
  if (ctx.inBook) return 'book';
  if (ctx.legalCount === 1) return 'forced';

  var lost = ctx.winBefore - ctx.winAfter;   /* win% given up, always >= 0 */

  if (ctx.playedIsBest) {
    /* A move is only "great" if the alternatives really were worse. */
    if (ctx.secondBestGap >= 150 && ctx.winBefore < 97 && ctx.winBefore > 3) {
      return ctx.sacrifice ? 'brilliant' : 'great';
    }
    return 'best';
  }
  if (lost < 2) return 'excellent';
  if (lost < 5) return 'good';
  if (lost < 10) return 'inaccuracy';
  if (lost < 20) return 'mistake';
  return 'blunder';
}

/* Did this move hand over material that the opponent can just take? */
function isSacrifice(posBefore, move, cpLoss) {
  if (cpLoss > 30) return false;
  var to = C.mTo(move), from = C.mFrom(move);
  var moved = posBefore.board[from];
  var captured = (move & C.F_CAP) ? posBefore.board[to] : 0;
  var gain = captured ? VALUE[C.typeOf(captured)] : 0;
  var risk = VALUE[C.typeOf(moved)];
  if (risk - gain < 200) return false;
  C.makeMove(posBefore, move);
  var attacked = countAttackers(posBefore, to, posBefore.side) > 0;
  C.unmakeMove(posBefore);
  return attacked;
}

/* ---------------------------------------------------------- Explanations */

function describeMove(p, move) {
  return C.moveToSan(p, move);
}

function explain(ctx) {
  var p = ctx.pos, played = ctx.played, best = ctx.best;
  var bits = [];

  var bestMate = mateIn(ctx.bestScore), playedMate = mateIn(ctx.playedScore);

  if (ctx.cls === 'book') return 'Book move — a known opening line.';
  if (ctx.cls === 'forced') return 'The only legal move.';

  if (ctx.playedIsBest) {
    if (bestMate !== null && bestMate > 0) return 'Best. This forces mate in ' + bestMate + '.';
    if (ctx.cls === 'brilliant') return 'Brilliant — a sacrifice that works. Nothing else keeps the advantage.';
    if (ctx.cls === 'great') return 'The only move that holds. Every alternative was clearly worse.';
    if (ctx.captureWins) return 'Best. This wins the ' + ctx.captureWins + '.';
    if (ctx.forks && ctx.forks.length >= 2) return 'Best — this forks the ' + ctx.forks.join(' and the ') + '.';
    return 'Best move.';
  }

  /* Something better existed. Lead with what it was. */
  var bestSan = ctx.bestSan;

  if (bestMate !== null && bestMate > 0 && (playedMate === null || playedMate > bestMate)) {
    bits.push('Missed a forced mate: ' + bestSan + ' mates in ' + bestMate + '.');
  } else if (ctx.hangs) {
    bits.push('This leaves the ' + ctx.hangs.piece + ' on ' + ctx.hangs.square +
              ' undefended — ' + ctx.hangs.takenBy + ' wins it.');
    bits.push(bestSan + ' held everything together.');
  } else if (ctx.bestCaptureWins) {
    bits.push(bestSan + ' would have won the ' + ctx.bestCaptureWins + '.');
  } else if (ctx.bestForks && ctx.bestForks.length >= 2) {
    bits.push(bestSan + ' forks the ' + ctx.bestForks.join(' and the ') + '.');
  } else if (playedMate !== null && playedMate < 0) {
    bits.push('This allows mate in ' + (-playedMate) + '. ' + bestSan + ' was necessary.');
  } else {
    bits.push(bestSan + ' was stronger.');
  }

  /* A mate score is not a number of pawns, so never phrase it as one. */
  var swing = ctx.cpLoss;
  if (swing >= 100 && swing < 2000 && bits.length && !ctx.hangs) {
    bits.push('The evaluation swings by ' + (swing / 100).toFixed(1) + ' pawns.');
  }
  return bits.join(' ');
}

/* --------------------------------------------------------------- Analysis */

/* moves: array of move ints, in order, starting from startFen.
   onProgress(done, total) is called as it goes. */
function analyze(startFen, moves, opts) {
  opts = opts || {};
  var time = opts.time || 700;
  var depth = opts.depth || 64;
  var search = new E.Search();
  var p = C.fromFen(startFen || C.START_FEN);
  var total = moves.length;

  /* Pass one: one search per position, plus the position after the last move. */
  var infos = [];
  for (var i = 0; i <= total; i++) {
    var legal = C.legalMoves(p);
    var info = {
      fen: C.toFen(p), side: p.side, legalCount: legal.length,
      inBook: B.has(p), bookName: B.nameOf(p)
    };
    if (legal.length) {
      var r = search.think(p, { time: time, depth: depth, exactRoot: true });
      info.best = r.move;
      info.bestScore = r.score;
      info.bestSan = r.move ? C.moveToSan(p, r.move) : '';
      info.rootMoves = r.rootMoves;
      info.secondBestGap = r.rootMoves.length > 1 ? (r.rootMoves[0].score - r.rootMoves[1].score) : 9999;
      info.pv = r.pv.slice(0, 6);
    } else {
      info.best = 0;
      info.bestScore = C.inCheck(p) ? -E.MATE : 0;
      info.bestSan = '';
      info.rootMoves = [];
      info.secondBestGap = 0;
      info.pv = [];
    }
    infos.push(info);
    if (opts.onProgress) opts.onProgress(i + 1, total + 1);
    if (i < total) C.makeMove(p, moves[i]);
  }

  /* Pass two: turn the numbers into judgements and sentences. */
  p = C.fromFen(startFen || C.START_FEN);
  var out = [];
  var accSum = [0, 0], accN = [0, 0], counts = [{}, {}];

  for (i = 0; i < total; i++) {
    var before = infos[i], after = infos[i + 1];
    var move = moves[i];
    var ci = before.side ? 1 : 0;

    var playedScore = null;
    for (var j = 0; j < before.rootMoves.length; j++) {
      if (before.rootMoves[j].move === move) { playedScore = before.rootMoves[j].score; break; }
    }
    /* Fall back to the next position's score, negated, if the root list missed
       it (only possible when the search was cut off mid-iteration). */
    if (playedScore === null) playedScore = -after.bestScore;

    var cpLoss = Math.max(0, before.bestScore - playedScore);
    var wBefore = winPct(before.bestScore);
    var wAfter = winPct(playedScore);

    var ctx = {
      pos: p, played: move, best: before.best,
      bestScore: before.bestScore, playedScore: playedScore, cpLoss: cpLoss,
      winBefore: wBefore, winAfter: wAfter,
      playedIsBest: move === before.best,
      secondBestGap: before.secondBestGap,
      legalCount: before.legalCount,
      inBook: before.inBook,
      bestSan: before.bestSan,
      sacrifice: false, hangs: null, captureWins: '', bestCaptureWins: '',
      forks: null, bestForks: null
    };

    /* What does the best move actually achieve? */
    if (before.best) {
      if (before.best & C.F_CAP) {
        var victim = p.board[C.mTo(before.best)];
        var attacker = p.board[C.mFrom(before.best)];
        if (victim && (VALUE[C.typeOf(victim)] > VALUE[C.typeOf(attacker)] ||
            countAttackers(p, C.mTo(before.best), p.side ^ 8) === 0)) {
          var name = PIECE_NAMES[C.typeOf(victim)] + ' on ' + C.sqName(C.mTo(before.best));
          if (ctx.playedIsBest) ctx.captureWins = name; else ctx.bestCaptureWins = name;
        }
      }
      C.makeMove(p, before.best);
      var f = forkTargets(p, C.mTo(before.best)).map(function (s) {
        return PIECE_NAMES[C.typeOf(p.board[s])] + ' on ' + C.sqName(s);
      });
      C.unmakeMove(p);
      if (ctx.playedIsBest) ctx.forks = f; else ctx.bestForks = f;
    }

    if (ctx.playedIsBest) ctx.sacrifice = isSacrifice(p, move, cpLoss);

    /* Does the played move hang something? The opponent's best reply is the
       best move of the position we already analysed. */
    if (!ctx.playedIsBest && cpLoss >= 120 && after.best && (after.best & C.F_CAP)) {
      var target = C.mTo(after.best);
      C.makeMove(p, move);
      var victim2 = p.board[target];
      if (victim2 && C.typeOf(victim2) !== C.PAWN) {
        var defenders = countAttackers(p, target, p.side ^ 8);
        var attackerPiece = p.board[C.mFrom(after.best)];
        if (defenders === 0 || VALUE[C.typeOf(victim2)] > VALUE[C.typeOf(attackerPiece)]) {
          ctx.hangs = {
            piece: PIECE_NAMES[C.typeOf(victim2)],
            square: C.sqName(target),
            takenBy: C.moveToSan(p, after.best)
          };
        }
      }
      C.unmakeMove(p);
    }

    ctx.cls = classify(ctx);
    var sanText = C.moveToSan(p, move);

    /* Accuracy is scored against how much winning chance the move gave away. */
    var acc = moveAccuracy(wBefore, wAfter);
    accSum[ci] += acc; accN[ci]++;
    counts[ci][ctx.cls] = (counts[ci][ctx.cls] || 0) + 1;

    out.push({
      ply: i,
      moveNumber: Math.floor(i / 2) + 1,
      side: before.side ? 'black' : 'white',
      san: sanText,
      uci: C.moveToUci(move),
      move: move,
      fenBefore: before.fen,
      cls: ctx.cls,
      label: CLASSES[ctx.cls].label,
      symbol: CLASSES[ctx.cls].symbol,
      tone: CLASSES[ctx.cls].tone,
      cpLoss: cpLoss,
      accuracy: acc,
      scoreBefore: before.side ? -before.bestScore : before.bestScore,   /* white POV */
      scoreAfter: before.side ? -playedScore : playedScore,
      mateIn: mateIn(playedScore),
      best: before.best,
      bestSan: before.bestSan,
      bestLine: before.pv,
      openingName: before.bookName,
      note: explain(ctx)
    });

    C.makeMove(p, move);
  }

  return {
    moves: out,
    accuracy: {
      white: accN[0] ? accSum[0] / accN[0] : 100,
      black: accN[1] ? accSum[1] / accN[1] : 100
    },
    counts: { white: counts[0], black: counts[1] },
    finalFen: C.toFen(p)
  };
}

return {
  analyze: analyze, CLASSES: CLASSES, winPct: winPct, mateIn: mateIn,
  countAttackers: countAttackers
};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Review;
