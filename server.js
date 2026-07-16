require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Unified database connector
const { initDatabase } = require('./db_connector');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function start() {
    // Initialize database (creates tables if needed)
    await initDatabase();

    // API Routes
    const authRoutes = require('./routes/auth');
    const binRoutes = require('./routes/bins');
    const userRoutes = require('./routes/users');
    const requestRoutes = require('./routes/requests');
    const auditRoutes = require('./routes/audit');
    const countryRoutes = require('./routes/countries');
    const embosserRoutes = require('./routes/embossers');

    app.use('/api/auth', authRoutes);
    app.use('/api/bins', binRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/requests', requestRoutes);
    app.use('/api/audit', auditRoutes);
    app.use('/api/countries', countryRoutes);
    app.use('/api/embossers', embosserRoutes);

    // SPA fallback
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.listen(PORT, () => {
        console.log(`\n🏦 BIN Manager v2 running at http://localhost:${PORT}`);
        console.log(`   Default login: admin / admin123\n`);
    });
}

start().catch(err => {
    console.error('Failed to start:', err);
    process.exit(1);
});
