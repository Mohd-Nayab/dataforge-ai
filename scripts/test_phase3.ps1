# Test Phase 3: enterprise validation + phone/address/URL standardization
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

# Enterprise validation
$val = Invoke-RestMethod "$base/api/data/datasets/$id/enterprise-validate" -Headers $headers
Write-Host "`n=== Enterprise Validation ==="
Write-Host "Total issues: $($val.total_issues)"
Write-Host "Overall quality: $($val.overall_quality)/100"
Write-Host "`nIssues by rule:"
$val.issues | Group-Object rule | ForEach-Object {
  Write-Host ("  {0}: {1}" -f $_.Name, $_.Count)
}
Write-Host "`nFirst 5 issues:"
$val.issues | Select-Object -First 5 | ForEach-Object {
  Write-Host ("  [{0}] {1}: {2}" -f $_.severity, $_.column, $_.message)
}

# Smart clean (dry run) - should now include phone/address/URL steps
$body = @{ dry_run = $true } | ConvertTo-Json
$dryRun = Invoke-RestMethod "$base/api/data/datasets/$id/smart-clean" -Method Post -ContentType "application/json" -Headers $headers -Body $body
Write-Host "`n=== Smart Clean Dry Run ==="
Write-Host "Cells changed: $($dryRun.cells_changed)"
Write-Host "Audit entries: $($dryRun.audit_log.Count)"
Write-Host "Summary: $($dryRun.summary)"

# Show audit by method
Write-Host "`nAudit by method:"
$dryRun.audit_log | Group-Object method | ForEach-Object {
  Write-Host ("  {0}: {1}" -f $_.Name, $_.Count)
}
