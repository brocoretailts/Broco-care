@echo off
title Broco CMS - Reset Database
color 0C

echo ================================================
echo    RESET DATABASE
echo    Semua data akan dihapus!
echo ================================================
echo.

set /p confirm="Yakin reset database? (Y/N): "
if /i not "%confirm%"=="Y" (
    echo Reset dibatalkan.
    pause
    exit /b
)

if exist "database.sqlite" (
    del "database.sqlite"
    echo [OK] Database dihapus.
) else (
    echo [INFO] Database tidak ditemukan.
)

echo [INFO] Menjalankan ulang server untuk inisialisasi ulang...
start "Broco CMS" cmd /c "echo Server starting... && node server.js && pause"

echo.
echo Database beres. Silakan refresh browser.
pause
