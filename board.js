/* Gambit — the board widget.
 *
 * Used by the game screen, the review screen and every tutorial, so it knows
 * nothing about whose turn it is or what the engine thinks: it renders a
 * position, reports attempted moves, and draws whatever marks it is told to.
 *
 * Input is tap-then-tap first and drag second. On a phone a drag that starts
 * with a slightly-off finger press picks up the wrong piece; tapping is exact,
 * and dragging still works for anyone who prefers it.
 */
function Board(el, opts) {
  opts = opts || {};
  this.el = el;
  this.flipped = !!opts.flipped;
  this.interactive = opts.interactive !== false;
  this.onMove = opts.onMove || function () {};
  this.onSelect = opts.onSelect || function () {};
  this.showCoords = opts.showCoords !== false;
  this.pos = Chess.fromFen(opts.fen || Chess.START_FEN);
  this.selected = -1;
  this.targets = [];
  this.lastMove = null;
  this.arrows = [];
  this.marks = {};
  this.pieceEls = Object.create(null);
  this.pendingPromo = null;
  this.frozen = false;
  this._build();
  this.render();
}

Board.prototype._build = function () {
  var self = this;
  this.el.classList.add('board');
  this.el.innerHTML =
    '<div class="bd-squares"></div>' +
    '<svg class="bd-overlay" viewBox="0 0 8 8" preserveAspectRatio="none" aria-hidden="true"></svg>' +
    '<div class="bd-pieces"></div>' +
    '<div class="bd-promo" hidden></div>';
  this.squaresEl = this.el.querySelector('.bd-squares');
  this.overlayEl = this.el.querySelector('.bd-overlay');
  this.piecesEl = this.el.querySelector('.bd-pieces');
  this.promoEl = this.el.querySelector('.bd-promo');

  var html = '';
  for (var row = 0; row < 8; row++) {
    for (var col = 0; col < 8; col++) {
      var dark = (row + col) % 2 === 1;
      html += '<div class="bd-sq ' + (dark ? 'dark' : 'light') + '" data-row="' + row + '" data-col="' + col + '"></div>';
    }
  }
  this.squaresEl.innerHTML = html;

  /* Always listen, and decide in _down whether to act. A board can change its
     mind about being interactive — the review board becomes an analysis board
     and back again — and attaching only at construction meant that switch did
     nothing at all. */
  this.el.addEventListener('pointerdown', function (e) { self._down(e); });
  this.el.addEventListener('pointermove', function (e) { self._move(e); });
  this.el.addEventListener('pointerup', function (e) { self._up(e); });
  this.el.addEventListener('pointercancel', function () { self._cancelDrag(); });
  this.el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
};

/* ------------------------------------------------------- geometry helpers */

Board.prototype.rcOf = function (s) {
  var f = Chess.fileOf(s), r = Chess.rankOf(s);
  return this.flipped ? { row: r, col: 7 - f } : { row: 7 - r, col: f };
};
Board.prototype.sqAt = function (row, col) {
  return this.flipped ? Chess.sq(7 - col, row) : Chess.sq(col, 7 - row);
};
Board.prototype._pointSquare = function (e) {
  var rect = this.el.getBoundingClientRect();
  var col = Math.floor((e.clientX - rect.left) / (rect.width / 8));
  var row = Math.floor((e.clientY - rect.top) / (rect.height / 8));
  if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
  return this.sqAt(row, col);
};

/* ---------------------------------------------------------------- render */

Board.prototype.render = function () {
  var html = '', s, piece, rc;
  this.pieceEls = Object.create(null);
  for (s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    piece = this.pos.board[s];
    if (!piece) continue;
    rc = this.rcOf(s);
    html += '<div class="bd-piece" data-sq="' + s + '" style="transform:translate(' +
            (rc.col * 100) + '%,' + (rc.row * 100) + '%)">' +
            Pieces.svg(Chess.typeOf(piece), Chess.colorOf(piece)) + '</div>';
  }
  this.piecesEl.innerHTML = html;
  var nodes = this.piecesEl.children;
  for (var i = 0; i < nodes.length; i++) this.pieceEls[nodes[i].dataset.sq] = nodes[i];
  this.renderMarks();
  this.renderCoords();
};

