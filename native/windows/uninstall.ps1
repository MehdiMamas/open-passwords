# Removes the HKCU native-messaging registrations and helper files this install added.
# Does not touch HKLM keys written by iCloud for Windows.
$ErrorActionPreference = "Stop"

$Dest = Join-Path $env:LOCALAPPDATA "OpenPasswords"
$AppleManifest = Join-Path $Dest "com.apple.passwordmanager.json"
$browsers = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts",
  "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
  "HKCU:\Software\Chromium\NativeMessagingHosts",
  "HKCU:\Software\Vivaldi\NativeMessagingHosts"
)

function Read-Default([string]$KeyPath) {
  if (-not (Test-Path -LiteralPath $KeyPath)) { return $null }
  return (Get-Item -LiteralPath $KeyPath).GetValue("")
}

foreach ($root in $browsers) {
  $appleKey = Join-Path $root "com.apple.passwordmanager"
  $current = Read-Default $appleKey
  if ($current -and $current -eq $AppleManifest) {
    Remove-Item -LiteralPath $appleKey -Force
    Write-Output "removed $appleKey"
  }
  foreach ($name in @("com.openpasswords.policy", "com.openpasswords.autopair")) {
    $key = Join-Path $root $name
    if (Test-Path -LiteralPath $key) {
      Remove-Item -LiteralPath $key -Force
      Write-Output "removed $key"
    }
  }
}

$policies = @(
  "HKCU:\Software\Policies\Google\Chrome",
  "HKCU:\Software\Policies\Microsoft\Edge",
  "HKCU:\Software\Policies\BraveSoftware\Brave",
  "HKCU:\Software\Policies\Chromium",
  "HKCU:\Software\Policies\Vivaldi"
)
foreach ($key in $policies) {
  if (-not (Test-Path -LiteralPath $key)) { continue }
  $item = Get-Item -LiteralPath $key
  $value = $item.GetValue("PasswordManagerEnabled", $null)
  if ($null -ne $value -and [int]$value -eq 0) {
    Remove-ItemProperty -LiteralPath $key -Name "PasswordManagerEnabled" -ErrorAction SilentlyContinue
    Write-Output "cleared PasswordManagerEnabled on $key"
  }
}

if (Test-Path -LiteralPath $Dest) {
  Remove-Item -LiteralPath $Dest -Recurse -Force
  Write-Output "removed $Dest"
}

Write-Output "Fully quit and reopen the browser."
