module.exports = function registerSubscriptionsRoutes(app, { db, requireAdmin }) {
  // Debug endpoint to verify router is active
  app.get('/api/admin/subscriptions/ping', (req, res) => {
    res.json({ message: 'Subscriptions router is active', timestamp: new Date() });
  });

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
      const { package: pkg, startDate, endDate, type, amount: customAmount } = req.body || {};
      
      if (!salonId) {
        return res.status(400).json({ error: 'Missing salon_id' });
      }

      // Force Month-Based Logic (Start: 1st, End: Last Day)
      // Even if specific dates are passed, we align them to full months.
      let start, end;
      
      const inputDate = startDate ? new Date(startDate) : new Date();
      // Use UTC methods to avoid timezone shifts when setting dates
      const year = inputDate.getFullYear();
      const month = inputDate.getMonth(); // 0-indexed

      // Start Date = 1st of the month
      // Format as YYYY-MM-DD
      const startObj = new Date(Date.UTC(year, month, 1));
      start = startObj.toISOString().slice(0, 10);

      // End Date = Last day of the month (default 1 month duration)
      // new Date(year, month + 1, 0) gives last day of month
      const endObj = new Date(Date.UTC(year, month + 1, 0));
      end = endObj.toISOString().slice(0, 10);

      const packageKey = type || 'monthly_100';

      // 1. Create Subscription
      await db.run(
        `INSERT INTO subscriptions (salon_id, package, start_date, end_date, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [salonId, packageKey, start, end]
      );

      // 2. Create Payment Record (Invoice)
      try {
        let paymentType = packageKey;
        let amount = (customAmount !== undefined) ? Number(customAmount) : 100;
        let description = 'Monthly Subscription';
        
        if (paymentType === 'offer' || amount === 0) {
            description = 'Gift Subscription';
            amount = 0;
        } else if (paymentType === 'half_offer') {
            description = '50% Offer (Union Member)';
            amount = 50;
        }

        const validFrom = new Date(start);
        const validUntil = end ? new Date(end) : null;
        const invoiceNumber = `INV-${Date.now()}-${salonId}`; // Simple unique ID

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
            'paid',
            'bank_transfer', // Default assumption for manual entry
            description,
            validFrom.toISOString(),
            validUntil ? validUntil.toISOString() : null,
            invoiceNumber,
            'Admin manual entry'
          ]
        );
      } catch (err) {
        console.error('Failed to create payment record:', err);
      }

      // 3. Ensure Salon is Active
      await db.run('UPDATE salons SET status = $1 WHERE id = $2', ['accepted', salonId]);

      const created = await db.get(
        `SELECT sub.*, s.salon_name FROM subscriptions sub LEFT JOIN salons s ON sub.salon_id = s.id WHERE sub.salon_id = $1 ORDER BY sub.start_date DESC LIMIT 1`,
        [salonId]
      );
      res.json({ success: true, subscription: created });
    } catch (e) {
      console.error(e);
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

  app.delete('/api/admin/payments/:id', requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid ID' });
      
      // Check if this payment is linked to a subscription via some logic?
      // For now, just delete the payment as requested.
      // Ideally we might want to delete the subscription too if it was auto-created, 
      // but there's no foreign key link in the schema shown.
      
      const result = await db.run('DELETE FROM payments WHERE id = $1', [id]);
      res.json({ success: true });
    } catch (e) {
      console.error(`Error deleting payment ${req.params.id}:`, e);
      res.status(500).json({ error: 'Failed to delete payment' });
    }
  });

  app.delete('/api/admin/subscriptions/:id', requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid ID' });
      const result = await db.run('DELETE FROM subscriptions WHERE id = $1', [id]);
      res.json({ success: true });
    } catch (e) {
      console.error(`Error deleting subscription ${req.params.id}:`, e);
      res.status(500).json({ error: 'Failed to delete subscription' });
    }
  });
}
