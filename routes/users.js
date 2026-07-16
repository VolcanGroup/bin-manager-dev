const express = require('express');
const bcrypt = require('bcryptjs');
const { queryAll, queryOne, runQuery, logAudit } = require('../db_connector');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/users
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await queryAll('SELECT id, username, full_name, role, created_at FROM users ORDER BY created_at ASC');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/users
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        let { username, password, full_name, role } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
        username = username.trim().toLowerCase();
        if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

        const existing = await queryOne('SELECT id FROM users WHERE username = ?', [username]);
        if (existing) return res.status(409).json({ error: 'El usuario ya existe' });

        const hash = bcrypt.hashSync(password, 10);
        const validRole = ['admin', 'viewer', 'requester'].includes(role) ? role : 'viewer';
        const result = await runQuery('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
            [username, hash, full_name || username, validRole]);

        await logAudit(req.user.id, req.user.username, 'CREATE', 'users', result.lastInsertRowid, null, null, username, `Usuario creado con rol ${validRole}`);

        res.status(201).json({ id: result.lastInsertRowid, username, full_name: full_name || username, role: validRole });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/users/:id
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const user = await queryOne('SELECT * FROM users WHERE id = ?', [parseInt(req.params.id)]);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const { full_name, role, password } = req.body;

        if (password) {
            if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
            const hash = bcrypt.hashSync(password, 10);
            await runQuery('UPDATE users SET password_hash = ?, updated_at = datetime("now", "localtime") WHERE id = ?', [hash, parseInt(req.params.id)]);
            await logAudit(req.user.id, req.user.username, 'UPDATE', 'users', user.id, 'password', '***', '***', 'Contraseña actualizada');
        }

        if (full_name || role) {
            const validRole = role && ['admin', 'viewer', 'requester'].includes(role) ? role : user.role;
            if (role && role !== user.role) {
                await logAudit(req.user.id, req.user.username, 'UPDATE', 'users', user.id, 'role', user.role, validRole, null);
            }
            await runQuery('UPDATE users SET full_name = ?, role = ?, updated_at = datetime("now", "localtime") WHERE id = ?',
                [full_name || user.full_name, validRole, parseInt(req.params.id)]);
        }

        const updated = await queryOne('SELECT id, username, full_name, role, created_at FROM users WHERE id = ?', [parseInt(req.params.id)]);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/users/:id
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const user = await queryOne('SELECT * FROM users WHERE id = ?', [parseInt(req.params.id)]);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (user.id === req.user.id) return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });

        await runQuery('DELETE FROM users WHERE id = ?', [parseInt(req.params.id)]);
        await logAudit(req.user.id, req.user.username, 'DELETE', 'users', user.id, null, user.username, null, 'Usuario eliminado');
        res.json({ message: 'Usuario eliminado correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
