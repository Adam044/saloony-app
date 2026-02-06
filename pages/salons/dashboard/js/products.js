
import { showMessage, showActionProgress, showActionSuccess, showToast } from './ui.js';
import { getRoleSessionToken } from './auth.js';

let currentSalonId = null;
let currentProducts = [];
let currentProductToEdit = null;

// Predefined Categories
const PRODUCT_CATEGORIES = [
    { id: 'hair_care', name: 'العناية بالشعر', icon: 'fa-pump-soap' },
    { id: 'skin_care', name: 'العناية بالبشرة', icon: 'fa-spa' },
    { id: 'styling_tools', name: 'أدوات التصفيف', icon: 'fa-wind' },
    { id: 'men', name: 'العناية بالرجل', icon: 'fa-mars' },
    { id: 'beard', name: 'العناية باللحية', icon: 'fa-user-tie' },
    { id: 'fragrance', name: 'عطور', icon: 'fa-spray-can' },
    { id: 'kits', name: 'مجموعات وهدايا', icon: 'fa-box-open' },
    { id: 'other', name: 'أخرى', icon: 'fa-tag' }
];

export const initProducts = async (salonId) => {
    currentSalonId = salonId;
    if (!currentSalonId) return;

    // Bind Add Product Button
    const addBtn = document.getElementById('add-product-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => openProductModal());
    }

    // Bind Category Dropdown
    const catBtn = document.getElementById('product-category-btn');
    if (catBtn) {
        catBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCategoryDropdown();
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('product-category-dropdown');
        const btn = document.getElementById('product-category-btn');
        if (dropdown && !dropdown.classList.contains('hidden') && !btn.contains(e.target) && !dropdown.contains(e.target)) {
            toggleCategoryDropdown();
        }
    });

    // Bind Modal Close Buttons
    const closeProdBtn = document.getElementById('close-product-modal-btn');
    if (closeProdBtn) closeProdBtn.addEventListener('click', closeProductModal);

    // Bind Form Submits
    const prodForm = document.getElementById('product-form');
    if (prodForm) prodForm.addEventListener('submit', handleProductSubmit);

    // Bind Image Preview
    const imgInput = document.getElementById('product-image-input');
    if (imgInput) {
        imgInput.addEventListener('change', handleImagePreview);
    }

    // Bind Category Filters
    const filterContainer = document.getElementById('product-categories-filter');
    if (filterContainer) {
        filterContainer.addEventListener('click', handleCategoryFilter);
    }

    // Load Data
    renderCategories(); // Static load
    renderCategoryOptions(); // Static load
    await loadProducts();
};

const loadProducts = async (categoryId = 'all') => {
    const loading = document.getElementById('products-loading');
    const grid = document.getElementById('products-grid');
    if (loading) loading.classList.remove('hidden');
    
    // Clear current grid (except loading)
    if (grid) {
        Array.from(grid.children).forEach(child => {
            if (child.id !== 'products-loading') child.remove();
        });
    }

    try {
        const res = await fetch(`/api/products/${currentSalonId}?category=${categoryId === 'all' ? '' : categoryId}`);
        const data = await res.json();
        
        if (data.success) {
            currentProducts = data.products;
            renderProducts(currentProducts);
        }
    } catch (error) {
        console.error('Failed to load products', error);
        showMessage('خطأ', 'تعذر تحميل المنتجات', 'error');
    } finally {
        if (loading) loading.classList.add('hidden');
    }
};

const renderCategories = () => {
    const container = document.getElementById('product-categories-filter');
    if (!container) return;
    
    // Keep the "All" button
    const allBtn = container.querySelector('[data-id="all"]');
    container.innerHTML = '';
    if (allBtn) container.appendChild(allBtn);

    PRODUCT_CATEGORIES.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'category-filter-btn px-4 py-2 rounded-lg bg-white text-slate-600 hover:bg-slate-100 text-sm font-bold transition-all whitespace-nowrap border border-slate-200 flex items-center gap-2';
        btn.dataset.id = cat.id;
        btn.innerHTML = `<i class="fas ${cat.icon}"></i> ${cat.name}`;
        container.appendChild(btn);
    });
};

