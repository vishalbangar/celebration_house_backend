const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// MySQL Connection
const db = mysql.createConnection({
    host: 'mysql.hostinger.in',
    user: 'root',
    password: 'Matoshree1@',
    database: 'celeb_house'
});

db.connect(err => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
});

// API to create a booking
app.post('/api/bookings', (req, res) => {
    const { uniqueId, customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount } = req.body;
    const query = `
        INSERT INTO bookings (uniqueId, customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.query(query, [uniqueId, customerName, contactNumber, eventDate, eventTime, branch, selectedPackage, amount], (err, result) => {
        if (err) {
            console.error('Error creating booking:', err);
            res.status(500).json({ error: 'Error creating booking' });
            return;
        }
        res.status(201).json({ message: 'Booking created successfully', bookingId: uniqueId });
    });
});

// API to get all bookings (for Profile Page)
app.get('/api/bookings', (req, res) => {
    const query = `
        SELECT id, uniqueId, customerName, contactNumber, 
               DATE_FORMAT(eventDate, '%d-%m-%Y') as eventDate, 
               DATE_FORMAT(eventTime, '%h:%i %p') as eventTime, 
               branch, selectedPackage, amount 
        FROM bookings
    `;
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching bookings:', err);
            res.status(500).json({ error: 'Error fetching bookings' });
            return;
        }
        res.json(results);
    });
});

// API to delete a booking
app.delete('/api/bookings/:id', (req, res) => {
    const { id } = req.params;
    const query = 'DELETE FROM bookings WHERE id = ?';
    db.query(query, [id], (err, result) => {
        if (err) {
            console.error('Error deleting booking:', err);
            res.status(500).json({ error: 'Error deleting booking' });
            return;
        }
        res.json({ message: 'Booking deleted successfully' });
    });
});

// API to get bookings by date and branch (for Sales Page)
app.get('/api/bookings/filter', (req, res) => {
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

    db.query(query, params, (err, results) => {
        if (err) {
            console.error('Error fetching filtered bookings:', err);
            res.status(500).json({ error: 'Error fetching filtered bookings' });
            return;
        }
        res.json(results);
    });
});

// API to get notifications for admin (next day bookings)
app.get('/api/notifications', (req, res) => {
    // Simple admin check using query parameter (e.g., ?admin=true)
    const isAdmin = req.query.admin === 'true';

    if (!isAdmin) {
        return res.status(403).json({ error: 'Access denied. Admin only.' });
    }

    // Get current date and next day
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    // Format dates to YYYY-MM-DD for MySQL comparison
    const formatDateForMySQL = (date) => date.toISOString().split('T')[0];
    const tomorrowDate = formatDateForMySQL(tomorrow);

    // Format date to DD-MM-YYYY for response
    const formatDateForResponse = (date) => {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    };
    const tomorrowFormatted = formatDateForResponse(tomorrow);

    // Query to fetch bookings for the next day
    const query = `
        SELECT id, uniqueId, customerName, contactNumber, 
               DATE_FORMAT(eventDate, '%d-%m-%Y') as eventDate, 
               DATE_FORMAT(eventTime, '%h:%i %p') as eventTime, 
               branch, selectedPackage, amount 
        FROM bookings 
        WHERE eventDate = ?
        ORDER BY eventTime ASC
    `;
    db.query(query, [tomorrowDate], (err, results) => {
        if (err) {
            console.error('Error fetching notifications:', err);
            res.status(500).json({ error: 'Error fetching notifications' });
            return;
        }
        res.json({
            message: `Bookings for tomorrow (${tomorrowFormatted})`,
            bookings: results
        });
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});