/* Gambit — opening book.
 *
 * A search with no book plays the same slightly odd first move every game. The
 * book exists for variety and for naming what you played, not for strength: it
 * is shallow, and the engine is on its own by move six or seven.
 *
 * Lines are written in SAN and replayed at load, so an illegal move is caught
 * immediately rather than silently ignored.
 */
var Book = (function () {
'use strict';

var C = (typeof Chess !== 'undefined') ? Chess : require('./chess.js');

var LINES = [
  /* --- 1.e4 e5 --- */
  ['Italian Game',            'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O'],
  ['Italian, Two Knights',    'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6'],
  ['Ruy Lopez, Closed',       'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O'],
  ['Ruy Lopez, Berlin',       'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5'],
  ['Ruy Lopez, Exchange',     'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4'],
  ['Scotch Game',             'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Be3 Qf6 c3 Nge7'],
  ['Petrov Defence',          'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Be7 O-O Nc6'],
  ['Philidor Defence',        'e4 e5 Nf3 d6 d4 exd4 Nxd4 Nf6 Nc3 Be7 Be2 O-O'],
  ['Four Knights Game',       'e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4 O-O O-O d3 d6'],
  ['Vienna Game',             'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7'],
  ["King's Gambit",           'e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5 Nf6 d4 d6'],

  /* --- 1.e4 c5 --- */
  ['Sicilian, Najdorf',       'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6'],
  ['Sicilian, Dragon',        'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O'],
  ['Sicilian, Classical',     'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 d6 Bg5 e6 Qd2 Be7'],
  ['Sicilian, Sveshnikov',    'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5'],
  ['Sicilian, Accelerated Dragon', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nc3 Bg7 Be3 Nf6 Bc4 O-O'],
  ['Sicilian, Alapin',        'e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6'],
  ['Sicilian, Closed',        'e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6 Be3 e6'],
  ['Sicilian, Taimanov',      'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be3 a6'],

  /* --- other replies to 1.e4 --- */
  ['French, Winawer',         'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7'],
  ['French, Tarrasch',        'e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6'],
  ['French, Advance',         'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 Be2 Nge7'],
  ['Caro-Kann, Classical',    'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7'],
  ['Caro-Kann, Advance',      'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nd7'],
  ['Scandinavian Defence',    'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5'],
  ['Pirc Defence',            'e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O c6'],
  ['Modern Defence',          'e4 g6 d4 Bg7 Nc3 d6 Nf3 a6 Be3 Nd7'],
  ['Alekhine Defence',        'e4 Nf6 e5 Nd5 d4 d6 Nf3 g6 Bc4 Nb6 Bb3 Bg7'],

  /* --- 1.d4 d5 --- */
  ["Queen's Gambit Declined", 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6'],
  ["Queen's Gambit Accepted", 'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6'],
  ['Slav Defence',            'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6'],
  ['Semi-Slav Defence',       'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Bd3 dxc4 Bxc4 b5'],
  ['London System',           'd4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6 Nbd2 Bd6'],

  /* --- 1.d4 Nf6 --- */
  ['Nimzo-Indian Defence',    'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5'],
  ["Queen's Indian Defence",  'd4 Nf6 c4 e6 Nf3 b6 g3 Ba6 b3 Bb4+ Bd2 Be7'],
  ["King's Indian Defence",   'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6'],
  ['Grünfeld Defence',        'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5'],
  ['Benoni Defence',          'd4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 e4 g6'],
  ['Catalan Opening',         'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4'],
  ['Dutch Defence',           'd4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O c4 d6'],

  /* --- flank openings --- */
  ['English Opening',         'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6'],
  ['English, Symmetrical',    'c4 c5 Nf3 Nf6 Nc3 d5 cxd5 Nxd5 g3 Nc6 Bg2 g6'],
  ['Réti Opening',            'Nf3 d5 c4 e6 g3 Nf6 Bg2 Be7 O-O O-O']
];

var map = null;   /* position key -> { moves: [san], names: [line names] } */

function keyOf(p) {
  return C.toFen(p).split(' ').slice(0, 4).join(' ');
}

function build() {
  map = Object.create(null);
  var problems = [];
  for (var i = 0; i < LINES.length; i++) {
    var name = LINES[i][0], sans = LINES[i][1].split(' ');
    var p = C.fromFen(C.START_FEN);
    for (var j = 0; j < sans.length; j++) {
      var k = keyOf(p);
      var entry = map[k] || (map[k] = { moves: [], names: [] });
      if (entry.moves.indexOf(sans[j]) < 0) entry.moves.push(sans[j]);
      /* Every line that passes through this position is recorded. A position
         is only *named* once exactly one line reaches it — otherwise the start
         position would be called whichever opening happened to be listed last. */
      if (entry.names.indexOf(name) < 0) entry.names.push(name);
      var m = C.sanToMove(p, sans[j]);
      if (!m) { problems.push(name + ': illegal ' + sans[j] + ' at ply ' + (j + 1)); break; }
      C.makeMove(p, m);
    }
  }
  return problems;
}

/* Returns a playable book move, or 0. */
function probe(p) {
  if (!map) build();
  var e = map[keyOf(p)];
  if (!e || !e.moves.length) return 0;
  var legal = [];
  for (var i = 0; i < e.moves.length; i++) {
    var m = C.sanToMove(p, e.moves[i]);
    if (m) legal.push(m);
  }
  if (!legal.length) return 0;
  return legal[Math.floor(Math.random() * legal.length)];
}

/* The name of the opening, but only once the position is unique to one line —
   before that it is genuinely several openings at the same time. */
function nameOf(p) {
  if (!map) build();
  var e = map[keyOf(p)];
  return (e && e.names.length === 1) ? e.names[0] : '';
}

/* Whether this position is in the book at all, named or not. */
function has(p) {
  if (!map) build();
  return !!map[keyOf(p)];
}

return { probe: probe, nameOf: nameOf, has: has, build: build, LINES: LINES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Book;
