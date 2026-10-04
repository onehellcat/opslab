# Kubernetes local lab

This directory contains the Kubernetes manifests for OpsLab.

| File | What it creates |
| --- | --- |
| `namespace.yaml` | The `opslab` namespace and the `opslab-config` ConfigMap |
| `postgres.yaml` | The `opslab-db` Secret, a headless `postgres` Service, and a one-replica PostgreSQL StatefulSet with a 1Gi volume |
| `deployment.yaml` | Two API replicas with probes, resource requests, a locked-down security context, and a PodDisruptionBudget |
| `service.yaml` | The `opslab-api` ClusterIP Service |

Both API pods use the same PostgreSQL database, so they return the same data whichever one answers.

## Apply the manifests

Build and import the image first (for k3d: `docker build -t opslab-api:local app`, then `k3d image import opslab-api:local -c opslab`).

```bash
kubectl apply -f kubernetes/namespace.yaml
kubectl apply -f kubernetes/postgres.yaml
kubectl apply -f kubernetes/deployment.yaml
kubectl apply -f kubernetes/service.yaml
kubectl rollout status deployment/opslab-api -n opslab
```

## Useful commands

```bash
kubectl get pods,pvc,pdb -n opslab
kubectl get svc,endpoints -n opslab
kubectl logs -n opslab deployment/opslab-api
kubectl describe pod -n opslab <pod-name>
```

See which pod answers each request:

```bash
kubectl port-forward -n opslab svc/opslab-api 8080:80
curl -si localhost:8080/api/services | grep -i x-served-by
```

A port-forward pins to one pod. To see both pods take turns, call the Service from inside the cluster:

```bash
kubectl run probe --rm -i --restart=Never --image=curlimages/curl -n opslab --command -- \
  sh -c 'for i in 1 2 3 4 5 6; do curl -s -D - -o /dev/null http://opslab-api/api/services | grep -i x-served-by; done'
```

## Notes

- The database password in `postgres.yaml` is a local teaching value. Do not reuse the pattern of committing a Secret for anything real.
- The ConfigMap sets `NODE_ENV: development`, which leaves the incident lab's fault injection on. Set it to `production` to switch that off.
- The API waits for the database on start, so applying everything at once is fine.
