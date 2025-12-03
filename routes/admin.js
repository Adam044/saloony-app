module.exports = function register(app, deps) {
  const { db, requireAdmin, requireDebugEnabled } = deps;
  const bcrypt = require('bcrypt');

  app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
      const totalUsersResult = await db.query('SELECT COUNT(*) as count FROM users WHERE user_type = $1', ['user']);
      const totalSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons');
      const womenSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons WHERE gender_focus = $1', ['women']);
      const menSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons WHERE gender_focus = $1', ['men']);
      const activeSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons WHERE status = $1', ['accepted']);
      const pendingSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons WHERE status = $1', ['pending']);
      const totalAppointmentsResult = await db.query('SELECT COUNT(*) as count FROM appointments');
      res.json({
        success: true,
        totals: {
          users: totalUsersResult[0]?.count,
          salons: totalSalonsResult[0]?.count,
          womenSalons: womenSalonsResult[0]?.count,
          menSalons: menSalonsResult[0]?.count,
          activeSalons: activeSalonsResult[0]?.count,
          pendingSalons: pendingSalonsResult[0]?.count,
          totalAppointments: totalAppointmentsResult[0]?.count
        }
      });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Admin stats failed' });
    }
  });

  app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
      const rows = await db.query('SELECT id, name, email, phone, city, user_type FROM users ORDER BY id DESC');
      res.json({ success: true, users: rows });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  app.get('/api/admin/employees', requireAdmin, async (req, res) => {
    try {
      const rows = await db.query('SELECT id, name, username, email, phone, city FROM users WHERE user_type = $1 ORDER BY id DESC', ['employee']);
      res.json({ success: true, employees: rows });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  app.post('/api/admin/employees', requireAdmin, async (req, res) => {
    try {
      const { name, email, phone, city, password, username } = req.body || {};
      const emailToInsert = (email && String(email).trim()) ? String(email).trim() : null;
      const phoneToInsert = (phone && String(phone).trim()) ? String(phone).trim() : null;
      const nameToInsert = (name && String(name).trim()) ? String(name).trim() : null;
      if (!nameToInsert) {
        return res.status(400).json({ success: false, message: 'الاسم مطلوب.' });
      }
      const hashedPassword = await bcrypt.hash(String(password || ''), 12);
      let usernameToInsert = (username && String(username).trim()) ? String(username).trim() : null;
      if (!usernameToInsert) {
        // Auto-generate unique employee username code
        for (let i = 0; i < 5; i++) {
          const code = `emp-${Math.random().toString(36).slice(2, 8)}`;
          const exists = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [code]);
          if (!exists) { usernameToInsert = code; break; }
        }
        if (!usernameToInsert) usernameToInsert = `emp-${Date.now().toString().slice(-6)}`;
      }
      const inserted = await db.query(
        `INSERT INTO users (name, email, username, phone, city, password, user_type)
         VALUES ($1, $2, $3, $4, $5, $6, 'employee') RETURNING id, username`,
        [nameToInsert, emailToInsert, usernameToInsert, phoneToInsert, city || null, hashedPassword]
      );
      res.json({ success: true, id: inserted[0]?.id, username: inserted[0]?.username });
    } catch (e) {
      if (e && e.code === '23505') {
        const msg = /username/i.test(String(e.detail||'')) ? 'اسم المستخدم مستخدم بالفعل. يرجى اختيار اسم مختلف.' : 'البريد الإلكتروني مسجل بالفعل. يرجى اختيار بريد مختلف أو تركه فارغاً.';
        return res.status(400).json({ success: false, message: msg });
      }
      res.status(500).json({ success: false, message: 'خطأ في إنشاء الموظف.' });
    }
  });

  app.post('/api/admin/employees/:id/reset_password', requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
      let temp = 'Emp';
      for (let i = 0; i < 7; i++) temp += chars[Math.floor(Math.random() * chars.length)];
      const hashed = await bcrypt.hash(temp, 12);
      await db.run('UPDATE users SET password = $1 WHERE id = $2', [hashed, id]);
      res.json({ success: true, temp_password: temp });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  app.delete('/api/admin/employees/:id', requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const row = await db.get('SELECT id FROM users WHERE id = $1 AND user_type = $2', [id, 'employee']);
      if (!row) {
        return res.status(404).json({ success: false, message: 'الموظف غير موجود.' });
      }
      await db.run('DELETE FROM users WHERE id = $1', [id]);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'فشل حذف الموظف.' });
    }
  });

  app.get('/api/admin/salons', requireAdmin, async (req, res) => {
    try {
      const rows = await db.query('SELECT * FROM salons ORDER BY created_at DESC');
      res.json({ success: true, salons: rows });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  app.get('/api/admin/appointments', requireAdmin, async (req, res) => {
    try {
      const rows = await db.query('SELECT * FROM appointments ORDER BY date_booked DESC');
      res.json({ success: true, appointments: rows });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });


  // Admin: Employee analytics summary
  app.get('/api/admin/employees/:id/analytics/summary', requireAdmin, async (req, res) => {
    try {
      const employeeId = Number(req.params.id);
      const today = new Date().toISOString().slice(0, 10);
      const rowsToday = await db.query(
        `SELECT status, COUNT(*) AS cnt FROM employee_visits WHERE employee_id = $1 AND DATE(created_at) = $2 GROUP BY status`,
        [employeeId, today]
      );
      const rowsAll = await db.query(
        `SELECT status, COUNT(*) AS cnt FROM employee_visits WHERE employee_id = $1 GROUP BY status`,
        [employeeId]
      );
      const reduceToMap = (rows) => {
        const m = { activated: 0, interested: 0, not_interested: 0, unknown: 0, signed_up: 0 };
        (rows || []).forEach(r => {
          const key = String(r.status || '').toLowerCase();
          const n = Number(r.cnt || 0);
          if (key === 'activated') m.activated += n;
          else if (key === 'interested') m.interested += n;
          else if (key === 'not_interested') m.not_interested += n;
          else if (key === 'signed_up') m.signed_up += n;
          else m.unknown += n;
        });
        return m;
      };
      const todayMap = reduceToMap(rowsToday);
      const allMap = reduceToMap(rowsAll);
      const revenueToday = todayMap.activated * 20;
      const revenueAll = allMap.activated * 20;
      return res.json({ success: true, today: todayMap, all: allMap, revenue: { today: revenueToday, all: revenueAll } });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Admin: Employee analytics today
  app.get('/api/admin/employees/:id/analytics/today', requireAdmin, async (req, res) => {
    try {
      const employeeId = Number(req.params.id);
      const today = new Date().toISOString().slice(0, 10);
      const visits = await db.query(
        `SELECT id FROM employee_visits WHERE employee_id = $1 AND DATE(created_at) = $2`,
        [employeeId, today]
      );
      const count = (visits || []).length;
      return res.json({ success: true, visits_count: count });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Admin: Employee analytics for date range
  app.get('/api/admin/employees/:id/analytics/range', requireAdmin, async (req, res) => {
    try {
      const employeeId = Number(req.params.id);
      const from = String(req.query.from || '').slice(0, 10);
      const to = String(req.query.to || '').slice(0, 10);
      const mapRows = await db.query(
        `SELECT status, COUNT(*) AS cnt FROM employee_visits WHERE employee_id = $1 AND DATE(created_at) BETWEEN $2 AND $3 GROUP BY status`,
        [employeeId, from, to]
      );
      const visits = await db.query(
        `SELECT id, salon_name, status, interest_level, comments, address, created_at,
                (SELECT lat FROM employee_visit_locations WHERE visit_id = employee_visits.id ORDER BY id DESC LIMIT 1) AS lat,
                (SELECT lng FROM employee_visit_locations WHERE visit_id = employee_visits.id ORDER BY id DESC LIMIT 1) AS lng
         FROM employee_visits
         WHERE employee_id = $1 AND DATE(created_at) BETWEEN $2 AND $3
         ORDER BY created_at DESC`,
        [employeeId, from, to]
      );
      const map = { activated: 0, signed_up: 0, interested: 0, not_interested: 0, unknown: 0 };
      (mapRows || []).forEach(r => {
        const key = String(r.status || '').toLowerCase();
        const n = Number(r.cnt || 0);
        if (key === 'activated') map.activated += n;
        else if (key === 'signed_up') map.signed_up += n;
        else if (key === 'interested') map.interested += n;
        else if (key === 'not_interested') map.not_interested += n;
        else map.unknown += n;
      });
      const revenue = map.activated * 20;
      return res.json({ success: true, map, visits: visits || [], revenue });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  app.post('/api/admin/salon/status/:salon_id', requireAdmin, async (req, res) => {
    try {
      const salon_id = Number(req.params.salon_id);
      const { status } = req.body || {};
      await db.run('UPDATE salons SET status = $1 WHERE id = $2', [status, salon_id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  app.get('/api/debug/salons', requireAdmin, requireDebugEnabled, async (req, res) => {
    try {
      const rows = await db.query('SELECT id, salon_name, status FROM salons ORDER BY id DESC');
      res.json({ success: true, salons: rows });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  app.get('/api/debug/salon-status/:salon_id', requireAdmin, requireDebugEnabled, async (req, res) => {
    try {
      const salon_id = Number(req.params.salon_id);
      const rows = await db.query('SELECT id, salon_name, status FROM salons WHERE id = $1', [salon_id]);
      res.json({ success: true, salon: rows[0] || null });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  app.post('/api/debug/align-schema', requireAdmin, requireDebugEnabled, async (req, res) => {
    res.json({ success: true });
  });

  app.get('/api/debug/align-schema', requireAdmin, requireDebugEnabled, async (req, res) => {
    res.json({ success: true });
  });

  app.get('/api/health', async (req, res) => {
    try {
      const rows = await db.query('SELECT 1 as ok');
      res.json({ success: true, env: { nodeEnv: process.env.NODE_ENV, hasDatabaseUrl: !!process.env.DATABASE_URL, dbMode: db.isProduction ? 'postgres' : 'sqlite' }, db: { ok: true, rows } });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });
}
