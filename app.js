/* Gambit — application.
 *
 * Four screens over one board widget: play a game, review a finished game,
 * drill the positions you got wrong, work through a lesson. The engine always
 * runs in a worker when one is
 * available, and falls back to the main thread when it is not, so the app still
 * works if a service worker is unavailable or the page is opened from a file.
 */
(function () {
'use strict';

var $ = function (id) { return document.getElementById(id); };
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function on(node, ev, fn) { if (node) node.addEventListener(ev, fn); }

/* ------------------------------------------------------------- engine host */

var Eng = (function () {
  var worker = null, seq = 0, pending = Object.create(null), broken = false;
  var localSearch = null;

  function ensure() {
    if (worker || broken) return worker;
    try {
      worker = new Worker('worker.js');
      worker.onerror = function () { broken = true; worker = null; };
      worker.onmessage = function (e) {
        var msg = e.data, entry = pending[msg.id];
        if (!entry) return;
        if (msg.type === 'progress') { if (entry.onProgress) entry.onProgress(msg); return; }
        delete pending[msg.id];
        entry.resolve(msg);
      };
    } catch (err) { broken = true; worker = null; }
    return worker;
  }

  /* Same work, on the main thread. Slower and it blocks, but a blocked phone
     for a second beats an app that cannot move a piece. */
  function fallback(msg) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (!localSearch) localSearch = new Engine.Search();
        var p = Chess.fromFen(msg.fen);
        if (msg.type === 'move') {
          var cfg = Engine.levelFor(msg.elo);
          var bm = msg.useBook !== false ? Book.probe(p) : 0;
          if (bm) return resolve({ type: 'move', move: bm, san: Chess.moveToSan(p, bm), score: 0, depth: 0, book: true });
          var r = localSearch.think(p, { depth: cfg.depth, time: cfg.time, exactRoot: true });
          if (!r.move) return resolve({ type: 'move', move: 0 });
          var chosen = Engine.chooseMove(r, cfg);
          return resolve({ type: 'move', move: chosen, san: Chess.moveToSan(p, chosen), score: r.score, depth: r.depth });
        }
        if (msg.type === 'eval') {
          var res = localSearch.think(p, { time: msg.time || 800, exactRoot: true });
          return resolve({ type: 'eval', move: res.move, san: res.move ? Chess.moveToSan(p, res.move) : '',
                           score: res.score, depth: res.depth, pv: res.pv, pvSan: [] });
        }
        if (msg.type === 'probe') {
          var pr = localSearch.think(p, { time: msg.time || 500, depth: msg.depth || 12, exactRoot: true });
          var ps = null, rm = pr.rootMoves || [];
          for (var k = 0; k < rm.length; k++) if (rm[k].move === msg.move) { ps = rm[k].score; break; }
          return resolve({
            type: 'probe', best: pr.move, bestSan: pr.move ? Chess.moveToSan(p, pr.move) : '',
            bestScore: pr.score, playedScore: ps, bestLineSan: [], punish: null
          });
        }
        if (msg.type === 'review') {
          var out = Review.analyze(msg.fen, msg.moves, { time: msg.time || 700, onProgress: msg._prog });
          /* The worker adds these; without one, add them here so the review
             screen does not quietly lose its "best line" text. */
          out.moves.forEach(function (mv) {
            var q = Chess.fromFen(mv.fenBefore), sans = [], n = 0;
            (mv.bestLine || []).forEach(function (x) {
              var lg = Chess.legalMoves(q), good = false;
              for (var j = 0; j < lg.length; j++) if (lg[j] === x) { good = true; break; }
              if (!good) return;
              sans.push(Chess.moveToSan(q, x)); Chess.makeMove(q, x); n++;
            });
            while (n--) Chess.unmakeMove(q);
            mv.bestLineSan = sans;
          });
          return resolve({ type: 'review', result: out });
        }
        resolve({});
      }, 20);
    });
  }

  function request(msg, onProgress) {
    var w = ensure();
    if (!w) { msg._prog = onProgress; return fallback(msg); }
    msg.id = ++seq;
    return new Promise(function (resolve) {
      pending[msg.id] = { resolve: resolve, onProgress: onProgress };
      w.postMessage(msg);
    });
  }

  function reset() {
    if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
    pending = Object.create(null);
  }

  return { request: request, reset: reset };
})();

/* -------------------------------------------------------------- feedback */

var Sound = (function () {
  var ctx = null;
  function tone(freq, ms, type, gain) {
    if (!Store.settings().sound) return;
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.06, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + ms / 1000);
    } catch (e) {}
  }
  return {
    move: function () { tone(420, 55, 'triangle'); },
    capture: function () { tone(240, 80, 'square', 0.05); },
    check: function () { tone(660, 110, 'triangle', 0.07); },
    win: function () { tone(523, 120); setTimeout(function () { tone(784, 180); }, 120); },
    lose: function () { tone(330, 150); setTimeout(function () { tone(220, 240); }, 140); },
    right: function () { tone(880, 90, 'triangle', 0.05); },
    wrong: function () { tone(180, 130, 'sawtooth', 0.04); }
  };
})();

function haptic(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) {} }

function setEvalBar(barEl, cpWhite, flipped) {
  if (!barEl) return;
  barEl.classList.toggle('flipped', !!flipped);
  var fill = barEl.querySelector('.evalbar-fill');
  var txt = barEl.querySelector('.evalbar-txt');
  var pct;
  if (Math.abs(cpWhite) > Engine.MATE - 1000) pct = cpWhite > 0 ? 100 : 0;
  else pct = Review.winPct(cpWhite);
  fill.style.height = Math.max(2, Math.min(98, pct)) + '%';
  txt.textContent = Math.abs(cpWhite) > Engine.MATE - 1000
    ? (cpWhite > 0 ? 'M' : '-M')
    : (cpWhite / 100).toFixed(1);
}

/* ============================================================ PLAY SCREEN */

var board = null;
var G = null;
var pendingConfirm = 0;
var thinking = false;

function levelOptions() {
  var sel = $('sel-level');
  sel.innerHTML = '';
  Engine.LEVELS.forEach(function (lv) {
    var o = el('option', null, lv.elo + ' — ' + lv.name);
    o.value = lv.elo;
    sel.appendChild(o);
  });
  /* A level chosen before the ladder was re-spaced holds a number that is no
     longer on it, which would leave the menu showing the wrong entry. Snap it
     to the nearest rung and save that, so what is shown is what will be played. */
  var want = Engine.levelFor(Store.settings().elo).elo;
  if (want !== Store.settings().elo) Store.setSetting('elo', want);
  sel.value = want;
  updateLevelNote();
}
function updateLevelNote() {
  var lv = Engine.levelFor(+$('sel-level').value);
  var note;
  if (lv.elo <= 700) note = 'Plays legal moves and spots the obvious, but hangs pieces regularly. A fair fight if you are just starting.';
  else if (lv.elo <= 1000) note = 'Sees one move ahead reliably. Will punish a hanging piece, will miss most tactics.';
  else if (lv.elo <= 1300) note = 'Sees simple tactics coming and rarely gives material away for nothing.';
  else if (lv.elo <= 1600) note = 'Calculates several moves ahead. You will need a real plan.';
  else if (lv.elo <= 1900) note = 'Punishes loose play quickly and defends accurately. Expect to work for it.';
  else note = 'Thinks for several seconds a move at its full ceiling. Expect to lose.';
  /* Honest about which half of this is measured. The gaps come from levels
     playing hundreds of games against each other; the numbers themselves have
     no outside reference to be anchored against. */
  $('level-note').textContent = note +
    ' The gaps between levels are measured from self-play; the numbers themselves are estimates.';
}

function newGame(opts) {
  var s = Store.settings();
  var color = opts.color;
  if (color === 'r') color = Math.random() < 0.5 ? 'w' : 'b';
  G = {
    id: Store.newId(),
    startFen: opts.fen || Chess.START_FEN,
    pos: Chess.fromFen(opts.fen || Chess.START_FEN),
    moves: [], sans: [],
    playerColor: color === 'w' ? Chess.WHITE : Chess.BLACK,
    elo: opts.elo || s.elo,
    startedAt: new Date().toISOString(),
    result: null, over: false, lastScore: 0, coached: false
  };
  coachApproved = 0; coachPending = 0;
  $('coach-card').hidden = true;
  showGame();
}

