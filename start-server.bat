@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo  Archive Bonat - Server running on:
echo  PC   : http://localhost:8000
echo  Phone: http://192.168.1.16:8000  (same WiFi)
echo ========================================
python -m http.server 8000
pause
