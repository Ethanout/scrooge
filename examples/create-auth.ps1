param()
$dir = Join-Path $env:LOCALAPPDATA "scrooge-mcp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$secure = Read-Host "DeepSeek API key" -AsSecureString
$secure | ConvertFrom-SecureString | Set-Content -NoNewline -Path (Join-Path $dir "auth.dpapi")
Write-Host "Created $dir\auth.dpapi for the current Windows user."
