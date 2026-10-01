# Drives the iCloud Passwords window. The setup key is written only to textboxTOTPCode
# in the iCloudPasswords process, using the value pattern. Replies never include the key.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$InformationPreference = "SilentlyContinue"
$WarningPreference = "SilentlyContinue"

Add-Type -AssemblyName UIAutomationClient
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PbFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$script:savedForeground = [IntPtr]::Zero
try { $script:savedForeground = [PbFocus]::GetForegroundWindow() } catch {}

function Reply($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5))
}

function Assert-Passwords($el) {
  if (-not $el) { throw "no-window" }
  $procId = $el.Current.ProcessId
  $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
  if ($name -ne "iCloudPasswords") { throw "no-window" }
}

function Get-PasswordsWindow {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $wins) {
    try {
      $procId = $w.Current.ProcessId
      $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
      if ($name -eq "iCloudPasswords") { return $w }
    } catch {}
  }
  return $null
}

function Find-Id($root, $id) {
  if (-not $root -or -not $id) { return $null }
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
  return $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
}

function Wait-Id($id, $seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    $win = Get-PasswordsWindow
    if ($win) {
      $el = Find-Id $win $id
      if ($el) { return $el }
    }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Show-Passwords($win) {
  try {
    $hwnd = [IntPtr]$win.Current.NativeWindowHandle
    if ($hwnd -eq [IntPtr]::Zero) { return }
    [PbFocus]::ShowWindow($hwnd, 9) | Out-Null
    [PbFocus]::SetForegroundWindow($hwnd) | Out-Null
  } catch {}
}

function Restore-Foreground {
  try {
    if ($script:savedForeground -ne [IntPtr]::Zero) {
      [PbFocus]::SetForegroundWindow($script:savedForeground) | Out-Null
    }
  } catch {}
}

function Read-Value($el, $allowedId) {
  if (-not $el) { return "" }
  if ([string]$el.Current.AutomationId -ne $allowedId) { return "" }
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    return [string]$vp.Current.Value
  } catch {
    return ""
  }
}

function Get-ItemEls($win) {
  $list = Find-Id $win "InternetCredentialsListView"
  if (-not $list) { return @() }
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ListItem)
  $items = $list.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  $out = @()
  $n = [Math]::Min($items.Count, 40)
  for ($i = 0; $i -lt $n; $i++) { $out += $items.Item($i) }
  return $out
}

function Read-Items($win) {
  $textCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text)
  $out = @()
  foreach ($el in (Get-ItemEls $win)) {
    $site = ""
    $user = ""
    try {
      $texts = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCond)
      $n = [Math]::Min($texts.Count, 4)
      if ($n -ge 1) { $site = [string]$texts.Item(0).Current.Name }
      if ($n -ge 2) { $user = [string]$texts.Item(1).Current.Name }
      $out += @{ name = [string]$el.Current.Name; site = $site; user = $user }
    } catch {}
  }
  return $out
}

function Read-Edit($win) {
  $code = Find-Id $win "textboxTOTPCode"
  if (-not $code) { return $null }
  Assert-Passwords $code
  return @{
    open = $true
    title = (Read-Value (Find-Id $win "textboxTitle") "textboxTitle")
    user = (Read-Value (Find-Id $win "textboxUserName") "textboxUserName")
  }
}

function Set-Secret($code, $secret) {
  if (-not $code) { return $false }
  if ([string]$code.Current.AutomationId -ne "textboxTOTPCode") { return $false }
  Assert-Passwords $code
  $vp = $code.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $vp.SetValue([string]$secret)
  return ([string]$vp.Current.Value -eq [string]$secret)
}

function Invoke-Save($code) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $node = $code
  $sheet = $null
  while ($node) {
    try {
      if ($node.Current.ControlType.ProgrammaticName -eq "ControlType.Window") { $sheet = $node; break }
    } catch {}
    try { $node = $walker.GetParent($node) } catch { break }
  }
  if (-not $sheet) { return $false }
  $save = Find-Id $sheet "PrimaryButton"
  if (-not $save) { return $false }
  if ([string]$save.Current.Name -ne "Save") { return $false }
  Assert-Passwords $save
  $inv = $save.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $inv.Invoke()
  return $true
}

function Invoke-Search($query) {
  $win = Get-PasswordsWindow
  if (-not $win) { return @{ ok = $false; filled = $false; reason = "no-window" } }
  Assert-Passwords $win
  $hostEl = Find-Id $win "mySearchBox"
  $box = $null
  if ($hostEl) { $box = Find-Id $hostEl "TextBox" }
  if (-not $box) { return @{ ok = $true; filled = $false; reason = "none"; items = @() } }
  Assert-Passwords $box
  $vp = $box.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $vp.SetValue([string]$query)
  Start-Sleep -Milliseconds 450
  $win = Get-PasswordsWindow
  if (-not $win) { return @{ ok = $false; filled = $false; reason = "no-window" } }
  return @{ ok = $true; filled = $false; reason = "listed"; items = @(Read-Items $win) }
}

