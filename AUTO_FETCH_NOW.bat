@echo off
title Quillspire Auto-Fetch Public-Domain Novels
python "%~dp0publisher_app\auto_fetch_novels.py" --source all --mode mixed --limit 5 --deploy
pause
