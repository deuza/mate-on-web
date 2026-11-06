/**
 * app.js - Puzzle Trainer
 * Game logic for mate in X moves
 */

// Global variables
let game = null;
let board = null;
let currentPuzzle = null;
let currentLevel = null;
let solutionMoves = [];
let currentMoveIndex = 0;
let isPlayerTurn = true;
let pendingMove = null; // For the promotion
let boardOrientation = 'white';
let puzzleGeneration = 0;   // Incremented whenever a puzzle is loaded or left: delayed
                            // callbacks compare it to detect they belong to a stale puzzle
let solutionPlaying = false; // True while the solution animation runs
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
    solutionPlaying = false;
    clearSelection();
    showStatus('Loading puzzle...', 'info');
    setGameMessage('Loading...', '');
    
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

        // Store the puzzle
        currentPuzzle = data.puzzle;
        mysteryRevealed = false;        // a new mystery puzzle starts hidden
        solutionMoves = currentPuzzle.solution.split(' ');
        // Level of the puzzle now on the board. Outside the mystery mode it
        // is the chosen level, unchanged. In mystery mode it is the real
        // length of the mate, counted on the solution (the player plays the
        // first and the last move): mat5.csv holds the Lichess theme "Mate
        // in 5 or more", some of whose mates take 6 to 9 moves, and the
        // reveal must name the mate that was actually played. For levels 1
        // to 4 both values are the same.
        currentLevel = mysteryMode ? Math.ceil(solutionMoves.length / 2) : requestedLevel;
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
                       '🎯 Find the mate in ' + currentLevel + '!', '');
        showStatus('Puzzle loaded - Your move!', 'success');

        // Stats
        stats.attempted++;
        updateStats();

    } catch (error) {
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
    // Undo the move
    game.undo();
    board.position(game.fen());
    
    setGameMessage('❌ That\'s not the right move!', 'error');
    document.getElementById('retryBtn').style.display = 'inline-block';
    
    isPlayerTurn = true;
}

function onPuzzleSolved() {
    stats.solved++;
    updateStats();
    
    // Mystery mode: the puzzle is over, its level can be shown
    let message = '🎉 Well done! Checkmate!';
    if (mysteryMode) {
        revealMysteryLevel();
        message += ' It was a mate in ' + currentLevel + '.';
    }
    setGameMessage(message, 'success');
    showStatus('Puzzle solved! Load another one.', 'success');
    
    isPlayerTurn = false;
}

function retryMove() {
    document.getElementById('retryBtn').style.display = 'none';
    setGameMessage('🔄 Try again...', 'info');
    isPlayerTurn = true;
}

function showSolution() {
    if (solutionPlaying) return;   // already running (S pressed twice)
    const remaining = solutionMoves.slice(currentMoveIndex).join(' ').toUpperCase();
    // Mystery mode: showing the solution ends the puzzle, its level can be
    // shown (currentPuzzle is null only if no puzzle could be loaded yet)
    let message = '💡 Solution: ' + remaining;
    if (mysteryMode && currentPuzzle) {
        revealMysteryLevel();
        message += ' (mate in ' + currentLevel + ')';
    }
    setGameMessage(message, 'info');
    
    // Visually play all the remaining moves
    playSolutionAnimated();
}

async function playSolutionAnimated() {
    const generation = puzzleGeneration;
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
    showStatus('Solution shown. Load a new puzzle.', 'warning');
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
    // Mystery mode: "Mate in ?" until the end of the puzzle
    document.getElementById('currentLevel').textContent =
        'Mate in ' + (isLevelHidden() ? '?' : currentLevel);
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
    // Mystery mode: the total is the level, hidden until the end of the puzzle
    const totalMoves = isLevelHidden() ? '?' : currentLevel;
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
    
    // Esc: Close the promotion modal, drop the tap selection
    if (e.key === 'Escape') {
        cancelPromotion();
        clearSelection();
    }
});

console.log('✓ Application loaded');
