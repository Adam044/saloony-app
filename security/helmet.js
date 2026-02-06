const helmet = require('helmet');

/**
 * Configure Helmet security headers.
 * @returns {Function} - The configured helmet middleware.
 */
function configureHelmet() {
    return helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                'default-src': ["'self'"],
                // Allow required external CDNs and inline scripts to preserve current look
                'script-src': [
                    "'self'",
                    'chrome-extension:',
                    'https://cdn.tailwindcss.com',
                    'https://www.googletagmanager.com',
                    'https://cdnjs.cloudflare.com',
                    'https://cdn.jsdelivr.net',
                    "'unsafe-inline'"
                ],
                'worker-src': [
                    "'self'",
                    'blob:'
                ],
                // Match script-src for script elements explicitly
                'script-src-elem': [
                    "'self'",
                    'chrome-extension:',
                    'https://cdn.tailwindcss.com',
                    'https://www.googletagmanager.com',
                    'https://cdnjs.cloudflare.com',
                    'https://cdn.jsdelivr.net',
                    'https://unpkg.com',
                    "'unsafe-inline'"
                ],
                // Permit external styles (Google Fonts) and inline style blocks
                'style-src': [
                    "'self'",
                    'chrome-extension:',
                    'https://fonts.googleapis.com',
                    'https://cdnjs.cloudflare.com',
                    "'unsafe-inline'"
                ],
                // Match style-src for style elements explicitly
                'style-src-elem': [
                    "'self'",
                    'chrome-extension:',
                    'https://fonts.googleapis.com',
                    'https://cdnjs.cloudflare.com',
                    'https://unpkg.com',
                    "'unsafe-inline'"
                ],
                // Permit font loading from Google Fonts
                'font-src': [
                    "'self'",
                    'https://fonts.gstatic.com',
                    'https://cdnjs.cloudflare.com',
                    'data:'
                ],
                // Images may come from local files and data URLs
                'img-src': [
                    "'self'",
                    'chrome-extension:',
                    'data:',
                    'blob:',
                    'https://*.googleusercontent.com',
                    'https:',
                    'https://tile.openstreetmap.org',
                    'https://demotiles.maplibre.org',
                    'https://ogmap.com',
                    'https://tiles.ogmap.com'
                ].concat((process.env.MAP_TILE_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)),
                // Allow inline event handlers to preserve current behavior
                'script-src-attr': ["'unsafe-inline'"],
                // Network requests restricted to same origin by default
                'connect-src': [
                    "'self'",
                    'chrome-extension:',
                    'https://www.google-analytics.com',
                    'https://region1.google-analytics.com',
                    'https://www.googletagmanager.com',
                    'https://stats.g.doubleclick.net',
                    'https://cdn.tailwindcss.com',
                    'https://cdnjs.cloudflare.com',
                    'https://cdn.jsdelivr.net',
                    'https://unpkg.com',
                    'https://fonts.googleapis.com',
                    'https://fonts.gstatic.com',
                    'https://nominatim.openstreetmap.org',
                    'https://*.supabase.co',
                    'https://demotiles.maplibre.org',
                    'https://ogmap.com',
                    'https://tiles.ogmap.com',
                    'ws:',
                    'wss:'
                ].concat((process.env.MAP_TILE_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)),
            }
        },
        frameguard: { action: 'deny' },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    });
}

module.exports = {
    configureHelmet
};
