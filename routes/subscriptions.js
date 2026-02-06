const express = require('express');

module.exports = function register(app, deps) {
    const { dbAll, dbGet, dbRun, requireAuth, requireAdmin } = deps;

    // Helper to get current month start/end dates
    const getCurrentMonthDates = () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0],
            monthStr: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        };
    };

    // --- Salon Endpoints ---

    // Get subscription status for the current month
    app.get('/api/subscriptions/status', requireAuth, async (req, res) => {
        const salonId = req.user.id;
        const { start, end, monthStr } = getCurrentMonthDates();

        try {
            // Check for any payment covering this month (valid_from <= end AND valid_until >= start)
            // Or specifically a 'monthly_subscription' for this month
            // We'll look for a payment record created for this month or valid for this month
            
            // Logic: Look for the most recent payment for this month
            const payment = await dbGet(
                `SELECT * FROM payments 
                 WHERE salon_id = $1 
                 AND (
                    (valid_from <= $2 AND valid_until >= $3)
                    OR
                    (description LIKE $4)
                 )
                 ORDER BY created_at DESC LIMIT 1`,
                [salonId, end, start, `%${monthStr}%`]
            );

            if (!payment) {
                return res.json({ 
                    success: true, 
                    status: 'unpaid', 
                    month: monthStr 
                });
            }

            // Map payment_status to our UI status
            // payment_status: 'completed' -> 'paid', 'pending' -> 'pending', 'failed' -> 'unpaid'
            let status = 'unpaid';
            if (payment.payment_status === 'completed') status = 'paid';
            else if (payment.payment_status === 'pending') status = 'pending';

            res.json({ 
                success: true, 
                status: status, 
                payment: payment,
                month: monthStr
            });

        } catch (err) {
            console.error('Error getting subscription status:', err);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Notify payment (Mark as pending)
    app.post('/api/subscriptions/notify-payment', requireAuth, async (req, res) => {
        const salonId = req.user.id;
        const { payment_method } = req.body; // 'reflect' or 'bank'
        const { start, end, monthStr } = getCurrentMonthDates();

        if (!['reflect', 'bank'].includes(payment_method)) {
            return res.status(400).json({ success: false, message: 'Invalid payment method' });
        }

        try {
            // Check if already exists
            const existing = await dbGet(
                `SELECT id, payment_status FROM payments 
                 WHERE salon_id = $1 
                 AND description LIKE $2 
                 AND payment_status IN ('completed', 'pending')
                 LIMIT 1`,
                [salonId, `%${monthStr}%`]
            );

            if (existing) {
                if (existing.payment_status === 'completed') {
                    return res.status(400).json({ success: false, message: 'Already paid for this month.' });
                }
                if (existing.payment_status === 'pending') {
                    return res.status(400).json({ success: false, message: 'Payment verification is already pending.' });
                }
            }

            // Create pending payment record
            // Default amount? 200 ILS? Or 0 until confirmed? 
            // We'll set a placeholder amount or 0.
            const amount = 0; 
            const invoiceNumber = `INV-${Date.now()}-${salonId}`;
            
            await dbRun(
                `INSERT INTO payments (
                    salon_id, payment_type, amount, currency, payment_status, 
                    payment_method, description, valid_from, valid_until, created_at,
                    invoice_number
                ) VALUES ($1, 'monthly_subscription', $2, 'ILS', 'pending', $3, $4, $5, $6, CURRENT_TIMESTAMP, $7)`,
                [
                    salonId, 
                    amount, 
                    payment_method, 
                    `Monthly Subscription ${monthStr}`,
                    start,
                    end,
                    invoiceNumber
                ]
            );

            res.json({ success: true, message: 'Payment notification sent', status: 'pending' });
        } catch (err) {
            console.error('Error notifying payment:', err);
            
            // Handle Foreign Key Violation (e.g. Salon Deleted)
            if (err.code === '23503' && err.constraint === 'payments_salon_id_fkey') {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Salon account not found. Please log in again.' 
                });
            }

            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // --- Admin Endpoints ---

    // Admin: Get all actual subscriptions (not just pending payments)
    app.get('/api/admin/subscriptions/all', requireAdmin, async (req, res) => {
        try {
            const subs = await dbAll('SELECT * FROM subscriptions ORDER BY created_at DESC');
            res.json({ success: true, subscriptions: subs });
        } catch (err) {
            console.error('Error fetching all subscriptions:', err);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Admin: Get pending subscriptions
    app.get('/api/admin/subscriptions', requireAdmin, async (req, res) => {
        
        const status = req.query.status || 'pending';

        try {
            const payments = await dbAll(
                `SELECT p.*, s.salon_name, s.owner_name, s.salon_phone 
                 FROM payments p
                 JOIN salons s ON p.salon_id = s.id
                 WHERE p.payment_status = $1 
                 AND p.payment_type = 'monthly_subscription'
                 ORDER BY p.created_at DESC`,
                [status]
            );

            res.json({ success: true, subscriptions: payments });
        } catch (err) {
            console.error('Error fetching admin subscriptions:', err);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Update subscription status (Approve/Reject)
    app.post('/api/admin/subscriptions/update', requireAdmin, async (req, res) => {
        const { id, status, amount } = req.body; // id is payment id
        
        if (!['completed', 'failed', 'pending'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        try {
            // Update payment record
            await dbRun(
                `UPDATE payments 
                 SET payment_status = $1, amount = COALESCE($2, amount), updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $3`,
                [status, amount, id]
            );

            // If completed, update/create subscription
            if (status === 'completed') {
                const payment = await dbGet('SELECT * FROM payments WHERE id = $1', [id]);
                if (payment) {
                    const existingSub = await dbGet('SELECT id FROM subscriptions WHERE salon_id = $1', [payment.salon_id]);
                    if (existingSub) {
                        await dbRun(
                            `UPDATE subscriptions SET status = 'active', end_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                            [payment.valid_until, existingSub.id]
                        );
                    } else {
                        await dbRun(
                            `INSERT INTO subscriptions (salon_id, package, start_date, end_date, status)
                             VALUES ($1, 'monthly_100', $2, $3, 'active')`,
                            [payment.salon_id, payment.valid_from, payment.valid_until]
                        );
                    }
                }
            }

            res.json({ success: true, message: 'Status updated' });
        } catch (err) {
            console.error('Error updating subscription status:', err);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Admin: Create/Update Subscription for a salon manually
    app.post('/api/admin/subscriptions/:salonId', requireAdmin, async (req, res) => {
        const { salonId } = req.params;
        const { type, startDate, endDate, amount } = req.body;

        try {
             // Create payment record (Invoice)
             const description = type === 'offer' ? 'Gift Subscription' : 
                                 type === 'half_offer' ? '50% Offer Subscription' : 
                                 'Monthly Subscription';
             const invoiceNumber = `INV-${Date.now()}-${salonId}`;
             
             const paymentRes = await dbRun(
                `INSERT INTO payments (
                    salon_id, payment_type, amount, currency, payment_status, 
                    payment_method, description, valid_from, valid_until, created_at,
                    invoice_number
                ) VALUES ($1, 'monthly_subscription', $2, 'ILS', 'completed', 'admin_manual', $3, $4, $5, CURRENT_TIMESTAMP, $6)
                RETURNING id`,
                [salonId, amount, description, startDate, endDate, invoiceNumber]
            );
            
            // Create/Update Subscription
            const existingSub = await dbGet('SELECT id FROM subscriptions WHERE salon_id = $1', [salonId]);
            if (existingSub) {
                await dbRun(
                    `UPDATE subscriptions SET status = 'active', end_date = $1, package = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
                    [endDate, type, existingSub.id]
                );
            } else {
                 await dbRun(
                    `INSERT INTO subscriptions (salon_id, package, start_date, end_date, status)
                     VALUES ($1, $2, $3, $4, 'active')`,
                    [salonId, type, startDate, endDate]
                );
            }

            res.json({ success: true, message: 'Subscription created' });
        } catch (err) {
            console.error('Error creating admin subscription:', err);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Admin: Get all payments
    app.get('/api/admin/payments', requireAdmin, async (req, res) => {
         try {
             const payments = await dbAll(
                 `SELECT * FROM payments ORDER BY created_at DESC`
             );
             res.json({ success: true, payments });
         } catch (err) {
             console.error('Error getting all payments:', err);
             res.status(500).json({ success: false, message: 'Server error' });
         }
    });

    // Admin: Get payments for a specific salon
    app.get('/api/admin/salons/:salonId/payments', requireAdmin, async (req, res) => {
         const { salonId } = req.params;
         try {
             const payments = await dbAll(
                 `SELECT * FROM payments WHERE salon_id = $1 ORDER BY created_at DESC`,
                 [salonId]
             );
             res.json({ success: true, payments });
         } catch (err) {
             console.error('Error getting salon payments:', err);
             res.status(500).json({ success: false, message: 'Server error' });
         }
    });

    // Admin: Delete subscription
    app.delete('/api/admin/subscriptions/:id', requireAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            await dbRun('DELETE FROM subscriptions WHERE id = $1', [id]);
            res.json({ success: true, message: 'Subscription deleted' });
        } catch (err) {
            console.error('Error deleting subscription:', err);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Admin: Delete payment
    app.delete('/api/admin/payments/:id', requireAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            await dbRun('DELETE FROM payments WHERE id = $1', [id]);
            res.json({ success: true, message: 'Payment deleted' });
        } catch (err) {
            console.error('Error deleting payment:', err);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });
};
