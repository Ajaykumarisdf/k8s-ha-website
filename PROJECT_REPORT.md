# 🚀 K8s High Availability Website Project - Technical Report

## 1. Architecture Overview

This project is a **Highly Available (HA) Full-Stack Web Application** deployed on a Kubernetes cluster. It demonstrates modern DevOps practices including Containerization, Orchestration, CI/CD, and Persistent Storage.

### System Diagram
```mermaid
graph TD
    User((User)) -->|HTTP/80| Ingress[Traefik Ingress]
    
    Ingress -->|/| Frontend[Frontend Service]
    Ingress -->|/api| Backend[Backend API Service]
    
    subgraph "Frontend Layer"
        Frontend --> Pod1[Nginx Pod 1]
        Frontend --> Pod2[Nginx Pod 2]
        Frontend --> Pod3[Nginx Pod 3]
    end
    
    subgraph "Backend Layer"
        Backend --> API1[Node.js API 1]
        Backend --> API2[Node.js API 2]
    end
    
    subgraph "Data Layer"
        API1 -->|Auth| Secret[K8s Secret]
        API2 -->|Auth| Secret
        API1 -->|Read/Write| MySQL[MySQL Pod]
        API2 -->|Read/Write| MySQL
        MySQL -->|Mount| PVC[PVC]
        PVC -->|Bind| PV[PV]
        PV -->|Store| NFS[NFS Share (on Master)]
    end
```

---

## 2. Infrastructure Layer

### Kubernetes Cluster (K3s)
- **Master Node**: Control plane + NFS Server
- **Worker 1 & 2**: Application nodes
- **Strategy**: Pods are distributed across all 3 nodes for High Availability. If one node fails, others take over.

### Storage (NFS)
- **Why NFS?** Pods are ephemeral (they die and restart). Local storage on a pod is lost when it dies.
- **Solution**: We created an NFS server on the Master node (`/mnt/shared-disk`).
- **How it works**:
  - **PV (`mysql-pv.yaml`)**: Points to the physical NFS folder.
  - **PVC (`mysql-pvc.yaml`)**: A "ticket" the MySQL pod uses to claim 5GB of storage.
  - **Result**: Even if the MySQL pod moves to a different node, it mounts the *same* NFS folder, preserving all data.

---

## 3. Database Layer

### MySQL Deployment (`mysql/mysql-deployment.yaml`)
- **Image**: `mysql:8.0`
- **Replicas**: 1 (Stateful databases usually run single-master)
- **Storage**: Mounts `mysql-pvc` to `/var/lib/mysql`.
- **Security**: Uses **Kubernetes Secrets** (`mysql-secret.yaml`) to inject variables like `MYSQL_ROOT_PASSWORD` securely. The passwords are base64 encoded, not plain text.

---

## 4. Backend Layer (Node.js API)

### Code (`backend/server.js`)
- **Technology**: Express.js + MySQL2 client.
- **Function**: Provides REST API endpoints (`GET /api/guestbook`, `POST /api/guestbook`) for the frontend.
- **Resiliency**: It has a retry loop (`initDB()`) that waits for MySQL to be ready before starting. This prevents crash loops if the DB is slow to start.

### Dockerfile (`backend/Dockerfile`)
- **Base Image**: `node:18-alpine` (Small, secure).
- **Security**: Runs as non-root user `node`.
- **Optimization**: Copies `package.json` first to cache dependencies (faster builds).

### Deployment (`backend/backend-deployment.yaml`)
- **Replicas**: 2 (For HA).
- **Env Vars**: Injects DB credentials from the same K8s Secret used by MySQL.
- **Probes**: 
  - `livenessProbe`: Checks `/api/health`. If it fails, K8s restarts the pod.
  - `readinessProbe`: Checks if ready to receive traffic.

---

## 5. Frontend Layer

### Website (`index.html`)
- **Technology**: Plain HTML/CSS/JS (No framework needed for this scale).
- **Dynamic Content**: Uses JavaScript `fetch()` to call the Backend API.
- **Design**: Modern glassmorphism UI with responsive CSS.

### Deployment (`deployment.yaml`)
- **Replicas**: 3 (Ensures zero downtime during updates).
- **Anti-Affinity**: Configured to *prefer* running on different nodes. This ensures that if one node dies, not all frontend pods die with it.

---

## 6. Networking Layer

### Services (`service.yaml`, `backend-service.yaml`)
- **Type**: `ClusterIP` (Internal only).
- **Purpose**: Gives a stable internal IP/DNS name.
  - Frontend talks to `mysql-service`, not a specific pod IP.
  - Ingress talks to `ha-website-service`.

### Ingress (`ingress.yaml`)
- **Controller**: Traefik (Built-in to K3s).
- **Routing Rules**:
  - `path: /api` → Routes to **Backend Service** (Node.js)
  - `path: /` → Routes to **Frontend Service** (Nginx)
- **Benefit**: You only expose Port 80 to the world. The Ingress acts as a smart router/reverse proxy.

---

## 7. CI/CD Pipeline (GitHub Actions)

### Workflow (`.github/workflows/deploy.yml`)
**Trigger**: Push to `main` branch.

**Job 1 & 2: Build (Parallel)**
1. Checks out code.
2. Logs in to **GitHub Container Registry (GHCR)**.
3. Builds Docker images for Frontend and Backend.
4. Pushes images to GHCR with `latest` and `commit-sha` tags.

**Job 3: Deploy**
1. **SCP (Copy)**: Copies the latest YAML manifests from your repo to the K8s Master node.
2. **SSH (Execute)**: Connects to Master node and runs:
   - `kubectl apply`: Updates configurations.
   - `kubectl rollout restart`: Forces pods to pull the new images immediately.

---

## Summary of "How it Works Together"

1. **Developer** pushes code change to GitHub.
2. **GitHub Actions** builds new Docker images and pushes to Registry.
3. **GitHub Actions** SSHs into Cluster and tells K8s to update.
4. **Kubernetes** starts new pods with new images.
5. **Traefik Ingress** routes user traffic to the new Frontend pods.
6. **Frontend** JS calls `/api/guestbook`.
7. **Ingress** routes `/api` to Backend pods.
8. **Backend** connects to MySQL Service using credentials from Secrets.
9. **MySQL** reads/writes data to the NFS share.

**Result**: A fully automated, self-healing, highly available application! 🚀
