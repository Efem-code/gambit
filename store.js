/* Gambit — persistence.
 *
 * Everything lives in localStorage on the device. No account, no server, and
 * nothing leaves the phone. Every read is defensive: storage can be full,
 * disabled, or hold something written by an older version, and none of those
 * should stop you starting a game.
 */
var Store = (function () {
'use strict';

var KEY = 'gambit.v1';
var MAX_GAMES = 60;

var DEFAULTS = {
  settings: {
    elo: 1000, playAs: 'w', showEval: false, coords: true, sound: true,
    confirmMoves: false, reviewTime: 700, theme: 'wood', pieces: 'staunton',
    coach: false, coachLevel: 250
  },
  rating: 1000,
  ratingGames: 0,
  record: { w: 0, d: 0, l: 0 },
  games: [],          /* finished games, newest first */
  current: null,      /* a game in progress */
  lessons: {},        /* lessonId -> { done: true, at: iso } */

  /* Positions where you went wrong, kept as puzzles. These live outside the
     games list on purpose: a review is trimmed once five newer games exist,
     and the mistakes are the one part of it worth keeping forever. */
  puzzles: [],
  harvested: {},      /* gameId -> true, so re-reviewing never double-counts */

  /* Running totals for the weakness report. Counting as games are reviewed
     rather than re-reading the games list means the report still covers your
     whole history after the old reviews have been trimmed away. */
  stats: {
    reviewed: 0, myMoves: 0, accSum: 0,
    motifs: {},       /* motif -> { n, cp } */
    phases: {},       /* phase -> { n, cp, moves, accSum } */
    pieces: {}        /* piece name -> { n, cp } */
  }
};

/* Leitner boxes, in days. A puzzle you get right moves up a box and comes back
   later; one you get wrong drops to the start, because a blunder you repeat is
   exactly the one worth drilling again tomorrow. */
var BOXES = [0, 1, 3, 7, 16, 35];
var MAX_PUZZLES = 150;
var MAX_PER_GAME = 6;

function clone(o) { return JSON.parse(JSON.stringify(o)); }

var data = null;

function load() {
  if (data) return data;
  data = clone(DEFAULTS);
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      /* Merge rather than replace, so a field added in a later version still
         gets its default instead of coming back undefined. */
      Object.keys(DEFAULTS).forEach(function (k) {
        if (parsed[k] === undefined) return;
        if (k === 'settings') {
          Object.keys(DEFAULTS.settings).forEach(function (sk) {
            if (parsed.settings && parsed.settings[sk] !== undefined) data.settings[sk] = parsed.settings[sk];
          });
        } else data[k] = parsed[k];
      });
    }
  } catch (e) { /* corrupt or unavailable — start fresh rather than fail */ }
  return data;
}

var saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) {
      /* Almost certainly the quota. Drop the oldest reviews, which are by far
         the biggest thing here, and try once more. */
      try {
        data.games.forEach(function (g, i) { if (i > 4) delete g.review; });
        data.games = data.games.slice(0, 20);
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (e2) {}
    }
  }, 120);
}
function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
}

function settings() { return load().settings; }
function setSetting(k, v) { load().settings[k] = v; save(); }

function setCurrent(game) { load().current = game; save(); }
function getCurrent() { return load().current; }
function clearCurrent() { load().current = null; save(); }

