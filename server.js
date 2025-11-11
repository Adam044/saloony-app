// Server.js - Salonni Application Backend
const express = require('express');
const http = require('http');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors'); // CORS
const helmet = require('helmet'); // Security headers
const rateLimit = require('express-rate-limit'); // Rate limiting
const crypto = require('crypto'); // Used for generating simple tokens/salts
const bcrypt = require('bcrypt'); // Secure password hashing
const compression = require('compression'); // Enable gzip compression for responses
const db = require('./database'); // Import our database module
const nodemailer = require('nodemailer'); // Email sending for Contact Us
const webPush = require('web-push'); // Web Push notifications
const multer = require('multer'); // File upload handling
const fs = require('fs'); // File system for saving uploads
const sharp = require('sharp'); // Image optimization
const { createClient } = require('@supabase/supabase-js'); // Supabase client
const { aiAssistant } = require('./ai-chat-assistant'); // AI Chat Assistant Module
const jwt = require('jsonwebtoken'); // JWT issuance and verification
const { z } = require('zod'); // Schema validation
require('dotenv').config(); // Load environment variables (.env)

// Initialize Supabase client for storage
const supabase = createClient(
    process.env.SUPABASE_URL || 'your-supabase-url',
    process.env.SUPABASE_ANON_KEY || 'your-supabase-anon-key'
);

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

// Auth configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    if (NODE_ENV === 'production') {
        console.error('FATAL: Missing JWT_SECRET in environment. Refusing to start in production.');
        process.exit(1);
    } else {
        // Generate a temporary secret for local development to avoid hardcoding
        JWT_SECRET = crypto.randomBytes(32).toString('hex');
        console.warn('WARNING: No JWT_SECRET set. Generated a temporary dev secret. Set JWT_SECRET in your .env for stability.');
    }
}
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 7);

// --- Core Data: Cities ---

const CITIES = [
    // Major Cities (Original)
    'القدس', 'رام الله', 'الخليل', 'نابلس', 'بيت لحم', 'غزة',
    'جنين', 'طولكرم', 'قلقيلية', 'أريحا', 'رفح', 'خان يونس',
    'دير البلح', 'الناصرة', 'حيفا', 'عكا', 'طبريا', 'صفد',
    'عبسان الكبيرة', 'أبو ديس', 'بني نعيم', 'بني سهيلا', 'بيت حانون',
    'بيت جالا', 'بيت لاهيا', 'بيت ساحور', 'بيت أمر', 'بيتونيا',
    'البيرة', 'الظاهرية', 'دورا', 'مدينة غزة', 'حلحول', 'إذنا',
    'جباليا', 'قباطية', 'سعير', 'سلفيت', 'السموع', 'صوريف',
    'طوباس', 'يعبد', 'اليمون', 'يطا', 'الزوايدة'
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

// Validate phone number format (must start with 0 and be exactly 10 digits)
function validatePhoneFormat(phone) {
    if (!phone) return true; // Allow empty for optional fields
    const phonePattern = /^0[0-9]{9}$/;
    return phonePattern.test(phone);
}

// Normalize phone numbers to a canonical form for duplicate checks and login.
// Strategy:
// - Remove all non-digits
// - Strip leading international prefixes and country codes (00, +970, +972)
// - Strip trunk leading zero
// - Compare by last 10 digits (operator+subscriber), which unifies formats like:
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
    // Unify to last 10 digits
    if (digits.length > 10) digits = digits.slice(-10);
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
            email TEXT UNIQUE,
            phone TEXT,
            gender TEXT,
            city TEXT,
            password TEXT NOT NULL,
            strikes INTEGER DEFAULT 0,
            user_type TEXT DEFAULT 'user',
            language_preference VARCHAR(10) DEFAULT 'auto'
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'pending',
            plan VARCHAR(30),
            plan_chairs INTEGER DEFAULT 1,
            special BOOLEAN DEFAULT FALSE,
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

        // Storage: optimized images linked to salons
        await db.run(`CREATE TABLE IF NOT EXISTS salon_images (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            image_path TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            size_bytes INTEGER,
            mime_type TEXT,
            is_primary BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
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

        await db.run('')

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

        // Create payments table for tracking salon payments and offers
        await db.run(`CREATE TABLE IF NOT EXISTS payments (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            payment_type VARCHAR(50) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            currency VARCHAR(3) DEFAULT 'ILS',
            payment_status VARCHAR(20) DEFAULT 'completed',
            payment_method VARCHAR(50),
            description TEXT,
            valid_from DATE,
            valid_until DATE,
            invoice_number VARCHAR(50) UNIQUE,
            admin_notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
        )`);

        // Create indexes for payments table
        await db.run(`CREATE INDEX IF NOT EXISTS idx_payments_salon_id ON payments(salon_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(payment_type)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at)`);

        // Create salon_locations table (one location per salon for now)
        await db.run(`CREATE TABLE IF NOT EXISTS salon_locations (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL UNIQUE,
            address TEXT,
            city TEXT,
            latitude DECIMAL(9,6),
            longitude DECIMAL(9,6),
            place_id TEXT,
            formatted_address TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_salon_locations_salon_id ON salon_locations(salon_id)`);

        // Create role system tables for salon staff management
        await db.run(`CREATE TABLE IF NOT EXISTS salon_roles (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL UNIQUE,
            roles_enabled BOOLEAN DEFAULT FALSE,
            session_duration_hours INTEGER DEFAULT 24,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS staff_roles (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            staff_id INTEGER NOT NULL,
            role_type VARCHAR(20) NOT NULL CHECK (role_type IN ('admin', 'staff')),
            pin_hash VARCHAR(255) NOT NULL,
            biometric_enabled BOOLEAN DEFAULT FALSE,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE,
            FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
            UNIQUE(salon_id, staff_id)
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS role_sessions (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            staff_role_id INTEGER NOT NULL,
            session_token VARCHAR(255) NOT NULL UNIQUE,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE,
            FOREIGN KEY (staff_role_id) REFERENCES staff_roles(id) ON DELETE CASCADE
        )`);

        // Create indexes for role system tables
        await db.run(`CREATE INDEX IF NOT EXISTS idx_salon_roles_salon_id ON salon_roles(salon_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_staff_roles_salon_id ON staff_roles(salon_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_staff_roles_staff_id ON staff_roles(staff_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_role_sessions_token ON role_sessions(session_token)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_role_sessions_expires ON role_sessions(expires_at)`);

        // Create AI chat messages table for analytics and conversation history
        await db.run(`CREATE TABLE IF NOT EXISTS ai_chat_messages (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(50),
            user_message TEXT NOT NULL,
            ai_response TEXT NOT NULL,
            language_detected VARCHAR(10) DEFAULT 'auto',
            session_id TEXT,
            response_time_ms INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )`);

        // Create AI Analytics Tables (Optimized for Performance)
        await db.run(`CREATE TABLE IF NOT EXISTS ai_token_usage (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(50),
            model VARCHAR(20) DEFAULT 'deepseek-chat',
            input_tokens SMALLINT DEFAULT 0,
            output_tokens SMALLINT DEFAULT 0,
            total_tokens SMALLINT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS conversation_analytics (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(50),
            message_length SMALLINT,
            response_length SMALLINT,
            language CHAR(2) DEFAULT 'ar',
            response_time SMALLINT DEFAULT 0,
            salon_context_used BOOLEAN DEFAULT FALSE,
            recommendations_shown SMALLINT DEFAULT 0,
            error_occurred BOOLEAN DEFAULT FALSE,
            session_id VARCHAR(100),
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS user_preferences (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(50),
            category VARCHAR(30),
            preference VARCHAR(50),
            context TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, category, preference)
        )`);

        // Create indexes for AI chat messages table
        await db.run(`CREATE INDEX IF NOT EXISTS idx_ai_chat_user_id ON ai_chat_messages(user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_ai_chat_created_at ON ai_chat_messages(created_at)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_ai_chat_session_id ON ai_chat_messages(session_id)`);

        // Create indexes for AI analytics tables (separate statements for PostgreSQL)
        await db.run(`CREATE INDEX IF NOT EXISTS idx_token_usage_user_date ON ai_token_usage(user_id, created_at)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_conversation_analytics_date ON conversation_analytics(timestamp)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_conversation_analytics_user ON conversation_analytics(user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_user_preferences_user_cat ON user_preferences(user_id, category)`);

        // Create social_links table (one entry per platform per salon)
        await db.run(`CREATE TABLE IF NOT EXISTS social_links (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            platform VARCHAR(20) NOT NULL CHECK (platform IN ('facebook','instagram','tiktok','other')),
            url TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(salon_id, platform),
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_social_links_salon ON social_links(salon_id)`);

        console.log("✅ Database schema created successfully (including optimized AI Analytics tables).");
        
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

            // 3.1) Ensure plan columns exist
            if (!columnSet.has('plan')) {
                console.log('AlignSchema: Adding plan column to salons (PostgreSQL)...');
                await db.run(`ALTER TABLE salons ADD COLUMN plan VARCHAR(30)`);
            }
            if (!columnSet.has('plan_chairs')) {
                console.log('AlignSchema: Adding plan_chairs column to salons (PostgreSQL)...');
                await db.run(`ALTER TABLE salons ADD COLUMN plan_chairs INTEGER DEFAULT 1`);
            }

            // 5) Ensure created_at column exists with default, and backfill if possible
            if (!columnSet.has('created_at')) {
                console.log('AlignSchema: Adding created_at column to salons (PostgreSQL)...');
                await db.run(`ALTER TABLE salons ADD COLUMN created_at TIMESTAMP DEFAULT NOW()`);
                try {
                    const locTable = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, ['public', 'salon_locations']);
                    if (locTable && locTable.length > 0) {
                        console.log('AlignSchema: Backfilling salons.created_at from salon_locations (PostgreSQL)...');
                        await db.run(`
                            UPDATE salons s
                            SET created_at = sl.created_at
                            FROM salon_locations sl
                            WHERE sl.salon_id = s.id
                              AND s.created_at IS NULL
                              AND sl.created_at IS NOT NULL
                        `);
                    }
                    // Fill any remaining NULLs with NOW()
                    await db.run(`UPDATE salons SET created_at = NOW() WHERE created_at IS NULL`);
                } catch (e) {
                    console.warn('AlignSchema: Backfill for salons.created_at warning:', e.message);
                    await db.run(`UPDATE salons SET created_at = NOW() WHERE created_at IS NULL`);
                }
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

            // Ensure salon_images has new optimization columns
            const salonImagesColumns = await db.query(
                `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2`,
                ['salon_images', 'public']
            );
            const salonImagesColSet = new Set(salonImagesColumns.map(c => c.column_name));
            
            if (!salonImagesColSet.has('format')) {
                console.log('AlignSchema: Adding format to salon_images (PostgreSQL)...');
                await db.run(`ALTER TABLE salon_images ADD COLUMN format TEXT`);
            }
            if (!salonImagesColSet.has('size_type')) {
                console.log('AlignSchema: Adding size_type to salon_images (PostgreSQL)...');
                await db.run(`ALTER TABLE salon_images ADD COLUMN size_type TEXT`);
            }
            if (!salonImagesColSet.has('supabase_path')) {
                console.log('AlignSchema: Adding supabase_path to salon_images (PostgreSQL)...');
                await db.run(`ALTER TABLE salon_images ADD COLUMN supabase_path TEXT`);
            }
            if (!salonImagesColSet.has('public_url')) {
                console.log('AlignSchema: Adding public_url to salon_images (PostgreSQL)...');
                await db.run(`ALTER TABLE salon_images ADD COLUMN public_url TEXT`);
            }

            // Ensure refresh_tokens table exists (for JWT refresh flow)
            try {
                await db.run(`
                    CREATE TABLE IF NOT EXISTS refresh_tokens (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        token_hash TEXT NOT NULL UNIQUE,
                        expires_at TIMESTAMP NOT NULL,
                        revoked BOOLEAN NOT NULL DEFAULT FALSE,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW()
                    )
                `);
            } catch (e) {
                console.warn('AlignSchema: refresh_tokens creation warning (PostgreSQL):', e.message);
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
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        status TEXT DEFAULT 'pending',
                        plan TEXT,
                        plan_chairs INTEGER DEFAULT 1,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                    )`);
                    console.log('AlignSchema: SQLite salons schema recreated successfully.');
                } else {
                    console.warn('AlignSchema: SQLite salons table has data; skipping destructive migration.');
                    // Non-destructive tweaks: add status if missing
                    if (!hasStatus) {
                        await db.run(`ALTER TABLE salons ADD COLUMN status TEXT DEFAULT 'pending'`);
                    }
                    // Add plan columns if missing
                    if (!columnSet.has('plan')) {
                        console.log('AlignSchema: Adding plan to salons (SQLite)...');
                        await db.run(`ALTER TABLE salons ADD COLUMN plan TEXT`);
                    }
                    if (!columnSet.has('plan_chairs')) {
                        console.log('AlignSchema: Adding plan_chairs to salons (SQLite)...');
                        await db.run(`ALTER TABLE salons ADD COLUMN plan_chairs INTEGER DEFAULT 1`);
                    }
                    // Add created_at column if missing
                    if (!columnSet.has('created_at')) {
                        console.log('AlignSchema: Adding created_at to salons (SQLite)...');
                        await db.run(`ALTER TABLE salons ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP`);
                        try {
                            const locPragma = await db.query(`PRAGMA table_info(salon_locations)`);
                            const locCols = new Set((locPragma || []).map(r => r.name));
                            if (locCols.has('created_at')) {
                                console.log('AlignSchema: Backfilling salons.created_at from salon_locations (SQLite)...');
                                await db.run(`
                                    UPDATE salons
                                    SET created_at = (
                                        SELECT created_at FROM salon_locations WHERE salon_locations.salon_id = salons.id
                                    )
                                    WHERE created_at IS NULL
                                `);
                            }
                            await db.run(`UPDATE salons SET created_at = (datetime('now')) WHERE created_at IS NULL`);
                        } catch (e) {
                            console.warn('AlignSchema: SQLite created_at backfill warning:', e.message);
                            await db.run(`UPDATE salons SET created_at = (datetime('now')) WHERE created_at IS NULL`);
                        }
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
                        email TEXT UNIQUE,
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

            // SQLite: Ensure salon_images has new optimization columns
            const salonImagesPragma = await db.query(`PRAGMA table_info(salon_images)`);
            const salonImagesColSet = new Set(salonImagesPragma.map(r => r.name));
            
            if (!salonImagesColSet.has('format')) {
                console.log('AlignSchema: Adding format to salon_images (SQLite)...');
                await db.run(`ALTER TABLE salon_images ADD COLUMN format TEXT`);
            }
            if (!salonImagesColSet.has('size_type')) {
                console.log('AlignSchema: Adding size_type to salon_images (SQLite)...');
                await db.run(`ALTER TABLE salon_images ADD COLUMN size_type TEXT`);
            }
            if (!salonImagesColSet.has('supabase_path')) {
                console.log('AlignSchema: Adding supabase_path to salon_images (SQLite)...');
                await db.run(`ALTER TABLE salon_images ADD COLUMN supabase_path TEXT`);
            }
            if (!salonImagesColSet.has('public_url')) {
                console.log('AlignSchema: Adding public_url to salon_images (SQLite)...');
                await db.run(`ALTER TABLE salon_images ADD COLUMN public_url TEXT`);
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

            // SQLite: Ensure refresh_tokens table exists
            try {
                await db.run(`
                    CREATE TABLE IF NOT EXISTS refresh_tokens (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        token_hash TEXT NOT NULL UNIQUE,
                        expires_at TEXT NOT NULL,
                        revoked INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
                    )
                `);
            } catch (e) {
                console.warn('AlignSchema: refresh_tokens creation warning (SQLite):', e.message);
            }
        }

        // Role system schema alignment for both PostgreSQL and SQLite
        if (db.isProduction) {
            // PostgreSQL: Check if role system tables exist and have proper constraints
            try {
                const roleTablesCheck = await db.query(`
                    SELECT table_name FROM information_schema.tables 
                    WHERE table_schema = 'public' AND table_name IN ('salon_roles', 'staff_roles', 'role_sessions')
                `);
                
                if (roleTablesCheck.length < 3) {
                    console.log('AlignSchema: Role system tables missing, they will be created on next restart...');
                } else {
                    // Check if salon_roles has unique constraint on salon_id
                    const constraintCheck = await db.query(`
                        SELECT constraint_name FROM information_schema.table_constraints 
                        WHERE table_name = 'salon_roles' AND constraint_type = 'UNIQUE'
                    `);
                    
                    if (constraintCheck.length === 0) {
                        console.log('AlignSchema: Adding unique constraint to salon_roles.salon_id (PostgreSQL)...');
                        await db.run(`ALTER TABLE salon_roles ADD CONSTRAINT salon_roles_salon_id_unique UNIQUE (salon_id)`);
                    }
                }
            } catch (error) {
                console.log('AlignSchema: Role system tables will be created on next restart if needed.');
            }
        } else {
            // SQLite: Check if role system tables exist
            try {
                const roleTablesCheck = await db.query(`
                    SELECT name FROM sqlite_master WHERE type='table' AND name IN ('salon_roles', 'staff_roles', 'role_sessions')
                `);
                
                if (roleTablesCheck.length < 3) {
                    console.log('AlignSchema: Role system tables missing, they will be created on next restart...');
                }
            } catch (error) {
                console.log('AlignSchema: Role system tables will be created on next restart if needed.');
            }
        }

        console.log('AlignSchema: Schema alignment completed successfully.');
    } catch (error) {
        console.error('AlignSchema error:', error.message || error);
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

// Security hardening
app.disable('x-powered-by');

// Configure CORS to only allow trusted origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
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
}));

// Security headers (CSP configured to allow existing CDNs and inline scripts)
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'default-src': ["'self'"],
            // Allow required external CDNs and inline scripts to preserve current look
            'script-src': [
                "'self'",
                'https://cdn.tailwindcss.com',
                'https://www.googletagmanager.com',
                'https://cdnjs.cloudflare.com',
                'https://cdn.jsdelivr.net',
                "'unsafe-inline'"
            ],
            // Match script-src for script elements explicitly
            'script-src-elem': [
                "'self'",
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
                'https://fonts.googleapis.com',
                'https://cdnjs.cloudflare.com',
                "'unsafe-inline'"
            ],
            // Match style-src for style elements explicitly
            'style-src-elem': [
                "'self'",
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
                'data:',
                'blob:',
                'https:',
                'https://tile.openstreetmap.org'
            ],
            // Allow inline event handlers to preserve current behavior
            'script-src-attr': ["'unsafe-inline'"],
            // Network requests restricted to same origin by default
            'connect-src': [
                "'self'",
                'https://www.google-analytics.com',
                'https://region1.google-analytics.com',
                'https://www.googletagmanager.com',
                'https://stats.g.doubleclick.net',
                // Allow service worker and pages to fetch external CDNs
                'https://cdn.tailwindcss.com',
                'https://cdnjs.cloudflare.com',
                'https://cdn.jsdelivr.net',
                'https://unpkg.com',
                'https://fonts.googleapis.com',
                'https://fonts.gstatic.com',
                // Geocoding provider (Nominatim / OpenStreetMap)
                'https://nominatim.openstreetmap.org',
                // Supabase APIs (storage, rest, realtime)
                'https://*.supabase.co',
                // Permit WebSocket connections
                'ws:',
                'wss:'
            ],
        }
    }
}));

// Additional security headers
app.use(helmet.frameguard({ action: 'deny' })); // Disallow embedding
app.use(helmet.referrerPolicy({ policy: 'no-referrer' })); // No referrer leakage
// Restrict powerful browser features
app.use((req, res, next) => {
    // Allow geolocation for this origin while keeping camera/microphone disabled
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    next();
});

// Global rate limiting (per IP)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', globalLimiter);

// Stricter limiter for auth and AI endpoints
const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false
});
app.use(['/api/auth', '/api/ai-chat'], authLimiter);

// Middleware setup
app.use(compression()); // Compress all responses to improve load times
app.use(bodyParser.json({ limit: '10mb' })); // Reasonable JSON body limit
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only image/jpeg, image/png, or image/webp are allowed'), false);
        }
    }
});

