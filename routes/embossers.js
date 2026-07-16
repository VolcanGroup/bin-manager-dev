const express = require('express');
const { queryAll, queryOne, runQuery, logAudit } = require('../db_connector');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ========== GET /api/embossers ==========
router.get('/', authenticateToken, async (req, res) => {
    try {
        const embossers = await queryAll('SELECT * FROM embossers ORDER BY name ASC');
        res.json(embossers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== POST /api/embossers — Admin only ==========
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'El nombre del embozador es requerido' });
        }
        const cleanName = name.trim();
        const existing = await queryOne('SELECT id FROM embossers WHERE name = ?', [cleanName]);
        if (existing) return res.status(409).json({ error: 'Este embozador ya existe' });

        const result = await runQuery('INSERT INTO embossers (name) VALUES (?)', [cleanName]);
        await logAudit(req.user.id, req.user.username, 'CREATE', 'embossers', result.lastInsertRowid, null, null, cleanName, `Embozador "${cleanName}" creado`);
        const newEmbosser = await queryOne('SELECT * FROM embossers WHERE id = ?', [result.lastInsertRowid]);
        res.status(201).json(newEmbosser);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