function showGame() {
  $('play-setup').hidden = true;
  $('play-game').hidden = false;
  $('result-card').hidden = true;
  pendingConfirm = 0;

  if (!board) {
    board = new Board($('board'), { onMove: onPlayerMove });
  }
  board.pos = G.pos;
  board.flipped = G.playerColor === Chess.BLACK;
  board.showCoords = Store.settings().coords;
  board.el.classList.toggle('nocoords', !Store.settings().coords);
  board.lastMove = G.moves.length
    ? { from: Chess.mFrom(G.moves[G.moves.length - 1]), to: Chess.mTo(G.moves[G.moves.length - 1]) }
    : null;
  board.setArrows([]);
  board.setFrozen(false);
  board.render();

  $('evalbar').hidden = !Store.settings().showEval;
  setEvalBar($('evalbar'), G.lastScore || 0, board.flipped);
  renderPlayers();
  renderMoveList();
  updateStatus();
  maybeEngineMove();
}

function renderPlayers() {
  var lv = Engine.levelFor(G.elo);
  var youAreWhite = G.playerColor === Chess.WHITE;
  var top = $('player-top'), bot = $('player-bot');
  top.querySelector('.pname').textContent = 'Gambit ' + lv.elo;
  top.querySelector('.pcap').textContent = lv.name;
  bot.querySelector('.pname').textContent = 'You';
  bot.querySelector('.pcap').textContent = (youAreWhite ? 'White' : 'Black') +
    (Store.ratingGames() ? ' · ' + Store.rating() : '');
  var yourTurn = G.pos.side === G.playerColor && !G.over;
  bot.classList.toggle('turn', yourTurn);
  top.classList.toggle('turn', !yourTurn && !G.over);
}

function renderMoveList() {
  var list = $('movelist');
  list.innerHTML = '';
  for (var i = 0; i < G.sans.length; i += 2) {
    list.appendChild(el('div', 'num', (i / 2 + 1) + '.'));
    var w = el('button', 'mv', G.sans[i]);
    list.appendChild(w);
    if (G.sans[i + 1]) list.appendChild(el('button', 'mv', G.sans[i + 1]));
    else list.appendChild(el('span'));
  }
  list.scrollTop = list.scrollHeight;
}

function updateStatus() {
  if (coachPending) { $('game-status').textContent = 'The coach has something to say.'; return; }
  var st = $('game-status');
  st.classList.remove('thinking');
  if (G.over) { st.textContent = G.resultText || 'Game over'; return; }
  if (thinking) { st.textContent = 'Gambit is thinking'; st.classList.add('thinking'); return; }
  if (G.pos.side === G.playerColor) {
    st.textContent = Chess.inCheck(G.pos) ? 'You are in check' : 'Your move';
    if (pendingConfirm) st.textContent = 'Tap the square again to confirm';
  } else st.textContent = 'Gambit to move';
  renderPlayers();
}

function onPlayerMove(m) {
  if (G.over || thinking) return;
  if (G.pos.side !== G.playerColor) return;
  if (Store.settings().confirmMoves) {
    if (pendingConfirm !== m) {
      pendingConfirm = m;
      board.setArrows([{ from: Chess.mFrom(m), to: Chess.mTo(m) }]);
      updateStatus();
      return;
    }
  }
  pendingConfirm = 0;
  board.setArrows([]);
  if (Store.settings().coach && coachApproved !== m) { askCoach(m); return; }
  coachApproved = 0;
  applyMove(m);
}

/* -------------------------------------------------------------- coach mode */

/* The engine looks at your move before it is played and, if it costs enough,
   says what it misses and lets you take it back. Deliberately opt-in and
   deliberately unrated: a game where something else is watching for hanging
   pieces is not a measurement of you playing chess. */

var coachApproved = 0;

function coachTag(loss) {
  if (loss >= 250) return 'Blunder';
  if (loss >= 120) return 'Mistake';
  return 'Slip';
}

function askCoach(m) {
  var san = Chess.moveToSan(G.pos, m);
  G.coached = true;
  thinking = true;
  board.setFrozen(true);
  $('game-status').textContent = 'Coach is checking ' + san + '…';

  Eng.request({ type: 'probe', fen: Chess.toFen(G.pos), move: m, time: 500, depth: 12 })
    .then(function (res) {
      thinking = false;
      if (!G || G.over) return;
      board.setFrozen(false);

      var played = res.playedScore;
      var loss = (played === null || played === undefined) ? 0 : (res.bestScore - played);
      var limit = Store.settings().coachLevel || 250;

      if (loss < limit || !res.best || res.best === m) {
        coachApproved = m;
        updateStatus();
        applyMove(m);
        return;
      }

      var parts = [];
      if (res.punish && res.punish.piece) {
        parts.push('It leaves the ' + res.punish.piece + ' on ' + res.punish.square +
                   ' — ' + res.punish.san + ' takes it.');
      } else if (res.punish && res.punish.san) {
        parts.push(res.punish.san + ' is the reply that hurts.');
      }
      parts.push(res.bestSan + ' was stronger' +
        (res.bestLineSan && res.bestLineSan.length > 1
          ? ' (' + res.bestLineSan.join(' ') + ')' : '') + '.');
      parts.push('About ' + (loss / 100).toFixed(1) + ' pawns.');

      coachPending = m;
      $('coach-tag').textContent = coachTag(loss);
      $('coach-move').textContent = san;
      $('coach-note').textContent = parts.join(' ');
      $('coach-card').hidden = false;
      board.setArrows([
        { from: Chess.mFrom(m), to: Chess.mTo(m), cls: 'alt' },
        { from: Chess.mFrom(res.best), to: Chess.mTo(res.best) }
      ]);
      board.setFrozen(true);
      haptic(18);
      updateStatus();
    });
}

var coachPending = 0;

function dismissCoach(play) {
  $('coach-card').hidden = true;
  board.setArrows([]);
  board.setFrozen(false);
  var m = coachPending;
  coachPending = 0;
  if (play && m) { coachApproved = m; applyMove(m); }
  else { board.render(); updateStatus(); }
}

function applyMove(m, done) {
  /* Clear the coach's approval as the move is spent. Move integers repeat —
     the same rook shuffle twice is the same number — and a stale approval
     would wave the second one through unchecked. */
  coachApproved = 0;
  var san = Chess.moveToSan(G.pos, m);
  G.moves.push(m);
  G.sans.push(san);
  if (san.indexOf('#') >= 0 || san.indexOf('+') >= 0) Sound.check();
  else if (m & Chess.F_CAP) Sound.capture();
  else Sound.move();
  haptic(6);
  board.animateMove(m, function () {
    renderMoveList();
    Store.setCurrent(serializeGame());
    if (!checkOver()) {
      updateStatus();
      maybeEngineMove();
    }
    if (done) done();
  });
}

function maybeEngineMove() {
  if (G.over || G.pos.side === G.playerColor) return;
  thinking = true;
  updateStatus();
  board.setFrozen(true);
  var fen = Chess.toFen(G.pos);
  Eng.request({ type: 'move', fen: fen, elo: G.elo }).then(function (res) {
    thinking = false;
    board.setFrozen(false);
    if (!G || G.over) return;
    if (!res.move) { checkOver(); return; }
    /* The worker replies with a raw move int; confirm it is still legal for
       this position before trusting it. */
    var legal = Chess.legalMoves(G.pos), ok = false;
    for (var i = 0; i < legal.length; i++) if (legal[i] === res.move) { ok = true; break; }
    if (!ok) { G.resultText = 'Engine error'; updateStatus(); return; }
    if (typeof res.score === 'number' && !res.book) {
      G.lastScore = G.pos.side === Chess.WHITE ? res.score : -res.score;
      setEvalBar($('evalbar'), G.lastScore, board.flipped);
    }
    applyMove(res.move);
  });
}

function checkOver() {
  var out = Chess.outcome(G.pos);
  if (!out) return false;
  var loser = G.pos.side;
  var text, result, score;
  if (out === 'checkmate') {
    var playerWon = loser !== G.playerColor;
    result = loser === Chess.WHITE ? '0-1' : '1-0';
    text = playerWon ? 'You win by checkmate' : 'Checkmate — Gambit wins';
    score = playerWon ? 1 : 0;
  } else {
    result = '1/2-1/2'; score = 0.5;
    text = out === 'stalemate' ? 'Draw by stalemate'
         : out === 'fifty' ? 'Draw by the fifty-move rule'
         : out === 'repetition' ? 'Draw by threefold repetition'
         : 'Draw — not enough material to mate';
  }
  finishGame(result, text, score);
  return true;
}

function finishGame(result, text, score) {
  G.over = true;
  G.result = result;
  G.resultText = text;
  board.setFrozen(true);
  $('coach-card').hidden = true;
  if (score === 1) Sound.win(); else if (score === 0) Sound.lose();

  var detail;
  if (G.coached) {
    detail = 'Played with the coach on, so your rating is unchanged — it would ' +
             'not be your rating. Review it anyway; the mistakes still count.';
  } else {
    var newRating = Store.recordResult(score, G.elo);
    var rec = Store.record();
    detail = 'Your rating is now ' + newRating +
      ' (' + rec.w + 'W ' + rec.d + 'D ' + rec.l + 'L). ' +
      'Reviewing the game is where the improvement actually happens.';
  }
  var game = serializeGame();
  game.result = result;
  game.resultText = text;
  game.finishedAt = new Date().toISOString();
  Store.addGame(game);
  $('result-title').textContent = text;
  $('result-detail').textContent = detail;
  $('result-card').hidden = false;
  updateStatus();
  renderGameList();
}

