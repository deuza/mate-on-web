/**
 * app.js - Puzzle Trainer
 * Game logic for mate in X moves
 */

// Global variables
let game = null;
let board = null;
let currentPuzzle = null;
let currentLevel = null;    // Level of the puzzle file, 1 to 5: the chosen one, or the
                            // one drawn in mystery mode. Outside the mystery mode it is
                            // also the level asked for the next puzzle, so it must stay
                            // a level that puzzle.php accepts
let mateLength = null;      // Real length of the mate on the board, counted on its
                            // solution: what the page shows. mat5.csv holds the Lichess
                            // theme "Mate in 5 or more", so it can exceed currentLevel
let solutionMoves = [];
let currentMoveIndex = 0;
let isPlayerTurn = false;   // False until the first puzzle is on the board: the
                            // starting position shown while it loads is no puzzle
let pendingMove = null; // For the promotion
let boardOrientation = 'white';
let puzzleGeneration = 0;   // Incremented when a puzzle is requested, when it replaces
                            // the previous one on the board, when it is restarted and
                            // when it is left: delayed callbacks compare it to detect
                            // they belong to a stale puzzle, or to an attempt replaced
                            // by a retry
let solutionPlaying = false; // True while the solution animation runs
let puzzleOver = false;      // True once the current puzzle is over (mate found, or
                             // solution played to the end): only then can Retry restart it
let puzzleReplayed = false;  // True once the current puzzle has been restarted with Retry:
                             // a mate found in a replay is not counted in the stats
let selectedSquare = null;   // Square of the piece picked by a tap (or a click), waiting
                             // for a second tap on its destination
let dragging = false;        // True between a drag start accepted by onDragStart and its drop
let mysteryMode = false;     // True after the "Mate in ?" button: the level of each
                             // puzzle is drawn at random and hidden until its end
let mysteryRevealed = false; // True once the level of the current puzzle is shown
                             // (mate found or solution shown); only read in mystery mode
let mysteryLevels = [];      // Levels the mystery mode draws from: those with a
                             // button, that is with a puzzle file (filled at startup)

// Passed to startLevel by the "Mate in ?" button, instead of a level number
const MYSTERY = 'mystery';

// Session stats
let stats = {
    attempted: 0,
    solved: 0
};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    // Initialize chess.js
    if (typeof Chess === 'undefined') {
        showStatus('Error: Chess.js not loaded', 'error');
        return;
    }
    game = new Chess();

    // Attach the events to the level buttons. [data-level] leaves out the
    // "Mate in ?" button, which shares their look but not their handler
    document.querySelectorAll('.level-btn[data-level]').forEach(btn => {
        btn.addEventListener('click', function() {
            const level = parseInt(this.dataset.level);
            startLevel(level);
        });
    });

    // Mystery level: the draw is made among the levels that have a button,
    // that is a puzzle file (index.php only lists the files that exist).
    // The "Mate in ?" button itself only exists with at least two levels
    mysteryLevels = Array.from(document.querySelectorAll('.level-btn[data-level]'),
                               btn => parseInt(btn.dataset.level, 10));
    const mysteryBtn = document.getElementById('mysteryBtn');
    if (mysteryBtn) {
        mysteryBtn.addEventListener('click', function() {
            startLevel(MYSTERY);
        });
    }

    // Attach the events to the promotion buttons
    document.querySelectorAll('.promotion-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const piece = this.dataset.piece;
            completePromotion(piece);
        });
    });

    // Main controls and the promotion cancel button. Attached here rather
    // than with onclick attributes in index.php: an inline handler needs
    // script-src 'unsafe-inline', which would defeat a strict content
    // security policy (see docs/hardening.md)
    const controls = {
        newPuzzleBtn: loadNewPuzzle,
        flipBtn: flipBoard,
        solutionBtn: showSolution,
        retryBtn: retryMove,
        menuBtn: backToMenu,
        promotionCancelBtn: cancelPromotion
    };
    Object.keys(controls).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', controls[id]);
    });

    console.log('✓ Puzzle Trainer initialized');
});

// ============================================
// LEVEL MANAGEMENT
// ============================================

