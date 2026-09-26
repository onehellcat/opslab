$ErrorActionPreference = 'Stop'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker is required but was not found on PATH.'
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw 'winget is required to install k3d on Windows.'
}

if (-not (Get-Command k3d -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing k3d via winget...'
  winget install --id k3d.k3d --exact --accept-source-agreements --accept-package-agreements
}

if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing kubectl via winget...'
  winget install --id Kubernetes.kubectl --exact --accept-source-agreements --accept-package-agreements
}

Write-Host 'Creating a local k3d cluster named opslab...'
k3d cluster create opslab --agents 2 --port '8080:80@loadbalancer' --api-port '6550:6550'

Write-Host 'Cluster ready. Try:'
Write-Host '  kubectl get nodes'
Write-Host '  kubectl get pods -A'
