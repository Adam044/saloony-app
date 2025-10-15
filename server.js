// Server.js - Salonni Application Backend
const express = require('express');
const http = require('http');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors'); // Added CORS for development ease
const crypto = require('crypto'); // Used for generating simple tokens/salts
const bcrypt = require('bcrypt'); // Secure password hashing
const compression = require('compression'); // Enable gzip compression for responses
const db = require('./database'); // Import our database module
const nodemailer = require('nodemailer'); // Email sending for Contact Us
const webPush = require('web-push'); // Web Push notifications
require('dotenv').config(); // Load environment variables (.env)

const app = express();
let io; // Socket.IO instance (initialized after HTTP server creation)
// FIXED: Corrected typo from process.env.env.PORT to process.env.PORT
const PORT = process.env.PORT || 3001; 

// Configure Web Push VAPID details
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BOr2bZzWZ_placeholder_public_key_for_dev';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '9PZ_placeholder_private_key_for_dev';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@saloony.app';
try {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (e) {
    console.warn('WebPush VAPID setup warning:', e.message);
}

// --- Core Data: Master Service List & Cities ---
const MASTER_SERVICES = require('./services');

const CITIES = [
    'القدس', 'رام الله', 'الخليل', 'نابلس', 'بيت لحم', 'غزة',
    'جنين', 'طولكرم', 'قلقيلية', 'أريحا', 'رفح', 'خان يونس',
    'دير البلح', 'الناصرة', 'حيفا', 'عكا', 'طبريا', 'صفد'
];

// Helper function to hash passwords securely using bcrypt
async function hashPassword(password) {
    const saltRounds = 12; // Higher salt rounds for better security
    return await bcrypt.hash(password, saltRounds);
}

// Helper function to verify passwords
async function verifyPassword(password, hashedPassword) {
    return await bcrypt.compare(password, hashedPassword);
}

// Validate phone number format (must start with 0 and be exactly 9 digits)
function validatePhoneFormat(phone) {
    if (!phone) return true; // Allow empty for optional fields
    const phonePattern = /^0[0-9]{8}$/;
    return phonePattern.test(phone);
}

// Normalize phone numbers to a canonical form for duplicate checks and login.
// Strategy:
// - Remove all non-digits
// - Strip leading international prefixes and country codes (00, +970, +972)
// - Strip trunk leading zero
// - Compare by last 9 digits (operator+subscriber), which unifies formats like:
//   0594444403, +970594444403, +972594444403, 594444403
function normalizePhoneNumber(input) {
    if (!input) return '';
    let digits = String(input).replace(/\D/g, '');
    // Remove international call prefix like '00'
    if (digits.startsWith('00')) digits = digits.replace(/^00+/, '');
    // Remove common country codes used in our region
    if (digits.startsWith('970')) digits = digits.slice(3);
    else if (digits.startsWith('972')) digits = digits.slice(3);
    // Remove local trunk prefix '0'
    if (digits.startsWith('0')) digits = digits.slice(1);
    // Unify to last 9 digits
    if (digits.length > 9) digits = digits.slice(-9);
    return digits;
}

// Helper functions using our database module
const dbAll = (sql, params = []) => db.query(sql, params);
const dbGet = (sql, params = []) => db.get(sql, params);
const dbRun = (sql, params = []) => db.run(sql, params);

// Initialize database schema and insert master data
async function initializeDb() {
    console.log("Initializing database schema...");
    
    try {
        // Create users table - single source of authentication
        await db.run(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            gender TEXT,
            city TEXT,
            password TEXT NOT NULL,
            strikes INTEGER DEFAULT 0,
            user_type TEXT DEFAULT 'user'
        )`);
        
        // Create salons table - Linked to users by user_id, no redundant email/password
        await db.run(`CREATE TABLE IF NOT EXISTS salons (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL, 
            salon_name TEXT NOT NULL,
            owner_name TEXT NOT NULL,
            salon_phone TEXT NOT NULL,
            owner_phone TEXT NOT NULL,
            address TEXT NOT NULL,
            city TEXT NOT NULL,
            gender_focus TEXT NOT NULL,
            image_url TEXT,
            status TEXT DEFAULT 'pending',
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        
        await db.run(`CREATE TABLE IF NOT EXISTS services (
            id SERIAL PRIMARY KEY,
            name_ar TEXT NOT NULL,
            icon TEXT NOT NULL,
            gender TEXT NOT NULL,
            service_type TEXT NOT NULL DEFAULT 'main',
            UNIQUE(name_ar, gender)
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            rating INTEGER NOT NULL,
            comment TEXT,
            date_posted TEXT NOT NULL,
            UNIQUE (salon_id, user_id),
            FOREIGN KEY (salon_id) REFERENCES salons(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS salon_services (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            service_id INTEGER NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            duration INTEGER NOT NULL,
            UNIQUE (salon_id, service_id),
            FOREIGN KEY (salon_id) REFERENCES salons(id),
            FOREIGN KEY (service_id) REFERENCES services(id)
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS staff (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            FOREIGN KEY (salon_id) REFERENCES salons(id)
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS schedules (
            salon_id INTEGER PRIMARY KEY,
            opening_time TEXT NOT NULL,
            closing_time TEXT NOT NULL,
            closed_days TEXT,
            FOREIGN KEY (salon_id) REFERENCES salons(id)
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS breaks (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            staff_id INTEGER,
            reason TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            FOREIGN KEY (salon_id) REFERENCES salons(id),
            FOREIGN KEY (staff_id) REFERENCES staff(id)
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS appointments (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            staff_id INTEGER,
            service_id INTEGER NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Scheduled',
            date_booked TEXT NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            FOREIGN KEY (salon_id) REFERENCES salons(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (staff_id) REFERENCES staff(id),
            FOREIGN KEY (service_id) REFERENCES services(id)
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS appointment_services (
            id SERIAL PRIMARY KEY,
            appointment_id INTEGER NOT NULL,
            service_id INTEGER NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
            FOREIGN KEY (service_id) REFERENCES services(id),
            UNIQUE(appointment_id, service_id)
        )`); 
        
        // Push subscriptions table
        await db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            salon_id INTEGER,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_active TIMESTAMP,
            UNIQUE(endpoint),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
        )`);

        // Reminders sent log to avoid duplicate sends
        await db.run(`CREATE TABLE IF NOT EXISTS reminders_sent (
            id SERIAL PRIMARY KEY,
            appointment_id INTEGER NOT NULL,
            reminder_type TEXT NOT NULL, -- e.g., 'upcoming_1h', 'upcoming_24h'
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(appointment_id, reminder_type),
            FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
        )`);
        
        await db.run(`CREATE TABLE IF NOT EXISTS favorites (
            user_id INTEGER NOT NULL,
            salon_id INTEGER NOT NULL,
            PRIMARY KEY (user_id, salon_id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (salon_id) REFERENCES salons(id)
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS schedule_modifications (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            mod_type TEXT NOT NULL,
            mod_date TEXT,
            mod_day_index INTEGER,
            start_time TEXT,
            end_time TEXT,
            reason TEXT NOT NULL,
            staff_id INTEGER,
            closure_type TEXT,
            FOREIGN KEY (salon_id) REFERENCES salons(id),
            FOREIGN KEY (staff_id) REFERENCES staff(id)
        )`);

        console.log("Database schema created successfully.");
        
        // Insert master services if they don't exist
        await insertMasterServices();
        
    } catch (error) {
        console.error("Error initializing database:", error);
        throw error;
    }
}

// Align existing database schema (especially for production/PostgreSQL)
// Ensures salons table has expected columns and constraints used by the server code
async function alignSchema() {
    try {
        if (db.isProduction) {
            // PostgreSQL alignment (information_schema introspection)
            const columns = await db.query(
                `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2`,
                ['salons', 'public']
            );

            const columnSet = new Set(columns.map(c => c.column_name));

            // 1) Add user_id column if missing
            if (!columnSet.has('user_id')) {
                console.log('AlignSchema: Adding user_id column to salons (PostgreSQL)...');
                await db.run(`ALTER TABLE salons ADD COLUMN user_id INTEGER UNIQUE`);
                // Add FK constraint linking to users(id) if not present
                const fkCheck = await db.query(
                    `SELECT conname FROM pg_constraint WHERE conrelid = 'salons'::regclass AND conname = $1`,
                    ['fk_salons_user']
                );
                if (!fkCheck || fkCheck.length === 0) {
                    await db.run(`ALTER TABLE salons ADD CONSTRAINT fk_salons_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`);
                }
            }

            // 2) Relax NOT NULL on email/password columns if they exist (older schema)
            if (columnSet.has('email')) {
                const emailCol = columns.find(c => c.column_name === 'email');
                if (emailCol && emailCol.is_nullable === 'NO') {
                    console.log('AlignSchema: Relaxing NOT NULL on salons.email (PostgreSQL)...');
                    await db.run(`ALTER TABLE salons ALTER COLUMN email DROP NOT NULL`);
                }
            }
            if (columnSet.has('password')) {
                const passCol = columns.find(c => c.column_name === 'password');
                if (passCol && passCol.is_nullable === 'NO') {
                    console.log('AlignSchema: Relaxing NOT NULL on salons.password (PostgreSQL)...');
                    await db.run(`ALTER TABLE salons ALTER COLUMN password DROP NOT NULL`);
                }
            }

            // 3) Ensure status column exists with default
            if (!columnSet.has('status')) {
                console.log('AlignSchema: Adding status column to salons (PostgreSQL)...');
                await db.run(`ALTER TABLE salons ADD COLUMN status TEXT DEFAULT 'pending'`);
            }

            // 4) Relax NOT NULL on users.gender to allow NULL for salon-linked users
            const userColumns = await db.query(
                `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2`,
                ['users', 'public']
            );
            const userGender = userColumns.find(c => c.column_name === 'gender');
            if (userGender && userGender.is_nullable === 'NO') {
                console.log('AlignSchema: Relaxing NOT NULL on users.gender (PostgreSQL)...');
                await db.run(`ALTER TABLE users ALTER COLUMN gender DROP NOT NULL`);
            }

            // Ensure schedule_modifications has closure_type and backfill
            const modColumns = await db.query(
                `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2`,
                ['schedule_modifications', 'public']
            );
            const modColSet = new Set(modColumns.map(c => c.column_name));
            if (!modColSet.has('closure_type')) {
                console.log('AlignSchema: Adding closure_type to schedule_modifications (PostgreSQL)...');
                await db.run(`ALTER TABLE schedule_modifications ADD COLUMN closure_type TEXT`);
                // Derive closure_type from presence of times; default to full_day if no times
                await db.run(`UPDATE schedule_modifications SET closure_type = CASE WHEN start_time IS NOT NULL AND end_time IS NOT NULL THEN 'interval' ELSE 'full_day' END WHERE closure_type IS NULL OR closure_type = ''`);
            }

            // Ensure breaks has reason column
            const breakColumns = await db.query(
                `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2`,
                ['breaks', 'public']
            );
            const breakColSet = new Set(breakColumns.map(c => c.column_name));
            if (!breakColSet.has('reason')) {
                console.log('AlignSchema: Adding reason to breaks (PostgreSQL)...');
                await db.run(`ALTER TABLE breaks ADD COLUMN reason TEXT`);
            }
        } else {
            // SQLite alignment (PRAGMA introspection)
            const pragmaRows = await db.query(`PRAGMA table_info(salons)`);
            const columnSet = new Set(pragmaRows.map(r => r.name));

            // If schema already matches (has user_id and status), skip
            const hasUserId = columnSet.has('user_id');
            const hasStatus = columnSet.has('status');

            if (hasUserId && hasStatus) {
                console.log('AlignSchema: SQLite salons schema already aligned.');
            } else {
                // Check if table is empty; if empty, drop and recreate cleanly
                const cntRows = await db.query(`SELECT COUNT(*) as cnt FROM salons`);
                const cnt = cntRows && cntRows[0] ? (cntRows[0].cnt || cntRows[0].COUNT || 0) : 0;

                if (Number(cnt) === 0) {
                    console.log('AlignSchema: Recreating salons table with correct schema (SQLite, empty table)...');
                    await db.run(`DROP TABLE IF EXISTS salons`);
                    await db.run(`CREATE TABLE IF NOT EXISTS salons (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER UNIQUE NOT NULL,
                        salon_name TEXT NOT NULL,
                        owner_name TEXT NOT NULL,
                        salon_phone TEXT NOT NULL,
                        owner_phone TEXT NOT NULL,
                        address TEXT NOT NULL,
                        city TEXT NOT NULL,
                        gender_focus TEXT NOT NULL,
                        image_url TEXT,
                        status TEXT DEFAULT 'pending',
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                    )`);
                    console.log('AlignSchema: SQLite salons schema recreated successfully.');
                } else {
                    console.warn('AlignSchema: SQLite salons table has data; skipping destructive migration.');
                    // Non-destructive tweaks: add status if missing
                    if (!hasStatus) {
                        await db.run(`ALTER TABLE salons ADD COLUMN status TEXT DEFAULT 'pending'`);
                    }
                    // user_id cannot be safely added as NOT NULL with data present; require manual migration
                }
            }

            // SQLite: Ensure users.gender is nullable; if table empty and gender is NOT NULL, recreate
            const usersPragma = await db.query(`PRAGMA table_info(users)`);
            const usersCols = new Map(usersPragma.map(r => [r.name, r]));
            const genderInfo = usersCols.get('gender');
            if (genderInfo && genderInfo.notnull === 1) {
                const cntUsersRows = await db.query(`SELECT COUNT(*) as cnt FROM users`);
                const ucnt = cntUsersRows && cntUsersRows[0] ? (cntUsersRows[0].cnt || cntUsersRows[0].COUNT || 0) : 0;
                if (Number(ucnt) === 0) {
                    console.log('AlignSchema: Recreating users table with gender nullable (SQLite, empty table)...');
                    await db.run(`DROP TABLE IF EXISTS users`);
                    await db.run(`CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        email TEXT UNIQUE NOT NULL,
                        phone TEXT,
                        gender TEXT,
                        city TEXT,
                        password TEXT NOT NULL,
                        strikes INTEGER DEFAULT 0,
                        user_type TEXT DEFAULT 'user'
                    )`);
                    console.log('AlignSchema: SQLite users schema recreated successfully.');
                } else {
                    console.warn('AlignSchema: users table has data and gender NOT NULL; manual migration needed to relax constraint.');
                }
            }

            // SQLite: Ensure schedule_modifications has closure_type and backfill
            const modsPragma = await db.query(`PRAGMA table_info(schedule_modifications)`);
            const modsCols = new Set(modsPragma.map(r => r.name));
            if (!modsCols.has('closure_type')) {
                console.log('AlignSchema: Adding closure_type to schedule_modifications (SQLite)...');
                await db.run(`ALTER TABLE schedule_modifications ADD COLUMN closure_type TEXT`);
                await db.run(`UPDATE schedule_modifications SET closure_type = CASE WHEN start_time IS NOT NULL AND end_time IS NOT NULL THEN 'interval' ELSE 'full_day' END WHERE closure_type IS NULL OR closure_type = ''`);
            }

            // SQLite: Ensure breaks has reason column
            const breaksPragma = await db.query(`PRAGMA table_info(breaks)`);
            const breaksCols = new Set(breaksPragma.map(r => r.name));
            if (!breaksCols.has('reason')) {
                console.log('AlignSchema: Adding reason to breaks (SQLite)...');
                await db.run(`ALTER TABLE breaks ADD COLUMN reason TEXT`);
            }
        }

        console.log('AlignSchema: Schema alignment completed successfully.');
    } catch (error) {
        console.error('AlignSchema error:', error.message || error);
    }
}

// Insert master services into the database
async function insertMasterServices() {
    try {
        for (const gender of ['men', 'women']) {
            for (const service of MASTER_SERVICES[gender]) {
                await db.run(
                    `INSERT INTO services (name_ar, icon, gender, service_type) 
                     VALUES ($1, $2, $3, $4) 
                     ON CONFLICT (name_ar, gender) DO NOTHING`,
                    [service.name_ar, service.icon, gender, service.service_type]
                );
            }
        }
        console.log("Master services inserted successfully.");
    } catch (error) {
        console.error("Error inserting master services:", error);
    }
}

// Automatic appointment status update system (DISABLED)
// Requirement: Do not auto-complete appointments. Status changes are manual.
async function autoUpdateAppointmentStatuses() {
    // Disabled: no automatic status updates.
    return;
}

// Auto status updates disabled
// setInterval(autoUpdateAppointmentStatuses, 5 * 60 * 1000);
// setTimeout(autoUpdateAppointmentStatuses, 5000);

// Middleware setup
app.use(cors()); // Allow all CORS requests
app.use(compression()); // Compress all responses to improve load times
app.use(bodyParser.json({ limit: '50mb' })); // Increased limit for image_url
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files (views, Images)
// Serve static assets with mild caching for images; keep HTML no-cache via discovery route headers
app.use('/', express.static(path.join(__dirname, 'views'), { etag: true }));
app.use('/images', express.static(path.join(__dirname, 'Images'), { maxAge: '1d', etag: true }));
// Serve notification sounds
app.use('/sounds', express.static(path.join(__dirname, 'Sounds'), { maxAge: '7d', etag: true }));

// Root route should serve index for browser launches
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// ===============================
// Push Notification Endpoints
// ===============================
// Expose VAPID public key for clients
app.get('/api/push/public-key', (req, res) => {
    res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

// Subscribe endpoint: store subscription for a user or salon
app.post('/api/push/subscribe', async (req, res) => {
    try {
        const { user_id, salon_id } = req.body;
        // Accept both new style { subscription } and legacy { endpoint, keys }
        let subscription = req.body.subscription;
        if (!subscription && req.body.endpoint && req.body.keys) {
            subscription = { endpoint: req.body.endpoint, keys: req.body.keys };
        }
        if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
            console.warn('Subscribe rejected: invalid payload', { hasSub: !!subscription, endpoint: subscription?.endpoint, keys: subscription?.keys ? Object.keys(subscription.keys) : [] });
            return res.status(400).json({ success: false, message: 'Invalid subscription payload.' });
        }

        const endpoint = subscription.endpoint;
        const p256dh = subscription.keys.p256dh;
        const auth = subscription.keys.auth;

        // Upsert by endpoint uniqueness
        const existing = await dbGet('SELECT id FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
        if (existing) {
            await dbRun('UPDATE push_subscriptions SET user_id = $1, salon_id = $2, p256dh = $3, auth = $4, last_active = CURRENT_TIMESTAMP WHERE id = $5', [user_id || null, salon_id || null, p256dh, auth, existing.id]);
            console.log('Push subscription updated', { endpoint, user_id: user_id || null, salon_id: salon_id || null, id: existing.id });
        } else {
            await dbRun('INSERT INTO push_subscriptions (user_id, salon_id, endpoint, p256dh, auth, last_active) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)', [user_id || null, salon_id || null, endpoint, p256dh, auth]);
            console.log('Push subscription inserted', { endpoint, user_id: user_id || null, salon_id: salon_id || null });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Push subscribe error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to save subscription.' });
    }
});

// Unsubscribe endpoint: remove subscription by endpoint
app.post('/api/push/unsubscribe', async (req, res) => {
    try {
        const { endpoint } = req.body;
        if (!endpoint) {
            return res.status(400).json({ success: false, message: 'Endpoint is required.' });
        }
        await dbRun('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
        res.json({ success: true });
    } catch (err) {
        console.error('Push unsubscribe error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to remove subscription.' });
    }
});

// Debug endpoint: list subscriptions by user or salon
app.get('/api/debug/push-subscriptions', async (req, res) => {
    try {
        const { user_id, salon_id } = req.query;
        let rows = [];
        if (user_id) {
            rows = await dbAll('SELECT id, user_id, salon_id, endpoint, last_active FROM push_subscriptions WHERE user_id = $1', [user_id]);
        } else if (salon_id) {
            rows = await dbAll('SELECT id, user_id, salon_id, endpoint, last_active FROM push_subscriptions WHERE salon_id = $1', [salon_id]);
        } else {
            rows = await dbAll('SELECT id, user_id, salon_id, endpoint, last_active FROM push_subscriptions ORDER BY id DESC LIMIT 50');
        }
        res.json({ success: true, count: rows.length, rows });
    } catch (err) {
        console.error('Debug list subscriptions error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to list subscriptions.' });
    }
});

// Test endpoint: send a sample push notification to a user or salon
app.post('/api/push/test', async (req, res) => {
    try {
        const { user_id, salon_id, title, body, url, tag } = req.body || {};
        if (!user_id && !salon_id) {
            return res.status(400).json({ success: false, message: 'user_id أو salon_id مطلوب.' });
        }
        const payload = {
            title: title || 'اختبار الإشعارات',
            body: body || 'هذا إشعار تجريبي من Saloony.',
            url: url || (user_id ? '/home_user.html' : '/home_salon.html'),
            tag: tag || 'saloony-test'
        };
        await sendPushToTargets({ user_id, salon_id, payload });
        res.json({ success: true, message: 'تم إرسال الإشعار التجريبي.' });
    } catch (err) {
        console.error('Push test error:', err.message);
        res.status(500).json({ success: false, message: 'فشل إرسال الإشعار التجريبي.' });
    }
});

// Helper to send a push notification to all subscriptions for a user or salon
async function sendPushToTargets({ user_id, salon_id, payload }) {
    try {
        let rows;
        if (user_id) {
            rows = await dbAll('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [user_id]);
        } else if (salon_id) {
            rows = await dbAll('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE salon_id = $1', [salon_id]);
        } else {
            return;
        }
        console.log('sendPushToTargets: subscriptions found', { user_id: user_id || null, salon_id: salon_id || null, count: rows ? rows.length : 0 });
        if (!rows || rows.length === 0) return;

        const payloadStr = JSON.stringify(payload);
        await Promise.all(rows.map(async (row) => {
            const sub = {
                endpoint: row.endpoint,
                keys: { p256dh: row.p256dh, auth: row.auth }
            };
            try {
                await webPush.sendNotification(sub, payloadStr);
            } catch (err) {
                // Cleanup gone subscriptions
                if (err.statusCode === 404 || err.statusCode === 410) {
                    try { await dbRun('DELETE FROM push_subscriptions WHERE endpoint = $1', [row.endpoint]); } catch (cleanupErr) {}
                }
                console.warn('Push send failed:', err.message);
            }
        }));
    } catch (err) {
        console.error('sendPushToTargets error:', err.message);
    }
}

// ===================================
// SSE: Real-time salon notifications
// ===================================
// Track connected SSE clients per salon
const salonClients = new Map(); // Map<salonId, Set<res>>

function addSalonClient(salonId, res) {
    const key = String(salonId);
    if (!salonClients.has(key)) salonClients.set(key, new Set());
    salonClients.get(key).add(res);
}

function removeSalonClient(salonId, res) {
    const key = String(salonId);
    if (salonClients.has(key)) {
        const set = salonClients.get(key);
        set.delete(res);
        if (set.size === 0) salonClients.delete(key);
    }
}

function sendSalonEvent(salonId, eventType, payload) {
    const key = String(salonId);
    const clients = salonClients.get(key);
    if (!clients || clients.size === 0) return;
    const data = JSON.stringify({ type: eventType, salonId: Number(salonId), ...payload });
    for (const res of clients) {
        try {
            res.write(`data: ${data}\n\n`);
        } catch (e) {
            // Best-effort: drop on error
            removeSalonClient(salonId, res);
        }
    }
}

// SSE stream for a salon dashboard
app.get('/api/salon/stream/:salon_id', (req, res) => {
    const salonId = req.params.salon_id;
    if (!salonId || isNaN(parseInt(salonId))) {
        return res.status(400).end();
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Disable proxy buffering (useful on some hosts)
    res.setHeader('X-Accel-Buffering', 'no');

    // Initial ping to establish stream on client
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ salonId: Number(salonId) })}\n\n`);

    addSalonClient(salonId, res);

    const heartbeat = setInterval(() => {
        try { res.write(`: heartbeat\n\n`); } catch (e) { /* ignore */ }
    }, 25000);

    req.on('close', () => {
        clearInterval(heartbeat);
        removeSalonClient(salonId, res);
        try { res.end(); } catch (e) { /* ignore */ }
    });
});

// ===================================
// Contact Us
// ===================================
app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, subject, message, phone } = req.body || {};

        // Basic validation
        if (!name || !email || !subject || !message) {
            return res.status(400).json({ success: false, error: 'الرجاء تعبئة جميع الحقول.' });
        }

        const gmailUser = process.env.GMAIL_USER;
        let gmailPass = process.env.GMAIL_APP_PASSWORD;
        // Normalize app password if provided with spaces (Google displays with spaces)
        if (gmailPass) gmailPass = gmailPass.replace(/\s+/g, '');

        if (!gmailUser || !gmailPass) {
            return res.status(500).json({ success: false, error: 'إعدادات البريد غير مكتملة على الخادم.' });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: gmailUser, pass: gmailPass },
            pool: true,
            maxConnections: 2,
            maxMessages: 10,
            secure: true,
            requireTLS: true,
            connectionTimeout: 15000,
            greetingTimeout: 10000,
            socketTimeout: 15000
        });

        // Verify transporter connectivity; surface clear error if failing
        try {
            await transporter.verify();
        } catch (verifyErr) {
            console.error('Nodemailer verify error:', verifyErr);
            return res.status(503).json({ success: false, error: 'خدمة البريد غير متاحة مؤقتًا. حاول لاحقًا.' });
        }

        const toAddress = process.env.CONTACT_TO_EMAIL || gmailUser;
        const fromName = process.env.CONTACT_FROM_NAME || 'Saloony Contact';

        const phoneLineText = phone ? `\nهاتف: ${phone}` : '';
        const phoneLineHtml = phone ? `<p><strong>رقم الهاتف:</strong> ${phone}</p>` : '';

        const mailOptions = {
            from: `${fromName} <${gmailUser}>`,
            to: toAddress,
            replyTo: email,
            subject: `[سوال من الموقع] ${subject}`,
            text: `اسم: ${name}\nبريد: ${email}${phoneLineText}\n\nرسالة:\n${message}`,
            html: `
                <div style="font-family: Tajawal, Arial, sans-serif; line-height:1.7; color:#0f172a">
                  <h2 style="margin:0 0 8px">رسالة جديدة من صفحة التواصل</h2>
                  <p><strong>الاسم:</strong> ${name}</p>
                  <p><strong>البريد:</strong> ${email}</p>
                  ${phoneLineHtml}
                  <p><strong>الموضوع:</strong> ${subject}</p>
                  <hr style="border:none;border-top:1px solid #e2e8f0; margin:12px 0" />
                  <p>${message.replace(/\n/g, '<br/>')}</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        return res.json({ success: true, message: 'تم إرسال الرسالة بنجاح.' });
    } catch (err) {
        console.error('Contact form email send error:', err);
        // Differentiate transient errors
        const isTimeout = /ETIMEDOUT|timed out|Timeout/i.test(err && (err.code || err.message || ''));
        const isAuth = /Invalid login|AUTH|invalid credentials/i.test(err && (err.response || err.message || ''));
        const statusCode = isTimeout ? 503 : (isAuth ? 401 : 500);
        const msg = isTimeout ? 'خدمة البريد غير متاحة مؤقتًا. حاول لاحقًا.' : (isAuth ? 'بيانات البريد غير صحيحة.' : 'فشل إرسال الرسالة. حاول لاحقًا.');
        return res.status(statusCode).json({ success: false, error: msg });
    }
});

// ===================================
// Auth Routes 
// ===================================

// Unified register endpoint
app.post('/api/auth/register', async (req, res) => {
    try {
        const { user_type, name, email, password, phone, city, gender, owner_name, owner_phone, address, gender_focus, image_url } = req.body;
        
        console.log('=== REGISTER REQUEST ===');
        console.log('User type:', user_type);
        console.log('Email:', email);
        
        // Validate phone format
        if (user_type === 'user' && phone && !validatePhoneFormat(phone)) {
            return res.status(400).json({ 
                success: false, 
                message: 'رقم الهاتف يجب أن يبدأ بـ 0 ويكون 9 أرقام', 
                message_en: 'Phone number must start with 0 and be 9 digits' 
            });
        }
        
        if (user_type === 'salon') {
            if (phone && !validatePhoneFormat(phone)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'رقم هاتف الصالون يجب أن يبدأ بـ 0 ويكون 9 أرقام', 
                    message_en: 'Salon phone number must start with 0 and be 9 digits' 
                });
            }
            if (owner_phone && !validatePhoneFormat(owner_phone)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'رقم هاتف المالك يجب أن يبدأ بـ 0 ويكون 9 أرقام', 
                    message_en: 'Owner phone number must start with 0 and be 9 digits' 
                });
            }
        }
        
        const hashedPassword = await hashPassword(password);
        
        if (user_type === 'user' || user_type === 'salon') {
            // 1. Insert into users table (Unified Login)
            const userSql = `INSERT INTO users (name, email, phone, gender, city, password, user_type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
            // Determine fields before duplicate checks
            const user_name_to_use = user_type === 'salon' ? owner_name : name;
            const user_phone_to_use = user_type === 'salon' ? owner_phone : phone;
            const gender_to_use = user_type === 'salon' ? null : gender;

            // Smart duplicate check on phone: compare normalized last 9 digits
            try {
                const normalizedPhone = normalizePhoneNumber(user_phone_to_use || '');
                if (normalizedPhone) {
                    const dup = await db.query(
                        "SELECT id FROM users WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) = $1 LIMIT 1",
                        [normalizedPhone]
                    );
                    if (dup && dup.length > 0) {
                        return res.status(400).json({ success: false, message: 'رقم الهاتف مسجل بالفعل.', message_en: 'Phone already registered.' });
                    }
                }
            } catch (dupErr) {
                console.error('Phone duplicate check error:', dupErr);
                // Proceed without blocking if check fails unexpectedly
            }

            let userResult;
            try {
                userResult = await db.query(userSql, [user_name_to_use, email, user_phone_to_use, gender_to_use, city, hashedPassword, user_type]);
            } catch (err) {
                if (err.code === '23505') { // PostgreSQL unique constraint violation
                    return res.status(400).json({ success: false, message: 'البريد الإلكتروني مسجل بالفعل.', message_en: 'Email already registered.' });
                }
                // LOGGING IMPROVEMENT: Log the full error object
                console.error("User signup DB error:", err); 
                return res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات أثناء تسجيل المستخدم.', message_en: 'Database error during user registration.' });
            }
            
            if (!userResult || userResult.length === 0) {
                 return res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات.', message_en: 'Database error - no result returned.' });
            }
            
            const userId = userResult[0].id;
            
            if (user_type === 'salon') {
                // 2. Insert into salons table (Business Details)
                // Note: name = salon_name, phone = salon_phone
                const salonSql = `INSERT INTO salons (user_id, salon_name, owner_name, salon_phone, owner_phone, address, city, gender_focus, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`;
                
                try {
                    const salonResult = await db.query(salonSql, [userId, name, owner_name, phone, owner_phone, address, city, gender_focus, image_url]);
                    
                    if (!salonResult || salonResult.length === 0) {
                        // Attempt to delete the user record if salon insert fails to prevent orphaned users
                        await db.run('DELETE FROM users WHERE id = $1', [userId]);
                        return res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات أثناء تسجيل الصالون.', message_en: 'Database error during salon registration.' });
                    }
                    
                    const salonId = salonResult[0].id;
                    
                    console.log(`New Salon registered with ID: ${salonId}, linked to User ID: ${userId}`);
                    return res.json({ 
                        success: true, 
                        message: 'تم إنشاء حساب الصالون بنجاح.', 
                        user: { 
                            userId: userId, 
                            salonId: salonId, // IMPORTANT: Return salonId for business ops
                            name: owner_name, // Return owner name for consistency in user object
                            user_type: 'salon', 
                            email, 
                            city, 
                            gender_focus 
                        }
                    });
                } catch (err) {
                    // Attempt to delete the user record if salon insert fails to prevent orphaned users
                    await db.run('DELETE FROM users WHERE id = $1', [userId]);
                    
                    // LOGGING IMPROVEMENT: Log the full error object
                    console.error("Salon signup DB error:", err); 
                    
                    return res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات أثناء تسجيل الصالون.', message_en: 'Database error during salon registration.' });
                }
            } else {
                // Regular user successful registration
                console.log(`New User registered with ID: ${userId}`);
                return res.json({ 
                    success: true, 
                    message: 'تم إنشاء حساب المستخدم بنجاح.', 
                    user: { 
                        userId: userId, 
                        user_type: 'user', 
                        name, 
                        email, 
                        city, 
                        gender 
                    }
                });
            }
        } else {
            return res.status(400).json({ success: false, message: 'نوع المستخدم غير صحيح.', message_en: 'Invalid user type.' });
        }
    } catch (error) {
        // LOGGING IMPROVEMENT: Log the full error object for the top-level catch
        console.error("Register endpoint error (Top Level):", error); 
        return res.status(500).json({ success: false, message: 'خطأ في الخادم.', message_en: 'Server error.' });
    }
});