function startLevel(level) {
    // The "Mate in ?" button passes MYSTERY instead of a level number: the
    // level of each puzzle is then drawn in loadNewPuzzle, which also sets
    // currentLevel once that puzzle is on the board. A level button leaves
    // the mystery mode.
    mysteryMode = (level === MYSTERY);
    if (!mysteryMode) {
        currentLevel = level;
    }
    
    // Hide the selector, show the game area
    document.getElementById('levelSelector').style.display = 'none';
    document.getElementById('gameArea').style.display = 'block';
    
    // Initialize the board if needed
    if (!board) {
        initializeBoard();
    }
    
    // Load a puzzle
    loadNewPuzzle();
}

function backToMenu() {
    puzzleGeneration++;     // stops any pending animation of the current puzzle
    clearSelection();
    document.getElementById('gameArea').style.display = 'none';
    document.getElementById('levelSelector').style.display = 'block';
    showStatus('Select a level to get started', 'info');
}

// ============================================
// MYSTERY LEVEL ("Mate in ?" button)
// ============================================

/**
 * Draws the level of the next mystery puzzle: uniform among the available
 * levels (each one has the same chance, whatever its number of puzzles) and
 * independent of the previous draws, so that the sequence gives nothing
 * away. The same level therefore comes back twice in a row from time to
 * time: one time in five with five levels.
 */
function drawMysteryLevel() {
    return mysteryLevels[Math.floor(Math.random() * mysteryLevels.length)];
}

/**
 * True while the level of the current puzzle must stay hidden: mystery
 * mode, and the puzzle is not over yet.
 */
function isLevelHidden() {
    return mysteryMode && !mysteryRevealed;
}

/**
 * Shows the level of the current mystery puzzle once it is over (mate
 * found or solution shown): level, progress and Lichess link. Does
 * nothing outside the mystery mode, when the level is already shown, or
 * when no puzzle could be loaded yet.
 */
function revealMysteryLevel() {
    if (!isLevelHidden() || !currentPuzzle) return;
    mysteryRevealed = true;
    updatePuzzleInfo();
    updateProgress();
}

// ============================================
// CHESSBOARD
// ============================================

function initializeBoard() {
    if (typeof Chessboard === 'undefined') {
        showStatus('Error: Chessboard.js not loaded', 'error');
        return;
    }

    const config = {
        draggable: true,
        position: 'start',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        onSnapbackEnd: onSnapbackEnd,
        pieceTheme: 'vendor/img/chesspieces/wikipedia/{piece}.png'
    };

    board = Chessboard('board', config);

    // Tap-to-move: a tap (or a click) on a piece selects it, a second tap on
    // the destination plays the move. The first tap is seen by chessboard.js
    // as a drag without movement and is handled in onDrop; the second one is
    // a plain click on a square, which chessboard.js does not report, so the
    // board is listened to directly. A touch screen fires a click after a
    // tap, so one handler covers both the mouse and the finger.
    const boardEl = document.getElementById('board');
    boardEl.addEventListener('click', onSquareClick);

    // A tap on a piece is already handled through onDrop: suppress the mouse
    // events and the click the browser would synthesize from that same tap,
    // so it can never be processed twice. Taps on other squares (no drag in
    // progress) keep their click, which onSquareClick needs.
    boardEl.addEventListener('touchend', function(e) {
        if (dragging) e.preventDefault();
    });

    console.log('✓ Board initialized');
}

function onDragStart(source, piece, position, orientation) {
    // Do not move if it is not the player's turn
    if (!isPlayerTurn) return false;
    
    // Do not move if the game is over
    if (game.game_over()) return false;

    // Only move the pieces of the side to move
    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }

    dragging = true;
}

function onDrop(source, target) {
    dragging = false;

    // A piece picked up and dropped back on its own square is a tap (or a
    // click) on that piece: toggle its selection and put it back. The move
    // itself comes with the next tap, see onSquareClick.
    if (source === target) {
        toggleSelection(source);
        return 'snapback';
    }

    // A real drag replaces any pending tap selection
    clearSelection();

    return requestMove(source, target);
}

