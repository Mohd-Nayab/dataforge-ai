# Test Phase 4: fuzzy duplicate detection + outlier report
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

# Fuzzy duplicate detection
$fuzzy = Invoke-RestMethod "$base/api/data/datasets/$id/fuzzy-duplicates?threshold=0.80" -Headers $headers
Write-Host "`n=== Fuzzy Duplicate Detection ==="
Write-Host "Summary: $($fuzzy.summary)"
Write-Host "Groups: $($fuzzy.groups.Count)"
Write-Host "Total potential duplicates: $($fuzzy.total_potential_duplicates)"
if ($fuzzy.groups.Count -gt 0) {
  Write-Host "`nGroup details:"
  $fuzzy.groups | ForEach-Object {
    Write-Host ("  Rows: {0} | Similarity: {1} | Action: {2}" -f ($_.row_indices -join ","), $_.similarity_score, $_.suggested_action)
  }
}

# Outlier report
$outliers = Invoke-RestMethod "$base/api/data/datasets/$id/outlier-report" -Headers $headers
Write-Host "`n=== Outlier Report ==="
Write-Host "Summary: $($outliers.summary)"
Write-Host "Total outliers: $($outliers.total_outliers)"
Write-Host "`nColumn details:"
$outliers.column_reports.PSObject.Properties | ForEach-Object {
  $col = $_.Name
  $r = $_.Value
  Write-Host ("  {0}: IQR={1} Z-score={2} ModZ={3}" -f $col, $r.iqr.count, $r.zscore.count, $r.modified_zscore.count)
  if ($r.iqr.bounds) {
    Write-Host ("    IQR bounds: [{0}, {1}]" -f $r.iqr.bounds[0], $r.iqr.bounds[1])
  }
}

# Also test with a lower threshold to catch more fuzzy duplicates
$fuzzyLow = Invoke-RestMethod "$base/api/data/datasets/$id/fuzzy-duplicates?threshold=0.60" -Headers $headers
Write-Host "`n=== Fuzzy Duplicates (threshold=0.60) ==="
Write-Host "Groups: $($fuzzyLow.groups.Count)"
Write-Host "Total potential duplicates: $($fuzzyLow.total_potential_duplicates)"
if ($fuzzyLow.groups.Count -gt 0) {
  $fuzzyLow.groups | Select-Object -First 3 | ForEach-Object {
    Write-Host ("  Rows: {0} | Similarity: {1}" -f ($_.row_indices -join ","), $_.similarity_score)
  }
}