Board.prototype.renderCoords = function () {
  if (!this.showCoords) return;
  var sqs = this.squaresEl.children;
  for (var i = 0; i < sqs.length; i++) {
    var row = i / 8 | 0, col = i % 8;
    var s = this.sqAt(row, col);
    sqs[i].dataset.file = row === 7 ? Chess.FILES[Chess.fileOf(s)] : '';
    sqs[i].dataset.rank = col === 0 ? String(Chess.rankOf(s) + 1) : '';
  }
};

Board.prototype.renderMarks = function () {
  var sqs = this.squaresEl.children, i, s;
  for (i = 0; i < sqs.length; i++) {
    sqs[i].className = 'bd-sq ' + (((i / 8 | 0) + (i % 8)) % 2 === 1 ? 'dark' : 'light');
  }
  var self = this;
  function mark(square, cls) {
    if (square < 0 || (square & 0x88)) return;
    var rc = self.rcOf(square);
    var node = sqs[rc.row * 8 + rc.col];
    if (node) node.classList.add(cls);
  }
  if (this.lastMove) { mark(this.lastMove.from, 'last'); mark(this.lastMove.to, 'last'); }
  if (this.selected >= 0) mark(this.selected, 'sel');
  for (var k in this.marks) mark(+k, 'mk-' + this.marks[k]);

  /* The king in check needs to be unmissable, especially at phone size. */
  var us = this.pos.side;
  if (Chess.inCheck(this.pos, us)) mark(this.pos.kingSq[us ? 1 : 0], 'check');

  /* Move targets: a dot on an empty square, a ring around a capture. */
  var dots = '';
  for (i = 0; i < this.targets.length; i++) {
    s = Chess.mTo(this.targets[i]);
    var rc = this.rcOf(s);
    var occupied = this.pos.board[s] || (this.targets[i] & Chess.F_EP);
    dots += occupied
      ? '<circle class="bd-capture" cx="' + (rc.col + 0.5) + '" cy="' + (rc.row + 0.5) + '" r="0.46"/>'
      : '<circle class="bd-dot" cx="' + (rc.col + 0.5) + '" cy="' + (rc.row + 0.5) + '" r="0.16"/>';
  }
  var arrows = '';
  for (i = 0; i < this.arrows.length; i++) {
    var a = this.arrows[i];
    var f = this.rcOf(a.from), t = this.rcOf(a.to);
    var x1 = f.col + 0.5, y1 = f.row + 0.5, x2 = t.col + 0.5, y2 = t.row + 0.5;
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
    /* A one-square move has barely any shaft, so a full-size head covers both
       squares and reads as a blob rather than a direction. Shrink it to fit. */
    var scale = Math.min(1, len / 1.6);
    var back = 0.34 * scale;
    var ex = x2 - dx / len * back, ey = y2 - dy / len * back;
    arrows += '<line class="bd-arrow ' + (a.cls || '') + '" x1="' + x1 + '" y1="' + y1 +
              '" x2="' + ex + '" y2="' + ey + '"/>' +
              '<polygon class="bd-arrowhead ' + (a.cls || '') + '" points="' +
              arrowHead(ex, ey, dx / len, dy / len, scale) + '"/>';
  }
  this.overlayEl.innerHTML = arrows + dots;
};

function arrowHead(x, y, ux, uy, scale) {
  var w = 0.17 * (scale || 1), h = 0.34 * (scale || 1);
  var px = -uy, py = ux;
  return [
    (x + ux * h) + ',' + (y + uy * h),
    (x + px * w) + ',' + (y + py * w),
    (x - px * w) + ',' + (y - py * w)
  ].join(' ');
}

/* ----------------------------------------------------------- interaction */

