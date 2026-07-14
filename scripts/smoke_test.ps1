<#
  DataForge AI - end-to-end smoke test.
  Exercises the full stack through the Node backend (which proxies to FastAPI):
    register/login -> upload -> preview -> validate -> clean -> overview -> chat
    -> profiling -> export -> transforms -> sql
  Usage:  powershell -ExecutionPolicy Bypass -File scripts\smoke_test.ps1
#>
$ErrorActionPreference = "Stop"
$base = "http://localhost:4000"
$root = Split-Path -Parent $PSScriptRoot
$sample = Join-Path $root "docs\sample_data.csv"

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }

# 1. Health
Step "Health checks"
$h = Invoke-RestMethod "$base/health"
Ok "backend: $($h.service)"

# 2. Auth (register, fall back to login if the user already exists)
Step "Auth"
$cred = @{ name = "Smoke Tester"; email = "smoke@test.com"; password = "secret123" }
try {
  $auth = Invoke-RestMethod "$base/api/auth/register" -Method Post `
    -ContentType "application/json" -Body ($cred | ConvertTo-Json)
  Ok "registered $($auth.user.email) (role=$($auth.user.role))"
} catch {
  $auth = Invoke-RestMethod "$base/api/auth/login" -Method Post `
    -ContentType "application/json" `
    -Body (@{ email = $cred.email; password = $cred.password } | ConvertTo-Json)
  Ok "logged in $($auth.user.email)"
}
$token = $auth.token
$headers = @{ Authorization = "Bearer $token" }

# 2b. Admin (first registered user is admin)
if ($auth.user.role -eq "admin") {
  Step "Admin: list users"
  $users = Invoke-RestMethod "$base/api/admin/users" -Headers $headers
  Ok "admin users list returned $($users.users.Count) user(s)"
}

# 2c. Profile update
Step "Update profile"
$profile = Invoke-RestMethod "$base/api/auth/me" -Method Patch -Headers $headers `
  -ContentType "application/json" -Body (@{ name = "Smoke Tester Updated" } | ConvertTo-Json)
Ok "profile name updated to $($profile.user.name)"

# 3. Upload (multipart via curl.exe to avoid PS quoting issues)
Step "Upload sample_data.csv"
$uploadJson = & curl.exe -s -X POST "$base/api/data/datasets/upload" -H "Authorization: Bearer $token" -F "file=@$sample"
$ds = $uploadJson | ConvertFrom-Json
Ok "dataset id=$($ds.id)  rows=$($ds.rows)  cols=$($ds.columns) engine=$($ds.engine)"
$id = $ds.id

# 3b. Upload with Polars engine
Step "Upload sample_data.csv with Polars engine"
$uploadJsonPolars = & curl.exe -s -X POST "$base/api/data/datasets/upload" -H "Authorization: Bearer $token" -F "file=@$sample" -F "engine=polars"
$dsPolars = $uploadJsonPolars | ConvertFrom-Json
Ok "polars dataset id=$($dsPolars.id)  rows=$($dsPolars.rows)  cols=$($dsPolars.columns) engine=$($dsPolars.engine)"
$polarsId = $dsPolars.id

# 3c. Upload with Dask engine
Step "Upload sample_data.csv with Dask engine"
$uploadJsonDask = & curl.exe -s -X POST "$base/api/data/datasets/upload" -H "Authorization: Bearer $token" -F "file=@$sample" -F "engine=dask"
$dsDask = $uploadJsonDask | ConvertFrom-Json
Ok "dask dataset id=$($dsDask.id)  rows=$($dsDask.rows)  cols=$($dsDask.columns) engine=$($dsDask.engine)"
$daskId = $dsDask.id

# 4. Preview
Step "Preview"
$prev = Invoke-RestMethod "$base/api/data/datasets/$id/preview?page=1&page_size=5" -Headers $headers
Ok "columns: $(($prev.columns | ForEach-Object { $_.name }) -join ', ')"
Ok "returned $($prev.rows.Count) of $($prev.total) rows"

# 4b. Preview (Polars engine)
Step "Preview Polars-loaded dataset"
$prevPolars = Invoke-RestMethod "$base/api/data/datasets/$polarsId/preview?page=1&page_size=5" -Headers $headers
Ok "polars preview returned $($prevPolars.rows.Count) of $($prevPolars.total) rows"

# 4c. Preview (Dask engine)
Step "Preview Dask-loaded dataset"
$prevDask = Invoke-RestMethod "$base/api/data/datasets/$daskId/preview?page=1&page_size=5" -Headers $headers
Ok "dask preview returned $($prevDask.rows.Count) of $($prevDask.total) rows"

# 5. Validate
Step "Validate"
$val = Invoke-RestMethod "$base/api/data/datasets/$id/validate" -Headers $headers
Ok "found $($val.issues.Count) validation issue(s)"
$val.issues | Select-Object -First 5 | ForEach-Object { Write-Host "      [$($_.severity)] $($_.message)" }

# 6. Clean - remove duplicates
Step "Clean: remove_duplicates"
$clean = Invoke-RestMethod "$base/api/data/datasets/$id/clean" -Method Post -Headers $headers `
  -ContentType "application/json" -Body (@{ operation = "remove_duplicates"; params = @{} } | ConvertTo-Json)
Ok "$($clean.message)  -> rows now $($clean.meta.rows)"

# 7. Overview analytics
Step "Analytics overview"
$ov = Invoke-RestMethod "$base/api/data/datasets/$id/overview" -Headers $headers
Ok "numeric=$($ov.kpis.numeric_columns)  categorical=$($ov.kpis.categorical_columns)"

# 8. AI chat
Step "AI chat"
$chat = Invoke-RestMethod "$base/api/data/datasets/$id/chat" -Method Post -Headers $headers `
  -ContentType "application/json" -Body (@{ message = "explain this dataset" } | ConvertTo-Json)
Ok "reply: $($chat.reply.Substring(0, [Math]::Min(120, $chat.reply.Length)))..."

# 9. Profiling stats
Step "Profiling (/stats)"
$prof = Invoke-RestMethod "$base/api/data/datasets/$id/stats" -Headers $headers
Ok "profiled $($prof.columns_detail.Count) columns; missing=$($prof.missing_pct)%  memory=$($prof.memory_kb)KB"

# 10. Export in every format
Step "Export (csv / json / xlsx)"
foreach ($fmt in @("csv", "json", "xlsx")) {
  $code = & curl.exe -s -o NUL -w "%{http_code}" -H "Authorization: Bearer $token" "$base/api/data/datasets/$id/export?format=$fmt"
  if ($code -ne "200") { throw "Export $fmt failed with HTTP $code" }
  Ok "export $fmt -> HTTP $code"
}

# 11. Column transforms
Step "Column transforms"
$rename = Invoke-RestMethod "$base/api/data/datasets/$id/clean" -Method Post -Headers $headers `
  -ContentType "application/json" -Body (@{ operation = "rename_column"; params = @{ old = "city"; new = "city_name" } } | ConvertTo-Json)
Ok "$($rename.message)"

$split = Invoke-RestMethod "$base/api/data/datasets/$id/clean" -Method Post -Headers $headers `
  -ContentType "application/json" -Body (@{ operation = "split_column"; params = @{ column = "email"; delimiter = "@" } } | ConvertTo-Json)
Ok "$($split.message)"

$merge = Invoke-RestMethod "$base/api/data/datasets/$id/clean" -Method Post -Headers $headers `
  -ContentType "application/json" -Body (@{ operation = "merge_columns"; params = @{ columns = @("id", "name"); separator = " | "; new = "id_name" } } | ConvertTo-Json)
Ok "$($merge.message)"

# 12. SQL Workspace
Step "SQL Workspace"
$sql = Invoke-RestMethod "$base/api/data/datasets/$id/sql" -Method Post -Headers $headers `
  -ContentType "application/json" -Body (@{ query = "SELECT city_name, COUNT(*) AS count FROM data GROUP BY city_name ORDER BY count DESC"; limit = 100 } | ConvertTo-Json)
Ok "SQL returned $($sql.row_count) row(s) with columns: $(($sql.columns | ForEach-Object { $_.name }) -join ', ')"

$sampleName = (Get-Item $sample).BaseName.ToLower().Replace(" ", "_")
$sqlByName = Invoke-RestMethod "$base/api/data/datasets/$id/sql" -Method Post -Headers $headers `
  -ContentType "application/json" -Body (@{ query = "SELECT COUNT(*) AS count FROM $sampleName"; limit = 100 } | ConvertTo-Json)
Ok "SQL by dataset name returned $($sqlByName.row_count) row(s)"

Step "SQL query cache"
$sqlCached = Invoke-RestMethod "$base/api/data/datasets/$id/sql" -Method Post -Headers $headers `
  -ContentType "application/json" -Body (@{ query = "SELECT city_name, COUNT(*) AS count FROM data GROUP BY city_name ORDER BY count DESC"; limit = 100 } | ConvertTo-Json)
if ($sqlCached.cached -ne $true) { throw "Expected second identical SQL query to be cached" }
Ok "second identical SQL query returned from cache"

$sqlErr = $null
try {
  Invoke-RestMethod "$base/api/data/datasets/$id/sql" -Method Post -Headers $headers `
    -ContentType "application/json" -Body (@{ query = "DELETE FROM data" } | ConvertTo-Json) | Out-Null
} catch {
  $sqlErr = $_
}
if ($sqlErr -and $sqlErr.Exception.Response.StatusCode.value__ -eq 400) {
  Ok "write SQL correctly rejected with HTTP 400"
} else {
  throw "Expected non-SELECT SQL to be rejected with 400"
}

# 13. ML Studio (train + predict)
Step "ML Studio"
$train = Invoke-RestMethod "$base/api/data/datasets/$id/ml/train" -Method Post -Headers $headers `
  -ContentType "application/json" -Body (@{ target = "salary"; test_size = 0.3 } | ConvertTo-Json)
$metricStr = ($train.metrics.PSObject.Properties | ForEach-Object { "$($_.Name)=$([math]::Round($_.Value, 4))" }) -join ", "
Ok "trained $($train.task) model $($train.model_id) on $($train.rows_used) rows ($metricStr)"

$models = Invoke-RestMethod "$base/api/data/datasets/$id/ml/models" -Headers $headers
Ok "model registry has $($models.Count) model(s)"

$pred = Invoke-RestMethod "$base/api/data/datasets/$id/ml/predict" -Method Post -Headers $headers `
  -ContentType "application/json" -Body (@{ model_id = $train.model_id } | ConvertTo-Json)
Ok "predicted $($pred.rows) row(s); columns include 'prediction' = $($pred.columns -contains 'prediction')"

# 14. Report Builder
Step "Report Builder"
$report = Invoke-RestMethod "$base/api/data/datasets/$id/report" -Headers $headers
Ok "report generated for '$($report.dataset.name)' with quality score $($report.summary.quality_score)/100"
$reportFile = curl.exe -s -o "C:\Windows\Temp\dataforge_report.html" -w "%{http_code}" `
  "$base/api/data/datasets/$id/report/download" -H "Authorization: Bearer $token"
if ($reportFile -eq 200) {
  Ok "report HTML downloaded successfully"
} else {
  throw "Report download returned HTTP $reportFile"
}

# 15. Forecasting
Step "Forecasting"
$forecast = Invoke-RestMethod "$base/api/data/datasets/$id/forecast" -Method Post -Headers $headers `
  -ContentType "application/json" -Body (@{ method = "linear"; horizon = 7 } | ConvertTo-Json)
Ok "forecasted $($forecast.horizon) day(s) on '$($forecast.date_col)'; historical=$($forecast.historical.Count), forecast=$($forecast.forecast.Count)"

Write-Host "`nALL SMOKE TESTS PASSED" -ForegroundColor Green
