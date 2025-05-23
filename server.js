const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config(); // Load .env variables

const app = express();
app.use(cors());
app.use(express.json());

// ✅ MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
}).promise(); // for async/await

// ✅ Health check route for UptimeRobot
app.get('/ping', (req, res) => {
    res.send('pong');
});

// ✅ Create booking
app.post('/api/bookings', async (req, res) => {
    try {
        const { uniqueId, customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount } = req.body;
        const query = `
            INSERT INTO bookings (uniqueId, customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await pool.query(query, [uniqueId, customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount]);
        res.status(201).json({ message: 'Booking created successfully', bookingId: uniqueId });
    } catch (err) {
        console.error('Error creating booking:', err);
        res.status(500).json({ error: 'Error creating booking' });
    }
});

// ✅ Get all bookings
app.get('/api/bookings', async (req, res) => {
    try {
        const [results] = await pool.query(`
            SELECT id, uniqueId, customerName, contactNumber, 
                   DATE_FORMAT(eventDate, '%d-%m-%Y') as eventDate, 
                   DATE_FORMAT(eventTime, '%h:%i %p') as eventTime, 
                   branch, selectedPackage, amount 
            FROM bookings
        `);
        res.json(results);
    } catch (err) {
        console.error('Error fetching bookings:', err);
        res.status(500).json({ error: 'Error fetching bookings' });
    }
});

// ✅ Delete booking
app.delete('/api/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM bookings WHERE id = ?', [id]);
        res.json({ message: 'Booking deleted successfully' });
    } catch (err) {
        console.error('Error deleting booking:', err);
        res.status(500).json({ error: 'Error deleting booking' });
    }
});

// ✅ Filter bookings by date/branch
app.get('/api/bookings/filter', async (req, res) => {
    try {
        const { date, branch } = req.query;
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
        }
        if (branch) {
            query += ' AND branch = ?';
            params.push(branch);
        }

        const [results] = await pool.query(query, params);
        res.json(results);
    } catch (err) {
        console.error('Error fetching filtered bookings:', err);
        res.status(500).json({ error: 'Error fetching filtered bookings' });
    }
});

// ✅ Admin notification (next day bookings)
app.get('/api/notifications', async (req, res) => {
    try {
        const isAdmin = req.query.admin === 'true';
        if (!isAdmin) return res.status(403).json({ error: 'Access denied. Admin only.' });

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

        const [results] = await pool.query(`
            SELECT id, uniqueId, customerName, contactNumber, 
                   DATE_FORMAT(eventDate, '%d-%m-%Y') as eventDate, 
                   DATE_FORMAT(eventTime, '%h:%i %p') as eventTime, 
                   branch, selectedPackage, amount 
            FROM bookings 
            WHERE eventDate = ?
            ORDER BY eventTime ASC
        `, [tomorrowDate]);

        res.json({
            message: `Bookings for tomorrow (${tomorrowFormatted})`,
            bookings: results
        });
    } catch (err) {
        console.error('Error fetching notifications:', err);
        res.status(500).json({ error: 'Error fetching notifications' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
