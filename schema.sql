-- Saloony Database Schema for PostgreSQL (Supabase)
-- Run this in your Supabase SQL Editor to create the database structure

-- Enable UUID extension (optional, for future use)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    gender TEXT NOT NULL,
    city TEXT NOT NULL,
    password TEXT NOT NULL,
    strikes INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Salons table
CREATE TABLE IF NOT EXISTS salons (
    id SERIAL PRIMARY KEY,
    salon_name TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    salon_phone TEXT NOT NULL,
    owner_phone TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    gender_focus TEXT NOT NULL,
    image_url TEXT,
    password TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Services table
CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    name_ar TEXT NOT NULL,
    icon TEXT NOT NULL,
    gender TEXT NOT NULL,
    service_type TEXT NOT NULL DEFAULT 'main',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name_ar, gender)
);

-- 4. Reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    salon_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    date_posted TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (salon_id, user_id),
    FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 5. Salon Services table
CREATE TABLE IF NOT EXISTS salon_services (
    id SERIAL PRIMARY KEY,
    salon_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    duration INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (salon_id, service_id),
    FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
);

-- 6. Staff table
CREATE TABLE IF NOT EXISTS staff (
    id SERIAL PRIMARY KEY,
    salon_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
);

-- 7. Schedules table
CREATE TABLE IF NOT EXISTS schedules (
    salon_id INTEGER PRIMARY KEY,
    opening_time TEXT NOT NULL,
    closing_time TEXT NOT NULL,
    closed_days TEXT, -- JSON array of day indices (0=Sun, 6=Sat)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
);

-- 8. Breaks table
CREATE TABLE IF NOT EXISTS breaks (
    id SERIAL PRIMARY KEY,
    salon_id INTEGER NOT NULL,
    staff_id INTEGER, -- NULL for all staff
    reason TEXT,      -- e.g., breakfast
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

-- 9. Appointments table
CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    salon_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    staff_id INTEGER,
    service_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Scheduled', -- Scheduled, Completed, Cancelled
    date_booked TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
);

-- 10. Appointment Services Junction Table
CREATE TABLE IF NOT EXISTS appointment_services (
    id SERIAL PRIMARY KEY,
    appointment_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
    UNIQUE(appointment_id, service_id)
);

-- 11b. Push Subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
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
);

-- 11c. Reminders Sent table
CREATE TABLE IF NOT EXISTS reminders_sent (
    id SERIAL PRIMARY KEY,
    appointment_id INTEGER NOT NULL,
    reminder_type TEXT NOT NULL, -- e.g., 'upcoming_1h', 'upcoming_24h'
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(appointment_id, reminder_type),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);

-- 11. Favorites table
CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL,
    salon_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, salon_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
);

-- 12. Schedule Modifications table
CREATE TABLE IF NOT EXISTS schedule_modifications (
    id SERIAL PRIMARY KEY,
    salon_id INTEGER NOT NULL,
    mod_type TEXT NOT NULL, -- 'once' or 'recurring'
    mod_date TEXT,          -- YYYY-MM-DD (for 'once')
    mod_day_index INTEGER,  -- 0-6 (for 'recurring')
    start_time TEXT,        -- HH:MM (for temporary closure/open)
    end_time TEXT,          -- HH:MM
    closure_type TEXT,      -- 'full_day' | 'interval' | 'legacy'
    reason TEXT NOT NULL,
    staff_id INTEGER,       -- NULL for all staff
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_salons_city ON salons(city);
CREATE INDEX IF NOT EXISTS idx_salons_gender_focus ON salons(gender_focus);
CREATE INDEX IF NOT EXISTS idx_services_gender ON services(gender);
CREATE INDEX IF NOT EXISTS idx_appointments_salon_id ON appointments(salon_id);
CREATE INDEX IF NOT EXISTS idx_appointments_user_id ON appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date_booked ON appointments(date_booked);
CREATE INDEX IF NOT EXISTS idx_salon_services_salon_id ON salon_services(salon_id);
CREATE INDEX IF NOT EXISTS idx_reviews_salon_id ON reviews(salon_id);