# Вернуть firewall как было: включить блокировку node и убрать разрешение на 8443.
# Нужны права администратора. Обратная операция — firewall-open.ps1.

$ErrorActionPreference = 'Stop'

Write-Host 'включаю правила блокировки node.exe...' -ForegroundColor Yellow
Get-NetFirewallRule -DisplayName '*node*' | Enable-NetFirewallRule

$rule = Get-NetFirewallRule -DisplayName 'BKS5 8443' -ErrorAction SilentlyContinue
if ($rule) {
    Write-Host 'убираю разрешение на TCP 8443...' -ForegroundColor Yellow
    $rule | Remove-NetFirewallRule
}

Write-Host ''
Write-Host 'готово. Состояние:' -ForegroundColor Green
Get-NetFirewallRule -DisplayName '*node*', 'BKS5 8443' -ErrorAction SilentlyContinue |
    ForEach-Object { "  $($_.DisplayName) | $($_.Action) | $($_.Enabled) | профиль: $($_.Profile)" }
