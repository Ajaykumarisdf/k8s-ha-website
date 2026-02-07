# K8s HA Website with CI/CD

A highly available static website deployed on Kubernetes with automated CI/CD pipeline using GitHub Actions.

## 🏗️ Architecture

```
Developer Push → GitHub → GitHub Actions → Docker Build → GHCR → Deploy to K8s
```

## 🚀 Features

- **High Availability**: 2 replicas with pod anti-affinity
- **CI/CD Pipeline**: Automated build and deploy on push
- **Container Registry**: GitHub Container Registry (GHCR)
- **Ingress**: Traefik for HTTP routing
- **Health Checks**: Liveness and readiness probes

## 📁 Project Structure

```
k8s-ha-website/
├── Dockerfile              # Container image definition
├── index.html              # Website content
├── deployment.yaml         # K8s Deployment
├── service.yaml           # K8s Service
├── ingress.yaml           # Traefik Ingress
├── pv-nfs.yaml            # PersistentVolume (NFS)
├── pvc-nfs.yaml           # PersistentVolumeClaim
└── .github/
    └── workflows/
        └── deploy.yml     # GitHub Actions workflow
```

## ⚙️ Setup

### Prerequisites
- Kubernetes cluster (K3s)
- GitHub account
- SSH access to K8s master node

### GitHub Secrets Required
| Secret | Description |
|--------|-------------|
| `K8S_HOST` | Public IP of K8s master node |
| `K8S_USER` | SSH username (usually `ubuntu`) |
| `K8S_SSH_KEY` | Private SSH key for EC2 |

### Deploy Manually
```bash
kubectl apply -f deployment.yaml -f service.yaml -f ingress.yaml
```

## 🔄 CI/CD Workflow

1. Push code to `main` branch
2. GitHub Actions builds Docker image
3. Image pushed to `ghcr.io/<username>/k8s-ha-website`
4. SSH to K8s master and update deployment
5. Website updated automatically

## 📊 Monitoring

Check deployment status:
```bash
kubectl get pods -l app=ha-website
kubectl rollout status deployment/ha-website
```

## 📝 License

MIT
