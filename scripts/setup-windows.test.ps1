$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$setupPath = Join-Path $PSScriptRoot '..\setup.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($setupPath, [ref]$null, [ref]$null)
$definition = $ast.Find({
    param($item)
    $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Read-Tool'
}, $true)
. ([scriptblock]::Create($definition.Extent.Text))

$result = Read-Tool 'cmd.exe' @('/c', 'echo linux & echo warning 1>&2')
if ($result -ne 'linux') { throw 'A successful tool warning hid its standard output.' }
Write-Output 'PASS: Tool warnings preserve successful output.'
