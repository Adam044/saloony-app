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
      const { package: pkg } = req.body || {};
      if (!salonId) {
        return res.status(400).json({ error: 'Missing salon_id' });
      }
      const packageKey = 'monthly_100';
      const now = new Date();
      const start = now.toISOString().slice(0,10);
      const plusDays = () => 30;
      const add = plusDays();
      const endDateObj = add == null ? null : new Date(now.getTime() + add * 24 * 60 * 60 * 1000);
      const end = endDateObj ? endDateObj.toISOString().slice(0,10) : null;
      await db.run(
        `INSERT INTO subscriptions (salon_id, package, start_date, end_date, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [salonId, packageKey, start, end]
      );
      try {
        let paymentType = null;
        let amount = 0;
        let description = '';
        const validFrom = new Date(now);
        const validUntil = endDateObj ? new Date(endDateObj) : null;
        const invoiceNumber = `INV-REN-${Date.now()}-${salonId}`;
        paymentType = 'monthly_100';
        amount = 100;
        description = 'اشتراك شهري موحد: 100 شيكل';
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
              'bank_transfer',
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
