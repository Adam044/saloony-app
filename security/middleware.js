const db = require('../assets/database');
const { verifyToken } = require('./jwt');

/**
 * Middleware to authenticate JWT token.
 * Attaches user to req.user.
 */
function authenticateJWT(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'Authorization header missing' });
    }
    try {
        const payload = verifyToken(token);
        req.user = { id: payload.sub, role: payload.role };
        return next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

/**
 * Middleware wrapper for authentication.
 */
function requireAuth(req, res, next) {
    return authenticateJWT(req, res, next);
}

/**
 * Middleware to require specific role.
 */
function requireRole(role) {
    return (req, res, next) => authenticateJWT(req, res, () => {
        if (req.user.role !== role) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    });
}

/**
 * Middleware to require Admin role.
 */
function requireAdmin(req, res, next) {
    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!bearer) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="admin", error="invalid_token"');
        return res.status(401).json({ error: 'No token provided' });
    }
    try {
        const payload = verifyToken(bearer);
        if (payload.role === 'admin') {
            req.user = { id: payload.sub, role: payload.role };
            return next();
        }
    } catch (_) {}
    res.setHeader('WWW-Authenticate', 'Bearer realm="admin", error="invalid_token"');
    return res.status(401).json({ error: 'Invalid or unauthorized token' });
}

/**
 * Middleware to require Salon Admin role.
 * Verifies JWT (Owner/System Admin) or Role Session (Salon Admin).
 */
async function requireSalonAdminRole(req, res, next) {
    try {
        const salonId = req.params.salon_id;
        const tokenFromHeader = (req.headers.authorization || '').startsWith('Bearer ')
            ? (req.headers.authorization || '').slice(7)
            : null;
        const session_token = req.body?.session_token || tokenFromHeader;
        
        if (!salonId || !session_token) {
            return res.status(401).json({ success: false, message: 'Salon ID and session token required.' });
        }

        // 1. Try to verify as JWT (Owner/Admin)
        try {
            // Check if it looks like a JWT (3 parts separated by dots)
            if (session_token.split('.').length === 3) {
                const payload = verifyToken(session_token);
                // If System Admin, allow
                if (payload.role === 'admin') return next();
                
                // If Salon Owner, verify ownership
                if (payload.role === 'salon') {
                    const salon = await db.get('SELECT id FROM salons WHERE id = $1 AND user_id = $2', [salonId, payload.sub]);
                    if (salon) return next();
                }
            }
        } catch (jwtErr) {
            // Not a valid JWT or verification failed, proceed to check as Role Session
        }

        // 2. Check as Role Session
        const session = await db.get(`
            SELECT rs.*, sr.role_type
            FROM role_sessions rs
            JOIN staff_roles sr ON rs.staff_role_id = sr.id
            WHERE rs.salon_id = $1 AND rs.session_token = $2 AND rs.expires_at > CURRENT_TIMESTAMP
        `, [Number(salonId), session_token]);
        
        if (!session || session.role_type !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin role required.' });
        }
        return next();
    } catch (e) {
        console.error('Role check error:', e.message);
        return res.status(500).json({ success: false, message: 'Role verification error.' });
    }
}

module.exports = {
    requireSalonAdminRole,
    authenticateJWT,
    requireAuth,
    requireRole,
    requireAdmin
};
