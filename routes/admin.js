module.exports = function register(app, deps) {
  const { db, requireAdmin, requireDebugEnabled } = deps;

  app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
      const totalUsersResult = await db.query('SELECT COUNT(*) as count FROM users WHERE user_type = $1', ['user']);
      const totalSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons');
      const womenSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons WHERE gender_focus = $1', ['women']);
      const menSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons WHERE gender_focus = $1', ['men']);
      const activeSalonsResult = await db.query('SELECT COUNT(*) as count FROM salons WHERE status = $1', ['accepted']);
      res.json({
        success: true,
        totals: {
          users: totalUsersResult[0]?.count,
          salons: totalSalonsResult[0]?.count,
          womenSalons: womenSalonsResult[0]?.count,
          menSalons: menSalonsResult[0]?.count,
          activeSalons: activeSalonsResult[0]?.count
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
      const rows = await db.query('SELECT id, name FROM users WHERE user_type = $1 ORDER BY id DESC', ['employee']);
      res.json({ success: true, employees: rows });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  app.post('/api/admin/employees', requireAdmin, async (req, res) => {
    try {
      const { name, email, phone, city, password } = req.body || {};
      const inserted = await db.query(
        `INSERT INTO users (name, email, phone, city, password, user_type)
         VALUES ($1, $2, $3, $4, $5, 'employee') RETURNING id`,
        [name, email, phone, city, password]
      );
      res.json({ success: true, id: inserted[0]?.id });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });

  app.post('/api/admin/employees/:id/reset_password', requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { password } = req.body || {};
      await db.run('UPDATE users SET password = $1 WHERE id = $2', [password, id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false });
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

  app.get('/api/admin/payments', requireAdmin, async (req, res) => {
    try {
      const rows = await db.query('SELECT * FROM payments ORDER BY created_at DESC');
      res.json({ success: true, payments: rows });
    } catch (e) {
      res.status(500).json({ success: false });
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