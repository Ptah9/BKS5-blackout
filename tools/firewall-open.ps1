# Открыть игру для локальной сети: выключить блокировку node и разрешить порт 8443.
# Нужны права администратора. Обратная операция — firewall-close.ps1.

$ErrorActionPreference = 'Stop'

Write-Host 'выключаю правила блокировки node.exe...' -ForegroundColor Yellow
Get-NetFirewallRule -DisplayName '*node*' | Disable-NetFirewallRule

if (-not (Get-NetFirewallRule -DisplayName 'BKS5 8443' -ErrorAction SilentlyContinue)) {
    Write-Host 'добавляю разрешение на TCP 8443...' -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName 'BKS5 8443' `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8443 -Profile Public | Out-Null
} else {
    Write-Host 'правило BKS5 8443 уже есть'
}

Write-Host ''
Write-Host 'готово. Состояние:' -ForegroundColor Green
Get-NetFirewallRule -DisplayName '*node*', 'BKS5 8443' |
    ForEach-Object { "  $($_.DisplayName) | $($_.Action) | $($_.Enabled) | профиль: $($_.Profile)" }