// Login (Updated to return full user data object and check hash)
app.post('/api/auth/login', async (req, res) => {
    console.log('🚀 LOGIN ENDPOINT HIT!');
    console.log('Request body:', req.body);
    try {
        const { identifier, email, phone, password } = req.body;

        console.log('=== UNIFIED LOGIN REQUEST ===');
        const input = (identifier || email || phone || '').trim();
        const isEmail = input.includes('@');
        console.log('Identifier:', input);
        
        // Validate phone format if not email
        if (!isEmail && input && !validatePhoneFormat(input)) {
            return res.status(400).json({ 
                success: false, 
                message: 'رقم الهاتف يجب أن يبدأ بـ 0 ويكون 9 أرقام', 
                message_en: 'Phone number must start with 0 and be 9 digits' 
            });
        }

        // 1. Find user in USERS table by email OR normalized phone
        let userResult;
        if (isEmail) {
            userResult = await db.query('SELECT id, name, email, city, gender, phone, user_type, password, strikes FROM users WHERE email = $1', [input]);
        } else {
            const normalizedIdentifier = normalizePhoneNumber(input);
            userResult = await db.query(
                "SELECT id, name, email, city, gender, phone, user_type, password, strikes FROM users WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) = $1",
                [normalizedIdentifier]
            );
        }
        console.log('Users table query result:', userResult);
        
        if (!userResult || userResult.length === 0) {
            console.log('No user found with that identifier.');
            return res.status(401).json({ 
                success: false, 
                message: isEmail ? 'البريد الإلكتروني غير مسجل.' : 'رقم الهاتف غير مسجل.', 
                message_en: isEmail ? 'Email not registered.' : 'Phone not registered.' 
            });
        }
        
        const userRow = userResult[0];
        console.log('Found user row:', userRow);
        
        // 2. Verify password
        const isPasswordValid = await verifyPassword(password, userRow.password);
        if (!isPasswordValid) {
            return res.status(401).json({ 
                success: false, 
                message: 'كلمة المرور غير صحيحة.', 
                message_en: 'Incorrect password.' 
            });
        }

        // 3. Determine user type and fetch linked data if necessary
        let userObject = {
            userId: userRow.id,
            name: userRow.name,
            email: userRow.email,
            city: userRow.city,
            user_type: userRow.user_type,
            phone: userRow.phone,
            // Include strikes count
            strikes_count: userRow.strikes || 0 
        };
        
        let redirectUrl = '';
        let userType = userRow.user_type;

        if (userType === 'admin') {
            redirectUrl = '/admin_dashboard.html';
        } else if (userType === 'user') {
            userObject.gender = userRow.gender;
            redirectUrl = '/home_user.html';
        } else if (userType === 'salon') {
            // Fetch linked salon details
            const salonResult = await db.query('SELECT id, salon_name, owner_name, salon_phone, owner_phone, address, gender_focus, image_url, status FROM salons WHERE user_id = $1', [userRow.id]);
            
            if (!salonResult || salonResult.length === 0) {
                 // Should not happen if registration was successful
                 console.error(`ERROR: Salon user found (ID ${userRow.id}) but no linked salon record.`);
                 return res.status(500).json({ success: false, message: 'خطأ في ملف الصالون. يرجى التواصل مع الإدارة.', message_en: 'Salon profile data missing.' });
            }
            
            const salonData = salonResult[0];
            
            // Merge salon data into user object
            userObject = {
                ...userObject, // Contains userId, name (owner name), email, etc.
                salonId: salonData.id, // CRITICAL: The Salon's ID
                salon_name: salonData.salon_name,
                owner_name: salonData.owner_name,
                salon_phone: salonData.salon_phone,
                owner_phone: salonData.owner_phone,
                gender_focus: salonData.gender_focus,
                image_url: salonData.image_url,
                status: salonData.status
            };
            
            redirectUrl = '/home_salon.html';
        } else {
            return res.status(400).json({ success: false, message: 'نوع المستخدم غير صحيح.', message_en: 'Invalid user type.' });
        }

        console.log(`Successful login for ${userType}: ${isEmail ? userRow.email : userRow.phone}`);

        // Generate token
        const token = crypto.randomUUID();
        
        // Store admin token separately (In a real app, this token would be linked to the user session)
        if (userType === 'admin') {
            validAdminTokens.add(token);
        }

        res.json({ 
            success: true, 
            message: 'تم تسجيل الدخول بنجاح.', 
            redirect: redirectUrl, 
            token: token,
            user: userObject,
            userType: userType
        });

    } catch (error) {
        console.error("Login endpoint error:", error.message);
        return res.status(500).json({ 
            success: false, 
            message: 'خطأ في الخادم.', 
            message_en: 'Server error.' 
        });
    }
});


