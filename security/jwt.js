const jwt = require('jsonwebtoken');
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
let JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    if (NODE_ENV === 'production') {
        console.error('FATAL: Missing JWT_SECRET in environment. Refusing to start in production.');
        process.exit(1);
    } else {
        // Use a fixed secret for local development to preserve sessions across restarts
        JWT_SECRET = 'dev-secret-fixed-for-saloony-development-12345'; 
        console.warn('WARNING: No JWT_SECRET set. Using fixed dev secret. Set JWT_SECRET in your .env for production security.');
    }
}

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '30d';
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 30);

/**
 * Sign a new JWT token.
 * @param {Object} payload - The data to embed in the token.
 * @param {Object} [options] - Additional options (expiresIn, etc.).
 * @returns {string} - The signed JWT string.
 */
function signToken(payload, options = {}) {
    return jwt.sign(payload, JWT_SECRET, { 
        expiresIn: ACCESS_TOKEN_TTL,
        ...options 
    });
}

/**
 * Verify a JWT token.
 * @param {string} token - The JWT string.
 * @returns {Object} - The decoded payload.
 * @throws {Error} - If verification fails.
 */
function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

/**
 * Decode a JWT token without verifying.
 * @param {string} token - The JWT string.
 * @returns {Object|null} - The decoded payload or null.
 */
function decodeToken(token) {
    return jwt.decode(token);
}

module.exports = {
    JWT_SECRET,
    ACCESS_TOKEN_TTL,
    REFRESH_TOKEN_DAYS,
    signToken,
    verifyToken,
    decodeToken
};
