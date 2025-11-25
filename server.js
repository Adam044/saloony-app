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

// Legacy admin token set for backward compatibility
const validAdminTokens = new Set();

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
            username TEXT UNIQUE,
            phone TEXT,
            gender TEXT,
            city TEXT,
            password TEXT NOT NULL,
            strikes INTEGER DEFAULT 0,
            user_type TEXT DEFAULT 'user',
            language_preference VARCHAR(10) DEFAULT 'auto'
        )`);
        try { await db.run(`UPDATE users SET email = NULL WHERE email = ''`); } catch (_) {}
        try {
            const colsRes = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2`, ['users', 'public']);
            const cols = new Set((colsRes || []).map(r => r.column_name));
            if (!cols.has('username')) {
                await db.run(`ALTER TABLE users ADD COLUMN username TEXT UNIQUE`);
            }
        } catch (e) {
            try { const pragma = await db.query(`PRAGMA table_info(users)`); const cols = new Set((pragma || []).map(r => r.name)); if (!cols.has('username')) { await db.run(`ALTER TABLE users ADD COLUMN username TEXT UNIQUE`); } } catch (_) {}
        }

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
            is_active BOOLEAN DEFAULT TRUE,
            UNIQUE(name_ar, gender)
        )`);

        try {
            const svcColsRes = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2`, ['services', 'public']);
            const svcCols = new Set((svcColsRes || []).map(r => r.column_name));
            if (!svcCols.has('home_page_icon')) {
                await db.run(`ALTER TABLE services ADD COLUMN home_page_icon TEXT`);
            }
            if (!svcCols.has('is_active')) {
                await db.run(`ALTER TABLE services ADD COLUMN is_active BOOLEAN DEFAULT TRUE`);
            }
        } catch (e) {
            try { const svcPragma = await db.query(`PRAGMA table_info(services)`); const svcCols = new Set((svcPragma || []).map(r => r.name)); if (!svcCols.has('home_page_icon')) { await db.run(`ALTER TABLE services ADD COLUMN home_page_icon TEXT`); } if (!svcCols.has('is_active')) { await db.run(`ALTER TABLE services ADD COLUMN is_active BOOLEAN DEFAULT TRUE`); } } catch (_) {}
        }

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

        // Employee daily sessions (start-of-day marker)
        await db.run(`CREATE TABLE IF NOT EXISTS employee_sessions (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL,
            date DATE NOT NULL DEFAULT CURRENT_DATE,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(employee_id, date),
            FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Employee visits logged during field work
        await db.run(`CREATE TABLE IF NOT EXISTS employee_visits (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL,
            salon_name TEXT NOT NULL,
            status TEXT NOT NULL,
            interest_level INTEGER,
            comments TEXT,
            address TEXT,
            plan_core VARCHAR(20),
            plan_option VARCHAR(30),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
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

        await db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            plan VARCHAR(30),
            package VARCHAR(40),
            start_date DATE NOT NULL,
            end_date DATE,
            status VARCHAR(20) DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
        )`);
        await db.run(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan VARCHAR(30)`);
        await db.run(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS package VARCHAR(40)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_subscriptions_salon ON subscriptions(salon_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_subscriptions_end ON subscriptions(end_date)`);
        try { await db.run(`ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_payment_id_fkey`); } catch (_) {}
        try { await db.run(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS payment_id`); } catch (_) {}
        try { await db.run(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS plan_type`); } catch (_) {}
        try { await db.run(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS plan_chairs`); } catch (_) {}

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

        await db.run(`CREATE TABLE IF NOT EXISTS password_reset_codes (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code_hash TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            attempts_left INTEGER NOT NULL DEFAULT 5,
            used_at TIMESTAMP,
            generated_by_admin_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_prc_user ON password_reset_codes(user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_prc_expires ON password_reset_codes(expires_at)`);

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

            // Ensure employee_visits has interest_level/address/plan fields
            try {
                const evCols = await db.query(
                    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2`,
                    ['employee_visits', 'public']
                );
                const evSet = new Set((evCols || []).map(c => c.column_name));
                if (!evSet.has('interest_level')) {
                    console.log('AlignSchema: Adding interest_level to employee_visits (PostgreSQL)...');
                    await db.run(`ALTER TABLE employee_visits ADD COLUMN interest_level INTEGER`);
                }
                if (!evSet.has('address')) {
                    console.log('AlignSchema: Adding address to employee_visits (PostgreSQL)...');
                    await db.run(`ALTER TABLE employee_visits ADD COLUMN address TEXT`);
                }
                if (!evSet.has('plan_core')) {
                    console.log('AlignSchema: Adding plan_core to employee_visits (PostgreSQL)...');
                    await db.run(`ALTER TABLE employee_visits ADD COLUMN plan_core VARCHAR(20)`);
                }
                if (!evSet.has('plan_option')) {
                    console.log('AlignSchema: Adding plan_option to employee_visits (PostgreSQL)...');
                    await db.run(`ALTER TABLE employee_visits ADD COLUMN plan_option VARCHAR(30)`);
                }
            } catch (e) {
                console.warn('AlignSchema: employee_visits interest_level align warning (PostgreSQL):', e.message);
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

            // Ensure employee_sessions has ended_at and notes columns
            try {
                const esCols = await db.query(
                    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2`,
                    ['employee_sessions', 'public']
                );
                const esSet = new Set((esCols || []).map(c => c.column_name));
                if (!esSet.has('ended_at')) {
                    console.log('AlignSchema: Adding ended_at to employee_sessions (PostgreSQL)...');
                    await db.run(`ALTER TABLE employee_sessions ADD COLUMN ended_at TIMESTAMP`);
                }
                if (!esSet.has('notes')) {
                    console.log('AlignSchema: Adding notes to employee_sessions (PostgreSQL)...');
                    await db.run(`ALTER TABLE employee_sessions ADD COLUMN notes TEXT`);
                }
            } catch (e) {
                console.warn('AlignSchema: employee_sessions alignment warning (PostgreSQL):', e.message);
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
            // SQLite: ensure employee_visits interest_level/address/plan fields exist
            try {
                const evPragma = await db.query(`PRAGMA table_info(employee_visits)`);
                const evCols = new Set((evPragma || []).map(r => r.name));
                if (!evCols.has('interest_level')) {
                    console.log('AlignSchema: Adding interest_level to employee_visits (SQLite)...');
                    await db.run(`ALTER TABLE employee_visits ADD COLUMN interest_level INTEGER`);
                }
                if (!evCols.has('address')) {
                    console.log('AlignSchema: Adding address to employee_visits (SQLite)...');
                    await db.run(`ALTER TABLE employee_visits ADD COLUMN address TEXT`);
                }
                if (!evCols.has('plan_core')) {
                    console.log('AlignSchema: Adding plan_core to employee_visits (SQLite)...');
                    await db.run(`ALTER TABLE employee_visits ADD COLUMN plan_core TEXT`);
                }
                if (!evCols.has('plan_option')) {
                    console.log('AlignSchema: Adding plan_option to employee_visits (SQLite)...');
                    await db.run(`ALTER TABLE employee_visits ADD COLUMN plan_option TEXT`);
                }
            } catch (e) {
                console.warn('AlignSchema: SQLite employee_visits align warning:', e.message);
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

async function backfillSubscriptionsFromSalons() {
    try {
        const salons = await db.query('SELECT id, status, plan, plan_chairs, created_at FROM salons');
        for (const s of salons) {
            const existing = await db.query('SELECT id FROM subscriptions WHERE salon_id = $1 LIMIT 1', [s.id]);
            if (existing && existing.length) continue;
            let planType = s.plan || null;
            let chairs = s.plan_chairs || null;
            let startDate = null;
            let endDate = null;
            try {
                const pays = await db.query('SELECT id, payment_type, valid_from, valid_until FROM payments WHERE salon_id = $1 ORDER BY created_at DESC LIMIT 1', [s.id]);
                if (pays && pays.length) {
                    const p = pays[0];
                    const map = {
                        'offer_200ils': '2months_offer',
                        'monthly_subscription': 'monthly_200',
                        'monthly_200': 'monthly_200',
                        'per_chair': 'monthly_60',
                        'monthly_60': 'monthly_60',
                        'per_booking': 'per_booking',
                        'visibility_only_monthly_99': 'visibility_only',
                        'visibility_only_offer_199': 'visibility_only'
                    };
                    planType = planType || map[p.payment_type] || null;
                    startDate = p.valid_from || startDate;
                    endDate = p.valid_until || endDate;
                }
            } catch (_) {}
            if (!planType) continue;
            if (!startDate) startDate = s.created_at || new Date().toISOString();
            const status = s.status === 'accepted' ? 'active' : 'inactive';
            const derivedPlan = planType === 'visibility_only' ? 'visibility_only' : 'booking';
            const derivedPackage = planType;
            await db.query(
                `INSERT INTO subscriptions (salon_id, plan, package, start_date, end_date, status)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [s.id, derivedPlan, derivedPackage, startDate, endDate, status]
            );
        }
    } catch (_) {}
}

async function updateSubscriptionStatusesDaily() {
    const runUpdate = async () => {
        try {
            const today = new Date();
            const todayStr = today.toISOString();
            // Expire subscriptions past end_date
            await db.query(`UPDATE subscriptions SET status = 'expired' WHERE end_date IS NOT NULL AND end_date < $1 AND status != 'expired'`, [todayStr]);
            // Optionally mark expiring soon (7 days) — leave status 'active' but broadcast info
            const expiringSoon = await db.query(`
                SELECT sub.*, s.salon_name FROM subscriptions sub
                LEFT JOIN salons s ON sub.salon_id = s.id
                WHERE sub.end_date IS NOT NULL AND sub.end_date >= $1 AND sub.end_date < $2 AND sub.status = 'active'
            `, [todayStr, new Date(Date.now()+7*24*60*60*1000).toISOString()]);
            if (expiringSoon && expiringSoon.length) {
                global.broadcastToAdmins && global.broadcastToAdmins('subscriptions_status_update', { type: 'expiring_soon', items: expiringSoon });
            }
        } catch (e) {
            console.warn('Daily subscription status update error:', e.message);
        }
    };
    // Run once at startup and then daily
    runUpdate();
    const dayMs = 24 * 60 * 60 * 1000;
    setInterval(runUpdate, dayMs);
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
    }
}));

// Additional security headers
app.use(helmet.frameguard({ action: 'deny' })); // Disallow embedding
app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' })); // Preserve origin for allowlist checks
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

// Map config for frontend
app.get('/api/map/config', (req, res) => {
    const styleUrl = process.env.OGMAP_STYLE_URL || 'https://ogmap.com/styles/bright_city_style.json';
    const apiKey = process.env.OGMAP_API_KEY || '';
    const tilesBase = 'https://tiles.ogmap.com/{z}/{x}/{y}.pbf';
    res.json({ success: true, styleUrl, apiKey, tilesBase });
});

// Server-side proxy to Nominatim to avoid browser CORS blocks
app.get('/api/proxy/nominatim', async (req, res) => {
    try {
        const isReverse = (req.query.reverse || '').toString() === '1';
        let url = '';
        if (isReverse) {
            const lat = (req.query.lat || '').toString();
            const lon = (req.query.lon || '').toString();
            if (!lat || !lon) return res.json({});
            const zoom = (req.query.zoom || '18').toString();
            const namedetails = (req.query.namedetails || '1').toString();
            const extratags = (req.query.extratags || '1').toString();
            url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=json&accept-language=ar&zoom=${encodeURIComponent(zoom)}&namedetails=${encodeURIComponent(namedetails)}&extratags=${encodeURIComponent(extratags)}`;
        } else {
            const q = (req.query.q || '').toString();
            if (!q || q.length < 2) return res.json([]);
            url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(q) + '&format=json&limit=1&accept-language=ar';
        }
        const r = await fetch(url, { headers: { 'User-Agent': 'Saloony/1.0 (+mailto:saloony.service@gmail.com)' } });
        if (!r.ok) return res.status(r.status).json(isReverse ? {} : []);
        const j = await r.json();
        return res.json(j);
    } catch (e) {
        return res.status(502).json({});
    }
});

// Proxy OGMAP vector tiles through our server to bypass domain allowlist during development
// In-memory tile cache and throttled upstream fetch to avoid 429s
const tileCache = new Map(); // key: `${z}/${x}/${y}` -> { buf: Buffer, ts: number }
const inFlight = new Map(); // key -> Promise<Buffer>
let tileActive = 0;
const TILE_MAX_ACTIVE = parseInt(process.env.TILE_CONCURRENCY || '8', 10);
const TILE_TTL_MS = parseInt(process.env.TILE_CACHE_TTL_MS || String(10 * 60 * 1000), 10);
const tileQueue = [];
function fetchTileThrottled(job) {
  return new Promise((resolve, reject) => {
    tileQueue.push({ job, resolve, reject });
    process.nextTick(runTileQueue);
  });
}
function runTileQueue() {
  while (tileActive < TILE_MAX_ACTIVE && tileQueue.length) {
    const { job, resolve, reject } = tileQueue.shift();
    tileActive++;
    job().then((buf) => { tileActive--; resolve(buf); runTileQueue(); }).catch((err) => { tileActive--; reject(err); runTileQueue(); });
  }
}
app.get('/api/ogmap/tiles/:z/:x/:y.pbf', async (req, res) => {
  try {
    const { z, x, y } = req.params;
    const cacheKey = `${z}/${x}/${y}`;
    const cached = tileCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.ts) < TILE_TTL_MS) {
      res.setHeader('Content-Type', 'application/x-protobuf');
      res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
      return res.send(cached.buf);
    }
    if (inFlight.has(cacheKey)) {
      const buf = await inFlight.get(cacheKey);
      res.setHeader('Content-Type', 'application/x-protobuf');
      res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
      return res.send(buf);
    }
    const key = process.env.OGMAP_API_KEY || '';
    const url = `https://tiles.ogmap.com/${encodeURIComponent(z)}/${encodeURIComponent(x)}/${encodeURIComponent(y)}.pbf${key ? `?key=${encodeURIComponent(key)}` : ''}`;
    const origin = (req.headers.origin && typeof req.headers.origin === 'string') ? req.headers.origin : `${req.protocol}://${req.get('host')}`;
    const ref = (req.headers.referer && typeof req.headers.referer === 'string') ? req.headers.referer : origin + '/';
    const doFetch = async () => {
      const r = await fetch(url, { headers: { 'User-Agent': 'Saloony/1.0 (+mailto:saloony.service@gmail.com)', 'Origin': origin, 'Referer': ref } });
      if (!r.ok) {
        const status = r.status || 502;
        if (status === 429) {
          await new Promise(resolve => setTimeout(resolve, 150));
          // one retry after short backoff
          const rr = await fetch(url, { headers: { 'User-Agent': 'Saloony/1.0 (+mailto:saloony.service@gmail.com)', 'Origin': origin, 'Referer': ref } });
          if (!rr.ok) throw new Error(`Upstream ${status}`);
          const abb = await rr.arrayBuffer();
          return Buffer.from(abb);
        }
        throw new Error(`Upstream ${status}`);
      }
      const ab = await r.arrayBuffer();
      return Buffer.from(ab);
    };
    const p = fetchTileThrottled(doFetch);
    inFlight.set(cacheKey, p);
    try {
      const buf = await p;
      inFlight.delete(cacheKey);
      tileCache.set(cacheKey, { buf, ts: Date.now() });
      res.setHeader('Content-Type', 'application/x-protobuf');
      res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
      return res.send(buf);
    } catch (err) {
      inFlight.delete(cacheKey);
      return res.status(502).send();
    }
  } catch (e) {
    return res.status(502).send();
  }
});

