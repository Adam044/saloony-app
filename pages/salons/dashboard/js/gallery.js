
import { showToast } from './ui.js';
import { getRoleSessionToken } from './auth.js';
import { CropperManager } from './cropper-modal.js';

let currentSalonId = null;
let currentGallery = [];

export const initGallery = async (salonId) => {
    currentSalonId = salonId;
    if (!currentSalonId) return;

    // Bind Add Gallery Button
    const addBtn = document.getElementById('add-gallery-btn');
    if (addBtn) addBtn.addEventListener('click', openAddPhotoModal);

    // Bind Close Buttons
    const closeBtn = document.getElementById('close-add-photo-modal');
    const cancelBtn = document.getElementById('cancel-add-photo');
    if (closeBtn) closeBtn.addEventListener('click', closeAddPhotoModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeAddPhotoModal);

    // Bind Form Submit
    const form = document.getElementById('add-photo-form');
    if (form) form.addEventListener('submit', handlePhotoSubmit);

    // Bind Image Preview with Cropper
    const fileInput = document.getElementById('photo-file');
    const previewArea = document.getElementById('photo-preview-area');
    if (fileInput && previewArea) {
        previewArea.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const croppedFile = await CropperManager.open(file, {
                        aspectRatio: NaN, // Free aspect ratio for gallery
                        title: 'تعديل صورة المعرض'
                    });

                    // Update File Input
                    const dt = new DataTransfer();
                    dt.items.add(croppedFile);
                    fileInput.files = dt.files;

                    // Call original handleImagePreview logic manually or let it be handled if it was separate
                    // Looking at original code: fileInput.addEventListener('change', handleImagePreview);
                    // I replaced that listener. So I need to implement the preview logic here.
                    
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        previewArea.innerHTML = `
                            <img src="${e.target.result}" class="w-full h-full object-cover rounded-xl">
                            <button type="button" class="absolute top-2 right-2 bg-white/90 p-1.5 rounded-lg shadow-sm hover:text-red-500 transition" 
                                onclick="document.getElementById('photo-file').value = ''; document.getElementById('photo-preview-area').innerHTML = '<div class=\'text-center text-slate-400\'><i class=\'fas fa-cloud-upload-alt text-3xl mb-2\'></i><p class=\'text-sm\'>اضغط لرفع صورة</p></div>'; event.stopPropagation();">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        `;
                    };
                    reader.readAsDataURL(croppedFile);

                } catch (error) {
                    console.log('Crop cancelled or failed', error);
                    if (!fileInput.files.length) fileInput.value = '';
                }
            }
        });
    }

    // Bind Category Toggle
    const addCategoryBtn = document.getElementById('add-category-btn');
    const saveCategoryBtn = document.getElementById('save-new-category-btn');
    const cancelCategoryBtn = document.getElementById('cancel-new-category-btn');
    
    if (addCategoryBtn) {
        addCategoryBtn.addEventListener('click', () => toggleCategoryInput(true));
    }
    if (saveCategoryBtn) {
        saveCategoryBtn.addEventListener('click', handleAddCategory);
    }
    if (cancelCategoryBtn) {
        cancelCategoryBtn.addEventListener('click', () => toggleCategoryInput(false));
    }

    // Load Gallery
    await loadGallery();
};

const toggleCategoryInput = (show) => {
    const select = document.getElementById('photo-category-select').parentElement.parentElement;
    const input = document.getElementById('new-category-input-container');
    
    if (show) {
        select.classList.add('hidden');
        input.classList.remove('hidden');
        input.classList.add('flex');
        document.getElementById('new-category-input').focus();
    } else {
        select.classList.remove('hidden');
        input.classList.add('hidden');
        input.classList.remove('flex');
        document.getElementById('new-category-input').value = '';
    }
};

