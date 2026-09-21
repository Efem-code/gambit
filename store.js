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
    confirmMoves: false, reviewTime: 700, theme: 'wood', pieces: 'staunton'
  },
  rating: 1000,
  ratingGames: 0,
  record: { w: 0, d: 0, l: 0 },
  games: [],          /* finished games, newest first */
  current: null,      /* a game in progress */
  lessons: {}         /* lessonId -> { done: true, at: iso } */
};

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
  exportAll: exportAll, resetAll: resetAll, newId: newId, saveNow: saveNow
};
})();
