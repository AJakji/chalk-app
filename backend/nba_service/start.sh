#!/bin/bash
# Start the Chalk NBA data microservice
# Run this in a separate terminal window alongside the Node.js backend

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate virtual environment
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt
else
  source venv/bin/activate
fi

PORT=${NBA_SERVICE_PORT:-8000}
echo "Starting Chalk NBA service on port $PORT..."
uvicorn main:app --host 0.0.0.0 --port "$PORT" --reload