function addGame(game) {
  var d = load();
  d.games.unshift(game);
  if (d.games.length > MAX_GAMES) d.games.length = MAX_GAMES;
  d.current = null;
  saveNow();
  return game;
}
function games() { return load().games; }
function gameById(id) {
  var list = load().games;
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
function deleteGame(id) {
  var d = load();
  d.games = d.games.filter(function (g) { return g.id !== id; });
  /* Delete the puzzles that came from it too — a position you can no longer
     look up in a game is a puzzle with no story behind it. Clearing the
     harvest mark means a re-analysed game can contribute again. */
  d.puzzles = d.puzzles.filter(function (q) { return q.gameId !== id; });
  delete d.harvested[id];
  saveNow();
}
function attachReview(id, review) {
  var g = gameById(id);
  if (!g) return;
  g.review = review;
  /* Only the newest few keep their full analysis; older ones keep the summary
     so the list still shows accuracy without filling the quota. */
  var list = load().games;
  list.forEach(function (other, i) {
    if (i > 4 && other.review && other.review.moves) {
      other.review = { accuracy: other.review.accuracy, counts: other.review.counts };
    }
  });
  saveNow();
}

/* ------------------------------------------------------- Puzzles & stats */

function bump(table, key, cp) {
  if (!key) return;
  var e = table[key] || (table[key] = { n: 0, cp: 0 });
  e.n++; e.cp += cp || 0;
}

function dayMs() { return 86400000; }

/* Pull everything worth keeping out of a finished review: the positions you got
   wrong, and the running totals behind the weakness report. Only your own moves
   count — the engine's mistakes are not yours to learn from. */
function harvestReview(game, review) {
  var d = load();
  if (!review || !review.moves || !game) return { added: 0 };
  if (d.harvested[game.id]) return { added: 0, already: true };

  var mySide = game.playerColor === 'b' ? 'black' : 'white';
  var now = Date.now(), added = 0;

  /* A position already in the collection is not added twice — the same opening
     slip in ten games should be one puzzle you keep failing, not ten. */
  var seen = {};
  d.puzzles.forEach(function (q) { seen[q.fen] = true; });

  /* One bad game can contain twenty mistakes. Taking the worst few keeps the
     deck something you can actually get through, and the worst few are the
     ones worth the time anyway. */
  var candidates = [];

  review.moves.forEach(function (m) {
    if (m.side !== mySide) return;
    d.stats.myMoves++;
    d.stats.accSum += m.accuracy;

    var ph = d.stats.phases[m.phase] || (d.stats.phases[m.phase] = { n: 0, cp: 0, moves: 0, accSum: 0 });
    ph.moves++; ph.accSum += m.accuracy;

    if (m.motif) {
      bump(d.stats.motifs, m.motif, m.cpLoss);
      bump(d.stats.pieces, m.piece, m.cpLoss);
      ph.n++; ph.cp += m.cpLoss;
    }
    if (!m.puzzle || seen[m.fenBefore]) return;
    seen[m.fenBefore] = true;
    candidates.push(m);
  });

  candidates.sort(function (a, b) { return b.cpLoss - a.cpLoss; });
  candidates.slice(0, MAX_PER_GAME).forEach(function (m) {
    d.puzzles.unshift({
      id: newId(), fen: m.fenBefore,
      solution: C_uci(m.best), solutionSan: m.bestSan,
      played: m.uci, playedSan: m.san,
      motif: m.motif, motifLabel: m.motifLabel, phase: m.phase,
      cpLoss: m.cpLoss, note: m.note,
      line: (m.bestLine || []).slice(0, 6),
      gameId: game.id, at: now,
      box: 0, due: now, attempts: 0, solved: 0, lapses: 0
    });
    added++;
  });

  d.stats.reviewed++;
  d.harvested[game.id] = true;
  trimPuzzles(d);
  saveNow();
  return { added: added };
}

/* Chess isn't loaded inside the store, so the caller hands over move integers
   and this turns them into the plain UCI strings the trainer replays. */
var uciFn = null;
function useUci(fn) { uciFn = fn; }
function C_uci(move) { return uciFn ? uciFn(move) : String(move); }

/* When the collection is full, the puzzles you have already mastered go first —
   a position solved four times running has done its job. */
function trimPuzzles(d) {
  if (d.puzzles.length <= MAX_PUZZLES) return;
  d.puzzles.sort(function (a, b) {
    if (a.box !== b.box) return a.box - b.box;
    return b.at - a.at;
  });
  d.puzzles.length = MAX_PUZZLES;
}

function puzzles() { return load().puzzles; }

function duePuzzles(limit) {
  var now = Date.now();
  var list = load().puzzles.filter(function (q) { return q.due <= now; });
  /* Hardest first: a lower box means you have got it wrong more recently. */
  list.sort(function (a, b) {
    if (a.box !== b.box) return a.box - b.box;
    return b.cpLoss - a.cpLoss;
  });
  return limit ? list.slice(0, limit) : list;
}

function puzzleById(id) {
  var list = load().puzzles;
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function gradePuzzle(id, correct) {
  var q = puzzleById(id);
  if (!q) return null;
  q.attempts++;
  if (correct) {
    q.solved++;
    q.box = Math.min(q.box + 1, BOXES.length - 1);
  } else {
    if (q.box > 0) q.lapses++;
    q.box = 0;
  }
  q.due = Date.now() + BOXES[q.box] * dayMs();
  /* A box-0 puzzle you just failed should come back this session, not today. */
  if (!correct) q.due = Date.now();
  saveNow();
  return q;
}

function deletePuzzle(id) {
  var d = load();
  d.puzzles = d.puzzles.filter(function (q) { return q.id !== id; });
  saveNow();
}

function puzzleSummary() {
  var list = load().puzzles, now = Date.now();
  var due = 0, mastered = 0, i;
  for (i = 0; i < list.length; i++) {
    if (list[i].due <= now) due++;
    if (list[i].box >= BOXES.length - 1) mastered++;
  }
  return { total: list.length, due: due, mastered: mastered };
}

function stats() { return load().stats; }

/* Standard Elo, K = 32 until you have a few games in, then 24. Beating a level
   above you moves you a lot; beating one below you barely registers. */
function recordResult(score, opponentElo) {
  var d = load();
  var k = d.ratingGames < 10 ? 40 : 24;
  var expected = 1 / (1 + Math.pow(10, (opponentElo - d.rating) / 400));
  d.rating = Math.round(d.rating + k * (score - expected));
  if (d.rating < 100) d.rating = 100;
  d.ratingGames++;
  if (score === 1) d.record.w++;
  else if (score === 0.5) d.record.d++;
  else d.record.l++;
  saveNow();
  return d.rating;
}
function rating() { return load().rating; }
function record() { return load().record; }
function ratingGames() { return load().ratingGames; }

function lessonDone(id) {
  var d = load();
  d.lessons[id] = { done: true, at: new Date().toISOString() };
  saveNow();
}
function lessons() { return load().lessons; }

function exportAll() { return JSON.stringify(load(), null, 2); }
function resetAll() {
  data = clone(DEFAULTS);
  saveNow();
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

return {
  settings: settings, setSetting: setSetting,
  setCurrent: setCurrent, getCurrent: getCurrent, clearCurrent: clearCurrent,
  addGame: addGame, games: games, gameById: gameById, deleteGame: deleteGame,
  attachReview: attachReview,
  recordResult: recordResult, rating: rating, record: record, ratingGames: ratingGames,
  lessonDone: lessonDone, lessons: lessons,
  harvestReview: harvestReview, useUci: useUci,
  puzzles: puzzles, duePuzzles: duePuzzles, puzzleById: puzzleById,
  gradePuzzle: gradePuzzle, deletePuzzle: deletePuzzle,
  puzzleSummary: puzzleSummary, stats: stats, BOXES: BOXES,
  exportAll: exportAll, resetAll: resetAll, newId: newId, saveNow: saveNow
};
})();
