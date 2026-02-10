# bridge.ps1 - Diagnostic Version
$Log = Join-Path $PSScriptRoot "bridge.log"
function Log($m) { Add-Content $Log "$(Get-Date -f 'HH:mm:ss') - $m" }

Log "--- START (DIAGNOSTIC) ---"

# 1. PID
$p = Get-Process Monochrome -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { $p = Get-Process neutralino-win_x64 -ErrorAction SilentlyContinue | Select-Object -First 1 }
$pid_to_send = if ($p) { $p.Id } else { [System.Diagnostics.Process]::GetCurrentProcess().Id }

# 2. Discord Connection
function Get-Pipe {
    for ($i = 0; $i -le 9; $i++) {
        try {
            $pn = "discord-ipc-$i"
            $p = New-Object System.IO.Pipes.NamedPipeClientStream(".", $pn, [System.IO.Pipes.PipeDirection]::InOut)
            $p.Connect(100)
            return $p
        } catch { }
    }
    return $null
}
$pipe = Get-Pipe; if (-not $pipe) { Log "Discord Fail"; exit }

function Send-Packet($op, $json) {
    if ($op -eq 1) { Log "Sending Activity: $json" }
    $j = [System.Text.Encoding]::UTF8.GetBytes($json)
    [byte[]]$pkt = [BitConverter]::GetBytes([int]$op) + [BitConverter]::GetBytes([int]$j.Length) + $j
    $pipe.Write($pkt, 0, $pkt.Length); $pipe.Flush()
}

# 3. Handshake
Send-Packet 0 (@{ v = 1; client_id = "1462186088184549661" } | ConvertTo-Json -Compress)
$h = New-Object byte[] 8; if ($pipe.Read($h, 0, 8) -eq 8) {
    $l = [BitConverter]::ToInt32($h, 4); $b = New-Object byte[] $l; $pipe.Read($b, 0, $l) | Out-Null
    Log "Handshake OK"
}

function Set-Activity($d, $s, $img, $start, $end, $large_text, $small_img, $small_txt) {
    $activity = @{
        details = [string]$d
        state = [string]$s
        type = 2
        assets = @{
            large_image = if ($img -and $img.StartsWith("http")) { [string]$img } else { "monochrome" }
            large_text = if ($large_text) { [string]$large_text } else { "Monochrome" }
        }
    }

    if ($small_img) {
        $activity.assets.small_image = [string]$small_img
        $activity.assets.small_text = [string]$small_txt
    }

    if ($start -or $end) {
        $activity.timestamps = @{}
        if ($start) { $activity.timestamps.start = [long]$start }
        if ($end) { $activity.timestamps.end = [long]$end }
    }
    
    # CRITICAL: -Depth 10 ensures 'assets' is not stringified as a class name
    $payload = @{
        cmd = "SET_ACTIVITY"
        args = @{ pid = [int]$pid_to_send; activity = $activity }
        nonce = [Guid]::NewGuid().ToString()
    } | ConvertTo-Json -Compress -Depth 10
    
    Send-Packet 1 $payload
}

Start-Sleep -Seconds 1
Set-Activity "Idling" "Monochrome" $null $null $null $null $null $null

# 4. Config & WS
$line = [Console]::In.ReadLine()
if (-not $line) { exit }
$config = $line | ConvertFrom-Json

$ws = New-Object System.Net.WebSockets.ClientWebSocket
try {
    $uri = [Uri]"ws://127.0.0.1:$($config.nlPort)?extensionId=$($config.nlExtensionId)&connectToken=$($config.nlConnectToken)"
    $ws.ConnectAsync($uri, [System.Threading.CancellationToken]::None).Wait()
    Log "WS Connected"
} catch { exit }

# 5. Loop
$buf = New-Object byte[] 65536
while ($ws.State -eq "Open") {
    $task = $ws.ReceiveAsync((New-Object ArraySegment[byte] -ArgumentList @(,$buf)), [System.Threading.CancellationToken]::None)
    while (-not $task.Wait(1000)) { if (-not (Get-Process -Id $pid_to_send -ErrorAction SilentlyContinue)) { exit } }
    if ($task.Result.Count -gt 0) {
        try {
            $raw = [System.Text.Encoding]::UTF8.GetString($buf, 0, $task.Result.Count)
            $msg = $raw | ConvertFrom-Json
            if ($msg.event -eq "discord:update") { 
                Set-Activity $msg.data.details $msg.data.state $msg.data.largeImageKey $msg.data.startTimestamp $msg.data.endTimestamp $msg.data.largeImageText $msg.data.smallImageKey $msg.data.smallImageText
            }
            elseif ($msg.event -eq "discord:clear") { Set-Activity "Idling" "Monochrome" $null $null $null $null $null $null }
        } catch {}
    }
}
