@echo off
echo Starting Monochrome in Localhost Development Mode using Docker...
docker compose --profile dev up -d
if %ERRORLEVEL% neq 0 (
    echo.
    echo Docker Compose failed to start. Please check the error above.
    pause
    exit /b %ERRORLEVEL%
)
if not defined MONOCHROME_DEV_PORT set MONOCHROME_DEV_PORT=5173
echo.
echo Development server is starting in the background.
echo You can visit http://localhost:%MONOCHROME_DEV_PORT% (hot-reload enabled) soon.
echo.
pause