// Middleware setup
app.use(compression()); // Compress all responses to improve load times
app.use(bodyParser.json({ limit: '10mb' })); // Reasonable JSON body limit
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Lightweight image transform proxy for square thumbnails

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

const registerReviewsRoutes = require('./routes/reviews');
const registerAdminRoutes = require('./routes/admin');
const registerAppointmentsRoutes = require('./routes/appointments');
const registerSalonRoutes = require('./routes/salon');
const registerEmployeeRoutes = require('./routes/employee');
const registerDiscoveryRoutes = require('./routes/discovery');
const registerPushRoutes = require('./routes/push');
const registerAiRoutes = require('./routes/ai');
const registerSubscriptionsRoutes = require('./routes/subscriptions');

registerReviewsRoutes(app, { dbAll, dbGet, dbRun, requireAuth });
registerAdminRoutes(app, { db, requireAdmin, requireDebugEnabled });
registerSubscriptionsRoutes(app, { db, requireAdmin });
registerSalonRoutes(app, { db, dbAll, dbGet, dbRun, requireSalonAdminRole, addSalonClient, removeSalonClient, sendSalonEvent, bcrypt, crypto });
registerEmployeeRoutes(app, { db, requireRole, sendPushToAdmins });
registerPushRoutes(app, { dbAll, dbGet, dbRun, webPush, sendPushToTargets, VAPID_PUBLIC_KEY });
registerAiRoutes(app, { aiAssistant, dbGet });

