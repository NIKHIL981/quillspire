#!/usr/bin/env bash
cd "$(dirname "$0")"
python3 publisher_app/auto_fetch_novels.py --source all --mode mixed --limit 5 --deploy