/**
 * Plays a move asked either by a drag or by two taps. A pawn reaching the
 * last rank opens the promotion modal and the move waits for the choice;
 * any other move goes straight to tryMove.
 * Returns 'snapback' when the move is refused, so that onDrop can put the
 * dragged piece back.
 */
function requestMove(source, target) {
    // Check whether this is a promotion
    const piece = game.get(source);
    if (piece && piece.type === 'p') {
        const targetRank = target.charAt(1);
        if ((piece.color === 'w' && targetRank === '8') ||
            (piece.color === 'b' && targetRank === '1')) {
            // Store the pending move and show the modal
            pendingMove = { from: source, to: target };
            showPromotionModal();
            return; // Do not return 'snapback', we wait for the selection
        }
    }

    // Regular move
    return tryMove(source, target, 'q');
}

function tryMove(source, target, promotion) {
    // Try the move
    const move = game.move({
        from: source,
        to: target,
        promotion: promotion
    });

    // Illegal move
    if (move === null) {
        return 'snapback';
    }

    // Build the UCI move for comparison
    let uciMove = source + target;
    if (move.promotion) {
        uciMove += move.promotion;
    }

    // Check whether this is the right move
    const expectedMove = solutionMoves[currentMoveIndex];
    
    if (normalizeMove(uciMove) === normalizeMove(expectedMove)) {
        // Correct move!
        onCorrectMove(move);
    } else if (game.in_checkmate()) {
        // Another mate than the one of the solution: the puzzle is solved
        // all the same, as on Lichess, whose puzzle database states that
        // any move that checkmates should win the puzzle. Only the last
        // move of a line can have several answers: the Lichess generator
        // keeps a puzzle only when every earlier move is the only good one.
        // The index jumps to the end of the solution, as after the last
        // expected move, so that the end of the puzzle is the same in both
        // cases (progress, mystery reveal, Solution button), even for a
        // mate found before the end of the line.
        currentMoveIndex = solutionMoves.length;
        onPuzzleSolved();
    } else {
        // Incorrect move
        onIncorrectMove(move, expectedMove);
    }
}

function onSnapEnd() {
    board.position(game.fen());
}

// ============================================
// TAP-TO-MOVE (touch screens, works with a mouse too)
// ============================================

/**
 * Second half of tap-to-move: the tap on the destination square.
 *
 * The first tap, on the piece, never reaches this handler: it starts a drag
 * in chessboard.js, whose ghost image then sits under the finger (or the
 * pointer), so the click the browser fires afterwards lands outside the
 * board (on the ghost, or on the common ancestor of the mousedown and
 * mouseup targets). That tap is detected in onDrop instead
 * (source === target). Squares holding a piece of the side to move are
 * ignored here anyway, so a tap can never be handled twice.
 */
function onSquareClick(e) {
    const squareEl = e.target.closest('[data-square]');
    if (!squareEl) return;
    const square = squareEl.dataset.square;

    // Nothing selected: a tap on an empty square or an enemy piece does nothing
    if (!selectedSquare) return;

    // Same rules as a drag: the player's turn, game not over, no promotion pending
    if (!isPlayerTurn || game.game_over() || pendingMove) return;

    // Taps on the player's own pieces are handled by onDrop
    const piece = game.get(square);
    if (piece && piece.color === game.turn()) return;

    // Tap on the destination: play the move
    const source = selectedSquare;
    clearSelection();
    requestMove(source, square);

    // No drag happened, so the board has to be redrawn by hand. A pending
    // promotion leaves the pawn where it is until a piece is chosen.
    if (!pendingMove) {
        board.position(game.fen());
    }
}

function toggleSelection(square) {
    if (selectedSquare === square) {
        clearSelection();
    } else {
        selectSquare(square);
    }
}

function selectSquare(square) {
    selectedSquare = square;
    refreshSelectionHighlight();
}

function clearSelection() {
    selectedSquare = null;
    refreshSelectionHighlight();
}

function refreshSelectionHighlight() {
    document.querySelectorAll('.highlight-selected').forEach(el => {
        el.classList.remove('highlight-selected');
    });
    if (selectedSquare) {
        highlightSquare(selectedSquare, 'selected');
    }
}

