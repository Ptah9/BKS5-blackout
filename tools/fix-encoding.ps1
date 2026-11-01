param([Parameter(Mandatory = $true)][string]$Path)

# Fix double-encoded Russian text in a file.
# Cause: a UTF-8 file was read as cp1251 and written back as UTF-8, so
# "игрок" turned into "РёРіСЂРѕРє". Undo: take characters -> cp1251 bytes
# -> decode those bytes as UTF-8.
# Keep this file ASCII-only: PowerShell 5.1 reads UTF-8 without BOM as ANSI.

$bytes = [IO.File]::ReadAllBytes($Path)
$mojibake = [Text.Encoding]::UTF8.GetString($bytes)
$cp1251 = [Text.Encoding]::GetEncoding(1251)
$restoredBytes = $cp1251.GetBytes($mojibake)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$restored = [Text.Encoding]::UTF8.GetString($restoredBytes)
[IO.File]::WriteAllText($Path, $restored, $utf8NoBom)

Write-Output ("fixed: " + $Path)
