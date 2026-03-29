@echo off
echo Starting Monochrome in Localhost Development Mode using Docker...
docker compose --profile dev up -d
echo.
echo Development server is starting in the background.
echo You can visit http://localhost:5173 (hot-reload enabled) soon.
echo.
pause
