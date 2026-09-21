/* Gambit — chess rules.
 *
 * 0x88 mailbox board with make/unmake. The representation is chosen for the
 * search's benefit: an off-board test is one AND, and unmaking a move restores
 * state instead of copying a position, which is what lets the engine reach a
 * useful depth in a phone's JavaScript.
 *
 * Loaded as a classic script so the same file works in the page and, via
 * importScripts, in the engine worker.
 */
var Chess = (function () {
'use strict';

var EMPTY = 0, PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
var WHITE = 0, BLACK = 8;

var FILES = 'abcdefgh';
var PIECE_CHARS = '.pnbrqk';

/* Castling-right bits. */
var CR_WK = 1, CR_WQ = 2, CR_BK = 4, CR_BQ = 8;

/* Move layout: from | to<<7 | promotion<<14 | flags. */
var F_EP = 1 << 17, F_CASTLE = 1 << 18, F_DOUBLE = 1 << 19, F_CAP = 1 << 20;

var KNIGHT_DIRS = [-33, -31, -18, -14, 14, 18, 31, 33];
var BISHOP_DIRS = [-17, -15, 15, 17];
var ROOK_DIRS   = [-16, -1, 1, 16];
var KING_DIRS   = [-17, -16, -15, -1, 1, 15, 16, 17];

function sq(f, r) { return r * 16 + f; }
function fileOf(s) { return s & 7; }
function rankOf(s) { return s >> 4; }
function onBoard(s) { return (s & 0x88) === 0; }
function colorOf(p) { return p & 8; }
function typeOf(p) { return p & 7; }
function sqName(s) { return FILES[fileOf(s)] + (rankOf(s) + 1); }
function nameToSq(n) {
  var f = FILES.indexOf(n[0]), r = parseInt(n[1], 10) - 1;
  return (f < 0 || r < 0 || r > 7) ? -1 : sq(f, r);
}

function mkMove(from, to, promo, flags) {
  return from | (to << 7) | ((promo || 0) << 14) | (flags || 0);
}
function mFrom(m) { return m & 127; }
function mTo(m) { return (m >> 7) & 127; }
function mPromo(m) { return (m >> 14) & 7; }

/* ---------------------------------------------------------------- Zobrist */
/* A fixed seed keeps hashes identical between the page and the worker, so a
   transposition table filled during analysis stays valid across messages. */
function rng(seed) {
  var s = seed >>> 0;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s >>> 0;
  };
}
var Z_PIECE_A = new Int32Array(15 * 128), Z_PIECE_B = new Int32Array(15 * 128);
var Z_CASTLE_A = new Int32Array(16), Z_CASTLE_B = new Int32Array(16);
var Z_EP_A = new Int32Array(8), Z_EP_B = new Int32Array(8);
var Z_SIDE_A, Z_SIDE_B;
(function () {
  var r = rng(0x9e3779b9);
  for (var i = 0; i < Z_PIECE_A.length; i++) { Z_PIECE_A[i] = r() | 0; Z_PIECE_B[i] = r() | 0; }
  for (i = 0; i < 16; i++) { Z_CASTLE_A[i] = r() | 0; Z_CASTLE_B[i] = r() | 0; }
  for (i = 0; i < 8; i++) { Z_EP_A[i] = r() | 0; Z_EP_B[i] = r() | 0; }
  Z_SIDE_A = r() | 0; Z_SIDE_B = r() | 0;
})();

/* -------------------------------------------------------------- Position */

function Position() {
  this.board = new Int8Array(128);
  this.side = WHITE;
  this.castling = 0;
  this.ep = -1;            /* target square behind a double push, or -1 */
  this.halfmove = 0;
  this.fullmove = 1;
  this.kingSq = [-1, -1];  /* indexed by colour>>3 */
  this.hashA = 0; this.hashB = 0;
  this.hist = [];          /* unmake stack */
  this.repA = []; this.repB = [];  /* hash of every position reached */
}

Position.prototype.clone = function () {
  var p = new Position();
  p.board.set(this.board);
  p.side = this.side; p.castling = this.castling; p.ep = this.ep;
  p.halfmove = this.halfmove; p.fullmove = this.fullmove;
  p.kingSq = this.kingSq.slice();
  p.hashA = this.hashA; p.hashB = this.hashB;
  p.repA = this.repA.slice(); p.repB = this.repB.slice();
  return p;
};

Position.prototype.rehash = function () {
  var a = 0, b = 0;
  for (var s = 0; s < 128; s++) {
    if (s & 0x88) continue;
    var p = this.board[s];
    if (p) { a ^= Z_PIECE_A[p * 128 + s]; b ^= Z_PIECE_B[p * 128 + s]; }
  }
  a ^= Z_CASTLE_A[this.castling]; b ^= Z_CASTLE_B[this.castling];
  if (this.ep >= 0) { a ^= Z_EP_A[fileOf(this.ep)]; b ^= Z_EP_B[fileOf(this.ep)]; }
  if (this.side === BLACK) { a ^= Z_SIDE_A; b ^= Z_SIDE_B; }
  this.hashA = a; this.hashB = b;
};

/* ------------------------------------------------------------------- FEN */

var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function fromFen(fen) {
  var p = new Position();
  var parts = String(fen).trim().split(/\s+/);
  var rows = parts[0].split('/');
  if (rows.length !== 8) throw new Error('bad FEN: ' + fen);
  for (var r = 0; r < 8; r++) {
    var row = rows[7 - r], f = 0;
    for (var i = 0; i < row.length; i++) {
      var c = row[i];
      if (c >= '1' && c <= '8') { f += +c; continue; }
      var t = PIECE_CHARS.indexOf(c.toLowerCase());
      if (t < 1) throw new Error('bad FEN piece: ' + c);
      var piece = t | (c === c.toLowerCase() ? BLACK : WHITE);
      p.board[sq(f, r)] = piece;
      if (t === KING) p.kingSq[piece & 8 ? 1 : 0] = sq(f, r);
      f++;
    }
  }
  p.side = (parts[1] === 'b') ? BLACK : WHITE;
  var cr = parts[2] || '-';
  if (cr.indexOf('K') >= 0) p.castling |= CR_WK;
  if (cr.indexOf('Q') >= 0) p.castling |= CR_WQ;
  if (cr.indexOf('k') >= 0) p.castling |= CR_BK;
  if (cr.indexOf('q') >= 0) p.castling |= CR_BQ;
  p.ep = (parts[3] && parts[3] !== '-') ? nameToSq(parts[3]) : -1;
  p.halfmove = parts[4] ? +parts[4] : 0;
  p.fullmove = parts[5] ? +parts[5] : 1;
  p.rehash();
  p.repA = [p.hashA]; p.repB = [p.hashB];
  return p;
}

function toFen(p) {
  var out = '';
  for (var r = 7; r >= 0; r--) {
    var run = 0;
    for (var f = 0; f < 8; f++) {
      var piece = p.board[sq(f, r)];
      if (!piece) { run++; continue; }
      if (run) { out += run; run = 0; }
      var c = PIECE_CHARS[typeOf(piece)];
      out += colorOf(piece) === WHITE ? c.toUpperCase() : c;
    }
    if (run) out += run;
    if (r) out += '/';
  }
  var cr = '';
  if (p.castling & CR_WK) cr += 'K';
  if (p.castling & CR_WQ) cr += 'Q';
  if (p.castling & CR_BK) cr += 'k';
  if (p.castling & CR_BQ) cr += 'q';
  return out + ' ' + (p.side === WHITE ? 'w' : 'b') + ' ' + (cr || '-') + ' ' +
    (p.ep >= 0 ? sqName(p.ep) : '-') + ' ' + p.halfmove + ' ' + p.fullmove;
}

/* -------------------------------------------------------------- Attacks */

/* Is `target` attacked by any piece of colour `by`? Used for legality,
   castling and check detection, so it runs constantly — hence the hand-rolled
   loops rather than reusing move generation. */
function isAttacked(p, target, by) {
  var b = p.board, i, s, d, piece;

  /* Pawns: look backwards from the target along the capture diagonals. */
  var pd = (by === WHITE) ? -16 : 16;
  for (i = -1; i <= 1; i += 2) {
    s = target + pd + i;
    if (onBoard(s) && b[s] === (PAWN | by)) return true;
  }
  for (i = 0; i < 8; i++) {
    s = target + KNIGHT_DIRS[i];
    if (onBoard(s) && b[s] === (KNIGHT | by)) return true;
  }
  for (i = 0; i < 8; i++) {
    s = target + KING_DIRS[i];
    if (onBoard(s) && b[s] === (KING | by)) return true;
  }
  for (i = 0; i < 4; i++) {
    d = BISHOP_DIRS[i]; s = target + d;
    while (onBoard(s)) {
      piece = b[s];
      if (piece) {
        if (colorOf(piece) === by && (typeOf(piece) === BISHOP || typeOf(piece) === QUEEN)) return true;
        break;
      }
      s += d;
    }
  }
  for (i = 0; i < 4; i++) {
    d = ROOK_DIRS[i]; s = target + d;
    while (onBoard(s)) {
      piece = b[s];
      if (piece) {
        if (colorOf(piece) === by && (typeOf(piece) === ROOK || typeOf(piece) === QUEEN)) return true;
        break;
      }
      s += d;
    }
  }
  return false;
}

function inCheck(p, color) {
  if (color === undefined) color = p.side;
  var k = p.kingSq[color ? 1 : 0];
  return k >= 0 && isAttacked(p, k, color ^ 8);
}

/* ---------------------------------------------------------- Move generation */

/* Pseudo-legal: moves that leave your own king in check are filtered by the
   caller after making them. Castling is the exception — its legality involves
   squares the king passes through, so it is checked here. */
function genMoves(p, capturesOnly, out) {
  out = out || [];
  var b = p.board, us = p.side, them = us ^ 8, s, piece, i, d, t, target;

  for (s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    piece = b[s];
    if (!piece || colorOf(piece) !== us) continue;
    var type = typeOf(piece);

    if (type === PAWN) {
      var dir = us === WHITE ? 16 : -16;
      var promoRank = us === WHITE ? 7 : 0;
      var startRank = us === WHITE ? 1 : 6;
      t = s + dir;
      if (onBoard(t) && !b[t]) {
        if (rankOf(t) === promoRank) {
          out.push(mkMove(s, t, QUEEN, 0), mkMove(s, t, ROOK, 0),
                   mkMove(s, t, BISHOP, 0), mkMove(s, t, KNIGHT, 0));
        } else if (!capturesOnly) {
          out.push(mkMove(s, t, 0, 0));
          var t2 = s + 2 * dir;
          if (rankOf(s) === startRank && !b[t2]) out.push(mkMove(s, t2, 0, F_DOUBLE));
        }
      }
      for (i = -1; i <= 1; i += 2) {
        t = s + dir + i;
        if (!onBoard(t)) continue;
        target = b[t];
        if (target && colorOf(target) === them) {
          if (rankOf(t) === promoRank) {
            out.push(mkMove(s, t, QUEEN, F_CAP), mkMove(s, t, ROOK, F_CAP),
                     mkMove(s, t, BISHOP, F_CAP), mkMove(s, t, KNIGHT, F_CAP));
          } else out.push(mkMove(s, t, 0, F_CAP));
        } else if (!target && t === p.ep) {
          out.push(mkMove(s, t, 0, F_CAP | F_EP));
        }
      }
      continue;
    }

    if (type === KNIGHT || type === KING) {
      var dirs = type === KNIGHT ? KNIGHT_DIRS : KING_DIRS;
      for (i = 0; i < 8; i++) {
        t = s + dirs[i];
        if (!onBoard(t)) continue;
        target = b[t];
        if (!target) { if (!capturesOnly) out.push(mkMove(s, t, 0, 0)); }
        else if (colorOf(target) === them) out.push(mkMove(s, t, 0, F_CAP));
      }
      continue;
    }

    var slide = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : KING_DIRS;
    var n = type === QUEEN ? 8 : 4;
    for (i = 0; i < n; i++) {
      d = slide[i]; t = s + d;
      while (onBoard(t)) {
        target = b[t];
        if (!target) { if (!capturesOnly) out.push(mkMove(s, t, 0, 0)); }
        else {
          if (colorOf(target) === them) out.push(mkMove(s, t, 0, F_CAP));
          break;
        }
        t += d;
      }
    }
  }

  if (!capturesOnly) {
    var home = us === WHITE ? 0 : 7;
    var e = sq(4, home);
    if (b[e] === (KING | us) && !isAttacked(p, e, them)) {
      var kSide = us === WHITE ? CR_WK : CR_BK;
      var qSide = us === WHITE ? CR_WQ : CR_BQ;
      if ((p.castling & kSide) && !b[e + 1] && !b[e + 2] &&
          b[sq(7, home)] === (ROOK | us) && !isAttacked(p, e + 1, them))
        out.push(mkMove(e, e + 2, 0, F_CASTLE));
      if ((p.castling & qSide) && !b[e - 1] && !b[e - 2] && !b[e - 3] &&
          b[sq(0, home)] === (ROOK | us) && !isAttacked(p, e - 1, them))
        out.push(mkMove(e, e - 2, 0, F_CASTLE));
    }
  }
  return out;
}

/* Castling rights are revoked by any move touching these squares. */
var CR_MASK = new Int8Array(128);
(function () {
  for (var i = 0; i < 128; i++) CR_MASK[i] = 15;
  CR_MASK[sq(4, 0)] = 15 & ~(CR_WK | CR_WQ);
  CR_MASK[sq(0, 0)] = 15 & ~CR_WQ;
  CR_MASK[sq(7, 0)] = 15 & ~CR_WK;
  CR_MASK[sq(4, 7)] = 15 & ~(CR_BK | CR_BQ);
  CR_MASK[sq(0, 7)] = 15 & ~CR_BQ;
  CR_MASK[sq(7, 7)] = 15 & ~CR_BK;
})();

function makeMove(p, m) {
  var b = p.board, from = mFrom(m), to = mTo(m), promo = mPromo(m);
  var piece = b[from], us = p.side, them = us ^ 8;
  var captured = 0, capSq = to;

  if (m & F_EP) capSq = to - (us === WHITE ? 16 : -16);
  captured = b[capSq];

  p.hist.push({
    move: m, captured: captured, capSq: capSq, castling: p.castling,
    ep: p.ep, halfmove: p.halfmove, hashA: p.hashA, hashB: p.hashB
  });

  /* Hash out what is changing, hash it back in below. */
  p.hashA ^= Z_CASTLE_A[p.castling]; p.hashB ^= Z_CASTLE_B[p.castling];
  if (p.ep >= 0) { p.hashA ^= Z_EP_A[fileOf(p.ep)]; p.hashB ^= Z_EP_B[fileOf(p.ep)]; }

  if (captured) {
    b[capSq] = EMPTY;
    p.hashA ^= Z_PIECE_A[captured * 128 + capSq];
    p.hashB ^= Z_PIECE_B[captured * 128 + capSq];
  }

  b[from] = EMPTY;
  p.hashA ^= Z_PIECE_A[piece * 128 + from];
  p.hashB ^= Z_PIECE_B[piece * 128 + from];

  var placed = promo ? (promo | us) : piece;
  b[to] = placed;
  p.hashA ^= Z_PIECE_A[placed * 128 + to];
  p.hashB ^= Z_PIECE_B[placed * 128 + to];

  if (typeOf(piece) === KING) {
    p.kingSq[us ? 1 : 0] = to;
    if (m & F_CASTLE) {
      var rookFrom = to > from ? to + 1 : to - 2;
      var rookTo = to > from ? to - 1 : to + 1;
      var rook = b[rookFrom];
      b[rookFrom] = EMPTY; b[rookTo] = rook;
      p.hashA ^= Z_PIECE_A[rook * 128 + rookFrom] ^ Z_PIECE_A[rook * 128 + rookTo];
      p.hashB ^= Z_PIECE_B[rook * 128 + rookFrom] ^ Z_PIECE_B[rook * 128 + rookTo];
    }
  }

  p.castling &= CR_MASK[from] & CR_MASK[to];
  p.ep = (m & F_DOUBLE) ? (from + (us === WHITE ? 16 : -16)) : -1;
  p.halfmove = (typeOf(piece) === PAWN || captured) ? 0 : p.halfmove + 1;
  if (us === BLACK) p.fullmove++;
  p.side = them;

  p.hashA ^= Z_CASTLE_A[p.castling]; p.hashB ^= Z_CASTLE_B[p.castling];
  if (p.ep >= 0) { p.hashA ^= Z_EP_A[fileOf(p.ep)]; p.hashB ^= Z_EP_B[fileOf(p.ep)]; }
  p.hashA ^= Z_SIDE_A; p.hashB ^= Z_SIDE_B;

  p.repA.push(p.hashA); p.repB.push(p.hashB);
  return true;
}

function unmakeMove(p) {
  var h = p.hist.pop();
  if (!h) return false;
  var b = p.board, m = h.move, from = mFrom(m), to = mTo(m);
  var them = p.side, us = them ^ 8;

  p.repA.pop(); p.repB.pop();

  var placed = b[to];
  var piece = mPromo(m) ? (PAWN | us) : placed;
  b[from] = piece;
  b[to] = EMPTY;
  if (h.captured) b[h.capSq] = h.captured;

  if (typeOf(piece) === KING) {
    p.kingSq[us ? 1 : 0] = from;
    if (m & F_CASTLE) {
      var rookFrom = to > from ? to + 1 : to - 2;
      var rookTo = to > from ? to - 1 : to + 1;
      b[rookFrom] = b[rookTo]; b[rookTo] = EMPTY;
    }
  }

  p.side = us;
  p.castling = h.castling; p.ep = h.ep; p.halfmove = h.halfmove;
  p.hashA = h.hashA; p.hashB = h.hashB;
  if (us === BLACK) p.fullmove--;
  return true;
}

function legalMoves(p) {
  var pseudo = genMoves(p, false), out = [], us = p.side;
  for (var i = 0; i < pseudo.length; i++) {
    makeMove(p, pseudo[i]);
    if (!inCheck(p, us)) out.push(pseudo[i]);
    unmakeMove(p);
  }
  return out;
}

/* --------------------------------------------------------------- Outcomes */

function insufficientMaterial(p) {
  var b = p.board, minors = [], others = 0;
  for (var s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    var piece = b[s];
    if (!piece) continue;
    var t = typeOf(piece);
    if (t === KING) continue;
    if (t === BISHOP || t === KNIGHT) minors.push({ t: t, c: colorOf(piece), dark: ((fileOf(s) + rankOf(s)) & 1) === 0 });
    else others++;
  }
  if (others) return false;
  if (minors.length === 0) return true;                       /* K vs K */
  if (minors.length === 1) return true;                       /* K+minor vs K */
  if (minors.length === 2 && minors[0].t === BISHOP && minors[1].t === BISHOP
      && minors[0].dark === minors[1].dark) return true;      /* same-colour bishops */
  return false;
}

function repetitionCount(p) {
  var n = 0, len = p.repA.length;
  var back = Math.min(p.halfmove, len - 1);
  for (var i = len - 2; i >= len - 1 - back; i -= 2) {
    if (p.repA[i] === p.repA[len - 1] && p.repB[i] === p.repB[len - 1]) n++;
  }
  return n + 1;
}

/* 'checkmate' | 'stalemate' | 'fifty' | 'repetition' | 'material' | null */
function outcome(p) {
  if (legalMoves(p).length === 0) return inCheck(p) ? 'checkmate' : 'stalemate';
  if (p.halfmove >= 100) return 'fifty';
  if (repetitionCount(p) >= 3) return 'repetition';
  if (insufficientMaterial(p)) return 'material';
  return null;
}

/* ------------------------------------------------------------------- SAN */

function moveToSan(p, m) {
  var from = mFrom(m), to = mTo(m), piece = p.board[from], type = typeOf(piece);
  var san;

  if (m & F_CASTLE) {
    san = to > from ? 'O-O' : 'O-O-O';
  } else if (type === PAWN) {
    san = (m & F_CAP) ? FILES[fileOf(from)] + 'x' + sqName(to) : sqName(to);
    if (mPromo(m)) san += '=' + PIECE_CHARS[mPromo(m)].toUpperCase();
  } else {
    /* Disambiguate against every other legal move of the same piece type
       landing on the same square — by file if that is enough, else by rank. */
    var legal = legalMoves(p), sameFile = false, sameRank = false, ambiguous = false;
    for (var i = 0; i < legal.length; i++) {
      var o = legal[i];
      if (o === m) continue;
      if (mTo(o) !== to) continue;
      if (typeOf(p.board[mFrom(o)]) !== type) continue;
      ambiguous = true;
      if (fileOf(mFrom(o)) === fileOf(from)) sameFile = true;
      if (rankOf(mFrom(o)) === rankOf(from)) sameRank = true;
    }
    var disamb = '';
    if (ambiguous) {
      if (!sameFile) disamb = FILES[fileOf(from)];
      else if (!sameRank) disamb = '' + (rankOf(from) + 1);
      else disamb = sqName(from);
    }
    san = PIECE_CHARS[type].toUpperCase() + disamb + ((m & F_CAP) ? 'x' : '') + sqName(to);
  }

  makeMove(p, m);
  var check = inCheck(p);
  var noReply = legalMoves(p).length === 0;
  unmakeMove(p);
  if (check) san += noReply ? '#' : '+';
  return san;
}

function sanToMove(p, san) {
  var clean = String(san).replace(/[+#?!]/g, '').trim();
  var legal = legalMoves(p);
  for (var i = 0; i < legal.length; i++) {
    if (moveToSan(p, legal[i]).replace(/[+#]/g, '') === clean) return legal[i];
  }
  /* Tolerate 0-0 and long algebraic (e2e4, e7e8q). */
  var alt = clean.replace(/0/g, 'O');
  for (i = 0; i < legal.length; i++) {
    if (moveToSan(p, legal[i]).replace(/[+#]/g, '') === alt) return legal[i];
  }
  var lan = clean.toLowerCase();
  if (/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(lan)) {
    var from = nameToSq(lan.slice(0, 2)), to = nameToSq(lan.slice(2, 4));
    var promo = lan[4] ? PIECE_CHARS.indexOf(lan[4]) : 0;
    for (i = 0; i < legal.length; i++) {
      if (mFrom(legal[i]) === from && mTo(legal[i]) === to &&
          (!promo || mPromo(legal[i]) === promo)) return legal[i];
    }
  }
  return 0;
}

function moveToUci(m) {
  return sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? PIECE_CHARS[mPromo(m)] : '');
}

/* --------------------------------------------------------------- Testing */

function perft(p, depth) {
  if (depth === 0) return 1;
  var moves = genMoves(p, false), total = 0, us = p.side;
  for (var i = 0; i < moves.length; i++) {
    makeMove(p, moves[i]);
    if (!inCheck(p, us)) total += perft(p, depth - 1);
    unmakeMove(p);
  }
  return total;
}

return {
  EMPTY: EMPTY, PAWN: PAWN, KNIGHT: KNIGHT, BISHOP: BISHOP, ROOK: ROOK,
  QUEEN: QUEEN, KING: KING, WHITE: WHITE, BLACK: BLACK,
  F_EP: F_EP, F_CASTLE: F_CASTLE, F_DOUBLE: F_DOUBLE, F_CAP: F_CAP,
  START_FEN: START_FEN, FILES: FILES, PIECE_CHARS: PIECE_CHARS,
  Position: Position, fromFen: fromFen, toFen: toFen,
  sq: sq, fileOf: fileOf, rankOf: rankOf, onBoard: onBoard,
  colorOf: colorOf, typeOf: typeOf, sqName: sqName, nameToSq: nameToSq,
  mkMove: mkMove, mFrom: mFrom, mTo: mTo, mPromo: mPromo,
  genMoves: genMoves, legalMoves: legalMoves, makeMove: makeMove,
  unmakeMove: unmakeMove, isAttacked: isAttacked, inCheck: inCheck,
  outcome: outcome, insufficientMaterial: insufficientMaterial,
  repetitionCount: repetitionCount,
  moveToSan: moveToSan, sanToMove: sanToMove, moveToUci: moveToUci,
  perft: perft
};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Chess;
