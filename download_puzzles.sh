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
        echo "pip install python-chess"
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
            echo "pip install python-chess"
            echo "deactivate"
            echo ""
            echo -e "${YELLOW}Then run again: $0${NC}"
            exit 1
        fi
        echo -e "\n${GREEN}The venv is in place${NC}"
fi

# URL and files
URL="https://database.lichess.org/lichess_db_puzzle.csv.zst"
COMPRESSED="lichess_db_puzzle.csv.zst"
DECOMPRESSED="lichess_db_puzzle.csv"

# Download
echo -e "\n${YELLOW}Downloading ${COMPRESSED} ...${NC}"
if [ -f "$COMPRESSED" ]; then
    echo -e "${YELLOW}The file already exists. Do you want to replace it? (recommended) (Y/n)${NC}"
    read -r response
    if [[ "$response" =~ $YES_PATTERN ]]; then
        rm "$COMPRESSED"
        wget "$URL"
    else
        echo "Using the existing file."
    fi
else
    wget "$URL"
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
         echo -e "\n${YELLOW}Extracting mate-in-$i puzzles ... ${NC}"
        ./extract.py --mate-in "$i" --verbose "$DECOMPRESSED" > "mat${i}.csv"
        # Line count cache read by index.php, which spares scanning the whole
        # CSV on every page load
        wc -l < "mat${i}.csv" > "mat${i}.count"
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
    echo -ne "${GREEN}Number of mate-in-$i exercises : ${NC}"
    wc -l "mat${i}.csv"
done


echo -e "\n${GREEN}Everything went fine.\nEnjoy the game, thanks to Lichess! :)\n\n=> https://lichess.org/ ${NC}"
exit 0