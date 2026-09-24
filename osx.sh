#!/bin/bash
set -e  # Exit immediately if a command exits with a non-zero status
set -x  # Print commands and their arguments as they are executed

update_osx() {
  # Define URLs
  ZIP_URL="https://hoosat.fi/hoobot/hoobot-latest.zip"
  ZIP_FILE="hoobot-latest.zip"
  TMP_DIR="/tmp/hoobot"

  # Step 1: Download the zip folder
  curl -L -o "$ZIP_FILE" "$ZIP_URL"

  # Step 2: Create tmp directory if it doesn't exist
  mkdir -p "$TMP_DIR"

  # Step 3: Extract the zip folder to tmp
  unzip -q "$ZIP_FILE" -d "$TMP_DIR"

  # Step 4: Find the extracted directory
  EXTRACTED_DIR=$(find "$TMP_DIR" -type d -name 'hoobot-*' -print -quit)

  # Check if the directory was found
  if [ -z "$EXTRACTED_DIR" ]; then
      echo "Error: Extracted directory not found."
      rm -rf "$ZIP_FILE" "$TMP_DIR" # Clean up downloaded zip file and temporary directory
      exit 1
  fi

  # Step 5: Use rsync to copy files and directories
  rsync -av "$EXTRACTED_DIR/" .

  # Step 6: Remove the downloaded zip file and tmp folder
  rm "$ZIP_FILE"
  rm -rf "$TMP_DIR"
  echo "Update completed successfully."
}

# Function to check if Homebrew is installed
is_brew_installed() {
  command -v brew &>/dev/null
}

# Function to install Node.js using brew
install_node_with_brew() {
  echo "Installing Node.js using Homebrew..."
  brew install node
}

# Function to install project dependencies with NPM
install() {
  echo "Installing project dependencies..."
  npm install
  npm run postinstall
}

# Main script
main() {
  if is_brew_installed; then
    echo "Homebrew is already installed."
  else
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add Homebrew to PATH for the current session
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi

  if command -v node &>/dev/null; then
    echo "Node.js is already installed."
  else
    install_node_with_brew
  fi

  update_osx
  install

  echo "Hoobot installation completed successfully."
}

main