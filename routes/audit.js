const express = require('express');
const { queryAll } = require('../db_connector');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/audit
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const logs = await queryAll('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 500');
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// POST /api/audit/:id/restore
router.post('/:id/restore', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { queryOne, runQuery, logAudit } = require('../db_connector');
        const log = await queryOne('SELECT * FROM audit_log WHERE id = ?', [req.params.id]);
        if (!log || log.action !== 'DELETE' || log.table_name !== 'bins') {
            return res.status(400).json({ error: 'Solo se pueden restaurar registros de BINs eliminados' });
        }
        
        let bin;
        try {
            bin = JSON.parse(log.old_value);
        } catch (e) {
            return res.status(400).json({ error: 'El formato del registro no permite restauraciÃ³n' });
        }
        
        if (!bin.bin_number) {
            return res.status(400).json({ error: 'Datos del BIN invÃ¡lidos para restauraciÃ³n' });
        }

        const exists = await queryOne('SELECT id FROM bins WHERE bin_number = ?', [bin.bin_number]);
        if (exists) {
            return res.status(400).json({ error: 'El BIN ya existe en el inventario' });
        }

        await runQuery(
            `INSERT INTO bins (country, ica, ica_qmr, bin_number, bin_length, parent_bin, status, brand, product, segment, client, billeteras, \`keys\`, embosser, bin_type, balance_type, notes, assigned_date, bin_tokenizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [bin.country, bin.ica, bin.ica_qmr, bin.bin_number, bin.bin_length, bin.parent_bin, bin.status, bin.brand, bin.product, bin.segment, bin.client, bin.billeteras, bin.keys, bin.embosser, bin.bin_type, bin.balance_type, bin.notes, bin.assigned_date, bin.bin_tokenizado]
        );

        await logAudit(req.user.id, req.user.username, 'RESTORE', 'bins', null, null, null, bin.bin_number, `BIN ${bin.bin_number} restaurado desde la bitÃ¡cora`);

        res.json({ message: 'Restaurado exitosamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
