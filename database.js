const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
require('dotenv').config();

class Database {
    constructor() {
        // Only use PostgreSQL if a DATABASE_URL is explicitly provided
        this.isProduction = !!process.env.DATABASE_URL;
        this.db = null;
        this.pool = null;
        this.init();
    }

    init() {
        const connectionString = process.env.DATABASE_URL;
        if (connectionString) {
            // PostgreSQL connection for production (Render/Supabase)
            this.pool = new Pool({
                connectionString,
                // Ensure SSL is handled correctly for Render/Supabase
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
                // Stabilize connections in serverless/managed environments
                max: parseInt(process.env.PG_POOL_MAX || '20', 10),
                idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '300000', 10), // 5 minutes instead of 30 seconds
                connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '10000', 10),
                acquireTimeoutMillis: parseInt(process.env.PG_ACQUIRE_TIMEOUT || '60000', 10), // 1 minute to acquire connection
                keepAlive: true,
                keepAliveInitialDelayMillis: 10000 // 10 seconds
            });
            // Pool diagnostics for production stability
            this.pool.on('error', (err) => {
                console.error('PostgreSQL Pool Error:', err.message);
                // Attempt to reconnect on critical errors
                if (err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
                    console.log('Attempting to reinitialize pool due to connection error...');
                    setTimeout(() => this.init(), 5000);
                }
            });
            this.pool.on('connect', (client) => {
                console.log('PostgreSQL pool: client connected');
                // Set connection parameters for better stability
                client.query('SET statement_timeout = 30000'); // 30 second query timeout
            });
            this.pool.on('acquire', () => {
                // console.log('PostgreSQL pool: client acquired');
            });
            this.pool.on('remove', (client) => {
                console.log('PostgreSQL pool: client removed');
            });
            console.log('Using PostgreSQL via DATABASE_URL');
        } else {
            // SQLite connection for development
            this.db = new sqlite3.Database('saloony.db', (err) => {
                if (err) {
                    console.error('Error opening SQLite database:', err.message);
                } else {
                    console.log('SQLite database connected successfully (saloony.db created/opened).');
                }
            });
            if (process.env.NODE_ENV === 'production') {
                console.warn('DATABASE_URL not set. Falling back to SQLite in production.');
            }
        }
    }

    async ping() {
        try {
            const rows = await this.query('SELECT NOW() as now');
            return { ok: true, now: rows && rows[0] && rows[0].now };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    // Unified query method (for SELECT and INSERT...RETURNING)
    async query(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isProduction) {
                // PostgreSQL query with retry logic
                const executeQuery = (retryCount = 0) => {
                    this.pool.query(sql, params, (err, result) => {
                        if (err) {
                            console.error("PostgreSQL Query Error:", err.code, err.message, "SQL:", sql, "Params:", params);
                            
                            // Retry on connection errors
                            if ((err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === '57P01') && retryCount < 3) {
                                console.log(`Retrying query (attempt ${retryCount + 1}/3)...`);
                                setTimeout(() => executeQuery(retryCount + 1), 1000 * (retryCount + 1));
                                return;
                            }
                            
                            reject(err);
                        } else {
                            // Return the array of rows (for dbAll in server.js)
                            resolve(result.rows);
                        }
                    });
                };
                executeQuery();
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