function serializeGame() {
  return {
    id: G.id, startFen: G.startFen,
    uci: G.moves.map(Chess.moveToUci),
    sans: G.sans.slice(),
    playerColor: G.playerColor === Chess.WHITE ? 'w' : 'b',
    elo: G.elo, startedAt: G.startedAt, coached: !!G.coached,
    result: G.result, resultText: G.resultText
  };
}

function restoreGame(saved) {
  var pos = Chess.fromFen(saved.startFen);
  var moves = [], sans = [];
  for (var i = 0; i < saved.uci.length; i++) {
    var m = Chess.sanToMove(pos, saved.uci[i]);
    if (!m) break;
    sans.push(Chess.moveToSan(pos, m));
    moves.push(m);
    Chess.makeMove(pos, m);
  }
  return {
    id: saved.id, startFen: saved.startFen, pos: pos, moves: moves, sans: sans,
    playerColor: saved.playerColor === 'w' ? Chess.WHITE : Chess.BLACK,
    elo: saved.elo, startedAt: saved.startedAt, coached: !!saved.coached,
    result: saved.result || null, over: !!saved.result, lastScore: 0
  };
}

function toPgn(saved) {
  var d = (saved.finishedAt || saved.startedAt || '').slice(0, 10).replace(/-/g, '.');
  var white = saved.playerColor === 'w' ? 'You' : 'Gambit ' + saved.elo;
  var black = saved.playerColor === 'w' ? 'Gambit ' + saved.elo : 'You';
  var head = '[Event "Gambit"]\n[Date "' + (d || '????.??.??') + '"]\n[White "' + white +
             '"]\n[Black "' + black + '"]\n[Result "' + (saved.result || '*') + '"]\n';
  if (saved.startFen !== Chess.START_FEN) head += '[SetUp "1"]\n[FEN "' + saved.startFen + '"]\n';
  var body = '', sans = saved.sans || [];
  for (var i = 0; i < sans.length; i++) {
    if (i % 2 === 0) body += (i / 2 + 1) + '. ';
    body += sans[i] + ' ';
  }
  return head + '\n' + body + (saved.result || '*') + '\n';
}

/* -------------------------------------------------------- play controls */

function bindPlay() {
  on($('btn-coach-back'), 'click', function () { dismissCoach(false); });
  on($('btn-coach-go'), 'click', function () { dismissCoach(true); });
  on($('sel-level'), 'change', function () {
    Store.setSetting('elo', +this.value);
    updateLevelNote();
  });
  $('seg-color').addEventListener('click', function (e) {
    var b = e.target.closest('[data-color]');
    if (!b) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('on'); });
    b.classList.add('on');
    Store.setSetting('playAs', b.dataset.color);
  });
  on($('btn-new-game'), 'click', function () {
    newGame({ color: Store.settings().playAs, elo: +$('sel-level').value });
  });
  on($('btn-resume'), 'click', function () {
    var saved = Store.getCurrent();
    if (!saved) return;
    G = restoreGame(saved);
    showGame();
  });
  on($('btn-abandon'), 'click', function () {
    Store.clearCurrent();
    renderSetup();
  });
  on($('btn-play-again'), 'click', function () {
    newGame({ color: Store.settings().playAs, elo: G ? G.elo : Store.settings().elo });
  });
  on($('btn-review-now'), 'click', function () {
    var id = G && G.id;
    goTab('review');
    if (id) openReview(id);
  });
  on($('btn-flip'), 'click', function () {
    board.setFlipped(!board.flipped);
    setEvalBar($('evalbar'), G ? G.lastScore || 0 : 0, board.flipped);
  });
  on($('btn-resign'), 'click', function () {
    if (!G || G.over) return;
    if (!confirm('Resign this game?')) return;
    finishGame(G.playerColor === Chess.WHITE ? '0-1' : '1-0', 'You resigned', 0);
  });
  on($('btn-takeback'), 'click', function () {
    if (!G || G.over || thinking) return;
    var n = 0;
    while (G.moves.length && n < 2) {
      Chess.unmakeMove(G.pos);
      G.moves.pop(); G.sans.pop();
      n++;
      if (G.pos.side === G.playerColor) break;
    }
    board.lastMove = G.moves.length
      ? { from: Chess.mFrom(G.moves[G.moves.length - 1]), to: Chess.mTo(G.moves[G.moves.length - 1]) }
      : null;
    board.setArrows([]);
    board.render();
    renderMoveList();
    Store.setCurrent(serializeGame());
    updateStatus();
  });
  on($('btn-hint'), 'click', function () {
    if (!G || G.over || thinking || G.pos.side !== G.playerColor) return;
    $('game-status').textContent = 'Looking…';
    Eng.request({ type: 'eval', fen: Chess.toFen(G.pos), time: 1200 }).then(function (r) {
      if (!r.move) { updateStatus(); return; }
      board.setArrows([{ from: Chess.mFrom(r.move), to: Chess.mTo(r.move) }]);
      $('game-status').textContent = 'Try the highlighted move';
    });
  });
}

function renderSetup() {
  $('play-setup').hidden = false;
  $('play-game').hidden = true;
  var saved = Store.getCurrent();
  var card = $('card-resume');
  if (saved && saved.uci && !saved.result) {
    card.hidden = false;
    $('resume-note').textContent = 'You are ' + (saved.playerColor === 'w' ? 'White' : 'Black') +
      ' against Gambit ' + saved.elo + ', ' + Math.ceil(saved.uci.length / 2) + ' moves in.';
  } else card.hidden = true;

  var r = Store.record(), n = Store.ratingGames();
  $('stat-rating').textContent = n ? Store.rating() : '—';
  $('stat-record').textContent = n
    ? r.w + ' won, ' + r.d + ' drawn, ' + r.l + ' lost. Beating a level above you moves this a lot; beating one below barely registers.'
    : 'No games yet. Your rating moves as you win and lose against the levels.';

  var seg = $('seg-color'), want = Store.settings().playAs;
  Array.prototype.forEach.call(seg.children, function (c) {
    c.classList.toggle('on', c.dataset.color === want);
  });
  $('sel-level').value = Store.settings().elo;
  updateLevelNote();
}

/* ========================================================== REVIEW SCREEN */

var revBoard = null;
var RV = null;   /* { game, result, index, positions[], flipped } */

function renderGameList() {
  var list = $('gamelist');
  var games = Store.games();
  list.innerHTML = '';
  $('gamelist-empty').hidden = games.length > 0;
  games.forEach(function (g) {
    var li = el('li');
    var btn = el('button', 'open');
    var youWhite = g.playerColor === 'w';
    var outcome = g.result === '1/2-1/2' ? 'Draw'
      : (g.result === '1-0') === youWhite ? 'Won' : 'Lost';
    var top = el('div', 'g-top');
    top.appendChild(el('span', null, outcome + ' vs Gambit ' + g.elo));
    if (g.review && g.review.accuracy) {
      var acc = youWhite ? g.review.accuracy.white : g.review.accuracy.black;
      top.appendChild(el('span', null, acc.toFixed(0) + '%'));
    }
    btn.appendChild(top);
    btn.appendChild(el('div', 'g-sub',
      (g.sans ? Math.ceil(g.sans.length / 2) : 0) + ' moves · ' +
      new Date(g.finishedAt || g.startedAt).toLocaleDateString() +
      (g.coached ? ' · coached' : '') +
      (g.review ? '' : ' · not analysed')));
    btn.onclick = function () { openReview(g.id); };
    li.appendChild(btn);
    var del = el('button', 'del', '×');
    del.setAttribute('aria-label', 'Delete game');
    del.onclick = function () {
      if (!confirm('Delete this game?')) return;
      Store.deleteGame(g.id);
      renderGameList();
    };
    li.appendChild(del);
    list.appendChild(li);
  });
}

function openReview(id) {
  var g = Store.gameById(id);
  if (!g) { showReviewPane('picker'); return; }
  if (g.review && g.review.moves) {
    Store.harvestReview(g, g.review);
    updateTrainBadge();
    startReviewView(g, g.review);
    return;
  }
  runAnalysis(g);
}

var reviewCancelled = false;

