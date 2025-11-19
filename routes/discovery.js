module.exports = function register(app, deps) {
  const { db, dbAll, dbGet, dbRun, requireAuth, fetchSalonsWithAvailability } = deps;

  app.get('/api/discovery/:city/:gender', async (req, res) => {
    res.set({ 'Cache-Control': 'public, max-age=30' });
    const { city, gender } = req.params;
    const { service_ids } = req.query;
    const genderFocus = gender === 'male' ? 'men' : 'women';
    try {
      let allRelevantSalons = await fetchSalonsWithAvailability(city, genderFocus);
      if (service_ids) {
        const serviceIdArray = String(service_ids).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        if (serviceIdArray.length > 0) {
          const placeholders = serviceIdArray.map((_, index) => `$${index + 1}`).join(',');
          const salonServiceCounts = await dbAll(`
            SELECT salon_id, COUNT(DISTINCT service_id) as service_count
            FROM salon_services 
            WHERE service_id IN (${placeholders})
            GROUP BY salon_id
            HAVING COUNT(DISTINCT service_id) = $${serviceIdArray.length + 1}
          `, [...serviceIdArray, serviceIdArray.length]);
          const salonIdsWithAllServices = new Set(salonServiceCounts.map(row => row.salon_id));
          allRelevantSalons = allRelevantSalons.filter(salon => salonIdsWithAllServices.has(salon.id));
        }
      }
      const servicesSql = "SELECT id, name_ar, icon, service_type FROM services WHERE gender = $1";
      const discoveryServices = await db.query(servicesSql, [genderFocus]);
      const citySalons = allRelevantSalons.filter(s => s.city === city);
      citySalons.sort((a, b) => {
        if (a.is_available_today && !b.is_available_today) return -1;
        if (!a.is_available_today && b.is_available_today) return 1;
        return (b.avg_rating || 0) - (a.avg_rating || 0);
      });
      const featuredSalons = allRelevantSalons;
      res.json({ services: discoveryServices, citySalons, featuredSalons, allSalons: allRelevantSalons });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to load discovery data.' });
    }
  });

  app.get('/api/favorites/:user_id', requireAuth, async (req, res) => {
    const paramUserId = req.params.user_id;
    const authUserId = req.user?.id;
    if (!paramUserId || paramUserId === 'undefined' || isNaN(parseInt(paramUserId))) {
      return res.status(400).json({ success: false, message: 'User ID is required and must be valid.' });
    }
    if (String(paramUserId) !== String(authUserId)) {
      return res.status(403).json({ success: false, message: 'Forbidden: cannot access another user\'s favorites.' });
    }
    const sql = `
      SELECT s.id AS salonId, s.salon_name, s.address, s.city, s.image_url,
             COALESCE(AVG(r.rating), 0) AS avg_rating, COUNT(r.id) AS review_count
      FROM favorites f
      JOIN salons s ON f.salon_id = s.id
      LEFT JOIN reviews r ON s.id = r.salon_id
      WHERE f.user_id = $1
      GROUP BY s.id
    `;
    try {
      const rows = await dbAll(sql, [authUserId]);
      const favorites = rows.map(row => ({ ...row, is_favorite: true }));
      res.json(favorites);
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.post('/api/favorites/toggle', requireAuth, (req, res) => {
    const authUserId = req.user?.id;
    const salon_id_raw = req.body?.salon_id;
    const salon_id = typeof salon_id_raw === 'string' ? Number(salon_id_raw) : salon_id_raw;
    if (!authUserId || isNaN(parseInt(authUserId)) || !salon_id || isNaN(parseInt(salon_id))) {
      return res.status(400).json({ success: false, message: 'User ID and Salon ID must be valid numbers.' });
    }
    dbGet('SELECT * FROM favorites WHERE user_id = $1 AND salon_id = $2', [authUserId, salon_id]).then(row => {
      if (row) {
        dbRun('DELETE FROM favorites WHERE user_id = $1 AND salon_id = $2', [authUserId, salon_id]).then(() => {
          res.json({ success: true, is_favorite: false, message: 'Unfavorited successfully.' });
        }).catch(() => res.status(500).json({ success: false, message: 'Delete error.' }));
      } else {
        dbRun('INSERT INTO favorites (user_id, salon_id) VALUES ($1, $2)', [authUserId, salon_id]).then(() => {
          res.json({ success: true, is_favorite: true, message: 'Favorited successfully.' });
        }).catch(() => res.status(500).json({ success: false, message: 'Insert error.' }));
      }
    }).catch(() => res.status(500).json({ success: false, message: 'Database error.' }));
  });
}