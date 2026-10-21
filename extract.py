#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Script that parses the Lichess puzzles and computes the FEN after the first move
"""

import sys

# ============================================================================
# VENV CHECK - MUST COME BEFORE IMPORTING CHESS
# ============================================================================

def check_virtual_env():
    """Checks that the script runs inside the venv"""
    in_venv = hasattr(sys, 'real_prefix') or (
        hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix
    )

    if not in_venv:
        # EVERY print() must use file=sys.stderr
        print("\n" + "="*60, file=sys.stderr)
        print("ERROR: virtual environment not activated", file=sys.stderr)
        print("="*60, file=sys.stderr)
        print("\nThis script requires the virtual environment to be activated.", file=sys.stderr)
        print("\nHow to proceed:", file=sys.stderr)
        print("   1. Go to the application directory: cd /var/www/html/mate-on-web", file=sys.stderr)
        print("   2. Activate the venv: source venv/bin/activate", file=sys.stderr)
        print("   3. Run the script again\n", file=sys.stderr)
        print("Your prompt should show (venv) once it is activated.\n", file=sys.stderr)
        sys.exit(1)

# Run the check at startup
check_virtual_env()

# Now chess can be safely imported
import argparse
import chess

# ============================================================================
# VERBOSE MODE CONFIGURATION
# ============================================================================
VERBOSE_INTERVAL = 10000

# ============================================================================
# ARGUMENTS CONFIGURATION
# ============================================================================

parser = argparse.ArgumentParser(
    description='Parses the Lichess puzzles and computes the FEN after the first move',
    formatter_class=argparse.RawDescriptionHelpFormatter,
    epilog="""
Examples:
  ./extract.py lichess_db_puzzle.csv > output.csv
  ./extract.py --mate-in=1 lichess_db_puzzle.csv > mat1.csv
  ./extract.py --no_id --mate-in=2 lichess_db_puzzle.csv > mat2.csv
  ./extract.py --verbose --mate-in=1 lichess_db_puzzle.csv > mat1.csv
"""
)

parser.add_argument(
    '--mate-in',
    dest='mat_en',      # keeps the variable name used below
    type=int,
    choices=[1, 2, 3, 4, 5],
    help='Only keep mate-in-X puzzles (1 to 5)'
)

parser.add_argument(
    '--no_id',
    action='store_true',
    help='Leave the PuzzleId out of the output'
)

parser.add_argument(
    '--verbose', '-v',
    action='store_true',
    help='Print progress to STDERR'
)

parser.add_argument(
    'input_file',
    nargs='?',
    # errors='replace': a byte that is not UTF-8 somewhere in a 1 GB dump
    # must not abort the whole extraction with a UnicodeDecodeError
    type=argparse.FileType('r', errors='replace'),
    default=sys.stdin,
    help='CSV file to parse (or STDIN if not specified)'
)

# Parse the arguments
args = parser.parse_args()

# Same tolerance when the dump arrives through a pipe
if args.input_file is sys.stdin:
    sys.stdin.reconfigure(errors='replace')

# ============================================================================
# CHECK: show --help if there are no arguments AND no pipe
# ============================================================================

# If no file is given AND stdin is a terminal (no pipe)
# then show the help
import os
if args.input_file == sys.stdin and os.isatty(sys.stdin.fileno()):
    parser.print_help()
    sys.exit(0)

# ============================================================================
# PROCESSING
# ============================================================================

line_count = 0
processed = 0
skipped = 0

if args.verbose:
    print(f"# Starting processing...", file=sys.stderr)

for line in args.input_file:
    line_count += 1
    line = line.strip()
    fields = line.split(',', 9)

    # Header, empty, truncated or move-less line: skip it. An IndexError
    # here would abort the extraction, and download_puzzles.sh (set -e)
    # would stop with a partial file
    if len(fields) < 10 or not fields[2].split():
        skipped += 1
        continue

    if args.mat_en:
        themes = fields[7]
        if f"mateIn{args.mat_en}" not in themes:
            continue

    puzzle_id = fields[0]
    fen_original = fields[1]
    moves = fields[2]
    game_url = fields[8]
    opening_tags = fields[9]

    moves_list = moves.split()
    premier_coup = moves_list[0]
    solution = ' '.join(moves_list[1:])

    try:
        board = chess.Board(fen_original)
        board.push_uci(premier_coup)
        nouveau_fen = board.fen()

        output_fields = []
        if not args.no_id:
            output_fields.append(puzzle_id)

        output_fields.extend([
            nouveau_fen,
            solution,
            game_url,
            opening_tags
        ])

        print(','.join(output_fields))

        processed += 1

        if args.verbose and processed % VERBOSE_INTERVAL == 0:
            print(f"# {processed} puzzles processed | last move: {premier_coup} | line {line_count}", file=sys.stderr)

    except Exception as e:
        if args.verbose:
            print(f"# ERROR line {line_count}: {e}", file=sys.stderr)
        continue

if args.verbose:
    print(f"# Done: {processed} puzzles processed out of {line_count} lines"
          f" ({skipped} malformed line(s) skipped)", file=sys.stderr)