function runAnalysis(g) {
  showReviewPane('progress');
  reviewCancelled = false;
  $('review-bar').style.width = '0%';
  var pos = Chess.fromFen(g.startFen), moves = [];
  (g.uci || []).forEach(function (u) {
    var m = Chess.sanToMove(pos, u);
    if (m) { moves.push(m); Chess.makeMove(pos, m); }
  });
  if (!moves.length) {
    $('review-progress-note').textContent = 'This game has no moves to analyse.';
    return;
  }
  $('review-progress-note').textContent = 'Looking at all ' + (moves.length + 1) + ' positions.';
  Eng.request({
    type: 'review', fen: g.startFen, moves: moves, time: Store.settings().reviewTime
  }, function (p) {
    $('review-bar').style.width = Math.round(p.done / p.total * 100) + '%';
    $('review-progress-note').textContent = 'Position ' + p.done + ' of ' + p.total + '.';
  }).then(function (res) {
    if (reviewCancelled || !res.result) return;
    Store.attachReview(g.id, res.result);
    /* Harvest before the trimming ever gets a chance to reach this game: the
       mistakes are the part worth keeping past the five-review window. */
    var got = Store.harvestReview(g, res.result);
    updateTrainBadge();
    renderGameList();
    startReviewView(g, res.result);
    if (got && got.added) {
      showBanner(got.added + ' position' + (got.added === 1 ? '' : 's') +
        ' added to your training deck.', 'Train', function () {
        hideBanner();
        goTab('train');
      });
    }
  });
}

function showReviewPane(which) {
  $('review-picker').hidden = which !== 'picker';
  $('review-progress').hidden = which !== 'progress';
  $('review-view').hidden = which !== 'view';
  $('btn-review-back').hidden = which === 'picker';
  $('btn-review-share').hidden = which !== 'view';
}

function startReviewView(game, result) {
  var positions = [], pos = Chess.fromFen(game.startFen);
  positions.push(Chess.toFen(pos));
  var moves = [];
  (game.uci || []).forEach(function (u) {
    var m = Chess.sanToMove(pos, u);
    if (!m) return;
    moves.push(m);
    Chess.makeMove(pos, m);
    positions.push(Chess.toFen(pos));
  });

  RV = {
    game: game, result: result, moves: moves, positions: positions,
    index: 0, flipped: game.playerColor === 'b', showingBest: false
  };
  showReviewPane('view');

  if (!revBoard) revBoard = new Board($('review-board'), { interactive: false });
  revBoard.showCoords = Store.settings().coords;
  revBoard.el.classList.toggle('nocoords', !Store.settings().coords);
  revBoard.setFlipped(RV.flipped);

  /* The board is oriented with you at the bottom, so the labels follow the
     board rather than the colours. */
  $('rev-top').querySelector('.pname').textContent = 'Gambit ' + game.elo;
  $('rev-bot').querySelector('.pname').textContent = 'You';

  renderAccuracy();
  renderReviewList();
  renderEvalGraph();
  gotoPly(Math.min(1, moves.length));
}

function renderAccuracy() {
  var row = $('accuracy-row');
  row.innerHTML = '';
  var youWhite = RV.game.playerColor === 'w';
  var acc = RV.result.accuracy;
  var counts = youWhite ? RV.result.counts.white : RV.result.counts.black;

  function box(label, value, sub, mine) {
    var b = el('div', 'acc-box' + (mine ? ' you' : ''));
    b.appendChild(el('div', 'lbl', label));
    b.appendChild(el('div', 'val', value));
    b.appendChild(el('div', 'sub', sub));
    return b;
  }
  var mistakes = (counts.inaccuracy || 0) + (counts.mistake || 0) + (counts.blunder || 0);
  row.appendChild(box('Your accuracy', (youWhite ? acc.white : acc.black).toFixed(0) + '%',
    mistakes ? mistakes + ' move' + (mistakes === 1 ? '' : 's') + ' to look at' : 'nothing to fix', true));
  row.appendChild(box('Gambit', (youWhite ? acc.black : acc.white).toFixed(0) + '%',
    'level ' + RV.game.elo, false));

  var parts = [];
  ['blunder', 'mistake', 'inaccuracy', 'brilliant', 'great'].forEach(function (k) {
    if (counts[k]) parts.push(counts[k] + ' ' + Review.CLASSES[k].label.toLowerCase() +
      (counts[k] > 1 && k !== 'brilliant' ? 's' : ''));
  });
  if (parts.length) {
    var b = el('div', 'acc-box');
    b.appendChild(el('div', 'lbl', 'Your moves'));
    b.appendChild(el('div', 'sub', parts.join(', ')));
    row.appendChild(b);
  }
}

function renderReviewList() {
  var list = $('review-movelist');
  list.innerHTML = '';
  var mv = RV.result.moves;
  for (var i = 0; i < mv.length; i += 2) {
    list.appendChild(el('div', 'num', (i / 2 + 1) + '.'));
    list.appendChild(moveButton(mv[i], i));
    if (mv[i + 1]) list.appendChild(moveButton(mv[i + 1], i + 1));
    else list.appendChild(el('span'));
  }
}
function moveButton(info, ply) {
  var b = el('button', 'mv ' + info.cls);
  b.appendChild(document.createTextNode(info.san));
  if (info.symbol) {
    var s = el('span', 'sym', info.symbol);
    b.appendChild(s);
  }
  b.dataset.ply = ply;
  b.onclick = function () { gotoPly(ply + 1); };
  return b;
}

function renderEvalGraph() {
  var svg = $('evalgraph');
  var mv = RV.result.moves;
  var W = 300, H = 70, mid = H / 2;
  if (!mv.length) { svg.innerHTML = ''; return; }
  var pts = ['0,' + mid];
  var youWhite = RV.game.playerColor === 'w';
  for (var i = 0; i < mv.length; i++) {
    var cp = mv[i].scoreAfter;
    if (cp > Engine.MATE - 1000) cp = 1200;
    if (cp < -Engine.MATE + 1000) cp = -1200;
    /* Draw in win-percentage space: a 3-pawn edge should look decisive and a
       9-pawn edge should not dwarf it off the top of the chart. */
    var y = H - (Review.winPct(cp) / 100) * H;
    var x = (i + 1) / mv.length * W;
    pts.push(x.toFixed(1) + ',' + y.toFixed(1));
  }
  var area = pts.join(' ') + ' ' + W + ',' + H + ' 0,' + H;
  var marks = '';
  for (i = 0; i < mv.length; i++) {
    var m = mv[i];
    if (m.cls !== 'blunder' && m.cls !== 'mistake') continue;
    if ((m.side === 'white') !== youWhite) continue;
    var mx = (i + 1) / mv.length * W;
    marks += '<circle class="eg-mark" cx="' + mx.toFixed(1) + '" cy="' + mid +
             '" r="3.2" fill="' + (m.cls === 'blunder' ? 'var(--bad)' : '#d2691e') + '"/>';
  }
  var cursorX = (RV.index / Math.max(1, mv.length)) * W;
  svg.innerHTML =
    '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="none"/>' +
    '<polygon class="eg-area" points="' + area + '"/>' +
    '<line class="eg-mid" x1="0" y1="' + mid + '" x2="' + W + '" y2="' + mid + '"/>' +
    marks +
    '<line class="eg-cursor" x1="' + cursorX.toFixed(1) + '" y1="0" x2="' + cursorX.toFixed(1) + '" y2="' + H + '"/>';
}

function gotoPly(index) {
  if (!RV) return;
  if (AN && index !== RV.index) stopExplore();
  index = Math.max(0, Math.min(RV.positions.length - 1, index));
  RV.index = index;
  RV.showingBest = false;
  var lastMove = index > 0
    ? { from: Chess.mFrom(RV.moves[index - 1]), to: Chess.mTo(RV.moves[index - 1]) }
    : null;
  revBoard.setPosition(RV.positions[index], lastMove);
  revBoard.setFlipped(RV.flipped);
  revBoard.setArrows([]);

  var info = index > 0 ? RV.result.moves[index - 1] : null;
  setEvalBar($('rev-evalbar'), info ? info.scoreAfter : 0, RV.flipped);
  renderVerdict(info);

  var btns = $('review-movelist').querySelectorAll('.mv');
  Array.prototype.forEach.call(btns, function (b) {
    b.classList.toggle('on', +b.dataset.ply === index - 1);
  });
  var cur = $('review-movelist').querySelector('.mv.on');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
  renderEvalGraph();
}

