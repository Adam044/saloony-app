const express = require('express');

module.exports = function register(app, deps) {
  const { dbAll, dbGet, dbRun, requireAuth } = deps;

  app.get('/api/reviews/user/:user_id', requireAuth, (req, res) => {
    const user_id = req.params.user_id;
    const q = `SELECT r.id, r.salon_id, r.user_id, r.rating, r.comment, r.date_posted,
                      s.salon_name
               FROM reviews r JOIN salons s ON s.id = r.salon_id
               WHERE r.user_id = $1 ORDER BY r.date_posted DESC`;
    dbAll(q, [user_id]).then(rows => {
      res.json({ success: true, reviews: rows });
    }).catch(err => {
      res.status(500).json({ success: false, message: 'Database error.' });
    });
  });

  app.get('/api/reviews/salon/:salon_id', (req, res) => {
    const salon_id = req.params.salon_id;
    const q = `SELECT r.id, r.salon_id, r.user_id, r.rating, r.comment, r.date_posted,
                      u.name AS user_name
               FROM reviews r LEFT JOIN users u ON u.id = r.user_id
               WHERE r.salon_id = $1 ORDER BY r.date_posted DESC`;
    dbAll(q, [salon_id]).then(rows => {
      res.json({ success: true, reviews: rows });
    }).catch(err => {
      res.status(500).json({ success: false, message: 'Database error.' });
    });
  });

  app.post('/api/reviews/submit', requireAuth, async (req, res) => {
    const salon_id = req.body?.salon_id;
    const rating = req.body?.rating;
    const comment = req.body?.comment || '';
    const user_id = req.user?.id;
    if (!user_id || !salon_id || !rating || String(comment).trim() === '') {
      return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }
    if (Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
    }
    try {
      const existing = await dbGet('SELECT id FROM reviews WHERE user_id = $1 AND salon_id = $2', [user_id, salon_id]);
      if (existing) {
        return res.status(400).json({ success: false, message: 'You have already reviewed this salon.' });
      }
      const inserted = await dbGet(
        `INSERT INTO reviews (user_id, salon_id, rating, comment, date_posted)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
        [user_id, salon_id, rating, comment]
      );
      res.json({ success: true, message: 'Review submitted successfully.', review_id: inserted.id });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(400).json({ success: false, message: 'You have already reviewed this salon.' });
      }
      res.status(500).json({ success: false, message: 'Failed to submit review.' });
    }
  });

  app.delete('/api/reviews/delete', requireAuth, async (req, res) => {
    const authUserId = req.user?.id;
    const salon_id = req.body?.salon_id;
    if (!authUserId || !salon_id) {
      return res.status(400).json({ success: false, message: 'User ID and Salon ID are required.' });
    }
    try {
      const result = await dbRun(`DELETE FROM reviews WHERE user_id = $1 AND salon_id = $2`, [authUserId, salon_id]);
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: 'Review not found.' });
      }
      res.json({ success: true, message: 'Review deleted successfully.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Database error occurred while deleting review.' });
    }
  });
}