module.exports = function registerSubscriptionsRoutes(app, { db, requireAdmin }) {
  app.get('/api/admin/subscriptions', requireAdmin, async (req, res) => {
    try {
      const rows = await db.query(`
        SELECT sub.*, s.salon_name, s.owner_name
        FROM subscriptions sub
        LEFT JOIN salons s ON sub.salon_id = s.id
        ORDER BY sub.start_date DESC
      `);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/admin/subscriptions/:salon_id', requireAdmin, async (req, res) => {
    try {
      const salonId = Number(req.params.salon_id);
      const { plan, package: pkg, chairs } = req.body || {};
      if (!salonId || !plan || !pkg) {
        return res.status(400).json({ error: 'Missing salon_id, plan or package' });
      }
      const allowedCore = new Set(['booking', 'visibility_only']);
      if (!allowedCore.has(plan)) {
        return res.status(400).json({ error: 'Invalid plan' });
      }
      const allowedBooking = new Set(['monthly_200', 'monthly_60', '2months_offer', 'per_booking']);
      const allowedVisibility = new Set(['visibility_only_monthly_99', 'visibility_only_offer_199']);
      if (plan === 'booking' && !allowedBooking.has(pkg)) {
        return res.status(400).json({ error: 'Invalid package for booking' });
      }
      if (plan === 'visibility_only' && !allowedVisibility.has(pkg)) {
        return res.status(400).json({ error: 'Invalid package for visibility_only' });
      }
      const now = new Date();
      const start = now.toISOString().slice(0,10);
      const plusDays = (key) => {
        if (key === '2months_offer') return 60;
        if (key === 'monthly_200') return 30;
        if (key === 'monthly_60') return 30;
        if (key === 'visibility_only_monthly_99') return 30;
        if (key === 'visibility_only_offer_199') return 90;
        return 30;
      };
      const add = pkg === 'per_booking' ? null : plusDays(pkg);
      const endDateObj = add == null ? null : new Date(now.getTime() + add * 24 * 60 * 60 * 1000);
      const end = endDateObj ? endDateObj.toISOString().slice(0,10) : null;
      await db.run(
        `INSERT INTO subscriptions (salon_id, plan, package, start_date, end_date, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [salonId, plan, pkg, start, end]
      );
      try {
        let paymentType = null;
        let amount = 0;
        let description = '';
        const validFrom = new Date(now);
        const validUntil = endDateObj ? new Date(endDateObj) : null;
        const invoiceNumber = `INV-REN-${Date.now()}-${salonId}`;
        if (pkg === '2months_offer') {
          paymentType = 'offer_200ils';
          amount = 200;
          description = 'عرض خاص شهرين: 200 شيكل';
        } else if (pkg === 'monthly_200') {
          paymentType = 'monthly_200';
          amount = 200;
          description = 'تجديد شهري: 200 شيكل';
        } else if (pkg === 'monthly_60') {
          paymentType = 'monthly_70';
          const c = Number(chairs) > 0 ? Number(chairs) : 1;
          amount = 70 * c;
          description = `تجديد شهري لكل كرسي: 70 × ${c} = ${amount} شيكل`;
        } else if (pkg === 'visibility_only_monthly_99') {
          paymentType = 'visibility_only_monthly_99';
          amount = 100;
          description = 'خطة بدون حجوزات: 100 شيكل شهرياً';
        } else if (pkg === 'visibility_only_offer_199') {
          paymentType = 'visibility_only_offer_199';
          amount = 200;
          description = 'خطة بدون حجوزات: عرض 200 شيكل / 3 أشهر';
        } else if (pkg === 'per_booking') {
          paymentType = null;
        }
        if (paymentType) {
          await db.run(
            `INSERT INTO payments (
              salon_id, payment_type, amount, currency, payment_status,
              payment_method, description, valid_from, valid_until,
              invoice_number, admin_notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              salonId,
              paymentType,
              amount,
              'ILS',
              'مكتملة',
              'cash',
              description,
              validFrom.toISOString(),
              validUntil ? validUntil.toISOString() : null,
              invoiceNumber,
              'Admin renewal'
            ]
          );
        }
      } catch (_) {}
      await db.run('UPDATE salons SET status = $1 WHERE id = $2', ['accepted', salonId]);
      const created = await db.get(
        `SELECT sub.*, s.salon_name FROM subscriptions sub LEFT JOIN salons s ON sub.salon_id = s.id WHERE sub.salon_id = $1 ORDER BY sub.start_date DESC LIMIT 1`,
        [salonId]
      );
      res.json({ success: true, subscription: created });
    } catch (e) {
      res.status(500).json({ error: 'Internal server error' });
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
}
