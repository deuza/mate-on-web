#!/bin/bash
# Downloads and decompresses the Lichess puzzle database

set -e  # Stop the script on any error

# Display colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Answers accepted as "yes" to the (Y/n) questions: Enter (empty answer), y, Y,
# yes, Yes or YES. Anything else means no, so pressing Enter follows the advice.
YES_PATTERN='^([Yy]([Ee][Ss])?)?$'

# Label of a level in the messages. mat5.csv holds the Lichess theme "Mate in
# 5 or more", that is every mate of five moves or longer: it is called 5+, as
# on the web page. The file names and extract.py keep the plain number.
level_label() {
    if [ "$1" -eq 5 ]; then
        echo "5+"
    else
        echo "$1"
    fi
}

echo -e "${GREEN}\n\n=== Initializing or updating the Lichess Puzzles database ===${NC}"

# Dependency check, by order of importance
echo -e "\n${YELLOW}Checking required binaries ...${NC}"

if ! command -v python3 &> /dev/null; then
    echo ""
    echo -e "${RED}!!! Error: python3 is not installed !!!${NC}"
    echo ""
    echo "Install it with: apt install python3"
    echo ""
    exit 1
fi

# "python3 -m venv" needs the ensurepip module, which Debian ships in a
# separate package (python3-venv, i.e. python3.13-venv on Trixie)
if ! python3 -c "import ensurepip" &> /dev/null; then
    echo ""
    echo -e "${RED}!!! Error: the python3 venv module is not installed !!!${NC}"
    echo ""
    echo "Install it with: apt install python3-venv"
    echo ""
    exit 1
fi

if ! command -v wget &> /dev/null; then
    echo ""
    echo -e "${RED}!!! Error: wget is not installed !!!${NC}"
    echo ""
    echo "Install it with: apt install wget"
    echo ""
    exit 1
fi

if ! command -v zstd &> /dev/null; then
    echo ""
    echo -e "${RED}!!! Error: zstd is not installed !!! ${NC}"
    echo ""
    echo "Install it with: apt install zstd"
    echo ""
    exit 1
fi

echo -e "${GREEN}python3, python3-venv, wget and zstd are available${NC}"


if [ ! -d "venv" ]; then
        echo ""
        echo -e "${RED}!!! The venv does not exist yet !!!${NC}"
        echo ""
        echo -e "${YELLOW}Create the environment first:${NC}"
        echo ""
        echo "python3 -m venv venv"
        echo "source venv/bin/activate"
        echo "pip install --require-hashes -r requirements.txt"
        echo "deactivate"
        echo ""
        echo -e "${YELLOW}Then run again: $0${NC}"
        exit 1
else
        # python-chess must be installed in the venv, otherwise extract.py would
        # only fail after the download
        if ! venv/bin/python3 -c "import chess" &> /dev/null; then
            echo ""
            echo -e "${RED}!!! python-chess is not installed in the venv !!!${NC}"
            echo ""
            echo -e "${YELLOW}Install it first:${NC}"
            echo ""
            echo "source venv/bin/activate"
            echo "pip install --require-hashes -r requirements.txt"
            echo "deactivate"
            echo ""
            echo -e "${YELLOW}Then run again: $0${NC}"
            exit 1
        fi
        echo -e "\n${GREEN}The venv is in place${NC}"
fi

# URL and files
URL="https://database.lichess.org/lichess_db_puzzle.csv.zst"
SUMS_URL="https://database.lichess.org/sha256sums.txt"
COMPRESSED="lichess_db_puzzle.csv.zst"
DECOMPRESSED="lichess_db_puzzle.csv"

