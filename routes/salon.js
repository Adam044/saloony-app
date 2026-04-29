module.exports = function register(app, deps) {
  const { db, dbAll, dbGet, dbRun, requireSalonAdminRole, addSalonClient, removeSalonClient, sendSalonEvent, hashPin, verifyPin, crypto, upload, sharp, supabase } = deps;

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

  app.get('/api/salon/subscriptions/:salon_id', async (req, res) => {
    try {
      const salonId = req.params.salon_id;
      if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
        return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
      }
      const rows = await dbAll('SELECT * FROM subscriptions WHERE salon_id = $1 ORDER BY start_date DESC', [salonId]);
      res.json({ success: true, subscriptions: rows });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/salon/image/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    try {
      const images = await dbAll(
        `SELECT image_path, width, height FROM salon_images WHERE salon_id = $1 AND image_type = 'logo'`,
        [salonId]
      );
      if (images && images.length > 0) {
        const image = images[0];
        res.set({
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Type': 'image/webp',
          'X-Image-Width': image.width,
          'X-Image-Height': image.height,
        });
        return res.redirect(301, image.image_path);
      }
      res.status(404).json({ success: false, message: 'Image not found' });
    } catch {
      res.status(500).json({ success: false, message: 'Error loading image' });
    }
  });

  app.get('/api/salon/schedule/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
      return res.status(400).json({ success: false, message: 'Salon ID is required.' });
    }
    try {
      const schedule = await dbGet('SELECT * FROM schedules WHERE salon_id = $1', [salonId]);
      
      // Parse closed_days if it's a string (assuming JSON array string)
      if (schedule && schedule.closed_days && typeof schedule.closed_days === 'string') {
        try { schedule.closed_days = JSON.parse(schedule.closed_days); } catch {}
      }

      // Fetch breaks and modifications
      const breaks = await dbAll('SELECT * FROM breaks WHERE salon_id = $1 ORDER BY start_time ASC', [salonId]);
      const modifications = await dbAll('SELECT * FROM schedule_modifications WHERE salon_id = $1 ORDER BY id DESC', [salonId]);
      
      res.json({ success: true, schedule: schedule, breaks: breaks, modifications: modifications });
    } catch (error) {
      console.error('Error fetching schedule:', error);
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.get('/api/salon/info/:identifier', async (req, res) => {
    let identifier = req.params.identifier;
    if (!identifier || identifier === 'undefined') {
      return res.status(400).json({ success: false, message: 'Salon identifier is required.' });
    }

    let salonId = null;
    if (!isNaN(parseInt(identifier))) {
      salonId = parseInt(identifier);
    } else {
      try {
        const slugRow = await dbGet('SELECT id FROM salons WHERE slug = $1', [identifier]);
        if (slugRow) {
          salonId = slugRow.id;
        } else {
          return res.status(404).json({ success: false, message: 'Salon not found.' });
        }
      } catch (e) {
        return res.status(500).json({ success: false, message: 'Database error resolving slug.' });
      }
    }

    try {
      const row = await dbGet(
        `SELECT s.id, s.salon_name, s.address, s.city, s.gender_focus, s.image_url, s.logo_url, s.salon_phone, s.owner_name, s.owner_phone, s.user_id, s.about, 
                u.email, u.user_type as role,
                sl.latitude, sl.longitude, s.slug
         FROM salons s 
         JOIN users u ON s.user_id = u.id 
         LEFT JOIN salon_locations sl ON s.id = sl.salon_id
         WHERE s.id = $1`,
        [salonId]
      );
      if (!row) return res.status(404).json({ success: false, message: 'Salon not found.' });
      
      // Fetch social links
      try {
        const socials = await dbAll('SELECT platform, url FROM social_links WHERE salon_id = $1', [salonId]);
        const m = {};
        if (socials) {
            for (const s of socials) m[s.platform] = s.url;
        }
        row.facebook_url = m.facebook || null;
        row.instagram_url = m.instagram || null;
        row.tiktok_url = m.tiktok || null;
        row.social = m;
      } catch (e) {
          console.error('Error fetching social links for info:', e);
      }

      res.json({ success: true, salon: row });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.post('/api/salon/info/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
      return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    try {
      const current = await dbGet(
        'SELECT salon_name, owner_name, salon_phone, owner_phone, address, city, gender_focus, image_url, logo_url, about FROM salons WHERE id = $1',
        [salonId]
      );
      if (!current) return res.status(404).json({ success: false, message: 'Salon not found.' });

      const {
        salon_name,
        owner_name,
        salon_phone,
        owner_phone,
        address,
        city,
        gender_focus,
        image_url,
        logo_url,
        about
      } = req.body || {};
      const pick = (val, existing) => {
        if (val === undefined || val === null) return existing;
        if (typeof val === 'string') {
          const t = val.trim();
          if (!t) return existing;
          return t;
        }
        return val;
      };
      const nextSalonName = pick(salon_name, current.salon_name);
      const nextOwnerName = pick(owner_name, current.owner_name);
      const nextSalonPhone = pick(salon_phone, current.salon_phone);
      const nextOwnerPhone = pick(owner_phone, current.owner_phone);
      const nextAddress = pick(address, current.address);
      const nextCity = pick(city, current.city);
      const nextAbout = pick(about, current.about);
      const nextGenderFocusRaw = pick(gender_focus, current.gender_focus);
      const nextGenderFocus = ['men','women'].includes(String(nextGenderFocusRaw).toLowerCase())
        ? String(nextGenderFocusRaw).toLowerCase()
        : current.gender_focus;
      const nextImageUrlRaw = pick(image_url, current.image_url);
      const safeImageUrl = typeof nextImageUrlRaw === 'string'
        ? nextImageUrlRaw.trim().replace(/^`|`$/g, '')
        : nextImageUrlRaw;
      const nextLogoUrlRaw = pick(logo_url, current.logo_url);
      const safeLogoUrl = typeof nextLogoUrlRaw === 'string'
        ? nextLogoUrlRaw.trim().replace(/^`|`$/g, '')
        : nextLogoUrlRaw;

      await dbRun(
        `UPDATE salons
         SET salon_name = $1,
             owner_name = $2,
             salon_phone = $3,
             owner_phone = $4,
             address = $5,
             city = $6,
             gender_focus = $7,
             image_url = $8,
             about = $9,
             logo_url = $10
         WHERE id = $11`,
        [
          nextSalonName,
          nextOwnerName,
          nextSalonPhone,
          nextOwnerPhone,
          nextAddress,
          nextCity,
          nextGenderFocus,
          safeImageUrl,
          nextAbout,
          safeLogoUrl,
          salonId,
        ]
      );

      return res.json({ success: true, message: 'Salon info updated successfully.', image_url: safeImageUrl || current.image_url, logo_url: safeLogoUrl || current.logo_url });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Database error during salon update.' });
    }
  });

  app.get('/api/salon/location/:salon_id', async (req, res) => {
    try {
      const salonId = parseInt(req.params.salon_id);
      if (isNaN(salonId)) return res.status(400).json({ success: false, message: 'salon_id غير صالح' });
      const location = await dbGet(
        `SELECT salon_id, address, city, latitude, longitude, place_id, formatted_address, created_at, updated_at FROM salon_locations WHERE salon_id = $1`,
        [salonId]
      );
      if (!location) return res.json({ success: true, location: null });
      res.json({ success: true, location });
    } catch {
      res.status(500).json({ success: false, message: 'فشل في تحميل موقع الصالون' });
    }
  });

  app.post('/api/salons/locations/batch', async (req, res) => {
    try {
      const idsRaw = (req.body && req.body.ids) || [];
      const ids = Array.isArray(idsRaw) ? idsRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
      if (!ids.length) return res.json({ success: true, locations: [] });
      let rows = [];
      if (db.isProduction) {
        rows = await db.query(`SELECT salon_id, latitude, longitude FROM salon_locations WHERE salon_id = ANY($1)`, [ids]);
      } else {
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        rows = await db.query(`SELECT salon_id, latitude, longitude FROM salon_locations WHERE salon_id IN (${placeholders})`, ids);
      }
      const list = (rows || []).map((r) => ({ salon_id: Number(r.salon_id), latitude: r.latitude, longitude: r.longitude }));
      return res.json({ success: true, locations: list });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'فشل في تحميل مواقع الصالونات', error: String(e && e.message || '') });
    }
  });

  app.post('/api/salon/location/:salon_id', async (req, res) => {
    try {
      const salonId = parseInt(req.params.salon_id);
      if (isNaN(salonId)) return res.status(400).json({ success: false, message: 'salon_id غير صالح' });
      const salon = await dbGet(`SELECT id FROM salons WHERE id = $1`, [salonId]);
      if (!salon) return res.status(404).json({ success: false, message: 'الصالون غير موجود' });
      const { address, city, latitude, longitude, place_id, formatted_address } = req.body || {};
      const lat = latitude !== undefined ? parseFloat(latitude) : null;
      const lng = longitude !== undefined ? parseFloat(longitude) : null;
      if ((lat !== null && isNaN(lat)) || (lng !== null && isNaN(lng))) {
        return res.status(400).json({ success: false, message: 'إحداثيات غير صالحة' });
      }
      await dbRun(
        `INSERT INTO salon_locations (salon_id, address, city, latitude, longitude, place_id, formatted_address, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
         ON CONFLICT (salon_id) DO UPDATE SET address = EXCLUDED.address, city = EXCLUDED.city, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, place_id = EXCLUDED.place_id, formatted_address = EXCLUDED.formatted_address, updated_at = CURRENT_TIMESTAMP`,
        [salonId, address || null, city || null, lat, lng, place_id || null, formatted_address || null]
      );
      const saved = await dbGet(
        `SELECT salon_id, address, city, latitude, longitude, place_id, formatted_address, created_at, updated_at FROM salon_locations WHERE salon_id = $1`,
        [salonId]
      );
      res.json({ success: true, location: saved });
    } catch {
      res.status(500).json({ success: false, message: 'فشل في حفظ موقع الصالون' });
    }
  });

  app.get('/api/salon/details/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
      return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    try {
      const sql = `
      SELECT s.id AS salonId, s.salon_name, s.address, s.city, s.image_url, s.salon_phone, s.owner_phone, s.owner_name, s.gender_focus, s.created_at,
             COALESCE(AVG(r.rating), 0) AS avg_rating, COUNT(r.id) AS review_count
      FROM salons s LEFT JOIN reviews r ON s.id = r.salon_id WHERE s.id = $1 GROUP BY s.id, s.salon_phone, s.owner_phone`;
      const row = await dbGet(sql, [salonId]);
      if (!row) return res.status(404).json({ success: false, message: 'Salon not found.' });
      try {
        const socials = await db.query('SELECT platform, url FROM social_links WHERE salon_id = $1', [Number(salonId)]);
        const m = {};
        for (const s of socials) m[s.platform] = s.url;
        row.facebook_url = m.facebook || null;
        row.instagram_url = m.instagram || null;
        row.tiktok_url = m.tiktok || null;
        row.social = m;
      } catch {}
      res.json({ success: true, salon: row });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.get('/api/salon/social-links/:salon_id', async (req, res) => {
    try {
      const salonId = req.params.salon_id;
      if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
        return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
      }
      const rows = await db.query('SELECT platform, url FROM social_links WHERE salon_id = $1', [Number(salonId)]);
      const social = {};
      for (const r of rows) social[r.platform] = r.url;
      return res.json({ success: true, social });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.post('/api/salon/social-links/:salon_id', requireSalonAdminRole, async (req, res) => {
    try {
      const salonId = Number(req.params.salon_id);
      const { platform, url } = req.body;
      if (!platform || !url) return res.status(400).json({ success: false, message: 'Platform and URL are required.' });
      const normalizedPlatform = String(platform).toLowerCase();
      if (!['facebook','instagram','tiktok','other'].includes(normalizedPlatform)) {
        return res.status(400).json({ success: false, message: 'Invalid platform.' });
      }
      const existing = await db.get('SELECT id FROM social_links WHERE salon_id = $1 AND platform = $2', [salonId, normalizedPlatform]);
      if (existing) {
        await db.run('UPDATE social_links SET url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [url, existing.id]);
      } else {
        await db.run('INSERT INTO social_links (salon_id, platform, url) VALUES ($1, $2, $3)', [salonId, normalizedPlatform, url]);
      }
      return res.json({ success: true, message: 'Social link saved.' });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.delete('/api/salon/social-links/:salon_id', requireSalonAdminRole, async (req, res) => {
    try {
      const salonId = Number(req.params.salon_id);
      const { platform } = req.body || {};
      if (!platform) return res.status(400).json({ success: false, message: 'Platform is required.' });
      const normalizedPlatform = String(platform).toLowerCase();
      await db.run('DELETE FROM social_links WHERE salon_id = $1 AND platform = $2', [salonId, normalizedPlatform]);
      return res.json({ success: true, message: 'Social link deleted.' });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.get('/api/salon/staff/:salon_id', async (req, res) => {
    try {
      const salonId = req.params.salon_id;
      if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
        return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
      }
      const rows = await dbAll('SELECT id, name FROM staff WHERE salon_id = $1', [salonId]);
      res.json({ success: true, staff: rows });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.post('/api/salon/staff/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    const { name } = req.body;
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
      return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    try {
      const result = await dbGet('INSERT INTO staff (salon_id, name) VALUES ($1, $2) RETURNING id', [salonId, name]);
      res.json({ success: true, staffId: result.id, message: 'Staff added successfully.' });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.delete('/api/salon/staff/:staff_id', async (req, res) => {
    const staffId = req.params.staff_id;
    try {
      await dbRun('DELETE FROM staff WHERE id = $1', [staffId]);
      res.json({ success: true, message: 'Staff deleted successfully.' });
    } catch (err) {
      if (err.code === '23503') {
        return res.status(400).json({ success: false, message: 'لا يمكن حذف المختص. لديه حجوزات سابقة أو حالية مرتبطة به أو استراحات روتينية.' });
      }
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.get('/api/salon/schedule/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
      return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    try {
      const schedule = await dbGet('SELECT opening_time, closing_time, closed_days FROM schedules WHERE salon_id = $1', [salonId]);
      const breaks = await dbAll('SELECT id, staff_id, start_time, end_time, reason FROM breaks WHERE salon_id = $1', [salonId]);
      const modificationsRaw = await dbAll('SELECT id, mod_type, mod_date, mod_day_index, start_time, end_time, closure_type, reason, staff_id FROM schedule_modifications WHERE salon_id = $1', [salonId]);
      const modifications = (modificationsRaw || []).map(m => {
        const hasTimes = !!(m.start_time && m.end_time);
        const closure_type = m.closure_type || (hasTimes ? 'interval' : 'full_day');
        const is_full_day = closure_type === 'full_day';
        return { ...m, is_full_day, closure_type };
      });
      if (schedule && schedule.closed_days && typeof schedule.closed_days === 'string') {
        try { schedule.closed_days = JSON.parse(schedule.closed_days); } catch {}
      }
      res.json({ success: true, schedule, breaks, modifications });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.post('/api/salon/schedule/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    const { opening_time, closing_time, closed_days } = req.body;
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
      return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    try {
      const closedDaysJson = Array.isArray(closed_days) ? JSON.stringify(closed_days) : closed_days || null;
      const existing = await dbGet('SELECT salon_id FROM schedules WHERE salon_id = $1', [salonId]);
      if (existing) {
        await dbRun('UPDATE schedules SET opening_time = $1, closing_time = $2, closed_days = $3 WHERE salon_id = $4', [opening_time || null, closing_time || null, closedDaysJson, salonId]);
      } else {
        await dbRun('INSERT INTO schedules (salon_id, opening_time, closing_time, closed_days) VALUES ($1, $2, $3, $4)', [salonId, opening_time || null, closing_time || null, closedDaysJson]);
      }
      res.json({ success: true, message: 'Schedule updated successfully.' });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.post('/api/salon/break/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    const { staff_id, start_time, end_time, reason } = req.body;
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
      return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    try {
      const result = await dbGet('INSERT INTO breaks (salon_id, staff_id, start_time, end_time, reason) VALUES ($1, $2, $3, $4, $5) RETURNING id', [salonId, staff_id || null, start_time, end_time, reason || null]);
      res.json({ success: true, breakId: result.id });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.delete('/api/salon/break/:break_id', async (req, res) => {
    const breakId = req.params.break_id;
    try {
      await dbRun('DELETE FROM breaks WHERE id = $1', [breakId]);
      res.json({ success: true });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.post('/api/salon/schedule/modification/:salon_id', async (req, res) => {
    const salonId = req.params.salon_id;
    const { mod_type, mod_date, mod_day_index, start_time, end_time, closure_type, reason, staff_id } = req.body;
    if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
      return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    try {
      const reasonSafe = (reason && String(reason).trim()) || 'حجب يدوي';
      const result = await dbGet(
        `INSERT INTO schedule_modifications (salon_id, mod_type, mod_date, mod_day_index, start_time, end_time, closure_type, reason, staff_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [salonId, mod_type || null, mod_date || null, mod_day_index || null, start_time || null, end_time || null, closure_type || null, reasonSafe, staff_id || null]
      );
      res.json({ success: true, modificationId: result.id });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.delete('/api/salon/schedule/modification/:mod_id', async (req, res) => {
    const modId = req.params.mod_id;
    try {
      await dbRun('DELETE FROM schedule_modifications WHERE id = $1', [modId]);
      res.json({ success: true });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.get('/api/salon/payments/:salon_id', async (req, res) => {
    try {
      const { salon_id } = req.params;
      const payments = await db.query(`
            SELECT 
                id, payment_type, amount, currency, payment_status,
                payment_method, description, valid_from, valid_until,
                invoice_number, created_at
            FROM payments 
            WHERE salon_id = $1 
            ORDER BY created_at DESC
        `, [salon_id]);
      res.json({ success: true, payments });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  app.get('/api/salon/stream/:salon_id', (req, res) => {
    const salonId = req.params.salon_id;
    if (!salonId || isNaN(parseInt(salonId))) {
      return res.status(400).end();
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ salonId: Number(salonId) })}\n\n`);
    addSalonClient(salonId, res);
    const heartbeat = setInterval(() => {
      try { res.write(`: heartbeat\n\n`); } catch (e) {}
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      removeSalonClient(salonId, res);
      try { res.end(); } catch (e) {}
    });
  });

  app.get('/api/salon/roles/:salon_id', async (req, res) => {
    try {
      const salonId = req.params.salon_id;
      if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
        return res.status(400).json({ success: false, message: 'Valid salon ID is required.' });
      }
      const roleConfig = await db.get('SELECT * FROM salon_roles WHERE salon_id = $1', [salonId]);
      let staffRoles = [];
      if (roleConfig && roleConfig.roles_enabled) {
        staffRoles = await db.query(`
                SELECT sr.*, s.name as staff_name 
                FROM staff_roles sr 
                JOIN staff s ON sr.staff_id = s.id 
                WHERE sr.salon_id = $1 AND sr.is_active = TRUE
                ORDER BY sr.role_type, s.name
            `, [salonId]);
      }
      res.json({ success: true, config: roleConfig || { salon_id: salonId, roles_enabled: false, session_duration_hours: 24 }, staff_roles: staffRoles });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.post('/api/salon/roles/:salon_id/toggle', async (req, res) => {
    try {
      const salonId = req.params.salon_id;
      const { enabled, session_duration_hours = 24 } = req.body;
      if (!salonId || salonId === 'undefined' || isNaN(parseInt(salonId))) {
        return res.status(400).json({ success: false, message: 'Valid salon ID is required.' });
      }
      await db.run(`
            INSERT INTO salon_roles (salon_id, roles_enabled, session_duration_hours, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (salon_id) DO UPDATE SET
                roles_enabled = $2,
                session_duration_hours = $3,
                updated_at = CURRENT_TIMESTAMP
        `, [salonId, enabled, session_duration_hours]);
      if (!enabled) {
        await db.run('DELETE FROM role_sessions WHERE salon_id = $1', [salonId]);
      }
      res.json({ success: true, message: 'Role system updated successfully.' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.post('/api/salon/roles/:salon_id/staff', async (req, res) => {
    try {
      const salonId = req.params.salon_id;
      const { staff_id, role_type, pin, biometric_enabled = false } = req.body;
      if (!salonId || !staff_id || !role_type || !pin) {
        return res.status(400).json({ success: false, message: 'Salon ID, staff ID, role type, and PIN are required.' });
      }
      if (!['admin', 'staff'].includes(role_type)) {
        return res.status(400).json({ success: false, message: 'Role type must be either "admin" or "staff".' });
      }
      if (pin.length !== 6) {
        return res.status(400).json({ success: false, message: 'PIN must be exactly 6 digits.' });
      }
      // Require at least one manager before adding any employee
      if (role_type === 'staff') {
        const adminCountRow = await db.get("SELECT COUNT(*) AS count FROM staff_roles WHERE salon_id = $1 AND role_type = 'admin' AND is_active = TRUE", [salonId]);
        const adminCount = (adminCountRow && (adminCountRow.count || adminCountRow.COUNT)) ? Number(adminCountRow.count || adminCountRow.COUNT) : 0;
        if (adminCount === 0) {
          return res.status(400).json({ success: false, message: 'لا يمكن إضافة موظف قبل إضافة مدير واحد على الأقل لهذا الصالون.' });
        }
      }
      const staff = await db.get('SELECT id FROM staff WHERE id = $1 AND salon_id = $2', [staff_id, salonId]);
      if (!staff) {
        return res.status(404).json({ success: false, message: 'Staff member not found or does not belong to this salon.' });
      }
      const existingPinRole = await db.get(`
            SELECT sr.staff_id, s.name as staff_name 
            FROM staff_roles sr 
            JOIN staff s ON sr.staff_id = s.id 
            WHERE sr.salon_id = $1 AND sr.staff_id != $2 AND sr.is_active = TRUE
        `, [salonId, staff_id]);
      if (existingPinRole) {
        for (const role of await db.query(`
                SELECT sr.pin_hash, s.name as staff_name 
                FROM staff_roles sr 
                JOIN staff s ON sr.staff_id = s.id 
                WHERE sr.salon_id = $1 AND sr.staff_id != $2 AND sr.is_active = TRUE
            `, [salonId, staff_id])) {
          const match = await verifyPin(pin.toString(), role.pin_hash);
          if (match) {
            return res.status(400).json({ success: false, message: `لا يمكن استخدام نفس الرقم السري لأكثر من موظف. هذا الرقم مستخدم بالفعل من قبل ${role.staff_name}. يرجى اختيار رقم سري مختلف.` });
          }
        }
      }
      const hashedPin = await hashPin(pin.toString());
      await db.run(`
            INSERT INTO staff_roles (salon_id, staff_id, role_type, pin_hash, biometric_enabled, updated_at)
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            ON CONFLICT (salon_id, staff_id) DO UPDATE SET
                role_type = $3,
                pin_hash = $4,
                biometric_enabled = $5,
                is_active = TRUE,
                updated_at = CURRENT_TIMESTAMP
        `, [salonId, staff_id, role_type, hashedPin, biometric_enabled]);
      res.json({ success: true, message: 'Staff role added successfully.' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.delete('/api/salon/roles/:salon_id/staff/:staff_id', async (req, res) => {
    try {
      const { salon_id, staff_id } = req.params;
      await db.run('UPDATE staff_roles SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE salon_id = $1 AND staff_id = $2', [salon_id, staff_id]);
      await db.run(`
            DELETE FROM role_sessions 
            WHERE staff_role_id IN (
                SELECT id FROM staff_roles WHERE salon_id = $1 AND staff_id = $2
            )
        `, [salon_id, staff_id]);
      res.json({ success: true, message: 'Staff role removed successfully.' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.post('/api/salon/roles/:salon_id/auth', async (req, res) => {
    try {
      const salonId = req.params.salon_id;
      const { pin, staff_id, biometric } = req.body;
      if (!salonId || !pin) {
        return res.status(400).json({ success: false, message: 'Salon ID and PIN are required.' });
      }
      const roleConfig = await db.get('SELECT * FROM salon_roles WHERE salon_id = $1 AND roles_enabled = TRUE', [salonId]);
      if (!roleConfig) {
        return res.status(404).json({ success: false, message: 'Role system is not enabled for this salon.' });
      }
      const staffRoles = await db.query(`
            SELECT sr.*, s.name as staff_name 
            FROM staff_roles sr 
            JOIN staff s ON sr.staff_id = s.id 
            WHERE sr.salon_id = $1 AND sr.is_active = TRUE
        `, [salonId]);
      let authenticatedRole = null;
      if (biometric && pin === 'BIOMETRIC_AUTH' && staff_id) {
        authenticatedRole = staffRoles.find(role => role.staff_id === parseInt(staff_id) && role.biometric_enabled);
        if (!authenticatedRole) {
          return res.status(401).json({ success: false, message: 'Biometric authentication not enabled for this staff member.' });
        }
      } else {
        if (pin.length !== 6) {
          return res.status(400).json({ success: false, message: 'PIN must be exactly 6 digits.' });
        }
        for (const role of staffRoles) {
          const match = await verifyPin(pin.toString(), role.pin_hash);
          if (match) { authenticatedRole = role; break; }
        }
        if (!authenticatedRole) {
          return res.status(401).json({ success: false, message: 'Invalid PIN.' });
        }
      }
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      // Professional Approach: Set session to 30 days (Persistent Session)
      // We ignore the config duration for now to ensure "App-like" persistence
      expiresAt.setDate(expiresAt.getDate() + 30);
      
      await db.run('INSERT INTO role_sessions (salon_id, staff_role_id, session_token, expires_at) VALUES ($1, $2, $3, $4)', [salonId, authenticatedRole.id, sessionToken, expiresAt.toISOString()]);
      res.json({ success: true, session_token: sessionToken, role_type: authenticatedRole.role_type, staff_id: authenticatedRole.staff_id, staff_name: authenticatedRole.staff_name, expires_at: expiresAt.toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Authentication error.' });
    }
  });

  app.post('/api/salon/roles/:salon_id/verify', async (req, res) => {
    try {
      const salonId = req.params.salon_id;
      const { session_token } = req.body;
      if (!salonId || !session_token) {
        return res.status(400).json({ success: false, message: 'Salon ID and session token are required.' });
      }
      const session = await db.get(`
            SELECT rs.*, sr.role_type, sr.staff_id, s.name as staff_name
            FROM role_sessions rs
            JOIN staff_roles sr ON rs.staff_role_id = sr.id
            JOIN staff s ON sr.staff_id = s.id
            WHERE rs.salon_id = $1 AND rs.session_token = $2 AND rs.expires_at > CURRENT_TIMESTAMP
        `, [salonId, session_token]);
      if (!session) {
        return res.status(401).json({ success: false, message: 'Invalid or expired session.' });
      }

      // Sliding Expiration: Extend session by 30 days on every verify to keep active users logged in
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 30);
      await db.run('UPDATE role_sessions SET expires_at = $1 WHERE salon_id = $2 AND session_token = $3', [newExpiresAt.toISOString(), salonId, session_token]);

      res.json({ success: true, valid: true, role_type: session.role_type, staff_id: session.staff_id, staff_name: session.staff_name, expires_at: newExpiresAt.toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Verification error.' });
    }
  });

  app.post('/api/salon/roles/:salon_id/logout', async (req, res) => {
    try {
      const salonId = req.params.salon_id;
      const { session_token } = req.body;
      if (session_token) {
        await db.run('DELETE FROM role_sessions WHERE salon_id = $1 AND session_token = $2', [salonId, session_token]);
      }
      res.json({ success: true, message: 'Logged out successfully.' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Logout error.' });
    }
  });

  // Salon Visits Routes
  app.post('/api/salon/visit/:salon_id', async (req, res) => {
    try {
      const salonId = req.params.salon_id;
      if (!salonId || isNaN(Number(salonId))) {
        return res.status(400).json({ success: false, message: 'Invalid salon ID' });
      }
      
      const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      const userAgent = req.headers['user-agent'];
      
      await dbRun(
        'INSERT INTO salon_visits (salon_id, ip_address, user_agent) VALUES ($1, $2, $3)',
        [salonId, ip, userAgent]
      );
      
      res.json({ success: true, message: 'Visit recorded' });
    } catch (error) {
      console.error('Error recording visit:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/salon/visits/:salon_id', async (req, res) => {
    try {
      const salonId = req.params.salon_id;
      if (!salonId || isNaN(Number(salonId))) {
        return res.status(400).json({ success: false, message: 'Invalid salon ID' });
      }
      
      const result = await dbGet(
        'SELECT COUNT(*) as count FROM salon_visits WHERE salon_id = $1',
        [salonId]
      );
      
      res.json({ success: true, count: result ? result.count : 0 });
    } catch (error) {
      console.error('Error getting visits:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // ==========================================
  // GALLERY FEATURES
  // ==========================================

  // Helper to upload gallery image
  async function uploadGalleryImage(buffer, salonId) {
      try {
          const timestamp = Date.now();
          const randomId = crypto.randomBytes(6).toString('hex');
          const filename = `gallery_${salonId}_${timestamp}_${randomId}.webp`;
          
          let optimizedBuffer;
          try {
              optimizedBuffer = await sharp(buffer)
                  .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                  .webp({ quality: 80 })
                  .toBuffer();
          } catch (sharpErr) {
              console.error('Sharp optimization error:', sharpErr);
              throw new Error(`Image processing failed: ${sharpErr.message}`);
          }
          
          const { data, error } = await supabase.storage
            .from('gallery-images')
            .upload(filename, optimizedBuffer, {
                contentType: 'image/webp',
                cacheControl: '31536000',
                upsert: false
            });
        
        if (error) {
            console.error('Supabase upload error details:', error);
            throw new Error(`Storage upload failed: ${error.message || 'Unknown storage error'}`);
        }
        
        const { data: urlData } = supabase.storage
            .from('gallery-images')
            .getPublicUrl(filename);
              
          return urlData.publicUrl;
      } catch (error) {
          console.error('Gallery upload helper error:', error);
          throw error;
      }
  }

  // Get Gallery Images
  app.get('/api/salon/gallery/:salon_id', async (req, res) => {
      try {
          const salonId = req.params.salon_id;
          const rows = await dbAll('SELECT * FROM salon_gallery WHERE salon_id = $1 ORDER BY created_at DESC', [salonId]);
          res.json({ success: true, images: rows });
      } catch (e) {
          res.status(500).json({ success: false, message: 'Server error' });
      }
  });

  // Add Gallery Image
  app.post('/api/salon/gallery/:salon_id', requireSalonAdminRole, upload.single('image'), async (req, res) => {
      try {
          const salonId = Number(req.params.salon_id);
          const { category, title } = req.body;
          
          if (!req.file) {
              return res.status(400).json({ success: false, message: 'Image is required' });
          }

          const imageUrl = await uploadGalleryImage(req.file.buffer, salonId);
          
          const result = await dbGet(
              'INSERT INTO salon_gallery (salon_id, image_url, category, title) VALUES ($1, $2, $3, $4) RETURNING id, salon_id, image_url, category, title, created_at',
              [salonId, imageUrl, category || null, title || null]
          );
          
          res.json({ success: true, image: result });
      } catch (e) {
          console.error('Gallery add error:', e);
          res.status(500).json({ success: false, message: 'Server error', details: e.message });
      }
  });

  // Delete Gallery Image
  app.delete('/api/salon/gallery/:salon_id/:image_id', requireSalonAdminRole, async (req, res) => {
      try {
          const { salon_id, image_id } = req.params;
          
          // Get image URL first to delete from Supabase
          const image = await dbGet('SELECT image_url FROM salon_gallery WHERE id = $1 AND salon_id = $2', [image_id, salon_id]);
          
          if (image && image.image_url && image.image_url.includes('supabase')) {
              try {
                  const filename = image.image_url.split('/').pop();
                  await supabase.storage
                      .from('gallery-images')
                      .remove([filename]);
              } catch (storageErr) {
                  console.warn('Failed to delete gallery image from storage:', storageErr);
                  // Continue to delete from DB even if storage delete fails
              }
          }

          await dbRun('DELETE FROM salon_gallery WHERE id = $1 AND salon_id = $2', [image_id, salon_id]);
          res.json({ success: true });
      } catch (e) {
          res.status(500).json({ success: false, message: 'Server error' });
      }
  });
}
