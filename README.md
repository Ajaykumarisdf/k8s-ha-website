# 🚀 Kubernetes High Availability Website Project

A full-stack web application deployed on a highly available **K3s Kubernetes Cluster** with automated **CI/CD pipeline**, powered by **AWS managed services** — **EFS** for shared storage, **RDS** for managed MySQL, and **S3** for asset storage & backups.

## ✨ What's New: AWS Integration & HA Dashboard

- **🔄 Live HA Dashboard**: See in real-time which pod and node serves your request
- **📊 Pod Visualization**: Track pod names, node IPs, uptime, and memory usage
- **🗄️ AWS RDS MySQL**: Replaced in-cluster MySQL with managed RDS for production-grade reliability
- **📁 AWS EFS**: Replaced NFS with EFS CSI driver for cloud-native shared storage
- **📦 AWS S3**: Static asset storage and database backup archival
- **🔄 Request Flow**: Visual request flow from browser → ingress → pod → node → RDS

## 📋 Project Features

- **High Availability**: 3 Frontend replicas + 2 Backend replicas across 3 nodes.
- **Live HA Dashboard**: Real-time visualization of pod/node serving each request.
- **AWS Managed Services**: EFS, RDS MySQL, S3 for production-grade infrastructure.
- **Full-Stack**: Nginx Frontend + Node.js/Express Backend + AWS RDS MySQL.
- **CI/CD Pipeline**: GitHub Actions automatically builds & deploys on push.
- **Infrastructure as Code**: All K8s manifests managed via Git.
- **Secure Configuration**: K8s Secrets for database credentials.
- **Ingress Routing**: Traefik handles traffic routing (`/` → Frontend, `/api` → Backend).
- **Kubernetes Downward API**: Pod/node metadata exposed via environment variables.

## 🏗️ Architecture Stack

- **Cluster**: K3s (1 Master + 2 Worker nodes on AWS EC2)
- **Frontend**: Nginx serving static HTML/JS/CSS (replicas: 3)
- **Backend**: Node.js API with pod-info endpoint (replicas: 2)
- **Database**: AWS RDS MySQL 8.0 (Multi-AZ, encrypted)
- **Shared Storage**: AWS EFS via CSI Driver (ReadWriteMany)
- **Asset Storage**: AWS S3 (versioned, encrypted)
- **Ingress**: Traefik LoadBalancer
- **Registry**: GitHub Container Registry (GHCR)
- **Monitoring**: K8s metrics server & liveness/readiness probes

## 📁 Project Structure

```bash
k8s-ha-website/
├── aws/                        # AWS Service Configurations
│   ├── efs-storageclass.yaml   # EFS CSI StorageClass
│   ├── efs-pvc.yaml            # EFS PersistentVolumeClaim
│   ├── rds-secret.yaml         # RDS MySQL credentials
│   ├── s3-configmap.yaml       # S3 bucket configuration
│   └── setup-guide.sh          # AWS setup instructions
├── backend/                    # Node.js API Source Code
│   ├── Dockerfile              # Backend Container Image
│   ├── server.js               # Express API with pod-info endpoint
│   ├── backend-deployment.yaml # Deployment with Downward API
│   ├── backend-service.yaml    # ClusterIP service
│   └── package.json            # Dependencies
├── mysql/                      # Legacy MySQL manifests (deprecated)
│   └── ...                     # Replaced by AWS RDS
├── .github/workflows/          # CI/CD Pipeline
│   └── deploy.yml              # Build & Deploy Workflow
├── index.html                  # Frontend HA Dashboard
├── Dockerfile                  # Frontend Container Image
├── deployment.yaml             # Frontend K8s Deployment
├── service.yaml                # Frontend NodePort Service
├── ingress.yaml                # Traefik Routing Rules
├── PROJECT_REPORT.md           # Detailed Technical Documentation
└── README.md                   # This file
```

## 🚀 Deployment Guide

### Prerequisites
- Kubernetes Cluster (K3s recommended) on AWS EC2
- AWS Account with EFS, RDS, and S3 access
- `kubectl` configured locally
- AWS CLI configured

### Step 1: Setup AWS Services
```bash
# Follow the interactive setup guide
bash aws/setup-guide.sh

# This will guide you through:
# 1. Creating EFS File System + mount targets
# 2. Creating RDS MySQL instance
# 3. Creating S3 bucket with versioning
# 4. Configuring IAM permissions
```

### Step 2: Install EFS CSI Driver
```bash
kubectl apply -k "github.com/kubernetes-sigs/aws-efs-csi-driver/deploy/kubernetes/overlays/stable/?ref=release-2.0"
```

### Step 3: Update Configuration
```bash
# Update aws/efs-storageclass.yaml with your EFS File System ID
# Update aws/rds-secret.yaml with your RDS endpoint and credentials
# Update aws/s3-configmap.yaml with your S3 bucket name
```

### Step 4: Deploy AWS Resources
```bash
kubectl apply -f aws/efs-storageclass.yaml
kubectl apply -f aws/efs-pvc.yaml
kubectl apply -f aws/rds-secret.yaml
kubectl apply -f aws/s3-configmap.yaml
```

### Step 5: Deploy Application
```bash
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f ingress.yaml
kubectl apply -f backend/backend-deployment.yaml
kubectl apply -f backend/backend-service.yaml
```

### Step 6: Access the Website
```bash
# Get the NodePort
kubectl get svc ha-website-service

# Open in browser
http://<NODE_PUBLIC_IP>:<NODEPORT>
```

## 🔄 CI/CD Automation

This project uses **GitHub Actions**:
1. **Build**: Docker images built for Frontend & Backend on every push.
2. **Push**: Images pushed to **GitHub Container Registry (GHCR)**.
3. **Deploy**: Workflow connects via SSH to the cluster Master node.
4. **Update**: Runs `kubectl rollout restart` for zero-downtime deployments.

## 📊 HA Dashboard Features

The frontend dashboard provides real-time visualization of:

| Feature | Description |
|---------|-------------|
| **Pod Name** | Which backend pod served your current request |
| **Node Name** | Which K8s node the pod is running on |
| **Node IP** | The IP address of the serving node |
| **Pod IP** | Internal cluster IP of the serving pod |
| **Uptime** | How long the current pod has been running |
| **Memory Usage** | Current memory consumption of the pod |
| **Request Count** | Total requests served by this pod |
| **Request Flow** | Visual path: Browser → Ingress → Pod → Node → RDS |

**How it demonstrates HA**: Refresh the page multiple times (or wait for auto-refresh). You'll see different pod names and node IPs, proving that traffic is being load-balanced across multiple pods on different nodes.

## 📚 Migration: NFS/MySQL → AWS Services

| Component | Before (Local) | After (AWS) |
|-----------|----------------|-------------|
| Database | MySQL Pod + NFS PV | AWS RDS MySQL (Multi-AZ) |
| Shared Storage | NFS Server on Master | AWS EFS via CSI Driver |
| Asset Storage | None | AWS S3 (versioned, encrypted) |
| DB Credentials | K8s Secret (mysql-secret) | K8s Secret (rds-secret) |

## 📖 Detailed Documentation

For a deep dive into the technical details, architecture decisions, and code explanation, please read the **[Full Project Report](PROJECT_REPORT.md)**.

## 👨‍💻 Author

**Ajay Kumar**
DevOps & Cloud Engineer