const handleAddCategory = () => {
    const input = document.getElementById('new-category-input');
    const select = document.getElementById('photo-category-select');
    const val = input.value.trim();
    
    if (val) {
        // Check if exists
        const exists = Array.from(select.options).some(opt => opt.value === val);
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            select.appendChild(opt);
        }
        select.value = val;
    }
    toggleCategoryInput(false);
};

const openAddPhotoModal = () => {
    const modal = document.getElementById('add-photo-modal');
    const content = document.getElementById('add-photo-modal-content');
    const backdrop = document.getElementById('add-photo-modal-backdrop');
    
    if (modal && content && backdrop) {
        modal.classList.remove('hidden');
        // Small delay for animation
        setTimeout(() => {
            backdrop.classList.remove('opacity-0');
            content.classList.remove('opacity-0', 'scale-95');
        }, 10);
    }
};

const closeAddPhotoModal = () => {
    const modal = document.getElementById('add-photo-modal');
    const content = document.getElementById('add-photo-modal-content');
    const backdrop = document.getElementById('add-photo-modal-backdrop');
    
    if (modal && content && backdrop) {
        backdrop.classList.add('opacity-0');
        content.classList.add('opacity-0', 'scale-95');
        
        setTimeout(() => {
            modal.classList.add('hidden');
            resetForm();
        }, 300);
    }
};

const resetForm = () => {
    const form = document.getElementById('add-photo-form');
    if (form) form.reset();
    
    const preview = document.getElementById('photo-preview');
    const placeholder = document.getElementById('photo-upload-placeholder');
    if (preview && placeholder) {
        preview.src = '';
        preview.classList.add('hidden');
        placeholder.classList.remove('hidden');
    }
};

const handleImagePreview = (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = document.getElementById('photo-preview');
            const placeholder = document.getElementById('photo-upload-placeholder');
            if (preview && placeholder) {
                preview.src = e.target.result;
                preview.classList.remove('hidden');
                placeholder.classList.add('hidden');
            }
        };
        reader.readAsDataURL(file);
    }
};

const handlePhotoSubmit = async (e) => {
    e.preventDefault();
    
    const fileInput = document.getElementById('photo-file');
    const category = document.getElementById('photo-category-select').value;
    const title = document.getElementById('photo-title').value;
    
    if (!fileInput.files || !fileInput.files[0]) {
        showToast('يرجى اختيار صورة', false);
        return;
    }

    const saveBtnText = document.getElementById('save-photo-text');
    const saveSpinner = document.getElementById('save-photo-spinner');
    
    // Show Loading
    if (saveBtnText) saveBtnText.textContent = 'جاري الرفع...';
    if (saveSpinner) saveSpinner.classList.remove('hidden');

    try {
        const formData = new FormData();
        formData.append('image', fileInput.files[0]);
        formData.append('category', category);
        formData.append('title', title);
        formData.append('salon_id', currentSalonId);

        const token = localStorage.getItem('saloony_token') || getRoleSessionToken(currentSalonId);
        
        if (!token) {
            throw new Error('Authentication required');
        }

        const headers = {
            'Authorization': `Bearer ${token}`
        };

        const res = await fetch(`/api/salon/gallery/${currentSalonId}`, {
            method: 'POST',
            headers: headers,
            body: formData
        });

        const data = await res.json();

        if (data.success) {
            showToast('تم إضافة الصورة بنجاح', true);
            closeAddPhotoModal();
            await loadGallery();
        } else {
            throw new Error(data.message || 'Failed to upload');
        }

    } catch (error) {
        console.error('Upload error:', error);
        showToast(error.message || 'حدث خطأ أثناء رفع الصورة', false);
    } finally {
        // Reset Loading
        if (saveBtnText) saveBtnText.textContent = 'حفظ الصورة';
        if (saveSpinner) saveSpinner.classList.add('hidden');
    }
};