function renderVerdict(info) {
  var v = $('verdict');
  v.innerHTML = '';
  if (!info) {
    v.appendChild(el('div', 'vnote', 'Starting position. Step forward through the game, or tap a move.'));
    return;
  }
  var head = el('div', 'vhead');
  var num = info.moveNumber + (info.side === 'white' ? '.' : '…');
  head.appendChild(el('span', 'vmove', num + ' ' + info.san));
  head.appendChild(el('span', 'tone-' + info.tone, info.label));
  if (info.openingName) head.appendChild(el('span', 'vnote', info.openingName));
  v.appendChild(head);
  v.appendChild(el('div', 'vnote', info.note));

  if (info.bestLineSan && info.bestLineSan.length && info.cls !== 'book') {
    var line = el('div', 'vline', 'Best: ' + info.bestLineSan.slice(0, 5).join(' '));
    v.appendChild(line);
  }
  if (!info.best || info.move === info.best || info.cls === 'book') return;

  var btn = el('button', 'ghost', 'Show the better move');
  btn.onclick = function () {
    RV.showingBest = !RV.showingBest;
    if (RV.showingBest) {
      revBoard.setPosition(info.fenBefore, null);
      revBoard.setFlipped(RV.flipped);
      revBoard.setArrows([
        { from: Chess.mFrom(info.move), to: Chess.mTo(info.move), cls: 'alt' },
        { from: Chess.mFrom(info.best), to: Chess.mTo(info.best) }
      ]);
      btn.textContent = 'Back to the game';
    } else {
      gotoPly(RV.index);
    }
  };
  v.appendChild(btn);
}


/* ------------------------------------------------------------- analysis */

/* The same board in a different mode: move the pieces yourself from any
   position in the game and the engine says what it makes of the result. The
   game itself is untouched — leaving analysis puts everything back. */

var AN = null;   /* { base, moves[], sans[] } */

function analysisOn() { return !!AN; }

function startExplore() {
  if (!RV) return;
  AN = { base: RV.positions[RV.index], moves: [], sans: [] };
  $('analysis').hidden = false;
  $('btn-rev-explore').textContent = 'Stop exploring';
  revBoard.interactive = true;
  revBoard.onMove = onAnalysisMove;
  revBoard.setFrozen(false);
  revBoard.setArrows([]);
  revBoard.setPosition(AN.base, null);
  renderAnalysis();
  evaluateAnalysis();
  /* The panel sits under the board, which on a phone can still be just below
     the fold. Bring it into view rather than leaving the button looking dead. */
  try { $('analysis').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
}

function stopExplore() {
  AN = null;
  $('analysis').hidden = true;
  $('btn-rev-explore').textContent = 'Explore this position';
  revBoard.interactive = false;
  revBoard.onMove = function () {};
  gotoPly(RV.index);
}

function analysisFen() {
  var p = Chess.fromFen(AN.base);
  AN.moves.forEach(function (m) { Chess.makeMove(p, m); });
  return Chess.toFen(p);
}

function renderAnalysis() {
  var line = $('analysis-line');
  if (!AN.sans.length) {
    line.textContent = 'Move a piece to try an idea. Nothing here changes the game.';
    return;
  }
  /* Number the variation from wherever in the game it started. */
  var startPly = RV.index, out = [], i;
  for (i = 0; i < AN.sans.length; i++) {
    var ply = startPly + i;
    var num = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) out.push(num + '. ' + AN.sans[i]);
    else out.push(i === 0 ? num + '… ' + AN.sans[i] : AN.sans[i]);
  }
  line.textContent = out.join(' ');
}

function evaluateAnalysis() {
  if (!AN) return;
  var fen = analysisFen();
  var pos = Chess.fromFen(fen);
  var over = Chess.outcome(pos);
  if (over) {
    $('analysis-eval').textContent = over === 'checkmate'
      ? (pos.side === Chess.WHITE ? '0–1' : '1–0') : '½–½';
    $('analysis-best').textContent = over === 'checkmate' ? 'Checkmate.' : 'The game ends here: ' + over + '.';
    return;
  }
  $('analysis-eval').textContent = '…';
  $('analysis-best').textContent = '';
  var token = AN;
  Eng.request({ type: 'eval', fen: fen, time: 700 }).then(function (res) {
    if (AN !== token || !AN) return;
    var white = pos.side === Chess.WHITE ? res.score : -res.score;
    var mate = Review.mateIn(res.score);
    $('analysis-eval').textContent = mate !== null
      ? (pos.side === Chess.WHITE ? '' : '-') + 'M' + Math.abs(mate)
      : (white > 0 ? '+' : '') + (white / 100).toFixed(1);
    AN.best = res.move;
    $('analysis-best').textContent = res.move
      ? 'Best here: ' + ((res.pvSan && res.pvSan.length) ? res.pvSan.slice(0, 4).join(' ') : res.san)
      : '';
    setEvalBar($('rev-evalbar'), white, RV.flipped);
  });
}

function onAnalysisMove(m) {
  if (!AN) return;
  var san = Chess.moveToSan(revBoard.pos, m);
  AN.moves.push(m);
  AN.sans.push(san);
  AN.best = 0;
  Sound.move();
  revBoard.animateMove(m, function () {
    renderAnalysis();
    evaluateAnalysis();
  });
}

function undoAnalysis() {
  if (!AN || !AN.moves.length) return;
  AN.moves.pop();
  AN.sans.pop();
  AN.best = 0;
  var last = AN.moves.length ? AN.moves[AN.moves.length - 1] : null;
  revBoard.setPosition(analysisFen(),
    last ? { from: Chess.mFrom(last), to: Chess.mTo(last) } : null);
  renderAnalysis();
  evaluateAnalysis();
}

function playAnalysisBest() {
  if (!AN) return;
  if (AN.best) { onAnalysisMove(AN.best); return; }
  $('analysis-best').textContent = 'Working it out…';
  Eng.request({ type: 'eval', fen: analysisFen(), time: 700 }).then(function (res) {
    if (!AN || !res.move) return;
    onAnalysisMove(res.move);
  });
}

function jumpToMistake() {
  if (!RV) return;
  var youWhite = RV.game.playerColor === 'w';
  var mv = RV.result.moves;
  for (var step = 1; step <= mv.length; step++) {
    var i = (RV.index - 1 + step + mv.length) % mv.length;
    var m = mv[i];
    if ((m.side === 'white') !== youWhite) continue;
    if (m.cls === 'blunder' || m.cls === 'mistake' || m.cls === 'inaccuracy') {
      gotoPly(i + 1);
      return;
    }
  }
  $('verdict').appendChild(el('div', 'vnote', 'No inaccuracies, mistakes or blunders in this game.'));
}