// API to get user profile (for home_user data load)
app.post('/api/user/profile', async (req, res) => {
    // This route now uses userId for all lookups and joins for salons
    const { user_type, userId } = req.body; 

    if (!userId) {
        return res.status(400).json({ success: false, message: 'User ID is required.' });
    }

    try {
        if (user_type === 'user' || user_type === 'admin') {
            // Fetch data directly from users table for standard users/admins
            const userSql = 'SELECT id as userId, name, email, phone, gender, city, strikes, user_type FROM users WHERE id = $1';
            const row = await dbGet(userSql, [userId]);
            
            if (!row) {
                return res.status(404).json({ success: false, message: 'User not found.' });
            }
            res.json({ ...row, strikes_count: row.strikes || 0 });
        } else if (user_type === 'salon') {
            // Fetch joined data for salon user
            const salonSql = `
                SELECT 
                    u.id as userId, u.name as owner_name, u.email, u.phone as owner_phone, u.city, u.user_type, u.strikes,
                    s.id as salonId, s.salon_name, s.salon_phone, s.address, s.gender_focus, s.image_url, s.status
                FROM users u
                JOIN salons s ON u.id = s.user_id
                WHERE u.id = $1
            `;
            const row = await dbGet(salonSql, [userId]);
            
            if (!row) {
                return res.status(404).json({ success: false, message: 'Salon user profile not found.' });
            }
            // Rearrange data to match client expectations
            res.json({ 
                ...row,
                strikes_count: row.strikes || 0,
                // Ensure the owner's details match the field names expected by the home_salon client
                owner_name: row.owner_name,
                owner_phone: row.owner_phone,
                id: row.salonId // Use salon ID as the primary ID for the salon profile object
            });

        } else {
            return res.status(400).json({ success: false, message: 'Invalid user type.' });
        }
    } catch (error) {
        console.error("Profile fetch error:", error.message);
        return res.status(500).json({ success: false, message: 'Database error during profile fetch.' });
    }
});

