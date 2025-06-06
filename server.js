const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// MySQL Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
    connectTimeout: 20000,
    idleTimeout: 60000
});

// Test connection
pool.getConnection()
    .then(conn => {
        console.log('MySQL connected successfully');
        conn.release();
    })
    .catch(err => console.error('MySQL connection error:', err));

// Query with retry
async function queryWithRetry(sql, params, retries = 3) {
    while (retries > 0) {
        try {
            const result = await pool.query(sql, params);
            return Array.isArray(result[0]) ? result[0] : result[0];
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
    return sql.toLowerCase().includes('select') ? [] : { affectedRows: 0 };
}

// Health check route
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server is healthy' });
});

// Test route
app.get('/api/test', (req, res) => {
    console.log('Test route accessed');
    res.status(200).json({ message: 'Server running', timestamp: new Date().toISOString() });
});

// Filter bookings
app.get('/api/bookings/filter', async (req, res) => {
    console.log('GET /api/bookings/filter with query:', req.query);
    const { date, month, year, branch } = req.query;

    let query = `
        SELECT id, uniqueId, customerName, contactNumber, 
               DATE_FORMAT(eventDate, '%d-%m-%Y') AS eventDate, 
               TIME_FORMAT(eventTime, '%H:%i') AS eventTime, 
               branch, selectedPackage, amount, celebrationType 
        FROM bookings 
        WHERE 1=1
    `;
    const params = [];

    if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            console.error('Invalid date format:', date);
            return res.status(400).json({ error: 'Invalid date format: Use YYYY-MM-DD' });
        }
        query += ' AND eventDate = ?';
        params.push(date);
    } else if (month && year) {
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12 || isNaN(yearNum) || yearNum < 1000) {
            console.error('Invalid month/year:', { month, year });
            return res.status(400).json({ error: 'Invalid month or year' });
        }
        query += ' AND MONTH(eventDate) = ? AND YEAR(eventDate) = ?';
        params.push(monthNum, yearNum);
    }
    if (branch && branch !== 'All') {
        query += ' AND branch = ?';
        params.push(branch);
    }

    console.log('Executing filter query:', query, 'Params:', params);

    try {
        const results = await queryWithRetry(query, params);
        console.log('Filtered bookings fetched:', results.length);
        if (results.length === 0) {
            console.log('No bookings found for filter:', req.query);
            return res.status(404).json({ error: 'No bookings found for the selected filters' });
        }
        res.status(200).json(results);
    } catch (err) {
        console.error('Error fetching filtered bookings:', err);
        res.status(500).json({ error: 'Error fetching filtered bookings: ' + err.message });
    }
});

// Get all bookings
app.get('/api/bookings', async (req, res) => {
    console.log('GET /api/bookings');
    const query = `
        SELECT id, uniqueId, customerName, contactNumber, 
               DATE_FORMAT(eventDate, '%d-%m-%Y') AS eventDate, 
               TIME_FORMAT(eventTime, '%H:%i') AS eventTime, 
               branch, selectedPackage, amount, celebrationType 
        FROM bookings
    `;
    try {
        const bookings = await queryWithRetry(query);
        console.log('Bookings fetched:', bookings.length);
        res.status(200).json(bookings);
    } catch (err) {
        console.error('Error fetching bookings:', err);
        res.status(500).json({ error: 'Error fetching bookings: ' + err.message });
    }
});

// Get single booking
app.get('/api/bookings/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`GET /api/bookings/${id}`);
    const query = `
        SELECT id, uniqueId, customerName, contactNumber, 
               DATE_FORMAT(eventDate, '%d-%m-%Y') AS eventDate, 
               TIME_FORMAT(eventTime, '%H:%i') AS eventTime, 
               branch, selectedPackage, amount, celebrationType 
        FROM bookings 
        WHERE id = ?
    `;
    try {
        const results = await queryWithRetry(query, [id]);
        if (!results || results.length === 0) {
            console.error('Booking not found:', id);
            return res.status(404).json({ error: 'Booking not found' });
        }
        console.log('Booking fetched:', id);
        res.status(200).json(results[0]);
    } catch (err) {
        console.error('Error fetching booking:', err);
        res.status(500).json({ error: 'Error fetching booking: ' + err.message });
    }
});

