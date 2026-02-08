module.exports = function registerProductsRoutes(app, deps) {
    const { 
        db, dbAll, dbGet, dbRun, 
        requireSalonAdminRole, 
        upload, sharp, supabase, crypto 
    } = deps;

    // Helper to upload image to Supabase
    async function uploadProductImage(buffer, salonId) {
        try {
            const timestamp = Date.now();
            const randomId = crypto.randomBytes(6).toString('hex');
            const filename = `product_${salonId}_${timestamp}_${randomId}.webp`;
            
            // Resize and convert to WebP
            const optimizedBuffer = await sharp(buffer)
                .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 80 })
                .toBuffer();
            
            const { data, error } = await supabase.storage
                .from('product-images')
                .upload(filename, optimizedBuffer, {
                    contentType: 'image/webp',
                    cacheControl: '31536000',
                    upsert: false
                });
            
            if (error) {
                console.error('Supabase upload error:', error);
                throw error;
            }
            
            const { data: urlData } = supabase.storage
                .from('product-images')
                .getPublicUrl(filename);
                
            return urlData.publicUrl;
        } catch (error) {
            console.error('Image upload helper error:', error);
            throw error;
        }
    }

    // === CATEGORIES ===
    // Predefined categories are handled on frontend.
    // Database table `product_categories` has been removed.

    // === PRODUCTS ===

    // Get all products for a salon
    app.get('/api/products/:salon_id', async (req, res) => {
        try {
            const salonId = req.params.salon_id;
            const { category } = req.query;
            
            let sql = `
                SELECT p.*
                FROM products p
                WHERE p.salon_id = $1
            `;
            const params = [salonId];

            if (category && category !== 'all') {
                sql += ' AND p.category = $2';
                params.push(category);
            }

            sql += ' ORDER BY p.created_at DESC';

            const rows = await dbAll(sql, params);
            res.json({ success: true, products: rows });
        } catch (error) {
            console.error('Get products error:', error);
            res.status(500).json({ success: false, message: 'Database error' });
        }
    });

    // Create a new product
    app.post('/api/products/:salon_id', requireSalonAdminRole, upload.single('image'), async (req, res) => {
        try {
            const { salon_id, category, name, description, price, currency } = req.body;
            
            if (!salon_id || !name || !price) {
                return res.status(400).json({ success: false, message: 'Missing required fields' });
            }

            // Enforce Image Requirement
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'Image is required for new products' });
            }

            let imageUrl = await uploadProductImage(req.file.buffer, salon_id);

            const result = await dbGet(
                `INSERT INTO products 
                (salon_id, category, name, description, price, currency, image_url) 
                VALUES ($1, $2, $3, $4, $5, $6, $7) 
                RETURNING *`,
                [
                    salon_id, 
                    category || 'other', 
                    name, 
                    description, 
                    price, 
                    currency || 'ILS', 
                    imageUrl
                ]
            );

            res.json({ success: true, product: result });
        } catch (error) {
            console.error('Create product error:', error);
            res.status(500).json({ success: false, message: 'Database error' });
        }
    });

    // Update a product
    app.put('/api/products/:salon_id/:id', requireSalonAdminRole, upload.single('image'), async (req, res) => {
        try {
            const id = req.params.id;
            const { category, name, description, price, currency, is_active } = req.body;
            
            // First get existing product to handle image replacement
            const existing = await dbGet('SELECT image_url FROM products WHERE id = $1', [id]);
            if (!existing) {
                return res.status(404).json({ success: false, message: 'Product not found' });
            }

            let imageUrl = existing.image_url;
            if (req.file) {
                // Upload new image
                imageUrl = await uploadProductImage(req.file.buffer, req.body.salon_id);
                
                // Delete old image if exists
                if (existing.image_url && existing.image_url.includes('supabase')) {
                    try {
                        const filename = existing.image_url.split('/').pop();
                        await supabase.storage
                            .from('product-images')
                            .remove([filename]);
                    } catch (e) {
                        console.warn('Failed to delete old product image:', e);
                    }
                }
            }

            const result = await dbGet(
                `UPDATE products 
                SET category = $1, name = $2, description = $3, price = $4, currency = $5, image_url = $6, is_active = $7, updated_at = CURRENT_TIMESTAMP
                WHERE id = $8
                RETURNING *`,
                [
                    category || 'other',
                    name,
                    description,
                    price,
                    currency,
                    imageUrl,
                    is_active,
                    id
                ]
            );

            res.json({ success: true, product: result });
        } catch (error) {
            console.error('Update product error:', error);
            res.status(500).json({ success: false, message: 'Database error' });
        }
    });

    // Delete a product
    app.delete('/api/products/:salon_id/:id', requireSalonAdminRole, async (req, res) => {
        try {
            const id = req.params.id;
            
            // Delete image from storage
            const product = await dbGet('SELECT image_url FROM products WHERE id = $1', [id]);
            if (product && product.image_url && product.image_url.includes('supabase')) {
                try {
                    const filename = product.image_url.split('/').pop();
                    await supabase.storage
                        .from('product-images')
                        .remove([filename]);
                } catch (e) {
                    console.warn('Failed to delete product image:', e);
                }
            }

            await dbRun('DELETE FROM products WHERE id = $1', [id]);
            res.json({ success: true });
        } catch (error) {
            console.error('Delete product error:', error);
            res.status(500).json({ success: false, message: 'Database error' });
        }
    });
};