// Safety net: once a piece has snapped back to its square (which is what a
// tap on a piece does), chessboard.js removes its own highlight classes and
// re-appends the piece images; the squares and their classes survive, so
// this only re-applies a highlight that is still there. Kept in case a
// future version of the library rebuilds the squares as well.
function onSnapbackEnd() {
    refreshSelectionHighlight();
}

function normalizeMove(move) {
    return move.toLowerCase().trim();
}

// ============================================
// PUZZLE LOGIC
// ============================================

async function loadNewPuzzle() {
    puzzleGeneration++;
    const generation = puzzleGeneration;
    // True once the new puzzle starts replacing the previous one on the
    // board (below): an error raised from there on belongs to this load,
    // even though the generation has moved on
    let replacing = false;
    solutionPlaying = false;
    clearSelection();
    showStatus('Loading puzzle...', 'info');
    setGameMessage('Loading...', '');
    
    // The previous puzzle is being left: Retry is hidden until the puzzle on
    // the board is over again. The previous puzzle stays on the board, and
    // playable, until the new one replaces it, or for good if the load fails
    // (the New puzzle button stays available). If it is finished in the
    // meantime (mate or solution), Retry shows up again, and restarting it
    // drops the pending load: the last action wins. The session stats are
    // not affected, a replay is never counted
    puzzleOver = false;
    document.getElementById('retryBtn').style.display = 'none';

    // Level asked for: the chosen one, or in mystery mode a new draw for
    // every puzzle. currentLevel only takes it once the puzzle is on the
    // board (below), so that it always matches the position displayed,
    // even if the previous puzzle is finished while this one is loading
    const requestedLevel = mysteryMode ? drawMysteryLevel() : currentLevel;
    
    try {
        const response = await fetch('puzzle.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: requestedLevel })
        });

        const data = await response.json();

        // A newer puzzle was requested while this one was loading: drop it
        if (generation !== puzzleGeneration) return;

        if (data.error) {
            throw new Error(data.error);
        }

        // The new puzzle replaces the previous one. The generation was bumped
        // when it was requested, but the previous puzzle has stayed on the
        // board and playable since: a callback created in between (the
        // opponent's reply to a move, a solution animation started with S)
        // holds the same value, and would run on the new puzzle. Bumping it
        // again here makes every callback created so far stale. Nothing is
        // asynchronous from here to the end of the replacement, so no
        // callback can run in the middle of it
        puzzleGeneration++;
        replacing = true;
        // What the previous puzzle may have left behind, and that no stale
        // callback will clear any more: a solution animation stopped this way
        // leaves solutionPlaying set (S would be ignored on the new puzzle),
        // and a promotion asked on the previous position would be played on
        // the new one once a piece is chosen
        solutionPlaying = false;
        pendingMove = null;
        hidePromotionModal();

        // Store the puzzle
        currentPuzzle = data.puzzle;
        mysteryRevealed = false;        // a new mystery puzzle starts hidden
        // A new puzzle is a first attempt, not over yet. Reset here as well
        // as above: the previous puzzle stays playable while this one loads,
        // and may have been finished in the meantime (mate or solution)
        puzzleReplayed = false;
        puzzleOver = false;
        document.getElementById('retryBtn').style.display = 'none';
        solutionMoves = currentPuzzle.solution.split(' ');
        // Level of the puzzle now on the board: the chosen one, or the one
        // drawn in mystery mode. It stays a level, 1 to 5: outside the
        // mystery mode it is also the level asked for the next puzzle (see
        // requestedLevel above), and puzzle.php refuses any other value.
        currentLevel = requestedLevel;
        // Real length of the mate, counted on the solution (the player plays
        // the first and the last move), shown in both modes: mat5.csv holds
        // the Lichess theme "Mate in 5 or more", every mate of five moves or
        // longer, so a puzzle of the Mate in 5+ level can be a mate in 7, and
        // the page must name the mate that is actually played. For levels 1
        // to 4 both values are the same.
        mateLength = Math.ceil(solutionMoves.length / 2);
        currentMoveIndex = 0;
        isPlayerTurn = true;

        // Load the position
        game.load(currentPuzzle.fen);
        
        // Orient the board according to the side to move
        const newOrientation = currentPuzzle.turn === 'w' ? 'white' : 'black';
        if (newOrientation !== boardOrientation) {
            boardOrientation = newOrientation;
            board.orientation(newOrientation);
        }
        
        board.position(currentPuzzle.fen);

        // A piece tapped on the previous position while this one was
        // loading would stay selected on the new one: drop it
        clearSelection();

        // Update the interface
        updatePuzzleInfo();
        updateProgress();
        // Mystery mode: the level stays hidden until the end of the puzzle
        setGameMessage(isLevelHidden() ? '🎯 Find the mate!' :
                       '🎯 Find the mate in ' + mateLength + '!', '');
        showStatus('Puzzle loaded - Your move!', 'success');

        // Stats
        stats.attempted++;
        updateStats();

    } catch (error) {
        // A request that was superseded (by a newer one, a retry or the
        // menu) and fails afterwards, on a network error or an invalid
        // response, must not show its error over the puzzle on the board.
        // Once the new puzzle has started replacing the previous one, the
        // generation has moved on because of that very replacement: an
        // error raised from there on belongs to this load, and is shown
        if (!replacing && generation !== puzzleGeneration) return;
        showStatus('Error: ' + error.message, 'error');
        setGameMessage('Loading error', 'error');
    }
}

