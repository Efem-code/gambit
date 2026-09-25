/* Gambit — turn calibration results into a level table.
 *
 * calibrate.js measured how far apart the levels actually are by playing them
 * against each other. Two things came out of it.
 *
 * First, the ladder was lumpy. The step from 800 to 1000 was 301 Elo and the
 * step from 1000 to 1200 was 83, so picking the next level up sometimes changed
 * nothing and sometimes changed everything.
 *
 * Second, the whole ladder is narrower than its labels claimed: about 1490 Elo
 * from the weakest setting to the strongest, not the 2000 the numbers implied.
 * That matters beyond presentation, because store.js feeds the level's number
 * into the Elo formula — labels that overstate the gaps make the rating they
 * produce wrong.
 *
 * So this does two things. It interpolates new settings out of the measured
 * curve so every step is the same size, and it relabels the levels so the gaps
 * between the numbers are the gaps that were measured. The labels are anchored
 * to keep 1000 where it is, since that is a level already being played and
 * already rated against.
 *
 * What is measured and what is not: the spacing is measured, the absolute
 * numbers are not. Anchoring a ladder to human Elo needs an opponent of known
 * strength, and there is none offline. Both ends stay estimates, and the app
 * says so.
 *
 *   node reanchor.js <dir-of-match-json> [--write]
 */
var fs = require('fs'), path = require('path');
global.Chess = require('./chess.js');
var Engine = require('./engine.js');

var dir = process.argv[2];
var write = process.argv.indexOf('--write') >= 0;
/* Once the labels are settled they stay settled. Re-spacing is iterative —
   interpolating settings out of a measured curve is a prediction, and it takes
   a round or two to converge — but a level whose number moves every round is
   worse than a level that is slightly mis-spaced. */
var keepLabels = process.argv.indexOf('--keep-labels') >= 0;
if (!dir) { console.error('usage: node reanchor.js <dir> [--write]'); process.exit(1); }

var LEVELS = Engine.LEVELS;
var N = LEVELS.length - 1;                 /* number of steps */

/* --exclude-top drops the top level's own match. That was needed for the first
   round, whose top match was played before the exactRoot fix: back then the
   strongest level searched with a narrowing root window and measured as the
   weakest thing on the ladder, so its number described a bug rather than a
   level. Matches played since measure the level, and are used. */
var EXCLUDE_TOP_MATCH = process.argv.indexOf('--exclude-top') >= 0;

var gaps = {};
fs.readdirSync(dir).filter(function (f) { return /^m_\d+_\d+\.json$/.test(f); })
  .forEach(function (f) {
    var d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    gaps[d.a + '>' + d.b] = { elo: -d.eloDiffAOverB, games: d.games, score: d.scoreA };
  });

var lastMeasured = EXCLUDE_TOP_MATCH ? N - 1 : N;
var missing = [];
for (var i = 0; i < lastMeasured; i++) {
  var key = LEVELS[i].elo + '>' + LEVELS[i + 1].elo;
  if (!gaps[key]) missing.push(key);
}
if (missing.length) {
  console.error('Missing matches, cannot build the ladder: ' + missing.join(', '));
  process.exit(2);
}

/* Where each level actually sits, in Elo above the weakest one. */
var measured = [0];
for (i = 0; i < lastMeasured; i++) {
  measured.push(measured[i] + gaps[LEVELS[i].elo + '>' + LEVELS[i + 1].elo].elo);
}
var span = measured[lastMeasured];

console.log('Measured ladder, from self-play:');
for (i = 0; i <= lastMeasured; i++) {
  var g = i ? gaps[LEVELS[i - 1].elo + '>' + LEVELS[i].elo] : null;
  var se = 0;
  if (g) {
    var sc = Math.min(0.99, Math.max(0.01, g.score));
    se = Math.sqrt(Math.max(0.01, sc * (1 - sc)) / g.games) *
         (400 / (Math.log(10) * sc * (1 - sc)));
  }
  console.log('  %s %s  at %s   %s', String(LEVELS[i].elo).padStart(4),
    LEVELS[i].name.padEnd(14), String(Math.round(measured[i])).padStart(5),
    g ? 'step +' + String(Math.round(g.elo)).padStart(3) + ' +/- ' +
        Math.round(se) + '  (' + g.games + ' games)' : '');
}
if (EXCLUDE_TOP_MATCH) {
  console.log('  %s %s  the engine ceiling; its match predates the exactRoot fix',
    String(LEVELS[N].elo).padStart(4), LEVELS[N].name.padEnd(14));
}

for (i = 1; i <= lastMeasured; i++) {
  if (measured[i] < measured[i - 1]) {
    console.error('\nThe ladder goes backwards at ' + LEVELS[i - 1].elo + ' > ' +
                  LEVELS[i].elo + '. Fix the settings before re-anchoring.');
    process.exit(4);
  }
}

var step = span / N;
console.log('\nSpan %d Elo over %d steps -> %d per step (the labels claimed %d).',
  Math.round(span), N, Math.round(step), (LEVELS[N].elo - LEVELS[0].elo) / N);

/* Is there anything left to correct? A match of n games pins a step to only so
   many Elo, so even a perfectly even ladder measures uneven. If the spread of
   the steps is no bigger than that error, the bumps are the measurement, not
   the ladder, and re-spacing against them fits noise and makes things worse.
   That is not hypothetical: the second re-spacing of this ladder was run on
   residuals that were mostly noise and it pushed the top step to -35, putting
   the ladder backwards again. It had to be reverted. */
