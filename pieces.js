/* Gambit — piece artwork.
 *
 * Hand-drawn SVG rather than the Unicode chess characters: Android renders
 * those through whichever symbol font happens to be installed, at wildly
 * different weights, and sometimes as emoji. Vectors look the same everywhere
 * and stay sharp on a folding screen that changes size mid-game.
 *
 * The silhouettes follow the Staunton pattern every real tournament set uses,
 * which is what makes a piece read instantly as a bishop rather than a lamp:
 * a wide flared base, a collar ring above it, a tapered stem, then the head
 * that identifies the piece. Every piece shares the same base and collar, so
 * they line up as a set instead of six unrelated drawings.
 *
 * Fills are flat, as in every serious piece set — depth comes from the outline
 * weight and a CSS drop shadow, not from gradients that muddy at 32px.
 *
 * Drawn in a 45x45 box. Fill and stroke come from CSS so one set of shapes
 * serves both colours.
 */
var Pieces = (function () {
'use strict';

/* Shared footing. The base flares outward with concave sides; the collar is
   the ring that visually separates it from the stem. */
var BASE   = '<path d="M9.6 41.4c0-3 1.4-4.9 3.2-6h19.4c1.8 1.1 3.2 3 3.2 6z"/>';
var COLLAR = '<rect x="12.8" y="31.3" width="19.4" height="4.3" rx="1.4"/>';

var STAUNTON = {
  /* Sphere, slim neck, flared skirt. The smallest piece, so the head is
     proportionally larger or it disappears at board size. */
  p: '<circle cx="22.5" cy="11.2" r="4.9"/>' +
     '<path d="M18 16.4h9c-.7 2.6 0 4.9 1.4 6.9 1.6 2.4 2.6 5.1 3 8H13.6c.4-2.9 1.4-5.6 3-8 1.4-2 2.1-4.3 1.4-6.9z"/>' +
     COLLAR + BASE,

  /* Three merlons and an overhanging band — the crenellated tower. */
  r: '<path d="M11.2 8.4h4.8v3.6h4.1V8.4h4.8v3.6h4.1V8.4h4.8v9.8H11.2z"/>' +
     '<rect x="10.2" y="18.2" width="24.6" height="3.4" rx=".8"/>' +
     '<path d="M13.8 21.6h17.4l-1 9.7H14.8z"/>' +
     COLLAR + BASE,

  /* Mitre with the cleric\'s cross, topped by the finial ball. */
  b: '<circle cx="22.5" cy="6.2" r="2.5"/>' +
     '<path d="M22.5 8.4c5 0 9 5.8 9 11.8 0 3.6-1.5 6.6-3.6 8.8H17.1c-2.1-2.2-3.6-5.2-3.6-8.8 0-6 4-11.8 9-11.8z"/>' +
     '<path class="pc-cut" d="M22.5 12.4v8.6M18.2 16.7h8.6"/>' +
     '<rect x="15.2" y="28.4" width="14.6" height="3" rx="1"/>' +
     COLLAR + BASE,

  /* Five-point coronet, each point finished with a ball. */
  /* The knight is the piece people judge a set by. The back edge is notched
     into a mane rather than left as a smooth arc, and the muzzle, jaw and ears
     are cut deliberately — a knight drawn as a blob reads as a seahorse. */
  n: '<path d="M12.8 31.3c0-4.1.9-7.1 2.9-9.6l-4.3 1.9c-1.7.8-3 .1-3.2-1.3-.2-1.4.8-2.9 2.5-4.4 2.7-2.4 4.9-4.3 6.3-6.5 1.2-1.9 1.7-3.8 1.7-6.2l2.4 3.4 2.3-4.2 2.5 5.1c3 1.4 5.1 3.6 6.4 6.6l-2.2 1.2 2.9 1.2c.5 1.5.9 3.1 1.1 4.9l-2.4.9 2.7 1.4c.2 1.6.3 3.4.3 5.6z"/>' +
     '<circle class="pc-eye" cx="16" cy="17.2" r="1.5"/>' +
     '<circle class="pc-eye" cx="11.5" cy="21.4" r=".85"/>' +
     COLLAR + BASE,

  q: '<circle cx="8" cy="13" r="2.4"/><circle cx="14.4" cy="9" r="2.4"/>' +
     '<circle cx="22.5" cy="6.9" r="2.7"/><circle cx="30.6" cy="9" r="2.4"/>' +
     '<circle cx="37" cy="13" r="2.4"/>' +
     '<path d="M8 13.2 11.6 25.4H33.4L37 13.2 31.4 20.2 30.6 9.2 25 19.4 22.5 7.4 20 19.4 14.4 9.2 13.6 20.2Z"/>' +
     '<path d="M12 25.4h21c1 2.6.4 4.5-.7 5.9H12.7c-1.1-1.4-1.7-3.3-.7-5.9z"/>' +
     COLLAR + BASE,

  /* The cross is a filled shape, not a stroked line: it sits above the body,
     against the square rather than the piece, so a stroke-only cross would
     disappear whenever it matched the square colour. */
  k: '<path d="M20.4 2.6h4.2v3.6h3.6v4.2h-3.6v3.6h-4.2v-3.6h-3.6V6.2h3.6z"/>' +
     '<path d="M15.2 13.8h14.6v3.2l-1.3 2.2H16.5l-1.3-2.2z"/>' +
     '<path d="M28 19.2c-.4 4.5.7 8.5 2.7 12.1H14.3c2-3.6 3.1-7.6 2.7-12.1z"/>' +
     COLLAR + BASE
};

/* ------------------------------------------------------- the carved set */

/* A second set in the medieval carved-stone tradition — the Lewis Chessmen and
   their descendants: squat figures hewn rather than turned, seated royalty, a
   hooded bishop, a rough tower. Everything is drawn with straight segments and
   flat angles so it reads as chiselled stone instead of lathed wood, and the
   pieces are deliberately stockier than the Staunton set, which is what gives
   the whole board a heavier feel.
   (Modelled on the historical sets, not on any film's props.) */

var S_BASE   = '<path d="M8.4 41.6L10.9 35.8h23.2l2.5 5.8z"/>';
var S_PLINTH = '<path d="M11.6 35.8l1-3.2h19.8l1 3.2z"/>';

var CARVED = {
  /* A squat standing stone. Deliberately short: the bishop is the other
     tapering piece, and height is what separates them across the board. */
  p: '<path d="M22.5 12.2c3.4 0 6 2.6 6 6l1.3 14.4H15.2l1.3-14.4c0-3.4 2.6-6 6-6z"/>' +
     '<path class="pc-cut" d="M17 24.4h11"/>' +
     S_PLINTH + S_BASE,

  /* A rough tower with uneven merlons, a course line and an arrow slit. */
  r: '<path d="M10.8 9.2h5.4v4h3.6v-4h5.6v4h3.6v-4h5.2v9.4H10.8z"/>' +
     '<path d="M12.4 18.6h20.2l-1.5 14H13.9z"/>' +
     '<path class="pc-cut" d="M13.2 24.6h18.6M22.5 27.2v4.2"/>' +
     S_PLINTH + S_BASE,

  /* A cowled monk: tall pointed hood, shoulders, and a dark face opening.
     The face is the whole trick — an outline alone reads as another pawn at
     28px, but a hood with a face in it is unmistakable at any size. */
  b: '<path d="M22.5 4.2l3.4 6.6c1.6 3 2.4 5.2 2.6 7.6l.6 4.2c2 1.6 3.2 4.2 3.6 7.6l.4 2.4H11.9l.4-2.4c.4-3.4 1.6-6 3.6-7.6l.6-4.2c.2-2.4 1-4.6 2.6-7.6z"/>' +
     '<ellipse class="pc-eye" cx="22.5" cy="15" rx="2.5" ry="3.3"/>' +
     '<path class="pc-cut" d="M16.6 24.8h11.8"/>' +
     S_PLINTH + S_BASE,

  /* Hewn horse: square jaw, stepped mane, all straight cuts. */
  n: '<path d="M12.8 32.6l2-8.4-4.4 1.8-2.2-2.6 2.8-4.8 6.2-5.8.9-6.6 3 3.4 2.4-5 3 5.6 4.4 3.4-2.4 1.8 3.8 1.8-1.9 2.6 3.2 2.2-1.8 3.4 2 2.2-.4 5z"/>' +
     '<circle class="pc-eye" cx="16.2" cy="16.8" r="1.5"/>' +
     '<path class="pc-cut" d="M10.9 21.8l2.6-1"/>' +
     S_PLINTH + S_BASE,

  /* Seated queen, hand raised to the cheek — the gesture the Lewis queens are
     known for, and the thing that tells her apart from the king in silhouette. */
  q: '<path d="M15.4 11.4V7.6l2.2 2.4 2.4-3.6 2.5 3.1 2.5-3.1 2.4 3.6 2.2-2.4v3.8z"/>' +
     '<path d="M18.4 11.4h8.2v4.2c0 2.1-1.8 3.6-4.1 3.6s-4.1-1.5-4.1-3.6z"/>' +
     '<path d="M15.2 18.8h14.6c2.2 4 3.6 8.8 4 13.8H11.2c.4-5 1.8-9.8 4-13.8z"/>' +
     '<path class="pc-cut" d="M16.8 23.4c1.4-1.6 3-2.9 4.6-3.7"/>' +
     S_PLINTH + S_BASE,

  /* Seated king: crowned with a cross, sword laid across the lap. */
  k: '<path d="M20.6 3h3.8v2.6h2.6v3.2h-2.6v2.6h-3.8V8.8H18V5.6h2.6z"/>' +
     '<path d="M15.2 12h14.6v3.6H15.2z"/>' +
     '<path d="M17.8 15.6h9.4v3.2c0 2.6-2.1 4.3-4.7 4.3s-4.7-1.7-4.7-4.3z"/>' +
     '<path d="M14.6 22.6h15.8c2.2 3.4 3.6 6.8 4 10H10.6c.4-3.2 1.8-6.6 4-10z"/>' +
     '<path class="pc-cut" d="M12.8 29h19.4M19.6 26.2v5.6"/>' +
     S_PLINTH + S_BASE
};

var SETS = { staunton: STAUNTON, carved: CARVED };
var current = 'staunton';

/* Which set the boards draw with. Unknown names fall back rather than throw —
   a stale setting should not leave a blank board. */
function use(name) {
  current = SETS[name] ? name : 'staunton';
  return current;
}
function currentSet() { return current; }
function names() { return Object.keys(SETS); }

var cache = Object.create(null);

/* `type` is a Chess piece type, `color` a Chess colour; returns an <svg> string. */
function svg(type, color, cls) {
  var key = current + '|' + type + '|' + color + '|' + (cls || '');
  if (cache[key]) return cache[key];
  var shape = SETS[current][Chess.PIECE_CHARS[type]];
  var side = color === Chess.WHITE ? 'w' : 'b';
  var out = '<svg class="piece piece-' + side + ' ' + (cls || '') + '" viewBox="0 0 45 45" ' +
            'aria-hidden="true" focusable="false">' + shape + '</svg>';
  cache[key] = out;
  return out;
}

var NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
function nameOf(type) { return NAMES[Chess.PIECE_CHARS[type]]; }

return { svg: svg, SETS: SETS, use: use, currentSet: currentSet, names: names, nameOf: nameOf };
})();