const loadGallery = async () => {
    const loading = document.getElementById('gallery-loading');
    const grid = document.getElementById('gallery-grid');
    
    if (loading) loading.classList.remove('hidden');
    
    // Clear current grid (except loading)
    if (grid) {
        Array.from(grid.children).forEach(child => {
            if (child.id !== 'gallery-loading') child.remove();
        });
    }

    try {
        const res = await fetch(`/api/salon/gallery/${currentSalonId}`);
        const data = await res.json();

        if (data.success) {
            currentGallery = data.images || [];
            renderGallery(currentGallery);
            populateCategorySuggestions(currentGallery);
        }
    } catch (error) {
        console.error('Load gallery error:', error);
        showToast('تعذر تحميل معرض الصور', false);
    } finally {
        if (loading) loading.classList.add('hidden');
    }
};

const populateCategorySuggestions = (images) => {
    const select = document.getElementById('photo-category-select');
    if (!select) return;
    
    // Extract unique categories, exclude null/empty/undefined
    const categories = [...new Set(images.map(img => img.category).filter(c => c))];
    
    // Keep current selection if any
    const currentVal = select.value;

    // Reset options (keep "No Category")
    select.innerHTML = '<option value="">بدون تصنيف</option>';

    // Add categories
    categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });

    if (currentVal && categories.includes(currentVal)) {
        select.value = currentVal;
    }
};

const renderGallery = (images) => {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;

    if (images.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'col-span-full py-12 flex flex-col items-center justify-center text-gray-400';
        emptyState.innerHTML = `
            <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-2xl">
                <i class="fas fa-images"></i>
            </div>
            <p>لا توجد صور في المعرض</p>
            <p class="text-sm mt-1">أضف صور لعرض أعمال الصالون</p>
        `;
        grid.appendChild(emptyState);
        return;
    }

    images.forEach(img => {
        const card = document.createElement('div');
        card.className = 'group relative aspect-square rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all';
        
        card.innerHTML = `
            <img data-src="${img.image_url}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">
            
            <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 flex flex-col justify-end min-h-[40%] transition-all duration-300">
                <h4 class="text-white font-bold truncate text-sm mb-0.5 drop-shadow-md">${img.title || 'بدون عنوان'}</h4>
                <p class="text-gray-200 text-xs font-medium bg-white/20 backdrop-blur-sm self-start px-2 py-0.5 rounded-md inline-block">${img.category || 'عام'}</p>
            </div>

            <button class="delete-img-btn absolute top-3 right-3 w-8 h-8 bg-red-500/80 hover:bg-red-600 text-white rounded-lg flex items-center justify-center backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-90 group-hover:scale-100" data-id="${img.id}">
                <i class="fas fa-trash-alt text-sm"></i>
            </button>
        `;
        
        // Optimize image
        if (window.ImageOptimizer) {
            const imgEl = card.querySelector('img');
            window.ImageOptimizer.optimize(imgEl);
        } else {
            const imgEl = card.querySelector('img');
            imgEl.src = imgEl.dataset.src;
        }
        
        // Bind delete
        const deleteBtn = card.querySelector('.delete-img-btn');
        deleteBtn.addEventListener('click', (e) => handleDeleteImage(e, img.id));

        grid.appendChild(card);
    });
};

const handleDeleteImage = async (e, id) => {
    e.stopPropagation(); // Prevent opening modal if we add view modal later
    
    if (!confirm('هل أنت متأكد من حذف هذه الصورة؟')) return;

    try {
        const token = localStorage.getItem('saloony_token') || getRoleSessionToken(currentSalonId);
        
        if (!token) {
            showToast('Authentication required', false);
            return;
        }

        const headers = {
            'Authorization': `Bearer ${token}`
        };

        const res = await fetch(`/api/salon/gallery/${currentSalonId}/${id}`, {
            method: 'DELETE',
            headers: headers
        });

        const data = await res.json();
        
        if (data.success) {
            showToast('تم حذف الصورة', true);
            await loadGallery(); // Reload to refresh
        } else {
            throw new Error(data.message || 'Failed to delete');
        }

    } catch (error) {
        console.error('Delete error:', error);
        showToast('حدث خطأ أثناء الحذف', false);
    }
};

