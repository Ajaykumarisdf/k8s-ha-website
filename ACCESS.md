# Website Access Instructions

## 🌐 Access Your Website

Your high-availability website with live HA dashboard is now running!

### Step 1: Get Your Public IP

Run this command to find your EC2 public IP:
```bash
curl ifconfig.me
```

### Step 2: Configure Security Group

**IMPORTANT**: You must allow inbound traffic on the NodePort in your EC2 security group.

1. Go to AWS Console → EC2 → Security Groups
2. Find your instance's security group
3. Add inbound rules:
   - **Type**: Custom TCP
   - **Port**: `<NodePort>` (check with `kubectl get svc ha-website-service`)
   - **Source**: 0.0.0.0/0 (or your specific IP for security)

### Step 3: Access the Website

Open your browser and visit:
```
http://<YOUR_PUBLIC_IP>:<NODEPORT>
```

You should see the **HA Dashboard** showing:
- Which **pod** is serving your request
- Which **node** the pod is running on
- The **Node IP** address
- **Pod uptime** and **memory usage**
- **Request count** per pod
- **Request flow** visualization (Browser → Ingress → Pod → Node → RDS)

## 🔄 Demonstrating High Availability

### Watch the Dashboard Auto-Refresh

The dashboard automatically refreshes every **5 seconds**. As it refreshes:
- You'll see **different pod names** appear (e.g., `guestbook-api-xxx-abc` → `guestbook-api-xxx-def`)
- You'll see **different node names** and **node IPs** change
- The **Pod History** section accumulates all pods that have served your requests

This proves that traffic is being **load-balanced** across multiple pods on different nodes!

### Test Pod Recovery

```bash
# 1. Watch the dashboard in your browser

# 2. Delete a backend pod
kubectl delete pod <pod-name> -l app=guestbook-api

# 3. The dashboard will briefly show a connection error
#    Then automatically recover as Kubernetes starts a new pod

# 4. The new pod will appear in the Pod History section!
```

### Test Node Failure Simulation

```bash
# 1. Cordon a worker node (prevents new pods from scheduling)
kubectl cordon worker-2

# 2. Delete pods on that node
kubectl delete pods --field-selector spec.nodeName=worker-2

# 3. Watch the dashboard - all traffic now goes to remaining nodes
# 4. Uncordon when done
kubectl uncordon worker-2
```

## Alternative Access Methods

### Using Any Node IP

You can access the website using ANY node's public IP:

```bash
# Get all node IPs
kubectl get nodes -o wide

# Access via any node
http://<NODE_PUBLIC_IP>:<NODEPORT>
```

### Internal Access (from within cluster)

```bash
# Using service name
curl http://ha-website-service

# API pod info
curl http://guestbook-api-service:3000/api/pod-info
```

## ✅ Verify Deployment

Check that everything is running:

```bash
# Check frontend pods (should be 3)
kubectl get pods -l app=ha-website -o wide

# Check backend pods (should be 2)
kubectl get pods -l app=guestbook-api -o wide

# Check services
kubectl get svc ha-website-service
kubectl get svc guestbook-api-service

# Check AWS resources
kubectl get pvc efs-website-pvc
kubectl get secret rds-secret
kubectl get configmap s3-config

# Test pod-info API
kubectl exec -it <backend-pod> -- curl http://localhost:3000/api/pod-info
```

## 🛠️ Troubleshooting

### Can't access from browser?
- ✓ Check security group allows the NodePort
- ✓ Verify pods are running: `kubectl get pods -l app=ha-website`
- ✓ Check service: `kubectl get svc ha-website-service`

### Dashboard shows "Unable to reach backend API"?
- ✓ Check backend pods: `kubectl get pods -l app=guestbook-api`
- ✓ Check backend logs: `kubectl logs -l app=guestbook-api`
- ✓ Check ingress: `kubectl get ingress`

### Backend can't connect to RDS?
- ✓ Verify RDS security group allows port 3306 from K8s nodes
- ✓ Check RDS endpoint in secret: `kubectl get secret rds-secret -o jsonpath='{.data.rds-endpoint}' | base64 -d`
- ✓ Check backend logs: `kubectl logs -l app=guestbook-api`

### EFS PVC stuck in Pending?
- ✓ Verify EFS CSI driver is installed: `kubectl get pods -n kube-system | grep efs`
- ✓ Check StorageClass: `kubectl get sc efs-sc`
- ✓ Verify EFS mount targets exist in node subnets
- ✓ Check EFS security group allows NFS (port 2049) from K8s nodes
