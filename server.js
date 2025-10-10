// Server.js - Salonni Application Backend
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors'); // Added CORS for development ease
const crypto = require('crypto'); // Used for generating simple tokens/salts

const app = express();
const PORT = process.env.PORT || 3001; 

// --- Core Data: Master Service List & Cities ---
const MASTER_SERVICES = {
    'men': [
        { name_ar: "قص شعر", icon: "fa-cut", service_type: "main" },
        { name_ar: "لحية", icon: "fa-user-tie", service_type: "main" },
        { name_ar: "صبغة شعر", icon: "fa-palette", service_type: "main" },
        { name_ar: "كيراتين", icon: "fa-magic", service_type: "main" },
        { name_ar: "تنظيف بشرة (ماسك)", icon: "fa-mask", service_type: "add_on" },
        { name_ar: "ماسك مرطب", icon: "fa-tint", service_type: "add_on" },
        { name_ar: "ماسك مقشر", icon: "fa-leaf", service_type: "add_on" }
    ],
    'women': [
        { name_ar: "قص شعر", icon: "fa-cut", service_type: "main" },
        { name_ar: "سشوار وتصفيف", icon: "fa-spray-can", service_type: "main" },
        { name_ar: "مكياج", icon: "fa-paint-brush", service_type: "main" },
        { name_ar: "تجميل أظافر (مناكير)", icon: "fa-hands-wash", service_type: "main" },
        { name_ar: "كيراتين", icon: "fa-magic", service_type: "main" },
        { name_ar: "تنظيف بشرة", icon: "fa-face-mask", service_type: "add_on" },
        { name_ar: "ماسك مرطب", icon: "fa-tint", service_type: "add_on" },
        { name_ar: "ماسك مقشر", icon: "fa-leaf", service_type: "add_on" },
        { name_ar: "ماسك مغذي", icon: "fa-seedling", service_type: "add_on" }
    ]
};

const CITIES = [
    'القدس', 'رام الله', 'الخليل', 'نابلس', 'بيت لحم', 'غزة',
    'جنين', 'طولكرم', 'قلقيلية', 'أريحا', 'رفح', 'خان يونس',
    'دير البلح', 'الناصرة', 'حيفا', 'عكا', 'طبريا', 'صفد'
];

// Database setup - Using a persistent file named 'saloony.db'
const db = new sqlite3.Database('saloony.db', (err) => {
    if (err) {
        console.error("Error opening database:", err.message);
    } else {
        console.log("SQLite database connected successfully (saloony.db created/opened).");
        initializeDb();
    }
});

// Helper function to hash passwords (simple simulation)
function hashPassword(password) {
    // In a real app, use bcrypt. Here, we simulate a hash for persistence.
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Helper function to wrap db.all in a Promise (for async/await)
const dbAll = (sql, params) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
};

// Helper function to wrap db.get in a Promise
const dbGet = (sql, params) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
};

// Function to check and alter the appointments table if needed (CRITICAL FIX)



