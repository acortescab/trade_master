# Start the TraMa container (Windows PowerShell). Idempotent: safe to run repeatedly.
#
# Usage: .\scripts\start_windows.ps1 [-Build] [-Mock] [-NoOpen]
#   -Build   Rebuild the Docker image even if it already exists
#   -Mock    Run with LLM_MOCK=true (deterministic chat responses, used by E2E tests)
#   -NoOpen  Don't open the browser
param(
    [switch]$Build,
    [switch]$Mock,
    [switch]$NoOpen
)

$Image = 'trama'
$Container = 'trama'
$Volume = 'trama-data'
$Port = if ($env:TRAMA_PORT) { $env:TRAMA_PORT } else { '8000' }
$Url = "http://localhost:$Port"

$RootDir = Split-Path -Parent $PSScriptRoot
Push-Location $RootDir
try {
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Error 'Docker is not running. Start Docker Desktop and try again.'
        exit 1
    }

    docker image inspect $Image *> $null
    if ($Build -or $LASTEXITCODE -ne 0) {
        Write-Host "Building image '$Image'..."
        docker build -t $Image .
        if ($LASTEXITCODE -ne 0) { Write-Error 'Docker build failed.'; exit 1 }
    }

    docker container inspect $Container *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Removing existing container '$Container'..."
        docker rm -f $Container | Out-Null
    }

    $runArgs = @('run', '-d', '--name', $Container, '-v', "${Volume}:/app/db", '-p', "${Port}:8000")
    if (Test-Path '.env') {
        $runArgs += @('--env-file', '.env')
    } elseif (Test-Path '.env.example') {
        Write-Warning '.env not found; using .env.example (AI chat will be unavailable without OPENROUTER_API_KEY).'
        $runArgs += @('--env-file', '.env.example')
    } else {
        Write-Warning 'No .env or .env.example found; starting with defaults.'
    }
    # Explicit -e values override anything in the env file
    $runArgs += @('-e', 'DB_PATH=/app/db/trama.db', '-e', 'STATIC_DIR=/app/static')
    if ($Mock) {
        $runArgs += @('-e', 'LLM_MOCK=true')
    }
    $runArgs += $Image

    docker @runArgs | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Error 'Failed to start container.'; exit 1 }

    Write-Host -NoNewline 'Waiting for TraMa to become healthy'
    $healthy = $false
    for ($i = 0; $i -lt 30 -and -not $healthy; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 2
            $healthy = ($resp.StatusCode -eq 200)
        } catch {}
        if (-not $healthy) {
            Write-Host -NoNewline '.'
            Start-Sleep -Seconds 1
        }
    }
    Write-Host ''
    if (-not $healthy) {
        Write-Warning "Health check did not pass yet; see 'docker logs $Container'."
    }

    Write-Host "TraMa is running at $Url"
    if ($Mock) { Write-Host '(LLM mock mode enabled)' }

    if (-not $NoOpen) {
        Start-Process $Url
    }
} finally {
    Pop-Location
}
