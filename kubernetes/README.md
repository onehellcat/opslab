# Kubernetes local lab

This directory contains the starting Kubernetes manifests for OpsLab.

## Apply the manifests

```bash
kubectl apply -f kubernetes/namespace.yaml
kubectl apply -f kubernetes/deployment.yaml
kubectl apply -f kubernetes/service.yaml
```

## Useful commands

```bash
kubectl get pods -n opslab
kubectl get svc -n opslab
kubectl logs -n opslab deployment/opslab-api
kubectl describe pod -n opslab <pod-name>
```

## Notes

These manifests are intentionally simple and designed as a learning base. They are used to explain the relationship between:

- Deployment
- Service
- ConfigMap
- readinessProbe
- livenessProbe
- namespace

A future step adds a real PostgreSQL StatefulSet and local registry-based image deployment.
