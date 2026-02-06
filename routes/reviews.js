const express = require('express');

module.exports = function register(app, deps) {
  const { dbAll, dbGet, dbRun, requireAuth, upload, supabase, crypto, sharp } = deps;

  // Helper to upload review image
  async function uploadReviewImage(buffer, salonId) {
      try {
          const timestamp = Date.now();
          const randomId = crypto.randomBytes(6).toString('hex');
          const filename = `review_${salonId}_${timestamp}_${randomId}.webp`;
          
          const optimizedBuffer = await sharp(buffer)
              .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 80 })
              .toBuffer();
          
          const { data, error } = await supabase.storage
              .from('salon-images')
              .upload(filename, optimizedBuffer, {
                  contentType: 'image/webp',
                  cacheControl: '31536000',
                  upsert: false
              });
          
          if (error) throw error;
          
          const { data: urlData } = supabase.storage
              .from('salon-images')
              .getPublicUrl(filename);
              
          return urlData.publicUrl;
      } catch (error) {
          console.error('Review image upload error:', error);
          throw error;
      }
  }

  app.get('/api/reviews/user/:user_id', requireAuth, (req, res) => {
    const user_id = req.params.user_id;
    const q = `SELECT r.id, r.salon_id, r.user_id, r.rating, r.comment, r.date_posted, r.image_url,
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
    const q = `SELECT r.id, r.salon_id, r.user_id, r.rating, r.comment, r.date_posted, r.image_url,
                      u.name AS user_name
               FROM reviews r LEFT JOIN users u ON u.id = r.user_id
               WHERE r.salon_id = $1 ORDER BY r.date_posted DESC`;
    dbAll(q, [salon_id]).then(rows => {
      res.json({ success: true, reviews: rows });
    }).catch(err => {
      res.status(500).json({ success: false, message: 'Database error.' });
    });
  });

  app.get('/api/reviews/check-eligibility/:salon_id', requireAuth, async (req, res) => {
    const userId = req.user?.id;
    const salonId = req.params.salon_id;
    
    if (!userId || !salonId) {
        return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    try {
        // 1. Check user type
        const user = await dbGet('SELECT user_type FROM users WHERE id = $1', [userId]);
        if (user && user.user_type === 'salon') {
            return res.json({ eligible: false, reason: 'salon_user' });
        }

        // 2. Check last review
        const lastReview = await dbGet('SELECT date_posted FROM reviews WHERE user_id = $1 AND salon_id = $2 ORDER BY id DESC LIMIT 1', [userId, salonId]);
        
        if (lastReview) {
            const lastDate = new Date(lastReview.date_posted);
            const now = new Date();
            const diffTime = Math.abs(now - lastDate);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // Use floor to get full days passed
            
            if (diffDays < 20) {
                 return res.json({ eligible: false, reason: 'time_limit', days_left: 20 - diffDays });
            }
        }

        res.json({ eligible: true });
    } catch (err) {
        console.error('Eligibility check error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  app.post('/api/reviews/submit', requireAuth, upload.single('image'), async (req, res) => {
    const salon_id = req.body?.salon_id;
    const rating = req.body?.rating;
    const comment = req.body?.comment || '';
    const user_id = req.user?.id;
    
    if (!user_id || !salon_id || !rating) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }
    if (Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
    }

    try {
      // 1. Check user type
      const user = await dbGet('SELECT user_type FROM users WHERE id = $1', [user_id]);
      if (user && user.user_type === 'salon') {
          return res.status(403).json({ success: false, message: 'Salon accounts cannot submit reviews.' });
      }

      // 2. Check time limit
      const lastReview = await dbGet('SELECT date_posted FROM reviews WHERE user_id = $1 AND salon_id = $2 ORDER BY id DESC LIMIT 1', [user_id, salon_id]);
      if (lastReview) {
          const lastDate = new Date(lastReview.date_posted);
          const now = new Date();
          const diffDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
          
          if (diffDays < 20) {
              return res.status(403).json({ success: false, message: `You can only review this salon once every 20 days. ${20 - diffDays} days left.` });
          }
      }

      let imageUrl = null;
      if (req.file) {
          imageUrl = await uploadReviewImage(req.file.buffer, salon_id);
      }

      const inserted = await dbGet(
        `INSERT INTO reviews (user_id, salon_id, rating, comment, date_posted, image_url)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [user_id, salon_id, rating, comment, new Date().toISOString(), imageUrl]
      );
      res.json({ success: true, message: 'Review submitted successfully.', review_id: inserted.id });
    } catch (err) {
      console.error('Review submit error:', err);
      res.status(500).json({ success: false, message: 'Failed to submit review.' });

    }
  });

  app.delete('/api/reviews/:id', requireAuth, async (req, res) => {
    const authUserId = req.user?.id;
    const reviewId = req.params.id;
    
    if (!authUserId || !reviewId) {
      return res.status(400).json({ success: false, message: 'Invalid request.' });
    }

    try {
      const result = await dbRun(`DELETE FROM reviews WHERE id = $1 AND user_id = $2`, [reviewId, authUserId]);
      
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: 'Review not found or not authorized.' });
      }
      res.json({ success: true, message: 'Review deleted successfully.' });
    } catch (err) {
      console.error('Delete review error:', err);
      res.status(500).json({ success: false, message: 'Database error occurred while deleting review.' });
    }
  });
}
