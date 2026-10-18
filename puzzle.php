<?php
/**
 * puzzle.php - API to load a random puzzle
 * Receives: POST {level: 1-5}
 * Returns: JSON {fen, solution, url, opening, error?}
 */

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-cache, no-store, must-revalidate');

// Error response
function errorResponse($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

// Check the method
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    errorResponse('Method not allowed. Use POST.', 405);
}

// Read the JSON
$input = json_decode(file_get_contents('php://input'), true);

if (!$input || !isset($input['level'])) {
    errorResponse('Missing "level" parameter');
}

$level = intval($input['level']);

// Validate the level
if ($level < 1 || $level > 5) {
    errorResponse('Invalid level. Choose between 1 and 5.');
}

// Check the file
$filename = "mat{$level}.csv";

if (!file_exists($filename)) {
    errorResponse("File {$filename} not found. Run download_puzzles.sh", 404);
}

// Pick a random line in constant time, whatever the file size: seek to a
// random byte offset, skip the (partial) line we landed in, then read the next
// full line. Landing in the last line wraps around to the first one. Each line
// is drawn with a probability proportional to the length of the line before
// it; puzzle lines all have similar lengths, so the draw is close to uniform.
$size = filesize($filename);
if ($size === false || $size === 0) {
    errorResponse("File {$filename} is empty", 404);
}

$handle = fopen($filename, 'r');
if (!$handle) {
    errorResponse("Unable to open {$filename}", 500);
}

$offset = mt_rand(0, $size - 1);
fseek($handle, $offset);
if ($offset > 0) {
    fgets($handle);   // discard the rest of the line we landed in
}
$puzzleLine = fgets($handle);
if ($puzzleLine === false || trim($puzzleLine) === '') {
    rewind($handle);  // we were in the last line: wrap around to the first one
    $puzzleLine = fgets($handle);
}
fclose($handle);

$puzzleLine = ($puzzleLine === false) ? '' : trim($puzzleLine);
if ($puzzleLine === '') {
    errorResponse("Error while reading the puzzle", 500);
}

// Parse the CSV line
// Format: PuzzleId,FEN,Solution,URL,OpeningTags
$fields = str_getcsv($puzzleLine, ',', '"', '');

if (count($fields) < 4) {
    errorResponse("Invalid CSV format", 500);
}

$puzzleId = $fields[0];
$fen = $fields[1];
$solution = $fields[2];
$url = $fields[3];
$opening = isset($fields[4]) ? trim($fields[4]) : '';

// Lichess gives up to two space-separated tags, the family then the variation
// (e.g. "Sicilian_Defense Sicilian_Defense_Dragon_Variation"): keep the last
// one, the most specific, and replace the underscores
if ($opening !== '') {
    $tags = preg_split('/\s+/', $opening);
    $opening = str_replace('_', ' ', end($tags));
}

// Basic FEN validation
if (strpos($fen, '/') === false || strpos($fen, ' ') === false) {
    errorResponse("Invalid FEN in puzzle", 500);
}

// Determine who is to move (for the orientation)
$fenParts = explode(' ', $fen);
$turn = isset($fenParts[1]) ? $fenParts[1] : 'w';

// Response
echo json_encode([
    'success' => true,
    'puzzle' => [
        'id' => $puzzleId,
        'fen' => $fen,
        'solution' => $solution,
        'url' => $url,
        'opening' => $opening,
        'turn' => $turn,
        'level' => $level
    ]
]);