const renderCategoryOptions = () => {
    const dropdown = document.getElementById('product-category-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '';
    PRODUCT_CATEGORIES.forEach(cat => {
        const item = document.createElement('div');
        item.className = 'px-4 py-3 hover:bg-pink-50 cursor-pointer flex items-center gap-3 text-slate-600 hover:text-secondary transition-colors border-b border-gray-50 last:border-0 group';
        item.dataset.value = cat.id;
        item.innerHTML = `
            <div class="w-8 h-8 rounded-lg bg-gray-50 text-gray-400 flex items-center justify-center group-hover:bg-white group-hover:text-secondary group-hover:shadow-sm transition-all">
                <i class="fas ${cat.icon}"></i>
            </div>
            <span class="font-medium">${cat.name}</span>
        `;
        
        item.addEventListener('click', () => {
            selectCategory(cat.id);
            toggleCategoryDropdown();
        });
        
        dropdown.appendChild(item);
    });
};

const selectCategory = (id) => {
    const input = document.getElementById('product-category');
    const textSpan = document.getElementById('product-category-selected-text');
    
    if (!input || !textSpan) return;
    
    input.value = id || '';
    const cat = PRODUCT_CATEGORIES.find(c => c.id === id);
    
    if (cat) {
        textSpan.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="w-6 h-6 rounded bg-pink-50 text-secondary flex items-center justify-center text-xs"><i class="fas ${cat.icon}"></i></span>
                <span class="text-gray-800 font-bold">${cat.name}</span>
            </div>
        `;
    } else {
        textSpan.innerHTML = '<span>اختر الفئة...</span>';
    }
};

const toggleCategoryDropdown = () => {
    const dropdown = document.getElementById('product-category-dropdown');
    const chevron = document.getElementById('product-category-chevron');
    
    if (dropdown) dropdown.classList.toggle('hidden');
    if (chevron) chevron.classList.toggle('rotate-180');
};

const renderProducts = (products) => {
    const grid = document.getElementById('products-grid');
    if (!grid) return;

    if (products.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'col-span-full py-12 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200';
        emptyState.innerHTML = `
            <i class="fas fa-box-open text-4xl mb-3 text-gray-300"></i>
            <p>لا توجد منتجات حالياً</p>
        `;
        grid.appendChild(emptyState);
        return;
    }

    products.forEach(p => {
        const card = document.createElement('div');
        card.className = 'glass-card overflow-hidden group hover:shadow-lg transition-all duration-300';
        
        const imgSrc = p.image_url || 'https://placehold.co/300x300?text=No+Image';
        const price = parseFloat(p.price).toFixed(2);
        const currencySymbol = p.currency === 'USD' ? '$' : '₪';
        
        // Update getCategoryName to use category string
        const categoryId = p.category; 
        const categoryName = getCategoryName(categoryId);
        
        card.innerHTML = `
            <div class="relative h-48 overflow-hidden bg-gray-100">
                <img src="${imgSrc}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="${p.name}">
                <div class="absolute top-2 right-2 flex gap-2">
                    <button class="w-8 h-8 rounded-full bg-white/90 text-blue-600 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-colors shadow-sm edit-product-btn" data-id="${p.id}">
                        <i class="fas fa-pen text-xs"></i>
                    </button>
                    <button class="w-8 h-8 rounded-full bg-white/90 text-red-600 flex items-center justify-center hover:bg-red-600 hover:text-white transition-colors shadow-sm delete-product-btn" data-id="${p.id}">
                        <i class="fas fa-trash text-xs"></i>
                    </button>
                </div>
                ${!p.is_active ? '<div class="absolute inset-0 bg-white/60 flex items-center justify-center"><span class="px-3 py-1 bg-gray-800 text-white text-xs font-bold rounded-full">غير متاح</span></div>' : ''}
            </div>
            <div class="p-4">
                <div class="flex justify-between items-start mb-2">
                    <h3 class="font-bold text-slate-800 line-clamp-1" title="${p.name}">${p.name}</h3>
                    <span class="font-bold text-secondary text-lg">${price} <span class="text-xs text-gray-500">${currencySymbol}</span></span>
                </div>
                <p class="text-xs text-gray-500 mb-3 line-clamp-2 h-8">${p.description || 'لا يوجد وصف'}</p>
                <div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                    <span class="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">${categoryName}</span>
                </div>
            </div>
        `;

        // Bind events
        card.querySelector('.edit-product-btn').addEventListener('click', () => openProductModal(p));
        card.querySelector('.delete-product-btn').addEventListener('click', () => confirmDeleteProduct(p.id));

        grid.appendChild(card);
    });
};

const getCategoryName = (id) => {
    if (!id) return 'بدون فئة';
    const cat = PRODUCT_CATEGORIES.find(c => c.id === id);
    return cat ? cat.name : 'بدون فئة';
};

const handleCategoryFilter = (e) => {
    if (e.target.classList.contains('category-filter-btn')) {
        // Update UI
        document.querySelectorAll('.category-filter-btn').forEach(btn => {
            btn.classList.remove('active', 'bg-slate-800', 'text-white');
            btn.classList.add('bg-white', 'text-slate-600', 'hover:bg-slate-100');
        });
        e.target.classList.remove('bg-white', 'text-slate-600', 'hover:bg-slate-100');
        e.target.classList.add('active', 'bg-slate-800', 'text-white');

        const catId = e.target.dataset.id;
        loadProducts(catId);
    }
};

const openProductModal = (product = null) => {
    currentProductToEdit = product;
    const modal = document.getElementById('product-modal');
    const title = document.getElementById('product-modal-title');
    const form = document.getElementById('product-form');
    const imgPreview = document.getElementById('product-preview-img');
    const placeholder = document.getElementById('product-img-placeholder');

    if (product) {
        title.textContent = 'تعديل منتج';
        document.getElementById('product-id').value = product.id;
        document.getElementById('product-name').value = product.name;
        document.getElementById('product-price').value = product.price;
        document.getElementById('product-currency').value = product.currency;
        selectCategory(product.category || '');
        document.getElementById('product-description').value = product.description || '';
        document.getElementById('product-active').checked = product.is_active;

        if (product.image_url) {
            imgPreview.src = product.image_url;
            imgPreview.classList.remove('hidden');
            placeholder.classList.add('hidden');
        } else {
            imgPreview.classList.add('hidden');
            placeholder.classList.remove('hidden');
        }
    } else {
        title.textContent = 'إضافة منتج جديد';
        form.reset();
        document.getElementById('product-id').value = '';
        selectCategory('');
        imgPreview.src = '';
        imgPreview.classList.add('hidden');
        placeholder.classList.remove('hidden');
        document.getElementById('product-active').checked = true;
    }

    modal.classList.remove('hidden');
};

const closeProductModal = () => {
    document.getElementById('product-modal').classList.add('hidden');
    currentProductToEdit = null;
};

const handleImagePreview = (e) => {
    const file = e.target.files[0];
    const preview = document.getElementById('product-preview-img');
    const placeholder = document.getElementById('product-img-placeholder');
    
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.src = e.target.result;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }
};

const handleProductSubmit = async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('product-id').value;
    const imageFile = document.getElementById('product-image-input').files[0];

    // Enforce image requirement for new products
    if (!id && !imageFile) {
        showMessage('تنبيه', 'يجب إضافة صورة للمنتج الجديد', false);
        return;
    }

    const formData = new FormData();
    formData.append('salon_id', currentSalonId);
    formData.append('name', document.getElementById('product-name').value);
    formData.append('price', document.getElementById('product-price').value);
    formData.append('currency', document.getElementById('product-currency').value);
    formData.append('category', document.getElementById('product-category').value || '');
    formData.append('description', document.getElementById('product-description').value);
    formData.append('is_active', document.getElementById('product-active').checked);

    if (imageFile) {
        formData.append('image', imageFile);
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';

    try {
        const url = id ? `/api/products/${currentSalonId}/${id}` : `/api/products/${currentSalonId}`;
        const method = id ? 'PUT' : 'POST';
        
        const token = getRoleSessionToken(currentSalonId) || localStorage.getItem('saloony_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(url, {
            method: method,
            headers: headers,
            body: formData // FormData handles headers automatically
        });

        const data = await res.json();

        if (data.success) {
            showActionSuccess('تم الحفظ بنجاح');
            closeProductModal();
            // Get active category or default to all
            const activeBtn = document.querySelector('.category-filter-btn.active');
            const activeCatId = activeBtn ? activeBtn.dataset.id : 'all';
            loadProducts(activeCatId);
        } else {
            showMessage('خطأ', data.message || 'حدث خطأ أثناء حفظ المنتج', false);
        }
    } catch (error) {
        console.error('Save product error', error);
        showMessage('خطأ', 'تعذر الاتصال بالخادم', false);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
};

const confirmDeleteProduct = async (id) => {
    if (confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
        try {
            const token = getRoleSessionToken(currentSalonId) || localStorage.getItem('saloony_token');
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch(`/api/products/${currentSalonId}/${id}`, { 
                method: 'DELETE',
                headers: headers
            });
            const data = await res.json();
            
            if (data.success) {
                showToast('تم حذف المنتج بنجاح');
                const activeBtn = document.querySelector('.category-filter-btn.active');
                const activeCatId = activeBtn ? activeBtn.dataset.id : 'all';
                loadProducts(activeCatId);
            } else {
                showToast('فشل حذف المنتج', false);
            }
        } catch (error) {
            showToast('حدث خطأ أثناء الحذف', false);
        }
    }
};

// Category Modal Logic
const openCategoryModal = () => {
    document.getElementById('category-modal').classList.remove('hidden');
    document.getElementById('category-form').reset();
};

const closeCategoryModal = () => {
    document.getElementById('category-modal').classList.add('hidden');
};

const handleCategorySubmit = async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('category-name').value;
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
        const token = getRoleSessionToken() || localStorage.getItem('saloony_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`/api/products/categories/${currentSalonId}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ salon_id: currentSalonId, name })
        });

        const data = await res.json();

        if (data.success) {
            closeCategoryModal();
            showToast('تمت إضافة الفئة بنجاح');
            loadCategories();
        } else {
            showToast(data.message || 'فشل إضافة الفئة', false);
        }
    } catch (error) {
        showToast('حدث خطأ', false);
    } finally {
        btn.innerText = originalText;
    }
};