function onCorrectMove(move) {
    currentMoveIndex++;
    
    // Check whether this is the last move (mate found)
    if (currentMoveIndex >= solutionMoves.length) {
        onPuzzleSolved();
        return;
    }

    // Moves remain - the opponent has to reply
    setGameMessage('✓ Excellent!', 'success');
    
    // Play the opponent's reply after a delay, unless another puzzle has been
    // loaded in the meantime
    const generation = puzzleGeneration;
    isPlayerTurn = false;
    setTimeout(() => {
        if (generation !== puzzleGeneration) return;
        playOpponentMove();
    }, 500);
}

function playOpponentMove() {
    const opponentMove = solutionMoves[currentMoveIndex];
    
    // Parse the UCI move
    const from = opponentMove.substring(0, 2);
    const to = opponentMove.substring(2, 4);
    const promotion = opponentMove.length > 4 ? opponentMove.charAt(4) : undefined;

    // Play the move
    const move = game.move({
        from: from,
        to: to,
        promotion: promotion
    });

    if (move) {
        board.position(game.fen());
        currentMoveIndex++;
        updateProgress();
        
        // Highlight the opponent's move
        highlightSquare(from, 'opponent');
        highlightSquare(to, 'opponent');
        
        const generation = puzzleGeneration;
        setTimeout(() => {
            clearHighlights();
            if (generation !== puzzleGeneration) return;   // stale puzzle
            setGameMessage('👤 Opponent played ' + opponentMove.toUpperCase() + ' - Your move!', 'info');
            isPlayerTurn = true;
        }, 300);
    }
}

function onIncorrectMove(move, expected) {
    // Undo the move: the player stays on the same move of the line and just
    // tries another one, no button needed. The Retry button only appears
    // once the puzzle is over, to restart it from its start (retryMove)
    game.undo();
    board.position(game.fen());
    
    setGameMessage('❌ That\'s not the right move! Try again.', 'error');
    
    isPlayerTurn = true;
}

function onPuzzleSolved() {
    // A replay (Retry button) is not a new attempt: its mate is not counted,
    // so that replaying a puzzle never adds to the solved count, whether it
    // was solved before or its solution was shown
    if (!puzzleReplayed) {
        stats.solved++;
        updateStats();
    }
    
    // Mystery mode: the puzzle is over, its level can be shown
    let message = '🎉 Well done! Checkmate!';
    if (mysteryMode) {
        revealMysteryLevel();
        message += ' It was a mate in ' + mateLength + '.';
    }
    setGameMessage(message, 'success');
    showStatus('Puzzle solved! Retry it or load another one.', 'success');
    
    isPlayerTurn = false;
    setPuzzleOver();
}

/**
 * Marks the current puzzle as over (mate found, or solution played to the
 * end) and shows the Retry button, which restarts it from its start.
 */