function bindReview() {
  on($('btn-review-back'), 'click', function () {
    if (analysisOn()) stopExplore();
    showReviewPane('picker');
    renderGameList();
  });
  on($('btn-rev-first'), 'click', function () { gotoPly(0); });
  on($('btn-rev-prev'), 'click', function () { gotoPly(RV.index - 1); });
  on($('btn-rev-next'), 'click', function () { gotoPly(RV.index + 1); });
  on($('btn-rev-last'), 'click', function () { gotoPly(RV.positions.length - 1); });
  on($('btn-rev-flip'), 'click', function () {
    RV.flipped = !RV.flipped;
    revBoard.setFlipped(RV.flipped);
    var info = RV.index > 0 ? RV.result.moves[RV.index - 1] : null;
    setEvalBar($('rev-evalbar'), info ? info.scoreAfter : 0, RV.flipped);
  });
  on($('btn-rev-mistakes'), 'click', jumpToMistake);
  on($('btn-rev-explore'), 'click', function () {
    if (!RV) return;
    if (analysisOn()) stopExplore(); else startExplore();
  });
  on($('btn-an-undo'), 'click', undoAnalysis);
  on($('btn-an-best'), 'click', playAnalysisBest);
  on($('btn-an-exit'), 'click', stopExplore);
  on($('btn-rev-play'), 'click', function () {
    if (!RV) return;
    var fen = analysisOn() ? analysisFen() : RV.positions[RV.index];
    var side = Chess.fromFen(fen).side;
    if (analysisOn()) stopExplore();
    goTab('play');
    newGame({ fen: fen, color: side === Chess.WHITE ? 'w' : 'b', elo: RV.game.elo });
  });
  on($('btn-review-cancel'), 'click', function () {
    reviewCancelled = true;
    Eng.reset();
    showReviewPane('picker');
  });
  on($('btn-review-share'), 'click', function () {
    if (!RV) return;
    var pgn = toPgn(RV.game);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(pgn).then(function () {
        $('btn-review-share').textContent = 'copied';
        setTimeout(function () { $('btn-review-share').textContent = 'PGN'; }, 1400);
      }, function () { prompt('PGN', pgn); });
    } else prompt('PGN', pgn);
  });
  document.addEventListener('keydown', function (e) {
    if ($('screen-review').hidden || $('review-view').hidden) return;
    if (analysisOn()) return;
    if (e.key === 'ArrowLeft') { gotoPly(RV.index - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { gotoPly(RV.index + 1); e.preventDefault(); }
  });
}


/* =========================================================== TRAIN SCREEN */

/* Two things live here, and they come from the same place: the positions you
   actually got wrong. The trainer serves them back on a spacing schedule, and
   the report counts what they have in common. Neither invents a syllabus — the
   only material is your own games. */

var puzBoard = null;
var PZ = null;   /* { queue, i, q, tries, assisted, settled, right } */

function updateTrainBadge() {
  var b = $('tab-badge');
  if (!b) return;
  var n = Store.puzzleSummary().due;
  b.hidden = n === 0;
  b.textContent = n > 99 ? '99+' : String(n);
}

function statBox(label, value) {
  var d = el('div', 'acc-box');
  d.appendChild(el('div', 'lbl', label));
  d.appendChild(el('div', 'val', String(value)));
  return d;
}

function renderTrainIndex() {
  var sum = Store.puzzleSummary();
  var counts = $('train-counts');
  counts.innerHTML = '';
  counts.appendChild(statBox('Due now', sum.due));
  counts.appendChild(statBox('Collected', sum.total));
  counts.appendChild(statBox('Mastered', sum.mastered));

  var btn = $('btn-train-start');
  btn.disabled = sum.total === 0;
  btn.textContent = sum.due ? 'Train ' + sum.due + ' position' + (sum.due === 1 ? '' : 's')
    : sum.total ? 'Practise anyway' : 'Start training';

  $('train-summary').textContent = sum.total
    ? 'Every mistake you make in a reviewed game is kept here and served back until you stop making it.'
    : 'Review a game and the positions you got wrong are kept here as puzzles.';

  renderWeakness();
  updateTrainBadge();
}

function weakBar(label, value, share, sub) {
  var row = el('div', 'weak-row');
  var head = el('div', 'weak-head');
  head.appendChild(el('span', 'weak-lbl', label));
  head.appendChild(el('span', 'weak-val', value));
  row.appendChild(head);
  var track = el('div', 'weak-track');
  var fill = el('div', 'weak-fill');
  fill.style.width = Math.max(3, Math.round(share * 100)) + '%';
  track.appendChild(fill);
  row.appendChild(track);
  if (sub) row.appendChild(el('div', 'weak-sub', sub));
  return row;
}

function renderWeakness() {
  var st = Store.stats(), wrap = $('weak-report');
  wrap.innerHTML = '';
  if (!st.myMoves) { $('weak-empty').hidden = false; return; }
  $('weak-empty').hidden = true;

  wrap.appendChild(el('p', 'hint',
    st.reviewed + ' reviewed game' + (st.reviewed === 1 ? '' : 's') + ', ' + st.myMoves +
    ' of your moves, ' + (st.accSum / st.myMoves).toFixed(1) + '% average accuracy.'));

  /* Ranked by centipawns lost, not by how often it happens: hanging a queen
     twice matters more than twenty slightly loose pawn moves. */
  var motifs = Object.keys(st.motifs).map(function (k) {
    return { key: k, n: st.motifs[k].n, cp: st.motifs[k].cp };
  }).sort(function (a, b) { return b.cp - a.cp; });

  if (motifs.length) {
    wrap.appendChild(el('h3', 'sub', 'What your mistakes have in common'));
    var top = motifs[0].cp || 1;
    motifs.forEach(function (m) {
      var def = Review.MOTIFS[m.key] || { label: m.key, blurb: '' };
      wrap.appendChild(weakBar(def.label, m.n + '×  ' + (m.cp / 100).toFixed(1) + ' pawns',
        m.cp / top, def.blurb));
    });
  }

  var phases = ['opening', 'middlegame', 'endgame'].filter(function (k) {
    return st.phases[k] && st.phases[k].moves;
  });
  if (phases.length) {
    wrap.appendChild(el('h3', 'sub', 'Where in the game'));
    phases.forEach(function (k) {
      var ph = st.phases[k];
      var acc = ph.accSum / ph.moves;
      /* The bar shows inaccuracy against a fixed scale — full at 60% accurate —
         rather than against the other phases. Normalising against each other
         turned a two-point gap into two nearly-full bars, which said "you are
         equally bad everywhere" when the numbers said nothing of the kind. */
      wrap.appendChild(weakBar(Review.PHASES[k], acc.toFixed(1) + '% accurate',
        Math.min(1, (100 - acc) / 40),
        ph.n + ' tagged mistake' + (ph.n === 1 ? '' : 's') + ' over ' + ph.moves + ' moves'));
    });
  }

  var pieces = Object.keys(st.pieces).map(function (k) {
    return { key: k, n: st.pieces[k].n, cp: st.pieces[k].cp };
  }).sort(function (a, b) { return b.cp - a.cp; }).slice(0, 4);
  if (pieces.length) {
    wrap.appendChild(el('h3', 'sub', 'Which piece you were moving'));
    var pt = pieces[0].cp || 1;
    pieces.forEach(function (p) {
      var name = p.key.charAt(0).toUpperCase() + p.key.slice(1);
      wrap.appendChild(weakBar(name + ' moves', p.n + '×  ' + (p.cp / 100).toFixed(1) + ' pawns', p.cp / pt));
    });
  }

  if (Store.games().some(function (g) { return !g.review; })) {
    wrap.appendChild(el('p', 'hint', 'Games you have not analysed are not counted here.'));
  }
}

/* ------------------------------------------------------------- the trainer */

function showTrainPane(which) {
  $('train-index').hidden = which !== 'index';
  $('train-puzzle').hidden = which !== 'puzzle';
  $('btn-train-back').hidden = which === 'index';
  if (which === 'index') $('train-progress').textContent = '';
}

function startTraining() {
  var queue = Store.duePuzzles(20);
  if (!queue.length) {
    queue = Store.puzzles().slice().sort(function (a, b) {
      return (a.box - b.box) || (b.cpLoss - a.cpLoss);
    }).slice(0, 10);
  }
  if (!queue.length) return;
  PZ = { queue: queue, i: 0, right: 0 };
  showTrainPane('puzzle');
  showPuzzle();
}

function showPuzzle() {
  var q = PZ.queue[PZ.i];
  PZ.q = q; PZ.tries = 0; PZ.assisted = false; PZ.settled = false;

  var pos = Chess.fromFen(q.fen);
  var toMove = pos.side === Chess.WHITE ? 'White' : 'Black';

  if (!puzBoard) puzBoard = new Board($('puzzle-board'), { onMove: onPuzzleMove });
  puzBoard.showCoords = Store.settings().coords;
  puzBoard.el.classList.toggle('nocoords', !Store.settings().coords);
  puzBoard.setFlipped(pos.side === Chess.BLACK);
  puzBoard.setArrows([]);
  puzBoard.setFrozen(false);
  puzBoard.setPosition(q.fen, null);

  $('puz-top').querySelector('.pname').textContent = 'From one of your games';
  $('puz-bot').querySelector('.pname').textContent = toMove + ' to play — you';
  $('train-progress').textContent = (PZ.i + 1) + ' of ' + PZ.queue.length;
  $('btn-puz-next').hidden = true;
  ['btn-puz-hint', 'btn-puz-show', 'btn-puz-skip'].forEach(function (id) { $(id).hidden = false; });

  var v = $('puzzle-prompt');
  v.innerHTML = '';
  var head = el('div', 'vhead');
  head.appendChild(el('span', 'vmove', 'Find the move'));
  if (q.box > 0) head.appendChild(el('span', 'vnote', 'seen ' + q.attempts + '×'));
  v.appendChild(head);
  v.appendChild(el('div', 'vnote', 'You played ' + q.playedSan + ' here. Something was better.'));
}

function puzzleFeedback(kind, headline, lines) {
  var v = $('puzzle-prompt');
  v.innerHTML = '';
  var head = el('div', 'vhead');
  head.appendChild(el('span', 'vmove', headline));
  head.appendChild(el('span', 'tone-' + kind, kind === 'best' ? 'Correct' : 'Not it'));
  v.appendChild(head);
  (lines || []).forEach(function (t) { if (t) v.appendChild(el('div', 'vnote', t)); });
}

function onPuzzleMove(m) {
  if (!PZ || PZ.settled) return;
  var san = Chess.moveToSan(puzBoard.pos, m);
  if (Chess.moveToUci(m) === PZ.q.solution) { settlePuzzle(true, m, san, false); return; }

  /* The stored solution is one good move, not proof that nothing else works.
     Asking the engine before calling an answer wrong is the difference between
     training and pattern-matching the answer key. */
  PZ.tries++;
  puzBoard.setFrozen(true);
  puzzleFeedback('best', san, ['Checking whether that works too…']);
  Eng.request({ type: 'probe', fen: PZ.q.fen, move: m, time: 450, depth: 12 }).then(function (res) {
    if (!PZ || PZ.settled) return;
    puzBoard.setFrozen(false);
    var played = res.playedScore;
    var loss = (played === null || played === undefined) ? 9999 : (res.bestScore - played);
    if (loss <= 30) { settlePuzzle(true, m, san, true); return; }

    var lines = [];
    if (res.punish && res.punish.piece) {
      lines.push(san + ' loses the ' + res.punish.piece + ' on ' + res.punish.square +
                 ' to ' + res.punish.san + '.');
    } else if (res.punish) {
      lines.push('After ' + san + ', ' + res.punish.san + ' is the reply.');
    }
    if (loss < 9000) lines.push('That is ' + (loss / 100).toFixed(1) + ' pawns worse than the best move.');
    if (PZ.tries >= 2) lines.push('Hint: ' + hintText(PZ.q));
    lines.push('Try again, or tap Show me.');
    puzzleFeedback('blunder', san, lines);
    puzBoard.setPosition(PZ.q.fen, null);
    haptic(20);
  });
}

function hintText(q) {
  var pos = Chess.fromFen(q.fen);
  var from = Chess.nameToSq(q.solution.slice(0, 2));
  var piece = pos.board[from];
  var names = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
  if (!piece) return 'look for a forcing move.';
  return 'move the ' + names[Chess.typeOf(piece)] + ' on ' + q.solution.slice(0, 2) + '.';
}

function settlePuzzle(correct, move, san, alternative) {
  PZ.settled = true;
  /* Credit only for finding it first time unaided — anything else and the
     position comes back, which is the whole point of keeping it. */
  var clean = correct && PZ.tries === 0 && !PZ.assisted;
  Store.gradePuzzle(PZ.q.id, clean);
  if (clean) PZ.right++;
  updateTrainBadge();

  puzBoard.setFrozen(true);
  puzBoard.animateMove(move, function () {
    var q = PZ.q, lines = [];
    if (correct && alternative) lines.push(san + ' works as well as ' + q.solutionSan + '.');
    else if (correct) lines.push(q.note);
    else lines.push('The move was ' + q.solutionSan + '. ' + q.note);
    if (q.motifLabel) {
      var def = Review.MOTIFS[q.motif];
      lines.push(q.motifLabel + ' — ' + (def ? def.blurb : ''));
    }
    if (!clean) lines.push('Kept in the deck, so this one comes back.');
    puzzleFeedback(correct ? 'best' : 'blunder',
      correct ? (PZ.tries ? 'Found it' : 'Correct') : q.solutionSan, lines);
    if (correct) Sound.win(); else haptic(20);
    ['btn-puz-hint', 'btn-puz-show', 'btn-puz-skip'].forEach(function (id) { $(id).hidden = true; });
    var next = $('btn-puz-next');
    next.hidden = false;
    next.textContent = PZ.i + 1 < PZ.queue.length ? 'Next puzzle' : 'Finish';
  });
}

function nextPuzzle() {
  if (!PZ) return;
  PZ.i++;
  if (PZ.i >= PZ.queue.length) {
    var n = PZ.queue.length, right = PZ.right;
    PZ = null;
    showTrainPane('index');
    renderTrainIndex();
    $('train-summary').textContent = 'Session done — ' + right + ' of ' + n +
      ' first time. The ones you missed are due again straight away.';
    return;
  }
  showPuzzle();
}

function bindTrain() {
  on($('btn-train-start'), 'click', startTraining);
  on($('btn-train-back'), 'click', function () {
    PZ = null;
    showTrainPane('index');
    renderTrainIndex();
  });
  on($('btn-puz-next'), 'click', nextPuzzle);
  on($('btn-puz-skip'), 'click', function () {
    if (!PZ || PZ.settled) return;
    nextPuzzle();
  });
  on($('btn-puz-hint'), 'click', function () {
    if (!PZ || PZ.settled) return;
    PZ.tries++;
    puzzleFeedback('blunder', 'Hint', [
      'Try to ' + hintText(PZ.q),
      PZ.q.motifLabel ? 'The idea is a ' + PZ.q.motifLabel.toLowerCase() + ' pattern.' : ''
    ]);
  });
  on($('btn-puz-show'), 'click', function () {
    if (!PZ || PZ.settled) return;
    PZ.assisted = true;
    var pos = Chess.fromFen(PZ.q.fen);
    var mv = Chess.sanToMove(pos, PZ.q.solutionSan);
    if (!mv) { nextPuzzle(); return; }
    settlePuzzle(false, mv, PZ.q.solutionSan, false);
  });
}

/* =========================================================== LEARN SCREEN */

var lessonBoard = null;
var LS = null;  /* { lesson, step, tries, assisted, awaiting } */

function renderLearnIndex() {
  var wrap = $('learn-index');
  wrap.innerHTML = '';
  var done = Store.lessons();
  var total = Tutorials.LESSONS.length;
  var completed = Tutorials.LESSONS.filter(function (l) { return done[l.id]; }).length;
  $('learn-progress').textContent = completed + ' of ' + total + ' done';

  Tutorials.GROUPS.forEach(function (g) {
    var sec = el('div', 'group');
    sec.appendChild(el('h2', null, g.title));
    sec.appendChild(el('p', 'hint', g.blurb));
    Tutorials.byGroup(g.id).forEach(function (lesson) {
      var b = el('button', 'lesson-btn' + (done[lesson.id] ? ' done' : ''));
      var tick = el('span', 'tick', '✓');
      b.appendChild(tick);
      var txt = el('span');
      txt.appendChild(el('span', 'lb-title', lesson.title));
      txt.appendChild(el('br'));
      txt.appendChild(el('span', 'lb-blurb', lesson.blurb));
      b.appendChild(txt);
      b.onclick = function () { openLesson(lesson.id); };
      sec.appendChild(b);
    });
    wrap.appendChild(sec);
  });
}

function openLesson(id) {
  var lesson = Tutorials.byId(id);
  if (!lesson) return;
  LS = { lesson: lesson, step: 0, tries: 0, assisted: false, awaiting: false };
  $('learn-index').hidden = true;
  $('learn-lesson').hidden = false;
  if (!lessonBoard) lessonBoard = new Board($('lesson-board'), { onMove: onLessonMove });
  lessonBoard.showCoords = Store.settings().coords;
  lessonBoard.el.classList.toggle('nocoords', !Store.settings().coords);
  $('lesson-title').textContent = lesson.title;
  showStep();
}

function closeLesson() {
  LS = null;
  $('learn-lesson').hidden = true;
  $('learn-index').hidden = false;
  renderLearnIndex();
}

function stepExpects(step) {
  var list = step.accept ? step.accept.slice() : [];
  if (step.play && list.indexOf(step.play) < 0) list.push(step.play);
  return list;
}

function showStep() {
  var step = LS.lesson.steps[LS.step];
  LS.tries = 0;
  LS.assisted = false;
  LS.awaiting = false;

  lessonBoard.setPosition(step.fen, null);
  lessonBoard.setFlipped(!!step.flip);
  lessonBoard.setArrows((step.arrows || []).map(function (a) {
    return { from: Chess.nameToSq(a.slice(0, 2)), to: Chess.nameToSq(a.slice(2, 4)) };
  }));
  if (step.marks) {
    var marks = {};
    Object.keys(step.marks).forEach(function (sq) { marks[Chess.nameToSq(sq)] = step.marks[sq]; });
    lessonBoard.marks = marks;
    lessonBoard.renderMarks();
  }

  $('lesson-text').textContent = step.text || '';
  var fb = $('lesson-feedback');
  fb.textContent = ''; fb.className = 'lesson-feedback';

  var needsMove = stepExpects(step).length > 0;
  lessonBoard.setFrozen(!needsMove);
  $('btn-lesson-hint').hidden = !needsMove || !step.hint;
  $('btn-lesson-show').hidden = !needsMove;
  $('btn-lesson-next').hidden = needsMove;
  $('btn-lesson-next').textContent = LS.step === LS.lesson.steps.length - 1 ? 'Finish' : 'Continue';

  var dots = $('stepdots');
  dots.innerHTML = '';
  LS.lesson.steps.forEach(function (_, i) {
    dots.appendChild(el('i', i < LS.step ? 'past' : i === LS.step ? 'on' : ''));
  });
}

function onLessonMove(m) {
  if (!LS || LS.awaiting) return;
  var step = LS.lesson.steps[LS.step];
  var expects = stepExpects(step);
  if (!expects.length) return;
  var san = Chess.moveToSan(lessonBoard.pos, m);
  var fb = $('lesson-feedback');

  if (expects.indexOf(san) < 0) {
    LS.tries++;
    Sound.wrong();
    haptic(24);
    lessonBoard.reject(Chess.mTo(m));
    fb.className = 'lesson-feedback no';
    fb.textContent = LS.tries >= 2 && step.hint ? step.hint : 'Not that one — ' + san + ' is legal, but it is not the move. Try again.';
    return;
  }

  LS.awaiting = true;
  Sound.right();
  haptic(10);
  lessonBoard.setFrozen(true);
  lessonBoard.setArrows([]);
  lessonBoard.animateMove(m, function () {
    if (step.reply) {
      var rm = Chess.sanToMove(lessonBoard.pos, step.reply);
      if (rm) {
        setTimeout(function () {
          lessonBoard.animateMove(rm, finishStep);
        }, 380);
        return;
      }
    }
    finishStep();
  });

  function finishStep() {
    fb.className = 'lesson-feedback ok';
    fb.textContent = LS.assisted ? 'That is the move — try the next one without help.' : 'Correct.';
    $('lesson-text').textContent = step.done || step.text || '';
    $('btn-lesson-hint').hidden = true;
    $('btn-lesson-show').hidden = true;
    $('btn-lesson-next').hidden = false;
    LS.awaiting = false;
  }
}

function bindLearn() {
  on($('btn-lesson-back'), 'click', closeLesson);
  on($('btn-lesson-hint'), 'click', function () {
    var step = LS.lesson.steps[LS.step];
    var fb = $('lesson-feedback');
    fb.className = 'lesson-feedback';
    fb.textContent = step.hint || 'Look at what each piece attacks.';
  });
  on($('btn-lesson-show'), 'click', function () {
    var step = LS.lesson.steps[LS.step];
    var expects = stepExpects(step);
    if (!expects.length) return;
    var m = Chess.sanToMove(lessonBoard.pos, expects[0]);
    if (!m) return;
    LS.assisted = true;
    lessonBoard.setArrows([{ from: Chess.mFrom(m), to: Chess.mTo(m) }]);
    $('lesson-feedback').className = 'lesson-feedback';
    $('lesson-feedback').textContent = 'The move is ' + expects[0] + '. Play it to continue.';
  });
  on($('btn-lesson-next'), 'click', function () {
    if (LS.step >= LS.lesson.steps.length - 1) {
      Store.lessonDone(LS.lesson.id);
      closeLesson();
      return;
    }
    LS.step++;
    showStep();
  });
}

/* ============================================================= NAVIGATION */

function goTab(name) {
  if (name !== 'review' && analysisOn()) stopExplore();
  ['play', 'review', 'train', 'learn'].forEach(function (t) {
    $('screen-' + t).hidden = t !== name;
  });
  Array.prototype.forEach.call($('tabs').children, function (b) {
    b.classList.toggle('on', b.dataset.goto === name);
  });
  if (name === 'review') { renderGameList(); if (!RV) showReviewPane('picker'); }
  if (name === 'train' && !PZ) { showTrainPane('index'); renderTrainIndex(); }
  if (name === 'learn' && !LS) renderLearnIndex();
  if (name === 'play' && (!G || G.over)) renderSetup();
  window.scrollTo(0, 0);
}

/* ============================================================== SETTINGS */

function applyTheme() {
  var s = Store.settings();
  document.documentElement.setAttribute('data-theme', s.theme);
  document.documentElement.setAttribute('data-pieces', Pieces.use(s.pieces));
}

/* Redraw every board that exists — a piece set change has to reach the game,
   the review and whichever lesson happens to be open. */
function redrawBoards() {
  [board, revBoard, puzBoard, lessonBoard].forEach(function (b) { if (b) b.render(); });
}

/* The threshold only means anything while the coach is on, so it should not
   look like a live setting when it is off. */
function coachLevelEnabled(on_) {
  $('opt-coach-level').disabled = !on_;
  $('field-coach-level').classList.toggle('disabled', !on_);
}

function bindSettings() {
  var sheet = $('sheet-settings');
  on($('btn-settings'), 'click', function () {
    var s = Store.settings();
    $('opt-eval').checked = s.showEval;
    $('opt-coords').checked = s.coords;
    $('opt-sound').checked = s.sound;
    $('opt-confirm').checked = s.confirmMoves;
    $('opt-coach').checked = s.coach;
    $('opt-coach-level').value = String(s.coachLevel);
    coachLevelEnabled(s.coach);
    $('opt-review-depth').value = String(s.reviewTime);
    $('opt-theme').value = s.theme;
    $('opt-pieces').value = s.pieces;
    $('settings-version').textContent = 'Gambit · ' + Tutorials.LESSONS.length +
      ' lessons · everything stored on this device only';
    sheet.hidden = false;
  });
  on($('btn-settings-close'), 'click', function () { sheet.hidden = true; });
  on(sheet, 'click', function (e) { if (e.target === sheet) sheet.hidden = true; });

  on($('opt-eval'), 'change', function () {
    Store.setSetting('showEval', this.checked);
    $('evalbar').hidden = !this.checked;
  });
  on($('opt-coords'), 'change', function () {
    Store.setSetting('coords', this.checked);
    [board, revBoard, puzBoard, lessonBoard].forEach(function (b) {
      if (!b) return;
      b.showCoords = Store.settings().coords;
      b.el.classList.toggle('nocoords', !Store.settings().coords);
      b.render();
    });
  });
  on($('opt-sound'), 'change', function () { Store.setSetting('sound', this.checked); });
  on($('opt-confirm'), 'change', function () { Store.setSetting('confirmMoves', this.checked); });
  on($('opt-coach'), 'change', function () {
    Store.setSetting('coach', this.checked);
    coachLevelEnabled(this.checked);
    if (!this.checked) { coachPending = 0; $('coach-card').hidden = true; }
    updateStatus();
  });
  on($('opt-coach-level'), 'change', function () { Store.setSetting('coachLevel', +this.value); });
  on($('opt-review-depth'), 'change', function () { Store.setSetting('reviewTime', +this.value); });
  on($('opt-theme'), 'change', function () { Store.setSetting('theme', this.value); applyTheme(); });
  on($('opt-pieces'), 'change', function () {
    Store.setSetting('pieces', this.value);
    applyTheme();
    redrawBoards();
  });

  on($('btn-export'), 'click', function () {
    var blob = new Blob([Store.exportAll()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gambit-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });
  on($('btn-reset'), 'click', function () {
    if (!confirm('Delete every game, rating and lesson on this device? This cannot be undone.')) return;
    Store.resetAll();
    location.reload();
  });
}


/* ==================================================== install and updates */

/* Two jobs share one strip above the tab bar: offering the home-screen
   install, and telling you when a newer build has arrived. */
function showBanner(text, action, fn) {
  $('banner-text').textContent = text;
  var act = $('banner-act');
  act.textContent = action;
  act.onclick = fn;
  $('banner').hidden = false;
}
function hideBanner() { $('banner').hidden = true; }

/* Reloading under someone mid-game would lose the game, so an update waits
   until nothing is in progress. */
function midSomething() {
  return !!(G && !G.over && G.moves.length) || !!LS;
}

function setupInstallAndUpdates() {
  on($('banner-x'), 'click', hideBanner);

  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    /* Holding onto the event lets the offer live inside the app instead of
       buried in the browser's own menu, which is where people miss it. */
    e.preventDefault();
    deferred = e;
    showBanner('Install Gambit for an icon, fullscreen and offline play.', 'Install', function () {
      hideBanner();
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; });
    });
  });
  window.addEventListener('appinstalled', function () {
    deferred = null;
    hideBanner();
  });

  if (!('serviceWorker' in navigator)) return;

  /* A page that was already controlled and then gets a new controller means a
     new build took over — the first install also fires this, hence the guard. */
  var wasControlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!wasControlled) return;
    if (midSomething()) {
      showBanner('A new version is ready.', 'Reload', function () { location.reload(); });
    } else {
      /* Nothing to lose, so just take it. */
      location.reload();
    }
  });

  /* Ask the browser to look for a new build whenever the app is reopened,
     rather than only on a cold start. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (reg) reg.update();
    }).catch(function () {});
  });
}

/* =================================================================== init */

function init() {
  /* The store keeps puzzles as UCI strings but never loads the rules engine,
     so hand it the converter it needs. */
  Store.useUci(Chess.moveToUci);
  applyTheme();
  levelOptions();
  bindPlay();
  bindReview();
  bindTrain();
  bindLearn();
  bindSettings();
  setupInstallAndUpdates();

  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-goto]');
    if (b) goTab(b.dataset.goto);
  });

  renderSetup();
  renderGameList();
  renderLearnIndex();
  updateTrainBadge();
  goTab('play');

  /* A broken lesson would mean a step that cannot be completed, so shout about
     it in the console rather than letting someone get stuck. */
  var problems = Tutorials.verify();
  if (problems.length) console.error('Tutorial problems:', problems);

  /* Warm the worker up so the first engine move is not also a cold start. */
  Eng.request({ type: 'eval', fen: Chess.START_FEN, time: 50 });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
