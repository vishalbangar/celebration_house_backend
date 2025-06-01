const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 3, // Reduced for stability
    queueLimit: 0,
    connectTimeout: 20000, // Increased to 20s
    idleTimeout: 60000
});

// Test connection
pool.getConnection()
    .then(conn => {
        console.log('MySQL connected');
        conn.release();
    })
    .catch(err => console.error('MySQL connection error:', err));

// Handle pool errors
pool.on('error', err => {
    console.error('Pool error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('Reconnecting...');
    }
});

// Query with retry
async function queryWithRetry(sql, params, retries = 3) {
    while (retries > 0) {
        try {
            const [rows] = await pool.query(sql, params);
            return rows;
        } catch (err) {
            console.error('Query error:', err);
            if (err.message.includes('closed state') && retries > 1) {
                retries--;
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
            throw err;
        }
    }
}

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1'); // Quick DB ping
        console.log('Health check OK');
        res.status(200).json({ status: 'OK', uptime: process.uptime() });
    } catch (err) {
        console.error('Health check failed:', err);
        res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// API to create a booking
app.post('/api/bookings', async (req, res) => {
    const { uniqueId, customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount } = req.body;
    const query = `
        INSERT INTO bookings (uniqueId, customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    try {
        await queryWithRetry(query, [uniqueId, customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount]);
        console.log('Booking created:', uniqueId);
        res.status(201).json({ message: 'Booking created successfully', bookingId: uniqueId });
    } catch (err) {
        console.error('Error creating booking:', err);
        res.status(500).json({ error: 'Error creating booking' });
    }
});

// API to get all bookings
app.get('/api/bookings', async (req, res) => {
    const query = `
        SELECT id, uniqueId, customerName, contactNumber, 
               DATE_FORMAT(eventDate, '%d-%m-%Y') as eventDate, 
               DATE_FORMAT(eventTime, '%h:%i %p') as eventTime, 
               branch, selectedPackage, amount 
        FROM bookings
    `;
    try {
        const results = await queryWithRetry(query);
        console.log('Bookings fetched:', results.length);
        res.json(results);
    } catch (err) {
        console.error('Error fetching bookings:', err);
        res.status(500).json({ error: 'Error fetching bookings' });
    }
});

// API to delete a booking
app.delete('/api/bookings/:id', async (req, res) => {
    const { id } = req.params;
    const query = 'DELETE FROM bookings WHERE id = ?';
    try {
        const result = await queryWithRetry(query, [id]);
        console.log('Booking deleted:', id);
        res.json({ message: 'Booking deleted successfully' });
    } catch (err) {
        console.error('Error deleting booking:', err);
        res.status(500).json({ error: 'Error deleting booking' });
    }
});

// API to get bookings by date, month, year, branch
app.get('/api/bookings/filter', async (req, res) => {
    const { date, month, year, branch } = req.query;
    let query = `
        SELECT id, uniqueId, customerName, contactNumber, 
               DATE_FORMAT(eventDate, '%d-%m-%Y') as eventDate, 
               DATE_FORMAT(eventTime, '%h:%i %p') as eventTime, 
               branch, selectedPackage, amount 
        FROM bookings WHERE 1=1
    `;
    const params = [];

    if (date) {
        query += ' AND eventDate = DATE_FORMAT(?, "%Y-%m-%d")';
        params.push(date);
    } else if (month && year) {
        query += ' AND MONTH(eventDate) = ? AND YEAR(eventDate) = ?';
        params.push(month, year);
    }
    if (branch) {
        query += ' AND branch = ?';
        params.push(branch);
    }

    try {
        const results = await queryWithRetry(query, params);
        console.log('Filtered bookings fetched:', results.length);
        res.json(results);
    } catch (err) {
        console.error('Error fetching filtered bookings:', err);
        res.status(500).json({ error: 'Error fetching filtered bookings' });
    }
});

// API to get notifications
app.get('/api/notifications', async (req, res) => {
    const isAdmin = req.query.admin === 'true';
    if (!isAdmin) {
        return res.status(403).json({ error: 'Access denied. Admin only.' });
    }

    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const formatDateForMySQL = (date) => date.toISOString().split('T')[0];
    const tomorrowDate = formatDateForMySQL(tomorrow);

    const formatDateForResponse = (date) => {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    };
    const tomorrowFormatted = formatDateForResponse(tomorrow);

    const query = `
        SELECT id, uniqueId, customerName, contactNumber, 
               DATE_FORMAT(eventDate, '%d-%m-%Y') as eventDate, 
               DATE_FORMAT(eventTime, '%h:%i %p') as eventTime, 
               branch, selectedPackage, amount 
        FROM bookings 
        WHERE eventDate = ?
        ORDER BY eventTime ASC
    `;
    try {
        const results = await queryWithRetry(query, [tomorrowDate]);
        console.log('Notifications fetched:', results.length);
        res.json({
            message: `Bookings for tomorrow (${tomorrowFormatted})`,
            bookings: results
        });
    } catch (err) {
        console.error('Error fetching notifications:', err);
        res.status(500).json({ error: 'Error fetching notifications' });
    }
});

// Keep connections alive
setInterval(async () => {
    try {
        await pool.query('SELECT 1');
        console.log('Pinged MySQL');
    } catch (err) {
        console.error('Ping error:', err);
    }
}, 300000);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down...');
    server.close(() => {
        pool.end(err => {
            if (err) console.error('Error closing pool:', err);
            else console.log('MySQL pool closed');
            process.exit(0);
        });
    });
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
