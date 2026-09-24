#!/bin/bash

update_hoobot() {
  # Define URLs
  ZIP_URL="https://hoosat.fi/hoobot/hoobot-latest.zip"
  ZIP_FILE="hoobot-latest.zip"
  TMP_DIR="/tmp/hoobot"

  # Step 1: Download the zip folder
  wget $ZIP_URL

  # Step 2: Create tmp directory if it doesn't exist
  mkdir -p $TMP_DIR

  # Step 3: Extract the zip folder to tmp
  unzip $ZIP_FILE -d $TMP_DIR

  # Step 4: Find the extracted directory
  EXTRACTED_DIR=$(find $TMP_DIR -type d -name 'hoobot-*' -print -quit)

  # Check if the directory was found
  if [ -z "$EXTRACTED_DIR" ]; then
      echo "Error: Extracted directory not found."
      rm -r $ZIP_FILE $TMP_DIR # Clean up downloaded zip file and temporary directory
      exit 1
  fi

  # Step 5: Use rsync to copy files and directories
  rsync -av $EXTRACTED_DIR/ .

  # Step 6: Remove the downloaded zip file and tmp folder
  rm $ZIP_FILE
  rm -r $TMP_DIR
}


echo "Update completed successfully."

# Function to check if Node.js is installed and matches the required version (v18.17.0)
is_node_installed() {
  if command -v node &>/dev/null; then
    # Get the installed Node.js version and compare it with the required version (v18.17.0)
    local installed_version
    installed_version=$(node -v)

    if [[ $installed_version == v18.17.0 ]]; then
      return 0 # Node.js is installed and matches the required version
    else
      return 1 # Node.js is installed but doesn't match the required version
    fi
  else
    return 1 # Node.js is not installed
  fi
}

# Function to install NVM
install_nvm() {
  echo "Installing NVM..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
}

# Function to install Node.js and NPM using NVM
install_node_npm() {
  echo "Installing Node.js and NPM..."
  nvm install v18.17.0
  nvm use v18.17.0
}

# Function to install project dependencies with NPM
install() {
  echo "Installing project dependencies..."
  npm install
  npm run postinstall
}

# Main script
main() {
  # Check if Node.js is installed
  if is_node_installed; then
    echo "Node.js is already installed."
  else
    # Check if NVM is installed
    if ! command -v nvm &> /dev/null; then
      install_nvm
      # Load NVM into this shell session
      export NVM_DIR="$HOME/.nvm"
      [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi

    # Install Node.js and NPM using NVM
    install_node_npm
  fi

  update_hoobot

  # Install project dependencies with NPM
  install

  echo "Hoobot installation completed successfully."
}

# Call the main function
main
