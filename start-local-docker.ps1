Write-Host "Starting Monochrome in Localhost Development Mode using Docker..."
docker compose --profile dev up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Docker Compose failed to start. Please check the error above."
    exit $LASTEXITCODE
}
$port = if ($env:MONOCHROME_DEV_PORT) { $env:MONOCHROME_DEV_PORT } else { "5173" }
Write-Host ""
Write-Host "Development server is starting in the background."
Write-Host "You can visit http://localhost:$port (hot-reload enabled) soon."
Write-Host ""
Read-Host -Prompt "Press Enter to continue..."
