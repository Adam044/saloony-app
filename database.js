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

    // Unified query method that works with both SQLite and PostgreSQL
    async query(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isProduction) {
                // PostgreSQL query
                this.pool.query(sql, params, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
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

    // Get single row
    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isProduction) {
                // PostgreSQL query
                this.pool.query(sql, params, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
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

    // Run query (for INSERT, UPDATE, DELETE)
    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isProduction) {
                // PostgreSQL query
                this.pool.query(sql, params, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({
                            lastID: result.insertId || null,
                            changes: result.rowCount || 0
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