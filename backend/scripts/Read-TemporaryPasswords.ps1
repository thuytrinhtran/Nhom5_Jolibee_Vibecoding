param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# No plaintext is written to stdout, a log, clipboard or a file.
$encrypted = [Convert]::FromBase64String([IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path).Path).Trim())
$plain = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$handoff = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
$form = New-Object Windows.Forms.Form
$form.Text = 'JolliShift - Temporary password handoff'
$form.Size = New-Object Drawing.Size(560,260)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$select = New-Object Windows.Forms.ComboBox
$select.Location = New-Object Drawing.Point(20,20)
$select.Size = New-Object Drawing.Size(500,30)
$select.DropDownStyle = 'DropDownList'
foreach ($account in $handoff.accounts) { [void]$select.Items.Add($account.username) }
$email = New-Object Windows.Forms.TextBox
$email.Location = New-Object Drawing.Point(20,65)
$email.Size = New-Object Drawing.Size(500,30)
$email.ReadOnly = $true
$password = New-Object Windows.Forms.TextBox
$password.Location = New-Object Drawing.Point(20,105)
$password.Size = New-Object Drawing.Size(500,30)
$password.ReadOnly = $true
$password.UseSystemPasswordChar = $true
$show = New-Object Windows.Forms.CheckBox
$show.Text = 'Show password locally (do not share screenshots)'
$show.Location = New-Object Drawing.Point(20,150)
$show.Size = New-Object Drawing.Size(500,30)
$select.Add_SelectedIndexChanged({ $a = $handoff.accounts[$select.SelectedIndex]; $email.Text = $a.email; $password.Text = $a.password; $show.Checked = $false })
$show.Add_CheckedChanged({ $password.UseSystemPasswordChar = -not $show.Checked })
$form.Controls.AddRange(@($select,$email,$password,$show))
if ($select.Items.Count -gt 0) { $select.SelectedIndex = 0 }
[void]$form.ShowDialog()
$password.Clear(); $email.Clear(); [Array]::Clear($plain,0,$plain.Length)
$handoff = $null
$form.Dispose()
