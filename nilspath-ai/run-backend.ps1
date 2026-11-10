$ErrorActionPreference = 'Stop'
$envPath = Join-Path $PSScriptRoot '.env'
if (Test-Path -LiteralPath $envPath) {
    Get-Content -LiteralPath $envPath | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim().Trim('"').Trim("'"), 'Process')
        }
    }
}
if (-not $env:DB_PASSWORD) {
    throw 'Set DB_PASSWORD in .env or your environment before starting the backend.'
}
$backendPort = 8080
if ($env:PORT) {
    if (-not [int]::TryParse($env:PORT, [ref]$backendPort) -or $backendPort -lt 1 -or $backendPort -gt 65535) {
        throw 'PORT must be a number between 1 and 65535.'
    }
}
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $backendPort)
try {
    $listener.Start()
} catch {
    throw "Cannot listen on port $backendPort. Close the backend already running on this port, then run start-backend.cmd again. If you change PORT in .env, also update frontend/.env VITE_API_URL to http://localhost:<PORT>/api."
} finally {
    $listener.Stop()
}
Push-Location (Join-Path $PSScriptRoot 'backend')
try {
    # A short temp path avoids the Windows Unix-domain socket path limit.
    $runtimeTemp = Join-Path $PSScriptRoot '..\.runtime\tmp'
    New-Item -ItemType Directory -Path $runtimeTemp -Force | Out-Null
    $runtimeTemp = (Resolve-Path -LiteralPath $runtimeTemp).Path
    & mvn.cmd spring-boot:run "-Dspring-boot.run.jvmArguments=-Djava.io.tmpdir=`"$runtimeTemp`" -Djdk.net.unixdomain.tmpdir=`"$runtimeTemp`""
    if ($LASTEXITCODE -ne 0) { throw "Backend exited with code $LASTEXITCODE" }
} finally {
    Pop-Location
}
