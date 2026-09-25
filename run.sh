#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
trap 'kill 0' EXIT
python3 backend/app.py 8000 &
python3 -m http.server 8080 --directory frontend &
wait