function setPuzzleOver() {
    // The Solution button works before any puzzle could be loaded (it then
    // plays nothing): there is nothing to restart yet
    if (!currentPuzzle) return;
    puzzleOver = true;
    document.getElementById('retryBtn').style.display = 'inline-block';
}

/**
 * Retry button and R key: restarts the current puzzle from its starting
 * position, once it is over. The puzzle is not requested again: its
 * position and its solution are still in memory, so puzzle.php is not
 * called. The board keeps its orientation, a revealed mystery level stays
 * revealed, and the replay changes neither the attempts nor the solved
 * count (see onPuzzleSolved).
 */
function retryMove() {
    // Only a finished puzzle can be restarted: puzzleOver is set by the mate
    // or at the end of the solution animation, and cleared as soon as a new
    // puzzle starts loading
    if (!puzzleOver || !currentPuzzle) return;

    // Stop anything still pending on the previous attempt (a delayed
    // callback, a solution animation still running), as loadNewPuzzle does
    puzzleGeneration++;
    solutionPlaying = false;
    puzzleOver = false;
    puzzleReplayed = true;
    pendingMove = null;
    hidePromotionModal();
    clearSelection();
    clearHighlights();
    document.getElementById('retryBtn').style.display = 'none';

    // Back to the starting position of the puzzle
    currentMoveIndex = 0;
    game.load(currentPuzzle.fen);
    board.position(currentPuzzle.fen);
    isPlayerTurn = true;

    // A puzzle is over only once its mystery level has been revealed, so the
    // first branch is a safety net
    updateProgress();
    setGameMessage(isLevelHidden() ? 'Find the mate again!' :
                   'Find the mate in ' + mateLength + ' again!', 'info');
    showStatus('Puzzle restarted - Your move!', 'success');
}

function showSolution() {
    if (solutionPlaying) return;   // already running (S pressed twice)
    const remaining = solutionMoves.slice(currentMoveIndex).join(' ').toUpperCase();
    // Mystery mode: showing the solution ends the puzzle, its level can be
    // shown (currentPuzzle is null only if no puzzle could be loaded yet)
    let message = '💡 Solution: ' + remaining;
    if (mysteryMode && currentPuzzle) {
        revealMysteryLevel();
        message += ' (mate in ' + mateLength + ')';
    }
    setGameMessage(message, 'info');
    
    // Visually play all the remaining moves
    playSolutionAnimated();
}

async function playSolutionAnimated() {
    const generation = puzzleGeneration;
    // Puzzle whose solution is played. A puzzle still loading when the
    // animation starts can replace it before the end: the load bumps the
    // generation again when it replaces this one, which stops the animation
    // at its next pause, so the check at the end is only a safety net
    const puzzle = currentPuzzle;
    solutionPlaying = true;
    isPlayerTurn = false;
    clearSelection();
    
    for (let i = currentMoveIndex; i < solutionMoves.length; i++) {
        const move = solutionMoves[i];
        const from = move.substring(0, 2);
        const to = move.substring(2, 4);
        const promotion = move.length > 4 ? move.charAt(4) : undefined;

        await new Promise(resolve => setTimeout(resolve, 600));

        // Another puzzle was loaded (or the menu opened) during the pause:
        // stop here instead of playing stale moves on the new position
        if (generation !== puzzleGeneration) return;

        game.move({ from, to, promotion });
        board.position(game.fen());
    }

    solutionPlaying = false;
    // Only the puzzle the animation belongs to is over, not a puzzle loaded
    // while it was running: Retry would restart a puzzle never played
    if (currentPuzzle === puzzle) {
        showStatus('Solution shown. Retry it or load a new puzzle.', 'warning');
        setPuzzleOver();
    }
}

// ============================================
// PROMOTION
// ============================================

function showPromotionModal() {
    document.getElementById('promotionModal').style.display = 'flex';
}

function hidePromotionModal() {
    document.getElementById('promotionModal').style.display = 'none';
}

function completePromotion(piece) {
    hidePromotionModal();
    
    if (pendingMove) {
        tryMove(pendingMove.from, pendingMove.to, piece);
        pendingMove = null;
        // Show the promoted piece: after two taps nothing else redraws the
        // board, and after a drag the pawn was put back while the modal was open
        board.position(game.fen());
    }
}

