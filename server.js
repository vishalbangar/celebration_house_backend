const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Allow all origins for debugging
app.use(cors({ origin: '*' }));
app.use(express.json());

// MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 4,
    queueLimit: 0,
    connectTimeout: 20000,
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

// Test route to confirm deployment
app.get('/api/test', (req, res) => {
    console.log('Test route accessed');
    res.status(200).json({ message: 'Server is running', timestamp: new Date().toISOString() });
});

// Health check endpoint
app.get('/health', (req, res) => {
    console.log('Health check requested');
    res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// Root route
app.get('/', (req, res) => {
    console.log('Root route accessed');
    res.status(200).json({ message: 'Celebration House API' });
});

// API to create a booking
app.post('/api/bookings', async (req, res) => {
    console.log('POST /api/bookings called with body:', req.body);
    const { uniqueId, customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount } = req.body;
    if (!uniqueId || !customerName || !contactNumber || !eventDate || !eventTime || !branch || !selectedPackage || !amount) {
        console.error('Missing required fields:', req.body);
        return res.status(400).json({ error: 'All fields are required' });
    }
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
        res.status(500).json({ error: 'Error creating booking: ' + err.message });
    }
});

// API to get all bookings
app.get('/api/bookings', async (req, res) => {
    console.log('GET /api/bookings called');
    const query = `
        SELECT id, uniqueId, customerName, contactNumber, 
               DATE_FORMAT(eventDate, '%d-%m-%Y') as eventDate, 
               DATE_FORMAT(eventTime, '%h:%i %p') as eventTime, 
               branch, selectedPackage, amount 
        FROM bookings
    `;
    try {
        const bookings = await queryWithRetry(query);
        console.log('Bookings fetched:', bookings.length);
        res.json(bookings);
    } catch (err) {
        console.error('Error fetching bookings:', err);
        res.status(500).json({ error: 'Error fetching bookings: ' + err.message });
    }
});

// API to get a single booking
app.get('/api/bookings/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`GET /api/bookings/${id} called`);
    const query = `
        SELECT id, uniqueId, customerName, contactNumber, 
               DATE_FORMAT(eventDate, '%d-%m-%Y') as eventDate, 
               DATE_FORMAT(eventTime, '%h:%i %p') as eventTime, 
               branch, selectedPackage, amount 
        FROM bookings 
        WHERE id = ?
    `;
    try {
        const results = await queryWithRetry(query, [id]);
        if (results.length === 0) {
            console.error('Booking not found:', id);
            return res.status(404).json({ error: 'Booking not found' });
        }
        console.log('Booking fetched:', id);
        res.json(results[0]);
    } catch (err) {
        console.error('Error fetching booking:', err);
        res.status(500).json({ error: 'Error fetching booking: ' + err.message });
    }
});

// API to update a booking
app.put('/api/bookings/:id', async (req, res) => {
    const { id } = req.params;
    const { customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount } = req.body;
    console.log(`PUT /api/bookings/${id} called with body:`, req.body);

    // Validate required fields
    if (!customerName || !contactNumber || !eventDate || !eventTime || !branch || !selectedPackage || !amount) {
        console.error('Missing required fields:', req.body);
        return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate contact number
    if (!/^[0-9]{10}$/.test(contactNumber)) {
        console.error('Invalid contact number:', contactNumber);
        return res.status(400).json({ error: 'Invalid contact number. Must be 10 digits.' });
    }

    // Validate eventDate format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
        console.error('Invalid event date format:', eventDate);
        return res.status(400).json({ error: 'Invalid event date format. Use YYYY-MM-DD.' });
    }

    // Validate eventTime format
    if (!/^\d{2}:\d{2}$/.test(eventTime)) {
        console.error('Invalid event time format:', eventTime);
        return res.status(400).json({ error: 'Invalid event time format. Use HH:MM.' });
    }

    const query = `
        UPDATE bookings 
        SET customerName = ?, contactNumber = ?, eventDate = ?, eventTime = ?, 
            branch = ?, selectedPackage = ?, amount = ?
        WHERE id = ?
    `;
    try {
        const result = await queryWithRetry(query, [
            customerName,
            contactNumber,
            eventDate,
            eventTime,
            branch,
            selectedPackage,
            amount,
            id
        ]);
        if (result.affectedRows === 0) {
            console.error('Booking not found:', id);
            return res.status(404).json({ error: 'Booking not found' });
        }
        console.log('Booking updated:', id);
        res.json({ message: 'Booking updated successfully' });
    } catch (err) {
        console.error('Error updating booking:', err);
        res.status(500).json({ error: 'Error updating booking: ' + err.message });
    }
});

// API to delete a booking
app.delete('/api/bookings/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`DELETE /api/bookings/${id} called`);
    const query = 'DELETE FROM bookings WHERE id = ?';
    try {
        const result = await queryWithRetry(query, [id]);
        if (result.affectedRows === 0) {
            console.error('Booking not found for deletion:', id);
            return res.status(404).json({ error: 'Booking not found' });
        }
        console.log('Booking deleted:', id);
        res.json({ message: 'Booking deleted successfully' });
    } catch (err) {
        console.error('Error deleting booking:', err);
        res.status(500).json({ error: 'Error deleting booking: ' + err.message });
    }
});

// API to get bookings by date, month, year, or branch
app.get('/api/bookings/filter', async (req, res) => {
    console.log('GET /api/bookings/filter called with query:', req.query);
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
        query += ' AND eventDate = ?';
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
        res.status(500).json({ error: 'Error fetching filtered bookings: ' + err.message });
    }
});

// API to get notifications
app.get('/api/notifications', async (req, res) => {
    console.log('GET /api/notifications called with query:', req.query);
    const isAdmin = req.query.admin === 'true';
    if (!isAdmin) {
        console.error('ERROR: Unauthorized access to notifications');
        return res.status(400).json({ error: 'Access denied. Admin only' });
    }

    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return date.toISOString().split('T')[0];
    };

    const tomorrowDate = formatDate(tomorrow);

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
        ORDER BY id ASC
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
        res.status(500).json({ error: 'Error fetching notifications: ' + err.message });
    }
});

// Catch-all route to return JSON for all errors
app.use((req, res) => {
    console.error(`Invalid route accessed: ${req.method} ${req.url}`);
    res.status(404).json({ error: `Cannot ${req.method} ${req.url}` });
});

// Keep connections alive
setInterval(async () => {
    try {
        await pool.query('SELECT 1');
        console.log('Pool pinged');
    } catch (err) {
        console.error('Pool error:', err);
    }
}, 300000);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down...');
    server.close();
    () => {
        pool.end(err => {
            if (err) console.error('Pool close error:', err);
            console.log('Pool closed');
            process.exit(0);
        });
    }
    setTimeout(() => {
        console.error('Force shutdown');
        process.exit(1);
    }, 10000);
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