// Initialize database schema and insert master data
function initializeDb() {
    console.log("Initializing database schema...");
    db.serialize(() => {
        // --- ALL TABLE CREATION CODE ---
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT NOT NULL,
            gender TEXT NOT NULL,
            city TEXT NOT NULL,
            password TEXT NOT NULL,
            strikes INTEGER DEFAULT 0
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS salons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            salon_name TEXT NOT NULL,
            owner_name TEXT NOT NULL,
            salon_phone TEXT NOT NULL,
            owner_phone TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            address TEXT NOT NULL,
            city TEXT NOT NULL,
            gender_focus TEXT NOT NULL,
            image_url TEXT,
            password TEXT NOT NULL
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name_ar TEXT NOT NULL,
            icon TEXT NOT NULL,
            gender TEXT NOT NULL,
            service_type TEXT NOT NULL DEFAULT 'main',
            UNIQUE(name_ar, gender)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            salon_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            rating INTEGER NOT NULL, -- 1 to 5
            comment TEXT,
            date_posted TEXT NOT NULL,
            UNIQUE (salon_id, user_id),
            FOREIGN KEY (salon_id) REFERENCES salons(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS salon_services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            salon_id INTEGER NOT NULL,
            service_id INTEGER NOT NULL,
            price REAL NOT NULL,
            duration INTEGER NOT NULL,
            UNIQUE (salon_id, service_id),
            FOREIGN KEY (salon_id) REFERENCES salons(id),
            FOREIGN KEY (service_id) REFERENCES services(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS staff (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            salon_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            FOREIGN KEY (salon_id) REFERENCES salons(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS schedules (
            salon_id INTEGER PRIMARY KEY,
            opening_time TEXT NOT NULL,
            closing_time TEXT NOT NULL,
            closed_days TEXT, -- JSON array of day indices (0=Sun, 6=Sat)
            FOREIGN KEY (salon_id) REFERENCES salons(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS breaks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            salon_id INTEGER NOT NULL,
            staff_id INTEGER, -- NULL for all staff
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            FOREIGN KEY (salon_id) REFERENCES salons(id),
            FOREIGN KEY (staff_id) REFERENCES staff(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            salon_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            staff_id INTEGER,
            service_id INTEGER NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Scheduled', -- Scheduled, Completed, Cancelled
            date_booked TEXT NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (salon_id) REFERENCES salons(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (staff_id) REFERENCES staff(id),
            FOREIGN KEY (service_id) REFERENCES services(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS appointment_services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            appointment_id INTEGER NOT NULL,
            service_id INTEGER NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
            FOREIGN KEY (service_id) REFERENCES services(id),
            UNIQUE(appointment_id, service_id)
        )`); 
        
        db.run(`CREATE TABLE IF NOT EXISTS favorites (
            user_id INTEGER NOT NULL,
            salon_id INTEGER NOT NULL,
            PRIMARY KEY (user_id, salon_id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (salon_id) REFERENCES salons(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS schedule_modifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            salon_id INTEGER NOT NULL,
            mod_type TEXT NOT NULL, -- 'once' or 'recurring'
            mod_date TEXT,          -- YYYY-MM-DD (for 'once')
            mod_day_index INTEGER,  -- 0-6 (for 'recurring')
            start_time TEXT,        -- HH:MM (for temporary closure/open)
            end_time TEXT,          -- HH:MM
            is_closed INTEGER NOT NULL, -- 1 for closed, 0 for custom time
            reason TEXT NOT NULL,
            staff_id INTEGER,       -- NULL for all staff
            FOREIGN KEY (salon_id) REFERENCES salons(id),
            FOREIGN KEY (staff_id) REFERENCES staff(id)
        )`);

        console.log("Database schema created successfully.");
    });
}

// Automatic appointment status update system
function autoUpdateAppointmentStatuses() {
    const now = new Date().toISOString();
    
    // Find all scheduled appointments that have ended
    const sql = `
        UPDATE appointments 
        SET status = 'Completed' 
        WHERE status = 'Scheduled' 
        AND end_time <= ?
    `;
    
    db.run(sql, [now], function(err) {
        if (err) {
            console.error('Error auto-updating appointment statuses:', err.message);
        } else if (this.changes > 0) {
            console.log(`Auto-updated ${this.changes} appointments to Completed status`);
        }
    });
}

// Run auto-update every 5 minutes
setInterval(autoUpdateAppointmentStatuses, 5 * 60 * 1000);

// Run once on startup
setTimeout(autoUpdateAppointmentStatuses, 5000);

// Middleware setup
app.use(cors()); // Allow all CORS requests
app.use(bodyParser.json({ limit: '50mb' })); // Increased limit for image_url
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files (views, Images)
app.use('/', express.static(path.join(__dirname, 'views')));
app.use('/images', express.static(path.join(__dirname, 'Images')));

// Root route redirects to the authentication page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'auth.html'));
});

// ===================================
// Auth Routes 
// ===================================

// Unified register endpoint
app.post('/api/auth/register', (req, res) => {
    const { user_type, name, email, password, phone, city, gender, owner_name, owner_phone, address, gender_focus, image_url } = req.body;
    
    console.log('=== REGISTER REQUEST ===');
    console.log('User type:', user_type);
    
    const hashedPassword = hashPassword(password);
    
    if (user_type === 'user') {
        // Handle user registration
        const sql = `INSERT INTO users (name, email, phone, gender, city, password) VALUES (?, ?, ?, ?, ?, ?)`;
        db.run(sql, [name, email, phone, gender, city, hashedPassword], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ success: false, message: 'البريد الإلكتروني مسجل بالفعل.', message_en: 'Email already registered.' });
                }
                console.error("User signup DB error:", err.message);
                return res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات.', message_en: 'Database error.' });
            }
            console.log(`New User registered with ID: ${this.lastID}`);
            res.json({ 
                success: true, 
                message: 'تم إنشاء حساب المستخدم بنجاح.', 
                user: { 
                    userId: this.lastID, 
                    user_type: 'user', 
                    name, 
                    email, 
                    city, 
                    gender 
                }
            });
        });
    } else if (user_type === 'salon') {
        // Handle salon registration
        db.serialize(() => {
            const sql = `INSERT INTO salons (salon_name, owner_name, salon_phone, owner_phone, email, address, city, gender_focus, image_url, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            db.run(sql, [name, owner_name, phone, owner_phone, email, address, city, gender_focus, image_url, hashedPassword], function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ success: false, message: 'البريد الإلكتروني مسجل بالفعل.', message_en: 'Email already registered.' });
                    }
                    console.error("Salon signup DB error:", err.message);
                    return res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات.', message_en: 'Database error.' });
                }
                const salonId = this.lastID;
                console.log(`New Salon registered with ID: ${salonId}`);
                
                // Set default schedule for the new salon (Crucial for later functionality)
                const defaultScheduleSql = `
                    INSERT INTO schedules (salon_id, opening_time, closing_time, closed_days) 
                    VALUES (?, ?, ?, ?)
                `;
                // Default: 9:00 to 18:00, Closed day: Friday (index 5)
                const defaultClosedDays = JSON.stringify([5]); 
                db.run(defaultScheduleSql, [salonId, '09:00', '18:00', defaultClosedDays], (scheduleErr) => {
                    if (scheduleErr) {
                        console.error("Default schedule DB error:", scheduleErr.message);
                        // Still return success for registration, but log schedule failure
                    }
                    console.log(`Default schedule set for Salon ID: ${salonId}`);
                    
                    res.json({ 
                        success: true, 
                        message: 'تم إنشاء حساب الصالون بنجاح.', 
                        user: { 
                            salonId: salonId, 
                            user_type: 'salon', 
                            salon_name: name, 
                            email, 
                            city, 
                            gender_focus 
                        }
                    });
                });
            });
        });
    } else {
        return res.status(400).json({ success: false, message: 'نوع المستخدم غير صحيح.', message_en: 'Invalid user type.' });
    }
});

// Login (Updated to return full user data object and check hash)
app.post('/api/auth/login', (req, res) => {
    const { email, password, role } = req.body;

    const table = role === 'user' ? 'users' : 'salons';
    const redirectUrl = role === 'user' ? '/Home_user.html' : '/Home_salon.html';
    const hashedPassword = hashPassword(password);

    db.get(`SELECT * FROM ${table} WHERE email = ?`, [email], (err, row) => {
        if (err) {
            console.error("Login DB error:", err.message);
            return res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات.', message_en: 'Database error.' });
        }
        if (!row) {
            return res.status(401).json({ success: false, message: 'البريد الإلكتروني غير مسجل.', message_en: 'Email not registered.' });
        }
        
        // Use the hashed password check
        if (row.password === hashedPassword) {
            console.log(`Successful login for ${role}: ${email}`);
            
            let userObject = {};
            
            if (role === 'user') {
                userObject = { 
                    userId: row.id,
                    name: row.name,
                    email: row.email,
                    city: row.city,
                    gender: row.gender,
                    user_type: 'user',
                    phone: row.phone // Ensure phone is included for profile view
                };
            } else {
                userObject = {
                    salonId: row.id,
                    salon_name: row.salon_name,
                    email: row.email,
                    city: row.city,
                    gender_focus: row.gender_focus,
                    user_type: 'salon',
                    owner_phone: row.owner_phone,
                    salon_phone: row.salon_phone,
                    image_url: row.image_url
                };
            }

            // In a real app, a secure token would be generated here.
            const token = crypto.randomUUID(); 

            res.json({ 
                success: true, 
                message: 'تم تسجيل الدخول بنجاح.', 
                redirect: redirectUrl, 
                token: token,
                user: userObject
            });
        } else {
            return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة.', message_en: 'Incorrect password.' });
        }
    });
});

// API to get user profile (for home_user data load)
app.post('/api/user/profile', (req, res) => {
    // This route should ideally verify a token, but since we don't have a middleware:
    const { user_type, userId, salonId } = req.body; 

    if (user_type === 'user') {
        // FIXED: Including phone number and strikes in profile fetch
        db.get('SELECT id, name, email, phone, gender, city, strikes FROM users WHERE id = ?', [userId], (err, row) => {
            if (err || !row) {
                return res.status(404).json({ success: false, message: 'User not found.' });
            }
            res.json({ ...row, strikes_count: row.strikes || 0, user_type: 'user' });
        });
    } else if (user_type === 'salon') {
        db.get('SELECT id, salon_name, email, city, gender_focus, image_url FROM salons WHERE id = ?', [salonId], (err, row) => {
             if (err || !row) {
                return res.status(404).json({ success: false, message: 'Salon not found.' });
            }
            res.json({ ...row, user_type: 'salon' });
        });
    } else {
        return res.status(400).json({ success: false, message: 'Invalid user type.' });
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
app.get('/api/salon/info/:salon_id', (req, res) => {
    const salonId = req.params.salon_id;
    const sql = `SELECT salon_name, owner_name, salon_phone, owner_phone, email, address, city, gender_focus, image_url FROM salons WHERE id = ?`;
    db.get(sql, [salonId], (err, row) => {
        if (err) {
            console.error("Salon info fetch error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        if (!row) {
             return res.status(404).json({ success: false, message: 'Salon not found.' });
        }
        res.json({ success: true, info: row });
    });
});

// API to get salon details with rating for user view
app.get('/api/salon/details/:salon_id', (req, res) => {
    const salonId = req.params.salon_id;
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
        WHERE s.id = ?
        GROUP BY s.id
    `;
    db.get(sql, [salonId], (err, row) => {
        if (err) {
            console.error("Salon details fetch error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        if (!row) {
             return res.status(404).json({ success: false, message: 'Salon not found.' });
        }
        res.json({ success: true, salon: row });
    });
});

// API to update salon basic info
app.post('/api/salon/info/:salon_id', (req, res) => {
    const salonId = req.params.salon_id;
    // NOTE: password and email are excluded from this general update for security
    const { salon_name, owner_name, salon_phone, address, city, gender_focus, image_url } = req.body;
    
    // We update the fields that are actually sent from the form
    const sql = `UPDATE salons SET salon_name = ?, owner_name = ?, salon_phone = ?, address = ?, city = ?, gender_focus = ?, image_url = ? WHERE id = ?`;
    
    db.run(sql, [salon_name, owner_name, salon_phone, address, city, gender_focus, image_url, salonId], function (err) {
        if (err) {
            console.error("Salon update error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        res.json({ success: true, message: 'Salon information updated successfully.' });
    });
});

// --- Staff Management ---
app.get('/api/salon/staff/:salon_id', (req, res) => {
    const salonId = req.params.salon_id;
    db.all('SELECT id, name FROM staff WHERE salon_id = ?', [salonId], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        res.json({ success: true, staff: rows });
    });
});
app.post('/api/salon/staff/:salon_id', (req, res) => {
    const salonId = req.params.salon_id;
    const { name } = req.body;
    db.run('INSERT INTO staff (salon_id, name) VALUES (?, ?)', [salonId, name], function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        res.json({ success: true, staffId: this.lastID, message: 'Staff added successfully.' });
    });
});
app.delete('/api/salon/staff/:staff_id', (req, res) => {
    const staffId = req.params.staff_id;
    db.run('DELETE FROM staff WHERE id = ?', [staffId], function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        res.json({ success: true, message: 'Staff deleted successfully.' });
    });
});


// --- Schedule and Breaks Management (Unified Fetch for User/Admin) ---
app.get('/api/salon/schedule/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;

    const getSchedule = () => new Promise((resolve, reject) => {
        db.get('SELECT opening_time, closing_time, closed_days FROM schedules WHERE salon_id = ?', [salonId], (err, row) => {
            if (err) reject(err);
            resolve(row);
        });
    });

    const getBreaks = () => new Promise((resolve, reject) => {
        db.all('SELECT id, staff_id, start_time, end_time FROM breaks WHERE salon_id = ?', [salonId], (err, rows) => {
            if (err) reject(err);
            resolve(rows);
        });
    });

    const getModifications = () => new Promise((resolve, reject) => {
        db.all('SELECT id, mod_type, mod_date, mod_day_index, start_time, end_time, is_closed, reason, staff_id FROM schedule_modifications WHERE salon_id = ?', [salonId], (err, rows) => {
            if (err) reject(err);
            resolve(rows);
        });
    });


    try {
        const schedule = await getSchedule();
        const breaks = await getBreaks();
        const modifications = await getModifications(); // Added modifications

        if (schedule) {
            schedule.closed_days = schedule.closed_days ? JSON.parse(schedule.closed_days) : [];
        }

        res.json({ success: true, schedule: schedule || {}, breaks, modifications }); // Added modifications
    } catch (error) {
        console.error("Schedule fetch error:", error.message);
        res.status(500).json({ success: false, message: 'Database error.' });
    }
});

app.post('/api/salon/schedule/:salon_id', (req, res) => {
    const salonId = req.params.salon_id;
    const { opening_time, closing_time, closed_days } = req.body;
    const closedDaysJson = JSON.stringify(closed_days || []);
    
    // UPSERT: Insert or replace existing schedule row
    const sql = `
        INSERT INTO schedules (salon_id, opening_time, closing_time, closed_days) 
        VALUES (?, ?, ?, ?)
        ON CONFLICT(salon_id) DO UPDATE SET 
            opening_time = excluded.opening_time, 
            closing_time = excluded.closing_time, 
            closed_days = excluded.closed_days
    `;
    
    db.run(sql, [salonId, opening_time, closing_time, closedDaysJson], function (err) {
        if (err) {
            console.error("Schedule save error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        res.json({ success: true, message: 'Schedule updated successfully.' });
    });
});

app.post('/api/salon/break/:salon_id', (req, res) => {
    const salonId = req.params.salon_id;
    const { staff_id, start_time, end_time } = req.body;
    db.run('INSERT INTO breaks (salon_id, staff_id, start_time, end_time) VALUES (?, ?, ?, ?)', 
        [salonId, staff_id || null, start_time, end_time], function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        res.json({ success: true, breakId: this.lastID, message: 'Break added successfully.' });
    });
});

app.delete('/api/salon/break/:break_id', (req, res) => {
    const breakId = req.params.break_id;
    db.run('DELETE FROM breaks WHERE id = ?', [breakId], function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        res.json({ success: true, message: 'Break deleted successfully.' });
    });
});


// --- NEW: Specific Schedule Modifications Routes ---

app.post('/api/salon/schedule/modification/:salon_id', (req, res) => {
    const salonId = req.params.salon_id;
    const { mod_type, mod_date, mod_day_index, start_time, end_time, is_closed, reason, staff_id } = req.body;
    
    const isClosedInt = is_closed ? 1 : 0;
    
    let sql = '';
    let params = [salonId, mod_type];

    if (mod_type === 'once') {
        sql = `INSERT INTO schedule_modifications (salon_id, mod_type, mod_date, is_closed, start_time, end_time, reason, staff_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        params.push(mod_date, isClosedInt, start_time, end_time, reason, staff_id || null);
    } else if (mod_type === 'recurring') {
        sql = `INSERT INTO schedule_modifications (salon_id, mod_type, mod_day_index, is_closed, start_time, end_time, reason, staff_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        params.push(mod_day_index, isClosedInt, start_time, end_time, reason, staff_id || null);
    } else {
        return res.status(400).json({ success: false, message: 'Invalid modification type.' });
    }

    db.run(sql, params, function (err) {
        if (err) {
            console.error("Modification add error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error during modification add.' });
        }
        res.json({ success: true, modId: this.lastID, message: 'Schedule modification added successfully.' });
    });
});

app.delete('/api/salon/schedule/modification/:mod_id', (req, res) => {
    const modId = req.params.mod_id;
    db.run('DELETE FROM schedule_modifications WHERE id = ?', [modId], function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        res.json({ success: true, message: 'Schedule modification deleted successfully.' });
    });
});


// --- Appointments Routes ---

// Used by Admin/Salon to list appointments
app.get('/api/salon/appointments/:salon_id/:filter', (req, res) => {
    const { salon_id, filter } = req.params;
    const now = new Date().toISOString();
    let whereClause = '';
    let params = [salon_id];
    let orderBy = 'ASC';

    if (filter === 'today') {
        const todayStart = new Date().toISOString().split('T')[0];
        whereClause = `AND start_time LIKE ?`;
        params.push(`${todayStart}%`); // Use prepared statement for LIKE pattern
        orderBy = 'ASC';
    } else if (filter === 'upcoming') {
        whereClause = `AND start_time > ? AND status = 'Scheduled'`;
        params.push(now);
        orderBy = 'ASC';
    } else if (filter === 'past') {
        whereClause = `AND start_time <= ?`;
        params.push(now);
        orderBy = 'DESC';
    } else {
        return res.status(400).json({ success: false, message: 'Invalid filter.' });
    }

    const sql = `
        SELECT 
            a.id, a.start_time, a.end_time, a.status, 
            u.name AS user_name, u.phone AS user_phone,
            s.name_ar AS service_name,
            st.name AS staff_name
        FROM appointments a
        JOIN users u ON a.user_id = u.id
        JOIN services s ON a.service_id = s.id
        LEFT JOIN staff st ON a.staff_id = st.id
        WHERE a.salon_id = ? ${whereClause}
        ORDER BY a.start_time ${orderBy}
    `;

    db.all(sql, params, async (err, rows) => {
        if (err) {
            console.error("Appointments fetch error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }

        // Fetch all services for each appointment
        const appointmentsWithServices = await Promise.all(rows.map(async (appointment) => {
            try {
                const servicesQuery = `
                    SELECT s.name_ar, aps.price 
                    FROM appointment_services aps
                    JOIN services s ON aps.service_id = s.id
                    WHERE aps.appointment_id = ?
                `;
                const services = await dbAll(servicesQuery, [appointment.id]);
                
                return {
                    ...appointment,
                    all_services: services,
                    services_names: services.map(s => s.name_ar).join(' + ')
                };
            } catch (serviceErr) {
                console.error("Error fetching services for appointment:", serviceErr);
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
    });
});

// Used by User booking logic to check availability for a specific date
app.get('/api/salon/:salon_id/appointments/:date', (req, res) => {
    const { salon_id, date } = req.params;
    
    // FIX: Using prepared statement for LIKE pattern
    const sql = `
        SELECT id, start_time, end_time, staff_id, status
        FROM appointments
        WHERE salon_id = ? AND start_time LIKE ?
        AND status = 'Scheduled'
    `;
    const dateQuery = `${date}%`; // YYYY-MM-DD%

    db.all(sql, [salon_id, dateQuery], (err, rows) => {
        if (err) {
            console.error("Daily appointments fetch error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        res.json({ success: true, appointments: rows });
    });
});


app.post('/api/salon/appointment/status/:appointment_id', (req, res) => {
    const appointmentId = req.params.appointment_id;
    const { status } = req.body; 

    if (!['Completed', 'Cancelled', 'Absent'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status provided.' });
    }
    
    // First, get the appointment details to find the user_id
    const getAppointmentQuery = 'SELECT user_id FROM appointments WHERE id = ? AND status != "Completed"';
    db.get(getAppointmentQuery, [appointmentId], (err, appointment) => {
        if (err) {
            console.error('Error fetching appointment:', err);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }

        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found or status cannot be changed.' });
        }

        // Update appointment status
        const sql = `UPDATE appointments SET status = ? WHERE id = ?`;
        db.run(sql, [status, appointmentId], function (err) {
            if (err) {
                console.error("Appointment status update error:", err.message);
                return res.status(500).json({ success: false, message: 'Database error.' });
            }

            // If status is "Absent", increment user strikes
            if (status === 'Absent') {
                const strikeQuery = 'UPDATE users SET strikes = strikes + 1 WHERE id = ?';
                db.run(strikeQuery, [appointment.user_id], (strikeErr) => {
                    if (strikeErr) {
                        console.error('Error updating user strikes:', strikeErr);
                        // Don't fail the whole operation, just log the error
                    }
                });
                
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
        });
    });
});

// Used by User to fetch their own appointment history (FIXED SQL QUERY)
app.get('/api/appointments/user/:user_id/:filter', (req, res) => {
    const { user_id, filter } = req.params;
    const now = new Date().toISOString();
    let whereClause = '';
    let params = [user_id];
    let orderBy = 'DESC';

    if (filter === 'upcoming') {
        whereClause = `AND a.start_time > ? AND a.status = 'Scheduled'`;
        params.push(now);
        orderBy = 'ASC';
    } else if (filter === 'past') {
        whereClause = `AND a.start_time <= ?`;
        params.push(now);
        orderBy = 'DESC';
    } else {
        return res.status(400).json({ success: false, message: 'Invalid filter.' });
    }

    const sql = `
        SELECT 
            a.id, a.start_time, a.status, a.price, -- a.price is now correctly selected
            s.salon_name,
            serv.name_ar AS service_name,
            st.name AS staff_name
        FROM appointments a
        JOIN salons s ON a.salon_id = s.id
        JOIN services serv ON a.service_id = serv.id
        LEFT JOIN staff st ON a.staff_id = st.id
        WHERE a.user_id = ? ${whereClause}
        ORDER BY a.start_time ${orderBy}
    `;

    db.all(sql, params, async (err, rows) => {
        if (err) {
            console.error("User Appointments fetch error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error during appointment fetch.' });
        }

        // Fetch all services for each appointment
        const appointmentsWithServices = await Promise.all(rows.map(async (appointment) => {
            try {
                const servicesQuery = `
                    SELECT s.name_ar, aps.price 
                    FROM appointment_services aps
                    JOIN services s ON aps.service_id = s.id
                    WHERE aps.appointment_id = ?
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
    });
});

// --- NEW: API to cancel an appointment (3-hour policy enforcement) ---
app.post('/api/appointments/cancel/:appointment_id', (req, res) => {
    const appointmentId = req.params.appointment_id;
    const minNoticeHours = 3; 

    db.get('SELECT start_time, status FROM appointments WHERE id = ?', [appointmentId], (err, row) => {
        if (err) {
            console.error("Cancellation fetch error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        if (!row) {
            return res.status(404).json({ success: false, message: 'Appointment not found.' });
        }
        if (row.status !== 'Scheduled') {
            return res.status(400).json({ success: false, message: 'لا يمكن إلغاء موعد حالته ليست "مؤكد".' });
        }

        const appointmentTime = new Date(row.start_time).getTime();
        const now = new Date().getTime();
        const noticePeriodMs = minNoticeHours * 60 * 60 * 1000;
        
        if (appointmentTime - now < noticePeriodMs) {
            return res.status(403).json({ 
                success: false, 
                message: `يجب إلغاء الحجز قبل ${minNoticeHours} ساعات على الأقل من الموعد. لا يمكن الإلغاء الآن.` 
            });
        }

        // Proceed with cancellation
        db.run('UPDATE appointments SET status = "Cancelled" WHERE id = ?', [appointmentId], function (err) {
            if (err) {
                console.error("Cancellation update error:", err.message);
                return res.status(500).json({ success: false, message: 'Database update error during cancellation.' });
            }
            res.json({ success: true, message: 'تم إلغاء الموعد بنجاح.' });
        });
    });
});

// ===================================
// Service Management/Discovery Routes 
// ===================================

app.get('/api/services/master/:gender', (req, res) => {
    const gender = req.params.gender;
    const sql = "SELECT id, name_ar, icon, service_type FROM services WHERE gender = ?";
    
    db.all(sql, [gender], (err, rows) => {
        if (err) {
            console.error("Master services fetch error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        res.json({ success: true, services: rows });
    });
});

app.get('/api/salons/:salon_id/services', (req, res) => {
    const salonId = req.params.salon_id;
    const sql = `
        SELECT s.id, s.name_ar, s.icon, s.service_type, ss.price, ss.duration
        FROM salon_services ss
        JOIN services s ON ss.service_id = s.id
        WHERE ss.salon_id = ?
    `;
    db.all(sql, [salonId], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        res.json({ success: true, services: rows });
    });
});

// Get salon services (alternative endpoint for salon management)
app.get('/api/salon/services/:salon_id', (req, res) => {
    const salonId = req.params.salon_id;
    const sql = `
        SELECT s.id, s.name_ar, s.icon, s.service_type, ss.price, ss.duration
        FROM salon_services ss
        JOIN services s ON ss.service_id = s.id
        WHERE ss.salon_id = ?
    `;
    db.all(sql, [salonId], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        res.json({ success: true, services: rows });
    });
});

app.post('/api/salon/services/:salon_id', (req, res) => {
    const salonId = req.params.salon_id;
    const services = req.body.services; // [{ service_id, price, duration }]

    if (!Array.isArray(services)) {
        return res.status(400).json({ success: false, message: 'Invalid services format.' });
    }

    // Use a transaction for atomic operation (delete old, insert new)
    db.serialize(() => {
        db.run('BEGIN TRANSACTION;');

        // 1. Delete existing services for the salon
        db.run('DELETE FROM salon_services WHERE salon_id = ?', [salonId], (err) => {
            if (err) {
                db.run('ROLLBACK;');
                console.error("Service deletion error:", err.message);
                return res.status(500).json({ success: false, message: 'Database error during service update.' });
            }
        });

        // 2. Insert new services
        const stmt = db.prepare("INSERT INTO salon_services (salon_id, service_id, price, duration) VALUES (?, ?, ?, ?)");
        services.forEach(service => {
            // Allow duration to be 0 for add-ons, but ensure service_id and price are valid
            if (service.service_id && service.price && service.duration !== undefined && service.duration !== null) {
                stmt.run(salonId, service.service_id, service.price, service.duration);
            }
        });
        stmt.finalize();

        db.run('COMMIT;', (err) => {
            if (err) {
                console.error("Transaction commit error:", err.message);
                return res.status(500).json({ success: false, message: 'Database transaction error.' });
            }
            res.json({ success: true, message: 'Salon services updated successfully.' });
        });
    });
});

// API to book a new appointment - UPDATED for Smart Staff Assignment and Multiple Services
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
        // Fallback for old format - get service details
        try {
            const serviceDetails = await dbGet('SELECT id, name_ar FROM services WHERE id = ?', [service_id]);
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

    // Use the first service as the main service for the appointment record (for backward compatibility)
    const mainServiceId = servicesToBook[0].id;
    
    let finalStaffId = staff_id;
    let assignedStaffName = null;
    
    // --- SMART STAFF ASSIGNMENT LOGIC ---
    if (finalStaffId === null) {
        try {
            // 1. Get all staff for the salon
            const staffQuery = 'SELECT id, name FROM staff WHERE salon_id = ?';
            const allStaff = await dbAll(staffQuery, [salon_id]);

            // 2. Find the first available staff
            let foundAvailableStaff = null;
            
            const newApptStart = new Date(start_time).getTime();
            const newApptEnd = new Date(end_time).getTime();

            for (const staffMember of allStaff) {
                const staffAppointmentsQuery = `
                    SELECT start_time, end_time FROM appointments 
                    WHERE salon_id = ? AND staff_id = ? AND status = 'Scheduled'
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
                // Should not happen if client side logic is correct, but as a fallback:
                 return res.status(400).json({ success: false, message: 'عفواً، لا يوجد مختص متاح لإتمام هذا الحجز في هذا الوقت.' });
            }
        } catch (error) {
            console.error("Smart Staff Assignment error:", error.message);
            return res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات أثناء تحديد المختص.' });
        }
    }
    // --- END SMART STAFF ASSIGNMENT LOGIC ---

    const date_booked = new Date().toISOString();
    const status = 'Scheduled';

    // Use transaction to ensure both appointment and services are saved together
    db.serialize(() => {
        db.run('BEGIN TRANSACTION;');

        const sql = `INSERT INTO appointments (salon_id, user_id, staff_id, service_id, start_time, end_time, status, date_booked, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        
        db.run(sql, [salon_id, user_id, finalStaffId, mainServiceId, start_time, end_time, status, date_booked, price], function (err) {
            if (err) {
                console.error("Booking error:", err.message);
                db.run('ROLLBACK;');
                return res.status(500).json({ success: false, message: 'فشل في حفظ الحجز.' });
            }

            const appointmentId = this.lastID;

            // Insert all services into the junction table
            const serviceInsertStmt = db.prepare("INSERT INTO appointment_services (appointment_id, service_id, price) VALUES (?, ?, ?)");
            
            let servicesInserted = 0;
            let hasError = false;

            servicesToBook.forEach(service => {
                serviceInsertStmt.run(appointmentId, service.id, service.price, function(serviceErr) {
                    if (serviceErr && !hasError) {
                        console.error("Service insertion error:", serviceErr.message);
                        hasError = true;
                        db.run('ROLLBACK;');
                        return res.status(500).json({ success: false, message: 'فشل في حفظ تفاصيل الخدمات.' });
                    }
                    
                    servicesInserted++;
                    
                    // If all services are inserted successfully, commit the transaction
                    if (servicesInserted === servicesToBook.length && !hasError) {
                        serviceInsertStmt.finalize();
                        db.run('COMMIT;', (commitErr) => {
                            if (commitErr) {
                                console.error("Transaction commit error:", commitErr.message);
                                return res.status(500).json({ success: false, message: 'خطأ في حفظ البيانات.' });
                            }
                            
                            res.json({ 
                                success: true, 
                                message: 'تم حجز موعدك بنجاح!', 
                                appointmentId: appointmentId,
                                assignedStaffName: assignedStaffName,
                                servicesCount: servicesToBook.length
                            });
                        });
                    }
                });
            });
        });
    });
});


// --- Discovery Routes (Real Data) ---
const fetchSalonsWithMinPrice = (city, gender) => {
    return new Promise((resolve, reject) => {
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
            WHERE s.gender_focus = ?
            GROUP BY s.id 
        `;
        // Query param is only gender_focus now
        db.all(sql, [gender], (err, rows) => { 
            if (err) return reject(err);
            resolve(rows);
        });
    });
};

app.get('/api/discovery/:city/:gender', async (req, res) => {
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
                const salonServiceCounts = await dbAll(`
                    SELECT salon_id, COUNT(DISTINCT service_id) as service_count
                    FROM salon_services 
                    WHERE service_id IN (${serviceIdArray.map(() => '?').join(',')})
                    GROUP BY salon_id
                    HAVING service_count = ?
                `, [...serviceIdArray, serviceIdArray.length]);

                const salonIdsWithAllServices = new Set(salonServiceCounts.map(row => row.salon_id));
                allRelevantSalons = allRelevantSalons.filter(salon => 
                    salonIdsWithAllServices.has(salon.salonId)
                );
            }
        }
        // --- END Service Filter ---


        // 1. Fetch Master Services for discovery cards
        const servicesSql = "SELECT id, name_ar, icon FROM services WHERE gender = ?";
        const discoveryServices = await new Promise((resolve, reject) => {
            db.all(servicesSql, [genderFocus], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
        
        // 2. Separate Salons for sections
        const citySalons = allRelevantSalons.filter(s => s.city === city);
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

// Favorites Route (Real Data)
app.get('/api/favorites/:user_id', async (req, res) => {
    const user_id = req.params.user_id;
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
        WHERE f.user_id = ?
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
    
    db.get('SELECT * FROM favorites WHERE user_id = ? AND salon_id = ?', [user_id, salon_id], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });

        if (row) {
            // Delete (Unfavorite)
            db.run('DELETE FROM favorites WHERE user_id = ? AND salon_id = ?', [user_id, salon_id], (err) => {
                if (err) return res.status(500).json({ success: false, message: 'Delete error.' });
                res.json({ success: true, is_favorite: false, message: 'Unfavorited successfully.' });
            });
        } else {
            // Insert (Favorite)
            db.run('INSERT INTO favorites (user_id, salon_id) VALUES (?, ?)', [user_id, salon_id], (err) => {
                if (err) return res.status(500).json({ success: false, message: 'Insert error.' });
                res.json({ success: true, is_favorite: true, message: 'Favorited successfully.' });
            });
        }
    });
});

// ===== REVIEW ROUTES =====

// Get user's reviews
app.get('/api/reviews/user/:user_id', (req, res) => {
    const { user_id } = req.params;
    
    const query = `
        SELECT r.*, s.salon_name, s.image_url as salon_image
        FROM reviews r
        JOIN salons s ON r.salon_id = s.id
        WHERE r.user_id = ?
        ORDER BY r.date_posted DESC
    `;
    
    db.all(query, [user_id], (err, rows) => {
        if (err) {
            console.error("User reviews fetch error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        res.json({ success: true, reviews: rows });
    });
});

// Get salon reviews
app.get('/api/reviews/salon/:salon_id', (req, res) => {
    const { salon_id } = req.params;
    
    const query = `
        SELECT r.*, u.name as user_name
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.salon_id = ?
        ORDER BY r.date_posted DESC
    `;
    
    db.all(query, [salon_id], (err, rows) => {
        if (err) {
            console.error("Salon reviews fetch error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        res.json({ success: true, reviews: rows });
    });
});

// Submit a new review
app.post('/api/reviews/submit', (req, res) => {
    const { user_id, salon_id, rating, comment } = req.body;
    
    // Validate required fields
    if (!user_id || !salon_id || !rating || !comment || comment.trim() === '') {
        return res.status(400).json({ success: false, message: 'Missing required fields. Comment is mandatory.' });
    }
    
    // Validate rating range
    if (rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
    }
    
    // Check if user has already reviewed this salon
    db.get('SELECT id FROM reviews WHERE user_id = ? AND salon_id = ?', [user_id, salon_id], (err, row) => {
        if (err) {
            console.error("Review check error:", err.message);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        
        if (row) {
            return res.status(400).json({ success: false, message: 'You have already reviewed this salon.' });
        }
        
        // Insert new review
        const insertQuery = `
            INSERT INTO reviews (user_id, salon_id, rating, comment, date_posted)
            VALUES (?, ?, ?, ?, datetime('now'))
        `;
        
        db.run(insertQuery, [user_id, salon_id, rating, comment || ''], function(err) {
            if (err) {
                console.error("Review insert error:", err.message);
                return res.status(500).json({ success: false, message: 'Failed to submit review.' });
            }
            
            res.json({ 
                success: true, 
                message: 'Review submitted successfully.',
                review_id: this.lastID
            });
        });
    });
});

// DELETE review endpoint
app.delete('/api/reviews/delete', (req, res) => {
    const { user_id, salon_id } = req.body;
    
    // Validate required fields
    if (!user_id || !salon_id) {
        return res.status(400).json({ 
            success: false, 
            message: 'User ID and Salon ID are required.' 
        });
    }
    
    // Delete the review
    const deleteQuery = `
        DELETE FROM reviews 
        WHERE user_id = ? AND salon_id = ?
    `;
    
    db.run(deleteQuery, [user_id, salon_id], function(err) {
        if (err) {
            console.error('Error deleting review:', err);
            return res.status(500).json({ 
                success: false, 
                message: 'Database error occurred while deleting review.' 
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Review not found.' 
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Review deleted successfully.'
        });
    });
});


// Start server
app.listen(PORT, () => {
    console.log(`Salonni server running on port: http://localhost:${PORT}`);
});