// ===============================
// ===== JWT Helpers & Middleware =====
function signAccessToken(userId, role) {
    return jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

async function storeRefreshToken(userId, refreshTokenPlain) {
    const hash = crypto.createHash('sha256').update(refreshTokenPlain).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await dbRun('INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked) VALUES ($1, $2, $3, FALSE)', [userId, hash, expiresAt]);
}

function authenticateJWT(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'Authorization header missing' });
    }
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = { id: payload.sub, role: payload.role };
        return next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function requireAuth(req, res, next) {
    return authenticateJWT(req, res, next);
}

// ===== Zod Schemas =====
const loginSchema = z.object({
    identifier: z.string().trim().min(3).optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().regex(/^0\d{9}$/).optional(),
    password: z.string().min(6)
}).refine((d) => !!(d.identifier || d.email || d.phone), {
    message: 'Email or phone is required',
    path: ['identifier']
});

const toNumber = (v) => (typeof v === 'string' ? Number(v) : v);

const bookingSchema = z.object({
    salon_id: z.preprocess(toNumber, z.number().int().positive()),
    user_id: z.any().optional(), // ignored; sourced from JWT
    staff_id: z.preprocess(toNumber, z.number().int().nonnegative()).optional(),
    service_id: z.preprocess(toNumber, z.number().int().positive()).optional(),
    services: z.array(z.object({
        id: z.preprocess(toNumber, z.number().int().positive()),
        price: z.preprocess(toNumber, z.number().nonnegative())
    })).optional(),
    start_time: z.string(),
    end_time: z.string(),
    price: z.preprocess(toNumber, z.number())
});

const reviewSchema = z.object({
    salon_id: z.preprocess(toNumber, z.number().int().positive()),
    rating: z.preprocess(toNumber, z.number().int().min(1).max(5)),
    comment: z.string().min(1)
});
// AI Beauty Assistant Endpoints
// ===============================

// === AI Analytics Dashboard ===

// AI Analytics Dashboard Route
app.get('/ai-analytics', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin', 'ai_analytics.html'));
});

// AI Analytics API Route
app.get('/api/ai-analytics', async (req, res) => {
    try {
        const timeframe = req.query.timeframe || '24h';
        
        // Get analytics from AI assistant
        const analytics = await aiAssistant.getConversationInsights(timeframe);
        
        if (analytics) {
            // Add token usage data
            const tokenUsage = await getTokenUsage(timeframe);
            analytics.tokens = tokenUsage;
            
            res.json({
                success: true,
                analytics: analytics,
                timeframe: timeframe,
                last_updated: new Date().toISOString()
            });
        } else {
            res.json({
                success: false,
                error: 'Failed to retrieve analytics data'
            });
        }
    } catch (error) {
        console.error('Analytics API error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Helper function to get token usage
async function getTokenUsage(timeframe) {
    try {
        const timeCondition = getTimeConditionForAnalytics(timeframe);
        
        const tokenStats = await dbGet(`
            SELECT 
                SUM(input_tokens) as total_input_tokens,
                SUM(output_tokens) as total_output_tokens,
                SUM(input_tokens + output_tokens) as total_tokens,
                AVG(input_tokens + output_tokens) as avg_tokens_per_request,
                COUNT(*) as total_requests
            FROM ai_token_usage 
            WHERE created_at > $1
        `, [timeCondition]);
        
        return {
            total: parseInt(tokenStats?.total_tokens) || 0,
            input: parseInt(tokenStats?.total_input_tokens) || 0,
            output: parseInt(tokenStats?.total_output_tokens) || 0,
            average: Math.round(tokenStats?.avg_tokens_per_request || 0),
            requests: parseInt(tokenStats?.total_requests) || 0
        };
    } catch (error) {
        console.warn('Failed to get token usage:', error);
        return {
            total: 0,
            input: 0,
            output: 0,
            average: 0,
            requests: 0
        };
    }
}

function getTimeConditionForAnalytics(timeframe) {
    const now = new Date();
    const conditions = {
        '1h': new Date(now.getTime() - 60 * 60 * 1000),
        '24h': new Date(now.getTime() - 24 * 60 * 60 * 1000),
        '7d': new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        '30d': new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    };
    return conditions[timeframe] || conditions['24h'];
}

// === AI Chat Endpoints ===

// Main AI Chat Endpoint
app.post('/api/ai-chat', async (req, res) => {
    try {
        const { message, user_id, context } = req.body;
        
        if (!message?.trim()) {
            return res.status(400).json({ 
                success: false, 
                error: 'الرسالة مطلوبة' 
            });
        }

        const result = await aiAssistant.processChat(message, user_id, context);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(500).json({
                success: false,
                error: result.error,
                fallback_response: result.fallback_response
            });
        }

    } catch (error) {
        console.error('AI Chat endpoint error:', error.message);
        res.status(500).json({
            success: false,
            error: 'عذراً، حدث خطأ في المساعد الذكي. يرجى المحاولة مرة أخرى.'
        });
    }
});

// Clear conversation history
app.post('/api/ai-chat/clear', async (req, res) => {
    try {
        const { user_id } = req.body;
        
        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'معرف المستخدم مطلوب'
            });
        }

        const result = aiAssistant.clearConversation(user_id);
        res.json(result);

    } catch (error) {
        console.error('Clear conversation error:', error.message);
        res.status(500).json({
            success: false,
            error: 'فشل في مسح المحادثة'
        });
    }
});

// Get conversation statistics
app.get('/api/ai-chat/stats/:user_id', async (req, res) => {
    try {
        const { user_id } = req.params;
        const result = await aiAssistant.getConversationStats(user_id);
        res.json(result);

    } catch (error) {
        console.error('Get conversation stats error:', error.message);
        res.status(500).json({
            success: false,
            error: 'فشل في جلب إحصائيات المحادثة'
        });
    }
});

