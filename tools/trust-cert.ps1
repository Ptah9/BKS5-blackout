# Установка сертификата в доверенные корневые для текущего пользователя.
# Нужно один раз на каждой машине, иначе Chrome будет ругаться на https.
# Понадобится перед демо, когда интернета уже нет — поэтому делаем заранее.

$ErrorActionPreference = 'Stop'

$cer = Join-Path $PSScriptRoot '..\certs\cert.cer' | Resolve-Path -ErrorAction SilentlyContinue
if (-not $cer) {
    Write-Host 'нет certs\cert.cer — сначала npm run cert' -ForegroundColor Yellow
    exit 1
}

$imported = Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\CurrentUser\Root'
Write-Host ('установлен: ' + $imported.Thumbprint + ' — ' + $imported.Subject) -ForegroundColor Green
Write-Host 'перезапусти браузер, чтобы он перечитал хранилище доверия.'
