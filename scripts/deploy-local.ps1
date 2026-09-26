$ErrorActionPreference = 'Stop'

if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
  throw 'kubectl is required.'
}

kubectl apply -f .\kubernetes\namespace.yaml
kubectl apply -f .\kubernetes\deployment.yaml
kubectl apply -f .\kubernetes\service.yaml

Write-Host 'Waiting for pods to become ready...'
kubectl rollout status deployment/opslab-api -n opslab --timeout=180s
kubectl get pods -n opslab
kubectl get svc -n opslab
