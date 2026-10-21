# =====================================================================
# servidor-local.ps1: servidor estático simples pra testar o painel no
# Windows sem instalar nada (usa o PowerShell que já vem no sistema).
#
# Como usar (na pasta do projeto):
#   powershell -ExecutionPolicy Bypass -File .\servidor-local.ps1
# Depois abra http://localhost:5173 no navegador. Pra parar: Ctrl+C.
# (No Mac/Linux, use:  python3 -m http.server 5173)
# =====================================================================
param([int]$Porta = 5173)

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$tipos = @{
  ".html" = "text/html; charset=utf-8"; ".css" = "text/css; charset=utf-8"
  ".js" = "application/javascript; charset=utf-8"; ".json" = "application/json"
  ".svg" = "image/svg+xml"; ".png" = "image/png"; ".jpg" = "image/jpeg"; ".ico" = "image/x-icon"
  ".md" = "text/plain; charset=utf-8"
}

$ouvinte = New-Object System.Net.HttpListener
$ouvinte.Prefixes.Add("http://localhost:$Porta/")
$ouvinte.Start()
Write-Host "Painel no ar em http://localhost:$Porta  (Ctrl+C pra parar)"

try {
  while ($ouvinte.IsListening) {
    $ctx = $ouvinte.GetContext()
    $caminho = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart("/")
    if ([string]::IsNullOrEmpty($caminho)) { $caminho = "index.html" }
    $arquivo = [System.IO.Path]::GetFullPath((Join-Path $raiz $caminho))

    if ($arquivo.StartsWith($raiz) -and (Test-Path $arquivo -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($arquivo).ToLower()
      $ctx.Response.ContentType = $(if ($tipos.ContainsKey($ext)) { $tipos[$ext] } else { "application/octet-stream" })
      $ctx.Response.Headers.Add("Cache-Control", "no-store")
      $bytes = [System.IO.File]::ReadAllBytes($arquivo)
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  }
} finally {
  $ouvinte.Stop()
}