Board.prototype._down = function (e) {
  if (!this.interactive || this.frozen || this.pendingPromo) return;
  var s = this._pointSquare(e);
  if (s < 0) return;
  var piece = this.pos.board[s];

  /* Tapping a highlighted target plays the move. */
  if (this.selected >= 0) {
    var m = this._targetMove(s);
    if (m) { e.preventDefault(); this._commit(m); return; }
  }

  if (piece && Chess.colorOf(piece) === this.pos.side) {
    e.preventDefault();
    if (this.selected === s) { this.clearSelection(); return; }
    this.select(s);
    /* Arm a drag, but do not start one until the finger actually moves. */
    this.drag = { sq: s, x: e.clientX, y: e.clientY, active: false, el: this.pieceEls[s] };
    try { this.el.setPointerCapture(e.pointerId); } catch (err) {}
    return;
  }
  this.clearSelection();
};

Board.prototype._move = function (e) {
  if (!this.drag) return;
  var dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
  if (!this.drag.active && dx * dx + dy * dy < 36) return;
  e.preventDefault();
  this.drag.active = true;
  var rect = this.el.getBoundingClientRect(), size = rect.width / 8;
  var rc = this.rcOf(this.drag.sq);
  var el = this.drag.el;
  if (!el) return;
  el.classList.add('dragging');
  el.style.transform = 'translate(' + (rc.col * 100 + dx / size * 100) + '%,' +
                                      (rc.row * 100 + dy / size * 100) + '%)';
  var over = this._pointSquare(e);
  if (over !== this.hoverSq) {
    this.hoverSq = over;
    this.marks = {};
    if (this._targetMove(over)) this.marks[over] = 'hover';
    this.renderMarks();
  }
};

Board.prototype._up = function (e) {
  if (!this.drag) return;
  var drag = this.drag;
  this.drag = null;
  this.hoverSq = -1;
  this.marks = {};
  if (drag.el) {
    drag.el.classList.remove('dragging');
    var rc = this.rcOf(drag.sq);
    drag.el.style.transform = 'translate(' + (rc.col * 100) + '%,' + (rc.row * 100) + '%)';
  }
  if (!drag.active) { this.renderMarks(); return; }
  var s = this._pointSquare(e);
  var m = this._targetMove(s);
  if (m) this._commit(m); else this.renderMarks();
};

Board.prototype._cancelDrag = function () {
  if (!this.drag) return;
  var drag = this.drag; this.drag = null;
  if (drag.el) {
    drag.el.classList.remove('dragging');
    var rc = this.rcOf(drag.sq);
    drag.el.style.transform = 'translate(' + (rc.col * 100) + '%,' + (rc.row * 100) + '%)';
  }
  this.renderMarks();
};

/* All legal moves from the selection landing on `s` — more than one only when
   a pawn is promoting. */
Board.prototype._targetMove = function (s) {
  if (s < 0) return null;
  var matches = [];
  for (var i = 0; i < this.targets.length; i++) {
    if (Chess.mTo(this.targets[i]) === s) matches.push(this.targets[i]);
  }
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  return { promo: matches };
};

Board.prototype._commit = function (m) {
  if (m && m.promo) { this._askPromotion(m.promo); return; }
  var from = Chess.mFrom(m), to = Chess.mTo(m);
  this.clearSelection();
  this.onMove(m, from, to);
};

