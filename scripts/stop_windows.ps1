# Stop and remove the TraMa container (Windows PowerShell). The trama-data volume is kept.
$Container = 'trama'

docker container inspect $Container *> $null
if ($LASTEXITCODE -eq 0) {
    docker rm -f $Container | Out-Null
    Write-Host "TraMa stopped. Data volume 'trama-data' preserved."
} else {
    Write-Host 'TraMa is not running.'
}
