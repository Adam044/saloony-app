const db = require('../assets/database');

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
            language_preference VARCHAR(10) DEFAULT 'auto',
            image_url TEXT
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
            logo_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'pending',
            special BOOLEAN DEFAULT FALSE,
            about TEXT,
            roles_enabled BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS services (
            id SERIAL PRIMARY KEY,
            name_ar TEXT NOT NULL,
            icon TEXT NOT NULL,
            gender TEXT NOT NULL,
            service_type TEXT NOT NULL DEFAULT 'main',
            is_active BOOLEAN DEFAULT TRUE,
            home_page_icon TEXT,
            UNIQUE(name_ar, gender)
        )`);

        await db.run(`CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            rating INTEGER NOT NULL,
            comment TEXT,
            date_posted TEXT NOT NULL,
            image_url TEXT,
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
            ended_at TIMESTAMP,
            notes TEXT,
            UNIQUE(employee_id, date),
            FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // System Settings for dynamic content (e.g., partnership images)
        await db.run(`CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        // Updated schema with image_type and unique constraint
        await db.run(`CREATE TABLE IF NOT EXISTS salon_images (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            image_path TEXT NOT NULL,
            image_type TEXT NOT NULL CHECK (image_type IN ('logo', 'background')),
            width INTEGER,
            height INTEGER,
            size_bytes INTEGER,
            mime_type TEXT,
            format TEXT,
            size_type TEXT,
            public_url TEXT,
            supabase_path TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            -- Constraint: Only ONE logo and ONE background per salon
            CONSTRAINT unique_salon_image_type UNIQUE (salon_id, image_type),
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
        )`);

        // Salon Gallery (New Feature)
        await db.run(`CREATE TABLE IF NOT EXISTS salon_gallery (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            image_url TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            title TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_salon_gallery_salon ON salon_gallery(salon_id)`);

        // Salon Visits (Analytics)
        await db.run(`CREATE TABLE IF NOT EXISTS salon_visits (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            visit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip_address TEXT,
            user_agent TEXT,
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
            package VARCHAR(40),
            start_date DATE NOT NULL,
            end_date DATE,
            status VARCHAR(20) DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_subscriptions_salon ON subscriptions(salon_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_subscriptions_end ON subscriptions(end_date)`);

        /* Removed duplicate salon_subscriptions table in favor of payments table */

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

        // Ensure refresh_tokens table exists (for JWT refresh flow)
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

        // Products System
        // Note: product_categories table removed in favor of simple category column

        await db.run(`CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            salon_id INTEGER NOT NULL,
            category VARCHAR(50),
            name TEXT NOT NULL,
            description TEXT,
            price DECIMAL(10,2) NOT NULL,
            currency VARCHAR(3) DEFAULT 'ILS',
            image_url TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
        )`);

        await db.run(`CREATE INDEX IF NOT EXISTS idx_products_salon ON products(salon_id)`);

        console.log("✅ Database schema created successfully (including optimized AI Analytics tables).");
        
    } catch (error) {
        console.error("Error initializing database:", error);
        throw error;
    }
}

// Align existing database schema (especially for production/PostgreSQL)
// Ensures salons table has expected columns and constraints used by the server code
async function alignSchema() {
    // This function is intentionally left empty to avoid destructive or redundant schema alterations.
    // The initializeDb function now contains the correct and full schema definitions.
    // Any necessary migrations should be handled via dedicated SQL scripts or manual updates.
    console.log("AlignSchema: Skipped as per configuration (using clean schema initialization).");
}

module.exports = {
    initializeDb,
    alignSchema
};