// Learn from user interactions
app.post('/api/ai-chat/learn', async (req, res) => {
    try {
        const { user_id, interaction } = req.body;
        
        if (!user_id || !interaction) {
            return res.status(400).json({
                success: false,
                error: 'معرف المستخدم وبيانات التفاعل مطلوبة'
            });
        }

        const result = await aiAssistant.learnFromInteraction(user_id, interaction);
        
        res.json({
            success: true,
            message: 'تم تسجيل التفاعل بنجاح',
            preferences: result
        });

    } catch (error) {
        console.error('Learn interaction error:', error.message);
        res.status(500).json({
            success: false,
            error: 'عذراً، حدث خطأ في تسجيل التفاعل'
        });
    }
});


// --- Role Management System ---

// Helper functions for role system
async function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function hashPin(pin) {
    return await bcrypt.hash(pin.toString(), 10);
}

async function verifyPin(pin, hashedPin) {
    return await bcrypt.compare(pin.toString(), hashedPin);
}

async function cleanExpiredSessions() {
    try {
        await db.run('DELETE FROM role_sessions WHERE expires_at < CURRENT_TIMESTAMP');
    } catch (error) {
        console.error('Error cleaning expired sessions:', error);
    }
}

// Clean expired sessions every hour
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

// Get salon role configuration
app.get('/api/salon/roles/:salon_id', async (req, res) => {
    try {
        const salonId = req.params.salon_id;
        
        if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
            return res.status(400).json({ success: false, message: 'Valid salon ID is required.' });
        }

        // Get role configuration
        const roleConfig = await db.get(
            'SELECT * FROM salon_roles WHERE salon_id = $1',
            [salonId]
        );

        // Get staff roles if roles are enabled
        let staffRoles = [];
        if (roleConfig && roleConfig.roles_enabled) {
            staffRoles = await db.query(`
                SELECT sr.*, s.name as staff_name 
                FROM staff_roles sr 
                JOIN staff s ON sr.staff_id = s.id 
                WHERE sr.salon_id = $1 AND sr.is_active = TRUE
                ORDER BY sr.role_type, s.name
            `, [salonId]);
        }

        res.json({
            success: true,
            config: roleConfig || { salon_id: salonId, roles_enabled: false, session_duration_hours: 24 },
            staff_roles: staffRoles
        });
    } catch (error) {
        console.error('Error fetching salon roles:', error);
        res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// Enable/disable role system for salon
app.post('/api/salon/roles/:salon_id/toggle', async (req, res) => {
    try {
        const salonId = req.params.salon_id;
        const { enabled, session_duration_hours = 24 } = req.body;

        if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
            return res.status(400).json({ success: false, message: 'Valid salon ID is required.' });
        }

        // Upsert salon role configuration
        await db.run(`
            INSERT INTO salon_roles (salon_id, roles_enabled, session_duration_hours, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (salon_id) DO UPDATE SET
                roles_enabled = $2,
                session_duration_hours = $3,
                updated_at = CURRENT_TIMESTAMP
        `, [salonId, enabled, session_duration_hours]);

        // If disabling, clean up sessions
        if (!enabled) {
            await db.run('DELETE FROM role_sessions WHERE salon_id = $1', [salonId]);
        }

        res.json({ success: true, message: 'Role system updated successfully.' });
    } catch (error) {
        console.error('Error toggling role system:', error);
        res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// Add staff role
app.post('/api/salon/roles/:salon_id/staff', async (req, res) => {
    try {
        const salonId = req.params.salon_id;
        const { staff_id, role_type, pin, biometric_enabled = false } = req.body;

        if (!salonId || !staff_id || !role_type || !pin) {
            return res.status(400).json({ 
                success: false, 
                message: 'Salon ID, staff ID, role type, and PIN are required.' 
            });
        }

        if (!['admin', 'staff'].includes(role_type)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Role type must be either "admin" or "staff".' 
            });
        }

        if (pin.length !== 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'PIN must be exactly 6 digits.' 
            });
        }

        // Verify staff exists and belongs to salon
        const staff = await db.get(
            'SELECT id FROM staff WHERE id = $1 AND salon_id = $2',
            [staff_id, salonId]
        );

        if (!staff) {
            return res.status(404).json({ 
                success: false, 
                message: 'Staff member not found or does not belong to this salon.' 
            });
        }

        // Check for duplicate PIN in the same salon (excluding current staff if updating)
        const existingPinRole = await db.get(`
            SELECT sr.staff_id, s.name as staff_name 
            FROM staff_roles sr 
            JOIN staff s ON sr.staff_id = s.id 
            WHERE sr.salon_id = $1 AND sr.staff_id != $2 AND sr.is_active = TRUE
        `, [salonId, staff_id]);

        if (existingPinRole) {
            // Check if the PIN matches any existing role
            for (const role of await db.query(`
                SELECT sr.pin_hash, s.name as staff_name 
                FROM staff_roles sr 
                JOIN staff s ON sr.staff_id = s.id 
                WHERE sr.salon_id = $1 AND sr.staff_id != $2 AND sr.is_active = TRUE
            `, [salonId, staff_id])) {
                if (await verifyPin(pin, role.pin_hash)) {
                    return res.status(400).json({ 
                        success: false, 
                        message: `هذا الرقم السري مستخدم بالفعل من قبل ${role.staff_name}. يرجى اختيار رقم سري مختلف.` 
                    });
                }
            }
        }

        // Hash the PIN
        const hashedPin = await hashPin(pin);

        // Insert or update staff role
        await db.run(`
            INSERT INTO staff_roles (salon_id, staff_id, role_type, pin_hash, biometric_enabled, updated_at)
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            ON CONFLICT (salon_id, staff_id) DO UPDATE SET
                role_type = $3,
                pin_hash = $4,
                biometric_enabled = $5,
                is_active = TRUE,
                updated_at = CURRENT_TIMESTAMP
        `, [salonId, staff_id, role_type, hashedPin, biometric_enabled]);

        res.json({ success: true, message: 'Staff role added successfully.' });
    } catch (error) {
        console.error('Error adding staff role:', error);
        res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// Remove staff role
app.delete('/api/salon/roles/:salon_id/staff/:staff_id', async (req, res) => {
    try {
        const { salon_id, staff_id } = req.params;

        // Deactivate the role instead of deleting (for audit trail)
        await db.run(
            'UPDATE staff_roles SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE salon_id = $1 AND staff_id = $2',
            [salon_id, staff_id]
        );

        // Clean up any active sessions for this staff member
        await db.run(`
            DELETE FROM role_sessions 
            WHERE staff_role_id IN (
                SELECT id FROM staff_roles WHERE salon_id = $1 AND staff_id = $2
            )
        `, [salon_id, staff_id]);

        res.json({ success: true, message: 'Staff role removed successfully.' });
    } catch (error) {
        console.error('Error removing staff role:', error);
        res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// PIN authentication
app.post('/api/salon/roles/:salon_id/auth', async (req, res) => {
    try {
        const salonId = req.params.salon_id;
        const { pin, staff_id, biometric } = req.body;

        if (!salonId || !pin) {
            return res.status(400).json({ 
                success: false, 
                message: 'Salon ID and PIN are required.' 
            });
        }

        // Check if role system is enabled for this salon
        const roleConfig = await db.get(
            'SELECT * FROM salon_roles WHERE salon_id = $1 AND roles_enabled = TRUE',
            [salonId]
        );

        if (!roleConfig) {
            return res.status(404).json({ 
                success: false, 
                message: 'Role system is not enabled for this salon.' 
            });
        }

        // Find staff with matching PIN
        const staffRoles = await db.query(`
            SELECT sr.*, s.name as staff_name 
            FROM staff_roles sr 
            JOIN staff s ON sr.staff_id = s.id 
            WHERE sr.salon_id = $1 AND sr.is_active = TRUE
        `, [salonId]);

        let authenticatedRole = null;
        
        // Handle biometric authentication
        if (biometric && pin === 'BIOMETRIC_AUTH' && staff_id) {
            // Find the specific staff role for biometric auth
            authenticatedRole = staffRoles.find(role => 
                role.staff_id === parseInt(staff_id) && role.biometric_enabled
            );
            
            if (!authenticatedRole) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Biometric authentication not enabled for this staff member.' 
                });
            }
        } else {
            // Regular PIN authentication
            if (pin.length !== 6) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'PIN must be exactly 6 digits.' 
                });
            }

            for (const role of staffRoles) {
                if (await verifyPin(pin, role.pin_hash)) {
                    authenticatedRole = role;
                    break;
                }
            }

            if (!authenticatedRole) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Invalid PIN.' 
                });
            }
        }

        // Generate session token
        const sessionToken = await generateSessionToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + roleConfig.session_duration_hours);

        // Create session
        await db.run(`
            INSERT INTO role_sessions (salon_id, staff_role_id, session_token, expires_at)
            VALUES ($1, $2, $3, $4)
        `, [salonId, authenticatedRole.id, sessionToken, expiresAt.toISOString()]);

        res.json({
            success: true,
            session_token: sessionToken,
            role_type: authenticatedRole.role_type,
            staff_id: authenticatedRole.staff_id,
            staff_name: authenticatedRole.staff_name,
            expires_at: expiresAt.toISOString()
        });
    } catch (error) {
        console.error('Error authenticating PIN:', error);
        res.status(500).json({ success: false, message: 'Authentication error.' });
    }
});

// Verify session token
app.post('/api/salon/roles/:salon_id/verify', async (req, res) => {
    try {
        const salonId = req.params.salon_id;
        const { session_token } = req.body;

        if (!salonId || !session_token) {
            return res.status(400).json({ 
                success: false, 
                message: 'Salon ID and session token are required.' 
            });
        }

        // Find valid session
        const session = await db.get(`
            SELECT rs.*, sr.role_type, sr.staff_id, s.name as staff_name
            FROM role_sessions rs
            JOIN staff_roles sr ON rs.staff_role_id = sr.id
            JOIN staff s ON sr.staff_id = s.id
            WHERE rs.salon_id = $1 AND rs.session_token = $2 AND rs.expires_at > CURRENT_TIMESTAMP
        `, [salonId, session_token]);

        if (!session) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid or expired session.' 
            });
        }

        res.json({
            success: true,
            valid: true,
            role_type: session.role_type,
            staff_id: session.staff_id,
            staff_name: session.staff_name,
            expires_at: session.expires_at
        });
    } catch (error) {
        console.error('Error verifying session:', error);
        res.status(500).json({ success: false, message: 'Verification error.' });
    }
});

// Logout (invalidate session)
app.post('/api/salon/roles/:salon_id/logout', async (req, res) => {
    try {
        const salonId = req.params.salon_id;
        const { session_token } = req.body;

        if (session_token) {
            await db.run(
                'DELETE FROM role_sessions WHERE salon_id = $1 AND session_token = $2',
                [salonId, session_token]
            );
        }

        res.json({ success: true, message: 'Logged out successfully.' });
    } catch (error) {
        console.error('Error logging out:', error);
        res.status(500).json({ success: false, message: 'Logout error.' });
    }
});

// --- End Role Management System ---

// Serve root-level static assets (e.g., offline-detect.js, manifest) first
// This ensures requests like /offline-detect.js are served with correct MIME type
app.use(express.static(__dirname, { etag: true }));

// Serve static files (views, Images)
// Serve static assets with mild caching for images; keep HTML no-cache via discovery route headers
app.use('/', express.static(path.join(__dirname, 'views'), { etag: true }));
app.use('/images', express.static(path.join(__dirname, 'Images'), { maxAge: '1d', etag: true }));
// Serve notification sounds
app.use('/sounds', express.static(path.join(__dirname, 'Sounds'), { maxAge: '7d', etag: true }));
// Serve videos with proper MIME type handling
app.use('/videos', express.static(path.join(__dirname, 'videos'), { 
    maxAge: '1d', 
    etag: true,
    setHeaders: (res, path) => {
        if (path.endsWith('.mp4')) {
            res.setHeader('Content-Type', 'video/mp4');
        }
    }
}));

// Test route for video
app.get('/test-video', (req, res) => {
    const videoPath = path.join(__dirname, 'videos', 'app.mp4');
    console.log('Video path:', videoPath);
    console.log('File exists:', require('fs').existsSync(videoPath));
    res.sendFile(videoPath);
});

// Root route should serve index for browser launches
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Employee presentation route
app.get('/presentation', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'employee_presentation.html'));
});

// Serve dedicated salon page (route-capable)
app.get('/salon/:salon_id', (req, res) => {
    // Always serve the salon shell page; client JS loads content by salon_id
    res.sendFile(path.join(__dirname, 'views', 'salon.html'));
});

// Serve salon share landing page
app.get('/salon-share', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'salon-share.html'));
});

// Pricing page route
app.get('/pricing', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pricing.html'));
});

// AI Chat page route
app.get('/ai-chat.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'ai-chat.html'));
});

// Pretty route for Admin Dashboard
app.get('/admin_dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin', 'admin_dashboard.html'));
});

// Base /admin route redirects to the admin dashboard HTML under /views/admin
app.get('/admin', (req, res) => {
    res.redirect('/admin/admin_dashboard.html');
});

