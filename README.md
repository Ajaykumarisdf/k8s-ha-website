# 🚀 Kubernetes High Availability Website Project

A full-stack web application deployed on a highly available **K3s Kubernetes Cluster** with automated **CI/CD pipeline**, persistent **NFS storage**, and a resilient **MySQL database**.

![Project Architecture](https://mermaid.ink/img/pako:eNpVkM1qwzAQhF9F7KmF9gE89BTYQymlLaWQQ2x1HStbI60S2-S3V5adQk8tCPOtZma1g6S1wYQPVt1W3cCHqS_wOea8UeM4jFPC-TQlQkzTOCZcTAnjaZrG8zQlfM5TwuU0JXyuU8L1uiRcropoO9XoG9XatmoM-kZ1dq0616rRqdavqnOtWl3XqlO9Xqtdr_X52vXatbquVafa9VqfetfqU69XvV71etXrVa9XvV71etXrVa9XvV71etXrVa9XvV71etXrVa9XvV71etX_X_X-B_bwdT0)

## � Project Features

- **High Availability**: 3 Frontend replicas + 2 Backend replicas across 3 nodes.
- **Persistent Storage**: NFS-backed MySQL database survives pod/node failures.
- **Full-Stack**: React-style Frontend + Node.js/Express Backend + MySQL DB.
- **CI/CD Pipeline**: GitHub Actions automatically builds & deploys on push.
- **Infrastructure as Code**: All K8s manifests managed via Git.
- **Secure Configuration**: K8s Secrets for database credentials.
- **Ingress Routing**: Traefik handles traffic routing (`/` → Frontend, `/api` → Backend).

## 🏗️ Architecture Stack

- **Cluster**: K3s (1 Master + 2 Worker nodes on AWS EC2)
- **Frontend**: Nginx serving static HTML/JS/CSS (replicas: 3)
- **Backend**: Node.js API with MySQL connection pooling (replicas: 2)
- **Database**: MySQL 8.0 with PersistentVolume (NFS)
- **Ingress**: Traefik LoadBalancer
- **Registry**: GitHub Container Registry (GHCR)
- **Monitoring**: K8s metrics server & liveness/readiness probes

## � Project Structure

```bash
k8s-ha-website/
├── backend/            # Node.js API Source Code
│   ├── Dockerfile      # Backend Container Image
│   ├── server.js       # Express API Logic
│   └── ...
├── mysql/              # Database K8s Manifests
│   ├── mysql-pv.yaml   # Persistent Volume (NFS)
│   ├── mysql-secret.yaml # Encrypted Credentials
│   └── ...
├── .github/workflows/  # CI/CD Pipeline
│   └── deploy.yml      # Build & Deploy Workflow
├── index.html          # Frontend Source Code
├── deployment.yaml     # Frontend K8s Deployment
├── ingress.yaml        # Traefik Routing Rules
├── PROJECT_REPORT.md   # Detailed Technical Documentation
└── README.md           # This file
```

## 🚀 Deployment Guide

### Prerequisites
- Kubernetes Cluster (K3s recommended)
- NFS Server configured on Master/Storage node
- `kubectl` configured locally

### Quick Start
1. **Clone the repository**
   ```bash
   git clone https://github.com/Ajaykumarisdf/k8s-ha-website.git
   cd k8s-ha-website
   ```

2. **Deploy Database (First time only)**
   ```bash
   cd mysql
   kubectl apply -f mysql-secret.yaml -f mysql-pv.yaml -f mysql-pvc.yaml -f mysql-deployment.yaml -f mysql-service.yaml
   ```

3. **Deploy Application**
   ```bash
   cd ..
   kubectl apply -f deployment.yaml -f ingress.yaml -f backend/backend-deployment.yaml -f backend/backend-service.yaml
   ```

4. **Access the Website**
   Open your browser and navigate to your LoadBalancer IP or Domain.

## 🔄 CI/CD Automation

This project uses **GitHub Actions**:
1. **Build**: Docker images built for Frontend & Backend on every push.
2. **Push**: Images pushed to **GitHub Container Registry (GHCR)**.
3. **Deploy**: Workflow connects via SSH to the cluster Master node.
4. **Update**: Runs `kubectl rollout restart` to pull new images with zero downtime.

## � Detailed Documentation

For a deep dive into the technical details, architecture decisions, and code explanation, please read the **[Full Project Report](PROJECT_REPORT.md)**.

## 👨‍� Author

**Ajay Kumar**  
DevOps & Cloud Engineer
