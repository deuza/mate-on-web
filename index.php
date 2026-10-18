<?php
/**
 * Lichess Puzzle Trainer - Web interface
 * Mate in X moves training
 */
header('Content-Type: text/html; charset=UTF-8');

// Detect the available CSV files and their puzzle counts.
// download_puzzles.sh writes the line count of each matN.csv into matN.count,
// which spares scanning the whole file (up to ~100 MB) on every page load.
// Fallback: count the lines when the .count file is missing, empty, or older
// than its CSV (for example after a manual run of extract.py).
$availableLevels = [];
for ($i = 1; $i <= 5; $i++) {
    $filename = "mat{$i}.csv";
    if (file_exists($filename)) {
        $count = 0;
        $countFile = "mat{$i}.count";
        if (file_exists($countFile) && filemtime($countFile) >= filemtime($filename)) {
            $count = (int) trim((string) file_get_contents($countFile));
        }
        if ($count <= 0) {
            $handle = fopen($filename, 'r');
            if ($handle) {
                while (fgets($handle) !== false) {
                    $count++;
                }
                fclose($handle);
            }
        }
        if ($count > 0) {
            $availableLevels[$i] = $count;
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mat On Web - Mate in X moves</title>
    
    <!-- Chessboard.js CSS (local copy, see vendor/README.md) -->
    <link rel="stylesheet" href="vendor/chessboard-1.0.0.min.css">
    
    <!-- Custom styles -->
    <link rel="stylesheet" href="style.css">

    <!-- Favicon -->
    <link rel="icon" href="favicon.ico" sizes="any">
</head>
<body>
    <div class="header">
        <h1>♟️  Mate On Web ♟️</h1>
        <p class="subtitle">Mate training • Powered by DeuZa</p>
    </div>

    <div id="status" class="status info">Select a level to get started</div>

    <!-- Level selector -->
    <div class="level-selector" id="levelSelector">
        <h3>🎯 Choose your level</h3>
        <div class="level-buttons">
            <?php if (empty($availableLevels)): ?>
                <p class="no-puzzles">No puzzle file found.<br>
                Run <code>./download_puzzles.sh</code> to generate them.</p>
            <?php else: ?>
                <?php foreach ($availableLevels as $level => $count): ?>
                    <button class="level-btn" data-level="<?= $level ?>">
                        <span class="level-number">Mate in <?= $level ?></span>
                        <span class="level-count"><?= number_format($count) ?> puzzles</span>
                    </button>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>
    </div>

    <!-- Game area (hidden at startup) -->
    <div class="game-area" id="gameArea" style="display: none;">
        
        <!-- Main controls -->
        <div class="controls">
            <button onclick="loadNewPuzzle()" id="newPuzzleBtn">🎲 New puzzle</button>
            <button onclick="flipBoard()" id="flipBtn">🔄 Flip board</button>
            <button onclick="showSolution()" id="solutionBtn">💡 Solution</button>
            <button onclick="retryMove()" id="retryBtn" style="display: none;">🔁 Retry</button>
            <button onclick="backToMenu()" id="menuBtn">📋 Change level</button>
        </div>

        <div class="main-container">
            <!-- Chessboard -->
            <div class="board-wrapper">
                <div id="board" class="chess-board"></div>
            </div>

            <!-- Info panel -->
            <div class="info-panel">
                <!-- Puzzle information -->
                <div class="section">
                    <h3>🧩 Current puzzle</h3>
                    <div class="info-grid">
                        <div class="info-row">
                            <span class="info-label">Level:</span>
                            <span class="info-value" id="currentLevel">-</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">To move:</span>
                            <span class="info-value" id="currentPlayer">-</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Progress:</span>
                            <span class="info-value" id="moveProgress">-</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Opening:</span>
                            <span class="info-value opening" id="openingName">-</span>
                        </div>
                    </div>
                </div>

                <!-- Game messages -->
                <div class="section">
                    <h3>💬 Message</h3>
                    <div id="gameMessage" class="game-message">
                        Find the mate!
                    </div>
                </div>

                <!-- Lichess link -->
                <div class="section">
                    <h3>🔗 Source</h3>
                    <a href="#" id="lichessLink" target="_blank" class="lichess-link">
                        View on Lichess.org
                    </a>
                </div>

                <!-- Session stats -->
                <div class="section">
                    <h3>📊 Session</h3>
                    <div class="info-grid">
                        <div class="info-row">
                            <span class="info-label">Attempted:</span>
                            <span class="info-value" id="statAttempted">0</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Solved:</span>
                            <span class="info-value" id="statSolved">0</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Success rate:</span>
                            <span class="info-value" id="statRate">-</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Promotion modal -->
    <div id="promotionModal" class="modal" style="display: none;">
        <div class="modal-content">
            <h3>Pawn promotion</h3>
            <div class="promotion-pieces">
                <button class="promotion-btn" data-piece="q">♛ Queen</button>
                <button class="promotion-btn" data-piece="r">♜ Rook</button>
                <button class="promotion-btn" data-piece="b">♝ Bishop</button>
                <button class="promotion-btn" data-piece="n">♞ Knight</button>
            </div>
            <button class="cancel-btn" onclick="cancelPromotion()">Cancel</button>
        </div>
    </div>

    <!-- jQuery (required by chessboard.js), local copy -->
    <script src="vendor/jquery-3.7.1.min.js"></script>
    
    <!-- Local chess.js -->
    <script src="chess.js"></script>
    
    <!-- Chessboard.js, local copy -->
    <script src="vendor/chessboard-1.0.0.min.js"></script>
    
    <!-- Main application -->
    <script src="app.js"></script>

<p align="center" style="color: white;">
  With ❤️ by <a href="https://github.com/deuza" style="color: white;">DeuZa</a> —
  Program released under the
  <a href="https://creativecommons.org/publicdomain/zero/1.0/" style="color: white;">CC0</a> license,
  available at:
  <a href="https://github.com/deuza/mate-on-web" style="color: white;">github.com/deuza/mat-on-web</a>
</p>


</body>
</html>
