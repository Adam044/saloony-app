module.exports = function register(app, deps) {
  const { dbAll, dbGet, dbRun, sendPushToTargets, VAPID_PUBLIC_KEY } = deps;

  app.get('/api/push/public-key', (req, res) => {
    res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
  });

  app.post('/api/push/subscribe', async (req, res) => {
    try {
      const { user_id, salon_id } = req.body || {};
      let subscription = req.body.subscription;
      if (!subscription && req.body.endpoint && req.body.keys) {
        subscription = { endpoint: req.body.endpoint, keys: req.body.keys };
      }
      if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
        return res.status(400).json({ success: false, message: 'Invalid subscription payload.' });
      }
      const endpoint = subscription.endpoint;
      const p256dh = subscription.keys.p256dh;
      const auth = subscription.keys.auth;
      const userId = user_id ? Number(user_id) : null;
      const salonId = salon_id ? Number(salon_id) : null;
      const existing = await dbGet('SELECT id, user_id, salon_id, p256dh, auth FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
      if (existing) {
        if (existing.user_id === userId && existing.salon_id === salonId && existing.p256dh === p256dh && existing.auth === auth) {
          await dbRun('UPDATE push_subscriptions SET last_active = CURRENT_TIMESTAMP WHERE id = $1', [existing.id]);
          return res.json({ success: true, message: 'Subscription already up to date' });
        }
        await dbRun('UPDATE push_subscriptions SET user_id = $1, salon_id = $2, p256dh = $3, auth = $4, last_active = CURRENT_TIMESTAMP WHERE id = $5', [userId, salonId, p256dh, auth, existing.id]);
      } else {
        await dbRun('INSERT INTO push_subscriptions (user_id, salon_id, endpoint, p256dh, auth, last_active) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)', [userId, salonId, endpoint, p256dh, auth]);
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to subscribe.' });
    }
  });

  app.post('/api/push/unsubscribe', async (req, res) => {
    try {
      const { endpoint } = req.body || {};
      if (!endpoint) return res.status(400).json({ success: false });
      await dbRun('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false });
    }
  });

  app.get('/api/debug/push-subscriptions', async (req, res) => {
    try {
      const { user_id, salon_id } = req.query || {};
      let rows;
      if (user_id) rows = await dbAll('SELECT id, user_id, salon_id, endpoint, last_active FROM push_subscriptions WHERE user_id = $1', [user_id]);
      else if (salon_id) rows = await dbAll('SELECT id, user_id, salon_id, endpoint, last_active FROM push_subscriptions WHERE salon_id = $1', [salon_id]);
      else rows = await dbAll('SELECT id, user_id, salon_id, endpoint, last_active FROM push_subscriptions ORDER BY id DESC LIMIT 50');
      res.json({ success: true, count: rows.length, rows });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to list subscriptions.' });
    }
  });

  app.post('/api/push/test', async (req, res) => {
    try {
      const { user_id, salon_id, title, body, url, tag } = req.body || {};
      if (!user_id && !salon_id) return res.status(400).json({ success: false, message: 'user_id أو salon_id مطلوب.' });
      const payload = {
        title: title || 'اختبار الإشعارات',
        body: body || 'هذا إشعار تجريبي من Saloony.',
        url: url || (user_id ? '/home_user.html' : '/home_salon.html'),
        tag: tag || 'saloony-test'
      };
      await sendPushToTargets({ user_id, salon_id, payload });
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to send test push.' });
    }
  });
}