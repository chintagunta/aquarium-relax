# Starts (or restarts) the QA Chrome instance with the DevTools Protocol open
# on port 9333, and waits until it answers.
$ErrorActionPreference = 'SilentlyContinue'
Get-Process chrome | Where-Object { $_.Path -like '*Google\Chrome*' } | ForEach-Object {
  try {
    $cl = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
    if ($cl -like '*aquarium-v2\.qa\chrome*') { Stop-Process -Id $_.Id -Force }
  } catch {}
}
Start-Sleep -Milliseconds 800
Remove-Item -Recurse -Force 'D:\MyPublicRepos\aquarium-v2\.qa\chrome' -ErrorAction SilentlyContinue

Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList @(
  '--remote-debugging-port=9333',
  '--user-data-dir=D:\MyPublicRepos\aquarium-v2\.qa\chrome',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  # An occluded window stops being handed animation frames, which stalls every
  # check that waits on the live loop.
  '--disable-backgrounding-occluded-windows',
  '--disable-features=CalculateNativeWinOcclusion',
  '--hide-scrollbars', '--mute-audio', '--window-size=1512,900',
  'about:blank'
)
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 400
  try {
    $v = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9333/json/version' -TimeoutSec 2
    if ($v.StatusCode -eq 200) { Write-Output 'CDP ready'; exit 0 }
  } catch {}
}
Write-Output 'CDP failed to start'
exit 1