// API to get a consistent list of cities
app.get('/api/cities', (req, res) => {
    // Return the master city list for all dropdowns
    res.json(CITIES);
});


// ===================================
// Salon Management Routes 
// ===================================

// API to get salon basic info
app.get('/api/salon/info/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
     // FIX: Add validation for salonId
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
         return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    
     // FIX: Query the salons table by salon.id (not user_id) but join back to users for owner data
    const sql = `
        SELECT 
            s.id, s.salon_name, s.address, s.city, s.gender_focus, s.image_url, s.salon_phone, s.owner_name, s.owner_phone, s.user_id,
            u.email
        FROM salons s
        JOIN users u ON s.user_id = u.id
        WHERE s.id = $1
    `;
    try {
        const row = await dbGet(sql, [salonId]);
        if (!row) {
             return res.status(404).json({ success: false, message: 'Salon not found.' });
        }
        res.json({ success: true, info: row });
    } catch (err) {
        console.error("Salon info fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// API to get salon details with rating for user view
app.get('/api/salon/details/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    // FIX: Add validation for salonId (Prevents 500 when frontend sends 'undefined')
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
         return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    
    const sql = `
        SELECT 
            s.id AS salonId, 
            s.salon_name, 
            s.address, 
            s.city, 
            s.image_url,
            COALESCE(AVG(r.rating), 0) AS avg_rating,
            COUNT(r.id) AS review_count
        FROM salons s
        LEFT JOIN reviews r ON s.id = r.salon_id
        WHERE s.id = $1
        GROUP BY s.id
    `;
    try {
        const row = await dbGet(sql, [salonId]);
        if (!row) {
             return res.status(404).json({ success: false, message: 'Salon not found.' });
        }
        res.json({ success: true, salon: row });
    } catch (err) {
        console.error("Salon details fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// API to update salon basic info
app.post('/api/salon/info/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    // NOTE: password and email are excluded from this general update for security
    const { salon_name, owner_name, salon_phone, owner_phone, address, city, gender_focus, image_url } = req.body;
    
    // FIX: Add validation for salonId
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
         return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    
    // 1. Update salons table (business data)
    const salonSql = `UPDATE salons SET salon_name = $1, owner_name = $2, salon_phone = $3, owner_phone = $4, address = $5, city = $6, gender_focus = $7, image_url = $8 WHERE id = $9 RETURNING user_id`;
    
    let userId = null;
    try {
        const result = await dbGet(salonSql, [salon_name, owner_name, salon_phone, owner_phone, address, city, gender_focus, image_url, salonId]);
        if (result && result.user_id) {
            userId = result.user_id;
        } else {
             return res.status(404).json({ success: false, message: 'Salon not found or update failed.' });
        }
    } catch (err) {
        console.error("Salon update error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
    
    // 2. Update users table (city, phone for consistency)
    if (userId) {
        const userSql = `UPDATE users SET name = $1, phone = $2, city = $3 WHERE id = $4`;
        // Use the owner_name and owner_phone fields for the users table
        try {
            await dbRun(userSql, [owner_name, owner_phone, city, userId]);
        } catch (err) {
            console.error("User info update error:", err.message);
            // This error is less critical than salon data, but we log it.
        }
    }

    res.json({ success: true, message: 'Salon information updated successfully.' });
});

// --- Staff Management ---
app.get('/api/salon/staff/:salon_id', async (req, res) => {
    try {
        const salonId = req.params.salon_id;
        // FIX: Add validation for salonId (Prevents 500 when frontend sends 'undefined')
        if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
             return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
        }
        
        // FIX: Use $1 placeholder
        const rows = await dbAll('SELECT id, name FROM staff WHERE salon_id = $1', [salonId]);
        res.json({ success: true, staff: rows });
    } catch (err) {
        console.error("Staff fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});
app.post('/api/salon/staff/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    const { name } = req.body;
    
    // FIX: Add validation for salonId
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
         return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
     // FIX: Use $1, $2 placeholders
    try {
        // FIX: Use RETURNING id with dbGet to ensure the new ID is retrieved in PostgreSQL
        const result = await dbGet('INSERT INTO staff (salon_id, name) VALUES ($1, $2) RETURNING id', [salonId, name]);
        res.json({ success: true, staffId: result.id, message: 'Staff added successfully.' });
    } catch (err) {
        console.error('Staff addition error:', err);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});
app.delete('/api/salon/staff/:staff_id', async (req, res) => {
    const staffId = req.params.staff_id;
     // FIX: Use $1 placeholder
    try {
        await dbRun('DELETE FROM staff WHERE id = $1', [staffId]);
        res.json({ success: true, message: 'Staff deleted successfully.' });
    } catch (err) {
        // FIX: Handle Foreign Key constraint violation specifically (PostgreSQL code 23503)
        if (err.code === '23503') {
             return res.status(400).json({ success: false, message: 'لا يمكن حذف المختص. لديه حجوزات سابقة أو حالية مرتبطة به أو استراحات روتينية.' });
        }
        console.error('Staff deletion error:', err);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});


// --- Schedule and Breaks Management (Unified Fetch for User/Admin) ---
app.get('/api/salon/schedule/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;

    // FIX: Add validation for salonId (Prevents 500 when frontend sends 'undefined')
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
         return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }

    try {
        const schedule = await dbGet('SELECT opening_time, closing_time, closed_days FROM schedules WHERE salon_id = $1', [salonId]);
        const breaks = await dbAll('SELECT id, staff_id, start_time, end_time, reason FROM breaks WHERE salon_id = $1', [salonId]);
        const modificationsRaw = await dbAll('SELECT id, mod_type, mod_date, mod_day_index, start_time, end_time, closure_type, reason, staff_id FROM schedule_modifications WHERE salon_id = $1', [salonId]);

        // Compute clarity fields for each modification without changing DB schema
        const modifications = (modificationsRaw || []).map(m => {
            const hasTimes = !!(m.start_time && m.end_time);
            const closure_type = m.closure_type || (hasTimes ? 'interval' : 'full_day');
            const is_full_day = closure_type === 'full_day';
            return { ...m, is_full_day, closure_type };
        });

        if (schedule && schedule.closed_days && typeof schedule.closed_days === 'string') {
            // FIX: Ensure closed_days is parsed from JSON string if the DB stored it as string
            try {
                schedule.closed_days = JSON.parse(schedule.closed_days);
            } catch (e) {
                console.warn("Could not parse closed_days as JSON string:", schedule.closed_days);
                schedule.closed_days = [];
            }
        } else if (schedule) {
            schedule.closed_days = schedule.closed_days || [];
        }

        res.json({ success: true, schedule: schedule || {}, breaks, modifications });
    } catch (error) {
        console.error("Schedule fetch error:", error.message);
        res.status(500).json({ success: false, message: 'Database error.' });
    }
});

app.post('/api/salon/schedule/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    const { opening_time, closing_time, closed_days } = req.body;
    
    // FIX: Add validation for salonId
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
         return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    
    // Helper function to convert time to minutes for comparison
    function timeToMinutes(timeStr) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
    }
    
    // Helper function to calculate hours difference
    function calculateHours(openTime, closeTime) {
        const openMinutes = timeToMinutes(openTime);
        const closeMinutes = timeToMinutes(closeTime);
        
        // Handle overnight hours (e.g., 22:00 to 02:00)
        if (closeMinutes <= openMinutes) {
            return (24 * 60 - openMinutes + closeMinutes) / 60;
        } else {
            return (closeMinutes - openMinutes) / 60;
        }
    }
    
    // FIX: Server-side validation for schedule times - allow overnight hours but deny zero hours
    const hoursOpen = calculateHours(opening_time, closing_time);
    if (hoursOpen === 0) {
        return res.status(400).json({ 
            success: false, 
            message: 'لا يمكن أن يكون وقت الفتح والإغلاق متطابقين. الصالون يجب أن يكون مفتوحاً لساعة واحدة على الأقل.', 
            message_en: 'Opening and closing times cannot be the same. Salon must be open for at least one hour.' 
        });
    }
    
    const closedDaysJson = JSON.stringify(closed_days || []);
    
    // UPSERT: Insert or replace existing schedule row - FIX: Use $1, $2, ... placeholders
    const sql = `
        INSERT INTO schedules (salon_id, opening_time, closing_time, closed_days) 
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(salon_id) DO UPDATE SET 
            opening_time = excluded.opening_time, 
            closing_time = excluded.closing_time, 
            closed_days = excluded.closed_days
    `;
    
    try {
        await dbRun(sql, [salonId, opening_time, closing_time, closedDaysJson]);
        res.json({ success: true, message: 'Schedule updated successfully.' });
    } catch (err) {
        console.error("Schedule save error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

app.post('/api/salon/break/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    const { staff_id, start_time, end_time, reason } = req.body;
    
    // FIX: Add validation for salonId
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
         return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    
    // FIX: Server-side validation for break times
    if (start_time >= end_time) {
        return res.status(400).json({ success: false, message: 'وقت بداية الاستراحة يجب أن يكون قبل وقت النهاية.' });
    }
    
    try {
        // FIX: Use RETURNING id with dbGet to ensure the new ID is retrieved in PostgreSQL
        const result = await dbGet('INSERT INTO breaks (salon_id, staff_id, start_time, end_time, reason) VALUES ($1, $2, $3, $4, $5) RETURNING id', 
            [salonId, staff_id || null, start_time, end_time, reason || null]);
        res.json({ success: true, breakId: result.id, message: 'Break added successfully.' });
    } catch (err) {
        console.error('Break addition error:', err);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

app.delete('/api/salon/break/:break_id', async (req, res) => {
    const breakId = req.params.break_id;
     // FIX: Use $1 placeholder
    try {
        await dbRun('DELETE FROM breaks WHERE id = $1', [breakId]);
        res.json({ success: true, message: 'Break deleted successfully.' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});


// --- NEW: Specific Schedule Modifications Routes ---

app.post('/api/salon/schedule/modification/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    const { mod_type, mod_date, mod_day_index, start_time, end_time, closure_type, reason, staff_id } = req.body;
    
    // FIX: Add validation for salonId
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
         return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }

    // Only closure modifications are supported
    // closure_type: 'full_day' (no times) or 'interval' (requires times)
    if (!['full_day', 'interval'].includes(closure_type)) {
        return res.status(400).json({ success: false, message: 'closure_type يجب أن يكون full_day أو interval.' });
    }
    const hasTimes = !!start_time && !!end_time;
    const closeAllDay = closure_type === 'full_day';

    // Validate closure interval when required
    if (closure_type === 'interval') {
        if (!hasTimes) {
            return res.status(400).json({ success: false, message: 'يرجى تحديد وقتي الإغلاق (من/إلى) لفترة الإغلاق.' });
        }
        if (start_time >= end_time) {
            return res.status(400).json({ success: false, message: 'وقت الإغلاق (من) يجب أن يكون قبل (إلى).' });
        }
    }

    // For full_day, ignore any provided times
    const startForDb = closeAllDay ? null : (hasTimes ? start_time : null);
    const endForDb = closeAllDay ? null : (hasTimes ? end_time : null);

    let sql = '';
    let params = [salonId, mod_type];

    if (mod_type === 'once') {
        sql = `INSERT INTO schedule_modifications (salon_id, mod_type, mod_date, start_time, end_time, reason, staff_id, closure_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`;
        params.push(mod_date, startForDb, endForDb, reason, staff_id || null, closure_type);
    } else if (mod_type === 'recurring') {
        sql = `INSERT INTO schedule_modifications (salon_id, mod_type, mod_day_index, start_time, end_time, reason, staff_id, closure_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`;
        params.push(mod_day_index, startForDb, endForDb, reason, staff_id || null, closure_type);
    } else {
        return res.status(400).json({ success: false, message: 'Invalid modification type.' });
    }

    try {
        const result = await dbGet(sql, params);
        res.json({ success: true, modId: result.id, message: 'تم إضافة تعديل الإغلاق بنجاح.' });
    } catch (err) {
        console.error('Modification add error:', err.message);
        return res.status(500).json({ success: false, message: 'Database error during modification add.' });
    }
});

app.delete('/api/salon/schedule/modification/:mod_id', async (req, res) => {
    const modId = req.params.mod_id;
     // FIX: Use $1 placeholder
    try {
        await dbRun('DELETE FROM schedule_modifications WHERE id = $1', [modId]);
        res.json({ success: true, message: 'Schedule modification deleted successfully.' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});


// --- Appointments Routes ---

// Used by Admin/Salon to list appointments
app.get('/api/salon/appointments/:salon_id/:filter', async (req, res) => {
    try {
        const { salon_id, filter } = req.params;
        
        // FIX: Add validation for salon_id
        if (!salon_id || salon_id === 'undefined' || isNaN(parseInt(salon_id))) {
             return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
        }
        
        const now = new Date().toISOString();
        let whereClause = '';
        let params = [salon_id];
        let orderBy = 'ASC';

        if (filter === 'today') {
            // Only show Scheduled appointments for today; exclude Completed from today
            const today = new Date().toISOString().split('T')[0];
            whereClause = `AND DATE(a.start_time) = $2 AND a.status = 'Scheduled'`;
            params.push(today);
            orderBy = 'ASC';
        } else if (filter === 'completed') {
            // Show all completed and absent appointments regardless of date
            whereClause = `AND (a.status = 'Completed' OR a.status = 'Absent')`;
            orderBy = 'DESC';
        } else if (filter === 'upcoming') {
            // Backward compatibility: upcoming shows only future scheduled
            whereClause = `AND a.start_time > $2 AND a.status = 'Scheduled'`;
            params.push(now);
            orderBy = 'ASC';
        } else if (filter === 'past') {
            // Exclude cancelled and completed from past view
            whereClause = `AND a.start_time <= $2 AND a.status <> 'Cancelled' AND a.status <> 'Completed'`;
            params.push(now);
            orderBy = 'DESC';
        } else if (filter === 'cancelled') {
            // Show only cancelled appointments
            whereClause = `AND a.status = 'Cancelled'`;
            orderBy = 'DESC';
        } else {
            return res.status(400).json({ success: false, message: 'Invalid filter.' });
        }

        const sql = `
            SELECT 
                a.id, a.start_time, a.end_time, a.status, a.price, 
                u.name AS user_name, u.phone AS user_phone,
                s.name_ar AS service_name,
                st.name AS staff_name
            FROM appointments a
            JOIN users u ON a.user_id = u.id
            JOIN services s ON a.service_id = s.id
            LEFT JOIN staff st ON a.staff_id = st.id
            WHERE a.salon_id = $1 ${whereClause}
            ORDER BY a.start_time ${orderBy}
        `;

        const rows = await dbAll(sql, params);

        // Fetch all services for each appointment
        const appointmentsWithServices = await Promise.all(rows.map(async (appointment) => {
            try {
                const servicesQuery = `
                    SELECT s.name_ar, aps.price 
                    FROM appointment_services aps
                    JOIN services s ON aps.service_id = s.id
                    WHERE aps.appointment_id = $1
                `;
                // Use dbAll which is an alias for db.query (PostgreSQL-safe)
                const services = await dbAll(servicesQuery, [appointment.id]);
                
                return {
                    ...appointment,
                    all_services: services,
                    services_names: services.map(s => s.name_ar).join(' + ')
                };
            } catch (serviceErr) {
                console.error("Error fetching services for appointment:", serviceErr);
                // In case of an error fetching services, return partial data instead of crashing
                return {
                    ...appointment,
                    all_services: [],
                    services_names: appointment.service_name || 'خدمة غير محددة'
                };
            }
        }));

        console.log("Appointments query result:", appointmentsWithServices.map(row => ({
            id: row.id,
            service_name: row.service_name,
            services_names: row.services_names,
            user_name: row.user_name
        })));
        res.json({ success: true, appointments: appointmentsWithServices });
    } catch (err) {
        console.error("Appointments fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error during appointment fetch: ' + err.message });
    }
});

// Used by User booking logic to check availability for a specific date
app.get('/api/salon/:salon_id/appointments/:date', async (req, res) => {
    const { salon_id, date } = req.params;
    
    // FIX: Add validation for salon_id
    if (!salon_id || salon_id === 'undefined' || isNaN(parseInt(salon_id))) {
         return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    
    // FIX: Using DATE() extraction function suitable for PostgreSQL and use $2 placeholder
    const sql = `
        SELECT id, start_time, end_time, staff_id, status
        FROM appointments
        WHERE salon_id = $1 AND DATE(start_time) = $2
        AND status = 'Scheduled'
    `;
    
    try {
        const rows = await dbAll(sql, [salon_id, date]);
        res.json({ success: true, appointments: rows });
    } catch (err) {
        console.error("Daily appointments fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});


app.post('/api/salon/appointment/status/:appointment_id', async (req, res) => {
    const appointmentId = req.params.appointment_id;
    const { status } = req.body; 

    if (!['Completed', 'Cancelled', 'Absent'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status provided.' });
    }
    
    try {
        // First, get the appointment details to find the user_id
        const getAppointmentQuery = 'SELECT user_id, status FROM appointments WHERE id = $1'; 
        const appointment = await dbGet(getAppointmentQuery, [appointmentId]);

        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found.' });
        }
        
        // Prevent setting status if already a terminal state
        if (appointment.status !== 'Scheduled') {
            return res.status(400).json({ success: false, message: `لا يمكن تغيير حالة موعد تم تحديده مسبقاً كـ "${appointment.status}"` });
        }

        // Update appointment status
        const sql = `UPDATE appointments SET status = $1 WHERE id = $2`;
        await dbRun(sql, [status, appointmentId]);

        // If status is "Absent", increment user strikes
        if (status === 'Absent') {
            const strikeQuery = 'UPDATE users SET strikes = strikes + 1 WHERE id = $1';
            await dbRun(strikeQuery, [appointment.user_id]);
            
            res.json({ 
                success: true, 
                message: 'تم تحديث حالة الموعد وإضافة إنذار للمستخدم'
            });
        } else {
            res.json({ 
                success: true, 
                message: `تم تحديث حالة الموعد إلى ${status === 'Completed' ? 'مكتمل' : 'ملغي'}`
            });
        }
    } catch (err) {
        console.error("Appointment status update error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// Used by User to fetch their own appointment history (FIXED SQL QUERY)
app.get('/api/appointments/user/:user_id/:filter', async (req, res) => {
    const { user_id, filter } = req.params;
    const now = new Date().toISOString();
    let whereClause = '';
    let params = [user_id];
    let orderBy = 'DESC';

    // FIX: Add validation for user_id
    if (!user_id || user_id === 'undefined' || isNaN(parseInt(user_id))) {
         return res.status(400).json({ success: false, message: 'User ID is required and must be valid.' });
    }
    
    if (filter === 'upcoming') {
         // FIX: Use $2 placeholder
        whereClause = `AND a.start_time > $2 AND a.status = 'Scheduled'`;
        params.push(now);
        orderBy = 'ASC';
    } else if (filter === 'past') {
         // FIX: Use $2 placeholder
        whereClause = `AND a.start_time <= $2`;
        params.push(now);
        orderBy = 'DESC';
    } else {
        return res.status(400).json({ success: false, message: 'Invalid filter.' });
    }

    const sql = `
        SELECT 
            a.id, a.start_time, a.end_time, a.status, a.price, -- a.price is now correctly selected
            s.salon_name,
            serv.name_ar AS service_name,
            st.name AS staff_name
        FROM appointments a
        JOIN salons s ON a.salon_id = s.id
        JOIN services serv ON a.service_id = serv.id
        LEFT JOIN staff st ON a.staff_id = st.id
        WHERE a.user_id = $1 ${whereClause}
        ORDER BY a.start_time ${orderBy}
    `;

    try {
        const rows = await dbAll(sql, params);
        // Fetch all services for each appointment
        const appointmentsWithServices = await Promise.all(rows.map(async (appointment) => {
            try {
                const servicesQuery = `
                    SELECT s.name_ar, aps.price 
                    FROM appointment_services aps
                    JOIN services s ON aps.service_id = s.id
                    WHERE aps.appointment_id = $1
                `;
                const services = await dbAll(servicesQuery, [appointment.id]);

                return {
                    ...appointment,
                    all_services: services,
                    services_names: services.length > 0 ? services.map(s => s.name_ar).join(' + ') : appointment.service_name
                };
            } catch (serviceErr) {
                console.error("Error fetching services for user appointment:", serviceErr);
                return {
                    ...appointment,
                    all_services: [],
                    services_names: appointment.service_name || 'خدمة غير محددة'
                };
            }
        }));

        res.json({ success: true, appointments: appointmentsWithServices });
    } catch (err) {
        console.error("User Appointments fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error during appointment fetch.' });
    }
});

// --- NEW: API to cancel an appointment (3-hour policy enforcement) ---
app.post('/api/appointments/cancel/:appointment_id', async (req, res) => {
    const appointmentId = req.params.appointment_id;
    const minNoticeHours = 3; 
    const { user_id } = req.body; // Expecting user_id in the body for authorization/strike check
    
    // FIX: Add validation for user_id
    if (!user_id || isNaN(parseInt(user_id))) {
         return res.status(400).json({ success: false, message: 'User ID is required and must be valid.' });
    }

    try {
        // FIX: Use $1 placeholder
        const row = await dbGet('SELECT salon_id, start_time, status, user_id FROM appointments WHERE id = $1', [appointmentId]);
        
        if (!row) {
            return res.status(404).json({ success: false, message: 'Appointment not found.' });
        }
        
        if (row.status !== 'Scheduled') {
            return res.status(400).json({ success: false, message: 'لا يمكن إلغاء موعد حالته ليست "مؤكد".' });
        }
        
        // Authorization check
        if (row.user_id != user_id) {
             return res.status(403).json({ success: false, message: 'غير مصرح لك بإلغاء هذا الموعد.' });
        }


        const appointmentTime = new Date(row.start_time).getTime();
        const now = new Date().getTime();
        const noticePeriodMs = minNoticeHours * 60 * 60 * 1000;
        
        if (appointmentTime - now < noticePeriodMs) {
             // If cancellation is too late, still cancel, but issue a strike
             await dbRun('UPDATE appointments SET status = $1 WHERE id = $2', ['Cancelled', appointmentId]);
             
             // Issue strike to user and retrieve new strike count
             const strikeQuery = 'UPDATE users SET strikes = strikes + 1 WHERE id = $1 RETURNING strikes';
             const strikeResult = await dbGet(strikeQuery, [user_id]);
             const newStrikes = strikeResult ? strikeResult.strikes : 'غير معروف';

             // Emit SSE notification to salon dashboard
             sendSalonEvent(row.salon_id, 'appointment_cancelled', {
                appointmentId,
                user_id,
                start_time: row.start_time,
                late: true,
                strikes: newStrikes
             });
             // Socket.IO emit for late cancellation
             try { if (io) { io.to(`salon_${row.salon_id}`).emit('appointment_cancelled', { appointmentId, user_id, start_time: row.start_time, late: true, strikes: newStrikes }); } } catch (e) { console.warn('socket late cancel emit error:', e.message); }

             // Push notify salon about late cancellation
             await sendPushToTargets({
                salon_id: row.salon_id,
                payload: {
                    title: 'إلغاء موعد متأخر',
                    body: (() => {
                        try {
                            const d = new Date(row.start_time);
                            const date = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
                            let h = d.getHours();
                            const isAM = h < 12;
                            h = h % 12 || 12;
                            const suffix = isAM ? 'صباحًا' : 'مساءً';
                            const time = `${h} ${suffix}`;
                            return `تم إلغاء موعد قريب بتاريخ ${date} على الساعة ${time}`;
                        } catch {
                            return `تم إلغاء موعد قريب بتاريخ ${new Date(row.start_time).toLocaleDateString('ar-EG')} على الساعة ${new Date(row.start_time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
                        }
                    })(),
                    url: '/home_salon.html#appointments'
                }
             });

             return res.status(200).json({ 
                success: true, 
                message: `تم إلغاء الموعد. تم إضافة إنذار لحسابك (الإنذارات: ${newStrikes}/3) لأن الإلغاء كان متأخراً.`,
                strikeIssued: true
             });
        }

        // Proceed with cancellation without strike - FIX: Use $1 placeholder, ensure string literal is safe
        await dbRun('UPDATE appointments SET status = $1 WHERE id = $2', ['Cancelled', appointmentId]);
        // Emit SSE notification to salon dashboard
        sendSalonEvent(row.salon_id, 'appointment_cancelled', {
            appointmentId,
            user_id,
            start_time: row.start_time,
            late: false
        });
        // Socket.IO emit for normal cancellation
        try { if (io) { io.to(`salon_${row.salon_id}`).emit('appointment_cancelled', { appointmentId, user_id, start_time: row.start_time, late: false }); } } catch (e) { console.warn('socket cancel emit error:', e.message); }
        // Push notify salon about normal cancellation (clean Arabic text, no user name)
        const fmtDate = (() => {
            try {
                const d = new Date(row.start_time);
                return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
            } catch { return new Date(row.start_time).toLocaleDateString('ar-EG'); }
        })();
        const fmtTime = (() => {
            try {
                const d = new Date(row.start_time);
                let h = d.getHours();
                const isAM = h < 12;
                h = h % 12 || 12;
                const suffix = isAM ? 'صباحًا' : 'مساءً';
                return `${h} ${suffix}`;
            } catch { return new Date(row.start_time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true }); }
        })();
        await sendPushToTargets({
            salon_id: row.salon_id,
            payload: {
                title: 'تم إلغاء موعد',
                body: `تم إلغاء موعد بتاريخ ${fmtDate} على الساعة ${fmtTime}`,
                url: '/home_salon.html#appointments'
            }
        });
        res.json({ success: true, message: 'تم إلغاء الموعد بنجاح.' });
    } catch (err) {
        console.error("Cancellation error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error during cancellation.' });
    }
});

// ===================================
// Service Management/Discovery Routes 
// ===================================

app.get('/api/services/master/:gender', async (req, res) => {
    try {
        const gender = req.params.gender;
        // FIX: Use $1 placeholder
        const sql = "SELECT id, name_ar, icon, service_type FROM services WHERE gender = $1";
        
        const rows = await dbAll(sql, [gender]);
        res.json({ success: true, services: rows });
    } catch (err) {
        console.error("Master services fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

app.get('/api/salons/:salon_id/services', (req, res) => {
    const salonId = req.params.salon_id;
    
    // FIX: Add validation for salonId (Prevents 500 when frontend sends 'undefined')
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
         return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    
    const sql = `
        SELECT s.id, s.name_ar, s.icon, s.service_type, ss.price, ss.duration
        FROM salon_services ss
        JOIN services s ON ss.service_id = s.id
        WHERE ss.salon_id = $1
    `;
    // FIX: Use dbAll instead of db.all (PostgreSQL compatible wrapper)
    dbAll(sql, [salonId]).then(rows => {
        res.json({ success: true, services: rows });
    }).catch(err => {
         console.error("Salon services fetch error:", err.message);
         return res.status(500).json({ success: false, message: 'Database error.' });
    });
});

// Get salon services (alternative endpoint for salon management)
app.get('/api/salon/services/:salon_id', async (req, res) => {
    try {
        const salonId = req.params.salon_id;
        
        // FIX: Add validation for salonId
        if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
             return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
        }
        
        const sql = `
            SELECT s.id, s.name_ar, s.icon, s.service_type, ss.price, ss.duration
            FROM salon_services ss
            JOIN services s ON ss.service_id = s.id
            WHERE ss.salon_id = $1
        `;
        const rows = await dbAll(sql, [salonId]);
        res.json({ success: true, services: rows });
    } catch (err) {
        console.error("Salon services fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

app.post('/api/salon/services/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    const services = req.body.services; // [{ service_id, price, duration }]
    
    // FIX: Add validation for salonId
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
         return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }

    if (!Array.isArray(services)) {
        return res.status(400).json({ success: false, message: 'Invalid services format.' });
    }

    try {
        // 1. Delete existing services for the salon
        await dbRun('DELETE FROM salon_services WHERE salon_id = $1', [salonId]);

        // 2. Insert new services
        for (const service of services) {
            // Allow duration to be 0 for add-ons, but ensure service_id and price are valid
            if (service.service_id && service.price !== undefined && service.price !== null && service.duration !== undefined && service.duration !== null) {
                await dbRun("INSERT INTO salon_services (salon_id, service_id, price, duration) VALUES ($1, $2, $3, $4)", 
                    [salonId, service.service_id, service.price, service.duration]);
            }
        }

        res.json({ success: true, message: 'Salon services updated successfully.' });
    } catch (err) {
        console.error("Service update error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error during service update.' });
    }
});

// API to book a new appointment - UPDATED for Smart Staff Assignment and Multiple Services
// ===== SERVER-SIDE BOOKING VALIDATION FUNCTIONS =====

function timeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
}

function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

async function validateBookingSlot(salonId, staffId, startTime, endTime, serviceDuration) {
    try {
        // Parse the booking date and time
        const bookingDate = new Date(startTime);
        const dateString = bookingDate.toISOString().split('T')[0];
        const dayOfWeek = bookingDate.getDay();
        const now = new Date();
        const isToday = dateString === now.toISOString().split('T')[0];
        
        // Convert times to minutes for easier comparison
        const startMinutes = timeToMinutes(startTime.split('T')[1].substring(0, 5));
        const endMinutes = timeToMinutes(endTime.split('T')[1].substring(0, 5));
        
        // Validate service duration matches
        if (endMinutes - startMinutes !== serviceDuration) {
            return { valid: false, message: 'مدة الخدمة غير متطابقة مع الوقت المحدد.' };
        }
        
        // Get salon schedule data
        const schedule = await dbGet('SELECT * FROM salon_schedule WHERE salon_id = ?', [salonId]);
        if (!schedule) {
            return { valid: false, message: 'جدول الصالون غير متوفر.' };
        }
        
        // Check if salon is closed on this day
        const closedDays = schedule.closed_days ? JSON.parse(schedule.closed_days) : [];
        if (closedDays.includes(dayOfWeek)) {
            return { valid: false, message: 'الصالون مغلق في هذا اليوم.' };
        }
        
        // Get operating hours
        const openMinutes = timeToMinutes(schedule.opening_time || '09:00');
        const closeMinutes = timeToMinutes(schedule.closing_time || '18:00');
        
        // Get schedule modifications
        const modifications = await dbAll(`
            SELECT * FROM salon_schedule_modifications 
            WHERE salon_id = ? AND (
                (mod_type = 'once' AND mod_date = ?) OR
                (mod_type = 'recurring' AND mod_day_index = ?)
            )
        `, [salonId, dateString, dayOfWeek]);
        
        // Check for complete day closures
        const fullDayClosures = modifications.filter(mod => mod.closure_type === 'full_day');
        if (fullDayClosures.length > 0) {
            return { valid: false, message: 'الصالون مغلق في هذا اليوم بسبب ظروف خاصة.' };
        }
        
        // Check if booking is within operating hours
        if (startMinutes < openMinutes || endMinutes > closeMinutes) {
            return { valid: false, message: 'الموعد خارج ساعات العمل.' };
        }
        
        // Check if booking is in the past (for today)
        if (isToday) {
            const nowMinutes = timeToMinutes(now.toTimeString().substring(0, 5));
            const minStartMinutes = Math.ceil((nowMinutes + 30) / 30) * 30;
            if (startMinutes < minStartMinutes) {
                return { valid: false, message: 'لا يمكن حجز موعد في الماضي.' };
            }
        }
        
        // Check for blocked time periods (interval closures)
        for (const mod of modifications) {
            if (mod.closure_type === 'interval' && mod.start_time && mod.end_time) {
                const modStart = timeToMinutes(mod.start_time);
                const modEnd = timeToMinutes(mod.end_time);
                const modStaffId = mod.staff_id || 0;
                
                // Check if modification applies to this staff member
                const staffMatch = modStaffId === 0 || parseInt(modStaffId) === parseInt(staffId);
                
                if (staffMatch && startMinutes < modEnd && endMinutes > modStart) {
                    return { valid: false, message: 'الوقت المحدد غير متاح بسبب ظروف خاصة.' };
                }
            }
        }
        
        // Get breaks for this salon
        const breaks = await dbAll('SELECT * FROM salon_breaks WHERE salon_id = ?', [salonId]);
        
        // Check for break conflicts
        for (const breakItem of breaks) {
            const breakStart = timeToMinutes(breakItem.start_time);
            const breakEnd = timeToMinutes(breakItem.end_time);
            const breakStaffId = breakItem.staff_id || 0;
            
            // Check if break applies to this staff member
            const staffMatch = breakStaffId === 0 || parseInt(breakStaffId) === parseInt(staffId);
            
            if (staffMatch && startMinutes < breakEnd && endMinutes > breakStart) {
                return { valid: false, message: 'الوقت المحدد يتعارض مع فترة استراحة.' };
            }
        }
        
        // Get existing appointments for this date
        const appointments = await dbAll(`
            SELECT * FROM appointments 
            WHERE salon_id = ? AND DATE(start_time) = ? 
            AND status NOT IN ('Cancelled', 'Completed', 'Rejected', 'No_Show', 'Absent')
        `, [salonId, dateString]);
        
        // Check for appointment conflicts
        for (const appt of appointments) {
            if (!appt.start_time || !appt.end_time) continue;
            
            let apptStartMinutes, apptEndMinutes;
            try {
                // Handle both ISO format and SQL format
                let startTimePart, endTimePart;
                
                if (appt.start_time.includes('T')) {
                    startTimePart = appt.start_time.split('T')[1];
                } else if (appt.start_time.includes(' ')) {
                    startTimePart = appt.start_time.split(' ')[1];
                } else {
                    continue;
                }
                
                if (appt.end_time.includes('T')) {
                    endTimePart = appt.end_time.split('T')[1];
                } else if (appt.end_time.includes(' ')) {
                    endTimePart = appt.end_time.split(' ')[1];
                } else {
                    continue;
                }
                
                if (!startTimePart || !endTimePart) continue;
                
                apptStartMinutes = timeToMinutes(startTimePart.substring(0, 5));
                apptEndMinutes = timeToMinutes(endTimePart.substring(0, 5));
            } catch (e) {
                console.error('Error processing appointment times:', e, appt);
                continue;
            }
            
            const apptStaffId = appt.staff_id === null || appt.staff_id === undefined ? 0 : parseInt(appt.staff_id);
            
            // Check for direct staff conflict
            if (parseInt(staffId) !== 0 && apptStaffId === parseInt(staffId)) {
                if (startMinutes < apptEndMinutes && endMinutes > apptStartMinutes) {
                    return { valid: false, message: 'الموظف غير متاح في هذا الوقت - يوجد موعد آخر.' };
                }
            }
            
            // For "Any Staff" bookings (staffId = 0), check capacity
            if (parseInt(staffId) === 0) {
                // Get all staff for capacity calculation
                const allStaff = await dbAll('SELECT id FROM staff WHERE salon_id = ?', [salonId]);
                const staffCount = allStaff.length;
                
                if (staffCount === 0) {
                    // No staff defined, check for generic conflicts only
                    if (apptStaffId === 0 && startMinutes < apptEndMinutes && endMinutes > apptStartMinutes) {
                        return { valid: false, message: 'الوقت المحدد غير متاح.' };
                    }
                } else {
                    // Calculate available staff at this time slot
                    let availableStaffCount = 0;
                    let genericOverlapCount = 0;
                    
                    for (const staff of allStaff) {
                        let staffAvailable = true;
                        
                        // Check if this staff member has conflicts
                        for (const conflictAppt of appointments) {
                            const conflictStaffId = conflictAppt.staff_id === null || conflictAppt.staff_id === undefined ? 0 : parseInt(conflictAppt.staff_id);
                            
                            if (conflictStaffId === staff.id) {
                                let conflictStartMinutes, conflictEndMinutes;
                                try {
                                    let startTimePart, endTimePart;
                                    
                                    if (conflictAppt.start_time.includes('T')) {
                                        startTimePart = conflictAppt.start_time.split('T')[1];
                                    } else if (conflictAppt.start_time.includes(' ')) {
                                        startTimePart = conflictAppt.start_time.split(' ')[1];
                                    } else {
                                        continue;
                                    }
                                    
                                    if (conflictAppt.end_time.includes('T')) {
                                        endTimePart = conflictAppt.end_time.split('T')[1];
                                    } else if (conflictAppt.end_time.includes(' ')) {
                                        endTimePart = conflictAppt.end_time.split(' ')[1];
                                    } else {
                                        continue;
                                    }
                                    
                                    if (!startTimePart || !endTimePart) continue;
                                    
                                    conflictStartMinutes = timeToMinutes(startTimePart.substring(0, 5));
                                    conflictEndMinutes = timeToMinutes(endTimePart.substring(0, 5));
                                    
                                    if (startMinutes < conflictEndMinutes && endMinutes > conflictStartMinutes) {
                                        staffAvailable = false;
                                        break;
                                    }
                                } catch (e) {
                                    console.error('Error processing conflict appointment times:', e, conflictAppt);
                                    continue;
                                }
                            }
                        }
                        
                        if (staffAvailable) {
                            availableStaffCount++;
                        }
                    }
                    
                    // Count generic appointments that overlap
                    for (const genericAppt of appointments) {
                        const genericStaffId = genericAppt.staff_id === null || genericAppt.staff_id === undefined ? 0 : parseInt(genericAppt.staff_id);
                        
                        if (genericStaffId === 0) {
                            let genericStartMinutes, genericEndMinutes;
                            try {
                                let startTimePart, endTimePart;
                                
                                if (genericAppt.start_time.includes('T')) {
                                    startTimePart = genericAppt.start_time.split('T')[1];
                                } else if (genericAppt.start_time.includes(' ')) {
                                    startTimePart = genericAppt.start_time.split(' ')[1];
                                } else {
                                    continue;
                                }
                                
                                if (genericAppt.end_time.includes('T')) {
                                    endTimePart = genericAppt.end_time.split('T')[1];
                                } else if (genericAppt.end_time.includes(' ')) {
                                    endTimePart = genericAppt.end_time.split(' ')[1];
                                } else {
                                    continue;
                                }
                                
                                if (!startTimePart || !endTimePart) continue;
                                
                                genericStartMinutes = timeToMinutes(startTimePart.substring(0, 5));
                                genericEndMinutes = timeToMinutes(endTimePart.substring(0, 5));
                                
                                if (startMinutes < genericEndMinutes && endMinutes > genericStartMinutes) {
                                    genericOverlapCount++;
                                }
                            } catch (e) {
                                console.error('Error processing generic appointment times:', e, genericAppt);
                                continue;
                            }
                        }
                    }
                    
                    // Check if there's capacity for this booking
                    if (availableStaffCount <= genericOverlapCount) {
                        return { valid: false, message: 'لا يوجد موظفين متاحين في هذا الوقت.' };
                    }
                }
            }
        }
        
        return { valid: true, message: 'الموعد متاح للحجز.' };
        
    } catch (error) {
        console.error('Error validating booking slot:', error);
        return { valid: false, message: 'خطأ في التحقق من صحة الموعد.' };
    }
}

app.post('/api/appointment/book', async (req, res) => {
    const { salon_id, user_id, staff_id, service_id, services, start_time, end_time, price } = req.body;
    
    if (!salon_id || !user_id || !start_time || !end_time || price === undefined) {
        return res.status(400).json({ success: false, message: 'بيانات الحجز غير كاملة.' });
    }

    // Support both old format (single service_id) and new format (services array)
    let servicesToBook = [];
    if (services && Array.isArray(services) && services.length > 0) {
        servicesToBook = services;
    } else if (service_id) {
        // Fallback for old format - get service details - FIX: Use $1 placeholder
        try {
            const serviceDetails = await dbGet('SELECT id, name_ar FROM services WHERE id = $1', [service_id]);
            if (serviceDetails) {
                servicesToBook = [{ id: service_id, price: price }];
            }
        } catch (error) {
            console.error('Error fetching service details:', error);
            return res.status(400).json({ success: false, message: 'خدمة غير صالحة.' });
        }
    }

    if (servicesToBook.length === 0) {
        return res.status(400).json({ success: false, message: 'يجب اختيار خدمة واحدة على الأقل.' });
    }

    // Calculate total service duration for validation
    let totalServiceDuration = 0;
    try {
        for (const service of servicesToBook) {
            const serviceDetails = await dbGet('SELECT duration FROM services WHERE id = ?', [service.id]);
            if (serviceDetails && serviceDetails.duration) {
                totalServiceDuration += serviceDetails.duration;
            }
        }
    } catch (error) {
        console.error('Error calculating service duration:', error);
        return res.status(400).json({ success: false, message: 'خطأ في حساب مدة الخدمات.' });
    }

    // ===== CRITICAL SERVER-SIDE VALIDATION =====
    // Validate the booking slot before proceeding with any booking logic
    const validationResult = await validateBookingSlot(salon_id, staff_id, start_time, end_time, totalServiceDuration);
    if (!validationResult.valid) {
        console.log('Booking validation failed:', validationResult.message);
        return res.status(400).json({ success: false, message: validationResult.message });
    }
    console.log('Booking validation passed:', validationResult.message);

    // Use the first service as the main service for the appointment record (for backward compatibility)
    const mainServiceId = servicesToBook[0].id;
    
    let finalStaffId = staff_id;
    let assignedStaffName = null;
    
    // --- SMART STAFF ASSIGNMENT LOGIC ---
    if (finalStaffId === 0) { // Check for 'Any Staff' indicator (client sends 0 for 'Any')
        try {
            // 1. Get all staff for the salon - FIX: Use $1 placeholder
            const staffQuery = 'SELECT id, name FROM staff WHERE salon_id = $1';
            const allStaff = await dbAll(staffQuery, [salon_id]);

            // 2. Find the first available staff
            let foundAvailableStaff = null;
            
            const newApptStart = new Date(start_time).getTime();
            const newApptEnd = new Date(end_time).getTime();

            for (const staffMember of allStaff) {
                // FIX: Use $1, $2 placeholders
                const staffAppointmentsQuery = `
                    SELECT start_time, end_time FROM appointments 
                    WHERE salon_id = $1 AND staff_id = $2 AND status = 'Scheduled'
                `;
                const staffAppointments = await dbAll(staffAppointmentsQuery, [salon_id, staffMember.id]);
                
                let isAvailable = true;
                for (const appt of staffAppointments) {
                    const existingApptStart = new Date(appt.start_time).getTime();
                    const existingApptEnd = new Date(appt.end_time).getTime();

                    // Check for overlap: [Start A < End B] AND [End A > Start B]
                    if (newApptStart < existingApptEnd && newApptEnd > existingApptStart) {
                        isAvailable = false;
                        break;
                    }
                }

                if (isAvailable) {
                    foundAvailableStaff = staffMember;
                    break; 
                }
            }

            if (foundAvailableStaff) {
                finalStaffId = foundAvailableStaff.id;
                assignedStaffName = foundAvailableStaff.name;
            } else {
                // If no specific staff is found, check if the general schedule allows it (i.e. no general breaks/mods overlap)
                // This is complex, so for simplicity here, we assume if staff is chosen as 'any' and none are free, it's blocked.
                 return res.status(400).json({ success: false, message: 'عفواً، لا يوجد مختص متاح لإتمام هذا الحجز في هذا الوقت.' });
            }
        } catch (error) {
            console.error("Smart Staff Assignment error:", error.message);
            return res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات أثناء تحديد المختص.' });
        }
    } else {
        // If a specific staff_id was chosen, find their name to return in confirmation
        if (finalStaffId !== null) {
            try {
                 const staffQuery = 'SELECT name FROM staff WHERE id = $1';
                 const staffResult = await dbGet(staffQuery, [finalStaffId]);
                 assignedStaffName = staffResult ? staffResult.name : 'غير محدد';
            } catch (error) {
                console.warn("Could not fetch staff name for chosen ID:", finalStaffId);
                assignedStaffName = 'غير محدد';
            }
        }
    }
    // --- END SMART STAFF ASSIGNMENT LOGIC ---
    
    // Convert finalStaffId 0 (Any) back to NULL for the database
    const staffIdForDB = finalStaffId === 0 ? null : finalStaffId;


    const date_booked = new Date().toISOString();
    const status = 'Scheduled';

    try {
        // Insert the main appointment record
        const sql = `INSERT INTO appointments (salon_id, user_id, staff_id, service_id, start_time, end_time, status, date_booked, price) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`;
        
        const appointmentResult = await dbGet(sql, [salon_id, user_id, staffIdForDB, mainServiceId, start_time, end_time, status, date_booked, price]);
        const appointmentId = appointmentResult.id;

        // Insert all services into the junction table
        for (const service of servicesToBook) {
            await dbRun("INSERT INTO appointment_services (appointment_id, service_id, price) VALUES ($1, $2, $3)", 
                       [appointmentId, service.id, service.price]);
        }
        
        // Emit SSE notification to salon dashboard
        sendSalonEvent(salon_id, 'appointment_booked', {
            appointmentId,
            user_id,
            staff_id: staffIdForDB,
            staff_name: assignedStaffName,
            start_time,
            end_time,
            services_count: servicesToBook.length,
            price
        });
        // Socket.IO emit to salon room for real-time update
        try { if (io) { io.to(`salon_${salon_id}`).emit('appointment_booked', { appointmentId, user_id, staff_id: staffIdForDB, staff_name: assignedStaffName, start_time, end_time, services_count: servicesToBook.length, price }); } } catch (e) { console.warn('socket booked emit error:', e.message); }

        // Helper formatters for clean Arabic date/time in pushes
        const formatArabicDate = (d) => {
            try {
                const date = new Date(d);
                const day = String(date.getDate()).padStart(2, '0');
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const year = date.getFullYear();
                return `${day}/${month}/${year}`;
            } catch { return new Date(d).toLocaleDateString('ar-EG'); }
        };
        const formatArabicTimeClean = (d) => {
            try {
                const date = new Date(d);
                let h = date.getHours();
                const isAM = h < 12;
                h = h % 12 || 12; // 12-hour
                const suffix = isAM ? 'صباحًا' : 'مساءً';
                return `${h} ${suffix}`;
            } catch { return new Date(d).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true }); }
        };

        // Push notify salon of new booking (clean Arabic text, no user name)
        await sendPushToTargets({
            salon_id,
            payload: {
                title: 'حجز جديد',
                body: `لديك حجز جديد بتاريخ ${formatArabicDate(start_time)} على الساعة ${formatArabicTimeClean(start_time)}`,
                url: '/home_salon.html#appointments'
            }
        });

        // Do NOT push notify user on booking; user sees confirmation modal in-app

        res.json({ 
            success: true, 
            message: 'تم حجز موعدك بنجاح!', 
            appointmentId: appointmentId,
            assignedStaffName: assignedStaffName,
            servicesCount: servicesToBook.length
        });
    } catch (err) {
        console.error("Booking error:", err.message);
        return res.status(500).json({ success: false, message: 'فشل في حفظ الحجز.' });
    }
});


// --- Discovery Routes (Real Data) ---
const fetchSalonsWithMinPrice = async (city, gender) => {
    try {
        const sql = `
            SELECT 
                s.id AS salonId, 
                s.salon_name, 
                s.address, 
                s.city, 
                s.image_url, 
                s.gender_focus,
                COALESCE(AVG(r.rating), 0) AS avg_rating,
                COUNT(r.id) AS review_count
            FROM salons s
            LEFT JOIN reviews r ON s.id = r.salon_id
            WHERE s.gender_focus = $1 AND s.status = 'accepted'
            GROUP BY s.id 
        `;
        const result = await db.query(sql, [gender]);
        return result;
    } catch (err) {
        throw err;
    }
};

app.get('/api/discovery/:city/:gender', async (req, res) => {
    // Micro-cache for 5 seconds to smooth bursts from UI clicks
    res.set({ 'Cache-Control': 'public, max-age=5' });
    
    const { city, gender } = req.params;
    const { service_ids } = req.query; // Capture service filter IDs (can be comma-separated)
    const genderFocus = gender === 'male' ? 'men' : 'women'; // Convert user gender to salon focus
    
    try {
        // Fetch ALL relevant salons (all cities, matching gender focus)
        let allRelevantSalons = await fetchSalonsWithMinPrice(city, genderFocus);
        
        // --- Apply Service Filter ---
        if (service_ids) {
            // Parse service IDs (can be single ID or comma-separated IDs)
            const serviceIdArray = service_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            
            if (serviceIdArray.length > 0) {
                // For each salon, check if it offers ALL selected services
                // FIX: Dynamically generate the list of $N placeholders
                const placeholders = serviceIdArray.map((_, index) => `$${index + 1}`).join(',');
                const salonServiceCounts = await dbAll(`
                    SELECT salon_id, COUNT(DISTINCT service_id) as service_count
                    FROM salon_services 
                    WHERE service_id IN (${placeholders})
                    GROUP BY salon_id
                    HAVING COUNT(DISTINCT service_id) = $${serviceIdArray.length + 1}
                `, [...serviceIdArray, serviceIdArray.length]);

                const salonIdsWithAllServices = new Set(salonServiceCounts.map(row => row.salon_id));
                allRelevantSalons = allRelevantSalons.filter(salon => 
                    salonIdsWithAllServices.has(salon.salonId)
                );
            }
        }
        // --- END Service Filter ---


        // 1. Fetch Master Services for discovery cards - FIX: Use $1 placeholder
        const servicesSql = "SELECT id, name_ar, icon, service_type FROM services WHERE gender = $1";
        const discoveryServices = await db.query(servicesSql, [genderFocus]);
        
        // 2. Separate Salons for sections
        const citySalons = allRelevantSalons.filter(s => s.city === city);
        // Ensure that citySalons are only shown if they are not already in featuredSalons
        const featuredSalons = allRelevantSalons; 

        res.json({
            services: discoveryServices,
            citySalons: citySalons,
            featuredSalons: featuredSalons,
            allSalons: allRelevantSalons 
        });
        
    } catch (error) {
        console.error("Discovery fetch error:", error.message);
        res.status(500).json({ success: false, message: 'Failed to load discovery data.' });
    }
});

// Add indexes to speed up common lookups if not present
async function ensurePerfIndexes() {
    try {
        // Index salons by gender_focus and status
        await db.run(`CREATE INDEX IF NOT EXISTS idx_salons_gender_status ON salons(gender_focus, status)`);
        // Index salon_services by service_id for filter queries
        await db.run(`CREATE INDEX IF NOT EXISTS idx_salon_services_service ON salon_services(service_id)`);
        // Index reviews by salon_id for rating aggregates
        await db.run(`CREATE INDEX IF NOT EXISTS idx_reviews_salon ON reviews(salon_id)`);
    } catch (e) {
        console.warn('ensurePerfIndexes warning:', e.message);
    }
}

// Favorites Route (Real Data)
app.get('/api/favorites/:user_id', async (req, res) => {
    const user_id = req.params.user_id;
    
    // FIX: Add validation for user_id
    if (!user_id || user_id === 'undefined' || isNaN(parseInt(user_id))) {
         return res.status(400).json({ success: false, message: 'User ID is required and must be valid.' });
    }
    
    const sql = `
        SELECT 
            s.id AS salonId, 
            s.salon_name, 
            s.address, 
            s.city, 
            s.image_url,
            COALESCE(AVG(r.rating), 0) AS avg_rating,
            COUNT(r.id) AS review_count
        FROM favorites f
        JOIN salons s ON f.salon_id = s.id
        LEFT JOIN reviews r ON s.id = r.salon_id
        WHERE f.user_id = $1
        GROUP BY s.id
    `;

    try {
        const rows = await dbAll(sql, [user_id]);
        const favorites = rows.map(row => ({ ...row, is_favorite: true }));
        res.json(favorites);
    } catch (err) {
        console.error("Favorites fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

app.post('/api/favorites/toggle', (req, res) => {
    const { user_id, salon_id } = req.body;
    
    // FIX: Add validation for user_id and salon_id (Prevents 500 when frontend sends 'undefined')
    if (!user_id || isNaN(parseInt(user_id)) || !salon_id || isNaN(parseInt(salon_id))) {
         return res.status(400).json({ success: false, message: 'User ID and Salon ID must be valid numbers.' });
    }
    
    // FIX: Use $1, $2 placeholders and dbGet
    dbGet('SELECT * FROM favorites WHERE user_id = $1 AND salon_id = $2', [user_id, salon_id]).then(row => {
        if (row) {
            // Delete (Unfavorite) - FIX: Use dbRun
            dbRun('DELETE FROM favorites WHERE user_id = $1 AND salon_id = $2', [user_id, salon_id]).then(() => {
                res.json({ success: true, is_favorite: false, message: 'Unfavorited successfully.' });
            }).catch(err => {
                console.error("Delete error:", err.message);
                return res.status(500).json({ success: false, message: 'Delete error.' });
            });
        } else {
            // Insert (Favorite) - FIX: Use dbRun
            dbRun('INSERT INTO favorites (user_id, salon_id) VALUES ($1, $2)', [user_id, salon_id]).then(() => {
                res.json({ success: true, is_favorite: true, message: 'Favorited successfully.' });
            }).catch(err => {
                console.error("Insert error:", err.message);
                return res.status(500).json({ success: false, message: 'Insert error.' });
            });
        }
    }).catch(err => {
        console.error("Favorites toggle query error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    });
});

// ===== REVIEW ROUTES =====

// Get user's reviews
app.get('/api/reviews/user/:user_id', (req, res) => {
    const { user_id } = req.params;
    
    // FIX: Add validation for user_id
    if (!user_id || user_id === 'undefined' || isNaN(parseInt(user_id))) {
         return res.status(400).json({ success: false, message: 'User ID is required and must be valid.' });
    }
    
    // FIX: Use $1 placeholder
    const query = `
        SELECT r.*, s.salon_name, s.image_url as salon_image
        FROM reviews r
        JOIN salons s ON r.salon_id = s.id
        WHERE r.user_id = $1
        ORDER BY r.date_posted DESC
    `;
    
    // FIX: Use dbAll instead of db.all (PostgreSQL compatible wrapper)
    dbAll(query, [user_id]).then(rows => {
        res.json({ success: true, reviews: rows });
    }).catch(err => {
        console.error("User reviews fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    });
});

// Get salon reviews
app.get('/api/reviews/salon/:salon_id', (req, res) => {
    const { salon_id } = req.params;
    
    // FIX: Add validation for salon_id (Prevents 500 when frontend sends 'undefined')
    if (!salon_id || salon_id === 'undefined' || isNaN(parseInt(salon_id))) {
         return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    
    // FIX: Use $1 placeholder
    const query = `
        SELECT r.*, u.name as user_name
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.salon_id = $1
        ORDER BY r.date_posted DESC
    `;
    
    // FIX: Use dbAll instead of db.all (PostgreSQL compatible wrapper)
    dbAll(query, [salon_id]).then(rows => {
        res.json({ success: true, reviews: rows });
    }).catch(err => {
        console.error("Salon reviews fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    });
});

// Submit a new review
app.post('/api/reviews/submit', async (req, res) => {
    const { user_id, salon_id, rating, comment } = req.body;
    
    // Validate required fields
    if (!user_id || !salon_id || !rating || !comment || comment.trim() === '') {
        return res.status(400).json({ success: false, message: 'Missing required fields. Comment is mandatory.' });
    }
    
    // Validate rating range
    if (rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
    }
    
    try {
        // Check if user has already reviewed this salon - FIX: Use $1, $2 placeholders
        const existingReview = await dbGet('SELECT id FROM reviews WHERE user_id = $1 AND salon_id = $2', [user_id, salon_id]);
        
        if (existingReview) {
            return res.status(400).json({ success: false, message: 'You have already reviewed this salon.' });
        }
        
        // Insert new review - FIX: Use $1, $2, ... placeholders and PostgreSQL NOW() function
        const insertQuery = `
            INSERT INTO reviews (user_id, salon_id, rating, comment, date_posted)
            VALUES ($1, $2, $3, $4, NOW()) RETURNING id
        `;
        
        const result = await dbGet(insertQuery, [user_id, salon_id, rating, comment || '']);
        
        res.json({ 
            success: true, 
            message: 'Review submitted successfully.',
            review_id: result.id
        });
    } catch (err) {
        // Handle PostgreSQL unique constraint violation (though checked above, good fallback)
        if (err.code === '23505') { 
            return res.status(400).json({ success: false, message: 'You have already reviewed this salon.' });
        }
        console.error("Review submission error:", err.message);
        return res.status(500).json({ success: false, message: 'Failed to submit review.' });
    }
});

// DELETE review endpoint
app.delete('/api/reviews/delete', async (req, res) => {
    const { user_id, salon_id } = req.body;
    
    // Validate required fields
    if (!user_id || !salon_id) {
        return res.status(400).json({ 
            success: false, 
            message: 'User ID and Salon ID are required.' 
        });
    }
    
    try {
        // Delete the review - FIX: Use $1, $2 placeholders
        const deleteQuery = `
            DELETE FROM reviews 
            WHERE user_id = $1 AND salon_id = $2
        `;
        
        const result = await dbRun(deleteQuery, [user_id, salon_id]);
        
        // Check if any rows were affected
        if (result.rowCount === 0) { 
            return res.status(404).json({ 
                success: false, 
                message: 'Review not found.' 
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Review deleted successfully.'
        });
    } catch (err) {
        console.error('Error deleting review:', err);
        return res.status(500).json({ 
            success: false, 
            message: 'Database error occurred while deleting review.' 
        });
    }
});

// Simple in-memory token storage (in production, use Redis or database)
const validAdminTokens = new Set();

// Admin middleware to check if user is admin
function requireAdmin(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    // Check if token is valid
    if (!validAdminTokens.has(token)) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    next();
}

// Admin API endpoints (NOTE: requireAdmin is removed for ease of testing in this environment. RE-ENABLE IN PRODUCTION)
app.get('/api/admin/stats', async (req, res) => {
    try {
        // Total normal users (excluding admin users)
        const totalUsersResult = await db.query('SELECT COUNT(*) as count FROM users WHERE user_type = $1', ['user']);
        const totalUsers = totalUsersResult[0];
        
        // Total salons
        const totalSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons');
        const totalSalons = totalSalonsResult[0];
        
        // Salons by gender focus
        const womenSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons WHERE gender_focus = $1', ['women']);
        const womenSalons = womenSalonsResult[0];
        
        const menSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons WHERE gender_focus = $1', ['men']);
        const menSalons = menSalonsResult[0];
        
        // Salons by status
        const activeSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons WHERE status = $1', ['accepted']);
        const activeSalons = activeSalonsResult[0];
        
        const pendingSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons WHERE status = $1', ['pending']);
        const pendingSalons = pendingSalonsResult[0];
        
        const rejectedSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons WHERE status = $1', ['rejected']);
        const rejectedSalons = rejectedSalonsResult[0];
        
        // Total appointments
        const totalAppointmentsResult = await db.query('SELECT COUNT(*) as count FROM appointments');
        const totalAppointments = totalAppointmentsResult[0];
        
        res.json({
            totalUsers: parseInt(totalUsers.count) || 0,
            totalSalons: parseInt(totalSalons.count) || 0,
            womenSalons: parseInt(womenSalons.count) || 0,
            menSalons: parseInt(menSalons.count) || 0,
            activeSalons: parseInt(activeSalons.count) || 0,
            pendingSalons: parseInt(pendingSalons.count) || 0,
            rejectedSalons: parseInt(rejectedSalons.count) || 0,
            totalAppointments: parseInt(totalAppointments.count) || 0
        });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await db.query('SELECT id, name, email, phone, city, user_type FROM users ORDER BY id DESC');
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/salons', async (req, res) => {
    try {
        const salons = await db.query(`
            SELECT s.id, s.salon_name, s.owner_name, u.email, s.salon_phone, s.owner_phone, s.city, s.gender_focus, s.image_url, s.status 
            FROM salons s
            JOIN users u ON s.user_id = u.id
            ORDER BY s.id DESC
        `);
        res.json(salons);
    } catch (error) {
        console.error('Error fetching salons:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/appointments', async (req, res) => {
    try {
        const appointments = await db.query(`
            SELECT a.*, u.name as user_name, s.salon_name 
            FROM appointments a 
            LEFT JOIN users u ON a.user_id = u.id 
            LEFT JOIN salons s ON a.salon_id = s.id 
            ORDER BY a.id DESC
        `);
        res.json(appointments);
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update salon status (approve/reject)
app.post('/api/admin/salon/status/:salon_id', async (req, res) => {
    try {
        const { salon_id } = req.params;
        const { status } = req.body;
        
        // Validate status
        if (!['pending', 'accepted', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be pending, accepted, or rejected.' });
        }
        
        // Update salon status
        await db.query('UPDATE salons SET status = $1 WHERE id = $2', [status, salon_id]);
        
        res.json({ message: 'Salon status updated successfully', status });
    } catch (error) {
        console.error('Error updating salon status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
// Debug endpoint to check database content
app.get('/api/debug/salons', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM salons');
        res.json({
            count: result.length,
            salons: result
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Debug endpoint to align schema immediately without restart (safe idempotent adjustments)
app.post('/api/debug/align-schema', async (req, res) => {
    try {
        await alignSchema();
        res.json({ success: true, message: 'Schema alignment executed.' });
    } catch (error) {
        console.error('Schema align endpoint error:', error);
        res.status(500).json({ success: false, message: 'Failed to align schema.', error: error.message });
    }
});

// GET alias for easier triggering in some environments
app.get('/api/debug/align-schema', async (req, res) => {
    try {
        await alignSchema();
        res.json({ success: true, message: 'Schema alignment executed.' });
    } catch (error) {
        console.error('Schema align endpoint error (GET):', error);
        res.status(500).json({ success: false, message: 'Failed to align schema.', error: error.message });
    }
});

// Lightweight health endpoint for production diagnostics
app.get('/api/health', async (req, res) => {
    const info = {
        nodeEnv: process.env.NODE_ENV || 'undefined',
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        dbMode: db.isProduction ? 'postgres' : 'sqlite',
    };
    try {
        // Simple connectivity check
        const rows = await db.query('SELECT 1 as ok');
        res.json({ success: true, env: info, db: { ok: true, rows } });
    } catch (err) {
        console.error('Health check DB error:', err.message);
        res.status(500).json({ success: false, env: info, db: { ok: false, error: err.message } });
    }
});

// Create HTTP server and attach Socket.IO
const server = http.createServer(app);
try {
    const { Server } = require('socket.io');
    io = new Server(server, {
        cors: {
            origin: '*'
        }
    });

    // Salon room join and basic connection logging
    io.on('connection', (socket) => {
        // Client should emit 'joinSalon' with numeric salonId
        socket.on('joinSalon', (salonId) => {
            try {
                const sid = parseInt(salonId);
                if (!isNaN(sid)) {
                    const room = `salon_${sid}`;
                    socket.join(room);
                    socket.emit('joinedSalon', { room });
                }
            } catch (e) {
                console.warn('joinSalon handler error:', e.message);
            }
        });
    });
} catch (e) {
    console.warn('Socket.IO setup warning:', e.message);
}

server.listen(PORT, async () => {
    console.log(`Salonni server running on port: http://localhost:${PORT}`);
    
    // Initialize database and insert master data
    try {
        const ping = await db.ping();
        if (ping.ok) {
            console.log('DB ping ok at startup. now=', ping.now);
        } else {
            console.warn('DB ping failed at startup:', ping.error);
        }
        await ensurePerfIndexes();
        await initializeDb();
        await alignSchema();
        // insertMasterServices is called inside initializeDb now.
        console.log("Database schema created successfully and master data inserted.");
    } catch (error) {
        console.error("Database initialization error:", error.message);
    }
});