function Invoke-FillEdit($secret, $expectTitle, $expectUser) {
  $win = Get-PasswordsWindow
  if (-not $win) { return @{ ok = $false; filled = $false; reason = "no-window" } }
  Show-Passwords $win
  $edit = Read-Edit $win
  if (-not $edit) {
    Restore-Foreground
    return @{ ok = $true; filled = $false; reason = "no-field" }
  }
  if ([string]$edit.title -ne [string]$expectTitle -or [string]$edit.user -ne [string]$expectUser) {
    Restore-Foreground
    return @{ ok = $true; filled = $false; reason = "none" }
  }
  $code = Find-Id $win "textboxTOTPCode"
  if (-not (Set-Secret $code $secret)) {
    Restore-Foreground
    return @{ ok = $true; filled = $false; reason = "no-field" }
  }
  $saved = $false
  try { $saved = Invoke-Save $code } catch { $saved = $false }
  Restore-Foreground
  if (-not $saved) { return @{ ok = $true; filled = $false; reason = "no-save" } }
  return @{ ok = $true; filled = $true; reason = "filled" }
}

function Invoke-FillItem($secret, $expectName) {
  if (-not $expectName) { return @{ ok = $true; filled = $false; reason = "none" } }
  $win = Get-PasswordsWindow
  if (-not $win) { return @{ ok = $false; filled = $false; reason = "no-window" } }
  Assert-Passwords $win
  Show-Passwords $win
  $matches = @()
  foreach ($item in (Get-ItemEls $win)) {
    try {
      if ([string]$item.Current.Name -eq [string]$expectName) { $matches += $item }
    } catch {}
  }
  if ($matches.Count -ne 1) {
    Restore-Foreground
    $reason = "none"
    if ($matches.Count -gt 1) { $reason = "many" }
    return @{ ok = $true; filled = $false; reason = $reason }
  }
  $item = $matches[0]
  Assert-Passwords $item
  try {
    $sel = $item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $sel.Select()
  } catch {
    Restore-Foreground
    return @{ ok = $true; filled = $false; reason = "none" }
  }
  Start-Sleep -Milliseconds 300
  $link = Wait-Id "m_buttonAddTOTP" 4
  if (-not $link -or ([string]$link.Current.Name -notmatch "(?i)set\s*up")) {
    Restore-Foreground
    return @{ ok = $true; filled = $false; reason = "no-setup" }
  }
  Assert-Passwords $link
  try {
    $inv = $link.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $inv.Invoke()
  } catch {
    Restore-Foreground
    return @{ ok = $true; filled = $false; reason = "no-setup" }
  }
  $code = Wait-Id "textboxTOTPCode" 5
  if (-not (Set-Secret $code $secret)) {
    Restore-Foreground
    return @{ ok = $true; filled = $false; reason = "no-field" }
  }
  $saved = $false
  try { $saved = Invoke-Save $code } catch { $saved = $false }
  Restore-Foreground
  if (-not $saved) { return @{ ok = $true; filled = $false; reason = "no-save" } }
  return @{ ok = $true; filled = $true; reason = "filled" }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if (-not $line) { continue }
  try {
    $req = $line | ConvertFrom-Json
    $op = [string]$req.op
    if ($op -eq "done") {
      Restore-Foreground
      Reply @{ ok = $true; filled = $false; reason = "done" }
      break
    } elseif ($op -eq "inspect") {
      $win = Get-PasswordsWindow
      if (-not $win) { Reply @{ ok = $false; filled = $false; reason = "no-window" }; continue }
      Assert-Passwords $win
      $edit = Read-Edit $win
      if ($edit) {
        Reply @{ ok = $true; filled = $false; reason = "edit"; edit = $edit; items = @() }
      } else {
        Reply @{ ok = $true; filled = $false; reason = "listed"; items = @(Read-Items $win) }
      }
    } elseif ($op -eq "search") {
      Reply (Invoke-Search ([string]$req.query))
    } elseif ($op -eq "fill-edit") {
      Reply (Invoke-FillEdit ([string]$req.secret) ([string]$req.expectTitle) ([string]$req.expectUser))
    } elseif ($op -eq "fill-item") {
      Reply (Invoke-FillItem ([string]$req.secret) ([string]$req.expectName))
    } else {
      Reply @{ ok = $false; filled = $false; reason = "helper" }
    }
  } catch {
    Reply @{ ok = $false; filled = $false; reason = "helper" }
  }
}
