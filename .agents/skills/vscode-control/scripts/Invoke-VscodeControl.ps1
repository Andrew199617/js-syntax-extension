#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ConnectionFile,

    [ValidateSet('health', 'tools')]
    [string]$Endpoint = 'tools',

    [string]$Tool,

    [string]$ArgumentsJson = '{}',

    [string]$ScreenshotPath
)

$ErrorActionPreference = 'Stop'
$connection = Get-Content -LiteralPath $ConnectionFile -Raw | ConvertFrom-Json
$serverUri = [Uri]$connection.url
if ($serverUri.Scheme -ne 'http' -or $serverUri.Host -ne '127.0.0.1' -or $serverUri.Port -lt 1 -or $serverUri.UserInfo -or $serverUri.Query -or $serverUri.Fragment -or $serverUri.AbsolutePath -ne '/') {
    throw 'The connection descriptor must point to the local VS Code control server.'
}
if ($connection.token -notmatch '^[a-f0-9]{64}$') {
    throw 'The connection descriptor has an invalid token.'
}

$headers = @{ Authorization = 'Bearer ' + $connection.token }
if ($Tool) {
    $toolArguments = ConvertFrom-Json -InputObject $ArgumentsJson -AsHashtable
    if ($toolArguments -isnot [System.Collections.IDictionary]) {
        throw 'Tool arguments must be a JSON object.'
    }
    $body = @{ name = $Tool; arguments = $toolArguments } | ConvertTo-Json -Depth 100 -Compress
    $result = Invoke-RestMethod -Uri ($connection.url + '/call') -Method Post -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 135
    if ($result.isError) {
        $messages = @($result.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text })
        throw ('VS Code tool failed: ' + ($messages -join [Environment]::NewLine))
    }
} else {
    $result = Invoke-RestMethod -Uri ($connection.url + '/' + $Endpoint) -Headers $headers -TimeoutSec 15
}

$images = @($result.content | Where-Object { $_.type -eq 'image' })
if ($images.Count -gt 0) {
    if (!$ScreenshotPath -or $images.Count -ne 1 -or $images[0].mimeType -ne 'image/png') {
        throw 'Use -ScreenshotPath for a tool that returns one PNG image.'
    }
    $absoluteScreenshotPath = [IO.Path]::GetFullPath($ScreenshotPath)
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($absoluteScreenshotPath)) | Out-Null
    [IO.File]::WriteAllBytes($absoluteScreenshotPath, [Convert]::FromBase64String($images[0].data))
    $result.content = @($result.content | Where-Object { $_.type -ne 'image' })
    $result | Add-Member -NotePropertyName screenshotPath -NotePropertyValue $absoluteScreenshotPath
}
$result | ConvertTo-Json -Depth 100