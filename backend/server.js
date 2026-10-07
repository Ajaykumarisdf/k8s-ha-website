const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── AWS S3 Configuration ───
const s3Region = process.env.S3_REGION || 'us-east-1';
const s3Bucket = process.env.S3_BUCKET_NAME || 'ha-wb-k8s-cluster-937911240064-us-east-1-an';
const s3Client = new S3Client({ region: s3Region });

// ─── AWS EFS Storage Configuration ───
// Shared POSIX path mounted via efs-website-pvc (ReadWriteMany)
const EFS_MOUNT_PATH = process.env.EFS_MOUNT_PATH || path.join(__dirname, 'efs-data');
const efsImagesDir = path.join(EFS_MOUNT_PATH, 'images');

try {
    if (!fs.existsSync(efsImagesDir)) {
        fs.mkdirSync(efsImagesDir, { recursive: true, mode: 0o775 });
    }
    console.log(`📁 EFS Images directory initialized at: ${efsImagesDir}`);
} catch (err) {
    console.warn(`⚠️ Warning initializing EFS directory: ${err.message}`);
}

// Serve EFS files directly via Express static route as well
app.use('/efs-data', express.static(EFS_MOUNT_PATH));

// ─── Multer Upload Configs ───
// S3 uploads stored in memory buffer before streaming to S3
const s3Upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// EFS uploads stored directly on EFS shared disk
const efsStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            if (!fs.existsSync(efsImagesDir)) {
                fs.mkdirSync(efsImagesDir, { recursive: true, mode: 0o775 });
            }
        } catch (e) { }
        cb(null, efsImagesDir);
    },
    filename: (req, file, cb) => {
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const uniqueName = `${Date.now()}-${cleanName}`;
        cb(null, uniqueName);
    }
});
const efsUpload = multer({
    storage: efsStorage,
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

// ─── AWS RDS MySQL Connection Config ───
const dbConfig = {
    host: process.env.DB_HOST || 'mysql-service',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'guestbook_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'guestbook',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false
};

let pool;
let requestCount = 0;
const startTime = new Date();

// Initialize database connection and create tables
async function initDB() {
    let retries = 10;
    while (retries > 0) {
        try {
            pool = mysql.createPool(dbConfig);
            const connection = await pool.getConnection();

            // 1. Guestbook Table
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

            try {
                await connection.query(`ALTER TABLE guestbook ADD COLUMN served_by_pod VARCHAR(100)`);
            } catch (e) { }
            try {
                await connection.query(`ALTER TABLE guestbook ADD COLUMN served_by_node VARCHAR(100)`);
            } catch (e) { }

            // 2. S3 Videos Metadata Table
            await connection.query(`
                CREATE TABLE IF NOT EXISTS s3_videos (
                  id INT AUTO_INCREMENT PRIMARY KEY,
                  title VARCHAR(255) NOT NULL,
                  s3_key VARCHAR(500) NOT NULL,
                  file_size BIGINT NOT NULL,
                  content_type VARCHAR(100),
                  uploaded_by_pod VARCHAR(100),
                  uploaded_by_node VARCHAR(100),
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 3. EFS Images Metadata Table
            await connection.query(`
                CREATE TABLE IF NOT EXISTS efs_images (
                  id INT AUTO_INCREMENT PRIMARY KEY,
                  title VARCHAR(255) NOT NULL,
                  filename VARCHAR(255) NOT NULL,
                  file_size BIGINT NOT NULL,
                  uploaded_by_pod VARCHAR(100),
                  uploaded_by_node VARCHAR(100),
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            connection.release();
            console.log('✅ Database connected (AWS RDS) and all tables ready');
            console.log(`   → RDS Host: ${dbConfig.host}`);
            console.log(`   → Database: ${dbConfig.database}`);
            return;
        } catch (err) {
            retries--;
            console.log(`⏳ Waiting for RDS MySQL... (${retries} retries left) - ${err.message}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    console.warn('⚠️ Running without MySQL database (file operations will use local filesystem / S3 directly)');
}

// ─── Pod Information Endpoint ───
app.get('/api/pod-info', (req, res) => {
    requestCount++;

    let efsFilesCount = 0;
    try {
        if (fs.existsSync(efsImagesDir)) {
            efsFilesCount = fs.readdirSync(efsImagesDir).length;
        }
    } catch (e) { }

    const podInfo = {
        podName: process.env.POD_NAME || os.hostname(),
        podIP: process.env.POD_IP || getLocalIP(),
        podNamespace: process.env.POD_NAMESPACE || 'default',
        nodeName: process.env.NODE_NAME || 'unknown',
        nodeIP: process.env.NODE_IP || 'unknown',
        containerName: 'guestbook-api',
        containerImage: process.env.CONTAINER_IMAGE || 'ghcr.io/ajaykumarisdf/k8s-ha-website-api:latest',
        cpuRequest: process.env.CPU_REQUEST || '100m',
        cpuLimit: process.env.CPU_LIMIT || '200m',
        memoryRequest: process.env.MEMORY_REQUEST || '64Mi',
        memoryLimit: process.env.MEMORY_LIMIT || '128Mi',
        requestCount: requestCount,
        uptime: formatUptime(process.uptime()),
        startedAt: startTime.toISOString(),
        memoryUsage: formatBytes(process.memoryUsage().rss),
        platform: `${os.platform()} ${os.arch()}`,
        nodeJsVersion: process.version,

        // Storage & Cloud Services
        dbType: 'AWS RDS MySQL',
        dbHost: maskEndpoint(process.env.DB_HOST || 'mysql-service'),
        storageType: 'AWS EFS (ReadWriteMany)',
        efsMountPath: EFS_MOUNT_PATH,
        efsImagesCount: efsFilesCount,
        assetStorage: 'AWS S3 (Object Storage)',
        s3Bucket: s3Bucket,
        s3Region: s3Region,

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
        s3Bucket: s3Bucket,
        uptime: formatUptime(process.uptime())
    });
});

// ─── AWS S3 VIDEO ENDPOINTS ───

// 1. Upload video to AWS S3
app.post('/api/upload/video', s3Upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file provided' });
        }

        const title = (req.body.title || req.file.originalname).trim();
        const cleanName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const s3Key = `videos/${Date.now()}-${cleanName}`;
        const contentType = req.file.mimetype || 'video/mp4';

        const podName = process.env.POD_NAME || os.hostname();
        const nodeName = process.env.NODE_NAME || 'unknown';

        // Upload buffer directly to AWS S3 bucket
        await s3Client.send(new PutObjectCommand({
            Bucket: s3Bucket,
            Key: s3Key,
            Body: req.file.buffer,
            ContentType: contentType,
            Metadata: {
                'uploaded-by-pod': podName,
                'uploaded-by-node': nodeName,
                'title': encodeURIComponent(title)
            }
        }));

        let insertId = null;
        if (pool) {
            try {
                const [result] = await pool.query(
                    `INSERT INTO s3_videos (title, s3_key, file_size, content_type, uploaded_by_pod, uploaded_by_node)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [title, s3Key, req.file.size, contentType, podName, nodeName]
                );
                insertId = result.insertId;
            } catch (dbErr) {
                console.warn('DB insert error (S3 video uploaded fine):', dbErr.message);
            }
        }

        res.status(201).json({
            success: true,
            message: 'Video successfully uploaded to AWS S3',
            id: insertId,
            title,
            s3_key: s3Key,
            bucket: s3Bucket,
            region: s3Region,
            file_size: req.file.size,
            formatted_size: formatBytes(req.file.size),
            content_type: contentType,
            uploaded_by_pod: podName,
            uploaded_by_node: nodeName,
            stream_url: `/api/videos/stream?key=${encodeURIComponent(s3Key)}`,
            created_at: new Date().toISOString()
        });
    } catch (err) {
        console.error('Failed to upload video to S3:', err);
        res.status(500).json({ error: 'Failed to upload video to AWS S3: ' + err.message });
    }
});

// 2. List all videos stored in AWS S3
app.get('/api/videos', async (req, res) => {
    try {
        let dbVideos = [];
        if (pool) {
            try {
                const [rows] = await pool.query(
                    'SELECT id, title, s3_key, file_size, content_type, uploaded_by_pod, uploaded_by_node, created_at FROM s3_videos ORDER BY created_at DESC'
                );
                dbVideos = rows;
            } catch (dbErr) {
                console.warn('DB query error for videos:', dbErr.message);
            }
        }

        // Also query S3 directly to discover any files uploaded outside DB
        const s3Response = await s3Client.send(new ListObjectsV2Command({
            Bucket: s3Bucket,
            Prefix: 'videos/'
        }));

        const s3Objects = (s3Response.Contents || []).filter(obj => obj.Size > 0);

        // Merge DB metadata with S3 objects
        const videoList = s3Objects.map(obj => {
            const dbMatch = dbVideos.find(v => v.s3_key === obj.Key);
            const fileName = path.basename(obj.Key);
            return {
                id: dbMatch ? dbMatch.id : null,
                title: dbMatch ? dbMatch.title : fileName,
                s3_key: obj.Key,
                file_size: obj.Size,
                formatted_size: formatBytes(obj.Size),
                content_type: dbMatch ? dbMatch.content_type : 'video/mp4',
                uploaded_by_pod: dbMatch ? dbMatch.uploaded_by_pod : 'cluster-s3',
                uploaded_by_node: dbMatch ? dbMatch.uploaded_by_node : 'aws-s3',
                stream_url: `/api/videos/stream?key=${encodeURIComponent(obj.Key)}`,
                last_modified: obj.LastModified ? obj.LastModified.toISOString() : null,
                created_at: dbMatch ? dbMatch.created_at : (obj.LastModified ? obj.LastModified.toISOString() : new Date().toISOString())
            };
        });

        res.json({
            bucket: s3Bucket,
            region: s3Region,
            count: videoList.length,
            videos: videoList
        });
    } catch (err) {
        console.error('Failed to list videos from S3:', err);
        res.status(500).json({ error: 'Failed to list videos from S3: ' + err.message });
    }
});

// 3. Stream video from AWS S3 (with HTTP Range requests support)
app.get('/api/videos/stream', async (req, res) => {
    const key = req.query.key;
    if (!key) {
        return res.status(400).json({ error: 'Missing S3 key parameter' });
    }

    try {
        const range = req.headers.range;
        const getParams = {
            Bucket: s3Bucket,
            Key: key
        };

        if (range) {
            getParams.Range = range;
        }

        const data = await s3Client.send(new GetObjectCommand(getParams));

        const contentType = data.ContentType || 'video/mp4';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=3600');

        if (data.ContentRange) {
            res.setHeader('Content-Range', data.ContentRange);
            res.status(206);
        } else {
            res.status(200);
        }

        if (data.ContentLength) {
            res.setHeader('Content-Length', data.ContentLength);
        }

        // Stream video directly from S3 to client
        data.Body.pipe(res);
    } catch (err) {
        console.error('Error streaming video from S3:', err);
        res.status(500).json({ error: 'Failed to stream video: ' + err.message });
    }
});

// 4. Delete video from AWS S3
app.delete('/api/videos', async (req, res) => {
    const key = req.query.key;
    if (!key) {
        return res.status(400).json({ error: 'Missing S3 key' });
    }

    try {
        await s3Client.send(new DeleteObjectCommand({
            Bucket: s3Bucket,
            Key: key
        }));

        if (pool) {
            await pool.query('DELETE FROM s3_videos WHERE s3_key = ?', [key]);
        }

        res.json({ success: true, message: 'Video deleted from AWS S3' });
    } catch (err) {
        console.error('Failed to delete video from S3:', err);
        res.status(500).json({ error: 'Failed to delete video: ' + err.message });
    }
});

// ─── AWS EFS IMAGE ENDPOINTS (ReadWriteMany) ───

// 1. Upload image to AWS EFS
app.post('/api/upload/image', efsUpload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const title = (req.body.title || req.file.originalname).trim();
        const podName = process.env.POD_NAME || os.hostname();
        const nodeName = process.env.NODE_NAME || 'unknown';

        let insertId = null;
        if (pool) {
            try {
                const [result] = await pool.query(
                    `INSERT INTO efs_images (title, filename, file_size, uploaded_by_pod, uploaded_by_node)
                     VALUES (?, ?, ?, ?, ?)`,
                    [title, req.file.filename, req.file.size, podName, nodeName]
                );
                insertId = result.insertId;
            } catch (dbErr) {
                console.warn('DB insert error (EFS image written to disk):', dbErr.message);
            }
        }

        // Save companion JSON metadata next to image on EFS
        try {
            const metaPath = path.join(efsImagesDir, `${req.file.filename}.json`);
            fs.writeFileSync(metaPath, JSON.stringify({
                id: insertId,
                title,
                filename: req.file.filename,
                originalName: req.file.originalname,
                file_size: req.file.size,
                uploaded_by_pod: podName,
                uploaded_by_node: nodeName,
                created_at: new Date().toISOString()
            }));
        } catch (e) { }

        res.status(201).json({
            success: true,
            message: 'Image successfully saved to AWS EFS (ReadWriteMany)',
            id: insertId,
            title,
            filename: req.file.filename,
            file_size: req.file.size,
            formatted_size: formatBytes(req.file.size),
            uploaded_by_pod: podName,
            uploaded_by_node: nodeName,
            url: `/api/efs-images/${encodeURIComponent(req.file.filename)}`,
            efs_url: `/efs-data/images/${encodeURIComponent(req.file.filename)}`,
            created_at: new Date().toISOString()
        });
    } catch (err) {
        console.error('Failed to upload image to EFS:', err);
        res.status(500).json({ error: 'Failed to upload image to EFS: ' + err.message });
    }
});