function cancelPromotion() {
    hidePromotionModal();
    pendingMove = null;
    if (board) {
        board.position(game.fen()); // Put the piece back
    }
}

// ============================================
// INTERFACE
// ============================================

function flipBoard() {
    board.flip();
    boardOrientation = boardOrientation === 'white' ? 'black' : 'white';
    refreshSelectionHighlight();    // the flip redraws the board
}

function updatePuzzleInfo() {
    // Real length of the mate, not the number of the level button (a puzzle
    // of the Mate in 5+ level can be a mate in 7). Mystery mode: "Mate in ?"
    // until the end of the puzzle
    document.getElementById('currentLevel').textContent =
        'Mate in ' + (isLevelHidden() ? '?' : mateLength);
    document.getElementById('currentPlayer').textContent = currentPuzzle.turn === 'w' ? 'White' : 'Black';
    document.getElementById('openingName').textContent = currentPuzzle.opening || '-';
    const link = document.getElementById('lichessLink');
    if (isLevelHidden()) {
        // Mystery mode: the link opens the source game at the puzzle
        // position, whose continuation would give the level away. Without
        // href the anchor is no longer a link (neither clickable nor
        // focusable) until the end of the puzzle; style.css greys it out
        link.removeAttribute('href');
    } else {
        // The URL comes from the puzzle data: only a Lichess address becomes a
        // link, anything else leaves the link inert (puzzle.php checks it too)
        link.href =
            /^https:\/\/lichess\.org\//.test(currentPuzzle.url) ? currentPuzzle.url : '#';
    }
}

function updateProgress() {
    const playerMoves = Math.ceil((currentMoveIndex + 1) / 2);
    // The total is the real length of the mate, so that a mate in 7 of the
    // Mate in 5+ level never shows "6 / 5". Mystery mode: hidden until the
    // end of the puzzle
    const totalMoves = isLevelHidden() ? '?' : mateLength;
    document.getElementById('moveProgress').textContent = playerMoves + ' / ' + totalMoves;
}

function updateStats() {
    document.getElementById('statAttempted').textContent = stats.attempted;
    document.getElementById('statSolved').textContent = stats.solved;
    
    if (stats.attempted > 0) {
        const rate = Math.round((stats.solved / stats.attempted) * 100);
        document.getElementById('statRate').textContent = rate + '%';
    }
}

function setGameMessage(message, type) {
    const el = document.getElementById('gameMessage');
    el.textContent = message;
    el.className = 'game-message' + (type ? ' ' + type : '');
}

function showStatus(message, type) {
    const el = document.getElementById('status');
    el.textContent = message;
    el.className = 'status ' + type;
}

function highlightSquare(square, type) {
    const squareEl = document.querySelector('.square-' + square);
    if (squareEl) {
        squareEl.classList.add('highlight-' + type);
    }
}

function clearHighlights() {
    document.querySelectorAll('.highlight-move, .highlight-opponent').forEach(el => {
        el.classList.remove('highlight-move', 'highlight-opponent');
    });
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

document.addEventListener('keydown', function(e) {
    // Leave the browser shortcuts alone (Ctrl+F, Ctrl+S, Ctrl+N, Cmd+..., Alt+...)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // The game shortcuts only make sense once a level has been started
    const inGame = document.getElementById('gameArea').style.display !== 'none';

    // N: New puzzle
    if (e.key === 'n' || e.key === 'N') {
        if (inGame) loadNewPuzzle();
    }
    
    // F: Flip the board
    if (e.key === 'f' || e.key === 'F') {
        if (inGame && board) flipBoard();
    }
    
    // S: Show the solution
    if (e.key === 's' || e.key === 'S') {
        if (inGame && currentPuzzle) showSolution();
    }
    
    // R: Retry the puzzle from its start, once it is over (retryMove
    // ignores the key before that, like the hidden button)
    if (e.key === 'r' || e.key === 'R') {
        if (inGame) retryMove();
    }

    // Esc: Close the promotion modal, drop the tap selection
    if (e.key === 'Escape') {
        cancelPromotion();
        clearSelection();
    }
});

console.log('✓ Application loaded');
