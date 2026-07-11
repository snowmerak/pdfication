#!/bin/bash
set -e

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 1. Determine directory context (run locally vs piped from curl)
if [ -f "wails.json" ] && [ -f "main.go" ] && grep -q "pdfication" wails.json; then
    echo -e "${BLUE}=== Running installer from project workspace ===${NC}"
    PROJECT_DIR="."
else
    echo -e "${BLUE}=== Running installer via curl (Cloning repo to temporary workspace) ===${NC}"
    # Check if git is installed
    if ! command -v git &> /dev/null; then
        echo -e "${RED}Error: git is required to clone and build the repository.${NC}"
        exit 1
    fi
    
    TEMP_CLONE_DIR=$(mktemp -d -t pdfication-build-XXXXXX)
    # Automatically clean up the temp directory on exit
    trap 'rm -rf "$TEMP_CLONE_DIR"' EXIT
    
    git clone --depth 1 https://github.com/snowmerak/pdfication.git "$TEMP_CLONE_DIR"
    PROJECT_DIR="$TEMP_CLONE_DIR"
fi

cd "$PROJECT_DIR"

echo -e "${BLUE}=== 2. Checking Dependencies ===${NC}"
# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo -e "${RED}Error: Go is not installed. Please install Go v1.18+ first.${NC}"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: Node.js/npm is not installed. Please install Node.js/npm first.${NC}"
    exit 1
fi

# Check if Wails is installed
if ! command -v wails &> /dev/null; then
    echo -e "${BLUE}Installing Wails CLI...${NC}"
    go install github.com/wailsapp/wails/v2/cmd/wails@latest
    export PATH=$PATH:$(go env GOPATH)/bin
fi

echo -e "${BLUE}=== 3. Building Application (tags: webkit2_41) ===${NC}"
wails build -tags webkit2_41

echo -e "${BLUE}=== 4. Installing Binary and Desktop Entry ===${NC}"
# Create user bin and application directories if they don't exist
mkdir -p ~/.local/bin
mkdir -p ~/.local/share/icons
mkdir -p ~/.local/share/applications

# Copy compiled binary
cp build/bin/pdfication ~/.local/bin/pdfication
chmod +x ~/.local/bin/pdfication

# Copy application icon
cp build/appicon.png ~/.local/share/icons/pdfication.png

# Generate .desktop file
cat <<EOF > ~/.local/share/applications/pdfication.desktop
[Desktop Entry]
Name=Pdfication
Comment=Premium PDF Toolbox & Organizer
Exec=$HOME/.local/bin/pdfication
Icon=pdfication
Terminal=false
Type=Application
Categories=Office;Utility;
EOF

chmod +x ~/.local/share/applications/pdfication.desktop

echo -e "${GREEN}=== 5. Installation Complete! ===${NC}"
echo -e "You can now run ${GREEN}Pdfication${NC} directly from your desktop applications menu."
echo -e "Alternatively, run it from terminal: ${BLUE}~/.local/bin/pdfication${NC}"