# Checks the archive that has just been downloaded against the SHA-256
# checksum that Lichess publishes next to it (sha256sums.txt, one
# "checksum  file name" line per file): a download cut short or corrupted is
# caught here, before the decompression.
# The list is not advertised on the Lichess page, and its date is not the one
# of the dump (nine hours later on 2026-11-01). So when it cannot be fetched,
# or does not name the archive, the check is skipped with a warning; and when
# the checksums differ, the question is asked, the recommended answer being
# to stop. An archive kept from an earlier run is not checked: it may be an
# older dump, whose checksum is no longer published.
# sha256sum is provided by GNU coreutils, like stat and numfmt below; awk is
# a POSIX tool.
verify_checksum() {
    local sums expected actual

    echo -e "\n${YELLOW}Checking the SHA-256 checksum of ${COMPRESSED} ...${NC}"
    if ! sums=$(wget -q -T 30 -t 2 -O - "$SUMS_URL"); then
        echo -e "${YELLOW}Warning: $SUMS_URL could not be downloaded, the checksum is not verified.${NC}"
        return 0
    fi
    # The line of the archive, in the variants that the tools of the sha256sum
    # family write or accept: a "*" in front of the name (binary mode), a "./"
    # prefix, CRLF line endings, a checksum in upper case.
    expected=$(awk -v file="$COMPRESSED" '
        { sub(/\r$/, ""); name = $2; sub(/^\*/, "", name); sub(/^\.\//, "", name) }
        name == file { print tolower($1); exit }' <<< "$sums")
    if [[ ! "$expected" =~ ^[0-9a-f]{64}$ ]]; then
        echo -e "${YELLOW}Warning: $SUMS_URL lists no usable checksum for $COMPRESSED, the checksum is not verified.${NC}"
        return 0
    fi
    actual=$(sha256sum "$COMPRESSED")
    actual=${actual%% *}
    if [ "$actual" = "$expected" ]; then
        echo -e "${GREEN}The checksum matches the one published by Lichess${NC}"
        return 0
    fi

    echo ""
    echo -e "${RED}!!! The checksum of $COMPRESSED does not match !!!${NC}"
    echo ""
    echo "Published by Lichess : $expected"
    echo "Downloaded file      : $actual"
    echo ""
    echo "The download is incomplete or corrupt, or Lichess has not renewed its list yet."
    echo -e "${YELLOW}Do you want to stop here? (recommended) (Y/n)${NC}"
    read -r response
    if [[ "$response" =~ $YES_PATTERN ]]; then
        echo -e "\n${YELLOW}Stopped. Run again: $0 and let it replace $COMPRESSED${NC}"
        exit 1
    fi
    echo "Going on with the downloaded file."
}

# Download
echo -e "\n${YELLOW}Downloading ${COMPRESSED} ...${NC}"
if [ -f "$COMPRESSED" ]; then
    echo -e "${YELLOW}The file already exists. Do you want to replace it? (recommended) (Y/n)${NC}"
    read -r response
    if [[ "$response" =~ $YES_PATTERN ]]; then
        rm "$COMPRESSED"
        wget "$URL"
        verify_checksum
    else
        echo "Using the existing file."
    fi
else
    wget "$URL"
    verify_checksum
fi

# Decompression
echo -e "\n${YELLOW}Decompressing $COMPRESSED ...${NC}"
if [ -f "$DECOMPRESSED" ]; then
    echo -e "${YELLOW}$DECOMPRESSED already exists. Do you want to replace it? (recommended) (Y/n)${NC}"
    read -r response
    if [[ "$response" =~ $YES_PATTERN ]]; then
        rm "$DECOMPRESSED"
        zstd -d "$COMPRESSED"
    else
        echo "Using the existing file."
    fi
else
    zstd -d "$COMPRESSED"
fi

# Statistics
echo -e "\n${GREEN}=== Done ===${NC}"
# Apparent size (st_size) in human-readable format, identical to "ls -lh"
# (powers of 1024, rounded up). stat avoids parsing the output of ls
# (SC2012); stat -c and numfmt are provided by GNU coreutils.
echo -e "Compressed file   : $(stat -c %s "$COMPRESSED" | numfmt --to=iec)"
echo -e "Decompressed file : $(stat -c %s "$DECOMPRESSED" | numfmt --to=iec)"
echo -e "Number of lines   : $(wc -l < "$DECOMPRESSED")"

# Delete the archive
echo ""
echo -e "\n${YELLOW}Do you want to delete $COMPRESSED? (recommended) (Y/n)${NC}"
read -r response
if [[ "$response" =~ $YES_PATTERN ]]; then
    rm "$COMPRESSED"
    echo -e "\n${GREEN}$COMPRESSED has been deleted${NC}"
else
    echo -e "\n${GREEN}$COMPRESSED has been kept${NC}"
fi

# Generate the exercise files

echo ""
echo -e "\n${YELLOW}Do you want to generate all the exercise files from $DECOMPRESSED? (recommended) (Y/n)${NC}"
read -r response
if [[ "$response" =~ $YES_PATTERN ]]; then
    # The activate script is generated locally by "python3 -m venv" and is not
    # part of the repository: ShellCheck does not need to follow it (SC1091).
    # shellcheck source=/dev/null
    source venv/bin/activate
    for i in {1..5}; do
        echo -e "\n${YELLOW}Extracting mate-in-$(level_label "$i") puzzles ... ${NC}"
        # The new file is written aside and swapped in at the end: the site
        # keeps serving the previous puzzles meanwhile, and an extraction
        # that fails (set -e stops here) leaves the current file untouched.
        # The interpreter of the venv is named explicitly, with -I so that
        # neither the environment nor the current directory can put a
        # module in front of the standard ones.
        venv/bin/python3 -I extract.py --mate-in "$i" --verbose "$DECOMPRESSED" > "mat${i}.csv.tmp"
        # An extraction can also end without any error and find no puzzle
        # at all: a dump whose columns or theme names have changed, or a
        # partial dump kept from an earlier run. An empty file must not take
        # the place of the puzzles being served: the page would lose the
        # level. Neither the checksum nor the decompression can see that.
        if [ ! -s "mat${i}.csv.tmp" ]; then
            rm -f "mat${i}.csv.tmp"
            echo ""
            echo -e "${RED}!!! No mate-in-$(level_label "$i") puzzle found in $DECOMPRESSED !!!${NC}"
            echo ""
            echo "mat${i}.csv is left as it was, and the levels after it are not extracted."
            echo "Check that $DECOMPRESSED is a complete Lichess puzzle dump."
            exit 1
        fi
        # Line count cache read by index.php, which spares scanning the whole
        # CSV on every page load. Written before the swap: mv keeps the
        # modification time of the new CSV, so the count stays the newer of
        # the two and index.php never falls back on counting the lines.
        wc -l < "mat${i}.csv.tmp" > "mat${i}.count"
        mv "mat${i}.csv.tmp" "mat${i}.csv"
        echo -e "\n${GREEN}mat${i}.csv has been generated${NC}"
    done
else
    echo -e "\n${YELLOW}$DECOMPRESSED is ready to be parsed with extract.py!${NC}"
fi

# Delete the file containing the puzzles
echo ""
echo -e "\n${YELLOW}Do you want to delete $DECOMPRESSED? (recommended) (Y/n)${NC}"
read -r response
if [[ "$response" =~ $YES_PATTERN ]]; then
    rm "$DECOMPRESSED"
    echo -e "\n${GREEN}$DECOMPRESSED has been deleted${NC}"
else
    echo -e "\n${GREEN}$DECOMPRESSED has been kept${NC}"
fi

# Statistics
echo ""
echo -e "\n${GREEN}=== Available exercise files ===${NC}"
for i in {1..5}; do
    echo -ne "${GREEN}Number of mate-in-$(level_label "$i") exercises : ${NC}"
    wc -l "mat${i}.csv"
done


echo -e "\n${GREEN}Everything went fine.\nEnjoy the game, thanks to Lichess! :)\n\n=> https://lichess.org/ ${NC}"
exit 0