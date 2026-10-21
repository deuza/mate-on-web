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

// Read the JSON. A valid request is about a dozen bytes: refuse anything
// bigger before reading it. post_max_size does not bound php://input (PHP
// only logs a warning and the stream stays readable), so the read is capped
// as well, which also covers a chunked body without Content-Length.
$length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($length > 1024) {
    errorResponse('Request body too large', 413);
}
$input = json_decode((string) file_get_contents('php://input', false, null, 0, 1024), true);

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

// Puzzle lines are about 150 bytes: the reads are bounded so that an
// oversized line (a corrupt or hostile file) is never loaded whole. A line
// longer than the bound is served as a fragment, which the validation
// below rejects.
$offset = mt_rand(0, $size - 1);
fseek($handle, $offset);
if ($offset > 0) {
    fgets($handle, 4096);   // discard the rest of the line we landed in
}
$puzzleLine = fgets($handle, 4096);
if ($puzzleLine === false || trim($puzzleLine) === '') {
    rewind($handle);  // we were in the last line: wrap around to the first one
    $puzzleLine = fgets($handle, 4096);
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

// The fields come from the generated CSV, that is from downloaded data: what
// goes out to the browser is validated against its expected shape, so that a
// corrupt or hostile file can never put anything else than a position, a
// move list and a Lichess address in the page.
// FEN: the six fields written by python-chess (placement, side to move,
// castling rights, en passant square, half-move and full-move counters)
if (!preg_match('~^[pnbrqkPNBRQK1-8/]+ [wb] (-|[KQkq]+) (-|[a-h][36]) \d+ \d+$~', $fen)) {
    errorResponse("Invalid FEN in puzzle", 500);
}
// Solution: UCI moves, with an optional promotion piece
if (!preg_match('/^[a-h][1-8][a-h][1-8][qrbn]?( [a-h][1-8][a-h][1-8][qrbn]?)*$/', $solution)) {
    errorResponse("Invalid solution in puzzle", 500);
}
// URL: a Lichess address, or an inert link (app.js checks it again)
if (strpos($url, 'https://lichess.org/') !== 0) {
    $url = '#';
}

// Determine who is to move (for the orientation)
$fenParts = explode(' ', $fen);
$turn = isset($fenParts[1]) ? $fenParts[1] : 'w';

// Response. A byte that is not UTF-8 in a field would make json_encode()
// return false, and an empty 200 would go out: substitute it, and say so
// if encoding fails all the same
$json = json_encode([
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
], JSON_INVALID_UTF8_SUBSTITUTE);

if ($json === false) {
    errorResponse("Error while encoding the puzzle", 500);
}

echo $json;