// 2. List all images stored on AWS EFS
app.get('/api/efs-images', async (req, res) => {
    try {
        let dbImages = [];
        if (pool) {
            try {
                const [rows] = await pool.query(
                    'SELECT id, title, filename, file_size, uploaded_by_pod, uploaded_by_node, created_at FROM efs_images ORDER BY created_at DESC'
                );
                dbImages = rows;
            } catch (dbErr) {
                console.warn('DB query error for EFS images:', dbErr.message);
            }
        }

        // Also scan EFS directory directly so any pod's uploaded files are seen immediately
        let files = [];
        try {
            if (fs.existsSync(efsImagesDir)) {
                files = fs.readdirSync(efsImagesDir).filter(f => !f.endsWith('.json') && !f.startsWith('.'));
            }
        } catch (e) { }

        const imageList = files.map(file => {
            const dbMatch = dbImages.find(img => img.filename === file);
            let meta = {};
            const metaPath = path.join(efsImagesDir, `${file}.json`);
            if (fs.existsSync(metaPath)) {
                try {
                    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                } catch (e) { }
            }

            let stat = { size: 0, mtime: new Date() };
            try {
                stat = fs.statSync(path.join(efsImagesDir, file));
            } catch (e) { }

            return {
                id: dbMatch ? dbMatch.id : meta.id,
                title: dbMatch ? dbMatch.title : (meta.title || file),
                filename: file,
                file_size: dbMatch ? dbMatch.file_size : (meta.file_size || stat.size),
                formatted_size: formatBytes(stat.size),
                uploaded_by_pod: dbMatch ? dbMatch.uploaded_by_pod : (meta.uploaded_by_pod || 'efs-pod'),
                uploaded_by_node: dbMatch ? dbMatch.uploaded_by_node : (meta.uploaded_by_node || 'k8s-node'),
                url: `/api/efs-images/${encodeURIComponent(file)}`,
                efs_url: `/efs-data/images/${encodeURIComponent(file)}`,
                created_at: dbMatch ? dbMatch.created_at : (meta.created_at || stat.mtime.toISOString())
            };
        });

        res.json({
            efs_path: efsImagesDir,
            count: imageList.length,
            images: imageList
        });
    } catch (err) {
        console.error('Failed to list EFS images:', err);
        res.status(500).json({ error: 'Failed to list EFS images: ' + err.message });
    }
});

