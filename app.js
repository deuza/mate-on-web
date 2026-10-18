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

    // Attach the events to the level buttons
    document.querySelectorAll('.level-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const level = parseInt(this.dataset.level);
            startLevel(level);
        });
    });

    // Attach the events to the promotion buttons
    document.querySelectorAll('.promotion-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const piece = this.dataset.piece;
            completePromotion(piece);
        });
    });

    console.log('✓ Puzzle Trainer initialized');
});

// ============================================
// LEVEL MANAGEMENT
// ============================================

function startLevel(level) {
    currentLevel = level;
    
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
    document.getElementById('gameArea').style.display = 'none';
    document.getElementById('levelSelector').style.display = 'block';
    showStatus('Select a level to get started', 'info');
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
        pieceTheme: 'vendor/img/chesspieces/wikipedia/{piece}.png'
    };

    board = Chessboard('board', config);
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
}

function onDrop(source, target) {
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
    showStatus('Loading puzzle...', 'info');
    setGameMessage('Loading...', '');
    
    document.getElementById('retryBtn').style.display = 'none';
    
    try {
        const response = await fetch('puzzle.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: currentLevel })
        });

        const data = await response.json();

        // A newer puzzle was requested while this one was loading: drop it
        if (generation !== puzzleGeneration) return;

        if (data.error) {
            throw new Error(data.error);
        }

        // Store the puzzle
        currentPuzzle = data.puzzle;
        solutionMoves = currentPuzzle.solution.split(' ');
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

        // Update the interface
        updatePuzzleInfo();
        updateProgress();
        setGameMessage('🎯 Find the mate in ' + currentLevel + '!', '');
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
    
    setGameMessage('🎉 Well done! Checkmate!', 'success');
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
    setGameMessage('💡 Solution: ' + remaining, 'info');
    
    // Visually play all the remaining moves
    playSolutionAnimated();
}

async function playSolutionAnimated() {
    const generation = puzzleGeneration;
    solutionPlaying = true;
    isPlayerTurn = false;
    
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
}

function updatePuzzleInfo() {
    document.getElementById('currentLevel').textContent = 'Mate in ' + currentLevel;
    document.getElementById('currentPlayer').textContent = currentPuzzle.turn === 'w' ? 'White' : 'Black';
    document.getElementById('openingName').textContent = currentPuzzle.opening || '-';
    document.getElementById('lichessLink').href = currentPuzzle.url;
}

function updateProgress() {
    const playerMoves = Math.ceil((currentMoveIndex + 1) / 2);
    const totalMoves = currentLevel;
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
    
    // Esc: Close the promotion modal
    if (e.key === 'Escape') {
        cancelPromotion();
    }
});

console.log('✓ Application loaded');