app.use((req, res, next) => {
    const start = Date.now();
    const id = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex');
    req.id = id;
    res.setHeader('X-Request-Id', id);
    res.on('finish', () => {
        const ms = Date.now() - start;
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms ${id}`);
    });
    next();
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

function getCookie(req, name) {
    const header = req.headers.cookie || '';
    const parts = header.split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k === name) return decodeURIComponent(v);
    }
    return null;
}

// Generic role guard using JWT role claim
function requireRole(role) {
    return (req, res, next) => authenticateJWT(req, res, () => {
        if (req.user.role !== role) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    });
}

// ===== Zod Schemas =====
const loginSchema = z.object({
    identifier: z.string().trim().min(3).optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().regex(/^0\d{9}$/).optional(),
    password: z.string().min(6),
    desired_type: z.enum(['user','employee','salon','admin']).optional()
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

// Register appointments routes after schemas are initialized
registerAppointmentsRoutes(app, { dbAll, dbGet, dbRun, requireAuth, bookingSchema, validateBookingSlot, sendSalonEvent, sendPushToTargets });
// AI Beauty Assistant Endpoints
// ===============================

// === AI Analytics Dashboard ===

// AI Analytics Dashboard Route
app.get('/ai-analytics', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin', 'ai_analytics.html'));
});

// AI Analytics API Route
/*removed ai endpoint*/
 

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

 

// === AI Chat Endpoints ===

// Main AI Chat Endpoint
/*removed ai endpoint*/
 

// Clear conversation history
/*removed ai endpoint*/
 

// Get conversation statistics
/*removed ai endpoint*/
 

// Learn from user interactions
 


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

// Serve map icons
app.use('/map_icons', express.static(path.join(__dirname, 'map_icons'), { maxAge: '7d', etag: true }));

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

// Lightweight health ping for outage detection (network-only via SW)
app.get('/api/ping', (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ ok: true, t: Date.now() });
    } catch (e) {
        res.status(500).json({ ok: false });
    }
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

// Subscribe endpoint: store subscription for a user or salon


// Unsubscribe endpoint: remove subscription by endpoint

// Debug endpoint: list subscriptions by user or salon

// Test endpoint: send a sample push notification to a user or salon

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

// Helper to send a push notification to all admin user subscriptions
async function sendPushToAdmins(payload) {
    try {
        const rows = await dbAll('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (SELECT id FROM users WHERE user_type = $1)', ['admin']);
        if (!rows || rows.length === 0) return;
        const payloadStr = JSON.stringify(payload);
        await Promise.all(rows.map(async (row) => {
            const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
            try { await webPush.sendNotification(sub, payloadStr); } catch (err) {
                if (err.statusCode === 404 || err.statusCode === 410) { try { await dbRun('DELETE FROM push_subscriptions WHERE endpoint = $1', [row.endpoint]); } catch (_) {} }
                console.warn('Push send to admin failed:', err.message);
            }
        }));
    } catch (err) { console.error('sendPushToAdmins error:', err.message); }
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
        let { user_type, name, email, password, phone, city, gender, owner_name, owner_phone, address, gender_focus, image_url } = req.body;
        
        console.log('=== REGISTER REQUEST ===');
        console.log('User type:', user_type);
        console.log('Email:', email);
        console.log('Raw phones:', phone, owner_phone);
        
        // Canonicalize phone inputs to local format (0 + 9 digits) to reduce 400s on formats like +972...
        const toLocalPhone = (input) => {
            if (!input) return input;
            const digits = normalizePhoneNumber(input);
            if (!digits) return input;
            const last9 = digits.slice(-9);
            return `0${last9}`;
        };
        phone = toLocalPhone(phone);
        owner_phone = toLocalPhone(owner_phone);
        console.log('Normalized phones:', phone, owner_phone);

        // Validate phone format
        if (user_type === 'user' && phone && !validatePhoneFormat(phone)) {
            console.warn('Register invalid user phone:', phone);
            return res.status(400).json({ 
                success: false, 
                message: 'رقم الهاتف يجب أن يبدأ بـ 0 ويكون 10 أرقام', 
                message_en: 'Phone number must start with 0 and be 10 digits' 
            });
        }
        
        if (user_type === 'salon') {
            if (phone && !validatePhoneFormat(phone)) {
                console.warn('Register invalid salon phone:', phone);
                return res.status(400).json({ 
                    success: false, 
                    message: 'رقم هاتف الصالون يجب أن يبدأ بـ 0 ويكون 10 أرقام', 
                    message_en: 'Salon phone number must start with 0 and be 10 digits' 
                });
            }
            if (owner_phone && !validatePhoneFormat(owner_phone)) {
                console.warn('Register invalid owner phone:', owner_phone);
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
                    console.warn('Register duplicate owner_phone:', user_phone_to_use, 'existing id:', existingUser.id);
                    return res.status(400).json({ 
                        success: false, 
                        message: 'رقم الهاتف مسجل بالفعل.', 
                        message_en: 'Phone number already registered.' 
                    });
                }
            }

            // Relaxed: do not block if salon phone matches an existing user phone
            // We only enforce uniqueness on owner_phone in users table.

            let userResult;
            try {
                let emailToInsert = email && email.trim() !== '' ? email : null;
                if (emailToInsert) {
                    const existingEmail = await db.get('SELECT id FROM users WHERE email = $1', [emailToInsert]);
                    if (existingEmail) emailToInsert = null;
                }
                userResult = await db.query(userSql, [user_name_to_use, emailToInsert, user_phone_to_use, gender_to_use, city, hashedPassword, user_type]);
            } catch (err) {
                if (err.code === '23505') {
                    console.warn('Register email unique violation:', email);
                    return res.status(400).json({ success: false, message: 'البريد الإلكتروني مسجل بالفعل.', message_en: 'Email already registered.' });
                }
                console.error('User signup DB error:', err);
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
            console.warn('Register invalid user_type:', user_type);
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
        const looksLikePhone = /^0\d{9}$/.test(input);
        
        // Validate phone format only when the identifier is digits-only (i.e., user typed a phone)
        if (!isEmail && /^\d+$/.test(input) && !validatePhoneFormat(input)) {
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
        } else if (looksLikePhone) {
            const normalizedIdentifier = normalizePhoneNumber(input);
            userResult = await db.query(
                "SELECT id, name, email, city, gender, phone, user_type, password, strikes FROM users WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) = $1",
                [normalizedIdentifier]
            );
        } else {
            userResult = await db.query('SELECT id, name, email, city, gender, phone, user_type, password, strikes FROM users WHERE LOWER(username) = LOWER($1)', [input]);
        }
        if (!isEmail && Array.isArray(userResult) && userResult.length > 1) {
            const desired = parsed.data.desired_type || '';
            if (!desired) {
                return res.status(409).json({
                    success: false,
                    require_selection: true,
                    accounts: userResult.map(r => ({ user_type: r.user_type, name: r.name }))
                });
            }
            const filtered = userResult.filter(r => r.user_type === desired);
            if (!filtered.length) {
                return res.status(404).json({ success: false, message: 'لا يوجد حساب مطابق للاختيار.' });
            }
            userResult = filtered;
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
        } else if (userType === 'employee') {
            redirectUrl = '/employee_dashboard.html';
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
        let refresh_token = (req.body || {}).refresh_token;
        if (!refresh_token) {
            refresh_token = getCookie(req, 'refresh_token');
        }
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

const resetVerifyLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 20 });
const resetCompleteLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10 });

app.post('/api/admin/password-reset/generate', requireAdmin, async (req, res) => {
    try {
        const { identifier, user_id } = req.body || {};
        let user;
        if (user_id) {
            user = await dbGet('SELECT id, email, phone FROM users WHERE id = $1', [Number(user_id)]);
        } else if (identifier) {
            const input = String(identifier).trim();
            const isEmail = input.includes('@');
            if (isEmail) {
                user = await dbGet('SELECT id, email, phone FROM users WHERE email = $1', [input]);
            } else {
                const norm = normalizePhoneNumber(input);
                const rows = await db.query("SELECT id, email, phone FROM users WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) = $1", [norm]);
                user = rows && rows[0];
            }
        }
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const hash = await bcrypt.hash(code, 12);
        const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await dbRun('INSERT INTO password_reset_codes (user_id, code_hash, expires_at, attempts_left, generated_by_admin_id) VALUES ($1, $2, $3, $4, $5)', [user.id, hash, expires, 5, req.user.id]);
        return res.json({ success: true, code });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/auth/password-reset/verify', resetVerifyLimiter, async (req, res) => {
    try {
        const { identifier, code } = req.body || {};
        if (!identifier || !code) return res.status(400).json({ success: false, message: 'identifier and code required' });
        const input = String(identifier).trim();
        const isEmail = input.includes('@');
        let user;
        if (isEmail) {
            user = await dbGet('SELECT id FROM users WHERE email = $1', [input]);
        } else {
            const norm = normalizePhoneNumber(input);
            const rows = await db.query("SELECT id FROM users WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) = $1", [norm]);
            user = rows && rows[0];
        }
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        const row = await dbGet('SELECT id, code_hash, expires_at, attempts_left, used_at FROM password_reset_codes WHERE user_id = $1 ORDER BY created_at DESC', [user.id]);
        if (!row) return res.status(404).json({ success: false, message: 'No reset code' });
        if (row.used_at) return res.status(400).json({ success: false, message: 'Code used' });
        if (new Date(row.expires_at).getTime() <= Date.now()) return res.status(400).json({ success: false, message: 'Code expired' });
        const ok = await bcrypt.compare(String(code), row.code_hash);
        if (!ok) {
            const left = Math.max(0, Number(row.attempts_left || 0) - 1);
            await dbRun('UPDATE password_reset_codes SET attempts_left = $1 WHERE id = $2', [left, row.id]);
            return res.status(401).json({ success: false, message: 'Invalid code', attempts_left: left });
        }
        const token = jwt.sign({ sub: user.id, role: 'reset', prc_id: row.id }, JWT_SECRET, { expiresIn: '10m' });
        return res.json({ success: true, reset_token: token });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/auth/password-reset/complete', resetCompleteLimiter, async (req, res) => {
    try {
        const { reset_token, new_password } = req.body || {};
        if (!reset_token || !new_password) return res.status(400).json({ success: false, message: 'reset_token and new_password required' });
        let payload;
        try { payload = jwt.verify(reset_token, JWT_SECRET); } catch (_) { return res.status(401).json({ success: false, message: 'Invalid token' }); }
        if (payload.role !== 'reset') return res.status(403).json({ success: false, message: 'Forbidden' });
        const prc = await dbGet('SELECT id, user_id, used_at FROM password_reset_codes WHERE id = $1', [payload.prc_id]);
        if (!prc || prc.user_id !== payload.sub) return res.status(400).json({ success: false, message: 'Invalid state' });
        if (prc.used_at) return res.status(400).json({ success: false, message: 'Already used' });
        const hash = await hashPassword(String(new_password));
        await dbRun('UPDATE users SET password = $1 WHERE id = $2', [hash, payload.sub]);
        await dbRun('UPDATE password_reset_codes SET used_at = CURRENT_TIMESTAMP WHERE id = $1', [prc.id]);
        await dbRun('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [payload.sub]);
        return res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Server error' });
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



// ===================================
// Salon Management Routes 
// ===================================




// API to get salon details with rating for user view


// --- Social Links ---

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
 

// Protected: delete a social link (admin role required)
 

// API to update salon basic info


// --- Staff Management ---
 
 
 


// --- Schedule and Breaks Management (Unified Fetch for User/Admin) ---
 

 

 

 


// --- NEW: Specific Schedule Modifications Routes ---




// --- Appointments Routes ---

// Used by Admin/Salon to list appointments

// Used by User booking logic to check availability for a specific date



// Used by User to fetch their own appointment history (FIXED SQL QUERY)

// --- NEW: API to cancel an appointment (3-hour policy enforcement) ---

// ===================================
// Service Management/Discovery Routes 
// ===================================

app.get('/api/services/master/:gender', async (req, res) => {
    try {
        const gender = req.params.gender;
        // FIX: Use $1 placeholder
        const sql = "SELECT id, name_ar, icon, home_page_icon, service_type FROM services WHERE gender = $1 AND COALESCE(is_active, TRUE) = TRUE";
        
        const rows = await dbAll(sql, [gender]);
        res.json({ success: true, services: rows });
    } catch (err) {
        console.error("Master services fetch error:", err.message);
        return res.status(500).json({ success: false, message: 'Database error.' });
    }
});


// ===== SERVICES MANAGEMENT API ENDPOINTS =====

// Get all services for admin management
app.get('/api/admin/services', async (req, res) => {
    try {
        const { gender, search } = req.query;
        
        let sql = "SELECT id, name_ar, icon, home_page_icon, service_type, gender, COALESCE(is_active, TRUE) AS is_active FROM services WHERE 1=1";
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
app.post('/api/admin/services', upload.fields([{ name: 'icon', maxCount: 1 }, { name: 'home_page_icon', maxCount: 1 }]), async (req, res) => {
    try {
        const { name_ar, gender, service_type } = req.body;
        
        if (!name_ar || !gender || !service_type) {
            return res.status(400).json({ 
                success: false, 
                message: 'Service name, gender, and service type are required.' 
            });
        }
        
        let iconUrl = null;
        let homeIconUrl = null;
        
        // Handle image upload if provided
        const iconFile = req.files?.icon?.[0] || null;
        const homeFile = req.files?.home_page_icon?.[0] || null;

        if (iconFile) {
            try {
                // Generate unique filename
                const timestamp = Date.now();
                const filename = `service-${timestamp}-${Math.random().toString(36).substring(7)}.webp`;
                
                // Optimize image using Sharp
                const optimizedBuffer = await sharp(iconFile.buffer)
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

        if (homeFile) {
            try {
                const timestamp = Date.now();
                const filename = `home-service-${timestamp}-${Math.random().toString(36).substring(7)}.webp`;
                const optimizedBuffer = await sharp(homeFile.buffer)
                    .resize(128, 128, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
                    .webp({ quality: 92 })
                    .toBuffer();
                const { data, error } = await supabase.storage
                    .from('service-icons')
                    .upload(filename, optimizedBuffer, { contentType: 'image/webp', upsert: false });
                if (error) {
                    console.error('Supabase upload error:', error);
                } else {
                    const { data: { publicUrl } } = supabase.storage
                        .from('service-icons')
                        .getPublicUrl(filename);
                    homeIconUrl = publicUrl;
                }
            } catch (e) {
                console.error('Homepage image upload error:', e);
            }
        }
        
        // Insert service into database
        const sql = `
            INSERT INTO services (name_ar, icon, home_page_icon, service_type, gender) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING id, name_ar, icon, home_page_icon, service_type, gender
        `;
        
        const result = await dbGet(sql, [name_ar, iconUrl, homeIconUrl, service_type, gender]);
        
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
app.put('/api/admin/services/:service_id', upload.fields([{ name: 'icon', maxCount: 1 }, { name: 'home_page_icon', maxCount: 1 }]), async (req, res) => {
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
        let homeIconUrl = currentService.home_page_icon; // Keep existing homepage icon by default
        
        // Handle new image upload if provided
        const iconFile = req.files?.icon?.[0] || null;
        const homeFile = req.files?.home_page_icon?.[0] || null;
        if (iconFile) {
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
                const optimizedBuffer = await sharp(iconFile.buffer)
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

        if (homeFile) {
            try {
                if (currentService.home_page_icon && currentService.home_page_icon.includes('supabase')) {
                    const oldFilename = currentService.home_page_icon.split('/').pop();
                    await supabase.storage.from('service-icons').remove([oldFilename]);
                }
                const timestamp = Date.now();
                const filename = `home-service-${timestamp}-${Math.random().toString(36).substring(7)}.webp`;
                const optimizedBuffer = await sharp(homeFile.buffer)
                    .resize(128, 128, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
                    .webp({ quality: 92 })
                    .toBuffer();
                const { data, error } = await supabase.storage
                    .from('service-icons')
                    .upload(filename, optimizedBuffer, { contentType: 'image/webp', upsert: false });
                if (!error) {
                    const { data: { publicUrl } } = supabase.storage.from('service-icons').getPublicUrl(filename);
                    homeIconUrl = publicUrl;
                }
            } catch (e) {
                console.error('Homepage image upload error:', e);
            }
        }
        
        // Update service in database
        const sql = `
            UPDATE services 
            SET name_ar = $1, icon = $2, home_page_icon = $3, service_type = $4, gender = $5 
            WHERE id = $6 
            RETURNING id, name_ar, icon, home_page_icon, service_type, gender
        `;
        
        const result = await dbGet(sql, [name_ar, iconUrl, homeIconUrl, service_type, gender, serviceId]);
        
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
        
        // Check if service is being used; if so, cascade delete dependents
        const usageCheck = await dbGet("SELECT COUNT(*) as count FROM salon_services WHERE service_id = $1", [serviceId]);
        if (usageCheck.count > 0) {
            await dbRun("DELETE FROM salon_services WHERE service_id = $1", [serviceId]);
        }
        // Remove appointment-services entries and any appointments that directly reference this service
        const apptSvcCount = await dbGet("SELECT COUNT(*) as count FROM appointment_services WHERE service_id = $1", [serviceId]);
        if (apptSvcCount.count > 0) {
            await dbRun("DELETE FROM appointment_services WHERE service_id = $1", [serviceId]);
        }
        const apptCount = await dbGet("SELECT COUNT(*) as count FROM appointments WHERE service_id = $1", [serviceId]);
        if (apptCount.count > 0) {
            await dbRun("DELETE FROM appointments WHERE service_id = $1", [serviceId]);
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
        // Delete homepage image as well if present
        if (service.home_page_icon && service.home_page_icon.includes('supabase')) {
            try {
                const filename = service.home_page_icon.split('/').pop();
                await supabase.storage.from('service-icons').remove([filename]);
            } catch (imageError) {
                console.warn('Failed to delete service homepage icon:', imageError);
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
                s.plan,
                COALESCE(AVG(r.rating), 0) AS avg_rating,
                COUNT(r.id) AS review_count
            FROM salons s
            LEFT JOIN reviews r ON s.id = r.salon_id
            WHERE s.gender_focus = $1 AND s.status = 'accepted'
            GROUP BY s.id, s.special, s.plan
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

// Register discovery-related routes after helpers are initialized
registerDiscoveryRoutes(app, { db, dbAll, dbGet, dbRun, requireAuth, fetchSalonsWithAvailability });

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


 

function requireAdmin(req, res, next) {
    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!bearer) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="admin", error="invalid_token"');
        return res.status(401).json({ error: 'No token provided' });
    }
    try {
        const payload = jwt.verify(bearer, JWT_SECRET);
        if (payload.role === 'admin') {
            req.user = { id: payload.sub, role: payload.role };
            return next();
        }
    } catch (_) {}
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
 

// Employee: Start daily session





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
        const allowedPlans = new Set(['2months_offer', 'monthly_200', 'monthly_60', 'per_booking', 'visibility_only']);
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
            } else if (invoiceOption === 'offer' && normalizedPlan === 'visibility_only') {
                paymentType = 'visibility_only_offer_199';
                amount = 199;
                validUntil.setMonth(validUntil.getMonth() + 2);
                description = 'خطة بدون حجوزات: عرض خاص شهرين مقابل 199 شيكل';
            } else if (invoiceOption === 'renewal') {
                if (normalizedPlan === 'monthly_200') {
                    paymentType = 'monthly_200';
                    amount = 200;
                    validUntil.setMonth(validUntil.getMonth() + 1);
                    description = 'اشتراك شهري للصالحون: 200 شيكل';
                } else if (normalizedPlan === 'monthly_60') {
                    const chairs = normalizedChairs || 1;
                    paymentType = 'monthly_60';
                    amount = 70 * chairs; // rounded price per chair
                    validUntil.setMonth(validUntil.getMonth() + 1);
                    description = `اشتراك شهري لكل كرسي: 70 شيكل × ${chairs} = ${amount} شيكل`;
                } else if (normalizedPlan === '2months_offer') {
                    // If plan is offer but invoiceOption is renewal, treat as monthly_200 renewal
                    paymentType = 'monthly_200';
                    amount = 200;
                    validUntil.setMonth(validUntil.getMonth() + 1);
                    description = 'تجديد شهري: 200 شيكل';
                } else if (normalizedPlan === 'visibility_only') {
                    paymentType = 'visibility_only_monthly_99';
                    amount = 100;
                    validUntil.setMonth(validUntil.getMonth() + 1);
                    description = 'خطة بدون حجوزات: اشتراك شهري 100 شيكل';
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
                const corePlan = normalizedPlan === 'visibility_only' ? 'visibility_only' : 'booking';
                await db.query(
                    `INSERT INTO subscriptions (
                        salon_id, plan, package, start_date, end_date, status
                    ) VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        salon_id,
                        corePlan,
                        normalizedPlan,
                        validFrom.toISOString(),
                        validUntil.toISOString(),
                        'active'
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

        socket.on('joinAdmin', () => {
            try {
                const room = 'admins';
                socket.join(room);
                socket.admin = true;
                socket.emit('joinedAdmin', { room });
            } catch (e) {
                console.warn('joinAdmin handler error:', e.message);
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

    // Helper function to broadcast to all admins
    global.broadcastToAdmins = (event, data) => {
        if (io) {
            io.to('admins').emit(event, data);
            console.log(`Broadcasted ${event} to admins`);
        }
    };

    // Helper function to broadcast to all admin sockets
    global.broadcastToAdmins = (event, data) => {
        if (io) {
            io.to('admins').emit(event, data);
            console.log(`Broadcasted ${event} to admins`);
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
        await backfillSubscriptionsFromSalons();
        await updateSubscriptionStatusesDaily();
        // insertMasterServices is called inside initializeDb now.
        console.log("Database schema created successfully and master data inserted.");
    } catch (error) {
        console.error("Database initialization error:", error.message);
    }
});
// Image proxy to mitigate HTTP/3/QUIC issues with some CDNs (restricted to Pexels)
app.get('/api/proxy/image', async (req, res) => {
  try {
    const rawUrl = (req.query.url || '').toString();
    if (!rawUrl) return res.status(400).send('Missing url');
    const parsed = new URL(rawUrl);
    const allowedHosts = new Set(['images.pexels.com']);
    if (!allowedHosts.has(parsed.hostname)) return res.status(403).send('Host not allowed');
    const r = await fetch(rawUrl, { headers: { 'User-Agent': 'Saloony/1.0 (+mailto:saloony.service@gmail.com)' } });
    if (!r.ok) return res.status(r.status).send('Upstream error');
    const ct = r.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const ab = await r.arrayBuffer();
    return res.send(Buffer.from(ab));
  } catch (e) {
    return res.status(502).send('Proxy error');
  }
});
