const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json());

// AWS RDS MySQL connection config from environment variables
const dbConfig = {
    host: process.env.DB_HOST || 'mysql-service',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'guestbook_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'guestbook',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // RDS recommended settings
    connectTimeout: 10000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false
};

let pool;

// Track request counts per pod for demonstrating load balancing
let requestCount = 0;
const startTime = new Date();

// Initialize database connection and create table
async function initDB() {
    let retries = 10;
    while (retries > 0) {
        try {
            pool = mysql.createPool(dbConfig);
            const connection = await pool.getConnection();

            // Create guestbook table if not exists
            await connection.query(`
        CREATE TABLE IF NOT EXISTS guestbook (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          message TEXT NOT NULL,
          served_by_pod VARCHAR(100),
          served_by_node VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

            // Add columns if they don't exist (for backward compatibility)
            try {
                await connection.query(`ALTER TABLE guestbook ADD COLUMN served_by_pod VARCHAR(100)`);
            } catch (e) { /* column already exists */ }
            try {
                await connection.query(`ALTER TABLE guestbook ADD COLUMN served_by_node VARCHAR(100)`);
            } catch (e) { /* column already exists */ }

            connection.release();
            console.log('✅ Database connected (AWS RDS) and table ready');
            console.log(`   → RDS Host: ${dbConfig.host}`);
            console.log(`   → Database: ${dbConfig.database}`);
            return;
        } catch (err) {
            retries--;
            console.log(`⏳ Waiting for RDS MySQL... (${retries} retries left) - ${err.message}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    console.error('❌ Failed to connect to RDS MySQL after retries');
    process.exit(1);
}

// ─── Pod Information Endpoint ───
// Returns Kubernetes pod metadata for HA visualization
app.get('/api/pod-info', (req, res) => {
    requestCount++;

    const podInfo = {
        // Pod details (from Downward API env vars)
        podName: process.env.POD_NAME || os.hostname(),
        podIP: process.env.POD_IP || getLocalIP(),
        podNamespace: process.env.POD_NAMESPACE || 'default',

        // Node details (from Downward API env vars)
        nodeName: process.env.NODE_NAME || 'unknown',
        nodeIP: process.env.NODE_IP || 'unknown',

        // Container details
        containerName: 'guestbook-api',
        containerImage: process.env.CONTAINER_IMAGE || 'ghcr.io/ajaykumarisdf/k8s-ha-website-api:latest',

        // Resource info
        cpuRequest: process.env.CPU_REQUEST || '100m',
        cpuLimit: process.env.CPU_LIMIT || '200m',
        memoryRequest: process.env.MEMORY_REQUEST || '64Mi',
        memoryLimit: process.env.MEMORY_LIMIT || '128Mi',

        // Runtime stats
        requestCount: requestCount,
        uptime: formatUptime(process.uptime()),
        startedAt: startTime.toISOString(),
        memoryUsage: formatBytes(process.memoryUsage().rss),
        platform: `${os.platform()} ${os.arch()}`,
        nodeJsVersion: process.version,

        // AWS Service info
        dbType: 'AWS RDS MySQL',
        dbHost: maskEndpoint(process.env.DB_HOST || 'mysql-service'),
        storageType: 'AWS EFS',
        assetStorage: 'AWS S3',
        s3Bucket: process.env.S3_BUCKET_NAME || 'k8s-ha-website-assets',

        // Timestamp
        timestamp: new Date().toISOString()
    };

    res.json(podInfo);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'guestbook-api',
        pod: process.env.POD_NAME || os.hostname(),
        node: process.env.NODE_NAME || 'unknown',
        dbType: 'AWS RDS MySQL',
        uptime: formatUptime(process.uptime())
    });
});

// Get all guestbook entries
app.get('/api/guestbook', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, name, message, served_by_pod, served_by_node, created_at FROM guestbook ORDER BY created_at DESC LIMIT 50'
        );
        res.json(rows);
    } catch (err) {
        console.error('Error fetching entries:', err);
        res.status(500).json({ error: 'Failed to fetch entries' });
    }
});

// Add a new guestbook entry
app.post('/api/guestbook', async (req, res) => {
    const { name, message } = req.body;

    // Input validation
    if (!name || !message) {
        return res.status(400).json({ error: 'Name and message are required' });
    }
    if (name.length > 100) {
        return res.status(400).json({ error: 'Name must be under 100 characters' });
    }
    if (message.length > 1000) {
        return res.status(400).json({ error: 'Message must be under 1000 characters' });
    }

    const podName = process.env.POD_NAME || os.hostname();
    const nodeName = process.env.NODE_NAME || 'unknown';

    try {
        const [result] = await pool.query(
            'INSERT INTO guestbook (name, message, served_by_pod, served_by_node) VALUES (?, ?, ?, ?)',
            [name, message, podName, nodeName]
        );
        res.status(201).json({
            id: result.insertId,
            name,
            message,
            served_by_pod: podName,
            served_by_node: nodeName,
            created_at: new Date().toISOString()
        });
    } catch (err) {
        console.error('Error adding entry:', err);
        res.status(500).json({ error: 'Failed to add entry' });
    }
});

// Delete a guestbook entry
app.delete('/api/guestbook/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM guestbook WHERE id = ?', [req.params.id]);
        res.json({ message: 'Entry deleted' });
    } catch (err) {
        console.error('Error deleting entry:', err);
        res.status(500).json({ error: 'Failed to delete entry' });
    }
});

// ─── Helper Functions ───

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    return `${mins}m ${secs}s`;
}

function formatBytes(bytes) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    return `${mb} MB`;
}

function maskEndpoint(endpoint) {
    // Partially mask the RDS endpoint for security in UI display
    if (endpoint.includes('.rds.amazonaws.com')) {
        const parts = endpoint.split('.');
        return `${parts[0].substring(0, 6)}***.rds.amazonaws.com`;
    }
    return endpoint;
}

const PORT = process.env.PORT || 3000;

initDB().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Guestbook API running on port ${PORT}`);
        console.log(`   Pod: ${process.env.POD_NAME || os.hostname()}`);
        console.log(`   Node: ${process.env.NODE_NAME || 'unknown'}`);
        console.log(`   DB: AWS RDS MySQL @ ${dbConfig.host}`);
    });
});
