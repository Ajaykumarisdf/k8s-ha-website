# Website Access Instructions

## 🌐 Access Your Website

Your high-availability website is now running! Here's how to access it:

### Step 1: Get Your Public IP

Run this command to find your EC2 public IP:
```bash
curl ifconfig.me
```

### Step 2: Configure Security Group

**IMPORTANT**: You must allow inbound traffic on port **30475** in your EC2 security group.

1. Go to AWS Console → EC2 → Security Groups
2. Find your instance's security group
3. Add inbound rule:
   - **Type**: Custom TCP
   - **Port**: 30475
   - **Source**: 0.0.0.0/0 (or your specific IP for security)

### Step 3: Access the Website

Open your browser and visit:
```
http://<YOUR_PUBLIC_IP>:30475
```

Replace `<YOUR_PUBLIC_IP>` with the IP from Step 1.

## Alternative Access Methods

### Using Any Node IP

You can access the website using ANY node's public IP (master or worker nodes):

```bash
# Get all node IPs
kubectl get nodes -o wide

# Access via any node
http://<NODE_PUBLIC_IP>:30475
```

### Internal Access (from within cluster)

```bash
# Using service name
curl http://ha-website-service

# Using cluster IP
curl http://10.43.215.19
```

## Verify Deployment

Check that everything is running:

```bash
# Check pods
kubectl get pods -l app=ha-website -o wide

# Check service
kubectl get svc ha-website-service

# Test from command line
curl http://localhost:30475
```

## High Availability Demo

Test the HA by deleting a pod:

```bash
# Delete one pod
kubectl delete pod <pod-name>

# Watch it automatically recreate
kubectl get pods -w -l app=ha-website

# Website remains accessible throughout!
```

## Troubleshooting

### Can't access from browser?
- ✓ Check security group allows port 30475
- ✓ Verify pods are running: `kubectl get pods -l app=ha-website`
- ✓ Check service: `kubectl get svc ha-website-service`

### Pods not running?
- ✓ Check NFS mount: `kubectl describe pod <pod-name>`
- ✓ Verify NFS exports: `sudo exportfs -v`
