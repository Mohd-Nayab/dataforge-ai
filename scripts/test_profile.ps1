# Quick verification of the enterprise profiling endpoint.
$ErrorActionPreference = "Stop"
$base = "http://localhost:4000"

# Login (registers on first run)
try {
  $login = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" `
    -Body (@{ email = "smoke@test.com"; password = "secret123" } | ConvertTo-Json)
} catch {
  $login = Invoke-RestMethod "$base/api/auth/register" -Method Post -ContentType "application/json" `
    -Body (@{ name = "Smoke"; email = "smoke@test.com"; password = "secret123" } | ConvertTo-Json)
}
$token = $login.token
$headers = @{ Authorization = "Bearer $token" }

# Upload the sample dataset
$sample = Join-Path $PSScriptRoot "..\docs\sample_data.csv"
$up = curl.exe -s -X POST "$base/api/data/datasets/upload" -H "Authorization: Bearer $token" -F "file=@$sample" | ConvertFrom-Json
$id = $up.id
Write-Host "Uploaded dataset id=$id"

# Enterprise profile
$profile = Invoke-RestMethod "$base/api/data/datasets/$id/profile" -Headers $headers
Write-Host "`n=== Quality scores ==="
$profile.quality_scores | ConvertTo-Json
Write-Host "`n=== Column semantic types ==="
$profile.columns_detail | ForEach-Object { Write-Host ("{0,-15} -> {1} ({2}%)" -f $_.name, $_.semantic_type, [math]::Round($_.semantic_confidence * 100)) }
Write-Host "`n=== Correlation matrix keys ==="
$profile.correlation_matrix.PSObject.Properties.Name -join ", "