var steps = [], errs = [];
for (i = 0; i < lastMeasured; i++) {
  var gp = gaps[LEVELS[i].elo + '>' + LEVELS[i + 1].elo];
  var sp = Math.min(0.99, Math.max(0.01, gp.score));
  steps.push(gp.elo);
  errs.push(Math.sqrt(Math.max(0.01, sp * (1 - sp)) / gp.games) *
            (400 / (Math.log(10) * sp * (1 - sp))));
}
function mean(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }
var mu = mean(steps);
var spread = Math.sqrt(mean(steps.map(function (x) { return (x - mu) * (x - mu); })));
var noise = mean(errs);
var real = Math.sqrt(Math.max(0, spread * spread - noise * noise));

console.log('\nSteps vary by %d Elo. One match measures a step to +/- %d,',
  Math.round(spread), Math.round(noise));
console.log('so about %d of that is real unevenness and the rest is the measurement.',
  Math.round(real));

if (real < noise * 0.6) {
  console.log('\nThat is inside the noise. Re-spacing against these numbers would');
  console.log('fit the measurement rather than the ladder — it would most likely');
  console.log('come out worse. Play more games a pair before trying again.');
  if (write) {
    console.error('\nRefusing to write. Pass --force if you mean it anyway.');
    if (process.argv.indexOf('--force') < 0) process.exit(5);
  }
}

/* ------------------------------------------------ settings at any strength */

function lerp(a, b, f) { return a + (b - a) * f; }

function settingsAt(target) {
  if (target >= measured[lastMeasured]) {
    var top = LEVELS[lastMeasured];
    return { depth: top.depth, time: top.time, noise: top.noise, blunder: top.blunder };
  }
  for (var j = 0; j < lastMeasured; j++) {
    if (target >= measured[j] && target <= measured[j + 1]) {
      var width = measured[j + 1] - measured[j];
      var f = width > 0 ? (target - measured[j]) / width : 0;
      var lo = LEVELS[j], hi = LEVELS[j + 1];
      return {
        depth: Math.max(1, Math.round(lerp(lo.depth, hi.depth, f))),
        time: Math.round(lerp(lo.time, hi.time, f) / 10) * 10,
        noise: Math.round(lerp(lo.noise, hi.noise, f) / 5) * 5,
        blunder: Math.round(lerp(lo.blunder, hi.blunder, f) * 1000) / 1000
      };
    }
  }
  var b = LEVELS[0];
  return { depth: b.depth, time: b.time, noise: b.noise, blunder: b.blunder };
}

/* --------------------------------------------------------------- labelling */

/* Round to something a person would write, and keep the anchor exact. */
var LABEL_STEP = Math.round(step / 25) * 25;
var ANCHOR_INDEX = 3, ANCHOR_ELO = 1000;

/* The names have to survive the relabelling. "Master" over the number 1900 is
   a claim the ladder cannot support, so the top of the range is renamed to
   what it is: strong play from a phone engine at its limit. */
var NAMES = ['Beginner', 'Novice', 'Casual', 'Club starter', 'Club', 'Solid club',
             'Strong club', 'Very strong', 'Sharp', 'Relentless', 'Full strength'];

var out = [];
for (i = 0; i <= N; i++) {
  var target = step * i;
  var s = (i === 0) ? { depth: LEVELS[0].depth, time: LEVELS[0].time,
                        noise: LEVELS[0].noise, blunder: LEVELS[0].blunder }
        : (i === N) ? { depth: LEVELS[N].depth, time: LEVELS[N].time,
                        noise: LEVELS[N].noise, blunder: LEVELS[N].blunder }
        : settingsAt(target);
  out.push({
    elo: keepLabels ? LEVELS[i].elo : ANCHOR_ELO + (i - ANCHOR_INDEX) * LABEL_STEP,
    name: keepLabels ? LEVELS[i].name : NAMES[i], target: Math.round(target),
    depth: s.depth, time: s.time, noise: s.noise, blunder: s.blunder,
    was: LEVELS[i]
  });
}

console.log('\nEvenly spaced ladder:');
console.log('  new label   sits at   depth  time  noise  blunder   (was)');
out.forEach(function (o) {
  console.log('  %s %s  %s   %s  %s  %s  %s    (%s: d%s t%s n%s b%s)',
    String(o.elo).padStart(5), o.name.padEnd(13), String(o.target).padStart(5),
    String(o.depth).padStart(4), String(o.time).padStart(5), String(o.noise).padStart(5),
    o.blunder.toFixed(3), String(o.was.elo).padStart(4),
    o.was.depth, o.was.time, o.was.noise, o.was.blunder);
});

var lines = out.map(function (o) {
  return "  { elo: " + o.elo + ", name: '" + o.name + "', depth: " + o.depth +
         ", time: " + o.time + ", noise: " + o.noise + ", blunder: " + o.blunder + " }";
});
var table = 'var LEVELS = [\n' + lines.join(',\n') + '\n];';

if (!write) {
  console.log('\n--- LEVELS table (run again with --write to apply) ---\n' + table);
} else {
  var src = fs.readFileSync('engine.js', 'utf8');
  var re = /var LEVELS = \[[\s\S]*?\n\];/;
  if (!re.test(src)) { console.error('Could not find the LEVELS table in engine.js'); process.exit(3); }
  fs.writeFileSync('engine.js', src.replace(re, table));
  console.log('\nengine.js updated. Re-run calibrate.js on the new table to check');
  console.log('the steps actually came out even — this is a prediction until then.');
}
