# Changelog

All notable changes to Mate On Web are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Its public API, in the Semantic Versioning sense, is what an administrator
relies on: the prerequisites, the installation procedure, the web server
configurations shipped in `docs/`, the format of `matN.csv` and `matN.count`,
and the options of `extract.py` and `download_puzzles.sh`. A new major version
means that an existing installation needs an action from its administrator to
keep working after the upgrade.

## [Unreleased]

### Added

- Mystery level, **Mate in ?**: the level of each puzzle is drawn at random
  among the available levels, and stays hidden until the mate is found or the
  solution is shown. The button appears when at least two puzzle files exist.
- `R` keyboard shortcut, to retry a finished puzzle.
- This changelog.
- French translations of the README and of the hardening notes,
  `README.fr.md` and `docs/hardening.fr.md`, linked from the English
  documents.

### Changed

- Level 5 is labelled **Mate in 5+**: it holds the Lichess theme "Mate in 5 or
  more", that is every mate of five moves or longer. The game area gives the
  real length of each mate, counted on its solution.
- **Retry** appears once the puzzle is over, the mate found or the solution
  shown to the end, and restarts it from its starting position without loading
  it again. A replay changes neither the attempts nor the solved count. A wrong
  move is still taken back at once, now with a "Try again." message and no
  button.
- The page footer is restyled, and readable on small screens.
- The README is reorganized: the installation takes four ordered steps, with
  the web server configuration before the first access, the prerequisites are
  grouped by purpose, and the update of the puzzles and the technical
  information have their own sections.

### Fixed

- A move that gives checkmate solves the puzzle even when it is not the mate of
  the Lichess solution, as on Lichess: such a move was refused as a wrong move.
- A new puzzle that replaced the previous one could receive the opponent's
  reply or the solution animation meant for the previous puzzle, which then
  swapped the roles and kept the puzzle from ending.
- A move played on the starting position shown during the first load raised an
  error.
- The error of a superseded puzzle request is no longer shown over the current
  puzzle or over the menu.
- `download_puzzles.sh` and `extract.py` are executable after a fresh clone:
  the `./download_puzzles.sh` step of the README failed with "Permission
  denied".
- The page passes the W3C validator: the heading levels no longer skip from
  `h1` to `h3`, and the footer no longer uses obsolete markup.
- `puzzle.php` sends `Allow: POST` with its 405 response, as RFC 9110
  requires and as `docs/hardening.md` already stated.
- The README and `docs/hardening.md` no longer give a PHP version that goes
  out of date: they point to the official tables of the supported PHP and
  Python releases.
- `docs/hardening.md` lists every outgoing link of the page, describes the
  tolerant parsing of `extract.py` as it works, and lists the files that the
  cleaner layout of section 4 copies into the web directory, with `cp -p` so
  that each line count stays valid.
- The first link of the README table of contents pointed to no anchor; typos
  and punctuation are fixed in both documents.

## [1.1.0] - 2026-10-21

### Added

- Touch screen support: a piece can be dragged with a finger, or tapped and
  then its destination tapped, which also works with a mouse click. `Esc` or a
  second tap cancels the selection.
- `docs/hardening.md`, and Apache and nginx configurations ready to install in
  `docs/apache2/` and `docs/nginx/`: the files that must not be served are
  refused, security headers are sent, and a strict content security policy
  applies.
- `requirements.txt`, which pins python-chess to one version and its SHA-256
  hash.
- `vendor/SHA256SUMS`, the hashes of the bundled third-party files.
- `.gitignore`, which keeps the generated files, the Lichess dump and the venv
  out of git.

### Changed

- The project is named Mate On Web (formerly Mat On Web): the repository and
  the documented installation directory are `mate-on-web`.
- python-chess is installed with
  `pip install --require-hashes -r requirements.txt` instead of
  `pip install python-chess`.
- `download_puzzles.sh` writes each puzzle file aside and moves it into place
  once complete: the previous puzzles stay served meanwhile, and a failed
  extraction leaves them untouched.

### Fixed

- A promotion that ended the puzzle left the pawn displayed.
- `extract.py` skips malformed lines and tolerates bytes that are not UTF-8,
  instead of stopping with a partial file.

### Security

- `puzzle.php` refuses request bodies above 1 KB with a 413, bounds its reads,
  and checks the FEN, the solution and the Lichess address before they reach
  the browser; a JSON encoding failure now returns a 500 instead of an empty
  response.
- `index.php` no longer uses inline event handlers, so that a strict content
  security policy can apply, and the Lichess link carries
  `rel="noopener noreferrer"`.
- `download_puzzles.sh` calls the Python of the venv with `-I`, so that
  neither the environment nor the current directory can put a module in front
  of the standard ones.

## [1.0.0] - 2026-10-19

### Added

- First release, as Mat On Web: a web interface to train on mate puzzles from
  the Lichess database, from mate in 1 to mate in 5.
- `download_puzzles.sh` downloads the Lichess puzzle database and builds one
  puzzle file per level (`matN.csv`) with `extract.py`, along with its line
  count (`matN.count`), so that the page does not count the lines on every
  load.
- A random puzzle is picked in constant time, whatever the size of the file.
- The board is oriented according to the side to move, pawn promotion offers a
  choice of piece, the solution can be shown, the board flipped and the puzzle
  opened on Lichess; the session statistics are kept in memory only.
- Keyboard shortcuts: `N` new puzzle, `F` flip the board, `S` show the
  solution, `Esc` cancel the promotion.
- No network access is needed at runtime: jQuery, chessboard.js, chess.js and
  the piece images are served from the project itself.

[unreleased]: https://github.com/deuza/mate-on-web/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/deuza/mate-on-web/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/deuza/mate-on-web/releases/tag/v1.0.0
