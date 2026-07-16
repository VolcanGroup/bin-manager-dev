const express = require('express');
const { queryAll, queryOne, runQuery, logAudit } = require('../db_connector');
const { authenticateToken, requireAdmin, requireRequester } = require('../middleware/auth');
const { sendNewRequestEmail } = require('../emailService');

const router = express.Router();

// ========== GET /api/requests — List requests ==========
router.get('/', authenticateToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM requests WHERE 1=1';
        const params = [];

        // Admin sees all, requester sees only own
        if (req.user.role === 'requester') {
            query += ' AND requester_id = ?';
            params.push(req.user.id);
        }

        if (req.query.status) {
            query += ' AND status = ?';
            params.push(req.query.status);
        }

        query += ' ORDER BY created_at DESC';
        const requests = await queryAll(query, params);
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== POST /api/requests — Create BIN request ==========
router.post('/', authenticateToken, requireRequester, async (req, res) => {
    try {
        const {
            country, ica, ica_qmr, digits, brand, product, segment, client,
            billeteras, keys, embosser, bin_type, balance_type, notes,
            requiere_tokenizacion
        } = req.body;

        // ===== Validate ALL required fields =====
        if (!country)   return res.status(400).json({ error: 'El país es requerido' });
        if (!brand)     return res.status(400).json({ error: 'La marca es requerida' });
        if (!product)   return res.status(400).json({ error: 'El producto es requerido' });
        if (!segment)   return res.status(400).json({ error: 'El segmento es requerido' });
        if (!client)    return res.status(400).json({ error: 'El cliente es requerido' });
        if (!billeteras) return res.status(400).json({ error: 'La billetera es requerida' });
        const validBilleteras = ['Apple propia', 'Google propia', 'Apple Volcán', 'Google Volcán', 'Ambas propias', 'Ambas Volcán', 'No aplica'];
        if (!validBilleteras.includes(billeteras)) {
            return res.status(400).json({ error: 'Billeteras inválida. Opciones: ' + validBilleteras.join(', ') });
        }
        if (!keys)       return res.status(400).json({ error: 'El tipo de llaves es requerido' });
        if (!embosser)   return res.status(400).json({ error: 'El embozador es requerido' });
        if (!balance_type || !['Interno', 'Externo'].includes(balance_type)) {
            return res.status(400).json({ error: 'El tipo de saldos es requerido (Interno o Externo)' });
        }
        if (!bin_type)   return res.status(400).json({ error: 'El tipo de BIN es requerido' });

        // ===== Validar requiere_tokenizacion =====
        if (!requiere_tokenizacion || !(requiere_tokenizacion.startsWith('S') || requiere_tokenizacion.startsWith('N'))) {
            return res.status(400).json({ error: 'El campo "¿Requiere Billeteras BIN?" es requerido (Sí / No)' });
        }

        const esTokenizado = requiere_tokenizacion.startsWith('S');
        console.log("esTokenizado boolean:", esTokenizado, "dLen:", digits);

        // ===== Determinar dígitos según rama =====
        let dLen;
        if (!digits || ![8, 9, 10].includes(parseInt(digits))) {
            return res.status(400).json({ error: 'Dígitos debe ser 8, 9, o 10' });
        }
        dLen = parseInt(digits);

        if (esTokenizado) {
            // Si es tokenizado, DEBE ser de 8 dígitos
            if (dLen !== 8) {
                return res.status(400).json({ error: 'Los BINes Tokenizados deben ser de 8 dígitos' });
            }
        } else {
            // Reglas de producto para BINes NO tokenizados
            if (req.user.role !== 'admin') {
                if ((product === 'Prepago' || product === 'Débito') && dLen !== 10) {
                    return res.status(400).json({ error: `El producto ${product} requiere BIN de 10 dígitos (segmentado)` });
                }
                if (product === 'Crédito' && dLen !== 9) {
                    return res.status(400).json({ error: 'El producto Crédito requiere BIN de 9 dígitos (segmentado)' });
                }
            }
        }

        // 8-digit BINs solo para admin, A MENOS que sea Tokenizado
        if (dLen === 8 && req.user.role !== 'admin' && !esTokenizado) {
            return res.status(403).json({ error: 'Solo el administrador puede solicitar BINes de 8 dígitos (salvo para BINes Tokenizados)' });
        }

        let proposedBin = null;
        let proposedBinId = null;
        let isFirstSegmentation = false;

        // ========== BUSCAR BIN DISPONIBLE ==========
        if (dLen === 8) {
                // Admin solicita BIN de 8 dígitos
                let query = `SELECT * FROM bins WHERE bin_length = 8 AND status = 'available'`;
                const params = [];
                if (country)  { query += ' AND country = ?';  params.push(country); }
                if (brand) { query += ' AND brand = ?'; params.push(brand); }
                if (product) { query += ' AND product = ?'; params.push(product); }
                if (segment) { query += ' AND segment = ?'; params.push(segment); }
                if (embosser) { 
                    query += ' AND (embosser IS NULL OR embosser = "" OR embosser = "-" OR LOWER(embosser) = LOWER(?))'; 
                    params.push(embosser); 
                }
                if (requiere_tokenizacion.startsWith('S')) {
                    query += ' AND bin_tokenizado LIKE "S%"';
                } else {
                    query += ' AND (bin_tokenizado IS NULL OR bin_tokenizado = "" OR bin_tokenizado LIKE "N%")';
                }
                query += ' ORDER BY bin_number ASC LIMIT 1';

                const bin = await queryOne(query, params);
                if (!bin) return res.status(404).json({ error: 'No hay BINes de 8 dígitos disponibles con los filtros indicados' });

                proposedBin   = bin.bin_number;
                proposedBinId = bin.id;

            } else {
                // Buscar segmento disponible
                let query = `SELECT s.* FROM bins s JOIN bins p ON s.parent_bin = p.bin_number
        WHERE s.bin_length = ? AND s.status = 'available' AND s.parent_bin IS NOT NULL`;
                const params = [dLen];
                if (country)  { query += ' AND p.country = ?';  params.push(country); }
                if (brand) { query += ' AND p.brand = ?'; params.push(brand); }
                if (product) { query += ' AND p.product = ?'; params.push(product); }
                if (segment) { query += ' AND p.segment = ?'; params.push(segment); }
                
                if (requiere_tokenizacion.startsWith('S')) {
                    query += " AND p.bin_tokenizado LIKE 'S%'";
                } else {
                    query += " AND (p.bin_tokenizado LIKE 'N%' OR p.bin_tokenizado IS NULL OR p.bin_tokenizado = '')";
                }

                if (embosser) {
                    query += ` AND NOT EXISTS (
                        SELECT 1 FROM bins s2 
                        WHERE s2.parent_bin = s.parent_bin 
                        AND s2.embosser IS NOT NULL 
                        AND s2.embosser != "" 
                        AND s2.embosser != "-" 
                        AND LOWER(s2.embosser) != LOWER(?)
                          AND s2.status IN ('assigned', 'pending')
                    )`;
                    params.push(embosser);
                }

                if (brand) {
                    query += ` AND NOT EXISTS (
                        SELECT 1 FROM bins s3
                        WHERE s3.parent_bin = s.parent_bin
                          AND s3.brand IS NOT NULL AND s3.brand != ''
                          AND LOWER(s3.brand) != LOWER(?)
                          AND s3.status IN ('assigned', 'pending')
                    )`;
                    params.push(brand);
                }

                query += ' ORDER BY s.bin_number ASC LIMIT 1';
                let seg = await queryOne(query, params);

                // Si no hay segmento, auto-segmentar
                if (!seg) {
                    let parentQuery = `SELECT * FROM bins WHERE bin_length = 8 AND status = 'available'`;
                    const parentParams = [];
                    if (country)  { parentQuery += ' AND country = ?';  parentParams.push(country); }
                    if (brand) { parentQuery += ' AND brand = ?'; parentParams.push(brand); }
                    if (product) { parentQuery += ' AND product = ?'; parentParams.push(product); }
                    if (segment) { parentQuery += ' AND segment = ?'; parentParams.push(segment); }
                    if (embosser) { 
                        parentQuery += ' AND (embosser IS NULL OR embosser = "" OR embosser = "-" OR LOWER(embosser) = LOWER(?))'; 
                        parentParams.push(embosser); 
                    }
                    if (requiere_tokenizacion.startsWith('S')) {
                        parentQuery += ' AND bin_tokenizado LIKE "S%"';
                    } else {
                        parentQuery += ' AND (bin_tokenizado LIKE "N%" OR bin_tokenizado IS NULL OR bin_tokenizado = "")';
                    }
                    parentQuery += ' ORDER BY bin_number ASC LIMIT 1';

                    const parentBin = await queryOne(parentQuery, parentParams);
                    if (!parentBin) {
                        return res.status(404).json({
                            error: `No hay BINes ${requiere_tokenizacion.startsWith('S') ? 'tokenizados' : 'no tokenizados'} disponibles para segmentar a ${dLen} dígitos con los filtros y marca indicados`
                        });
                    }

                    // Auto-segmentar: Crédito → 9 dígitos (10 segs), Prepago/Débito → 10 dígitos (100 segs)
                    let segCount, segLen;
                    if (dLen === 9) { segCount = 10;  segLen = 9; }
                    else             { segCount = 100; segLen = 10; }

                    for (let i = 0; i < segCount; i++) {
                        const suffix    = segLen === 10 ? String(i).padStart(2, '0') : String(i);
                        const segNumber = parentBin.bin_number + suffix;
                        const exists    = await queryOne('SELECT id FROM bins WHERE bin_number = ?', [segNumber]);
                        if (!exists) {
                            await runQuery(
                                `INSERT INTO bins (country, ica, ica_qmr, bin_number, bin_length, parent_bin, status, brand, product, segment, \`keys\`, embosser, bin_type)
                                 VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?, ?)`,
                                [parentBin.country, parentBin.ica, parentBin.ica_qmr, segNumber, segLen, parentBin.bin_number,
                                parentBin.brand || brand || null, parentBin.product, parentBin.segment, parentBin.keys, parentBin.embosser || embosser || null, parentBin.bin_type]
                            );
                        }
                    }

                    await runQuery("UPDATE bins SET status = 'segmented', first_segmentation = 1, updated_at = datetime('now', 'localtime') WHERE id = ?", [parentBin.id]);
                    isFirstSegmentation = true;

                    await logAudit(req.user.id, req.user.username, 'AUTO_SEGMENT', 'bins', parentBin.id, 'status', 'available', 'segmented',
                        `Auto-segmentado ${parentBin.bin_number} a ${segCount} segmentos de ${segLen} dígitos por solicitud`);

                    seg = await queryOne(
                        `SELECT * FROM bins WHERE parent_bin = ? AND bin_length = ? AND status = 'available' ORDER BY bin_number ASC LIMIT 1`,
                        [parentBin.bin_number, dLen]
                    );
                }

                if (!seg) return res.status(404).json({ error: `No hay segmentos de ${dLen} dígitos disponibles` });

                // ===== Regla de negocio: mismo embozador Y marca en BINes segmentados =====
                const existingMeta = await queryOne(
                    `SELECT embosser, brand FROM bins WHERE parent_bin = ?
                     AND ((embosser IS NOT NULL AND embosser != '') OR (brand IS NOT NULL AND brand != ''))
                     AND status IN ('assigned', 'pending') LIMIT 1`,
                    [seg.parent_bin]
                );

                if (existingMeta) {
                    if (existingMeta.embosser && existingMeta.embosser.toLowerCase() !== embosser.toLowerCase()) {
                        return res.status(400).json({
                            error: `Este BIN ya tiene segmentos asignados con el embozador "${existingMeta.embosser}". No es posible cambiar el embozador en este BIN.`,
                            forced_embosser: existingMeta.embosser
                        });
                    }
                    if (existingMeta.brand && existingMeta.brand.toLowerCase() !== brand.toLowerCase()) {
                        return res.status(400).json({
                            error: `Este BIN ya tiene segmentos asignados con la marca "${existingMeta.brand}". No es posible cambiar la marca en este BIN.`,
                            forced_brand: existingMeta.brand
                        });
                    }
                }

                proposedBin   = seg.bin_number;
                proposedBinId = seg.id;
            }

        // ===== Marcar BIN como pendiente =====
        await runQuery(
            "UPDATE bins SET status = 'pending', client = ?, billeteras = ?, embosser = ?, balance_type = ?, requested_by = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
            [client, billeteras || null, embosser || null, balance_type || null, req.user.username, proposedBinId]
        );

        // Recalcular estado del padre si el BIN seleccionado es un segmento
        const binRow = await queryOne('SELECT parent_bin FROM bins WHERE id = ?', [proposedBinId]);
        if (binRow && binRow.parent_bin) {
            const parent = await queryOne('SELECT * FROM bins WHERE bin_number = ?', [binRow.parent_bin]);
            if (parent) {
                const segs        = await queryAll('SELECT status FROM bins WHERE parent_bin = ?', [binRow.parent_bin]);
                const assignedCount = segs.filter(s => s.status === 'assigned' || s.status === 'pending').length;
                const total       = segs.length;
                let newStatus     = assignedCount === 0 ? 'available' : assignedCount >= total ? 'exhausted' : 'segmented';
                await runQuery('UPDATE bins SET status = ?, updated_at = datetime("now", "localtime") WHERE bin_number = ?', [newStatus, binRow.parent_bin]);
            }
        }

        // ===== Crear registro de solicitud (incluye requiere_tokenizacion) =====
        const result = await runQuery(
            `INSERT INTO requests (requester_id, requester_username, country, ica, ica_qmr, digits, brand, product, segment, client,
             billeteras, \`keys\`, embosser, bin_type, balance_type, proposed_bin, proposed_bin_id, status, notes, requiere_tokenizacion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
            [req.user.id, req.user.username, country || null, ica || null, ica_qmr || null, dLen,
            brand || null, product || null, segment || null, client, billeteras || null, keys || null, embosser || null,
            bin_type || null, balance_type || null, proposedBin, proposedBinId, notes || null, requiere_tokenizacion]
        );

        await logAudit(req.user.id, req.user.username, 'REQUEST_CREATE', 'requests', result.lastInsertRowid, null, null, proposedBin,
            `Solicitud BIN ${dLen}d para ${client} | Req. Billeteras BIN: ${requiere_tokenizacion}`);

        const newRequest = await queryOne('SELECT * FROM requests WHERE id = ?', [result.lastInsertRowid]);
        
        // Notify admins asynchronously (no await so it doesn't block response)
        sendNewRequestEmail(newRequest, req.user.full_name).catch(e => console.error("Email failed:", e));
        res.status(201).json({ ...newRequest, is_first_segmentation: isFirstSegmentation });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== PUT /api/requests/:id/approve ==========
router.put('/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const request = await queryOne('SELECT * FROM requests WHERE id = ?', [parseInt(req.params.id)]);
        if (!request) return res.status(404).json({ error: 'Solicitud no encontrada' });
        if (request.status !== 'pending') return res.status(400).json({ error: 'Esta solicitud ya fue procesada' });

        // Approve: mark BIN as assigned
        await runQuery(
            `UPDATE bins SET status = 'assigned', approved_by = ?, assigned_date = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?`,
            [req.user.username, request.proposed_bin_id]
        );

        // Recalculate parent
        const bin = await queryOne('SELECT parent_bin FROM bins WHERE id = ?', [request.proposed_bin_id]);
        if (bin && bin.parent_bin) {
            const segs = await queryAll('SELECT status FROM bins WHERE parent_bin = ?', [bin.parent_bin]);
            const assignedCount = segs.filter(s => s.status === 'assigned' || s.status === 'pending').length;
            const total = segs.length;
            let newStatus = assignedCount === 0 ? 'available' : assignedCount >= total ? 'exhausted' : 'segmented';
            await runQuery('UPDATE bins SET status = ?, updated_at = datetime("now", "localtime") WHERE bin_number = ?', [newStatus, bin.parent_bin]);
        }

        // Update request
        await runQuery(
            `UPDATE requests SET status = 'approved', admin_id = ?, admin_username = ?, admin_action_date = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?`,
            [req.user.id, req.user.username, parseInt(req.params.id)]
        );

        await logAudit(req.user.id, req.user.username, 'REQUEST_APPROVE', 'requests', request.id, 'status', 'pending', 'approved',
            `BIN ${request.proposed_bin} aprobado para ${request.client}`);

        const updated = await queryOne('SELECT * FROM requests WHERE id = ?', [parseInt(req.params.id)]);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== PUT /api/requests/:id/reject ==========
router.put('/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const request = await queryOne('SELECT * FROM requests WHERE id = ?', [parseInt(req.params.id)]);
        if (!request) return res.status(404).json({ error: 'Solicitud no encontrada' });
        if (request.status !== 'pending') return res.status(400).json({ error: 'Esta solicitud ya fue procesada' });

        // Fetch the BIN first
        const binRow = await queryOne('SELECT * FROM bins WHERE id = ?', [request.proposed_bin_id]);
        
        // Restore parent properties if it's a segmented BIN
        let embosserToSet = null;
        let billeterasToSet = null;
        let balanceTypeToSet = null;
        let binTokenizadoToSet = null;
        
        if (binRow && binRow.parent_bin) {
            const parentBin = await queryOne('SELECT * FROM bins WHERE bin_number = ?', [binRow.parent_bin]);
            if (parentBin) {
                embosserToSet = parentBin.embosser;
                billeterasToSet = parentBin.billeteras;
                balanceTypeToSet = parentBin.balance_type;
                binTokenizadoToSet = parentBin.bin_tokenizado;
            }
        }
        
        // Reject: return BIN to available, restoring properties if applicable
        await runQuery(
            `UPDATE bins SET status = 'available', client = NULL, requested_by = NULL, embosser = ?, billeteras = ?, balance_type = ?, bin_tokenizado = COALESCE(?, bin_tokenizado), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [embosserToSet, billeterasToSet, balanceTypeToSet, binTokenizadoToSet, request.proposed_bin_id]
        );

        // Check if parent BIN can be unsegmented
        let can_unsegment = false;
        let parent_bin_id = null;
        if (binRow && binRow.parent_bin) {
            const parentBin = await queryOne('SELECT * FROM bins WHERE bin_number = ?', [binRow.parent_bin]);
            if (parentBin) {
                const usedSegs = await queryAll(
                    `SELECT id FROM bins WHERE parent_bin = ? AND id != ? AND (status = 'assigned' OR status = 'pending')`,
                    [binRow.parent_bin, binRow.id]
                );
                if (usedSegs.length === 0) {
                    can_unsegment = true;
                    parent_bin_id = parentBin.id;
                }
            }

            // Recalculate parent status
            const segs = await queryAll('SELECT status FROM bins WHERE parent_bin = ?', [binRow.parent_bin]);
            const assignedCount = segs.filter(s => s.status === 'assigned' || s.status === 'pending').length;
            const total = segs.length;
            let newStatus = assignedCount === 0 ? 'available' : assignedCount >= total ? 'exhausted' : 'segmented';
            await runQuery('UPDATE bins SET status = ?, updated_at = datetime("now", "localtime") WHERE bin_number = ?', [newStatus, binRow.parent_bin]);
        }

        // Update request
        await runQuery(
            `UPDATE requests SET status = 'rejected', admin_id = ?, admin_username = ?, admin_action_date = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?`,
            [req.user.id, req.user.username, parseInt(req.params.id)]
        );

        await logAudit(req.user.id, req.user.username, 'REQUEST_REJECT', 'requests', request.id, 'status', 'pending', 'rejected',
            `BIN ${request.proposed_bin} rechazado para ${request.client}`);

        const updated = await queryOne('SELECT * FROM requests WHERE id = ?', [parseInt(req.params.id)]);
        res.json({ ...updated, can_unsegment, parent_bin_id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
