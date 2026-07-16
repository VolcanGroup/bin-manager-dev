const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'bin-manager-secret-key-change-in-production';

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token de acceso requerido' });
    }

    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Token inválido o expirado' });
    }
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Se requieren permisos de administrador' });
    }
    next();
}

function requireRequester(req, res, next) {
    if (req.user.role !== 'requester' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Se requieren permisos de solicitante' });
    }
    next();
}

function requireAdminOrRequester(req, res, next) {
    if (req.user.role !== 'admin' && req.user.role !== 'requester') {
        return res.status(403).json({ error: 'Se requieren permisos de administrador o solicitante' });
    }
    next();
}

module.exports = { authenticateToken, requireAdmin, requireRequester, requireAdminOrRequester, JWT_SECRET };
