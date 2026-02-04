const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
require('dotenv').config();

class Database {
    constructor() {
        // Only use PostgreSQL if a DATABASE_URL is explicitly provided
        this.isProduction = !!process.env.DATABASE_URL;
        this.db = null;
        this.pool = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // Start with 1 second
        this.isConnected = false;
        this.connectionPromise = null;
        this.init();
    }

    async init() {
        const connectionString = process.env.DATABASE_URL;
        if (connectionString) {
            try {
                // Close existing pool if it exists
                if (this.pool) {
                    await this.pool.end();
                }

                // PostgreSQL connection for production (Render/Supabase) with Session Pooler settings
                this.pool = new Pool({
                    connectionString,
                    // Enhanced SSL configuration for Supabase/Render
                    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
                    // Optimized connection pool settings for Session Pooler (IPv4 compatible)
                    max: parseInt(process.env.PG_POOL_MAX || '5', 10), // Reduced for Session Pooler
                    min: parseInt(process.env.PG_POOL_MIN || '1', 10), // Minimum connections
                    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '60000', 10), // 1 minute for Session Pooler
                    connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '20000', 10), // 20 seconds
                    acquireTimeoutMillis: parseInt(process.env.PG_ACQUIRE_TIMEOUT || '20000', 10), // 20 seconds
                    // Session Pooler optimized keep-alive settings
                    keepAlive: true,
                    keepAliveInitialDelayMillis: 3000, // 3 seconds
                    // Application name for better monitoring
                    application_name: 'saloony_app_session_pooler',
                    // Query timeout optimized for Session Pooler
                    query_timeout: 25000, // 25 seconds
                    // Statement timeout
                    statement_timeout: 25000 // 25 seconds
                });

                // Enhanced pool event handlers
                this.pool.on('error', (err) => {
                    console.error('🔴 PostgreSQL Pool Error:', err.message, err.code);
                    this.isConnected = false;
                    this.handleConnectionError(err);
                });

                this.pool.on('connect', (client) => {
                    console.log('🟢 PostgreSQL pool: client connected');
                    this.isConnected = true;
                    this.reconnectAttempts = 0; // Reset on successful connection
                    
                    // Set connection parameters for better stability
                    client.query('SET statement_timeout = 30000').catch(err => {
                        console.warn('Failed to set statement_timeout:', err.message);
                    });
                });

                this.pool.on('acquire', (client) => {
                    // Uncomment for debugging: console.log('PostgreSQL pool: client acquired');
                });

                this.pool.on('remove', (client) => {
                    console.log('🟡 PostgreSQL pool: client removed');
                });

                // Test the connection
                await this.testConnection();
                console.log('✅ Using PostgreSQL via DATABASE_URL with enhanced connection pooling');
            } catch (error) {
                console.error('🔴 Failed to initialize PostgreSQL connection:', error.message);
                this.isConnected = false;
                this.handleConnectionError(error);
            }
        } else {
            // SQLite connection for development
            this.db = new sqlite3.Database('saloony.db', (err) => {
                if (err) {
                    console.error('Error opening SQLite database:', err.message);
                } else {
                    console.log('SQLite database connected successfully (saloony.db created/opened).');
                    this.isConnected = true;
                }
            });
            if (process.env.NODE_ENV === 'production') {
                console.warn('DATABASE_URL not set. Falling back to SQLite in production.');
            }
        }
    }

    async testConnection() {
        if (!this.pool) return false;
        try {
            const client = await this.pool.connect();
            await client.query('SELECT 1');
            client.release();
            this.isConnected = true;
            return true;
        } catch (error) {
            console.error('🔴 Connection test failed:', error.message);
            this.isConnected = false;
            throw error;
        }
    }

    async handleConnectionError(error) {
        const shouldReconnect = [
            'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 
            'EHOSTUNREACH', 'ENETUNREACH', '57P01', 'EPIPE'
        ].includes(error.code);

        if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000); // Max 30 seconds
            
            console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`);
            
            setTimeout(async () => {
                try {
                    await this.init();
                } catch (reconnectError) {
                    console.error('🔴 Reconnection failed:', reconnectError.message);
                }
            }, delay);
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('🔴 Max reconnection attempts reached. Manual intervention required.');
        }
    }

    async ensureConnection() {
        if (this.isConnected) return true;
        
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        this.connectionPromise = this.init();
        try {
            await this.connectionPromise;
            return this.isConnected;
        } catch (error) {
            console.error('🔴 Failed to ensure connection:', error.message);
            return false;
        } finally {
            this.connectionPromise = null;
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

    // Unified query method (for SELECT and INSERT...RETURNING) with enhanced retry logic
    async query(sql, params = []) {
        return new Promise(async (resolve, reject) => {
            if (this.isProduction) {
                // Ensure connection before executing query
                const isConnected = await this.ensureConnection();
                if (!isConnected) {
                    reject(new Error('Database connection unavailable'));
                    return;
                }

                // PostgreSQL query with enhanced retry logic
                const executeQuery = async (retryCount = 0) => {
                    try {
                        const result = await this.pool.query(sql, params);
                        resolve(result.rows);
                    } catch (err) {
                        console.error(`🔴 PostgreSQL Query Error (attempt ${retryCount + 1}):`, err.code, err.message, "SQL:", sql.substring(0, 100) + "...", "Params:", params);
                        
                        // Check if this is a connection error that should trigger retry
                        const shouldRetry = [
                            'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND',
                            'EHOSTUNREACH', 'ENETUNREACH', '57P01', 'EPIPE', 'ECONNABORTED'
                        ].includes(err.code);
                        
                        if (shouldRetry && retryCount < 3) {
                            this.isConnected = false;
                            const delay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Exponential backoff, max 5s
                            console.log(`🔄 Retrying query in ${delay}ms (attempt ${retryCount + 1}/3)...`);
                            
                            setTimeout(async () => {
                                // Try to reconnect before retry
                                await this.ensureConnection();
                                executeQuery(retryCount + 1);
                            }, delay);
                            return;
                        }
                        
                        // If not retryable or max retries reached
                        this.handleConnectionError(err);
                        reject(err);
                    }
                };
                
                executeQuery();
            } else {
                // SQLite query
                this.db.all(sql, params, (err, rows) => {
                    if (err) {
                        console.error('SQLite Query Error:', err.message, "SQL:", sql);
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                });
            }
        });
    }

    // Get single row (for SELECT/INSERT...RETURNING 1 row) with enhanced retry logic
    async get(sql, params = []) {
        return new Promise(async (resolve, reject) => {
            if (this.isProduction) {
                // Ensure connection before executing query
                const isConnected = await this.ensureConnection();
                if (!isConnected) {
                    reject(new Error('Database connection unavailable'));
                    return;
                }

                // PostgreSQL query with retry logic
                const executeQuery = async (retryCount = 0) => {
                    try {
                        const result = await this.pool.query(sql, params);
                        resolve(result.rows[0] || null);
                    } catch (err) {
                        console.error(`🔴 PostgreSQL Get Error (attempt ${retryCount + 1}):`, err.code, err.message, "SQL:", sql.substring(0, 100) + "...", "Params:", params);
                        
                        // Check if this is a connection error that should trigger retry
                        const shouldRetry = [
                            'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND',
                            'EHOSTUNREACH', 'ENETUNREACH', '57P01', 'EPIPE', 'ECONNABORTED'
                        ].includes(err.code);
                        
                        if (shouldRetry && retryCount < 3) {
                            this.isConnected = false;
                            const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
                            console.log(`🔄 Retrying get query in ${delay}ms (attempt ${retryCount + 1}/3)...`);
                            
                            setTimeout(async () => {
                                await this.ensureConnection();
                                executeQuery(retryCount + 1);
                            }, delay);
                            return;
                        }
                        
                        this.handleConnectionError(err);
                        reject(err);
                    }
                };
                
                executeQuery();
            } else {
                // SQLite query
                this.db.get(sql, params, (err, row) => {
                    if (err) {
                        console.error('SQLite Get Error:', err.message, "SQL:", sql);
                        reject(err);
                    } else {
                        resolve(row || null);
                    }
                });
            }
        });
    }

    // Run query (for INSERT, UPDATE, DELETE without returning data) with enhanced retry logic
    async run(sql, params = []) {
        return new Promise(async (resolve, reject) => {
            if (this.isProduction) {
                // Ensure connection before executing query
                const isConnected = await this.ensureConnection();
                if (!isConnected) {
                    reject(new Error('Database connection unavailable'));
                    return;
                }

                // PostgreSQL query with retry logic
                const executeQuery = async (retryCount = 0) => {
                    try {
                        const result = await this.pool.query(sql, params);
                        resolve({
                            lastID: result.rows && result.rows[0] && result.rows[0].id ? result.rows[0].id : null,
                            changes: result.rowCount || 0,
                            rowCount: result.rowCount || 0
                        });
                    } catch (err) {
                        console.error(`🔴 PostgreSQL Run Error (attempt ${retryCount + 1}):`, err.code, err.message, "SQL:", sql.substring(0, 100) + "...", "Params:", params);
                        
                        // Check if this is a connection error that should trigger retry
                        const shouldRetry = [
                            'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND',
                            'EHOSTUNREACH', 'ENETUNREACH', '57P01', 'EPIPE', 'ECONNABORTED'
                        ].includes(err.code);
                        
                        if (shouldRetry && retryCount < 3) {
                            this.isConnected = false;
                            const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
                            console.log(`🔄 Retrying run query in ${delay}ms (attempt ${retryCount + 1}/3)...`);
                            
                            setTimeout(async () => {
                                await this.ensureConnection();
                                executeQuery(retryCount + 1);
                            }, delay);
                            return;
                        }
                        
                        this.handleConnectionError(err);
                        reject(err);
                    }
                };
                
                executeQuery();
            } else {
                // SQLite query
                this.db.run(sql, params, function(err) {
                    if (err) {
                        console.error('SQLite Run Error:', err.message, "SQL:", sql);
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

    // Close connection with proper cleanup
    async close() {
        try {
            if (this.isProduction && this.pool) {
                console.log('🔄 Closing PostgreSQL connection pool...');
                await this.pool.end();
                console.log('✅ PostgreSQL connection pool closed');
            } else if (this.db) {
                console.log('🔄 Closing SQLite database...');
                this.db.close((err) => {
                    if (err) {
                        console.error('Error closing SQLite database:', err.message);
                    } else {
                        console.log('✅ SQLite database closed');
                    }
                });
            }
            this.isConnected = false;
        } catch (error) {
            console.error('🔴 Error closing database connection:', error.message);
        }
    }
}

module.exports = new Database();
