module.exports = function register(app, deps) {
  const { dbAll, dbGet, dbRun, requireAuth, bookingSchema, validateBookingSlot, sendSalonEvent, sendPushToTargets } = deps;

  app.get('/api/salon/appointments/:salon_id/:filter', async (req, res) => {
    try {
      const { salon_id, filter } = req.params;
      if (!salon_id || salon_id === 'undefined' || isNaN(parseInt(salon_id))) {
        return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
      }
      const now = new Date().toISOString();
      let whereClause = '';
      let params = [salon_id];
      let orderBy = 'ASC';
      if (filter === 'today') {
        const today = new Date().toISOString().split('T')[0];
        whereClause = `AND DATE(a.start_time) = $2 AND a.status = 'Scheduled'`;
        params.push(today);
        orderBy = 'ASC';
      } else if (filter === 'completed') {
        whereClause = `AND (a.status = 'Completed' OR a.status = 'Absent')`;
        orderBy = 'DESC';
      } else if (filter === 'upcoming') {
        whereClause = `AND a.start_time > $2 AND a.status = 'Scheduled'`;
        params.push(now);
        orderBy = 'ASC';
      } else if (filter === 'past') {
        whereClause = `AND a.start_time <= $2 AND a.status <> 'Cancelled' AND a.status <> 'Completed'`;
        params.push(now);
        orderBy = 'DESC';
      } else if (filter === 'cancelled') {
        whereClause = `AND a.status = 'Cancelled'`;
        orderBy = 'DESC';
      } else {
        return res.status(400).json({ success: false, message: 'Invalid filter.' });
      }
      const sql = `
        SELECT 
          a.id, a.start_time, a.end_time, a.status, a.price,
          u.name AS user_name, u.phone AS user_phone,
          s.name_ar AS service_name,
          st.name AS staff_name
        FROM appointments a
        JOIN users u ON a.user_id = u.id
        JOIN services s ON a.service_id = s.id
        LEFT JOIN staff st ON a.staff_id = st.id
        WHERE a.salon_id = $1 ${whereClause}
        ORDER BY a.start_time ${orderBy}
      `;
      const rows = await dbAll(sql, params);
      const appointmentsWithServices = await Promise.all(rows.map(async (appointment) => {
        try {
          const servicesQuery = `
            SELECT s.name_ar, aps.price 
            FROM appointment_services aps
            JOIN services s ON aps.service_id = s.id
            WHERE aps.appointment_id = $1
          `;
          const services = await dbAll(servicesQuery, [appointment.id]);
          return { ...appointment, all_services: services, services_names: services.map(s => s.name_ar).join(' + ') };
        } catch {
          return { ...appointment, all_services: [], services_names: appointment.service_name || 'خدمة غير محددة' };
        }
      }));
      res.json({ success: true, appointments: appointmentsWithServices });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Database error during appointment fetch: ' + err.message });
    }
  });

  app.get('/api/salon/:salon_id/appointments/:date', async (req, res) => {
    const { salon_id, date } = req.params;
    if (!salon_id || salon_id === 'undefined' || isNaN(parseInt(salon_id))) {
      return res.status(400).json({ success: false, message: 'Salon ID is required and must be valid.' });
    }
    if (!date || date === 'null' || date === 'undefined') {
      return res.status(400).json({ success: false, message: 'Date is required and must be valid.' });
    }
    const sql = `
      SELECT id, start_time, end_time, staff_id, status
      FROM appointments
      WHERE salon_id = $1 AND DATE(start_time) = $2
      AND status = 'Scheduled'
    `;
    try {
      const rows = await dbAll(sql, [salon_id, date]);
      res.json({ success: true, appointments: rows });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.post('/api/salon/appointment/status/:appointment_id', async (req, res) => {
    const appointmentId = req.params.appointment_id;
    const { status } = req.body;
    if (!['Completed', 'Cancelled', 'Absent'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status provided.' });
    }
    try {
      const getAppointmentQuery = 'SELECT user_id, salon_id, status FROM appointments WHERE id = $1';
      const appointment = await dbGet(getAppointmentQuery, [appointmentId]);
      if (!appointment) {
        return res.status(404).json({ success: false, message: 'Appointment not found.' });
      }
      if (appointment.status !== 'Scheduled') {
        return res.status(400).json({ success: false, message: `لا يمكن تغيير حالة موعد تم تحديده مسبقاً كـ "${appointment.status}"` });
      }
      await dbRun('UPDATE appointments SET status = $1 WHERE id = $2', [status, appointmentId]);
      if (global.broadcastToSalon) {
        global.broadcastToSalon(appointment.salon_id, 'appointment_status_updated', { appointmentId, status, user_id: appointment.user_id });
      }
      if (global.broadcastToUser) {
        global.broadcastToUser(appointment.user_id, 'appointment_status_updated', { appointmentId, status });
      }
      if (status === 'Absent') {
        await dbRun('UPDATE users SET strikes = strikes + 1 WHERE id = $1', [appointment.user_id]);
        res.json({ success: true, message: 'تم تحديث حالة الموعد وإضافة إنذار للمستخدم' });
      } else {
        res.json({ success: true, message: `تم تحديث حالة الموعد إلى ${status === 'Completed' ? 'مكتمل' : 'ملغي'}` });
      }
    } catch {
      return res.status(500).json({ success: false, message: 'Database error.' });
    }
  });

  app.get('/api/appointments/user/:user_id/:filter', requireAuth, async (req, res) => {
    const { user_id, filter } = req.params;
    const authUserId = req.user && req.user.id;
    if (!authUserId || String(authUserId) !== String(user_id)) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بعرض هذه المواعيد.' });
    }
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    let whereClause = '';
    let params = [authUserId];
    let orderBy = 'DESC';
    if (!user_id || user_id === 'undefined' || isNaN(parseInt(user_id))) {
      return res.status(400).json({ success: false, message: 'User ID is required and must be valid.' });
    }
    if (filter === 'upcoming') {
      whereClause = `AND a.start_time > $2 AND a.status = 'Scheduled'`;
      params.push(now);
      orderBy = 'ASC';
    } else if (filter === 'past') {
      whereClause = `AND a.start_time <= $2`;
      params.push(now);
      orderBy = 'DESC';
    } else {
      return res.status(400).json({ success: false, message: 'Invalid filter.' });
    }
    const sql = `
      SELECT 
        a.id, a.start_time, a.end_time, a.status, a.price,
        s.salon_name,
        serv.name_ar AS service_name,
        st.name AS staff_name
      FROM appointments a
      JOIN salons s ON a.salon_id = s.id
      JOIN services serv ON a.service_id = serv.id
      LEFT JOIN staff st ON a.staff_id = st.id
      WHERE a.user_id = $1 ${whereClause}
      ORDER BY a.start_time ${orderBy}
    `;
    try {
      const rows = await dbAll(sql, params);
      const appointmentsWithServices = await Promise.all(rows.map(async (appointment) => {
        try {
          const servicesQuery = `
            SELECT s.name_ar, aps.price 
            FROM appointment_services aps
            JOIN services s ON aps.service_id = s.id
            WHERE aps.appointment_id = $1
          `;
          const services = await dbAll(servicesQuery, [appointment.id]);
          return { ...appointment, all_services: services, services_names: services.length > 0 ? services.map(s => s.name_ar).join(' + ') : appointment.service_name };
        } catch {
          return { ...appointment, all_services: [], services_names: appointment.service_name || 'خدمة غير محددة' };
        }
      }));
      res.json({ success: true, appointments: appointmentsWithServices });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error during appointment fetch.' });
    }
  });

  app.post('/api/appointments/cancel/:appointment_id', requireAuth, async (req, res) => {
    const appointmentId = req.params.appointment_id;
    const minNoticeHours = 3;
    const authUserId = req.user && req.user.id;
    if (!authUserId || isNaN(parseInt(authUserId))) {
      return res.status(401).json({ success: false, message: 'يرجى تسجيل الدخول.' });
    }
    try {
      const row = await dbGet('SELECT salon_id, start_time, status, user_id FROM appointments WHERE id = $1', [appointmentId]);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Appointment not found.' });
      }
      if (row.status !== 'Scheduled') {
        return res.status(400).json({ success: false, message: 'لا يمكن إلغاء موعد حالته ليست "مؤكد".' });
      }
      if (String(row.user_id) !== String(authUserId)) {
        return res.status(403).json({ success: false, message: 'غير مصرح لك بإلغاء هذا الموعد.' });
      }
      const appointmentTime = new Date(row.start_time).getTime();
      const nowMs = new Date().getTime();
      const noticePeriodMs = minNoticeHours * 60 * 60 * 1000;
      if (appointmentTime - nowMs < noticePeriodMs) {
        await dbRun('UPDATE appointments SET status = $1 WHERE id = $2', ['Cancelled', appointmentId]);
        const strikeResult = await dbGet('UPDATE users SET strikes = strikes + 1 WHERE id = $1 RETURNING strikes', [authUserId]);
        const newStrikes = strikeResult ? strikeResult.strikes : null;
        await sendSalonEvent(row.salon_id, 'appointment_cancelled', { appointmentId, user_id: authUserId, start_time: row.start_time, late: true, strikes: newStrikes });
        const appointmentDate = new Date(row.start_time);
        const todayLocal = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
        if (appointmentDate.toDateString() === todayLocal.toDateString()) {
          await sendPushToTargets({ salon_id: row.salon_id, payload: { title: 'إلغاء موعد متأخر', body: `تم إلغاء موعد قريب بتاريخ ${appointmentDate.toLocaleDateString('ar-EG')} على الساعة ${appointmentDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })}`, url: '/home_salon.html#appointments' } });
        }
        return res.status(200).json({ success: true, message: `تم إلغاء الموعد. تم إضافة إنذار لحسابك${newStrikes != null ? ` (الإنذارات: ${newStrikes}/3)` : ''} لأن الإلغاء كان متأخراً.`, strikeIssued: true });
      }
      await dbRun('UPDATE appointments SET status = $1 WHERE id = $2', ['Cancelled', appointmentId]);
      await sendSalonEvent(row.salon_id, 'appointment_cancelled', { appointmentId, user_id: authUserId, start_time: row.start_time, late: false });
      const appointmentDate2 = new Date(row.start_time);
      const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
      if (appointmentDate2.toDateString() === nowLocal.toDateString()) {
        await sendPushToTargets({ salon_id: row.salon_id, payload: { title: 'تم إلغاء موعد', body: `تم إلغاء موعد بتاريخ ${appointmentDate2.toLocaleDateString('ar-EG')} على الساعة ${appointmentDate2.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })}`, url: '/home_salon.html#appointments' } });
      }
      res.json({ success: true, message: 'تم إلغاء الموعد بنجاح.' });
    } catch {
      return res.status(500).json({ success: false, message: 'Database error during cancellation.' });
    }
  });

  app.post('/api/appointment/book', requireAuth, async (req, res) => {
    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'بيانات الحجز غير صالحة.' });
    }
    const { salon_id, staff_id, service_id, services, start_time, end_time, price } = parsed.data;
    const user_id = req.user?.id;
    if (!salon_id || !user_id || !start_time || !end_time || price === undefined) {
      return res.status(400).json({ success: false, message: 'بيانات الحجز غير كاملة.' });
    }
    let servicesToBook = [];
    if (services && Array.isArray(services) && services.length > 0) {
      servicesToBook = services;
    } else if (service_id) {
      try {
        const serviceDetails = await dbGet('SELECT id, name_ar FROM services WHERE id = $1', [service_id]);
        if (serviceDetails) {
          servicesToBook = [{ id: service_id, price: price }];
        }
      } catch {
        return res.status(400).json({ success: false, message: 'خدمة غير صالحة.' });
      }
    }
    if (servicesToBook.length === 0) {
      return res.status(400).json({ success: false, message: 'يجب اختيار خدمة واحدة على الأقل.' });
    }
    let totalServiceDuration = 0;
    try {
      for (const service of servicesToBook) {
        const serviceDetails = await dbGet('SELECT duration FROM salon_services WHERE salon_id = $1 AND service_id = $2', [salon_id, service.id]);
        if (serviceDetails && serviceDetails.duration) {
          totalServiceDuration += serviceDetails.duration;
        }
      }
    } catch {
      return res.status(400).json({ success: false, message: 'خطأ في حساب مدة الخدمات.' });
    }
    const validationResult = await validateBookingSlot(salon_id, staff_id, start_time, end_time, totalServiceDuration);
    if (!validationResult.valid) {
      return res.status(400).json({ success: false, message: validationResult.message });
    }
    const mainServiceId = servicesToBook[0].id;
    let finalStaffId = staff_id;
    let assignedStaffName = null;
    if (finalStaffId === 0) {
      try {
        const allStaff = await dbAll('SELECT id, name FROM staff WHERE salon_id = $1', [salon_id]);
        const newApptStart = new Date(start_time).getTime();
        const newApptEnd = new Date(end_time).getTime();
        let foundAvailableStaff = null;
        for (const staffMember of allStaff) {
          const staffAppointments = await dbAll('SELECT start_time, end_time FROM appointments WHERE salon_id = $1 AND staff_id = $2 AND status = \"Scheduled\"', [salon_id, staffMember.id]);
          let isAvailable = true;
          for (const appt of staffAppointments) {
            const existingApptStart = new Date(appt.start_time).getTime();
            const existingApptEnd = new Date(appt.end_time).getTime();
            if (newApptStart < existingApptEnd && newApptEnd > existingApptStart) {
              isAvailable = false;
              break;
            }
          }
          if (isAvailable) { foundAvailableStaff = staffMember; break; }
        }
        if (foundAvailableStaff) { finalStaffId = foundAvailableStaff.id; assignedStaffName = foundAvailableStaff.name; }
        else { return res.status(400).json({ success: false, message: 'عفواً، لا يوجد مختص متاح لإتمام هذا الحجز في هذا الوقت.' }); }
      } catch {
        return res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات أثناء تحديد المختص.' });
      }
    } else {
      if (finalStaffId !== null) {
        try {
          const staffResult = await dbGet('SELECT name FROM staff WHERE id = $1', [finalStaffId]);
          assignedStaffName = staffResult ? staffResult.name : 'غير محدد';
        } catch {
          assignedStaffName = 'غير محدد';
        }
      }
    }
    const staffIdForDB = finalStaffId === 0 ? null : finalStaffId;
    const date_booked = new Date().toISOString();
    const status = 'Scheduled';
    try {
      const appointmentResult = await dbGet('INSERT INTO appointments (salon_id, user_id, staff_id, service_id, start_time, end_time, status, date_booked, price) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id', [salon_id, req.user.id, staffIdForDB, mainServiceId, start_time, end_time, status, date_booked, price]);
      const appointmentId = appointmentResult.id;
      for (const service of servicesToBook) {
        await dbRun('INSERT INTO appointment_services (appointment_id, service_id, price) VALUES ($1, $2, $3)', [appointmentId, service.id, service.price]);
      }
      await sendSalonEvent(salon_id, 'appointment_booked', { appointmentId, user_id: req.user.id, staff_id: staffIdForDB, staff_name: assignedStaffName, start_time, end_time, services_count: servicesToBook.length, price });
      const appointmentDate = new Date(start_time);
      const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
      if (appointmentDate.toDateString() === nowLocal.toDateString()) {
        await sendPushToTargets({ salon_id, payload: { title: 'حجز جديد', body: `لديك حجز جديد بتاريخ ${appointmentDate.toLocaleDateString('ar-EG')} على الساعة ${appointmentDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })}`, url: '/home_salon.html#appointments' } });
      }
      res.json({ success: true, message: 'تم حجز موعدك بنجاح!', appointmentId, assignedStaffName, servicesCount: servicesToBook.length });
    } catch {
      return res.status(500).json({ success: false, message: 'فشل في حفظ الحجز.' });
    }
  });
}