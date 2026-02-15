const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// MySQL connection config from environment variables
const dbConfig = {
    host: process.env.DB_HOST || 'mysql-service',
    user: process.env.DB_USER || 'guestbook_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'guestbook',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool;

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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

            connection.release();
            console.log('✅ Database connected and table ready');
            return;
        } catch (err) {
            retries--;
            console.log(`⏳ Waiting for MySQL... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    console.error('❌ Failed to connect to MySQL after retries');
    process.exit(1);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'guestbook-api' });
});

// Get all guestbook entries
app.get('/api/guestbook', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, name, message, created_at FROM guestbook ORDER BY created_at DESC LIMIT 50'
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

    try {
        const [result] = await pool.query(
            'INSERT INTO guestbook (name, message) VALUES (?, ?)',
            [name, message]
        );
        res.status(201).json({
            id: result.insertId,
            name,
            message,
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

const PORT = process.env.PORT || 3000;

initDB().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Guestbook API running on port ${PORT}`);
    });
});
