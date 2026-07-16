const express = require('express');
const { queryAll, runQuery, queryOne, logAudit } = require('../db_connector');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/countries — List all countries
router.get('/', authenticateToken, async (req, res) => {
    try {
        const countries = await queryAll('SELECT * FROM countries ORDER BY name ASC');
        res.json(countries);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/countries — Add a new country (admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre del país es requerido' });

        const existing = await queryOne('SELECT id FROM countries WHERE name = ?', [name.trim()]);
        if (existing) return res.status(409).json({ error: 'Este país ya existe' });

        const result = await runQuery('INSERT INTO countries (name) VALUES (?)', [name.trim()]);
        await logAudit(req.user.id, req.user.username, 'CREATE', 'countries', result.lastInsertRowid, null, null, name.trim(), 'País agregado');
        res.status(201).json({ id: result.lastInsertRowid, name: name.trim() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/countries/:id — Remove a country (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const country = await queryOne('SELECT * FROM countries WHERE id = ?', [parseInt(req.params.id)]);
        if (!country) return res.status(404).json({ error: 'País no encontrado' });

        await runQuery('DELETE FROM countries WHERE id = ?', [parseInt(req.params.id)]);
        await logAudit(req.user.id, req.user.username, 'DELETE', 'countries', country.id, null, country.name, null, 'País eliminado');
        res.json({ message: 'País eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
