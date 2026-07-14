# Quick verification of the smart cleaning endpoint.
$ErrorActionPreference = "Stop"
$base = "http://localhost:4000"

# Login
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

# Smart clean (dry run first)
$body = @{ dry_run = $true } | ConvertTo-Json
$dryRun = Invoke-RestMethod "$base/api/data/datasets/$id/smart-clean" -Method Post -ContentType "application/json" -Headers $headers -Body $body
Write-Host "`n=== DRY RUN ==="
Write-Host "Rows: $($dryRun.rows_before) -> $($dryRun.rows_after)"
Write-Host "Cells changed: $($dryRun.cells_changed)"
Write-Host "Audit entries: $($dryRun.audit_log.Count)"
Write-Host "Halted: $($dryRun.halted)"
Write-Host "Summary: $($dryRun.summary)"

# Show first 5 audit entries
Write-Host "`n=== First 5 audit entries ==="
$dryRun.audit_log | Select-Object -First 5 | ForEach-Object {
  Write-Host ("  [{0}] {1} row={2} | '{3}' -> '{4}' | conf={5} | {6}" -f $_.method, $_.column, $_.row_index, $_.old_value, $_.new_value, $_.confidence, $_.reason)
}

# Now apply for real
$bodyApply = @{ dry_run = $false } | ConvertTo-Json
$applied = Invoke-RestMethod "$base/api/data/datasets/$id/smart-clean" -Method Post -ContentType "application/json" -Headers $headers -Body $bodyApply
Write-Host "`n=== APPLIED ==="
Write-Host "Rows: $($applied.rows_before) -> $($applied.rows_after)"
Write-Host "Cells changed: $($applied.cells_changed)"
Write-Host "Halted: $($applied.halted)"

# Check audit log endpoint
$audit = Invoke-RestMethod "$base/api/data/datasets/$id/audit-log" -Headers $headers
Write-Host "`n=== Audit log endpoint ==="
Write-Host "Entries: $($audit.audit_log.Count)"

# Group by method
Write-Host "`n=== Audit by method ==="
$audit.audit_log | Group-Object method | ForEach-Object {
  Write-Host ("  {0}: {1}" -f $_.Name, $_.Count)
}
