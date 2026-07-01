@echo off
title Broco Smart Care - Complaint Management System
color 0A

echo ================================================
echo    Broco Smart Care
echo    Complaint Management System
echo ================================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js tidak ditemukan!
    echo Silakan install Node.js dari https://nodejs.org
    pause
    exit /b
)

:: Check if node_modules exists
if not exist "node_modules" (
    echo [INFO] Menginstall dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Gagal menginstall dependencies!
        pause
        exit /b
    )
    echo [INFO] Dependencies berhasil diinstall.
    echo.
)

:: Only seed if no database exists (first run)
if not exist "database.sqlite" (
    echo [INFO] Database baru akan dibuat saat pertama kali dijalankan.
    echo.
)

:: Get local IP addresses
echo [INFO] Mendeteksi alamat IP...
echo.

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4 Address" /C:"IP Address" 2^>nul') do (
    set "ip=%%a"
    goto :showip
)

:showip
set "ip=%ip: =%"
echo ================================================
echo    Server akan berjalan di:
echo.
echo    Local : http://localhost:3000
if not "%ip%"=="" (
    echo    Network : http://%ip%:3000
)
echo ================================================
echo.
echo    Akun Login:
echo    Admin      : admin / password
echo    Management : management / password
echo    Teknisi 1  : teknisi1 / password
echo    Teknisi 2  : teknisi2 / password
echo    Teknisi 3  : teknisi3 / password
echo.
echo ================================================
echo    Tekan CTRL+C untuk menutup server
echo ================================================
echo.

:: Start the server
node server.js

echo.
echo Server ditutup.
pause
