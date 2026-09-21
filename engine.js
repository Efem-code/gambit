/* Gambit — evaluation and search.
 *
 * Negamax with alpha-beta, a transposition table, null-move pruning, late move
 * reductions and a quiescence search. Everything is tuned for a phone: the
 * search is time-bounded rather than depth-bounded, so a weak device simply
 * thinks a little less deeply instead of freezing.
 */
var Engine = (function () {
'use strict';

var C = (typeof Chess !== 'undefined') ? Chess : require('./chess.js');

var MATE = 30000, INF = 40000;
var PAWN = C.PAWN, KNIGHT = C.KNIGHT, BISHOP = C.BISHOP, ROOK = C.ROOK,
    QUEEN = C.QUEEN, KING = C.KING, WHITE = C.WHITE, BLACK = C.BLACK;

/* Material, split for middlegame and endgame. A bishop is worth a shade more
   than a knight; a rook grows and a queen shrinks slightly as pieces come off. */
var MG_VAL = [0, 82, 337, 365, 477, 1025, 0];
var EG_VAL = [0, 94, 281, 297, 512, 936, 0];

/* Piece-square tables, written from White's point of view with rank 8 on the
   first line so they can be read as a board. Values are PeSTO's. */
function T(rows) {
  var a = new Int16Array(64);
  for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) a[(7 - r) * 8 + f] = rows[r][f];
  return a;
}
var MG_PST = [], EG_PST = [];
MG_PST[PAWN] = T([
  [  0,  0,  0,  0,  0,  0,  0,  0],
  [ 98,134, 61, 95, 68,126, 34,-11],
  [ -6,  7, 26, 31, 65, 56, 25,-20],
  [-14, 13,  6, 21, 23, 12, 17,-23],
  [-27, -2, -5, 12, 17,  6, 10,-25],
  [-26, -4, -4,-10,  3,  3, 33,-12],
  [-35, -1,-20,-23,-15, 24, 38,-22],
  [  0,  0,  0,  0,  0,  0,  0,  0]]);
EG_PST[PAWN] = T([
  [  0,  0,  0,  0,  0,  0,  0,  0],
  [178,173,158,134,147,132,165,187],
  [ 94,100, 85, 67, 56, 53, 82, 84],
  [ 32, 24, 13,  5, -2,  4, 17, 17],
  [ 13,  9, -3, -7, -7, -8,  3, -1],
  [  4,  7, -6,  1,  0, -5, -1, -8],
  [ 13,  8,  8, 10, 13,  0,  2, -7],
  [  0,  0,  0,  0,  0,  0,  0,  0]]);
MG_PST[KNIGHT] = T([
  [-167,-89,-34,-49, 61,-97,-15,-107],
  [ -73,-41, 72, 36, 23, 62,  7, -17],
  [ -47, 60, 37, 65, 84,129, 73,  44],
  [  -9, 17, 19, 53, 37, 69, 18,  22],
  [ -13,  4, 16, 13, 28, 19, 21,  -8],
  [ -23, -9, 12, 10, 19, 17, 25, -16],
  [ -29,-53,-12, -3, -1, 18,-14, -19],
  [-105,-21,-58,-33,-17,-28,-19, -23]]);
EG_PST[KNIGHT] = T([
  [-58,-38,-13,-28,-31,-27,-63,-99],
  [-25, -8,-25, -2, -9,-25,-24,-52],
  [-24,-20, 10,  9, -1, -9,-19,-41],
  [-17,  3, 22, 22, 22, 11,  8,-18],
  [-18, -6, 16, 25, 16, 17,  4,-18],
  [-23, -3, -1, 15, 10, -3,-20,-22],
  [-42,-20,-10, -5, -2,-20,-23,-44],
  [-29,-51,-23,-15,-22,-18,-50,-64]]);
MG_PST[BISHOP] = T([
  [-29,  4,-82,-37,-25,-42,  7, -8],
  [-26, 16,-18,-13, 30, 59, 18,-47],
  [-16, 37, 43, 40, 35, 50, 37, -2],
  [ -4,  5, 19, 50, 37, 37,  7, -2],
  [ -6, 13, 13, 26, 34, 12, 10,  4],
  [  0, 15, 15, 15, 14, 27, 18, 10],
  [  4, 15, 16,  0,  7, 21, 33,  1],
  [-33, -3,-14,-21,-13,-12,-39,-21]]);
EG_PST[BISHOP] = T([
  [-14,-21,-11, -8, -7, -9,-17,-24],
  [ -8, -4,  7,-12, -3,-13, -4,-14],
  [  2, -8,  0, -1, -2,  6,  0,  4],
  [ -3,  9, 12,  9, 14, 10,  3,  2],
  [ -6,  3, 13, 19,  7, 10, -3, -9],
  [-12, -3,  8, 10, 13,  3, -7,-15],
  [-14,-18, -7, -1,  4, -9,-15,-27],
  [-23, -9,-23, -5, -9,-16, -5,-17]]);
MG_PST[ROOK] = T([
  [ 32, 42, 32, 51, 63,  9, 31, 43],
  [ 27, 32, 58, 62, 80, 67, 26, 44],
  [ -5, 19, 26, 36, 17, 45, 61, 16],
  [-24,-11,  7, 26, 24, 35, -8,-20],
  [-36,-26,-12, -1,  9, -7,  6,-23],
  [-45,-25,-16,-17,  3,  0, -5,-33],
  [-44,-16,-20, -9, -1, 11, -6,-71],
  [-19,-13,  1, 17, 16,  7,-37,-26]]);
EG_PST[ROOK] = T([
  [13,10,18,15,12,12, 8, 5],
  [11,13,13,11,-3, 3, 8, 3],
  [ 7, 7, 7, 5, 4,-3,-5,-3],
  [ 4, 3,13, 1, 2, 1,-1, 2],
  [ 3, 5, 8, 4,-5,-6,-8,-11],
  [-4, 0,-5,-1,-7,-12,-8,-16],
  [-6,-6, 0, 2,-9,-9,-11,-3],
  [-9, 2, 3,-1,-5,-13, 4,-20]]);
MG_PST[QUEEN] = T([
  [-28,  0, 29, 12, 59, 44, 43, 45],
  [-24,-39, -5,  1,-16, 57, 28, 54],
  [-13,-17,  7,  8, 29, 56, 47, 57],
  [-27,-27,-16,-16, -1, 17, -2,  1],
  [ -9,-26, -9,-10, -2, -4,  3, -3],
  [-14,  2,-11, -2, -5,  2, 14,  5],
  [-35, -8, 11,  2,  8, 15, -3,  1],
  [ -1,-18, -9, 10,-15,-25,-31,-50]]);
EG_PST[QUEEN] = T([
  [ -9, 22, 22, 27, 27, 19, 10, 20],
  [-17, 20, 32, 41, 58, 25, 30,  0],
  [-20,  6,  9, 49, 47, 35, 19,  9],
  [  3, 22, 24, 45, 57, 40, 57, 36],
  [-18, 28, 19, 47, 31, 34, 39, 23],
  [-16,-27, 15,  6,  9, 17, 10,  5],
  [-22,-23,-30,-16,-16,-23,-36,-32],
  [-33,-28,-22,-43, -5,-32,-20,-41]]);
MG_PST[KING] = T([
  [-65, 23, 16,-15,-56,-34,  2, 13],
  [ 29, -1,-20, -7, -8, -4,-38,-29],
  [ -9, 24,  2,-16,-20,  6, 22,-22],
  [-17,-20,-12,-27,-30,-25,-14,-36],
  [-49, -1,-27,-39,-46,-44,-33,-51],
  [-14,-14,-22,-46,-44,-30,-15,-27],
  [  1,  7, -8,-64,-43,-16,  9,  8],
  [-15, 36, 12,-54,  8,-28, 24, 14]]);
EG_PST[KING] = T([
  [-74,-35,-18,-18,-11, 15,  4,-17],
  [-12, 17, 14, 17, 17, 38, 23, 11],
  [ 10, 17, 23, 15, 20, 45, 44, 13],
  [ -8, 22, 24, 27, 26, 33, 26,  3],
  [-18, -4, 21, 24, 27, 23,  9,-11],
  [-19, -3, 11, 21, 23, 16,  7, -9],
  [-27,-11,  4, 13, 14,  4, -5,-17],
  [-53,-34,-21,-11,-28,-14,-24,-43]]);

/* Game phase, so the two tables can be blended rather than switched. */
var PHASE_W = [0, 0, 1, 1, 2, 4, 0];
var PHASE_MAX = 24;

function sq64(s) { return C.rankOf(s) * 8 + C.fileOf(s); }
var FLIP = new Int8Array(64);
for (var i = 0; i < 64; i++) FLIP[i] = (7 - (i >> 3)) * 8 + (i & 7);

/* ---------------------------------------------------------- Evaluation */

var PASSED_BONUS = [0, 10, 17, 25, 40, 68, 120, 0];

function evaluate(p) {
  var b = p.board;
  var mg = 0, eg = 0, phase = 0;
  var pawnFiles = [new Int8Array(8), new Int8Array(8)];
  var pawnSqs = [[], []];
  var bishops = [0, 0];
  var s, piece, t, col, ci, idx;

  for (s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    piece = b[s];
    if (!piece) continue;
    t = C.typeOf(piece); col = C.colorOf(piece); ci = col ? 1 : 0;
    phase += PHASE_W[t];
    idx = col === WHITE ? sq64(s) : FLIP[sq64(s)];
    var sign = col === WHITE ? 1 : -1;
    mg += sign * (MG_VAL[t] + MG_PST[t][idx]);
    eg += sign * (EG_VAL[t] + EG_PST[t][idx]);
    if (t === PAWN) { pawnFiles[ci][C.fileOf(s)]++; pawnSqs[ci].push(s); }
    else if (t === BISHOP) bishops[ci]++;
  }

  /* Bishop pair. */
  if (bishops[0] >= 2) { mg += 25; eg += 45; }
  if (bishops[1] >= 2) { mg -= 25; eg -= 45; }

  /* Pawn structure: doubled, isolated, passed. */
  for (ci = 0; ci < 2; ci++) {
    var sgn = ci === 0 ? 1 : -1, mine = pawnFiles[ci], theirs = pawnFiles[1 - ci];
    for (var f = 0; f < 8; f++) {
      if (mine[f] > 1) { mg -= sgn * 12 * (mine[f] - 1); eg -= sgn * 22 * (mine[f] - 1); }
      if (mine[f] && !(f > 0 && mine[f - 1]) && !(f < 7 && mine[f + 1])) { mg -= sgn * 16; eg -= sgn * 12; }
    }
    for (var k = 0; k < pawnSqs[ci].length; k++) {
      var ps = pawnSqs[ci][k], pf = C.fileOf(ps), pr = C.rankOf(ps);
      var blocked = false;
      for (var df = -1; df <= 1 && !blocked; df++) {
        var nf = pf + df;
        if (nf < 0 || nf > 7 || !theirs[nf]) continue;
        for (var j = 0; j < pawnSqs[1 - ci].length; j++) {
          var os = pawnSqs[1 - ci][j];
          if (C.fileOf(os) !== nf) continue;
          var orr = C.rankOf(os);
          if (ci === 0 ? orr > pr : orr < pr) { blocked = true; break; }
        }
      }
      if (!blocked) {
        var adv = ci === 0 ? pr : 7 - pr;
        mg += sgn * (PASSED_BONUS[adv] >> 1);
        eg += sgn * PASSED_BONUS[adv];
      }
    }
  }

  /* Rooks like open and half-open files. */
  for (s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    piece = b[s];
    if (!piece || C.typeOf(piece) !== ROOK) continue;
    ci = C.colorOf(piece) ? 1 : 0;
    var file = C.fileOf(s);
    if (!pawnFiles[ci][file]) {
      var bonus = pawnFiles[1 - ci][file] ? 12 : 28;
      mg += (ci === 0 ? 1 : -1) * bonus;
      eg += (ci === 0 ? 1 : -1) * (bonus >> 1);
    }
  }

  /* King shelter — only matters while queens and rooks are still around, so it
     is folded into the middlegame term alone. */
  for (ci = 0; ci < 2; ci++) {
    var ks = p.kingSq[ci];
    if (ks < 0) continue;
    var kf = C.fileOf(ks), kr = C.rankOf(ks), shield = 0;
    var fwd = ci === 0 ? 1 : -1;
    for (var sf = Math.max(0, kf - 1); sf <= Math.min(7, kf + 1); sf++) {
      var r1 = kr + fwd, r2 = kr + 2 * fwd;
      if (r1 >= 0 && r1 < 8 && b[C.sq(sf, r1)] === (PAWN | (ci ? BLACK : WHITE))) shield += 12;
      else if (r2 >= 0 && r2 < 8 && b[C.sq(sf, r2)] === (PAWN | (ci ? BLACK : WHITE))) shield += 6;
      else shield -= 14;
    }
    mg += (ci === 0 ? 1 : -1) * shield;
  }

  if (phase > PHASE_MAX) phase = PHASE_MAX;
  var score = ((mg * phase) + (eg * (PHASE_MAX - phase))) / PHASE_MAX;
  /* A small tempo bonus stops the eval oscillating between plies. */
  score += (p.side === WHITE ? 10 : -10);
  return p.side === WHITE ? score | 0 : -score | 0;
}

/* ------------------------------------------------------ Transposition table */

var TT_BITS = 19, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
var TT_FLAG_EXACT = 1, TT_FLAG_LOWER = 2, TT_FLAG_UPPER = 3;

function TT() {
  this.keyA = new Int32Array(TT_SIZE);
  this.keyB = new Int32Array(TT_SIZE);
  this.score = new Int32Array(TT_SIZE);
  this.move = new Int32Array(TT_SIZE);
  this.depth = new Int8Array(TT_SIZE);
  this.flag = new Int8Array(TT_SIZE);
  this.used = 0;
}
TT.prototype.clear = function () {
  this.keyA.fill(0); this.keyB.fill(0); this.depth.fill(0); this.flag.fill(0);
  this.move.fill(0); this.used = 0;
};

/* ------------------------------------------------------------- Search */

function Search() {
  this.tt = new TT();
  this.killers = [];
  this.history = new Int32Array(128 * 128);
  this.nodes = 0;
  this.stop = false;
  this.deadline = 0;
}

Search.prototype.reset = function () {
  this.killers = [];
  this.history = new Int32Array(128 * 128);
  this.nodes = 0;
  this.stop = false;
};

var MVV = [0, 100, 300, 320, 500, 900, 2000];

/* Order moves so the best candidate is tried first — the single biggest lever
   on how much alpha-beta can prune. */
Search.prototype.scoreMoves = function (p, moves, ttMove, ply) {
  var scores = new Int32Array(moves.length);
  var k = this.killers[ply] || (this.killers[ply] = [0, 0]);
  for (var i = 0; i < moves.length; i++) {
    var m = moves[i], sc = 0;
    if (m === ttMove) sc = 10000000;
    else if (m & C.F_CAP) {
      var victim = (m & C.F_EP) ? PAWN : C.typeOf(p.board[C.mTo(m)]);
      var attacker = C.typeOf(p.board[C.mFrom(m)]);
      sc = 1000000 + MVV[victim] * 16 - MVV[attacker];
    } else if (C.mPromo(m)) sc = 900000 + MVV[C.mPromo(m)];
    else if (m === k[0]) sc = 800000;
    else if (m === k[1]) sc = 790000;
    else sc = this.history[C.mFrom(m) * 128 + C.mTo(m)];
    scores[i] = sc;
  }
  return scores;
};

function pickMove(moves, scores, start) {
  var best = start;
  for (var i = start + 1; i < moves.length; i++) if (scores[i] > scores[best]) best = i;
  if (best !== start) {
    var tm = moves[start]; moves[start] = moves[best]; moves[best] = tm;
    var ts = scores[start]; scores[start] = scores[best]; scores[best] = ts;
  }
  return moves[start];
}

Search.prototype.timeUp = function () {
  if (this.stop) return true;
  if (this.deadline && (this.nodes & 1023) === 0 && Date.now() > this.deadline) {
    this.stop = true;
    return true;
  }
  return false;
};

Search.prototype.quiesce = function (p, alpha, beta, ply) {
  this.nodes++;
  if (this.timeUp()) return alpha;

  var stand = evaluate(p);
  if (stand >= beta) return beta;
  /* Delta pruning: if even winning a queen would not reach alpha, stop. */
  if (stand + 1000 < alpha) return alpha;
  if (stand > alpha) alpha = stand;

  var moves = C.genMoves(p, true);
  var scores = this.scoreMoves(p, moves, 0, ply);
  var us = p.side;
  for (var i = 0; i < moves.length; i++) {
    var m = pickMove(moves, scores, i);
    C.makeMove(p, m);
    if (C.inCheck(p, us)) { C.unmakeMove(p); continue; }
    var score = -this.quiesce(p, -beta, -alpha, ply + 1);
    C.unmakeMove(p);
    if (this.stop) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
};

Search.prototype.hasBigPiece = function (p) {
  var b = p.board, us = p.side;
  for (var s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    var piece = b[s];
    if (!piece || C.colorOf(piece) !== us) continue;
    var t = C.typeOf(piece);
    if (t !== PAWN && t !== KING) return true;
  }
  return false;
};

Search.prototype.negamax = function (p, depth, alpha, beta, ply, canNull) {
  this.nodes++;
  if (this.timeUp()) return alpha;

  var inChk = C.inCheck(p);
  if (inChk) depth++;                       /* check extension */
  if (depth <= 0) return this.quiesce(p, alpha, beta, ply);

  if (ply > 0) {
    /* Draw detection scans the board, so it is skipped over the first few plies
       after any capture or pawn move, when no draw is reachable anyway. */
    if (p.halfmove >= 100) return 0;
    if (p.halfmove >= 8 && (C.repetitionCount(p) >= 3 || C.insufficientMaterial(p))) return 0;
    /* Mate-distance pruning keeps the engine from dithering when mate is forced. */
    var mateAlpha = -MATE + ply, mateBeta = MATE - ply - 1;
    if (mateAlpha > alpha) alpha = mateAlpha;
    if (mateBeta < beta) beta = mateBeta;
    if (alpha >= beta) return alpha;
  }

  var tt = this.tt, idx = (p.hashA & TT_MASK) >>> 0, ttMove = 0;
  if (tt.keyA[idx] === p.hashA && tt.keyB[idx] === p.hashB) {
    ttMove = tt.move[idx];
    if (ply > 0 && tt.depth[idx] >= depth) {
      var ts = tt.score[idx], fl = tt.flag[idx];
      if (ts > MATE - 1000) ts -= ply; else if (ts < -MATE + 1000) ts += ply;
      if (fl === TT_FLAG_EXACT) return ts;
      if (fl === TT_FLAG_LOWER && ts > alpha) alpha = ts;
      else if (fl === TT_FLAG_UPPER && ts < beta) beta = ts;
      if (alpha >= beta) return ts;
    }
  }

  /* Null move: give the opponent a free move; if the position still holds,
     it is good enough to prune. Skipped in check and in pawn endgames, where
     zugzwang makes the assumption false. */
  if (canNull && !inChk && depth >= 3 && ply > 0 && this.hasBigPiece(p) && Math.abs(beta) < MATE - 1000) {
    var savedEp = p.ep, savedHashA = p.hashA, savedHashB = p.hashB;
    p.ep = -1; p.side ^= 8;
    p.repA.push(p.hashA); p.repB.push(p.hashB);
    var R = 2 + (depth / 6 | 0);
    var nullScore = -this.negamax(p, depth - 1 - R, -beta, -beta + 1, ply + 1, false);
    p.repA.pop(); p.repB.pop();
    p.side ^= 8; p.ep = savedEp; p.hashA = savedHashA; p.hashB = savedHashB;
    if (this.stop) return alpha;
    if (nullScore >= beta) return beta;
  }

  var moves = C.genMoves(p, false);
  var scores = this.scoreMoves(p, moves, ttMove, ply);
  var us = p.side, legal = 0, bestScore = -INF, bestMove = 0;
  var origAlpha = alpha;

  for (var i = 0; i < moves.length; i++) {
    var m = pickMove(moves, scores, i);
    C.makeMove(p, m);
    if (C.inCheck(p, us)) { C.unmakeMove(p); continue; }
    legal++;

    var score;
    var quiet = !(m & C.F_CAP) && !C.mPromo(m);
    if (legal === 1) {
      score = -this.negamax(p, depth - 1, -beta, -alpha, ply + 1, true);
    } else {
      /* Late move reductions: quiet moves ordered last are searched shallower
         first, and re-searched properly only if they surprise us. */
      var red = 0;
      if (depth >= 3 && legal > 3 && quiet && !inChk) {
        red = 1 + (legal > 8 && depth >= 5 ? 1 : 0);
      }
      score = -this.negamax(p, depth - 1 - red, -alpha - 1, -alpha, ply + 1, true);
      if (score > alpha && red) score = -this.negamax(p, depth - 1, -alpha - 1, -alpha, ply + 1, true);
      if (score > alpha && score < beta) score = -this.negamax(p, depth - 1, -beta, -alpha, ply + 1, true);
    }
    C.unmakeMove(p);
    if (this.stop) return bestScore > -INF ? bestScore : alpha;

    if (score > bestScore) { bestScore = score; bestMove = m; }
    if (score > alpha) {
      alpha = score;
      if (alpha >= beta) {
        if (quiet) {
          var k = this.killers[ply];
          if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
          this.history[C.mFrom(m) * 128 + C.mTo(m)] += depth * depth;
        }
        break;
      }
    }
  }

  if (legal === 0) return inChk ? -MATE + ply : 0;

  var store = bestScore;
  if (store > MATE - 1000) store += ply; else if (store < -MATE + 1000) store -= ply;
  if (depth >= tt.depth[idx] || tt.keyA[idx] !== p.hashA) {
    tt.keyA[idx] = p.hashA; tt.keyB[idx] = p.hashB;
    tt.score[idx] = store; tt.move[idx] = bestMove; tt.depth[idx] = depth;
    tt.flag[idx] = bestScore <= origAlpha ? TT_FLAG_UPPER
                 : bestScore >= beta ? TT_FLAG_LOWER : TT_FLAG_EXACT;
  }
  return bestScore;
};

/* Walk the transposition table to recover the principal variation. */
Search.prototype.extractPv = function (p, maxLen) {
  var pv = [], made = 0;
  for (var i = 0; i < maxLen; i++) {
    var idx = (p.hashA & TT_MASK) >>> 0;
    if (this.tt.keyA[idx] !== p.hashA || this.tt.keyB[idx] !== p.hashB) break;
    var m = this.tt.move[idx];
    if (!m) break;
    var legal = C.legalMoves(p), ok = false;
    for (var j = 0; j < legal.length; j++) if (legal[j] === m) { ok = true; break; }
    if (!ok) break;
    pv.push(m); C.makeMove(p, m); made++;
  }
  while (made--) C.unmakeMove(p);
  return pv;
};

/* Search the root, keeping a score for every legal move — the levels below
   need the whole list, not just the best one. */
Search.prototype.think = function (p, opts) {
  opts = opts || {};
  var maxDepth = opts.depth || 64;
  var maxTime = opts.time || 0;
  /* With exactRoot the root window is never narrowed, so every legal move comes
     back with a true score rather than an upper bound. The difficulty levels and
     the game review both rank moves against each other, which bounds cannot do. */
  var exactRoot = !!opts.exactRoot;
  this.reset();
  this.deadline = maxTime ? Date.now() + maxTime : 0;

  var root = C.legalMoves(p);
  if (!root.length) return { move: 0, score: 0, pv: [], depth: 0, nodes: 0, rootMoves: [] };

  var best = root[0], bestScore = 0, pv = [], completed = 0;
  var rootScores = root.map(function (m) { return { move: m, score: -INF }; });
  var t0 = Date.now();

  for (var depth = 1; depth <= maxDepth; depth++) {
    var alpha = -INF, beta = INF;
    var iterScores = [], iterBest = 0, iterBestScore = -INF;
    /* Search last iteration's best move first. */
    var ordered = root.slice().sort(function (a, b) {
      if (a === best) return -1;
      if (b === best) return 1;
      return 0;
    });

    for (var i = 0; i < ordered.length; i++) {
      var m = ordered[i], us = p.side;
      C.makeMove(p, m);
      var score = -this.negamax(p, depth - 1, -beta, -alpha, 1, true);
      C.unmakeMove(p);
      if (this.stop) break;
      iterScores.push({ move: m, score: score });
      if (score > iterBestScore) { iterBestScore = score; iterBest = m; }
      if (score > alpha && !exactRoot) alpha = score;
    }

    if (this.stop && iterScores.length < ordered.length) break;
    completed = depth;
    best = iterBest; bestScore = iterBestScore;
    rootScores = iterScores.sort(function (a, b) { return b.score - a.score; });
    /* The root position itself is never written to the table, so the principal
       variation starts with the move we chose and continues from the child. */
    C.makeMove(p, best);
    pv = [best].concat(this.extractPv(p, depth + 4));
    C.unmakeMove(p);
    if (opts.onDepth) opts.onDepth({ depth: depth, score: bestScore, move: best, pv: pv, nodes: this.nodes });
    if (Math.abs(bestScore) > MATE - 100) break;
    /* Stop early if the next iteration clearly cannot finish in the budget. */
    if (maxTime && Date.now() - t0 > maxTime * 0.45) break;
  }

  return {
    move: best, score: bestScore, pv: pv, depth: completed,
    nodes: this.nodes, ms: Date.now() - t0, rootMoves: rootScores
  };
};

/* ------------------------------------------------------------- Levels */

/* Strength is shaped three ways: how deep it looks, how much noise is added to
   each root move's score before picking, and how often it throws in a frankly
   bad move. Depth alone produces an opponent that is either trivially weak or
   tactically merciless with nothing in between; the noise is what makes the
   middle levels feel like a human of that rating. The Elo figures are targets,
   not measurements — see README. */
var LEVELS = [
  { elo: 400,  name: 'Beginner',     depth: 1, time: 120,  noise: 260, blunder: 0.28 },
  { elo: 600,  name: 'Novice',       depth: 2, time: 200,  noise: 190, blunder: 0.20 },
  { elo: 800,  name: 'Casual',       depth: 2, time: 300,  noise: 140, blunder: 0.14 },
  { elo: 1000, name: 'Club starter', depth: 3, time: 400,  noise: 100, blunder: 0.09 },
  { elo: 1200, name: 'Club',         depth: 4, time: 600,  noise: 70,  blunder: 0.06 },
  { elo: 1400, name: 'Solid club',   depth: 5, time: 900,  noise: 45,  blunder: 0.035 },
  { elo: 1600, name: 'Strong club',  depth: 6, time: 1200, noise: 30,  blunder: 0.02 },
  { elo: 1800, name: 'Expert',       depth: 8, time: 1800, noise: 18,  blunder: 0.01 },
  { elo: 2000, name: 'Candidate',    depth: 10, time: 2500, noise: 10, blunder: 0.004 },
  { elo: 2200, name: 'Master',       depth: 14, time: 4000, noise: 4,  blunder: 0 },
  { elo: 2400, name: 'Full strength', depth: 64, time: 6000, noise: 0, blunder: 0 }
];

function levelFor(elo) {
  for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].elo === elo) return LEVELS[i];
  return LEVELS[4];
}

