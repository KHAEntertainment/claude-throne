#!/bin/bash

# Setup script for ct_secretsd backend

echo "Setting up Claude Throne backend environment..."

# Navigate to backend directory
cd "$(dirname "$0")"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip --quiet

# Install dependencies
echo "Installing dependencies..."
pip install fastapi uvicorn keyring httpx cryptography python-multipart typing-extensions --quiet

# Install package in development mode
echo "Installing ct_secretsd package..."
pip install -e . --quiet

echo "✅ Setup complete!"
echo ""
echo "To run the backend manually:"
echo "  source venv/bin/activate"
echo "  python -m ct_secretsd"
echo ""
echo "The VS Code extension will automatically use this virtual environment."
