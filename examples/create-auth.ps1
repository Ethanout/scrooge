param([Parameter(Mandatory=$true)][string]$ApiKey)
$dir = Join-Path $env:LOCALAPPDATA "scrooge-mcp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$secure = ConvertTo-SecureString $ApiKey -AsPlainText -Force
$secure | ConvertFrom-SecureString | Set-Content -NoNewline -Path (Join-Path $dir "auth.dpapi")
Write-Host "Created $dir\auth.dpapi for the current Windows user."
