/* Gambit — tutorials.
 *
 * Every step is a position plus a move you have to find. Reading that a knight
 * forks teaches nothing; playing the fork and watching the rook fall does.
 *
 * Step fields:
 *   fen      the position (required)
 *   text     what to read
 *   play     the move you must find, in SAN
 *   accept   several acceptable moves, instead of (or as well as) `play`
 *   reply    the opponent's answer, played automatically
 *   arrows   ['e2e4'] drawn on the board
 *   marks    { e4: 'good' | 'bad' | 'info' }
 *   flip     show the board from Black's side
 *   hint     shown after two wrong tries
 *   done     shown once the move is found
 *
 * verify() replays every step at load. It checks the FEN parses, that each
 * expected move is legal, and that a move written with + or # really does give
 * check or mate — a lesson that quietly claims a non-mate is worse than no
 * lesson at all.
 */
var Tutorials = (function () {
'use strict';

var GROUPS = [
  { id: 'pieces',   title: 'How the pieces move', blurb: 'Start here if the board is new to you.' },
  { id: 'special',  title: 'The special moves',   blurb: 'Castling, en passant, promotion — the rules that catch people out.' },
  { id: 'basics',   title: 'Playing the opening', blurb: 'What to do with the first ten moves.' },
  { id: 'tactics',  title: 'Tactics',             blurb: 'The patterns that win material. This is where rating comes from.' },
  { id: 'mates',    title: 'Checkmate patterns',  blurb: 'Finishing the game off.' },
  { id: 'endgames', title: 'Endgames',            blurb: 'Fewer pieces, more precision.' }
];

var LESSONS = [

/* ------------------------------------------------------------- the pieces */
{
  id: 'pawn', group: 'pieces', title: 'The pawn', blurb: 'Forward only, captures sideways.',
  steps: [
    { fen: '7k/8/8/8/8/8/4P3/K7 w - - 0 1',
      text: 'A pawn moves straight forward, one square at a time. From its starting row it may go two squares instead. Play the pawn to e4.',
      play: 'e4', hint: 'Tap the pawn on e2, then tap e4.',
      done: 'That is the two-square first move. From now on this pawn only ever goes one square at a time, and it can never go backwards.' },
    { fen: '7k/8/8/3p4/4P3/8/8/K7 w - - 0 1',
      text: 'Pawns do not capture the way they move. They capture one square diagonally forward. The black pawn on d5 is takeable — take it.',
      play: 'exd5', hint: 'The pawn on e4 captures diagonally onto d5.',
      done: 'A pawn can never capture the piece directly in front of it. That piece simply blocks it.' },
    { fen: '7k/8/8/8/8/3p4/3P4/K7 w - - 0 1',
      text: 'Here the two pawns are nose to nose on the d-file. Neither can move, and neither can capture the other. Pawns lock up like this constantly — bear it in mind when you decide where to put them, because unlike every other piece a pawn can never come back.',
      marks: { d2: 'bad', d3: 'bad' } }
  ]
},
{
  id: 'knight', group: 'pieces', title: 'The knight', blurb: 'An L-shape, and the only piece that jumps.',
  steps: [
    { fen: '7k/8/8/3N4/8/8/8/K7 w - - 0 1',
      text: 'The knight moves in an L: two squares one way, then one square across. From d5 it has eight destinations. Play the knight to f6.',
      play: 'Nf6', hint: 'Two squares up the board, then one to the right.',
      done: 'Eight squares from the middle — but only two from a corner. Knights hate the edge of the board.' },
    { fen: '7k/8/4p3/2ppp3/2pNp3/3p4/8/K7 w - - 0 1',
      text: 'This knight is hemmed in on every side, and it does not care: it is the only piece that jumps over others. Take the pawn on e6.',
      play: 'Nxe6', hint: 'Nothing in between matters. Only the square it lands on.',
      done: 'Nothing blocks a knight. That is exactly why knights are strong in crowded positions where bishops have nowhere to go.' },
    { fen: '7k/8/8/8/8/8/8/KN6 w - - 0 1',
      text: 'Compare that with a knight near the corner: from b1 it reaches just three squares. A knight on the rim is doing almost nothing. Get them toward the middle.',
      marks: { a3: 'info', c3: 'info', d2: 'info' } }
  ]
},
{
  id: 'bishop', group: 'pieces', title: 'The bishop', blurb: 'Diagonals forever — but only half the board.',
  steps: [
    { fen: '7k/8/8/8/2B5/8/8/K7 w - - 0 1',
      text: 'A bishop slides any distance along a diagonal. Play it to f7.',
      play: 'Bf7', hint: 'c4, d5, e6, f7 — all one diagonal.',
      done: 'Every square it touched was a light square. A bishop can never change colour, so each one only ever sees half the board.' },
    { fen: '7k/8/4p3/8/2B5/8/8/K7 w - - 0 1',
      text: 'Bishops cannot jump. The pawn on e6 blocks this diagonal, so the bishop can go no further along it — but it can take the pawn. Take it.',
      play: 'Bxe6', hint: 'Capture by landing on the square the pawn occupies.',
      done: 'A sliding piece stops at the first piece it meets, and may capture it if it belongs to the opponent.' },
    { fen: '7k/8/8/8/2B2B2/8/8/K7 w - - 0 1',
      text: 'One bishop covers the light squares, the other the dark. Together they cover everything, which is why having both bishops when your opponent does not is worth real value — about half a pawn.',
      marks: { c4: 'good', f4: 'good' } }
  ]
},
{
  id: 'rook', group: 'pieces', title: 'The rook', blurb: 'Straight lines, and the strongest piece after the queen.',
  steps: [
    { fen: '7k/8/8/8/3R4/8/8/K7 w - - 0 1',
      text: 'A rook slides any distance along a rank or a file, never diagonally. Play it to d8, giving check.',
      play: 'Rd8+', hint: 'Straight up the d-file.',
      done: 'That is check: the rook attacks the king along the 8th rank, and Black must deal with it immediately.' },
    { fen: '7k/8/8/8/8/8/8/R6K w - - 0 1',
      text: 'Rooks are at their best on open lines — a file with no pawns on it. Slide this one all the way up the a-file.',
      play: 'Ra8+', hint: 'Nothing is in the way.',
      done: 'An open file is a rook highway. Manoeuvring a rook onto one is a genuine plan in a real game.' }
  ]
},
{
  id: 'queen', group: 'pieces', title: 'The queen', blurb: 'Rook and bishop in one piece.',
  steps: [
    { fen: '7k/8/8/3Q4/8/8/8/K7 w - - 0 1',
      text: 'The queen moves like a rook and a bishop combined, any distance. From d5 she controls 27 squares. First, move her like a rook: play Qd8, giving check.',
      play: 'Qd8+', hint: 'Straight up the d-file.',
      done: 'She is worth about nine pawns — more than a rook and a bishop put together.' },
    { fen: '7k/8/8/3Q4/8/8/8/K7 w - - 0 1',
      text: 'Now the same queen moving like a bishop. Slide her down the long diagonal to a2.',
      play: 'Qa2', hint: 'd5, c4, b3, a2.',
      done: 'Rank, file or diagonal — she does all three. Just do not bring her out early: she is so valuable that every piece which attacks her gains a free move.' }
  ]
},
{
  id: 'king', group: 'pieces', title: 'The king', blurb: 'One square at a time, and it can never be captured.',
  steps: [
    { fen: '7k/8/8/3K4/8/8/8/8 w - - 0 1',
      text: 'The king moves one square in any direction. Play it to e6.',
      play: 'Ke6', hint: 'One square diagonally, up and to the right.',
      done: 'Slow — but in the endgame, with the danger gone, the king becomes a genuinely strong attacking piece.' },
    { fen: '8/8/3k4/8/3K4/8/8/8 w - - 0 1',
      text: 'Two kings can never stand next to each other, so d5, c5 and e5 are all illegal here — the app will not let you play them. Move somewhere legal instead.',
      accept: ['Kc4', 'Ke4', 'Kc3', 'Kd3', 'Ke3'],
      hint: 'Anything that does not end up touching the black king.',
      done: 'Kings keep their distance. Which king is forced to give way first decides a huge number of pawn endings — see the Opposition lesson.' }
  ]
},

/* ----------------------------------------------------------- special moves */
{
  id: 'castling', group: 'special', title: 'Castling', blurb: 'Two pieces in one move. Do it early.',
  steps: [
    { fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
      text: 'Castling moves the king two squares toward a rook, and the rook hops over it to the other side. Castle kingside: tap the king, then tap g1.',
      play: 'O-O', hint: 'Tap the king on e1, then tap g1.',
      done: 'The king is tucked behind three unmoved pawns and the rook has come to an active file. That is why nearly every game starts with castling.' },
    { fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
      text: 'You can also castle the other way. Queenside, the king goes to c1 and the rook to d1. Try it.',
      play: 'O-O-O', hint: 'Tap the king, then tap c1.',
      done: 'Queenside castling develops the rook faster but leaves the a-pawn loose and the king closer to the edge, so it is the more committal choice.' },
    { fen: 'r3k2r/pppppppp/8/8/8/8/PPPPP1PP/R3K1NR w KQkq - 0 1',
      text: 'You may not castle through your own pieces. With the knight still on g1 there is no kingside castling here, so castle the other way.',
      play: 'O-O-O', hint: 'Kingside is blocked. Go queenside.',
      done: 'The other rules: neither the king nor that rook may have moved, the king may not be in check, and it may not pass through a square an enemy piece attacks. You may, however, castle with a rook that is attacked.' }
  ]
},
{
  id: 'enpassant', group: 'special', title: 'En passant', blurb: 'The capture that catches everyone out.',
  steps: [
    { fen: '7k/3p4/8/4P3/8/8/8/K7 b - - 0 1',
      text: 'You are Black. Your d-pawn wants to run past the white pawn without being taken, so use its two-square first move: play d5.',
      play: 'd5', flip: true, hint: 'Tap the black pawn on d7, then tap d5.',
      done: 'The pawn has skipped straight over d6 — the square the white pawn attacks. The rules do not let it get away with that.' },
    { fen: '7k/8/8/3pP3/8/8/8/K7 w - d6 0 2',
      text: 'Because that pawn has just gone two squares past yours, you may capture it as if it had only gone one. Play exd6 — your pawn lands on the empty square behind it.',
      play: 'exd6', hint: 'Capture onto d6. The black pawn on d5 comes off the board.',
      done: 'That is en passant, "in passing". Three conditions: only against a two-square pawn move, only with a pawn, and only on the very next move. Miss it once and the right is gone.' }
  ]
},
{
  id: 'promotion', group: 'special', title: 'Promotion', blurb: 'A pawn that reaches the end becomes anything you want.',
  steps: [
    { fen: '7k/4P3/8/8/8/8/8/K7 w - - 0 1',
      text: 'Push a pawn to the last rank and it turns into a new piece immediately. Play e8 and choose a queen.',
      play: 'e8=Q+', hint: 'Move the pawn to e8, then pick the queen from the strip that appears.',
      done: 'You may promote to a queen, rook, bishop or knight, and you are not limited to pieces you have already lost. Nine queens on the board is perfectly legal.' },
    { fen: '8/2k1P1q1/8/8/8/8/8/7K w - - 0 1',
      text: 'A queen is not always the right answer. Here a new queen on e8 does nothing at all — but a knight lands on e8 attacking the king on c7 and the queen on g7 at the same time. Promote to a knight.',
      play: 'e8=N+', hint: 'Move the pawn to e8, then choose the knight.',
      done: 'Black must answer the check, and then you take the queen. Choosing something other than a queen is called under-promotion. It is rare, but it wins games.' }
  ]
},
{
  id: 'checkmate-rules', group: 'special', title: 'Check, mate and stalemate', blurb: 'How games actually end.',
  steps: [
    { fen: '7k/8/8/8/8/8/8/R5K1 w - - 0 1',
      text: 'Check means the king is under attack. Play Ra8 and give check.',
      play: 'Ra8+', hint: 'Slide the rook up to the 8th rank.',
      done: 'Black is in check and must get out of it in one of three ways: move the king, block the attack, or capture the attacker. Here the king simply steps to h7.' },
    { fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
      text: 'Now the black king has its own pawns hemming it in. Give the same check — this time there is no way out.',
      play: 'Ra8#', hint: 'Same move as before. Then look at where the king could possibly go.',
      done: 'Checkmate: in check, with no legal reply. That ends the game immediately.' },
    { fen: '7k/8/6K1/8/8/8/8/1Q6 w - - 0 1',
      text: 'Now the trap that costs beginners half a point. Qb7 would leave Black not in check but with no legal move at all — stalemate, an instant draw, even though you are a queen up. Play the move that actually mates.',
      play: 'Qb8#', hint: 'Give check along the 8th rank. Your king already covers g7, g8 and h7.',
      done: 'Stalemate is a draw. It has rescued more lost positions than any other rule, so when your opponent is nearly out of moves, slow down and count.' }
  ]
},

/* ---------------------------------------------------------------- opening */
{
  id: 'opening-principles', group: 'basics', title: 'The three opening rules', blurb: 'Centre, pieces, king. In that order.',
  steps: [
    { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      text: 'Rule one: take the centre. A pawn on e4 or d4 claims squares your opponent wants and opens lines for your bishop and queen. Play one of them.',
      accept: ['e4', 'd4'], play: 'e4', hint: 'Push a central pawn two squares.',
      done: 'The centre matters because every piece reaches more squares from it, and because holding it denies your opponent room to develop.' },
    { fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      text: 'Rule two: develop your pieces toward the centre, knights before bishops. Play Nf3 — it develops, controls the middle, and attacks the e5 pawn.',
      accept: ['Nf3', 'Nc3'], play: 'Nf3', hint: 'Bring a knight out toward the middle.',
      done: 'And do not move the same piece twice in the opening while other pieces are still sitting at home.' },
    { fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
      text: 'Rule three: get the king to safety before the position opens up. Everything is ready on the kingside, so castle.',
      play: 'O-O', hint: 'King to g1.',
      done: 'Centre, develop, castle. Three ideas that will win you more games than any opening line you memorise.' },
    { fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      text: 'And the classic mistake. Qh5 attacks two things at once and looks aggressive, but Black defends and simultaneously develops, chasing her around while you lose time. Play the sound move instead.',
      play: 'Nf3', hint: 'Develop the knight and leave the queen at home.',
      done: 'Early queen sorties lose tempo. Every move your opponent makes that attacks your queen is a free developing move for them.' }
  ]
},
{
  id: 'piece-values', group: 'basics', title: 'What the pieces are worth', blurb: 'The arithmetic behind every trade.',
  steps: [
    { fen: '7k/8/8/8/8/8/8/K7 w - - 0 1',
      text: 'Pawn 1, knight 3, bishop 3, rook 5, queen 9. The king has no number — it is priceless. These values are a guide rather than a law, but they are right far more often than they are wrong, and almost every decision you make is really this sum.' },
    { fen: '7k/8/8/6r1/8/4B3/8/K7 w - - 0 1',
      text: 'Your bishop is worth 3, the black rook on g5 is worth 5, and the rook is undefended. Take it.',
      play: 'Bxg5', hint: 'e3, f4, g5 — one diagonal.',
      done: 'Trading a bishop or knight for a rook is called winning the exchange. It is worth about two pawns, and it adds up.' },
    { fen: '6k1/8/8/4n3/8/8/8/K3Q3 w - - 0 1',
      text: 'And the reverse: never give up a queen for a knight without a concrete reason. Here the knight on e5 is simply hanging — nothing defends it. Take it.',
      play: 'Qxe5', hint: 'Straight up the e-file. Check what defends e5 first: nothing does.',
      done: 'Before every capture, ask one question: what recaptures? If the answer is nothing, take it. If the answer is something cheaper than what you are giving, do not.' }
  ]
},

/* ---------------------------------------------------------------- tactics */
{
  id: 'fork', group: 'tactics', title: 'The fork', blurb: 'One piece, two targets. The knight is the specialist.',
  steps: [
    { fen: 'r3k3/8/8/3N4/8/8/8/7K w - - 0 1',
      text: 'The knight on d5 can attack the king and the rook at the same time. Find the square.',
      play: 'Nc7+', hint: 'Look for a knight square that touches both e8 and a8.',
      done: 'Black has to answer the check, and then you take the rook for free. That is a fork — and it is the reason knights win more material than any other piece at club level.' },
    { fen: '4k3/8/8/2n1b3/8/3P4/8/K7 w - - 0 1',
      text: 'Pawns fork too, and a pawn fork is the most painful kind because the pawn is worth so little that neither piece can take it profitably. Push the d-pawn and hit both.',
      play: 'd4', hint: 'Push it two squares and look at the diagonals it now attacks.',
      done: 'Whenever you move any piece, look at every square it now attacks. Forks are found on purpose, not stumbled into.' },
    { fen: '2k5/3N4/8/8/2r5/8/8/K7 w - - 0 1',
      text: 'One more. The black king is on c8 and the rook on c4. Find the knight square that attacks both.',
      play: 'Nb6+', hint: 'Work backwards: which squares attack c8? Of those, which also attacks c4?',
      done: 'A useful fact: a knight can never fork two squares of the same colour, and never two adjacent squares. That halves the number of places you need to look.' }
  ]
},
{
  id: 'pin', group: 'tactics', title: 'The pin', blurb: 'A piece that dare not move.',
  steps: [
    { fen: '4k3/8/4n3/8/3P4/8/8/K3R3 w - - 0 1',
      text: 'The black knight on e6 is pinned against its own king: moving it would expose the king to your rook, which is illegal. So it cannot move at all. Attack it with a pawn.',
      play: 'd5', hint: 'Push the d-pawn one square so it attacks e6.',
      done: 'Now the knight is attacked twice, defended not at all, and unable to run. Next move you simply take it. Attacking a pinned piece with a pawn is the standard way to cash a pin in.' },
    { fen: '3qk3/8/5n2/6B1/4P3/8/8/K7 w - - 0 1',
      text: 'This pin is not absolute — the knight on f6 is allowed to move, it just loses the queen behind it if it does. Attack it with the e-pawn anyway.',
      play: 'e5', hint: 'Push the e-pawn so it attacks f6.',
      done: 'The knight is stuck: moving costs the queen, staying costs the knight. When you are on the receiving end, break a pin early — move the piece behind, or defend the pinned piece properly.' }
  ]
},
{
  id: 'skewer', group: 'tactics', title: 'The skewer', blurb: 'A pin with the valuable piece in front.',
  steps: [
    { fen: '4q3/8/8/4k3/8/8/8/K6R w - - 0 1',
      text: 'The black king and queen are on the same file, with the king in front. Check the king and the queen behind it has nowhere to hide. Play the check.',
      play: 'Re1+', hint: 'Slide the rook along the first rank onto the e-file.',
      done: 'The king must move off the file, and then your rook takes the queen on e8. A skewer is just a pin with the pieces the other way round — and it collects material immediately rather than eventually.' },
    { fen: '8/r7/8/2k5/8/8/8/2B4K w - - 0 1',
      text: 'Same idea on a diagonal. The black king on c5 and the rook on a7 sit on one line. Find the bishop check.',
      play: 'Be3+', hint: 'Get the bishop onto the diagonal that runs through c5 and on to a7.',
      done: 'Whenever two enemy pieces stand on a single rank, file or diagonal, look for the piece that attacks along it. That habit alone is worth a hundred rating points.' }
  ]
},
{
  id: 'discovered', group: 'tactics', title: 'Discovered attack', blurb: 'Move one piece, unleash another.',
  steps: [
    { fen: '3qk3/8/8/3N4/8/8/8/K2R4 w - - 0 1',
      text: 'Your rook on d1 is aimed straight at the black queen, but your own knight is in the way. Move the knight — and move it with check, so Black has no time to save the queen.',
      accept: ['Nf6+', 'Nc7+'], play: 'Nf6+',
      hint: 'Find a knight move that gives check. Then Black must answer the check while the rook takes the queen.',
      done: 'Discovered check is the most violent tactic in chess: the opponent is forced to respond to the check, so whatever your moving piece attacks is yours for free.' },
    { fen: '8/8/8/3rk3/8/2N5/1B6/K7 w - - 0 1',
      text: 'Your bishop on b2 is aimed at the black king, blocked by your own knight. The knight can capture the rook on d5 and uncover the check at the same time. Play it.',
      play: 'Nxd5+', hint: 'The knight takes the rook, and the bishop behind it does the checking.',
      done: 'Look for your own pieces standing in front of your rooks, bishops and queen. Each one is a discovered attack waiting to be set off.' }
  ]
},
{
  id: 'backrank', group: 'tactics', title: 'The back rank', blurb: 'Castling makes a box. The box can become a coffin.',
  steps: [
    { fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
      text: 'The black king is walled in by its own pawns. Deliver mate along the 8th rank.',
      play: 'Ra8#', hint: 'Put the rook on the 8th rank, then check where the king could go.',
      done: 'This is the most common mate in real games at every level. It is also why experienced players spend a move on h3 or h6 for no other reason.' },
    { fen: '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
      text: 'Both kings are boxed in and the rooks stare at each other down the d-file. It is your move. Take the rook.',
      play: 'Rxd8#', hint: 'If you take on d8, what can recapture? Nothing does.',
      done: 'Mate, because Black never had a spare move. Always check your own back rank before you go hunting on the other side of the board.' },
    { fen: '5rk1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
      text: 'Now Black has a rook on f8 covering the back rank, so invading on d8 just loses a rook. Spend a move fixing your own weakness instead.',
      accept: ['h3', 'g3', 'h4'], play: 'h3', hint: 'Give your king a square to escape to.',
      done: 'One quiet pawn move and an entire category of disaster disappears. Players call it luft — air for the king.' }
  ]
},
{
  id: 'defender', group: 'tactics', title: 'Counting attackers and defenders', blurb: 'Most blunders are arithmetic, not blindness.',
  steps: [
    { fen: '4k3/8/8/3nq3/8/8/8/K3R3 w - - 0 1',
      text: 'The black queen on e5 looks defended by the knight on d5, so taking her looks like a losing trade. Check that again before you believe it, then take her.',
      play: 'Rxe5+', hint: 'List the squares a knight on d5 actually attacks. Is e5 one of them?',
      done: 'It is not — a knight never attacks a square next to it. Half of all "protected" pieces at club level are not protected at all. Count, do not glance.' },
    { fen: '2r1k3/8/8/8/8/8/2R5/K1R5 w - - 0 1',
      text: 'Two white rooks are stacked on the c-file against one black rook. You have two attackers to their one defender. Take.',
      play: 'Rxc8+', hint: 'Capture with the front rook — the one nearer the target.',
      done: 'When you outnumber the defenders of a square, the capture wins. Stacking two rooks on one file is called doubling, and it is the simplest way to create that imbalance.' }
  ]
},

/* -------------------------------------------------------- checkmate patterns */
{
  id: 'ladder', group: 'mates', title: 'The ladder mate', blurb: 'Two rooks, no king needed. Learn this one first.',
  steps: [
    { fen: '8/8/4k3/8/8/8/R7/1R5K w - - 0 1',
      text: 'Two rooks can mate on their own by walking the king to the edge. Start by cutting it off: check along the rank the king is standing on.',
      play: 'Ra6+', reply: 'Kf7', hint: 'Bring the a2 rook up to the 6th rank.',
      done: 'The king had to step back a rank, and it can never cross the 6th again while that rook sits there. Now repeat with the other rook.' },
    { fen: '8/5k2/R7/8/8/8/8/1R5K w - - 0 1',
      text: 'The rook on b1 is doing nothing. Bring it to the 7th rank with check and push the king back once more.',
      play: 'Rb7+', reply: 'Kg8', hint: 'Use the idle rook, not the one holding the 6th rank.',
      done: 'The king is on the last rank now, with the rook on b7 sealing the 7th. One more check finishes it.' },
    { fen: '6k1/1R6/R7/8/8/8/8/7K w - - 0 1',
      text: 'The rook on b7 covers the whole 7th rank, so the king cannot come back. Mate in one.',
      play: 'Ra8#', hint: 'The free rook goes to the 8th rank.',
      done: 'That is the ladder: check, king steps back, check with the other rook, repeat. It works from any position and needs no calculation at all.' }
  ]
},
{
  id: 'queen-mate', group: 'mates', title: 'King and queen mate', blurb: 'The most common ending you will ever reach.',
  steps: [
    { fen: '8/8/8/4k3/8/8/8/2Q4K w - - 0 1',
      text: 'With a queen you shrink the king\'s box rather than chase it. Play Qc4 — exactly a knight\'s move from the black king on e5.',
      play: 'Qc4', reply: 'Kd6', hint: 'Queen to c4. Count the knight move: c4 to e5.',
      done: 'The king lost five of its eight squares and was not even checked. Keeping the queen a knight\'s move away is the whole technique: it takes squares without ever leaving the king with none, so you cannot stalemate by accident.' },
    { fen: '8/8/3k4/8/2Q5/8/8/7K w - - 0 1',
      text: 'The queen is still a knight\'s move from the king, so the box holds itself. Use the free move to start walking your own king over.',
      accept: ['Kg2', 'Kh2'], play: 'Kg2', reply: 'Kd7',
      hint: 'Just step the king forward. The queen does not need to move.',
      done: 'Alternate: shrink the box with the queen, then bring the king closer. A queen can never mate on her own — the king has to arrive.' },
    { fen: '7k/8/6K1/8/8/1Q6/8/8 w - - 0 1',
      text: 'Here is the finish. Your king covers g7 and h7; the queen has to handle g8 and h8 herself. Deliver mate.',
      play: 'Qb8#',
      hint: 'One queen move attacks g8 and h8 at the same time.',
      done: 'Shrink the box, bring the king, mate on the edge. And note the near miss: Qg3 also takes g7, g8 and h7 — but not h8, so Black is not in check and has no move at all. That is stalemate, and it turns a won game into half a point.' }
  ]
},
{
  id: 'rook-mate', group: 'mates', title: 'King and rook mate', blurb: 'Harder than the queen. Worth the practice.',
  steps: [
    { fen: '8/8/8/3k4/8/8/8/R2K4 w - - 0 1',
      text: 'A lone rook cannot mate without its king, but it can build a wall. Cut the black king off by checking along the rank it stands on.',
      play: 'Ra5+', reply: 'Kd6', hint: 'Rook to the 5th rank.',
      done: 'Black is now confined to ranks 6, 7 and 8. The rook holds that wall and does not need to move again for a while.' },
    { fen: '8/8/3k4/R7/8/8/8/3K4 w - - 0 1',
      text: 'Now march your king toward the black one. They have to end up face to face.',
      accept: ['Kd2', 'Ke2', 'Kc2'], play: 'Kd2', reply: 'Kc6',
      hint: 'Step the king up the board. The rook stays where it is.',
      done: 'The kings walk toward each other while the rook does nothing. That patience is the part people get wrong.' },
    { fen: '8/8/2k5/R7/8/8/3K4/8 w - - 0 1',
      text: 'Keep coming, heading for the square directly opposite the black king.',
      accept: ['Kc3', 'Kd3', 'Ke3'], play: 'Kc3', reply: 'Kb6',
      hint: 'March the king forward again.',
      done: 'When the kings stand face to face with one square between them, the rook checks, the king is forced back a rank, and you repeat. It takes a while but it never fails.' }
  ]
},
{
  id: 'smothered', group: 'mates', title: 'Smothered mate', blurb: 'The prettiest mate in chess.',
  steps: [
    { fen: '6rk/6pp/8/6N1/8/8/8/K7 w - - 0 1',
      text: 'The black king has no escape squares at all — its own rook and pawns have sealed it in. Only a knight can reach past them. Play the mate.',
      play: 'Nf7#', hint: 'Which knight square attacks h8? Work backwards from the king.',
      done: 'Smothered mate. The king is suffocated by its own pieces, and nothing can capture or block a knight check.' },
    { fen: '5r1k/6pp/7N/8/2Q5/8/8/K7 w - - 0 1',
      text: 'Now the famous version. The king has one escape square, g8, so the knight cannot mate yet. Give the queen away on g8 to plug it — the rook is forced to take, because your knight defends the square.',
      play: 'Qg8+', reply: 'Rxg8', hint: 'Put the queen on g8, right next to the king.',
      done: 'The rook had to capture: the king cannot take because the knight on h6 defends g8. And now the rook itself is the wall that seals the king in.' },
    { fen: '6rk/6pp/7N/8/8/8/8/K7 w - - 0 1',
      text: 'The rook has been forced onto g8 and the king is completely smothered. Finish it.',
      play: 'Nf7#', hint: 'Same knight move as the first step.',
      done: 'A queen sacrifice to force the opponent to block their own king\'s last square. This combination is over four hundred years old and it still catches people.' }
  ]
},
{
  id: 'scholars', group: 'mates', title: "Scholar's mate, and how to stop it", blurb: 'The four-move mate every beginner meets.',
  steps: [
    { fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 3 3',
      text: 'Your bishop already eyes f7, the weakest square in Black\'s position because only the king defends it. Bring the queen to join the attack: play Qh5.',
      play: 'Qh5', reply: 'Nf6', hint: 'Queen to h5, hitting f7 and e5 at once.',
      done: 'Black played Nf6, which defends h5 and looks sensible — but it does nothing about f7, and that is fatal.' },
    { fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 5 4',
      text: 'Two attackers on f7, one defender. Finish the game.',
      play: 'Qxf7#', hint: 'Count f7 again: queen and bishop attacking, only the king defending.',
      done: 'Checkmate. The queen is protected by the bishop on c4, so the king cannot take, and it has no other square.' },
    { fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 4 3',
      text: 'Now the defence. You are Black, facing the same threat. One pawn move attacks the queen and covers f7 at the same time. Find it.',
      play: 'g6', flip: true, hint: 'Push the g-pawn one square.',
      done: 'The queen is attacked and must move, having achieved nothing in two moves while you developed. Against Scholar\'s mate, g6 is almost always the answer — and never defend f7 with a knight to f6, which is exactly what loses.' }
  ]
},

/* --------------------------------------------------------------- endgames */
{
  id: 'opposition', group: 'endgames', title: 'The opposition', blurb: 'The one idea that decides pawn endings.',
  steps: [
    { fen: '8/8/8/3k4/8/3K4/8/8 w - - 0 1',
      text: 'The kings face each other with one square between them. Whoever has to move must give way — and it is your move, so Black holds the opposition. Step aside and watch Black follow you.',
      accept: ['Kc3', 'Ke3', 'Kc2', 'Kd2', 'Ke2'], play: 'Kc3', reply: 'Kc5',
      hint: 'Any legal king move. Black will mirror it.',
      done: 'Black mirrored you and kept the opposition. To make progress you need to arrive at this position with Black to move, not White — which usually means finding a spare pawn move, or losing a move on purpose.' },
    { fen: '8/8/8/3k4/8/3K4/3P4/8 w - - 0 1',
      text: 'Now with a pawn on the board. Black holds the opposition again, and while that lasts your king can never get past. Step to e3 and watch.',
      accept: ['Kc3', 'Ke3', 'Kc2', 'Ke2'], play: 'Ke3', reply: 'Ke5',
      hint: 'c4, d4 and e4 are all illegal — they touch the black king. Step sideways instead.',
      done: 'Black mirrors you and your king still cannot get in front of the pawn, so this is drawn. Winning means reaching this exact position with Black to move rather than White — which usually takes a spare pawn move somewhere else on the board.' }
  ]
},
{
  id: 'square', group: 'endgames', title: 'The square of the pawn', blurb: 'Tell at a glance whether a king can catch a passed pawn.',
  steps: [
    { fen: '7k/8/8/P7/8/8/8/K7 w - - 0 1',
      text: 'Can the black king on h8 catch the pawn on a5? Picture a square with the pawn and its promotion square as one side: a5-a8-d8-d5. The king is nowhere near it. Push the pawn.',
      play: 'a6', hint: 'Just push it.',
      done: 'Outside the square means the pawn promotes. You can check this in a second, without calculating a single move.' },
    { fen: '8/8/8/P3k3/8/8/8/K7 w - - 0 1',
      text: 'Now the black king on e5 is just inside that same square. Push the pawn anyway and watch Black run it down.',
      play: 'a6', reply: 'Kd6', hint: 'Push, and watch the king step across.',
      done: 'Inside the square means the king catches it. Two details: the square shrinks as the pawn advances, and a pawn still on its starting rank gets a two-square move, so measure from the third rank instead.' }
  ]
},
{
  id: 'king-pawn', group: 'endgames', title: 'King and pawn versus king', blurb: 'Win it, or draw it, on purpose.',
  steps: [
    { fen: '8/8/8/3K4/3P4/8/8/3k4 w - - 0 1',
      text: 'Your king is in front of your pawn, which is the winning formation. The instinct is to push the pawn; the correct move is to advance the king. Play Kd6.',
      play: 'Kd6', hint: 'Step the king forward. The pawn waits.',
      done: 'King leads, pawn follows. A pawn that runs ahead of its king gets blockaded and the game is drawn.' },
    { fen: '8/8/8/8/8/4k3/4P3/4K3 w - - 0 1',
      text: 'And the drawn version. The black king sits directly in front of your pawn with your own king stuck behind it. There is nothing to be done — move your king and see.',
      accept: ['Kd1', 'Kf1'], play: 'Kf1', reply: 'Kd2',
      hint: 'Only two squares are legal — the pawn covers d3 and f3.',
      done: 'Black\'s king walks straight past yours. With your own king stuck behind the pawn there is no way to escort it through, and this is a dead draw — worth knowing from both sides of the board.' }
  ]
}

];

/* --------------------------------------------------------------- checking */

function verify() {
  var problems = [];
  LESSONS.forEach(function (lesson) {
    if (!GROUPS.some(function (g) { return g.id === lesson.group; })) {
      problems.push(lesson.id + ': unknown group ' + lesson.group);
    }
    lesson.steps.forEach(function (step, i) {
      var where = lesson.id + ' step ' + (i + 1);
      var p;
      try { p = Chess.fromFen(step.fen); }
      catch (e) { problems.push(where + ': bad FEN — ' + e.message); return; }

      if (Chess.inCheck(p, p.side ^ 8)) {
        problems.push(where + ': side not to move is in check — illegal position');
      }

      var expects = step.accept ? step.accept.slice() : [];
      if (step.play && expects.indexOf(step.play) < 0) expects.push(step.play);
      if (step.play && step.accept && step.accept.indexOf(step.play) < 0) {
        problems.push(where + ': play "' + step.play + '" is not in its own accept list');
      }

      expects.forEach(function (san) {
        var m = Chess.sanToMove(p, san);
        if (!m) { problems.push(where + ': illegal move "' + san + '"'); return; }
        /* A lesson that writes # must really be mate, and + must really check. */
        var actual = Chess.moveToSan(p, m);
        if (actual !== san) {
          problems.push(where + ': wrote "' + san + '" but the move is "' + actual + '"');
        }
      });

      if (step.reply) {
        var first = step.play || (step.accept && step.accept[0]);
        var fm = first && Chess.sanToMove(p, first);
        if (fm) {
          Chess.makeMove(p, fm);
          var rm = Chess.sanToMove(p, step.reply);
          if (!rm) problems.push(where + ': illegal reply "' + step.reply + '" after ' + first);
          else if (Chess.moveToSan(p, rm) !== step.reply) {
            problems.push(where + ': reply written "' + step.reply + '" but is "' + Chess.moveToSan(p, rm) + '"');
          }
          Chess.unmakeMove(p);
        }
      }
    });
  });
  return problems;
}

function byGroup(id) { return LESSONS.filter(function (l) { return l.group === id; }); }
function byId(id) {
  for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) return LESSONS[i];
  return null;
}
function count() { return LESSONS.reduce(function (n, l) { return n + l.steps.length; }, 0); }

return { GROUPS: GROUPS, LESSONS: LESSONS, verify: verify, byGroup: byGroup, byId: byId, count: count };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Tutorials;
