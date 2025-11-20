module.exports = function register(app, deps) {
  const { db, requireRole, sendPushToAdmins } = deps;

  app.post('/api/employee/session/start', requireRole('employee'), async (req, res) => {
    try {
      const employeeId = req.user.id;
      const today = new Date().toISOString().slice(0, 10);
      const existing = await db.get('SELECT id FROM employee_sessions WHERE employee_id = $1 AND date = $2', [employeeId, today]);
      if (existing) {
        return res.json({ success: true, session_id: existing.id, message: 'جلسة اليوم موجودة بالفعل.' });
      }
      const inserted = await db.query('INSERT INTO employee_sessions (employee_id, date, started_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id', [employeeId, today]);
      const sessionId = inserted && inserted[0] && inserted[0].id ? inserted[0].id : null;
      return res.json({ success: true, session_id: sessionId });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  app.post('/api/employee/visit', requireRole('employee'), async (req, res) => {
    try {
      const employeeId = req.user.id;
      let { salon_name, status, comments, interest_level, lat, lng, address, plan_core, plan_option } = req.body || {};
      if (!salon_name || !status || !address || !String(address).trim()) {
        return res.status(400).json({ success: false, message: 'salon_name, status and address are required.' });
      }
      status = String(status).trim().toLowerCase();
      const allowed = new Set(['activated','signed_up','interested','not_interested']);
      if (!allowed.has(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status. Allowed: activated, signed_up, interested, not_interested.' });
      }
      let il = Number(interest_level);
      if (Number.isNaN(il)) il = null; else il = Math.max(0, Math.min(10, il));
      let core = null; let option = null;
      try {
        const coreRaw = String(plan_core || '').trim();
        const optionRaw = String(plan_option || '').trim();
        if (coreRaw) {
          const cores = new Set(['booking','visibility_only']);
          if (cores.has(coreRaw)) core = coreRaw; else core = null;
          if (core === 'booking') {
            const opts = new Set(['monthly_200','monthly_60','per_booking','2months_offer']);
            option = opts.has(optionRaw) ? optionRaw : null;
          } else if (core === 'visibility_only') {
            const opts = new Set(['visibility_only_monthly_99','visibility_only_offer_199']);
            option = opts.has(optionRaw) ? optionRaw : null;
          } else {
            option = null;
          }
        }
      } catch(_) { core = null; option = null; }
      const inserted = await db.query(
        'INSERT INTO employee_visits (employee_id, salon_name, status, interest_level, comments, address, plan_core, plan_option, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP) RETURNING id',
        [employeeId, String(salon_name).trim(), status, il, comments ? String(comments).trim() : null, address ? String(address).trim() : null, core, option]
      );
      const visitId = inserted && inserted[0] && inserted[0].id ? inserted[0].id : null;
      if (visitId && lat && lng) {
        try {
          await db.run('CREATE TABLE IF NOT EXISTS employee_visit_locations (id SERIAL PRIMARY KEY, visit_id INTEGER NOT NULL, lat DOUBLE PRECISION, lng DOUBLE PRECISION, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
          await db.run('INSERT INTO employee_visit_locations (visit_id, lat, lng) VALUES ($1, $2, $3)', [visitId, Number(lat), Number(lng)]);
        } catch (_) {}
      }
      try {
        if (status === 'activated') {
          const emp = await db.get('SELECT id, name FROM users WHERE id = $1', [employeeId]);
          const employeeName = emp && emp.name ? emp.name : String(employeeId);
          if (global.broadcastToAdmins) {
            global.broadcastToAdmins('admin:activation', { employee_id: employeeId, employee_name: employeeName, salon_name: String(salon_name).trim() });
          }
          try { await sendPushToAdmins && sendPushToAdmins({ title: '🎉 تفعيل مدفوع جديد', body: `${employeeName} فعّل الصالون: ${String(salon_name).trim()} — 💸 دخل جديد!`, url: '/views/admin/admin_dashboard.html', tag: 'employee_activation', requireInteraction: true }); } catch (_) {}
        }
      } catch (_) {}
      return res.json({ success: true, visit_id: visitId });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  app.post('/api/employee/session/end', requireRole('employee'), async (req, res) => {
    try {
      const employeeId = req.user.id;
      const today = new Date().toISOString().slice(0, 10);
      const session = await db.get('SELECT id FROM employee_sessions WHERE employee_id = $1 AND date = $2', [employeeId, today]);
      if (!session) {
        return res.status(400).json({ success: false, message: 'لا توجد جلسة لليوم لانهائها.' });
      }
      await db.run('UPDATE employee_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = $1', [session.id]);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  app.get('/api/employee/analytics/summary', requireRole('employee'), async (req, res) => {
    try {
      const employeeId = req.user.id;
      const today = new Date().toISOString().slice(0, 10);
      const rowsToday = await db.query(`SELECT status, COUNT(*) AS cnt FROM employee_visits WHERE employee_id = $1 AND DATE(created_at) = $2 GROUP BY status`, [employeeId, today]);
      const rowsAll = await db.query(`SELECT status, COUNT(*) AS cnt FROM employee_visits WHERE employee_id = $1 GROUP BY status`, [employeeId]);
      const reduceToMap = (rows) => {
        const m = { activated: 0, interested: 0, not_interested: 0, unknown: 0 };
        (rows || []).forEach(r => {
          const key = String(r.status || '').toLowerCase();
          const n = Number(r.cnt || 0);
          if (key === 'activated') m.activated += n;
          else if (key === 'interested') m.interested += n;
          else if (key === 'not_interested') m.not_interested += n;
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

  app.get('/api/employee/leaderboard', requireRole('employee'), async (req, res) => {
    try {
      const rows = await db.query(`SELECT u.id AS employee_id, u.name AS employee_name, COUNT(ev.id) AS activated_count FROM users u LEFT JOIN employee_visits ev ON ev.employee_id = u.id AND (LOWER(ev.status) LIKE '%activated%' OR LOWER(ev.status) LIKE '%paid%') WHERE u.user_type = 'employee' GROUP BY u.id, u.name ORDER BY activated_count DESC, u.name ASC LIMIT 20`);
      return res.json({ success: true, leaderboard: rows || [] });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  app.get('/api/employee/analytics/today', requireRole('employee'), async (req, res) => {
    try {
      const employeeId = req.user.id;
      const today = new Date().toISOString().slice(0, 10);
      const session = await db.get('SELECT id, date, started_at FROM employee_sessions WHERE employee_id = $1 AND date = $2', [employeeId, today]);
      const visits = await db.query(`SELECT id, created_at AS visited_at, salon_name, status, interest_level, comments, address, (SELECT lat FROM employee_visit_locations WHERE visit_id = employee_visits.id ORDER BY id DESC LIMIT 1) AS lat, (SELECT lng FROM employee_visit_locations WHERE visit_id = employee_visits.id ORDER BY id DESC LIMIT 1) AS lng FROM employee_visits WHERE employee_id = $1 AND DATE(created_at) = $2 ORDER BY created_at DESC`, [employeeId, today]);
      const count = (visits || []).length;
      return res.json({ success: true, session, visits: visits || [], visits_count: count });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  app.get('/api/employee/analytics/range', requireRole('employee'), async (req, res) => {
    try {
      const employeeId = req.user.id;
      const from = String(req.query.from || '').slice(0, 10);
      const to = String(req.query.to || '').slice(0, 10);
      if (!from || !to) {
        return res.status(400).json({ success: false, message: 'from/to required (YYYY-MM-DD).' });
      }
      const rows = await db.query(`SELECT status, COUNT(*) AS cnt FROM employee_visits WHERE employee_id = $1 AND DATE(created_at) BETWEEN $2 AND $3 GROUP BY status`, [employeeId, from, to]);
      const visits = await db.query(`SELECT id, created_at AS visited_at, salon_name, status, interest_level, comments, address, (SELECT lat FROM employee_visit_locations WHERE visit_id = employee_visits.id ORDER BY id DESC LIMIT 1) AS lat, (SELECT lng FROM employee_visit_locations WHERE visit_id = employee_visits.id ORDER BY id DESC LIMIT 1) AS lng FROM employee_visits WHERE employee_id = $1 AND DATE(created_at) BETWEEN $2 AND $3 ORDER BY created_at DESC`, [employeeId, from, to]);
      const map = { activated: 0, signed_up: 0, interested: 0, not_interested: 0, unknown: 0 };
      (rows || []).forEach(r => {
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

  app.get('/api/employee/salons', requireRole('employee'), async (req, res) => {
    try {
      const employeeId = req.user.id;
      const rows = await db.query(`SELECT salon_name, MAX(created_at) AS last_visited, (SELECT address FROM employee_visits ev2 WHERE ev2.employee_id = $1 AND ev2.salon_name = employee_visits.salon_name ORDER BY ev2.created_at DESC LIMIT 1) AS address FROM employee_visits WHERE employee_id = $1 GROUP BY salon_name ORDER BY last_visited DESC`, [employeeId]);
      return res.json({ success: true, salons: rows || [] });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });
}