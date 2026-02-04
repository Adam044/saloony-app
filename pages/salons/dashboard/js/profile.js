
import { showMessage, showActionProgress, showActionSuccess, initHeaderSalon } from './ui.js';

let currentSalonData = null;

export const initProfile = (salonId) => {
    // Initial load
    loadProfile(salonId);
    
    // Bind Edit Button
    const editBtn = document.getElementById('btn-edit-info');
    if (editBtn) {
        editBtn.addEventListener('click', () => openEditModal(salonId));
    }

    // Bind Modal Close Button
    const closeBtn = document.getElementById('close-edit-profile-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeEditModal);
    }

    // Bind Logo Preview
    const logoInput = document.getElementById('edit-profile-logo-input');
    const logoPreview = document.getElementById('edit-preview-logo');
    if (logoInput && logoPreview) {
        logoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    logoPreview.src = e.target.result;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Bind Cover Preview
    const coverInput = document.getElementById('edit-profile-cover-input');
    const coverPreview = document.getElementById('edit-preview-cover');
    const coverPlaceholder = document.getElementById('edit-cover-placeholder');
    
    if (coverInput && coverPreview) {
        coverInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    coverPreview.src = e.target.result;
                    coverPreview.classList.remove('hidden');
                    if (coverPlaceholder) coverPlaceholder.classList.add('hidden');
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Bind Form Submit
    const form = document.getElementById('edit-profile-form');
    if (form) {
        form.addEventListener('submit', (e) => handleProfileSave(e, salonId));
    }
};

export const loadProfile = async (salonId) => {
    try {
        const response = await fetch(`/api/salon/info/${salonId}`);
        const data = await response.json();
        if (data.success) {
            currentSalonData = data.salon;
            updateSalonInfoDisplay(data.salon);
            // Store for local usage if needed
            localStorage.setItem('saloony_user', JSON.stringify(data.salon));
            
            // Set view page link
            const viewBtn = document.getElementById('btn-view-page');
            if (viewBtn) {
                viewBtn.href = `/pages/salons/salon.html?id=${salonId}`;
            }

            // Load visits
            loadAnalytics(salonId);
        }
    } catch (error) {
        console.error('Error loading profile:', error);
        showMessage(null, 'فشل تحميل بيانات الصالون.', false);
    }
};

const loadAnalytics = async (salonId) => {
    // 1. Visits
    loadVisits(salonId);

    // 2. Staff Count
    try {
        const res = await fetch(`/api/salon/staff/${salonId}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.staff)) {
             const el = document.getElementById('analytics-staff');
             if (el) el.textContent = data.staff.length;
        }
    } catch(e) { console.error('Error loading staff count:', e); }

    // 3. Bookings Today
    try {
        const res = await fetch(`/api/salon/appointments/${salonId}/today`);
        const data = await res.json();
        if (data.success && Array.isArray(data.appointments)) {
             const el = document.getElementById('analytics-bookings-today');
             if (el) el.textContent = data.appointments.length;
        }
    } catch(e) { console.error('Error loading today bookings:', e); }
    
    // 4. Total Bookings (Completed)
    try {
        const res = await fetch(`/api/salon/appointments/${salonId}/completed`);
        const data = await res.json();
        if (data.success && Array.isArray(data.appointments)) {
             const el = document.getElementById('analytics-bookings-total');
             if (el) el.textContent = data.appointments.length;
        }
    } catch(e) { console.error('Error loading total bookings:', e); }
};

const loadVisits = async (salonId) => {
    try {
        const response = await fetch(`/api/salon/visits/${salonId}`);
        const data = await response.json();
        if (data.success) {
             const count = data.count || 0;
             // Update all potential visitor count elements
             ['disp-visitors-count', 'analytics-visits'].forEach(id => {
                 const el = document.getElementById(id);
                 if (el) el.textContent = count;
             });
        }
    } catch (e) {
        console.error('Error loading visits:', e);
    }
};

export const updateSalonInfoDisplay = (info) => {
    if (!info) {
        console.warn('No salon info provided to updateSalonInfoDisplay');
        return;
    }
    
    const show = (id, val) => { 
        const el = document.getElementById(id);
        if (el) el.textContent = (val && String(val).trim()) ? val : '...'; 
    };

    try {
        show('disp-salon-name', info.salon_name);
        show('disp-owner-name', info.owner_name);
        show('disp-salon-phone', info.salon_phone);
        show('disp-owner-phone', info.owner_phone); // Keep displaying it, just not editable
        show('disp-address', info.address);
        show('disp-city', info.city);
        
        const dispGenderFocus = document.getElementById('disp-gender-focus');
        if (dispGenderFocus) {
            const map = { 'men': 'رجال', 'women': 'نساء', 'mix': 'مختلط' };
            dispGenderFocus.textContent = map[info.gender_focus] || 'غير محدد';
        }

        // Update Logo
        const dispProfileImg = document.getElementById('disp-profile-img');
        if (dispProfileImg) {
            const fallbackInitial = (info.salon_name || 'S').charAt(0);
            const logoSrc = info.logo_url || info.image_url;
            dispProfileImg.src = (logoSrc && !logoSrc.includes('placehold.co'))
                ? logoSrc
                : `https://placehold.co/100x100/1E293B/ffffff?text=${fallbackInitial}`;
        }

        // Update Cover
        const dispCover = document.getElementById('disp-salon-cover');
        if (dispCover) {
            if (info.image_url && !info.image_url.includes('placehold.co')) {
                dispCover.style.backgroundImage = `url('${info.image_url}')`;
                dispCover.classList.remove('bg-gradient-to-r'); 
            } else {
                dispCover.style.backgroundImage = '';
                dispCover.classList.add('bg-gradient-to-r');
            }
        }

    } catch (e) {
        console.warn('Failed to update display:', e);
    }
};

const openEditModal = async (salonId) => {
    const modal = document.getElementById('edit-profile-modal');
    if (!modal) return;

    // Populate Cities
    await populateCityDropdown('edit-city-select', currentSalonData?.city);

    // Populate Fields
    if (currentSalonData) {
        setValue('edit-salon-name', currentSalonData.salon_name);
        setValue('edit-salon-phone', currentSalonData.salon_phone);
        setValue('edit-address', currentSalonData.address);
        setValue('edit-city-select', currentSalonData.city);
        setValue('edit-gender-select', currentSalonData.gender_focus || 'men');
        
        // Read-only fields
        setValue('edit-email-readonly', currentSalonData.email);
        setValue('edit-owner-phone-readonly', currentSalonData.owner_phone);

        // Image (Logo)
    const logoPreview = document.getElementById('edit-preview-logo');
    if (logoPreview) {
        const fallbackInitial = (currentSalonData.salon_name || 'S').charAt(0);
        const logoSrc = currentSalonData.logo_url || currentSalonData.image_url;
        logoPreview.src = (logoSrc && !logoSrc.includes('placehold.co'))
            ? logoSrc
            : `https://placehold.co/100x100/1E293B/ffffff?text=${fallbackInitial}`;
    }

    // Cover Image
    const coverPreview = document.getElementById('edit-preview-cover');
    const coverPlaceholder = document.getElementById('edit-cover-placeholder');
    
    if (coverPreview && coverPlaceholder) {
        if (currentSalonData.image_url && !currentSalonData.image_url.includes('placehold.co')) {
            coverPreview.src = currentSalonData.image_url;
            coverPreview.classList.remove('hidden');
            coverPlaceholder.classList.add('hidden');
        } else {
            coverPreview.src = '';
            coverPreview.classList.add('hidden');
            coverPlaceholder.classList.remove('hidden');
        }
    }
    
    // Set About
    setValue('edit-about', currentSalonData.about);
    }

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
};

const closeEditModal = () => {
    const modal = document.getElementById('edit-profile-modal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
    }
};

const setValue = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
};

const populateCityDropdown = async (selectId, selectedCity = null) => {
    const select = document.getElementById(selectId);
    if (!select) return;

    try {
        // Clear existing options except maybe a placeholder if we want one
        select.innerHTML = '<option value="" disabled>اختر المدينة</option>';
        
        const response = await fetch('/api/cities');
        const cities = await response.json();
        
        // Handle both array of strings or array of objects formats
        const cityList = Array.isArray(cities) ? cities : (cities.cities || []);

        cityList.forEach(cityItem => {
            const option = document.createElement('option');
            // If cityItem is string, use it. If object, look for name property.
            const cityName = typeof cityItem === 'object' ? (cityItem.name || cityItem.name_ar) : cityItem;
            
            option.value = cityName;
            option.textContent = cityName;
            
            if (cityName === selectedCity) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading cities:', error);
    }
};

const handleProfileSave = async (e, salonId) => {
    e.preventDefault();
    
    const hud = showActionProgress('جاري حفظ التغييرات...');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const logoInput = document.getElementById('edit-profile-logo-input');
        const coverInput = document.getElementById('edit-profile-cover-input');
        
        let newLogoUrl = currentSalonData?.logo_url;
        let newCoverUrl = currentSalonData?.image_url;
        
        // 1. Upload Logo if changed
        if (logoInput && logoInput.files[0]) {
            const logoForm = new FormData();
            logoForm.append('image', logoInput.files[0]);
            logoForm.append('salon_id', salonId);
            logoForm.append('type', 'logo');
            
            const uploadResp = await fetch(`/api/upload?salon_id=${salonId}`, {
                method: 'POST',
                body: logoForm
            });
            
            const uploadJson = await uploadResp.json();
            if (!uploadJson.success) {
                throw new Error(uploadJson.message || 'فشل رفع الشعار');
            }
            newLogoUrl = uploadJson.image_url;
        }

        // 2. Upload Cover if changed
        if (coverInput && coverInput.files[0]) {
            const coverForm = new FormData();
            coverForm.append('image', coverInput.files[0]);
            coverForm.append('salon_id', salonId);
            coverForm.append('type', 'background');
            
            const uploadResp = await fetch(`/api/upload?salon_id=${salonId}`, {
                method: 'POST',
                body: coverForm
            });
            
            const uploadJson = await uploadResp.json();
            if (!uploadJson.success) {
                throw new Error(uploadJson.message || 'فشل رفع صورة الغلاف');
            }
            newCoverUrl = uploadJson.image_url;
        }

        // 3. Prepare Data
        const payload = {
            salon_name: document.getElementById('edit-salon-name').value.trim(),
            salon_phone: document.getElementById('edit-salon-phone').value.trim(),
            address: document.getElementById('edit-address').value.trim(),
            about: document.getElementById('edit-about').value.trim(),
            city: document.getElementById('edit-city-select').value,
            gender_focus: document.getElementById('edit-gender-select').value,
            logo_url: newLogoUrl,
            image_url: newCoverUrl,
            
            // Critical fields - send original values to ensure they don't change even if form is manipulated
            email: currentSalonData.email,
            owner_phone: currentSalonData.owner_phone,
            owner_name: currentSalonData.owner_name
        };

        if (!payload.salon_name) throw new Error('يرجى إدخال اسم الصالون');

        const response = await fetch(`/api/salon/info/${salonId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        if (response.ok && data.success) {
            // Update local state
            currentSalonData = { ...currentSalonData, ...payload };
            updateSalonInfoDisplay(currentSalonData);
            localStorage.setItem('saloony_user', JSON.stringify(currentSalonData));
            
            // Update Header immediately
            await initHeaderSalon(salonId);

            hud.success('تم تحديث البيانات بنجاح');
            closeEditModal();
        } else {
            throw new Error(data.message || 'فشل حفظ التغييرات');
        }

    } catch (error) {
        console.error('Error saving profile:', error);
        if (hud) hud.error(error.message || 'حدث خطأ أثناء الحفظ');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
};
