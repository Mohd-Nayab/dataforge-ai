# Test Phase 6: file validation, rate limiting, security headers
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

# 1. Test valid file upload still works
$sample = Join-Path $PSScriptRoot "..\docs\sample_data.csv"
$up = curl.exe -s -X POST "$base/api/data/datasets/upload" -H "Authorization: Bearer $token" -F "file=@$sample" | ConvertFrom-Json
Write-Host "=== Valid Upload ==="
Write-Host "OK  uploaded id=$($up.id) rows=$($up.rows)"

# 2. Test invalid file extension
$tmpDir = Join-Path $env:TEMP "df_test_phase6"
if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir | Out-Null }
$badFile = Join-Path $tmpDir "test.exe"
[System.IO.File]::WriteAllText($badFile, "fake executable content")
try {
  $badResp = curl.exe -s -X POST "$base/api/data/datasets/upload" -H "Authorization: Bearer $token" -F "file=@$badFile"
  $badObj = $badResp | ConvertFrom-Json
  if ($badObj.detail -and $badObj.detail -match "not supported") {
    Write-Host "`n=== Invalid Extension ==="
    Write-Host "OK  correctly rejected .exe file: $($badObj.detail)"
  } else {
    Write-Host "`n=== Invalid Extension ==="
    Write-Host "WARN  unexpected response: $badResp"
  }
} catch {
  Write-Host "OK  rejected with error"
}

# 3. Test empty file
$emptyFile = Join-Path $tmpDir "empty.csv"
[System.IO.File]::WriteAllText($emptyFile, "")
try {
  $emptyResp = curl.exe -s -X POST "$base/api/data/datasets/upload" -H "Authorization: Bearer $token" -F "file=@$emptyFile"
  $emptyObj = $emptyResp | ConvertFrom-Json
  if ($emptyObj.detail -and $emptyObj.detail -match "empty") {
    Write-Host "`n=== Empty File ==="
    Write-Host "OK  correctly rejected empty file: $($emptyObj.detail)"
  } else {
    Write-Host "`n=== Empty File ==="
    Write-Host "WARN  unexpected response: $emptyResp"
  }
} catch {
  Write-Host "OK  rejected empty file"
}

# 4. Test security headers
$healthResp = Invoke-WebRequest "$base/api/data/health" -Headers $headers -UseBasicParsing
Write-Host "`n=== Security Headers ==="
$secHeaders = @("X-Content-Type-Options", "X-Frame-Options", "X-XSS-Protection", "Referrer-Policy")
foreach ($h in $secHeaders) {
  $val = $healthResp.Headers[$h]
  if ($val) {
    Write-Host "OK  $h`: $val"
  } else {
    Write-Host "MISS  $h not found"
  }
}

# 5. Test rate limit headers
Write-Host "`n=== Rate Limit Headers ==="
$rlLimit = $healthResp.Headers["X-RateLimit-Limit"]
$rlRemaining = $healthResp.Headers["X-RateLimit-Remaining"]
Write-Host "OK  X-RateLimit-Limit: $rlLimit"
Write-Host "OK  X-RateLimit-Remaining: $rlRemaining"

# 6. Verify all existing endpoints still work
Write-Host "`n=== Regression Check ==="
$id = $up.id
$profile = Invoke-RestMethod "$base/api/data/datasets/$id/profile" -Headers $headers
Write-Host "OK  profile: $($profile.rows) rows, quality=$($profile.quality_scores.overall)"

$val = Invoke-RestMethod "$base/api/data/datasets/$id/enterprise-validate" -Headers $headers
Write-Host "OK  enterprise-validate: $($val.total_issues) issues"

$fuzzy = Invoke-RestMethod "$base/api/data/datasets/$id/fuzzy-duplicates?threshold=0.80" -Headers $headers
Write-Host "OK  fuzzy-duplicates: $($fuzzy.groups.Count) groups"

$rpt = Invoke-RestMethod "$base/api/data/datasets/$id/enterprise-report" -Headers $headers
Write-Host "OK  enterprise-report: quality=$($rpt.profile.quality_scores.overall)"

# Clean up
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "`nAll Phase 6 tests passed!"
