const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
//app.use(express.static(path.join(__dirname, 'public'))); // or whatever your folder is
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// CORS Configuration (MUST come before routes)
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "http://127.0.0.1:5500");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    next();
});

// User database
const users = [
    { email: 'farmer@example.com', password: 'agritech123' }
];

// Login endpoint
app.post('/login', (req, res) => {
    try {
        console.log('Login attempt:', req.body); // Debug log
        
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false,
                message: 'Email and password are required'
            });
        }

        const user = users.find(u => u.email === email && u.password === password);
        
        if (user) {
            res.json({ 
                success: true,
                message: 'Login successful',
                user: { email }
            });
        } else {
            res.status(401).json({ 
                success: false,
                message: 'Invalid email or password'
            });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});