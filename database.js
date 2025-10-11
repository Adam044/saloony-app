const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
require('dotenv').config();

class Database {
    constructor() {
        this.isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL;
        this.db = null;
        this.pool = null;
        this.init();
    }

    init() {
        if (this.isProduction) {
            // PostgreSQL connection for production (Supabase)
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                // Ensure SSL is handled correctly for Render/Supabase
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });
            console.log('Connected to PostgreSQL database (Supabase)');
        } else {
            // SQLite connection for development
            this.db = new sqlite3.Database('saloony.db', (err) => {
                if (err) {
                    console.error('Error opening SQLite database:', err.message);
                } else {
                    console.log('SQLite database connected successfully (saloony.db created/opened).');
                }
            });
        }
    }

    // Unified query method (for SELECT and INSERT...RETURNING)
    async query(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isProduction) {
                // PostgreSQL query
                this.pool.query(sql, params, (err, result) => {
                    if (err) {
                        // CRITICAL FIX: Log the full PostgreSQL error for debugging
                        console.error("PostgreSQL Query Error:", err.code, err.message, "SQL:", sql, "Params:", params);
                        reject(err);
                    } else {
                        // Return the array of rows (for dbAll in server.js)
                        resolve(result.rows);
                    }
                });
            } else {
                // SQLite query
                this.db.all(sql, params, (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                });
            }
        });
    }

    // Get single row (for SELECT/INSERT...RETURNING 1 row)
    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isProduction) {
                // PostgreSQL query
                this.pool.query(sql, params, (err, result) => {
                    if (err) {
                        // CRITICAL FIX: Log the full PostgreSQL error for debugging
                        console.error("PostgreSQL Get Error:", err.code, err.message, "SQL:", sql, "Params:", params);
                        reject(err);
                    } else {
                        // Return the first row (used by dbGet in server.js)
                        resolve(result.rows[0] || null);
                    }
                });
            } else {
                // SQLite query
                this.db.get(sql, params, (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row || null);
                    }
                });
            }
        });
    }

    // Run query (for INSERT, UPDATE, DELETE without returning data, usually)
    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isProduction) {
                // PostgreSQL query
                this.pool.query(sql, params, (err, result) => {
                    if (err) {
                        // CRITICAL FIX: Log the full PostgreSQL error for debugging
                        console.error("PostgreSQL Run Error:", err.code, err.message, "SQL:", sql, "Params:", params);
                        reject(err);
                    } else {
                        // FIX: Ensure lastID is only returned if it's explicitly retrieved
                        resolve({
                            lastID: result.rows && result.rows[0] && result.rows[0].id ? result.rows[0].id : null,
                            changes: result.rowCount || 0,
                            rowCount: result.rowCount || 0
                        });
                    }
                });
            } else {
                // SQLite query
                this.db.run(sql, params, function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({
                            lastID: this.lastID,
                            changes: this.changes
                        });
                    }
                });
            }
        });
    }

    // Serialize method for SQLite compatibility
    serialize(callback) {
        if (this.isProduction) {
            // For PostgreSQL, just execute the callback
            callback();
        } else {
            // For SQLite, use serialize
            this.db.serialize(callback);
        }
    }

    // Close connection
    close() {
        if (this.isProduction && this.pool) {
            this.pool.end();
        } else if (this.db) {
            this.db.close();
        }
    }
}

module.exports = new Database();
