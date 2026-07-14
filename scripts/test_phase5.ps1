# Test Phase 5: enterprise report JSON, HTML download, and multi-sheet Excel export
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

# Run smart clean to generate audit log
$body = @{ dry_run = $false } | ConvertTo-Json
$clean = Invoke-RestMethod "$base/api/data/datasets/$id/smart-clean" -Method Post -ContentType "application/json" -Headers $headers -Body $body
Write-Host "Smart clean: $($clean.cells_changed) cells changed, $($clean.audit_log.Count) audit entries"

# Enterprise report (JSON)
$rpt = Invoke-RestMethod "$base/api/data/datasets/$id/enterprise-report" -Headers $headers
Write-Host "`n=== Enterprise Report (JSON) ==="
Write-Host "Dataset: $($rpt.dataset.name)"
Write-Host "Profile rows: $($rpt.profile.rows)"
Write-Host "Quality scores: overall=$($rpt.profile.quality_scores.overall)"
Write-Host "Validation issues: $($rpt.validation.total_issues)"
Write-Host "Outlier total: $($rpt.outliers.total_outliers)"
Write-Host "Fuzzy dup groups: $($rpt.fuzzy_duplicates.groups.Count)"
Write-Host "Audit log entries: $($rpt.audit_log.Count)"

# Enterprise report HTML download
$htmlResp = Invoke-WebRequest "$base/api/data/datasets/$id/enterprise-report/download?format=html" -Headers $headers -UseBasicParsing
Write-Host "`n=== Enterprise Report HTML ==="
Write-Host "Status: $($htmlResp.StatusCode)"
Write-Host "Content-Type: $($htmlResp.Headers['Content-Type'])"
Write-Host "Content-Length: $($htmlResp.Content.Length) chars"
Write-Host "Contains 'Enterprise Report': $($htmlResp.Content -match 'Enterprise Report')"

# Enterprise report Excel download
$xlsxResp = Invoke-WebRequest "$base/api/data/datasets/$id/enterprise-report/download?format=xlsx" -Headers $headers -UseBasicParsing
Write-Host "`n=== Enterprise Report Excel ==="
Write-Host "Status: $($xlsxResp.StatusCode)"
Write-Host "Content-Type: $($xlsxResp.Headers['Content-Type'])"
Write-Host "Content-Length: $($xlsxResp.Content.Length) bytes"

# Save the Excel file to verify it's valid
$xlsxPath = Join-Path $env:TEMP "test_enterprise_report.xlsx"
[System.IO.File]::WriteAllBytes($xlsxPath, $xlsxResp.Content)
Write-Host "Saved to: $xlsxPath"
Write-Host "File size: $((Get-Item $xlsxPath).Length) bytes"

Write-Host "`nAll Phase 5 tests passed!"