// 3. Serve individual image from AWS EFS
app.get('/api/efs-images/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(efsImagesDir, filename);

    if (fs.existsSync(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'Image not found on EFS volume' });
    }
});

// 4. Delete image from AWS EFS
app.delete('/api/efs-images/:filename', async (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(efsImagesDir, filename);
    const metaPath = path.join(efsImagesDir, `${filename}.json`);

    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);

        if (pool) {
            await pool.query('DELETE FROM efs_images WHERE filename = ?', [filename]);
        }

        res.json({ success: true, message: 'Image deleted from AWS EFS' });
    } catch (err) {
        console.error('Failed to delete image from EFS:', err);
        res.status(500).json({ error: 'Failed to delete image from EFS: ' + err.message });
    }
});

// ─── GUESTBOOK ENDPOINTS ───

app.get('/api/guestbook', async (req, res) => {
    try {
        if (!pool) return res.json([]);
        const [rows] = await pool.query(
            'SELECT id, name, message, served_by_pod, served_by_node, created_at FROM guestbook ORDER BY created_at DESC LIMIT 50'
        );
        res.json(rows);
    } catch (err) {
        console.error('Error fetching entries:', err);
        res.status(500).json({ error: 'Failed to fetch entries' });
    }
});

app.post('/api/guestbook', async (req, res) => {
    const { name, message } = req.body;
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
        if (!pool) throw new Error('Database connection not established');
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

app.delete('/api/guestbook/:id', async (req, res) => {
    try {
        if (!pool) throw new Error('Database connection not established');
        await pool.query('DELETE FROM guestbook WHERE id = ?', [req.params.id]);
        res.json({ message: 'Entry deleted' });
    } catch (err) {
        console.error('Error deleting entry:', err);
        res.status(500).json({ error: 'Failed to delete entry' });
    }
});

// ─── HELPER FUNCTIONS ───

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
    if (!bytes || isNaN(bytes)) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    const mb = (bytes / 1024 / 1024).toFixed(2);
    return `${mb} MB`;
}

function maskEndpoint(endpoint) {
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
        console.log(`   S3: Bucket ${s3Bucket} in ${s3Region}`);
        console.log(`   EFS: Mounted at ${EFS_MOUNT_PATH}`);
    });
});