/* Pick the move this level would actually play. */
function chooseMove(result, cfg) {
  var rm = result.rootMoves;
  if (!rm.length) return result.move;
  if (!cfg.noise && !cfg.blunder) return result.move;

  /* Never give away a forced mate that is already on the board, and never
     decline one — even a beginner notices mate in one. */
  if (rm[0].score > MATE - 100) return rm[0].move;

  if (cfg.blunder && Math.random() < cfg.blunder && rm.length > 2) {
    /* A real blunder: choose from the weaker half, but not from moves that
       lose instantly to mate, which reads as broken rather than weak. */
    var pool = rm.slice(Math.max(1, Math.floor(rm.length / 2))).filter(function (r) {
      return r.score > -MATE + 100;
    });
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)].move;
  }

  var bestNoisy = null, bestVal = -INF;
  for (var i = 0; i < rm.length; i++) {
    if (rm[i].score < -MATE + 100) continue;
    var val = rm[i].score + (Math.random() * 2 - 1) * cfg.noise;
    if (val > bestVal) { bestVal = val; bestNoisy = rm[i].move; }
  }
  return bestNoisy === null ? result.move : bestNoisy;
}

return {
  MATE: MATE, INF: INF, LEVELS: LEVELS, levelFor: levelFor,
  evaluate: evaluate, Search: Search, chooseMove: chooseMove
};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
