module.exports = function register(app, deps) {
  const { dbAll, dbGet, dbRun } = deps;

  app.get('/api/salons/:salon_id/services', async (req, res) => {
    const salonId = req.params.salon_id;
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
      return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    const sql = `
      SELECT s.id, s.name_ar, s.icon, s.service_type, ss.price, ss.duration
      FROM salon_services ss
      JOIN services s ON ss.service_id = s.id
      WHERE ss.salon_id = $1
    `;
    try {
      const rows = await dbAll(sql, [salonId]);
      res.json({ success: true, services: rows });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.get('/api/salon/services/:salon_id', async (req, res) => {
    try {
      const salonId = req.params.salon_id;
      if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
        return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
      }
      const sql = `
        SELECT s.id, s.name_ar, s.icon, s.service_type, ss.price, ss.duration
        FROM salon_services ss
        JOIN services s ON ss.service_id = s.id
        WHERE ss.salon_id = $1
      `;
      const rows = await dbAll(sql, [salonId]);
      res.json({ success: true, services: rows });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.post('/api/salon/services/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    const services = req.body.services;
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
      return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    if (!Array.isArray(services)) {
      return res.status(400).json({ success: false, message: 'Invalid services format.' });
    }
    try {
      await dbRun('DELETE FROM salon_services WHERE salon_id = $1', [salonId]);
      for (const service of services) {
        if (service.service_id && service.price !== undefined && service.price !== null && service.duration !== undefined && service.duration !== null) {
          await dbRun('INSERT INTO salon_services (salon_id, service_id, price, duration) VALUES ($1, $2, $3, $4)', [salonId, service.service_id, service.price, service.duration]);
        }
      }
      res.json({ success: true, message: 'Salon services updated successfully.' });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Database error during service update.' });
    }
  });
}