// Legacy payments page now lives inside the Admin Dashboard
// Keep a redirect to avoid 404s from old links
app.get('/admin/payments.html', (req, res) => {
    res.redirect('/admin/admin_dashboard.html');
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

        // Check if subscription already exists with same data to prevent unnecessary updates
        const existing = await dbGet('SELECT id, user_id, salon_id, p256dh, auth FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
        if (existing) {
            // Only update if data has actually changed
            if (existing.user_id === (user_id || null) && 
                existing.salon_id === (salon_id || null) && 
                existing.p256dh === p256dh && 
                existing.auth === auth) {
                // No changes needed, just update last_active timestamp
                await dbRun('UPDATE push_subscriptions SET last_active = CURRENT_TIMESTAMP WHERE id = $1', [existing.id]);
                return res.json({ success: true, message: 'Subscription already up to date' });
            }
            
            await dbRun('UPDATE push_subscriptions SET user_id = $1, salon_id = $2, p256dh = $3, auth = $4, last_active = CURRENT_TIMESTAMP WHERE id = $5', [user_id || null, salon_id || null, p256dh, auth, existing.id]);
            console.log('Push subscription updated', { endpoint: endpoint.substring(0, 50) + '...', user_id: user_id || null, salon_id: salon_id || null, id: existing.id });
        } else {
            await dbRun('INSERT INTO push_subscriptions (user_id, salon_id, endpoint, p256dh, auth, last_active) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)', [user_id || null, salon_id || null, endpoint, p256dh, auth]);
            console.log('Push subscription inserted', { endpoint: endpoint.substring(0, 50) + '...', user_id: user_id || null, salon_id: salon_id || null });
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

async function sendSalonEvent(salonId, eventType, payload) {
    const key = String(salonId);
    const clients = salonClients.get(key);
    const data = JSON.stringify({ type: eventType, salonId: Number(salonId), ...payload });
    
    // Send SSE to connected clients
    if (clients && clients.size > 0) {
        for (const res of clients) {
            try {
                res.write(`data: ${data}\n\n`);
            } catch (e) {
                // Best-effort: drop on error
                removeSalonClient(salonId, res);
            }
        }
    }
    
    // Note: Push notifications are handled by individual endpoints for better customization
    // This prevents duplicate notifications since each endpoint calls sendPushToTargets separately
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
                message: 'رقم الهاتف يجب أن يبدأ بـ 0 ويكون 10 أرقام', 
                message_en: 'Phone number must start with 0 and be 10 digits' 
            });
        }
        
        if (user_type === 'salon') {
            if (phone && !validatePhoneFormat(phone)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'رقم هاتف الصالون يجب أن يبدأ بـ 0 ويكون 10 أرقام', 
                    message_en: 'Salon phone number must start with 0 and be 10 digits' 
                });
            }
            if (owner_phone && !validatePhoneFormat(owner_phone)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'رقم هاتف المالك يجب أن يبدأ بـ 0 ويكون 10 أرقام', 
                    message_en: 'Owner phone number must start with 0 and be 10 digits' 
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

            // Simple phone duplicate check
            if (user_phone_to_use) {
                const existingUser = await db.get('SELECT id FROM users WHERE phone = $1', [user_phone_to_use]);
                if (existingUser) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'رقم الهاتف مسجل بالفعل.', 
                        message_en: 'Phone number already registered.' 
                    });
                }
            }

            // For salon signup, also check if salon phone (if provided) conflicts with any user phone
            if (user_type === 'salon' && phone && phone !== owner_phone) {
                const existingSalonPhone = await db.get('SELECT id FROM users WHERE phone = $1', [phone]);
                if (existingSalonPhone) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'رقم هاتف الصالون مسجل بالفعل.', 
                        message_en: 'Salon phone number already registered.' 
                    });
                }
            }

            let userResult;
            try {
                // Convert empty email to null for optional email field
                const emailToInsert = email && email.trim() !== '' ? email : null;
                userResult = await db.query(userSql, [user_name_to_use, emailToInsert, user_phone_to_use, gender_to_use, city, hashedPassword, user_type]);
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

                    // If image_url is base64, save to Supabase Storage and update DB
                    try {
                        if (image_url && typeof image_url === 'string' && image_url.startsWith('data:image')) {
                            const match = image_url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
                            const base64Data = match ? match[2] : (image_url.split(',')[1] || '');
                            if (base64Data) {
                                const bufferIn = Buffer.from(base64Data, 'base64');
                                
                                // Use the same optimized upload function as /api/upload
                                const uploadResults = await uploadImageToSupabase(bufferIn, salonId, 'salon_signup_image.jpg');
                                
                                if (uploadResults && uploadResults.length > 0) {
                                    // Store optimized image metadata in salon_images table
                                    for (const result of uploadResults) {
                                        await dbGet(
                                            `INSERT INTO salon_images (salon_id, image_path, width, height, size_bytes, mime_type, is_primary)
                                             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                                            [
                                                salonId, 
                                                result.url, 
                                                result.size === 'medium' ? 512 : 512,
                                                result.size === 'medium' ? 512 : 512,
                                                result.bytes, 
                                                result.format === 'webp' ? 'image/webp' : 'image/jpeg',
                                                result.size === 'medium' && result.format === 'webp' // Primary image is medium WebP
                                            ]
                                        );
                                    }
                                    
                                    // Update salons.image_url with the primary image URL
                                    const primaryImage = uploadResults.find(r => r.size === 'medium' && r.format === 'webp') || 
                                                       uploadResults.find(r => r.size === 'medium' && r.format === 'jpeg') ||
                                                       uploadResults[0];
                                    
                                    await dbRun('UPDATE salons SET image_url = $1 WHERE id = $2', [primaryImage.url, salonId]);
                                    console.log(`✅ Salon ${salonId} image uploaded to Supabase Storage successfully`);
                                } else {
                                    console.warn(`⚠️ Failed to upload image for salon ${salonId}, skipping image storage`);
                                }
                            }
                        }
                    } catch (imageErr) {
                        console.error('Image processing error during salon signup:', imageErr);
                        // Continue with salon creation even if image upload fails
                    }
                    
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
    try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Invalid login data.' });
        }
        const { identifier, email, phone, password } = parsed.data;

        const input = (identifier || email || phone || '').trim();
        const isEmail = input.includes('@');
        
        // Validate phone format if not email
        if (!isEmail && input && !validatePhoneFormat(input)) {
            return res.status(400).json({ 
                success: false, 
                message: 'رقم الهاتف يجب أن يبدأ بـ 0 ويكون 10 أرقام', 
                message_en: 'Phone number must start with 0 and be 10 digits' 
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
        
        if (!userResult || userResult.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: isEmail ? 'البريد الإلكتروني غير مسجل.' : 'رقم الهاتف غير مسجل.', 
                message_en: isEmail ? 'Email not registered.' : 'Phone not registered.' 
            });
        }
        
        const userRow = userResult[0];
        
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
        redirectUrl = '/admin/admin_dashboard.html';
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

        // Issue JWT access token and refresh token
        const accessToken = signAccessToken(userRow.id, userType);
        const refreshToken = crypto.randomBytes(32).toString('hex');
        await storeRefreshToken(userRow.id, refreshToken);

        // Backward compatibility for admin: accept JWT token in legacy set
        if (userType === 'admin') {
            validAdminTokens.add(accessToken);
        }

        // Also set secure cookies for browser sessions
        const isProd = NODE_ENV === 'production';
        try {
            res.cookie('access_token', accessToken, { httpOnly: true, secure: isProd, sameSite: 'Lax', maxAge: 15 * 60 * 1000 });
            res.cookie('refresh_token', refreshToken, { httpOnly: true, secure: isProd, sameSite: 'Lax', maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000 });
        } catch (_) {}

        res.json({ 
            success: true, 
            message: 'تم تسجيل الدخول بنجاح.', 
            redirect: redirectUrl, 
            token: accessToken, // legacy field
            access_token: accessToken,
            refresh_token: refreshToken,
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

// Refresh access token using a valid refresh token (rotate on use)
app.post('/api/auth/refresh', async (req, res) => {
    try {
        const { refresh_token } = req.body || {};
        if (!refresh_token) {
            return res.status(400).json({ success: false, message: 'Refresh token is required.' });
        }
        const hash = crypto.createHash('sha256').update(refresh_token).digest('hex');
        const rtRow = await dbGet('SELECT id, user_id, expires_at, revoked FROM refresh_tokens WHERE token_hash = $1', [hash]);
        if (!rtRow || rtRow.revoked) {
            return res.status(401).json({ success: false, message: 'Invalid refresh token.' });
        }
        if (new Date(rtRow.expires_at).getTime() <= Date.now()) {
            return res.status(401).json({ success: false, message: 'Refresh token expired.' });
        }
        // Rotate: revoke old and issue a new refresh token
        await dbRun('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [rtRow.id]);
        const newRefresh = crypto.randomBytes(32).toString('hex');
        await storeRefreshToken(rtRow.user_id, newRefresh);

        // Lookup user role to embed in JWT
        const roleRow = await dbGet('SELECT user_type FROM users WHERE id = $1', [rtRow.user_id]);
        const role = roleRow?.user_type || 'user';
        const access = signAccessToken(rtRow.user_id, role);

        // Backward-compat: add admin access token to legacy set
        if (role === 'admin') {
            validAdminTokens.add(access);
        }

        const isProd = NODE_ENV === 'production';
        try {
            res.cookie('access_token', access, { httpOnly: true, secure: isProd, sameSite: 'Lax', maxAge: 15 * 60 * 1000 });
            res.cookie('refresh_token', newRefresh, { httpOnly: true, secure: isProd, sameSite: 'Lax', maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000 });
        } catch (_) {}

        return res.json({ success: true, access_token: access, refresh_token: newRefresh });
    } catch (e) {
        console.error('Refresh endpoint error:', e.message);
        return res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// Logout: revoke provided refresh token
app.post('/api/auth/logout', async (req, res) => {
    try {
        const { refresh_token } = req.body || {};
        if (refresh_token) {
            const hash = crypto.createHash('sha256').update(refresh_token).digest('hex');
            await dbRun('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [hash]);
        }
        return res.json({ success: true, message: 'Logged out.' });
    } catch (e) {
        console.error('Logout endpoint error:', e.message);
        return res.status(500).json({ success: false, message: 'Server error.' });
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

// Optimized image upload function with Supabase Storage and multiple formats
async function uploadImageToSupabase(buffer, salonId, originalFilename) {
    try {
        const timestamp = Date.now();
        const randomId = crypto.randomBytes(6).toString('hex');
        const baseFilename = `salon_${salonId}_${timestamp}_${randomId}`;
        
        // Generate optimized versions (WebP + JPEG for compatibility)
        const webpMedium = await sharp(buffer)
            .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 })
            .toBuffer();
        
        const jpegMedium = await sharp(buffer)
            .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
        
        // Upload optimized versions to Supabase Storage
        const uploads = [
            { buffer: webpMedium, path: `salon-images/${baseFilename}_medium.webp`, size: 'medium', format: 'webp' },
            { buffer: jpegMedium, path: `salon-images/${baseFilename}_medium.jpg`, size: 'medium', format: 'jpeg' }
        ];
        
        const uploadResults = [];
        
        for (const upload of uploads) {
            const { data, error } = await supabase.storage
                .from('salon-images')
                .upload(upload.path, upload.buffer, {
                    contentType: upload.format === 'webp' ? 'image/webp' : 'image/jpeg',
                    cacheControl: '31536000', // 1 year cache
                    upsert: false
                });
            
            if (error) {
                console.error(`Upload error for ${upload.path}:`, error);
                continue;
            }
            
            // Get public URL
            const { data: urlData } = supabase.storage
                .from('salon-images')
                .getPublicUrl(upload.path);
            
            uploadResults.push({
                size: upload.size,
                format: upload.format,
                url: urlData.publicUrl,
                path: upload.path,
                bytes: upload.buffer.length
            });
        }
        
        return uploadResults;
        
    } catch (error) {
        console.error('Supabase upload error:', error);
        throw error;
    }
}

// API for image upload (multipart/form-data) - OPTIMIZED VERSION
app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        const salonIdRaw = req.query.salon_id || req.body.salon_id;
        const salonId = parseInt(salonIdRaw);
        if (!salonId || isNaN(salonId)) {
            return res.status(400).json({ success: false, message: 'Salon ID مطلوب.' });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'لم يتم تقديم ملف صورة.' });
        }

        // Upload optimized images to Supabase Storage
        const uploadResults = await uploadImageToSupabase(req.file.buffer, salonId, req.file.originalname);
        
        if (!uploadResults || uploadResults.length === 0) {
            throw new Error('فشل في رفع الصور إلى التخزين السحابي');
        }

        // Delete existing images for this salon (both from database and Supabase)
        const existingImages = await dbAll('SELECT image_path FROM salon_images WHERE salon_id = $1', [salonId]);
        
        // Delete from Supabase Storage
        if (existingImages && existingImages.length > 0) {
            for (const img of existingImages) {
                const pathParts = img.image_path.split('/');
                const fileName = pathParts[pathParts.length - 1];
                if (fileName) {
                    await supabase.storage
                        .from('salon-images')
                        .remove([`salon-images/${fileName}`]);
                }
            }
        }
        
        // Delete from database
        await dbRun('DELETE FROM salon_images WHERE salon_id = $1', [salonId]);
        
        // Store new image metadata in salon_images table
        const imageRecords = [];
        for (const result of uploadResults) {
            const inserted = await dbGet(
                `INSERT INTO salon_images (salon_id, image_path, width, height, size_bytes, mime_type, is_primary)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [
                    salonId, 
                    result.url, 
                    result.size === 'medium' ? 512 : 512,
                    result.size === 'medium' ? 512 : 512,
                    result.bytes, 
                    result.format === 'webp' ? 'image/webp' : 'image/jpeg',
                    result.size === 'medium' && result.format === 'webp' // Primary image is medium WebP
                ]
            );
            imageRecords.push({ ...result, id: inserted?.id });
        }

        // Update salons.image_url with the primary image (medium WebP with JPEG fallback)
        const primaryImage = uploadResults.find(r => r.size === 'medium' && r.format === 'webp') || 
                           uploadResults.find(r => r.size === 'medium' && r.format === 'jpeg') ||
                           uploadResults[0];
        
        await dbRun('UPDATE salons SET image_url = $1 WHERE id = $2', [primaryImage.url, salonId]);

        // Return optimized response with all image versions
        res.json({ 
            success: true, 
            image_url: primaryImage.url,
            images: {
                webp: {
                    thumb: uploadResults.find(r => r.size === 'thumb' && r.format === 'webp')?.url,
                    medium: uploadResults.find(r => r.size === 'medium' && r.format === 'webp')?.url,
                    full: uploadResults.find(r => r.size === 'full' && r.format === 'webp')?.url
                },
                jpeg: {
                    thumb: uploadResults.find(r => r.size === 'thumb' && r.format === 'jpeg')?.url,
                    medium: uploadResults.find(r => r.size === 'medium' && r.format === 'jpeg')?.url,
                    full: uploadResults.find(r => r.size === 'full' && r.format === 'jpeg')?.url
                }
            },
            total_size_saved: uploadResults.reduce((sum, r) => sum + r.bytes, 0),
            formats_available: ['webp', 'jpeg'],
            sizes_available: ['thumb', 'medium', 'full']
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, message: error.message || 'خطأ في رفع الصورة' });
    }
});

// API to get optimized salon image
app.get('/api/salon/image/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    const { size = 'medium', format = 'webp' } = req.query;
    
    try {
        // Get the optimized image from salon_images table
        const imageQuery = `
            SELECT image_path, width, height
            FROM salon_images 
            WHERE salon_id = $1 AND is_primary = true
            ORDER BY created_at DESC 
            LIMIT 1
        `;
        
        const images = await dbAll(imageQuery, [salonId]);
        
        if (images && images.length > 0) {
            const image = images[0];
            
            // Set cache headers for 1 year
            res.set({
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Content-Type': 'image/webp',
                'X-Image-Width': image.width,
                'X-Image-Height': image.height
            });
            
            // Redirect to Supabase public URL for CDN delivery
            return res.redirect(301, image.image_path);
        }
        
        // No optimized image found, return placeholder
        res.status(404).json({ success: false, message: 'Image not found' });
        
    } catch (error) {
        console.error('Error serving salon image:', error);
        res.status(500).json({ success: false, message: 'Error loading image' });
    }
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

// Salon Location APIs
app.get('/api/salon/location/:salon_id', async (req, res) => {
    try {
        const salonId = parseInt(req.params.salon_id);
        if (isNaN(salonId)) return res.status(400).json({ success: false, message: 'salon_id غير صالح' });

        const location = await dbGet(`SELECT salon_id, address, city, latitude, longitude, place_id, formatted_address, created_at, updated_at FROM salon_locations WHERE salon_id = $1`, [salonId]);
        if (!location) return res.json({ success: true, location: null });
        res.json({ success: true, location });
    } catch (err) {
        console.error('GET /api/salon/location error:', err.message);
        res.status(500).json({ success: false, message: 'فشل في تحميل موقع الصالون' });
    }
});

app.post('/api/salon/location/:salon_id', async (req, res) => {
    try {
        const salonId = parseInt(req.params.salon_id);
        if (isNaN(salonId)) return res.status(400).json({ success: false, message: 'salon_id غير صالح' });

        const salon = await dbGet(`SELECT id FROM salons WHERE id = $1`, [salonId]);
        if (!salon) return res.status(404).json({ success: false, message: 'الصالون غير موجود' });

        const { address, city, latitude, longitude, place_id, formatted_address } = req.body || {};
        const lat = latitude !== undefined ? parseFloat(latitude) : null;
        const lng = longitude !== undefined ? parseFloat(longitude) : null;

        if ((lat !== null && isNaN(lat)) || (lng !== null && isNaN(lng))) {
            return res.status(400).json({ success: false, message: 'إحداثيات غير صالحة' });
        }

        const sql = `
            INSERT INTO salon_locations (salon_id, address, city, latitude, longitude, place_id, formatted_address, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
            ON CONFLICT (salon_id)
            DO UPDATE SET address = EXCLUDED.address,
                          city = EXCLUDED.city,
                          latitude = EXCLUDED.latitude,
                          longitude = EXCLUDED.longitude,
                          place_id = EXCLUDED.place_id,
                          formatted_address = EXCLUDED.formatted_address,
                          updated_at = CURRENT_TIMESTAMP
        `;
        await dbRun(sql, [salonId, address || null, city || null, lat, lng, place_id || null, formatted_address || null]);

        const saved = await dbGet(`SELECT salon_id, address, city, latitude, longitude, place_id, formatted_address, created_at, updated_at FROM salon_locations WHERE salon_id = $1`, [salonId]);
        res.json({ success: true, location: saved });
    } catch (err) {
        console.error('POST /api/salon/location error:', err.message);
        res.status(500).json({ success: false, message: 'فشل في حفظ موقع الصالون' });
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
            s.salon_phone,
            s.owner_phone,
            COALESCE(AVG(r.rating), 0) AS avg_rating,
            COUNT(r.id) AS review_count
        FROM salons s
        LEFT JOIN reviews r ON s.id = r.salon_id
        WHERE s.id = $1
        GROUP BY s.id, s.salon_phone, s.owner_phone
    `;
    try {
        const row = await dbGet(sql, [salonId]);
        if (!row) {
             return res.status(404).json({ success: false, message: 'Salon not found.' });
        }
        // Attach social links if present
        try {
            const socials = await db.query('SELECT platform, url FROM social_links WHERE salon_id = $1', [Number(salonId)]);
            const socialMap = {};
            for (const s of socials) {
                socialMap[s.platform] = s.url;
            }
            // Provide flexible fields used by frontend
            row.facebook_url = socialMap.facebook || null;
            row.instagram_url = socialMap.instagram || null;
            row.tiktok_url = socialMap.tiktok || null;
            row.social = socialMap; // also provide grouped object
        } catch (e) {
            console.warn('Warning: failed to attach social links:', e.message);
        }
        res.json({ success: true, salon: row });
    } catch (err) {
        console.error("Salon details fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// --- Social Links ---
// Public: fetch social links for a salon
app.get('/api/salon/social-links/:salon_id', async (req, res) => {
    try {
        const salonId = req.params.salon_id;
        if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
            return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
        }
        const rows = await db.query('SELECT platform, url FROM social_links WHERE salon_id = $1', [Number(salonId)]);
        const social = {};
        for (const r of rows) social[r.platform] = r.url;
        return res.json({ success: true, social });
    } catch (err) {
        console.error('Social links fetch error:', err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// Helper: verify salon role session token with admin role_type
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

// Protected: upsert a social link (admin role required)
app.post('/api/salon/social-links/:salon_id', requireSalonAdminRole, async (req, res) => {
    try {
        const salonId = Number(req.params.salon_id);
        const { platform, url } = req.body;
        if (!platform || !url) {
            return res.status(400).json({ success: false, message: 'Platform and URL are required.' });
        }
        const normalizedPlatform = String(platform).toLowerCase();
        if (!['facebook','instagram','tiktok','other'].includes(normalizedPlatform)) {
            return res.status(400).json({ success: false, message: 'Invalid platform.' });
        }
        const existing = await db.get('SELECT id FROM social_links WHERE salon_id = $1 AND platform = $2', [salonId, normalizedPlatform]);
        if (existing) {
            await db.run('UPDATE social_links SET url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [url, existing.id]);
        } else {
            await db.run('INSERT INTO social_links (salon_id, platform, url) VALUES ($1, $2, $3)', [salonId, normalizedPlatform, url]);
        }
        return res.json({ success: true, message: 'Social link saved.' });
    } catch (err) {
        console.error('Social link upsert error:', err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// Protected: delete a social link (admin role required)
app.delete('/api/salon/social-links/:salon_id', requireSalonAdminRole, async (req, res) => {
    try {
        const salonId = Number(req.params.salon_id);
        const { platform } = req.body || {};
        if (!platform) {
            return res.status(400).json({ success: false, message: 'Platform is required.' });
        }
        const normalizedPlatform = String(platform).toLowerCase();
        await db.run('DELETE FROM social_links WHERE salon_id = $1 AND platform = $2', [salonId, normalizedPlatform]);
        return res.json({ success: true, message: 'Social link deleted.' });
    } catch (err) {
        console.error('Social link delete error:', err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// API to update salon basic info
app.post('/api/salon/info/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    
    // Check if req.body exists and has the required data
    if (!req.body) {
        return res.status(400).json({ success: false, message: 'Request body is missing' });
    }
    
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

    res.json({ 
        success: true, 
        message: 'Salon information updated successfully.',
        image_url: image_url // Return the image URL for frontend update
    });
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
        // Broadcast real-time availability update to this salon room
        try {
            if (global.broadcastToSalon) {
                global.broadcastToSalon(salonId, 'time_slots_updated', {
                    source: 'schedule_updated',
                    salon_id: parseInt(salonId)
                });
            }
        } catch (e) {
            console.warn('Broadcast time_slots_updated (schedule) failed:', e.message);
        }
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
        // Broadcast real-time availability update to this salon room
        try {
            if (global.broadcastToSalon) {
                global.broadcastToSalon(salonId, 'time_slots_updated', {
                    source: 'break_added',
                    salon_id: parseInt(salonId)
                });
            }
        } catch (e) {
            console.warn('Broadcast time_slots_updated (break add) failed:', e.message);
        }
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
        // Lookup salon_id before deletion to know which room to notify
        const row = await dbGet('SELECT salon_id FROM breaks WHERE id = $1', [breakId]);
        await dbRun('DELETE FROM breaks WHERE id = $1', [breakId]);
        // Broadcast real-time availability update to this salon room
        try {
            if (row && row.salon_id && global.broadcastToSalon) {
                global.broadcastToSalon(row.salon_id, 'time_slots_updated', {
                    source: 'break_deleted',
                    salon_id: parseInt(row.salon_id)
                });
            }
        } catch (e) {
            console.warn('Broadcast time_slots_updated (break delete) failed:', e.message);
        }
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
        // Broadcast real-time availability update to this salon room
        try {
            if (global.broadcastToSalon) {
                global.broadcastToSalon(salonId, 'time_slots_updated', {
                    source: 'schedule_mod_added',
                    salon_id: parseInt(salonId)
                });
            }
        } catch (e) {
            console.warn('Broadcast time_slots_updated (schedule mod add) failed:', e.message);
        }
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
        // Lookup salon_id before deletion to know which room to notify
        const row = await dbGet('SELECT salon_id FROM schedule_modifications WHERE id = $1', [modId]);
        await dbRun('DELETE FROM schedule_modifications WHERE id = $1', [modId]);
        // Broadcast real-time availability update to this salon room
        try {
            if (row && row.salon_id && global.broadcastToSalon) {
                global.broadcastToSalon(row.salon_id, 'time_slots_updated', {
                    source: 'schedule_mod_deleted',
                    salon_id: parseInt(row.salon_id)
                });
            }
        } catch (e) {
            console.warn('Broadcast time_slots_updated (schedule mod delete) failed:', e.message);
        }
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
    
    // FIX: Add validation for date parameter
    if (!date || date === 'null' || date === 'undefined') {
        return res.status(400).json({ success: false, message: 'Date is required and must be valid.' });
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
        // First, get the appointment details to find the user_id and salon_id
        const getAppointmentQuery = 'SELECT user_id, salon_id, status FROM appointments WHERE id = $1'; 
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

        // WebSocket broadcast to salon room for real-time update
        if (global.broadcastToSalon) {
            global.broadcastToSalon(appointment.salon_id, 'appointment_status_updated', {
                appointmentId,
                status,
                user_id: appointment.user_id
            });
        }

        // WebSocket broadcast to user room for real-time update
        if (global.broadcastToUser) {
            global.broadcastToUser(appointment.user_id, 'appointment_status_updated', {
                appointmentId,
                status
            });
        }

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
app.get('/api/appointments/user/:user_id/:filter', requireAuth, async (req, res) => {
    const { user_id, filter } = req.params;
    const authUserId = req.user && req.user.id;
    if (!authUserId || String(authUserId) !== String(user_id)) {
        return res.status(403).json({ success: false, message: 'غير مصرح لك بعرض هذه المواعيد.' });
    }
    // Use local time without timezone for comparison with database timestamps
    const now = new Date().toISOString().slice(0, 19).replace('T', ' '); // Format: YYYY-MM-DD HH:mm:ss
    let whereClause = '';
    let params = [authUserId];
    let orderBy = 'DESC';

    // Debug logging
    console.log(`[DEBUG] User appointments request - User ID: ${user_id}, Filter: ${filter}, Current time: ${now}`);

    // FIX: Add validation for user_id
    if (!user_id || user_id === 'undefined' || isNaN(parseInt(user_id))) {
         return res.status(400).json({ success: false, message: 'User ID is required and must be valid.' });
    }
    
    if (filter === 'upcoming') {
         // FIX: Use $2 placeholder
        whereClause = `AND a.start_time > $2 AND a.status = 'Scheduled'`;
        params.push(now);
        orderBy = 'ASC';
        console.log(`[DEBUG] Upcoming filter - Looking for appointments after: ${now} with status 'Scheduled'`);
    } else if (filter === 'past') {
         // FIX: Use $2 placeholder
        whereClause = `AND a.start_time <= $2`;
        params.push(now);
        orderBy = 'DESC';
        console.log(`[DEBUG] Past filter - Looking for appointments before/at: ${now}`);
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
        console.log(`[DEBUG] SQL Query: ${sql}`);
        console.log(`[DEBUG] Query params: ${JSON.stringify(params)}`);
        console.log(`[DEBUG] Found ${rows.length} appointments`);
        
        // Log first few appointments for debugging
        if (rows.length > 0) {
            console.log(`[DEBUG] First appointment: ${JSON.stringify(rows[0])}`);
        }
        
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
app.post('/api/appointments/cancel/:appointment_id', requireAuth, async (req, res) => {
    const appointmentId = req.params.appointment_id;
    const minNoticeHours = 3; 
    const authUserId = req.user && req.user.id;
    if (!authUserId || isNaN(parseInt(authUserId))) {
         return res.status(401).json({ success: false, message: 'يرجى تسجيل الدخول.' });
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
        if (String(row.user_id) !== String(authUserId)) {
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
             const strikeResult = await dbGet(strikeQuery, [authUserId]);
             const newStrikes = strikeResult ? strikeResult.strikes : 'غير معروف';

             // Emit SSE notification to salon dashboard (includes push notifications)
             await sendSalonEvent(row.salon_id, 'appointment_cancelled', {
                appointmentId,
                user_id: authUserId,
                start_time: row.start_time,
                late: true,
                strikes: newStrikes
             });

             // Push notify salon about late cancellation (only for today's appointments)
             const appointmentDate = new Date(row.start_time);
             const today = new Date();
             
             // Only send notification if appointment was for today (same day in Palestine timezone)
             if (appointmentDate.toDateString() === nowLocal.toDateString()) {
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
             }

             return res.status(200).json({ 
                success: true, 
                message: `تم إلغاء الموعد. تم إضافة إنذار لحسابك (الإنذارات: ${newStrikes}/3) لأن الإلغاء كان متأخراً.`,
                strikeIssued: true
             });
        }

        // Proceed with cancellation without strike - FIX: Use $1 placeholder, ensure string literal is safe
        await dbRun('UPDATE appointments SET status = $1 WHERE id = $2', ['Cancelled', appointmentId]);
        // Emit SSE notification to salon dashboard (includes push notifications)
        await sendSalonEvent(row.salon_id, 'appointment_cancelled', {
            appointmentId,
            user_id: authUserId,
            start_time: row.start_time,
            late: false
        });
        // Only send push notification for cancellations happening today (same day in Palestine timezone)
        const appointmentDate = new Date(row.start_time);
        const nowLocal = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
        
        // Check if appointment is today in Palestine timezone
        const isRelevantCancellation = appointmentDate.toDateString() === nowLocal.toDateString();
        
        if (isRelevantCancellation) {
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
        }
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

// ===== SERVICES MANAGEMENT API ENDPOINTS =====

// Get all services for admin management
app.get('/api/admin/services', async (req, res) => {
    try {
        const { gender, search } = req.query;
        
        let sql = "SELECT id, name_ar, icon, service_type, gender FROM services WHERE 1=1";
        const params = [];
        
        if (gender && gender !== 'all') {
            sql += " AND gender = $" + (params.length + 1);
            params.push(gender);
        }
        
        if (search && search.trim()) {
            sql += " AND name_ar ILIKE $" + (params.length + 1);
            params.push(`%${search.trim()}%`);
        }
        
        sql += " ORDER BY name_ar";
        
        const services = await dbAll(sql, params);
        res.json({ success: true, services });
    } catch (err) {
        console.error("Admin services fetch error:", err.message);
        res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// Add new service with image upload
app.post('/api/admin/services', upload.single('icon'), async (req, res) => {
    try {
        const { name_ar, gender, service_type } = req.body;
        
        if (!name_ar || !gender || !service_type) {
            return res.status(400).json({ 
                success: false, 
                message: 'Service name, gender, and service type are required.' 
            });
        }
        
        let iconUrl = null;
        
        // Handle image upload if provided
        if (req.file) {
            try {
                // Generate unique filename
                const timestamp = Date.now();
                const filename = `service-${timestamp}-${Math.random().toString(36).substring(7)}.webp`;
                
                // Optimize image using Sharp
                const optimizedBuffer = await sharp(req.file.buffer)
                    .resize(64, 64, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
                    .webp({ quality: 90 })
                    .toBuffer();
                
                // Upload to Supabase Storage
                const { data, error } = await supabase.storage
                    .from('service-icons')
                    .upload(filename, optimizedBuffer, {
                        contentType: 'image/webp',
                        upsert: false
                    });
                
                if (error) {
                    console.error('Supabase upload error:', error);
                    // If bucket doesn't exist, continue without uploading new icon
                    if (error.status === 400 && error.statusCode === '404') {
                        console.warn('Service icons bucket not found, keeping existing icon');
                        // Keep the existing icon
                    } else {
                        return res.status(500).json({ 
                            success: false, 
                            message: 'Failed to upload service icon.' 
                        });
                    }
                } else {
                    // Get public URL only if upload was successful
                    const { data: { publicUrl } } = supabase.storage
                        .from('service-icons')
                        .getPublicUrl(filename);
                    
                    iconUrl = publicUrl;
                }
            } catch (uploadError) {
                console.error('Image upload error:', uploadError);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Failed to process service icon.' 
                });
            }
        }
        
        // Insert service into database
        const sql = `
            INSERT INTO services (name_ar, icon, service_type, gender) 
            VALUES ($1, $2, $3, $4) 
            RETURNING id, name_ar, icon, service_type, gender
        `;
        
        const result = await dbGet(sql, [name_ar, iconUrl, service_type, gender]);
        
        res.json({ 
            success: true, 
            message: 'Service added successfully.',
            service: result
        });
        
    } catch (err) {
        console.error("Add service error:", err.message);
        res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// Update existing service with optional image upload
app.put('/api/admin/services/:service_id', upload.single('icon'), async (req, res) => {
    try {
        const serviceId = req.params.service_id;
        const { name_ar, gender, service_type } = req.body;
        
        if (!serviceId || isNaN(parseInt(serviceId))) {
            return res.status(400).json({ 
                success: false, 
                message: 'Valid service ID is required.' 
            });
        }
        
        if (!name_ar || !gender || !service_type) {
            return res.status(400).json({ 
                success: false, 
                message: 'Service name, gender, and service type are required.' 
            });
        }
        
        // Get current service data
        const currentService = await dbGet("SELECT * FROM services WHERE id = $1", [serviceId]);
        if (!currentService) {
            return res.status(404).json({ 
                success: false, 
                message: 'Service not found.' 
            });
        }
        
        let iconUrl = currentService.icon; // Keep existing icon by default
        
        // Handle new image upload if provided
        if (req.file) {
            try {
                // Delete old image from Supabase if it exists and is a Supabase URL
                if (currentService.icon && currentService.icon.includes('supabase')) {
                    const oldFilename = currentService.icon.split('/').pop();
                    await supabase.storage
                        .from('service-icons')
                        .remove([oldFilename]);
                }
                
                // Generate unique filename
                const timestamp = Date.now();
                const filename = `service-${timestamp}-${Math.random().toString(36).substring(7)}.webp`;
                
                // Optimize image using Sharp
                const optimizedBuffer = await sharp(req.file.buffer)
                    .resize(64, 64, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
                    .webp({ quality: 90 })
                    .toBuffer();
                
                // Upload to Supabase Storage
                const { data, error } = await supabase.storage
                    .from('service-icons')
                    .upload(filename, optimizedBuffer, {
                        contentType: 'image/webp',
                        upsert: false
                    });
                
                if (error) {
                    console.error('Supabase upload error:', error);
                    // If bucket doesn't exist, continue without uploading new icon
                    if (error.status === 400 && error.statusCode === '404') {
                        console.warn('Service icons bucket not found, keeping existing icon');
                        // Keep the existing icon
                    } else {
                        return res.status(500).json({ 
                            success: false, 
                            message: 'Failed to upload service icon.' 
                        });
                    }
                } else {
                    // Get public URL only if upload was successful
                    const { data: { publicUrl } } = supabase.storage
                        .from('service-icons')
                        .getPublicUrl(filename);
                    
                    iconUrl = publicUrl;
                }
            } catch (uploadError) {
                console.error('Image upload error:', uploadError);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Failed to process service icon.' 
                });
            }
        }
        
        // Update service in database
        const sql = `
            UPDATE services 
            SET name_ar = $1, icon = $2, service_type = $3, gender = $4 
            WHERE id = $5 
            RETURNING id, name_ar, icon, service_type, gender
        `;
        
        const result = await dbGet(sql, [name_ar, iconUrl, service_type, gender, serviceId]);
        
        res.json({ 
            success: true, 
            message: 'Service updated successfully.',
            service: result
        });
        
    } catch (err) {
        console.error("Update service error:", err.message);
        res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// Delete service
app.delete('/api/admin/services/:service_id', async (req, res) => {
    try {
        const serviceId = req.params.service_id;
        
        if (!serviceId || isNaN(parseInt(serviceId))) {
            return res.status(400).json({ 
                success: false, 
                message: 'Valid service ID is required.' 
            });
        }
        
        // Get service data before deletion to clean up image
        const service = await dbGet("SELECT * FROM services WHERE id = $1", [serviceId]);
        if (!service) {
            return res.status(404).json({ 
                success: false, 
                message: 'Service not found.' 
            });
        }
        
        // Check if service is being used by any salons
        const usageCheck = await dbGet("SELECT COUNT(*) as count FROM salon_services WHERE service_id = $1", [serviceId]);
        if (usageCheck.count > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete service. It is currently being used by salons.' 
            });
        }
        
        // Delete image from Supabase if it exists and is a Supabase URL
        if (service.icon && service.icon.includes('supabase')) {
            try {
                const filename = service.icon.split('/').pop();
                await supabase.storage
                    .from('service-icons')
                    .remove([filename]);
            } catch (imageError) {
                console.warn('Failed to delete service icon:', imageError);
                // Continue with service deletion even if image deletion fails
            }
        }
        
        // Delete service from database
        await dbRun("DELETE FROM services WHERE id = $1", [serviceId]);
        
        res.json({ 
            success: true, 
            message: 'Service deleted successfully.' 
        });
        
    } catch (err) {
        console.error("Delete service error:", err.message);
        res.status(500).json({ success: false, message: 'Database error.' });
    }
});

// API to book a new appointment - UPDATED for Smart Staff Assignment and Multiple Services
// ===== SERVER-SIDE BOOKING VALIDATION FUNCTIONS =====

function timeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const [h, m] = timeStr.split(':').map(Number);
    let minutes = (h || 0) * 60 + (m || 0);
    
    // Handle overnight hours (e.g., 1am = 25:00 = 1500 minutes)
    // If hour is between 0-6, assume it's next day (add 24 hours)
    if (h >= 0 && h <= 6) {
        minutes += 24 * 60;
    }
    
    return minutes;
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
        // Handle both ISO format (with T) and other formats safely
        let startTimeStr, endTimeStr;
        
        if (startTime.includes('T')) {
            startTimeStr = startTime.split('T')[1].substring(0, 5);
        } else if (startTime.includes(' ')) {
            startTimeStr = startTime.split(' ')[1].substring(0, 5);
        } else {
            // Assume it's already in HH:MM format
            startTimeStr = startTime.substring(0, 5);
        }
        
        if (endTime.includes('T')) {
            endTimeStr = endTime.split('T')[1].substring(0, 5);
        } else if (endTime.includes(' ')) {
            endTimeStr = endTime.split(' ')[1].substring(0, 5);
        } else {
            // Assume it's already in HH:MM format
            endTimeStr = endTime.substring(0, 5);
        }
        
        const startMinutes = timeToMinutes(startTimeStr);
        const endMinutes = timeToMinutes(endTimeStr);
        
        // Validate service duration matches
        if (endMinutes - startMinutes !== serviceDuration) {
            return { valid: false, message: 'مدة الخدمة غير متطابقة مع الوقت المحدد.' };
        }
        
        // Get salon schedule data
        const schedule = await dbGet('SELECT * FROM schedules WHERE salon_id = $1', [salonId]);
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
            SELECT * FROM schedule_modifications 
            WHERE salon_id = $1 AND (
                (mod_type = 'once' AND mod_date = $2) OR
                (mod_type = 'recurring' AND mod_day_index = $3)
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
        const breaks = await dbAll('SELECT * FROM breaks WHERE salon_id = $1', [salonId]);
        
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
            WHERE salon_id = $1 AND DATE(start_time) = $2 
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
                const allStaff = await dbAll('SELECT id FROM staff WHERE salon_id = $1', [salonId]);
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

app.post('/api/appointment/book', requireAuth, async (req, res) => {
    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'بيانات الحجز غير صالحة.' });
    }
    const { salon_id, staff_id, service_id, services, start_time, end_time, price } = parsed.data;
    const user_id = req.user?.id;
    
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
            const serviceDetails = await dbGet('SELECT duration FROM salon_services WHERE salon_id = $1 AND service_id = $2', [salon_id, service.id]);
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
        
        // Emit SSE notification to salon dashboard (includes push notifications)
        await sendSalonEvent(salon_id, 'appointment_booked', {
            appointmentId,
            user_id,
            staff_id: staffIdForDB,
            staff_name: assignedStaffName,
            start_time,
            end_time,
            services_count: servicesToBook.length,
            price
        });

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

        // Only send push notification for bookings happening today (using Palestine timezone)
        const appointmentDate = new Date(start_time);
        const nowLocal = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
        
        // Check if appointment is today in Palestine timezone
        const isRelevantBooking = appointmentDate.toDateString() === nowLocal.toDateString();
        
        if (isRelevantBooking) {
            // Push notify salon of new booking (clean Arabic text, no user name)
            await sendPushToTargets({
                salon_id,
                payload: {
                    title: 'حجز جديد',
                    body: `لديك حجز جديد بتاريخ ${formatArabicDate(start_time)} على الساعة ${formatArabicTimeClean(start_time)}`,
                    url: '/home_salon.html#appointments'
                }
            });
        }

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
const fetchSalonsWithAvailability = async (city, gender) => {
    try {
        console.log(`🔍 DEBUG: fetchSalonsWithAvailability called with city: ${city}, gender: ${gender}`);
        const sql = `
            SELECT 
                s.id, 
                s.salon_name, 
                s.address, 
                s.city, 
                s.image_url, 
                s.gender_focus,
                s.special,
                COALESCE(AVG(r.rating), 0) AS avg_rating,
                COUNT(r.id) AS review_count
            FROM salons s
            LEFT JOIN reviews r ON s.id = r.salon_id
            WHERE s.gender_focus = $1 AND s.status = 'accepted'
            GROUP BY s.id, s.special
            ORDER BY s.special DESC, COALESCE(AVG(r.rating), 0) DESC
        `;
        const result = await db.query(sql, [gender]);
        console.log(`🔍 DEBUG: Found ${result.length} salons matching gender ${gender} and status accepted`);
        console.log(`🔍 DEBUG: Raw database result structure:`, result.length > 0 ? Object.keys(result[0]) : 'No results');
        
        // Add availability status for each salon
        const salonsWithAvailability = await Promise.all(result.map(async (salon) => {
            console.log(`🔍 DEBUG: Checking availability for salon: ${salon.salon_name} (ID: ${salon.id})`);
            const availabilityInfo = await checkSalonAvailabilityToday(salon.id);
            console.log(`🔍 DEBUG: Salon ${salon.salon_name} availability result:`, availabilityInfo);
            return {
                ...salon,
                is_available_today: availabilityInfo.is_available_today,
                status: availabilityInfo.status
            };
        }));
        
        console.log(`🔍 DEBUG: Final salons with availability:`, salonsWithAvailability.map(s => ({
            name: s.salon_name,
            id: s.id,
            city: s.city,
            available: s.is_available_today,
            status: s.status
        })));
        
        return salonsWithAvailability;
    } catch (err) {
        console.error(`🔍 DEBUG: Error in fetchSalonsWithAvailability:`, err);
        throw err;
    }
};

// Simple helper function to check salon status based on current time
const checkSalonAvailabilityToday = async (salonId) => {
    try {
        // Use Palestine timezone (Asia/Jerusalem) for accurate local time
        const today = new Date();
        const palestineTime = new Date(today.toLocaleString("en-US", {timeZone: "Asia/Jerusalem"}));
        const dayOfWeek = palestineTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const currentTime = palestineTime.getHours() * 60 + palestineTime.getMinutes(); // Current time in minutes
        
        // Get salon schedule
        const schedule = await dbGet('SELECT opening_time, closing_time, closed_days FROM schedules WHERE salon_id = $1', [salonId]);
        
        if (!schedule) {
            return { is_available_today: false, status: 'closed' };
        }
        
        // Parse closed days
        let closedDays = [];
        try {
            closedDays = schedule.closed_days ? JSON.parse(schedule.closed_days) : [];
        } catch (e) {
            closedDays = [];
        }
        
        // Check if today is a closed day
        if (closedDays.includes(dayOfWeek)) {
            return { is_available_today: false, status: 'closed' };
        }
        
        // Convert time string to minutes
        const timeToMinutes = (timeStr) => {
            if (!timeStr) return 0;
            const [hours, minutes] = timeStr.split(':').map(Number);
            return hours * 60 + minutes;
        };
        
        const openMinutes = timeToMinutes(schedule.opening_time || '09:00');
        const closeMinutes = timeToMinutes(schedule.closing_time || '18:00');
        
        // Simple logic: compare current time with opening hours
        let status = 'closed';
        let is_available_today = false;
        
        // Handle overnight schedules (e.g., 22:00 - 02:00)
        if (closeMinutes <= openMinutes) {
            // Overnight schedule
            if (currentTime >= openMinutes || currentTime < closeMinutes) {
                status = 'open';
                is_available_today = true;
                
                // Check if closing soon (within 1 hour)
                let timeUntilClose;
                if (currentTime >= openMinutes) {
                    // Evening part - time until midnight + morning part
                    timeUntilClose = (24 * 60 - currentTime) + closeMinutes;
                } else {
                    // Morning part - direct calculation
                    timeUntilClose = closeMinutes - currentTime;
                }
                
                if (timeUntilClose <= 60) {
                    status = 'closing_soon';
                }
            } else {
                // Check if opening soon (within 1 hour)
                const timeUntilOpen = openMinutes - currentTime;
                if (timeUntilOpen <= 60 && timeUntilOpen > 0) {
                    status = 'opening_soon';
                }
            }
        } else {
            // Normal schedule (e.g., 09:00 - 18:00)
            if (currentTime >= openMinutes && currentTime < closeMinutes) {
                status = 'open';
                is_available_today = true;
                
                // Check if closing soon (within 1 hour)
                const timeUntilClose = closeMinutes - currentTime;
                if (timeUntilClose <= 60) {
                    status = 'closing_soon';
                }
            } else if (currentTime < openMinutes) {
                // Check if opening soon (within 1 hour)
                const timeUntilOpen = openMinutes - currentTime;
                if (timeUntilOpen <= 60) {
                    status = 'opening_soon';
                }
            }
        }
        
        // Check for any full-day closures today
        const todayStr = today.toISOString().split('T')[0];
        const modifications = await dbAll(`
            SELECT * FROM schedule_modifications 
            WHERE salon_id = $1 AND closure_type = 'full_day' AND (
                (mod_type = 'date' AND mod_date = $2) OR
                (mod_type = 'day' AND mod_day_index = $3)
            )
        `, [salonId, todayStr, dayOfWeek]);
        
        if (modifications.length > 0) {
            return { is_available_today: false, status: 'closed' };
        }
        
        return { is_available_today, status };
        
    } catch (error) {
        console.error(`Error checking salon ${salonId} availability:`, error);
        return { is_available_today: false, status: 'closed' };
    }
};

app.get('/api/discovery/:city/:gender', async (req, res) => {
    // Smart caching: 30 seconds for real-time balance
    res.set({ 'Cache-Control': 'public, max-age=30' });
    
    const { city, gender } = req.params;
    const { service_ids } = req.query; // Capture service filter IDs (can be comma-separated)
    const genderFocus = gender === 'male' ? 'men' : 'women'; // Convert user gender to salon focus
    
    console.log(`🔍 DEBUG: Discovery endpoint called - City: ${city}, Gender: ${gender}, GenderFocus: ${genderFocus}, ServiceIDs: ${service_ids}`);
    
    try {
        // Fetch ALL relevant salons (all cities, matching gender focus)
        let allRelevantSalons = await fetchSalonsWithAvailability(city, genderFocus);
        console.log(`🔍 DEBUG: fetchSalonsWithAvailability returned ${allRelevantSalons.length} salons`);
        
        // --- Apply Service Filter ---
        if (service_ids) {
            console.log(`🔍 DEBUG: Applying service filter for IDs: ${service_ids}`);
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
                    salonIdsWithAllServices.has(salon.id)
                );
                console.log(`🔍 DEBUG: After service filter: ${allRelevantSalons.length} salons remain`);
            }
        }
        // --- END Service Filter ---


        // 1. Fetch Master Services for discovery cards - FIX: Use $1 placeholder
        const servicesSql = "SELECT id, name_ar, icon, service_type FROM services WHERE gender = $1";
        const discoveryServices = await db.query(servicesSql, [genderFocus]);
        
        // 2. Separate Salons for sections
        const citySalons = allRelevantSalons.filter(s => s.city === city);
        console.log(`🔍 DEBUG: City salons for ${city}: ${citySalons.length} salons`);
        console.log(`🔍 DEBUG: City salons details:`, citySalons.map(s => ({
            name: s.salon_name,
            id: s.id,
            available: s.is_available_today,
            status: s.status
        })));
        
        // Sort citySalons by availability - available salons first
        citySalons.sort((a, b) => {
            // Available salons (is_available_today = true) come first
            if (a.is_available_today && !b.is_available_today) return -1;
            if (!a.is_available_today && b.is_available_today) return 1;
            // If both have same availability status, sort by rating (higher first)
            return (b.avg_rating || 0) - (a.avg_rating || 0);
        });
        
        // Ensure that citySalons are only shown if they are not already in featuredSalons
        const featuredSalons = allRelevantSalons; 

        console.log(`🔍 DEBUG: Sending response with ${citySalons.length} city salons, ${featuredSalons.length} featured salons`);
        
        res.json({
            services: discoveryServices,
            citySalons: citySalons,
            featuredSalons: featuredSalons,
            allSalons: allRelevantSalons 
        });
        
    } catch (error) {
        console.error("🔍 DEBUG: Discovery fetch error:", error.message);
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
        // Index salon_images for quick lookup and primary selection
        await db.run(`CREATE INDEX IF NOT EXISTS idx_salon_images_salon ON salon_images(salon_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_salon_images_primary ON salon_images(salon_id, is_primary)`);
    } catch (e) {
        console.warn('ensurePerfIndexes warning:', e.message);
    }
}

// Favorites Route (Real Data)
app.get('/api/favorites/:user_id', requireAuth, async (req, res) => {
    const paramUserId = req.params.user_id;
    const authUserId = req.user?.id;
    
    // FIX: Add validation for user_id
    if (!paramUserId || paramUserId === 'undefined' || isNaN(parseInt(paramUserId))) {
         return res.status(400).json({ success: false, message: 'User ID is required and must be valid.' });
    }
    if (String(paramUserId) !== String(authUserId)) {
         return res.status(403).json({ success: false, message: 'Forbidden: cannot access another user\'s favorites.' });
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
        const rows = await dbAll(sql, [authUserId]);
        const favorites = rows.map(row => ({ ...row, is_favorite: true }));
        res.json(favorites);
    } catch (err) {
        console.error("Favorites fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});

app.post('/api/favorites/toggle', requireAuth, (req, res) => {
    const authUserId = req.user?.id;
    const salon_id_raw = req.body?.salon_id;
    const salon_id = typeof salon_id_raw === 'string' ? Number(salon_id_raw) : salon_id_raw;
    
    // FIX: Add validation for user_id and salon_id (Prevents 500 when frontend sends 'undefined')
    if (!authUserId || isNaN(parseInt(authUserId)) || !salon_id || isNaN(parseInt(salon_id))) {
         return res.status(400).json({ success: false, message: 'User ID and Salon ID must be valid numbers.' });
    }
    
    // FIX: Use $1, $2 placeholders and dbGet
    dbGet('SELECT * FROM favorites WHERE user_id = $1 AND salon_id = $2', [authUserId, salon_id]).then(row => {
        if (row) {
            // Delete (Unfavorite) - FIX: Use dbRun
            dbRun('DELETE FROM favorites WHERE user_id = $1 AND salon_id = $2', [authUserId, salon_id]).then(() => {
                res.json({ success: true, is_favorite: false, message: 'Unfavorited successfully.' });
            }).catch(err => {
                console.error("Delete error:", err.message);
                return res.status(500).json({ success: false, message: 'Delete error.' });
            });
        } else {
            // Insert (Favorite) - FIX: Use dbRun
            dbRun('INSERT INTO favorites (user_id, salon_id) VALUES ($1, $2)', [authUserId, salon_id]).then(() => {
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
app.get('/api/reviews/user/:user_id', requireAuth, (req, res) => {
    const { user_id: paramUserId } = req.params;
    const authUserId = req.user?.id;
    
    // FIX: Add validation for user_id
    if (!paramUserId || paramUserId === 'undefined' || isNaN(parseInt(paramUserId))) {
         return res.status(400).json({ success: false, message: 'User ID is required and must be valid.' });
    }
    if (String(paramUserId) !== String(authUserId)) {
         return res.status(403).json({ success: false, message: 'Forbidden: cannot access another user\'s reviews.' });
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
    dbAll(query, [authUserId]).then(rows => {
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
app.post('/api/reviews/submit', requireAuth, async (req, res) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Invalid review payload.' });
    }
    const { salon_id, rating, comment } = parsed.data;
    const user_id = req.user?.id;
    
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
app.delete('/api/reviews/delete', requireAuth, async (req, res) => {
    const authUserId = req.user?.id;
    const { salon_id } = req.body || {};
    
    // Validate required fields
    if (!authUserId || !salon_id) {
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
        
        const result = await dbRun(deleteQuery, [authUserId, salon_id]);
        
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
    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!bearer) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="admin", error="invalid_token"');
        return res.status(401).json({ error: 'No token provided' });
    }
    // Prefer JWT with role claim
    try {
        const payload = jwt.verify(bearer, JWT_SECRET);
        if (payload.role === 'admin') {
            req.user = { id: payload.sub, role: payload.role };
            return next();
        }
    } catch (_) {
        // fall through to legacy set check
    }
    // Legacy fallback: allow tokens present in in-memory set
    if (validAdminTokens.has(bearer)) {
        return next();
    }
    res.setHeader('WWW-Authenticate', 'Bearer realm="admin", error="invalid_token"');
    return res.status(401).json({ error: 'Invalid or unauthorized token' });
}

// Debug endpoints guard
function requireDebugEnabled(req, res, next) {
    const enabled = process.env.DEBUG_ENDPOINTS_ENABLED === 'true';
    if (!enabled) {
        return res.status(404).json({ error: 'Not found' });
    }
    next();
}

// Admin API endpoints (protected)
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
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
        
        // Total revenue from completed 200 ILS invoices
        const totalRevenueResult = await db.query(`
            SELECT COALESCE(SUM(amount), 0) as total_revenue 
            FROM payments 
            WHERE payment_type = $1 AND payment_status = $2
        `, ['offer_200ils', 'مكتملة']);
        const totalRevenue = totalRevenueResult[0];
        
        res.json({
            totalUsers: parseInt(totalUsers.count) || 0,
            totalSalons: parseInt(totalSalons.count) || 0,
            womenSalons: parseInt(womenSalons.count) || 0,
            menSalons: parseInt(menSalons.count) || 0,
            activeSalons: parseInt(activeSalons.count) || 0,
            pendingSalons: parseInt(pendingSalons.count) || 0,
            rejectedSalons: parseInt(rejectedSalons.count) || 0,
            totalAppointments: parseInt(totalAppointments.count) || 0,
            totalRevenue: parseInt(totalRevenue.total_revenue) || 0
        });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const users = await db.query('SELECT id, name, email, phone, city, user_type FROM users ORDER BY id DESC');
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/salons', requireAdmin, async (req, res) => {
    try {
        const salons = await db.query(`
            SELECT s.id, s.salon_name, s.owner_name, u.email, s.salon_phone, s.owner_phone, s.city, s.gender_focus, s.image_url, s.status, s.plan, s.plan_chairs, s.created_at 
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

app.get('/api/admin/appointments', requireAdmin, async (req, res) => {
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

// Get all payments for admin dashboard
app.get('/api/admin/payments', requireAdmin, async (req, res) => {
    try {
        const payments = await db.query(`
            SELECT 
                p.*,
                s.salon_name,
                s.owner_name,
                u.name as user_name,
                u.email as user_email
            FROM payments p
            LEFT JOIN salons s ON p.salon_id = s.id
            LEFT JOIN users u ON s.user_id = u.id
            ORDER BY p.created_at DESC
        `);
        res.json(payments);
    } catch (error) {
        console.error('Error fetching admin payments:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update salon status (approve/reject)
app.post('/api/admin/salon/status/:salon_id', requireAdmin, async (req, res) => {
    try {
        const { salon_id } = req.params;
        const {
            status,
            invoiceOption, // 'none' | 'offer' | 'renewal'
            planType,      // '2months_offer' | 'monthly_200' | 'monthly_60' | 'per_booking'
            planChairs     // integer when monthly_60
        } = req.body || {};

        // Validate status
        if (!['pending', 'accepted', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be pending, accepted, or rejected.' });
        }

        // Normalize plan fields
        const allowedPlans = new Set(['2months_offer', 'monthly_200', 'monthly_60', 'per_booking']);
        const normalizedPlan = allowedPlans.has(planType) ? planType : null;
        const normalizedChairs = normalizedPlan === 'monthly_60' ? Math.max(1, parseInt(planChairs || '1', 10)) : null;

        // Update salon status + plan data
        if (normalizedPlan) {
            await db.query('UPDATE salons SET status = $1, plan = $2, plan_chairs = $3 WHERE id = $4', [
                status,
                normalizedPlan,
                normalizedChairs || 1,
                salon_id
            ]);
        } else {
            await db.query('UPDATE salons SET status = $1 WHERE id = $2', [status, salon_id]);
        }

        // Create payment/invoice if requested and salon accepted
        if (status === 'accepted' && invoiceOption && invoiceOption !== 'none') {
            const invoiceNumber = `INV-${Date.now()}-${salon_id}`;
            const validFrom = new Date();
            const validUntil = new Date();
            let paymentType = null;
            let amount = 0;
            let description = '';

            if (invoiceOption === 'offer' && normalizedPlan === '2months_offer') {
                paymentType = 'offer_200ils';
                amount = 200; // rounded price
                validUntil.setMonth(validUntil.getMonth() + 2);
                description = 'عرض خاص للصالونات الجديدة - 200 شيكل لمدة شهرين';
            } else if (invoiceOption === 'renewal') {
                if (normalizedPlan === 'monthly_200') {
                    paymentType = 'monthly_200';
                    amount = 200;
                    validUntil.setMonth(validUntil.getMonth() + 1);
                    description = 'اشتراك شهري للصالحون: 200 شيكل';
                } else if (normalizedPlan === 'monthly_60') {
                    const chairs = normalizedChairs || 1;
                    paymentType = 'monthly_60';
                    amount = 60 * chairs; // rounded price per chair
                    validUntil.setMonth(validUntil.getMonth() + 1);
                    description = `اشتراك شهري لكل كرسي: 60 شيكل × ${chairs} = ${amount} شيكل`;
                } else if (normalizedPlan === '2months_offer') {
                    // If plan is offer but invoiceOption is renewal, treat as monthly_200 renewal
                    paymentType = 'monthly_200';
                    amount = 200;
                    validUntil.setMonth(validUntil.getMonth() + 1);
                    description = 'تجديد شهري: 200 شيكل';
                } else {
                    // per_booking doesn't produce upfront invoice on renewal
                    paymentType = null;
                }
            }

            if (paymentType) {
                await db.query(
                    `INSERT INTO payments (
                        salon_id, payment_type, amount, currency, payment_status,
                        payment_method, description, valid_from, valid_until,
                        invoice_number, admin_notes
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [
                        salon_id,
                        paymentType,
                        amount,
                        'ILS',
                        'مكتملة',
                        'cash',
                        description,
                        validFrom.toISOString(),
                        validUntil.toISOString(),
                        invoiceNumber,
                        'Admin updated salon status with invoice'
                    ]
                );
            }
        }

        // If salon is accepted, send congratulatory notification
        if (status === 'accepted') {
            await sendPushToTargets({
                salon_id,
                payload: {
                    title: 'مبروك! تم قبول صالونك',
                    body: 'تهانينا! صالونك الآن نشط ويمكن للجميع رؤيته والحجز من خلاله. ابدأ رحلتك معنا الآن!',
                    url: '/home_salon.html',
                    tag: 'salon_accepted'
                }
            });
        }

        res.json({ success: true, message: `Salon status updated to ${status}` });
    } catch (err) {
        console.error('Error updating salon status:', err.message);
        res.status(500).json({ error: 'Failed to update salon status' });
    }
});

// Get salon payments/invoices
app.get('/api/salon/payments/:salon_id', async (req, res) => {
    try {
        const { salon_id } = req.params;
        
        const payments = await db.query(`
            SELECT 
                id, payment_type, amount, currency, payment_status,
                payment_method, description, valid_from, valid_until,
                invoice_number, created_at
            FROM payments 
            WHERE salon_id = $1 
            ORDER BY created_at DESC
        `, [salon_id]);
        
        res.json({ success: true, payments });
    } catch (error) {
        console.error('Error fetching salon payments:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Start server
// Debug endpoint to check database content
app.get('/api/debug/salons', requireAdmin, requireDebugEnabled, async (req, res) => {
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

// Debug endpoint to check salon schedules and status calculation
app.get('/api/debug/salon-status/:salon_id', requireAdmin, requireDebugEnabled, async (req, res) => {
    try {
        const { salon_id } = req.params;
        
        // Get salon info
        const salon = await dbGet('SELECT id, salon_name FROM salons WHERE id = $1', [salon_id]);
        if (!salon) {
            return res.status(404).json({ error: 'Salon not found' });
        }
        
        // Get schedule
        const schedule = await dbGet('SELECT opening_time, closing_time, closed_days FROM schedules WHERE salon_id = $1', [salon_id]);
        
        // Get current time info
        const today = new Date();
        const dayOfWeek = today.getDay();
        const currentTime = today.getHours() * 60 + today.getMinutes();
        
        // Calculate availability
        const availabilityInfo = await checkSalonAvailabilityToday(salon_id);
        
        res.json({
            salon,
            schedule,
            currentTime: {
                dayOfWeek,
                currentTimeMinutes: currentTime,
                currentTimeFormatted: `${Math.floor(currentTime / 60)}:${(currentTime % 60).toString().padStart(2, '0')}`
            },
            availabilityInfo
        });
    } catch (error) {
        console.error('Debug salon status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Debug endpoint to align schema immediately without restart (safe idempotent adjustments)
app.post('/api/debug/align-schema', requireAdmin, requireDebugEnabled, async (req, res) => {
    try {
        await alignSchema();
        res.json({ success: true, message: 'Schema alignment executed.' });
    } catch (error) {
        console.error('Schema align endpoint error:', error);
        res.status(500).json({ success: false, message: 'Failed to align schema.', error: error.message });
    }
});

// GET alias for easier triggering in some environments
app.get('/api/debug/align-schema', requireAdmin, requireDebugEnabled, async (req, res) => {
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
            origin: allowedOrigins.length ? allowedOrigins : true,
            methods: ['GET','POST'],
            credentials: true
        }
    });

    // Enhanced WebSocket handling for real-time updates
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        // Salon room join with enhanced logging
        socket.on('joinSalon', (salonId) => {
            try {
                const sid = parseInt(salonId);
                if (!isNaN(sid)) {
                    const room = `salon_${sid}`;
                    socket.join(room);
                    socket.salonId = sid; // Store salon ID on socket
                    console.log(`Salon ${sid} joined room: ${room}`);
                    socket.emit('joinedSalon', { room, salonId: sid });
                }
            } catch (e) {
                console.warn('joinSalon handler error:', e.message);
            }
        });

        // User room join for real-time slot updates
        socket.on('joinUser', (userId) => {
            try {
                const uid = parseInt(userId);
                if (!isNaN(uid)) {
                    const room = `user_${uid}`;
                    socket.join(room);
                    socket.userId = uid; // Store user ID on socket
                    console.log(`User ${uid} joined room: ${room}`);
                    socket.emit('joinedUser', { room, userId: uid });
                }
            } catch (e) {
                console.warn('joinUser handler error:', e.message);
            }
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            if (socket.salonId) {
                console.log(`Salon ${socket.salonId} disconnected`);
            }
            if (socket.userId) {
                console.log(`User ${socket.userId} disconnected`);
            }
        });
    });

    // Helper function to broadcast to salon rooms
    global.broadcastToSalon = (salonId, event, data) => {
        if (io) {
            io.to(`salon_${salonId}`).emit(event, data);
            console.log(`Broadcasted ${event} to salon ${salonId}`);
        }
    };

    // Helper function to broadcast to user rooms
    global.broadcastToUser = (userId, event, data) => {
        if (io) {
            io.to(`user_${userId}`).emit(event, data);
            console.log(`Broadcasted ${event} to user ${userId}`);
        }
    };

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
        await initializeDb();
        await alignSchema();
        await ensurePerfIndexes();
        // insertMasterServices is called inside initializeDb now.
        console.log("Database schema created successfully and master data inserted.");
    } catch (error) {
        console.error("Database initialization error:", error.message);
    }
});
