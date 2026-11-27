@echo off
title InkRealm Auto-Import & Live Deploy
python "%~dp0publisher_app\novel_publisher.py" --scan --deploy
pause
