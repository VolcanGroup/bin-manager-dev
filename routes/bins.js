const express = require('express');
const XLSX = require('xlsx');
const multer = require('multer');
const { queryAll, queryOne, runQuery, logAudit } = require('../db_connector');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ========== HELPER: Recalculate parent BIN status ==========
async function recalcParentStatus(parentBin) {
    const parent = await queryOne('SELECT id, status FROM bins WHERE bin_number = ?', [parentBin]);
    if (!parent) return;

    const segments = await queryAll('SELECT status FROM bins WHERE parent_bin = ?', [parentBin]);
    if (segments.length === 0) return;

    const assigned = segments.filter(s => s.status === 'assigned' || s.status === 'pending').length;
    const total = segments.length;

    let newStatus;
    // Removed dangerous automatic deletion. Parent stays segmented unless explicitly unsegmented.
    if (assigned >= total) {
        newStatus = 'exhausted';
    } else {
        newStatus = 'segmented';
    }

    if (parent.status !== newStatus || assigned === 0) {
        await runQuery('UPDATE bins SET status = ?, updated_at = datetime("now", "localtime") WHERE bin_number = ?',
            [newStatus, parentBin]);
    }
}

// ========== GET /api/bins ==========
router.get('/', authenticateToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM bins WHERE 1=1';
        const params = [];

        // Helper: supports single value or array of values (preserves exact whitespaces for DB match)
        const addMultiFilter = (col, raw) => {
            if (raw === undefined || raw === null || raw === '') return;
            let vals = Array.isArray(raw) ? raw : [raw];
            
            let finalVals = [];
            vals.forEach(v => {
                if (typeof v === 'string' && v.includes(',')) {
                    finalVals.push(...v.split(',')); // Fallback for cached frontend that sends join(',')
                } else {
                    finalVals.push(v);
                }
            });
            
            finalVals = finalVals.filter(v => v !== '' && v !== null && v !== undefined);
            
            if (finalVals.length === 0) return;
            if (finalVals.length === 1) {
                query += ` AND ${col} = ?`;
                params.push(finalVals[0]);
            } else {
                query += ` AND ${col} IN (${finalVals.map(() => '?').join(',')})`;
                params.push(...finalVals);
            }
        };

        addMultiFilter('status', req.query.status);
        addMultiFilter('brand', req.query.brand);
        addMultiFilter('product', req.query.product);
        addMultiFilter('segment', req.query.segment);
        addMultiFilter('bin_type', req.query.bin_type);
        addMultiFilter('country', req.query.country);
        addMultiFilter('ica', req.query.ica);
        addMultiFilter('client', req.query.client);
        addMultiFilter('embosser', req.query.embosser);
        addMultiFilter('balance_type', req.query.balance_type);
        addMultiFilter('billeteras', req.query.billeteras);
        addMultiFilter('bin_tokenizado', req.query.bin_tokenizado);

        if (req.query.bin_length) {
            let rawArray = Array.isArray(req.query.bin_length) ? req.query.bin_length : [req.query.bin_length];
            let lengths = [];
            rawArray.forEach(item => {
                const parts = String(item).split(',').map(v => parseInt(v, 10)).filter(n => !isNaN(n));
                lengths.push(...parts);
            });
            if (lengths.length === 1) { query += ' AND bin_length = ?'; params.push(lengths[0]); }
            else if (lengths.length > 1) { query += ` AND bin_length IN (${lengths.map(() => '?').join(',')})`; params.push(...lengths); }
        }
        if (req.query.parent_only === 'true') { query += ' AND parent_bin IS NULL'; }
        if (req.query.search) {
            const words = req.query.search.trim().split(/\s+/);
            words.forEach(word => {
                query += ' AND (bin_number LIKE ? OR ica LIKE ? OR client LIKE ?)';
                const term = `%${word}%`;
                params.push(term, term, term);
            });
        }

        const sortBy = req.query.sort || 'bin_number';
        const sortOrder = req.query.order === 'desc' ? 'DESC' : 'ASC';
        const allowedSorts = ['bin_number', 'country', 'ica', 'brand', 'product', 'segment', 'status', 'client', 'bin_type', 'bin_length', 'created_at', 'billeteras', 'embosser', 'balance_type', 'bin_tokenizado'];
        if (allowedSorts.includes(sortBy)) {
            query += ` ORDER BY ${sortBy} ${sortOrder}`;
        } else {
            query += ' ORDER BY bin_number ASC';
        }

        const bins = await queryAll(query, params);

        // Enrich parent BINs with segment counts
        const enriched = await Promise.all(bins.map(async bin => {
            if (bin.parent_bin === null && bin.status === 'segmented') {
                const segs = await queryAll('SELECT status FROM bins WHERE parent_bin = ?', [bin.bin_number]);
                const totalSegs = segs.length;
                const assignedSegs = segs.filter(s => s.status === 'assigned' || s.status === 'pending').length;
                return { ...bin, total_segments: totalSegs, assigned_segments: assignedSegs, available_segments: totalSegs - assignedSegs };
            }
            return bin;
        }));

        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== GET /api/bins/embosser-check/:parentBin ==========
router.get('/embosser-check/:parentBin', authenticateToken, async (req, res) => {
    try {
        const parentBin = req.params.parentBin;
        const assigned = await queryOne(
            `SELECT embosser FROM bins WHERE parent_bin = ? AND embosser IS NOT NULL AND embosser != '' AND status IN ('assigned', 'pending') LIMIT 1`,
            [parentBin]
        );
        if (assigned) {
            return res.json({ has_embosser: true, embosser: assigned.embosser });
        }
        res.json({ has_embosser: false, embosser: null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== GET /api/bins/stats ==========
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        let whereClause = 'WHERE 1=1';
        const params = [];

        const addFilter = (col, raw) => {
            if (raw === undefined || raw === null || raw === '') return;
            let vals = Array.isArray(raw) ? raw : [raw];
            let finalVals = [];
            vals.forEach(v => {
                if (typeof v === 'string' && v.includes(',')) {
                    finalVals.push(...v.split(','));
                } else {
                    finalVals.push(v);
                }
            });
            finalVals = finalVals.filter(v => v !== '' && v !== null && v !== undefined);
            
            if (finalVals.length === 0) return;
            if (finalVals.length === 1) {
                whereClause += ` AND ${col} = ?`;
                params.push(finalVals[0]);
            } else {
                whereClause += ` AND ${col} IN (${finalVals.map(() => '?').join(',')})`;
                params.push(...finalVals);
            }
        };

        addFilter('country', req.query.country);
        addFilter('embosser', req.query.embosser);
        addFilter('bin_tokenizado', req.query.bin_tokenizado);

        // Special handling for parent_bin (shows children of parent)
        if (req.query.parent_bin) {
            whereClause += ` AND parent_bin = ?`;
            params.push(req.query.parent_bin);
        }

        // Handle bin_length
        if (req.query.bin_length) {
            let rawArray = Array.isArray(req.query.bin_length) ? req.query.bin_length : [req.query.bin_length];
            let lengths = [];
            rawArray.forEach(item => {
                const parts = String(item).split(',').map(v => parseInt(v, 10)).filter(n => !isNaN(n));
                lengths.push(...parts);
            });
            if (lengths.length === 1) { whereClause += ' AND bin_length = ?'; params.push(lengths[0]); }
            else if (lengths.length > 1) { whereClause += ` AND bin_length IN (${lengths.map(() => '?').join(',')})`; params.push(...lengths); }
        }

        // 1. KPIs
        const kpis = await queryOne(`
            SELECT 
                COUNT(*) as totalBins,
                SUM(CASE WHEN bin_length = 8 THEN 1 ELSE 0 END) as total8D,
                SUM(CASE WHEN bin_length > 8 THEN 1 ELSE 0 END) as totalHijos,
                COUNT(DISTINCT CASE WHEN bin_length > 8 THEN parent_bin END) as totalPadres,
                
                SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned,
                SUM(CASE WHEN status = 'assigned' AND bin_length = 8 THEN 1 ELSE 0 END) as assigned8D,
                SUM(CASE WHEN status = 'assigned' AND bin_length > 8 THEN 1 ELSE 0 END) as assignedHijos,
                
                SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN status = 'available' AND bin_length = 8 THEN 1 ELSE 0 END) as available8D,
                SUM(CASE WHEN status = 'available' AND bin_length > 8 THEN 1 ELSE 0 END) as availableHijos,
                
                SUM(CASE WHEN status = 'segmented' THEN 1 ELSE 0 END) as segmented,
                SUM(CASE WHEN status = 'segmented' AND bin_length = 8 THEN 1 ELSE 0 END) as segmented8D,
                SUM(CASE WHEN status = 'segmented' AND bin_length > 8 THEN 1 ELSE 0 END) as segmentedHijos,
                
                SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END) as onHold,
                SUM(CASE WHEN status = 'on_hold' AND bin_length = 8 THEN 1 ELSE 0 END) as onHold8D,
                SUM(CASE WHEN status = 'on_hold' AND bin_length > 8 THEN 1 ELSE 0 END) as onHoldHijos
            FROM bins
            ${whereClause}
        `, params);

        // 2. Pivot: Producto vs Estado
        const pivotProducto = await queryAll(`
            SELECT 
                COALESCE(product, 'Sin Producto') as product,
                bin_length,
                SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned,
                SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END) as on_hold,
                SUM(CASE WHEN status = 'segmented' THEN 1 ELSE 0 END) as segmented,
                COUNT(*) as total
            FROM bins
            ${whereClause}
            GROUP BY product, bin_length
            ORDER BY product, bin_length
        `, params);

        // 3. Pivot: Tokenización vs País vs Estado
        const pivotToken = await queryAll(`
            SELECT 
                COALESCE(bin_tokenizado, 'No') as tokenization_support,
                COALESCE(country, 'Sin País') as country,
                SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) as assigned,
                SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END) as on_hold,
                SUM(CASE WHEN status = 'segmented' THEN 1 ELSE 0 END) as segmented,
                COUNT(*) as total
            FROM bins
            ${whereClause}
            GROUP BY bin_tokenizado, country
            ORDER BY bin_tokenizado DESC, country
        `, params);

        // 4. Tabla ICAs
        const tableIcas = await queryAll(`
            SELECT 
                COALESCE(country, 'Sin País') as country,
                ica,
                ica_qmr,
                bin_number,
                client,
                status
            FROM bins
            ${whereClause} AND ica IS NOT NULL AND ica != ''
            ORDER BY country, ica, bin_number
        `, params);

        // 5. Datos brutos para Distribución por País
        const distribData = await queryAll(`
            SELECT 
                COALESCE(country, 'Sin País') as country,
                product,
                status
            FROM bins
            ${whereClause}
        `, params);

        // 6. Tabla Embozadores
        const tableEmbozadores = await queryAll(`
            SELECT 
                COALESCE(embosser, 'Sin Embozador') as embosser,
                COALESCE(country, 'Sin País') as country,
                client,
                bin_number,
                product,
                status
            FROM bins
            ${whereClause} AND embosser IS NOT NULL AND embosser != ''
            ORDER BY embosser, client, bin_number
        `, params);

        res.json({
            kpis,
            pivotProducto,
            pivotToken,
            tableIcas,
            distribData,
            tableEmbozadores
        });
    } catch (error) {
        console.error('Error in /stats:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== GET /api/bins/filter-options ==========
router.get('/filter-options', authenticateToken, async (req, res) => {
    try {
        const getUnique = async (col) => {
            const rows = await queryAll(`SELECT DISTINCT ${col} as val FROM bins WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col} ASC`);
            return rows.map(r => r.val);
        };
        res.json({
            countries: await getUnique('country'),
            icas: await getUnique('ica'),
            clients: await getUnique('client'),
            brands: await getUnique('brand'),
            products: await getUnique('product'),
            segments: await getUnique('segment'),
            billeteras: await getUnique('billeteras'),
            embossers: await getUnique('embosser'),
            balanceTypes: await getUnique('balance_type'),
            binTypes: await getUnique('bin_type'),
            binTokenizados: await getUnique('bin_tokenizado')
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== GET /api/bins/segments/:parentBin ==========
router.get('/segments/:parentBin', authenticateToken, async (req, res) => {
    try {
        const segments = await queryAll('SELECT * FROM bins WHERE parent_bin = ? ORDER BY bin_number ASC', [req.params.parentBin]);
        res.json(segments);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== GET /api/bins/export/excel ==========
router.get('/export/excel', authenticateToken, async (req, res) => {
    try {
        const bins = await queryAll('SELECT * FROM bins ORDER BY bin_number ASC');
        const data = bins.map(b => ({
            'País': b.country || '',
            'ICA': b.ica || '',
            'ICA QMR': b.ica_qmr || '',
            'BIN': b.bin_number,
            'Dígitos': b.bin_length,
            'BIN Padre': b.parent_bin || '',
            'Marca': b.brand || '',
            'Producto': b.product || '',
            'Estado': b.status === 'available' ? 'Disponible' : b.status === 'assigned' ? 'Asignado' : b.status === 'segmented' ? 'Segmentado' : b.status === 'pending' ? 'Por aprobar' : b.status === 'exhausted' ? 'Agotado' : b.status === 'on_hold' ? 'En Espera' : b.status,
            'Cliente': b.client || '',
            'Billeteras': b.billeteras || '',
            'BIN Tokenizado': b.bin_tokenizado || 'No',
            'Llaves': b.keys || '',
            'Embozador': b.embosser || '',
            'Tipo BIN': b.bin_type || '',
            'Fecha Asignación': b.assigned_date || '',
            'Solicitado por': b.requested_by || '',
            'Aprobado por': b.approved_by || '',
            'Notas': b.notes || ''
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'BINes');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename=bines_export.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== GET /api/bins/:id ==========
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const bin = await queryOne('SELECT * FROM bins WHERE id = ?', [parseInt(req.params.id)]);
        if (!bin) return res.status(404).json({ error: 'BIN no encontrado' });
        res.json(bin);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== POST /api/bins — Create BIN ==========
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { country, ica, ica_qmr, bin_number, brand, product, client, billeteras, keys, embosser, bin_type, balance_type, notes, status, bin_tokenizado } = req.body;

        if (!bin_number || !bin_number.trim()) return res.status(400).json({ error: 'El número de BIN es requerido' });
        const cleanBin = bin_number.trim().replace(/\D/g, '');
        const binLen = cleanBin.length;
        if (binLen < 6 || binLen > 10) return res.status(400).json({ error: 'El BIN debe tener entre 6 y 10 dígitos' });

        const existing = await queryOne('SELECT id FROM bins WHERE bin_number = ?', [cleanBin]);
        if (existing) return res.status(409).json({ error: 'Este BIN ya existe' });

        let binStatus = status || 'available';
        // bin_tokenizado solo aplica a BINes de 8 dígitos (padres); validar valores permitidos
        const binTok = (binLen === 8 && ['Sí', 'No'].includes(bin_tokenizado)) ? bin_tokenizado : null;

        if (binLen === 8) {
            const result = await runQuery(
                `INSERT INTO bins (country, ica, ica_qmr, bin_number, bin_length, parent_bin, status, brand, product, client, billeteras, keys, embosser, bin_type, balance_type, notes, assigned_date, bin_tokenizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [country || null, ica || null, ica_qmr || null, cleanBin, binLen, null, binStatus, brand || null, product || null, client || null, billeteras || null, keys || null, embosser || null, bin_type || null, balance_type || null, notes || null, binStatus === 'assigned' ? new Date().toISOString().split('T')[0] : null, binTok]
            );
            await logAudit(req.user.id, req.user.username, 'CREATE', 'bins', result.lastInsertRowid, null, null, cleanBin, `BIN 8 dígitos creado como ${binStatus} | bin_tokenizado: ${binTok || 'No'}`);
            const newBin = await queryOne('SELECT * FROM bins WHERE id = ?', [result.lastInsertRowid]);
            return res.status(201).json(newBin);
        }

        if (binLen === 9 || binLen === 10) {
            return res.status(400).json({ error: `Para crear un BIN de ${binLen} dígitos, use la función de segmentación.` });
        }

        const result = await runQuery(
            `INSERT INTO bins (country, ica, ica_qmr, bin_number, bin_length, parent_bin, status, brand, product, client, billeteras, keys, embosser, bin_type, balance_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [country || null, ica || null, ica_qmr || null, cleanBin, binLen, null, binStatus, brand || null, product || null, client || null, billeteras || null, keys || null, embosser || null, bin_type || null, balance_type || null, notes || null]
        );
        await logAudit(req.user.id, req.user.username, 'CREATE', 'bins', result.lastInsertRowid, null, null, cleanBin, `BIN ${binLen} dígitos creado`);
        const newBin = await queryOne('SELECT * FROM bins WHERE id = ?', [result.lastInsertRowid]);
        res.status(201).json(newBin);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== POST /api/bins/segment ==========
router.post('/segment', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { parent_bin_number, target_length, embosser } = req.body;
        if (!parent_bin_number) return res.status(400).json({ error: 'Se requiere el BIN padre' });

        const parent = await queryOne('SELECT * FROM bins WHERE bin_number = ?', [parent_bin_number]);
        if (!parent) return res.status(404).json({ error: 'El BIN padre no existe.' });
        if (parent.status !== 'available') return res.status(400).json({ error: 'El BIN padre debe estar Disponible' });

        const parentLen = parent.bin_number.length;
        let segCount, segLen;
        if (parentLen === 8) {
            segLen = target_length === 9 ? 9 : 10;
            segCount = segLen === 9 ? 10 : 100;
        } else if (parentLen === 9) {
            segCount = 10; segLen = 10;
        } else {
            return res.status(400).json({ error: 'Solo se pueden segmentar BINes de 8 o 9 dígitos' });
        }

        const existingSegs = await queryAll('SELECT id FROM bins WHERE parent_bin = ?', [parent.bin_number]);
        if (existingSegs.length > 0) return res.status(400).json({ error: 'Este BIN ya tiene segmentos' });

        let finalEmbosser = parent.embosser;
        if (embosser && embosser.trim() !== '') {
            finalEmbosser = embosser.trim();
            await runQuery('UPDATE bins SET embosser = ? WHERE bin_number = ?', [finalEmbosser, parent.bin_number]);
        }

        let created = 0;
        for (let i = 0; i < segCount; i++) {
            const suffix = segLen === 10 ? String(i).padStart(2, '0') : String(i);
            const segNumber = parent.bin_number + suffix;
            const exists = await queryOne('SELECT id FROM bins WHERE bin_number = ?', [segNumber]);
            if (!exists) {
                await runQuery(
                    `INSERT INTO bins (country, ica, ica_qmr, bin_number, bin_length, parent_bin, status, brand, product, segment, \`keys\`, embosser, bin_type, balance_type, billeteras, bin_tokenizado) VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [parent.country, parent.ica, parent.ica_qmr, segNumber, segLen, parent.bin_number, parent.brand, parent.product, parent.segment, parent.keys, finalEmbosser, parent.bin_type, parent.balance_type, parent.billeteras, parent.bin_tokenizado]
                );
                created++;
            }
        }

        await runQuery('UPDATE bins SET status = ?, updated_at = datetime("now", "localtime") WHERE id = ?', ['segmented', parent.id]);
        await logAudit(req.user.id, req.user.username, 'SEGMENT', 'bins', parent.id, 'status', 'available', 'segmented', `${created} segmentos de ${segLen} creados`);

        res.status(201).json({ message: `${created} segmentos creados`, created, segLength: segLen });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== PUT /api/bins/:id — Edit BIN ==========
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const bin = await queryOne('SELECT * FROM bins WHERE id = ?', [parseInt(req.params.id)]);
        if (!bin) return res.status(404).json({ error: 'BIN no encontrado' });

        const { country, ica, ica_qmr, bin_number, brand, product, segment, client, billeteras, keys, embosser, bin_type, balance_type, notes, status, bin_tokenizado } = req.body;
        const cleanBin = bin_number ? bin_number.trim().replace(/\D/g, '') : bin.bin_number;
        if (cleanBin !== bin.bin_number) {
            const existing = await queryOne('SELECT id FROM bins WHERE bin_number = ? AND id != ?', [cleanBin, bin.id]);
            if (existing) return res.status(409).json({ error: 'Este BIN ya existe' });
        }

        let finalStatus = status || bin.status;
        if (client && client.trim() !== '' && finalStatus === 'available') {
             finalStatus = 'assigned';
        }

        const fields = { country, ica, ica_qmr, brand, product, segment, client, billeteras, keys, embosser, bin_type, balance_type, notes, status: finalStatus, bin_tokenizado };
        for (const [key, val] of Object.entries(fields)) {
            if (val !== undefined && val !== bin[key]) {
                await logAudit(req.user.id, req.user.username, 'UPDATE', 'bins', bin.id, key, bin[key], val, null);
            }
        }

        await runQuery(
            `UPDATE bins SET country=?, ica=?, ica_qmr=?, bin_number=?, bin_length=?, brand=?, product=?, segment=?, client=?, billeteras=?, \`keys\`=?, embosser=?, bin_type=?, balance_type=?, notes=?, status=?, bin_tokenizado=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
            [country || bin.country, ica || bin.ica, ica_qmr || bin.ica_qmr, cleanBin, cleanBin.length, brand || bin.brand, product || bin.product, segment ?? bin.segment, client ?? bin.client, billeteras ?? bin.billeteras, keys ?? bin.keys, embosser ?? bin.embosser, bin_type || bin.bin_type, balance_type ?? bin.balance_type, notes ?? bin.notes, finalStatus, bin_tokenizado ?? bin.bin_tokenizado, parseInt(req.params.id)]
        );

        const updated = await queryOne('SELECT * FROM bins WHERE id = ?', [parseInt(req.params.id)]);
        if (updated && updated.parent_bin) await recalcParentStatus(updated.parent_bin);

        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== PUT /api/bins/:id/assign ==========
router.put('/:id/assign', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const bin = await queryOne('SELECT * FROM bins WHERE id = ?', [parseInt(req.params.id)]);
        if (!bin) return res.status(404).json({ error: 'BIN no encontrado' });
        const { client, billeteras } = req.body || {};

        await runQuery(
            `UPDATE bins SET status='assigned', client=?, billeteras=?, assigned_date=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`,
            [client || bin.client, billeteras || bin.billeteras, bin.id]
        );
        await logAudit(req.user.id, req.user.username, 'ASSIGN', 'bins', bin.id, 'status', bin.status, 'assigned', `BIN ${bin.bin_number} asignado`);
        if (bin.parent_bin) await recalcParentStatus(bin.parent_bin);

        res.json(await queryOne('SELECT * FROM bins WHERE id = ?', [bin.id]));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== PUT /api/bins/:id/release ==========
router.put('/:id/release', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const bin = await queryOne('SELECT * FROM bins WHERE id = ?', [parseInt(req.params.id)]);
        if (!bin) return res.status(404).json({ error: 'BIN no encontrado' });

        const embosserUpdate = bin.bin_length === 8 ? ', embosser=NULL' : '';
        await runQuery(
            `UPDATE bins SET status='available', client=NULL, billeteras=NULL, assigned_date=NULL, requested_by=NULL, approved_by=NULL${embosserUpdate}, updated_at=datetime('now','localtime') WHERE id=?`,
            [bin.id]
        );
        await logAudit(req.user.id, req.user.username, 'RELEASE', 'bins', bin.id, 'status', bin.status, 'available', `BIN ${bin.bin_number} liberado`);
        if (bin.parent_bin) await recalcParentStatus(bin.parent_bin);

        res.json(await queryOne('SELECT * FROM bins WHERE id = ?', [bin.id]));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== DELETE /api/bins/all ==========
router.delete('/all', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const count = (await queryOne('SELECT COUNT(*) as c FROM bins')).c;
        if (count > 0) {
            // Nullify references in requests to avoid FK constraint error
            await runQuery('UPDATE requests SET proposed_bin_id = NULL');
            await runQuery('DELETE FROM bins');
            await logAudit(req.user.id, req.user.username, 'DELETE_ALL', 'bins', null, null, null, null, `Eliminados ${count} BINes masivamente`);
        }
        res.json({ message: `Se eliminaron ${count} BINes` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== DELETE /api/bins/:id ==========
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const bin = await queryOne('SELECT * FROM bins WHERE id = ?', [parseInt(req.params.id)]);
        if (!bin) return res.status(404).json({ error: 'BIN no encontrado' });

        if (bin.parent_bin === null) {
            const childCount = (await queryOne('SELECT COUNT(*) as c FROM bins WHERE parent_bin = ?', [bin.bin_number])).c;
            if (childCount > 0) {
                await runQuery('DELETE FROM bins WHERE parent_bin = ?', [bin.bin_number]);
                await logAudit(req.user.id, req.user.username, 'DELETE', 'bins', bin.id, null, null, null, `Eliminados ${childCount} segmentos de ${bin.bin_number}`);
            }
        }
        await runQuery('DELETE FROM bins WHERE id = ?', [bin.id]);
        await logAudit(req.user.id, req.user.username, 'DELETE', 'bins', bin.id, null, JSON.stringify(bin), null, `BIN ${bin.bin_number} eliminado`);
        if (bin.parent_bin) await recalcParentStatus(bin.parent_bin);

        res.json({ message: 'BIN eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== Bulk operations helpers ==========
async function asyncProcessBulkBins(bins, user) {
    let inserted = 0, skipped = 0, errors = [];
    const affectedParents = new Set();
    const parentsToSegment = new Set();

    for (const b of bins) {
        try {
            if (!b.bin_number) { skipped++; continue; }
            const cleanBin = String(b.bin_number).trim().replace(/\D/g, '');
            if (cleanBin.length < 6 || cleanBin.length > 10) { skipped++; continue; }

            const existing = await queryOne('SELECT id FROM bins WHERE bin_number = ?', [cleanBin]);
            if (existing) { skipped++; continue; }

            const binLen = cleanBin.length;
            const clientVal = b.client ? String(b.client).trim() : '';
            const isNoClient = !clientVal || clientVal.toLowerCase() === 'sin cliente';
            const binStatus = isNoClient ? 'available' : 'assigned';
            const assignedDate = isNoClient ? null : new Date().toISOString().split('T')[0];

            let parentBin = null;
            if (binLen === 9 || binLen === 10) {
                parentBin = cleanBin.substring(0, 8);
                const parentExists = await queryOne('SELECT id FROM bins WHERE bin_number = ?', [parentBin]);
                if (!parentExists) {
                    await runQuery(
                        `INSERT INTO bins (country, ica, ica_qmr, bin_number, bin_length, parent_bin, status, brand, product, segment, \`keys\`, embosser, bin_type, balance_type, billeteras, bin_tokenizado) VALUES (?, ?, ?, ?, 8, NULL, 'segmented', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [b.country || null, b.ica || null, b.ica_qmr || null, parentBin, b.brand || null, b.product || null, b.segment || null, b.keys || null, b.embosser || null, b.bin_type || null, b.balance_type || null, b.billeteras || null, b.bin_tokenizado || null]
                    );
                }
                affectedParents.add(parentBin);
                parentsToSegment.add(JSON.stringify({ parentNumber: parentBin, targetLength: binLen, country: b.country, ica: b.ica, ica_qmr: b.ica_qmr, brand: b.brand, product: b.product, segment: b.segment, keys: b.keys, embosser: b.embosser, bin_type: b.bin_type, balance_type: b.balance_type, billeteras: b.billeteras, bin_tokenizado: b.bin_tokenizado }));
            }

            await runQuery(
                `INSERT INTO bins (country, ica, ica_qmr, bin_number, bin_length, parent_bin, status, brand, product, segment, client, billeteras, \`keys\`, embosser, bin_type, balance_type, notes, assigned_date, bin_tokenizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [b.country || null, b.ica || null, b.ica_qmr || null, cleanBin, binLen, parentBin, binStatus,
                b.brand || null, b.product || null, b.segment || null, isNoClient ? null : clientVal, b.billeteras || null, b.keys || null, b.embosser || null,
                b.bin_type || null, b.balance_type || null, b.notes || null, assignedDate, b.bin_tokenizado || null]
            );

            // Register embosser in catalog if new
            if (!isNoClient && b.embosser) {
                await runQuery('INSERT INTO embossers (name) VALUES (?) ON CONFLICT DO NOTHING', [b.embosser.trim()]);
            }

            inserted++;
        } catch (e) { skipped++; errors.push(`${b.bin_number}: ${e.message}`); }
    }

    for (const pStr of parentsToSegment) {
        const p = JSON.parse(pStr);
        const segCount = p.targetLength === 9 ? 10 : 100;
        const segLen = p.targetLength;
        for (let i = 0; i < segCount; i++) {
            const suffix = segLen === 10 ? String(i).padStart(2, '0') : String(i);
            const segNumber = p.parentNumber + suffix;
            const exists = await queryOne('SELECT id FROM bins WHERE bin_number = ?', [segNumber]);
            if (!exists) {
                await runQuery(
                    `INSERT INTO bins (country, ica, ica_qmr, bin_number, bin_length, parent_bin, status, brand, product, segment, \`keys\`, embosser, bin_type, balance_type, billeteras, bin_tokenizado) VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [p.country || null, p.ica || null, p.ica_qmr || null, segNumber, segLen, p.parentNumber, p.brand || null, p.product || null, p.segment || null, p.keys || null, p.embosser || null, p.bin_type || null, p.balance_type || null, p.billeteras || null, p.bin_tokenizado || null]
                );
            }
        }
    }

    for (const p of affectedParents) await recalcParentStatus(p);
    await logAudit(user.id, user.username, 'BULK_IMPORT', 'bins', null, null, null, null, `${inserted} BINes importados`);
    return { inserted, skipped, errors: errors.slice(0, 10) };
}

router.post('/bulk', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { bins } = req.body;
        if (!Array.isArray(bins)) return res.status(400).json({ error: 'Array requerido' });
        res.status(201).json(await asyncProcessBulkBins(bins, req.user));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/bulk-file', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
        const ext = req.file.originalname.split('.').pop().toLowerCase();
        let bins = [];
        if (ext === 'xlsx' || ext === 'xls') {
            const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
            bins = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]).map(row => {
                const obj = {};
                Object.keys(row).forEach(k => obj[k.trim().toLowerCase().replace(/\s+/g, '_')] = String(row[k]).trim());
                return obj;
            });
        } else if (ext === 'txt' || ext === 'csv') {
            const lines = req.file.buffer.toString('utf-8').split(/\r?\n/).filter(l => l.trim());
            const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
            bins = lines.slice(1).map(line => {
                const vals = line.split(',');
                const obj = {};
                headers.forEach((h, i) => obj[h] = (vals[i] || '').trim());
                return obj;
            });
        }
        res.status(201).json(await asyncProcessBulkBins(bins, req.user));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/next-available', authenticateToken, async (req, res) => {
    try {
        const { digits, country, brand, product, segment, bin_type } = req.query;
        if (!digits) return res.status(400).json({ error: 'digits requerido' });
        const dLen = parseInt(digits);
        if (dLen === 8) {
            let query = "SELECT * FROM bins WHERE bin_length = 8 AND status = 'available' AND parent_bin IS NULL";
            const params = [];
            if (country) { query += ' AND country = ?'; params.push(country); }
            if (brand) { query += ' AND brand = ?'; params.push(brand); }
            if (product) { query += ' AND product = ?'; params.push(product); }
            if (segment) { query += ' AND segment = ?'; params.push(segment); }
            if (bin_type) { query += ' AND bin_type = ?'; params.push(bin_type); }
            return res.json(await queryOne(query + ' ORDER BY bin_number ASC LIMIT 1', params));
        }
        if (dLen === 9 || dLen === 10) {
            let query = `SELECT s.* FROM bins s JOIN bins p ON s.parent_bin = p.bin_number WHERE s.bin_length = ? AND s.status = 'available'`;
            const params = [dLen];
            if (country) { query += ' AND p.country = ?'; params.push(country); }
            if (brand) { query += ' AND p.brand = ?'; params.push(brand); }
            if (product) { query += ' AND p.product = ?'; params.push(product); }
            if (segment) { query += ' AND p.segment = ?'; params.push(segment); }
            if (bin_type) { query += ' AND p.bin_type = ?'; params.push(bin_type); }
            return res.json(await queryOne(query + ' ORDER BY s.bin_number ASC LIMIT 1', params));
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/hold', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const bin = await queryOne('SELECT * FROM bins WHERE id = ?', [parseInt(req.params.id)]);
        if (!bin || bin.status === 'on_hold') return res.status(400).json({ error: 'No disponible' });
        await runQuery(`UPDATE bins SET status='on_hold', updated_at=datetime('now','localtime') WHERE id=?`, [bin.id]);
        await logAudit(req.user.id, req.user.username, 'HOLD', 'bins', bin.id, 'status', bin.status, 'on_hold', `BIN ${bin.bin_number} retenido`);
        res.json(await queryOne('SELECT * FROM bins WHERE id = ?', [bin.id]));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/unsegment', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const bin = await queryOne('SELECT * FROM bins WHERE id = ?', [parseInt(req.params.id)]);
        if (!bin) return res.status(404).json({ error: 'BIN no encontrado' });
        const hasUsed = (await queryAll(`SELECT id FROM bins WHERE parent_bin = ? AND (status IN ('assigned', 'pending'))`, [bin.bin_number])).length;
        if (hasUsed > 0) return res.status(400).json({ error: 'Segmentos en uso' });
        const count = (await queryOne('SELECT COUNT(*) as c FROM bins WHERE parent_bin = ?', [bin.bin_number])).c;
        await runQuery('DELETE FROM bins WHERE parent_bin = ?', [bin.bin_number]);
        await runQuery(`UPDATE bins SET status = 'available', embosser = NULL, first_segmentation = 0, updated_at = datetime('now','localtime') WHERE id = ?`, [bin.id]);
        await logAudit(req.user.id, req.user.username, 'UNSEGMENT', 'bins', bin.id, 'status', 'segmented', 'available', `BIN ${bin.bin_number} des-segmentado`);
        res.json({ message: 'Exitoso' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
