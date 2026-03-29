Write-Host "Starting Monochrome in Localhost Development Mode using Docker..."
docker compose --profile dev up -d
Write-Host ""
Write-Host "Development server is starting in the background."
Write-Host "You can visit http://localhost:5173 (hot-reload enabled) soon."
Write-Host ""
Read-Host -Prompt "Press Enter to continue..."