// Create booking
app.post('/api/bookings', async (req, res) => {
    console.log('POST /api/bookings:', req.body);
    const { customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount, celebrationType } = req.body;
    if (!customerName || !contactNumber || !eventDate || !eventTime || !branch || !selectedPackage || !amount || !celebrationType) {
        console.error('Missing fields:', req.body);
        return res.status(400).json({ error: 'All fields required' });
    }
    const query = `
        INSERT INTO bookings (customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount, celebrationType)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    try {
        const result = await queryWithRetry(query, [customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount, celebrationType]);
        const bookingId = String(result.insertId).padStart(5, '0');
        await queryWithRetry('UPDATE bookings SET uniqueId = ? WHERE id = ?', [bookingId, result.insertId]);
        console.log('Booking created:', bookingId);
        res.status(201).json({ message: 'Booking created', bookingId });
    } catch (err) {
        console.error('Error creating booking:', err);
        res.status(500).json({ error: 'Error creating booking: ' + err.message });
    }
});

// Update booking
app.put('/api/bookings/:id', async (req, res) => {
    const { id } = req.params;
    const { customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount, celebrationType } = req.body;
    console.log(`PUT /api/bookings/${id}:`, req.body);

    if (!customerName || !contactNumber || !eventDate || !eventTime || !branch || !selectedPackage || !amount || !celebrationType) {
        console.error('Missing fields:', req.body);
        return res.status(400).json({ error: 'All fields required' });
    }

    if (!/^[0-9]{10}$/.test(contactNumber)) {
        console.error('Invalid contact number:', contactNumber);
        return res.status(400).json({ error: 'Invalid contact number: Must be 10 digits' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
        console.error('Invalid date format:', eventDate);
        return res.status(400).json({ error: 'Invalid date format: Use YYYY-MM-DD' });
    }

    let normalizedTime = eventTime;
    if (/^\d{2}:\d{2}:\d{2}$/.test(eventTime)) {
        normalizedTime = eventTime.slice(0, 5);
    } else if (!/^\d{2}:\d{2}$/.test(eventTime)) {
        console.error('Invalid time format:', eventTime);
        return res.status(400).json({ error: 'Invalid time format: Use HH:MM or HH:MM:SS' });
    }

    const query = `
        UPDATE bookings 
        SET customerName = ?, contactNumber = ?, eventDate = ?, eventTime = ?, 
            branch = ?, selectedPackage = ?, amount = ?, celebrationType = ?
        WHERE id = ?
    `;
    try {
        const result = await queryWithRetry(query, [
            customerName, contactNumber, eventDate, normalizedTime, branch, selectedPackage, amount, celebrationType, id
        ]);
        if (!result || result.affectedRows === 0) {
            console.error('Booking not found:', id);
            return res.status(404).json({ error: 'Booking not found' });
        }
        console.log('Booking updated:', id);
        res.status(200).json({ message: 'Booking updated' });
    } catch (err) {
        console.error('Error updating booking:', err);
        res.status(500).json({ error: 'Error updating booking: ' + err.message });
    }
});

// Delete booking
app.delete('/api/bookings/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`DELETE /api/bookings/${id}`);
    const query = 'DELETE FROM bookings WHERE id = ?';
    try {
        const result = await queryWithRetry(query, [id]);
        if (!result || result.affectedRows === 0) {
            console.error('Booking not found:', id);
            return res.status(404).json({ error: 'Booking not found' });
        }
        console.log('Booking deleted:', id);
        res.status(200).json({ message: 'Booking deleted' });
    } catch (err) {
        console.error('Error deleting booking:', err);
        res.status(500).json({ error: 'Error deleting booking: ' + err.message });
    }
});

// Notifications
app.get('/api/notifications', async (req, res) => {
    console.log('GET /api/notifications:', req.query);
    const isAdmin = req.query.admin === 'true';
    if (!isAdmin) {
        console.error('Unauthorized access');
        return res.status(403).json({ error: 'Access denied: Admin only' });
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().split('T')[0];

    const formatDateForResponse = (date) => {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    };
    const tomorrowFormatted = formatDateForResponse(tomorrow);

    const query = `
        SELECT id, uniqueId, customerName, contactNumber, 
               DATE_FORMAT(eventDate, '%d-%m-%Y') AS eventDate, 
               TIME_FORMAT(eventTime, '%H:%i') AS eventTime, 
               branch, selectedPackage, amount, celebrationType 
        FROM bookings 
        WHERE eventDate = ?
        ORDER BY eventTime ASC
    `;
    try {
        const results = await queryWithRetry(query, [tomorrowDate]);
        console.log('Notifications fetched:', results.length);
        res.status(200).json({
            message: `Bookings for tomorrow (${tomorrowFormatted})`,
            bookings: results
        });
    } catch (err) {
        console.error('Error fetching notifications:', err);
        res.status(500).json({ error: 'Error fetching notifications: ' + err.message });
    }
});

// Health check route
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server is healthy' });
});

// Catch-all for invalid routes
app.use((req, res) => {
    console.error(`Invalid route accessed: ${req.method} ${req.url}`);
    res.status(404).json({ error: `Route not found: ${req.method} ${req.url}` });
});

// Keep connections alive
setInterval(async () => {
    try {
        await pool.query('SELECT 1');
        console.log('Pool pinged');
    } catch (err) {
        console.error('Ping error:', err);
    }
}, 300000);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
