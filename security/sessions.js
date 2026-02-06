const db = require('../assets/database');

/**
 * Clean expired sessions from the database.
 * @returns {Promise<void>}
 */
async function cleanExpiredSessions() {
    try {
        await db.run('DELETE FROM role_sessions WHERE expires_at < CURRENT_TIMESTAMP');
    } catch (error) {
        console.error('Error cleaning expired sessions:', error);
    }
}

module.exports = {
    cleanExpiredSessions
};