Board.prototype._askPromotion = function (choices) {
  var self = this;
  var to = Chess.mTo(choices[0]);
  var rc = this.rcOf(to);
  var order = [Chess.QUEEN, Chess.KNIGHT, Chess.ROOK, Chess.BISHOP];
  var color = this.pos.side;
  var html = '';
  for (var i = 0; i < order.length; i++) {
    var move = 0;
    for (var j = 0; j < choices.length; j++) if (Chess.mPromo(choices[j]) === order[i]) move = choices[j];
    if (!move) continue;
    html += '<button class="bd-promo-opt" data-move="' + move + '">' +
            Pieces.svg(order[i], color) + '</button>';
  }
  /* Anchor the strip to the promotion file, growing away from the edge. */
  this.promoEl.style.left = (rc.col * 12.5) + '%';
  this.promoEl.style.top = rc.row === 0 ? '0' : 'auto';
  this.promoEl.style.bottom = rc.row === 0 ? 'auto' : '0';
  this.promoEl.innerHTML = html + '<button class="bd-promo-cancel" data-move="0">Cancel</button>';
  this.promoEl.hidden = false;
  this.pendingPromo = true;
  this.promoEl.onclick = function (ev) {
    var btn = ev.target.closest('[data-move]');
    if (!btn) return;
    self.promoEl.hidden = true;
    self.pendingPromo = null;
    var mv = +btn.dataset.move;
    self.clearSelection();
    if (mv) self.onMove(mv, Chess.mFrom(mv), Chess.mTo(mv));
  };
};

Board.prototype.select = function (s) {
  this.selected = s;
  var legal = Chess.legalMoves(this.pos);
  this.targets = legal.filter(function (m) { return Chess.mFrom(m) === s; });
  this.renderMarks();
  this.onSelect(s, this.targets);
};

Board.prototype.clearSelection = function () {
  this.selected = -1;
  this.targets = [];
  this.marks = {};
  this.renderMarks();
};

/* -------------------------------------------------------------- mutation */

/* Play a move with the piece sliding to its destination. */
Board.prototype.animateMove = function (m, done) {
  var self = this;
  var from = Chess.mFrom(m), to = Chess.mTo(m);
  var el = this.pieceEls[from];
  var capSq = (m & Chess.F_EP) ? to - (this.pos.side === Chess.WHITE ? 16 : -16) : to;
  var capEl = (m & Chess.F_CAP) ? this.pieceEls[capSq] : null;
  var rookEls = null;
  if (m & Chess.F_CASTLE) {
    var rf = to > from ? to + 1 : to - 2, rt = to > from ? to - 1 : to + 1;
    rookEls = { el: this.pieceEls[rf], to: rt };
  }

  Chess.makeMove(this.pos, m);
  this.lastMove = { from: from, to: to };
  this.selected = -1; this.targets = []; this.marks = {};

  if (!el) { this.render(); if (done) done(); return; }

  if (capEl) capEl.classList.add('captured');
  var rc = this.rcOf(to);
  el.classList.add('moving');
  el.style.transform = 'translate(' + (rc.col * 100) + '%,' + (rc.row * 100) + '%)';
  if (rookEls && rookEls.el) {
    var rrc = this.rcOf(rookEls.to);
    rookEls.el.classList.add('moving');
    rookEls.el.style.transform = 'translate(' + (rrc.col * 100) + '%,' + (rrc.row * 100) + '%)';
  }
  this.renderMarks();

  setTimeout(function () {
    self.render();
    if (done) done();
  }, 170);
};

/* Jump straight to a position, no animation — used when stepping through a
   finished game, where a slide between unrelated positions is just confusing. */
Board.prototype.setPosition = function (posOrFen, lastMove) {
  this.pos = (typeof posOrFen === 'string') ? Chess.fromFen(posOrFen) : posOrFen;
  this.lastMove = lastMove || null;
  this.selected = -1; this.targets = []; this.marks = {};
  this.render();
};

Board.prototype.setFlipped = function (f) {
  this.flipped = f;
  this.render();
};

Board.prototype.setArrows = function (arrows) {
  this.arrows = arrows || [];
  this.renderMarks();
};

Board.prototype.setFrozen = function (f) {
  this.frozen = f;
  this.el.classList.toggle('frozen', !!f);
  if (f) this.clearSelection();
};

/* A brief shake, for an illegal or disallowed attempt in a tutorial. */
Board.prototype.reject = function (s) {
  var rc = this.rcOf(s);
  var node = this.squaresEl.children[rc.row * 8 + rc.col];
  if (!node) return;
  node.classList.remove('wrong');
  void node.offsetWidth;
  node.classList.add('wrong');
};
