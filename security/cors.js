const cors = require('cors');

/**
 * Get the list of allowed origins from environment variables.
 * @returns {string[]} - Array of allowed origin strings.
 */
function getAllowedOrigins() {
    return (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Configure CORS middleware.
 * @returns {Function} - The configured CORS middleware.
 */
function configureCors() {
    const allowedOrigins = getAllowedOrigins();
    
    return cors({
        origin: function(origin, callback) {
            // Allow same-origin or non-browser requests
            if (!origin) return callback(null, true);
            if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
        methods: ['GET','POST','PUT','DELETE','OPTIONS'],
        allowedHeaders: ['Content-Type','Authorization']
    });
}

module.exports = {
    configureCors,
    getAllowedOrigins
};
