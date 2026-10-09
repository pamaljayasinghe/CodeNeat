param([string]$Path=".",[switch]$Recurse)
function Get-LargeFile{param([string]$Folder,[int]$MinimumKB=100)
Get-ChildItem -Path $Folder -File -Recurse:$Recurse|Where-Object{$_.Length -gt ($MinimumKB*1KB)}|Sort-Object Length -Descending}
$files=Get-LargeFile -Folder $Path
if($files.Count -eq 0){Write-Host "No large files found"}
else{foreach($file in $files){
$sizeKB=[math]::Round($file.Length/1KB,1)
Write-Host ("{0,-40} {1,10} KB" -f $file.Name,$sizeKB)}}
