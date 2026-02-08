
import { showMessage, renderEmptyState } from './ui.js';

let autoSaveTimer = null;
const servicesMessage = document.getElementById('services-message') || { textContent: '' }; // Fallback
let currentSalonId = null;
let currentSalonGender = 'all';

export const initServices = async (salonId) => {
    currentSalonId = salonId;
    
    // Fetch salon info to get gender
    try {
        const res = await fetch(`/api/salon/info/${salonId}`);
        const data = await res.json();
        if (data.success && data.salon) {
            currentSalonGender = data.salon.gender_focus || 'all';
        }
    } catch (e) {
        console.error('Failed to fetch salon gender', e);
    }

    // Attach listeners that don't depend on data loading
    document.getElementById('services-gender-filter')?.addEventListener('change', (e) => loadServiceManagement(salonId, e.target.value));
    
    // Auto-save logic exposed globally as per original design
    window.scheduleAutoSave = () => scheduleAutoSave(salonId);
    
    // Manual save button
    const saveServicesBtn = document.getElementById('save-services-btn');
    if (saveServicesBtn) {
        saveServicesBtn.addEventListener('click', () => saveServices(salonId));
    }
    
    // Main Add Service Button
    document.getElementById('add-service-btn')?.addEventListener('click', () => openSalonServicesExplorer());

    // Initial Load
    loadServiceManagement(salonId);
};

const generateDurationOptions = (selectedDuration) => {
    let options = '';
    for (let min = 5; min <= 120; min += 5) {
        options += `<option value="${min}" ${min === selectedDuration ? 'selected' : ''}>${min} دقيقة</option>`;
    }
    return options;
};

export const ensureServiceCardRendered = (service, priceOverride, durationOverride) => {
    const existing = document.querySelector(`[data-service-id="${service.id}"]`);
    if (existing) return existing;

    const servicesListContainer = document.getElementById('services-list-container');
    if (!servicesListContainer) return null;

    // Remove empty state if present
    if (servicesListContainer.querySelector('.empty-state')) {
        servicesListContainer.innerHTML = '';
    }

    const isAddOn = service.service_type === 'add_on';
    const containerId = isAddOn ? 'add-on-list-container' : 'main-list-container';
    let container = document.getElementById(containerId);

    if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        
        const header = document.createElement('div');
        header.className = isAddOn ? 'mb-4 mt-8 border-b border-gray-100 pb-2' : 'mb-4 border-b border-gray-100 pb-2';
        
        if (isAddOn) {
            header.innerHTML = `
                <div class="flex items-center justify-between">
                    <h4 class="font-bold text-lg text-primary-dark flex items-center">
                        <i class="fas fa-plus-circle ml-2 text-orange-500"></i>الإضافات
                    </h4>
                </div>
                <p class="text-gray-600 text-sm mt-1">خدمات إضافية لا تحتاج وقت في الجدولة</p>
            `;
            servicesListContainer.appendChild(header);
            servicesListContainer.appendChild(container);
        } else {
            header.innerHTML = `
                <div class="flex items-center justify-between">
                    <h4 class="font-bold text-lg text-primary-dark flex items-center">
                        <i class="fas fa-cut ml-2 text-secondary"></i>الخدمات الأساسية
                    </h4>
                </div>
                <p class="text-gray-600 text-sm mt-1">الخدمات التي تحتاج وقت محدد في الجدولة</p>
            `;
            if (servicesListContainer.firstChild) {
                servicesListContainer.insertBefore(container, servicesListContainer.firstChild);
                servicesListContainer.insertBefore(header, container);
            } else {
                servicesListContainer.appendChild(header);
                servicesListContainer.appendChild(container);
            }
        }
    }

    const initialPrice = typeof priceOverride === 'number' ? priceOverride : (isAddOn ? 25 : 50);
    const initialDuration = typeof durationOverride === 'number' ? durationOverride : (isAddOn ? 0 : 30);

    const card = document.createElement('div');
    card.className = `p-4 glass-card border-r-4 transition-all duration-300 mb-3 ${isAddOn ? 'border-orange-400' : 'border-secondary'}`;
    card.setAttribute('data-service-id', service.id);
    card.setAttribute('data-service-type', service.service_type);
    
    const header = `
        <div class="flex justify-between items-center mb-3">
          <div class="flex items-center space-x-3 space-x-reverse">
            <label class="text-lg font-bold text-primary-dark">
              ${service.icon && (service.icon.startsWith('http') || service.icon.includes('supabase')) ? 
                `<img data-src="${service.icon}" data-optimize="true" alt="${service.name_ar}" class="w-5 h-5 object-contain inline ml-2 ${isAddOn ? 'opacity-75' : ''}">` :
                `<i class="fas ${service.icon} ml-2 ${isAddOn ? 'text-orange-500' : 'text-secondary'}"></i>`
              } ${service.name_ar}
              ${isAddOn ? '<span class="text-sm text-orange-600 font-normal mr-2">(إضافة)</span>' : ''}
            </label>
          </div>
          <button class="remove-service-btn py-1 px-3 rounded-xl border border-gray-200 hover:bg-red-50 hover:text-red-600 transition-colors" data-id="${service.id}">
            <i class="fas fa-trash-alt ml-2"></i>إزالة
          </button>
        </div>`;
    
    const details = isAddOn ? `
        <div class="details-inputs space-y-3 pt-3 border-t border-gray-100 opacity-100" data-id="${service.id}">
          <div class="flex space-x-4 space-x-reverse">
            <div class="flex-1">
              <label class="block text-sm font-medium text-gray-700">السعر (ILS)</label>
              <input type="number" data-id="${service.id}" data-type="price" value="${initialPrice}" min="5" step="5" required class="mt-1 w-full p-2 bg-white/60 border border-gray-200 rounded-lg text-right focus:ring-2 focus:ring-secondary/20 outline-none transition-all">
            </div>
            <div class="flex-1">
              <label class="block text-sm font-medium text-gray-700">المدة (دقيقة)</label>
              <input type="number" data-id="${service.id}" data-type="duration" value="0" min="0" step="5" class="mt-1 w-full p-2 bg-white/60 border border-gray-200 rounded-lg text-right focus:ring-2 focus:ring-secondary/20 outline-none transition-all" placeholder="0">
            </div>
          </div>
        </div>` : `
        <div class="details-inputs space-y-3 pt-3 border-t border-gray-100 opacity-100" data-id="${service.id}">
          <div class="flex space-x-4 space-x-reverse">
            <div class="flex-1">
              <label class="block text-sm font-medium text-gray-700">السعر (ILS)</label>
              <input type="number" data-id="${service.id}" data-type="price" value="${initialPrice}" min="5" step="5" required class="mt-1 w-full p-2 bg-white/60 border border-gray-200 rounded-lg text-right focus:ring-2 focus:ring-secondary/20 outline-none transition-all">
            </div>
            <div class="flex-1">
              <label class="block text-sm font-medium text-gray-700">المدة</label>
              <select data-id="${service.id}" data-type="duration" required class="mt-1 w-full p-2 bg-white/60 border border-gray-200 rounded-lg appearance-none text-right focus:ring-2 focus:ring-secondary/20 outline-none transition-all">
                ${generateDurationOptions(initialDuration)}
              </select>
            </div>
          </div>
        </div>`;
    
    card.innerHTML = header + details;

    // Optimize icon if it's an image
    const iconImg = card.querySelector('img[data-optimize="true"]');
    if (iconImg) {
        if (window.ImageOptimizer) {
            window.ImageOptimizer.optimize(iconImg);
        } else {
            iconImg.src = iconImg.dataset.src;
        }
    }

    container.appendChild(card);
    
    // Wire remove button
    const removeBtn = card.querySelector('.remove-service-btn');
    removeBtn?.addEventListener('click', () => {
        card.remove();
        // Access global salonId if needed or pass it down. 
        // For now relying on caller to ensure context or use window.salonId if absolutely necessary, 
        // but here we can just call the scheduleAutoSave wrapper.
        if (typeof window.scheduleAutoSave === 'function') window.scheduleAutoSave();
    });

    // Wire inputs for auto-save
    const priceInput = card.querySelector('input[data-type="price"]');
    const durationInput = service.service_type === 'add_on'
        ? card.querySelector('input[data-type="duration"]')
        : card.querySelector('select[data-type="duration"]');
    
    ['input','change'].forEach(ev => {
        if (priceInput) priceInput.addEventListener(ev, () => { if (typeof window.scheduleAutoSave === 'function') window.scheduleAutoSave(); });
        if (durationInput) durationInput.addEventListener(ev, () => { if (typeof window.scheduleAutoSave === 'function') window.scheduleAutoSave(); });
    });
    
    return card;
};

const renderServiceCards = (masterServices, salonServices) => {
    const servicesListContainer = document.getElementById('services-list-container');
    if (!servicesListContainer) return;
    
    servicesListContainer.innerHTML = '';
    
    if (!masterServices || masterServices.length === 0) {
        renderEmptyState(servicesListContainer, 'لا توجد خدمات متاحة حالياً.', 'fa-cut');
        return;
    }

    // Check if any services are selected
    const hasSelectedServices = Array.isArray(salonServices) && salonServices.length > 0;

    if (!hasSelectedServices) {
        servicesListContainer.innerHTML = `
            <div class="empty-state flex flex-col items-center justify-center py-12 text-center animate-fade-in">
                <div class="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4 shadow-sm border border-gray-100">
                    <i class="fas fa-cut text-4xl text-gray-300"></i>
                </div>
                <h3 class="text-xl font-bold text-gray-700 mb-2">قائمة خدماتك فارغة</h3>
                <p class="text-gray-500 mb-6 max-w-sm text-sm">لم تقم بإضافة أي خدمات للصالون بعد.</p>
                <button onclick="document.getElementById('add-service-btn')?.click()" class="btn-secondary px-6 py-2 rounded-xl flex items-center gap-2 text-sm font-bold shadow-sm hover:shadow-md transition-all">
                    <i class="fas fa-plus"></i> إضافة خدمة
                </button>
            </div>
        `;
        // Update global cache for explorer even if empty
        window.masterServicesCache = masterServices;
        window.salonServicesCache = salonServices;
        return;
    }

    // Separate main services and add-ons
    const mainServices = masterServices.filter(service => service.service_type === 'main');
    const addOnServices = masterServices.filter(service => service.service_type === 'add_on');

    // Render main services section
    if (mainServices.length > 0) {
        const mainHeader = document.createElement('div');
        mainHeader.className = 'mb-4 border-b border-gray-100 pb-2';
        mainHeader.innerHTML = `
            <div class="flex items-center justify-between">
                <h4 class="font-bold text-lg text-primary-dark flex items-center">
                    <i class="fas fa-cut ml-2 text-secondary"></i>الخدمات الأساسية
                </h4>
            </div>
            <p class="text-gray-600 text-sm mt-1">الخدمات التي تحتاج وقت محدد في الجدولة</p>
        `;
        servicesListContainer.appendChild(mainHeader);
        const mainList = document.createElement('div');
        mainList.id = 'main-list-container';
        servicesListContainer.appendChild(mainList);

        // Only render currently selected main services
        const selectedMainServices = (Array.isArray(salonServices) ? salonServices : []).filter(s => s.service_type === 'main');
        
        if (selectedMainServices.length === 0) {
            mainList.innerHTML = `<div class="text-gray-400 text-sm py-2 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50/50">لا توجد خدمات أساسية مضافة</div>`;
        } else {
            selectedMainServices.forEach(sel => {
                const master = mainServices.find(ms => ms.id === (sel.id ?? sel.service_id));
                if (!master) return;
                ensureServiceCardRendered(master, parseFloat(sel.price), parseInt(sel.duration));
            });
        }
    }

    // Render add-ons section
    if (addOnServices.length > 0) {
        const addOnHeader = document.createElement('div');
        addOnHeader.className = 'mb-4 mt-8 border-b border-gray-100 pb-2';
        addOnHeader.innerHTML = `
            <div class="flex items-center justify-between">
                <h4 class="font-bold text-lg text-primary-dark flex items-center">
                    <i class="fas fa-plus-circle ml-2 text-orange-500"></i>الإضافات
                </h4>
            </div>
            <p class="text-gray-600 text-sm mt-1">خدمات إضافية لا تحتاج وقت في الجدولة</p>
        `;
        servicesListContainer.appendChild(addOnHeader);
        const addOnList = document.createElement('div');
        addOnList.id = 'add-on-list-container';
        servicesListContainer.appendChild(addOnList);
        
        // Render only currently selected add-ons
        const selectedAddOnServices = (Array.isArray(salonServices) ? salonServices : []).filter(s => s.service_type === 'add_on');
        
        if (selectedAddOnServices.length === 0) {
            addOnList.innerHTML = `<div class="text-gray-400 text-sm py-2 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50/50">لا توجد إضافات</div>`;
        } else {
            selectedAddOnServices.forEach(sel => {
                const master = addOnServices.find(ms => ms.id === (sel.id ?? sel.service_id));
                if (!master) return;
                ensureServiceCardRendered(master, parseFloat(sel.price), 0);
            });
        }
    }

    // Update global cache for explorer
    window.masterServicesCache = masterServices;
    window.salonServicesCache = salonServices;
};

export const loadServiceManagement = async (salonId, genderFocus) => {
    const servicesListContainer = document.getElementById('services-list-container');
    if (!servicesListContainer) return;
    
    // Default gender focus if not provided
    const targetGender = genderFocus || document.getElementById('services-gender-filter')?.value || 'all';
    
    // Only show loading if empty
    if (!servicesListContainer.hasChildNodes() || servicesListContainer.innerHTML.includes('جاري تحميل')) {
        servicesListContainer.innerHTML = '<div class="flex flex-col items-center justify-center py-12"><i class="fas fa-spinner fa-spin text-3xl text-secondary mb-3"></i><p class="text-gray-500">جاري تحميل الخدمات...</p></div>';
    }
    
    try {
        // Fetch Master services first
        const masterResponse = await fetch(`/api/services/master/${targetGender}`);
        const masterData = await masterResponse.json();
        
        // Then fetch Salon's active services
        const salonResponse = await fetch(`/api/salon/services/${salonId}`);
        const salonData = await salonResponse.json();

        if (masterData.success && salonData.success) {
            renderServiceCards(masterData.services, salonData.services);
        } else {
            showMessage(servicesMessage, 'فشل تحميل الخدمات الرئيسية أو خدمات الصالون.', false);
            renderEmptyState(servicesListContainer, 'فشل تحميل قائمة الخدمات.', 'fa-server');
        }
    } catch (error) {
        console.error('Error loading service data:', error);
        showMessage(servicesMessage, 'فشل الاتصال بـ API إدارة الخدمات.', false);
        renderEmptyState(servicesListContainer, 'فشل تحميل قائمة الخدمات.', 'fa-server');
    }
};

const collectSelectedServicesFromDOM = () => {
    const selected = [];
    let hasError = false;
    document.querySelectorAll('[data-service-id]').forEach(card => {
        const serviceId = card.getAttribute('data-service-id');
        const serviceType = card.getAttribute('data-service-type');
        
        const priceInput = card.querySelector('.details-inputs input[data-type="price"]');
        const durationElement = serviceType === 'add_on'
            ? card.querySelector('.details-inputs input[data-type="duration"]')
            : card.querySelector('.details-inputs select[data-type="duration"]');
        
        const price = priceInput ? parseFloat(priceInput.value) : NaN;
        const duration = durationElement ? parseInt(durationElement.value) : NaN;
        
        if (isNaN(price) || price <= 0) {
            hasError = true;
            return;
        }
        if (serviceType === 'main' && (isNaN(duration) || duration <= 0)) {
            hasError = true;
            return;
        }
        
        selected.push({
            service_id: parseInt(serviceId),
            price,
            duration: serviceType === 'add_on' ? 0 : duration,
            service_type: serviceType
        });
    });
    return { selected, hasError };
};

const showSavingMini = () => {
    if (document.getElementById('saving-mini')) return;
    const el = document.createElement('div');
    el.id = 'saving-mini';
    el.className = 'fixed bottom-4 right-4 z-50 bg-white rounded-xl shadow p-2 text-sm flex items-center';
    el.innerHTML = '<i class="fas fa-spinner fa-spin ml-2"></i> جاري الحفظ...';
    document.body.appendChild(el);
};

const hideSavingMini = () => {
    const el = document.getElementById('saving-mini');
    if (el) el.remove();
};

const autoSaveServices = async (salonId) => {
    const { selected, hasError } = collectSelectedServicesFromDOM();
    if (hasError || selected.length === 0) { hideSavingMini(); return; }
    
    try {
        const response = await fetch(`/api/salon/services/${salonId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ services: selected })
        });
        const data = await response.json();
        
        if (data.success) {
            // Reflect latest selection to cache
            window.salonServicesCache = selected.map(s => ({
                id: s.service_id,
                price: s.price,
                duration: s.duration,
                service_type: s.service_type
            }));
            
            showMessage(servicesMessage, 'تم الحفظ تلقائيًا.', true);
            
            // Refresh the services list to show the newly added services
            loadServiceManagement(salonId);
        } else {
            showMessage(servicesMessage, data.message || 'فشل في الحفظ التلقائي.', false);
        }
    } catch (e) {
        console.error('Auto-save error:', e);
    } finally {
        hideSavingMini();
    }
};

const scheduleAutoSave = (salonId) => {
    try {
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        showSavingMini();
        autoSaveTimer = setTimeout(() => autoSaveServices(salonId), 800);
    } catch (_) {}
};

export const saveServices = async (salonId) => {
    const { selected, hasError } = collectSelectedServicesFromDOM();
    if (hasError) {
        showMessage(servicesMessage, 'يرجى تصحيح الأخطاء قبل الحفظ.', false);
        return;
    }
    if (selected.length === 0) {
        showMessage(servicesMessage, 'يرجى اختيار خدمة واحدة على الأقل.', false);
        return;
    }
    
    // Re-use autoSave logic but with manual feedback
    const saveServicesBtn = document.getElementById('save-services-btn');
    if (saveServicesBtn) {
        saveServicesBtn.disabled = true;
        saveServicesBtn.innerHTML = '<i class="fas fa-spinner fa-spin ml-2"></i> جاري الحفظ...';
    }
    
    try {
        await autoSaveServices(salonId);
    } finally {
        if (saveServicesBtn) {
            saveServicesBtn.disabled = false;
            saveServicesBtn.innerHTML = '<i class="fas fa-save ml-2"></i> حفظ الخدمات والأسعار';
        }
    }
};

export const openSalonServicesExplorer = async (prefCategory = 'main') => {
    // UI Construction
    let modal = document.getElementById('salon-services-explorer-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'salon-services-explorer-modal';
        modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] opacity-0 transition-opacity duration-300 hidden';
        modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col transform scale-95 transition-transform duration-300 overflow-hidden">
                <!-- Header -->
                <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-white z-10">
                    <div>
                        <h2 class="text-2xl font-bold text-gray-800">إضافة خدمات جديدة</h2>
                        <p class="text-gray-500 text-sm mt-1">اختر الخدمات التي تريد إضافتها لقائمة خدمات الصالون</p>
                    </div>
                    <button id="close-explorer-btn" class="w-10 h-10 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                
                <!-- Controls -->
                <div class="px-6 py-4 bg-gray-50/50 border-b border-gray-100 flex flex-col md:flex-row gap-4 items-center justify-between">
                    <!-- Tabs -->
                    <div class="flex p-1 bg-gray-200/60 rounded-xl w-full md:w-auto">
                        <button class="explorer-tab flex-1 md:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-all duration-200 text-gray-600 hover:text-gray-800" data-tab="main">
                            خدمات أساسية
                        </button>
                        <button class="explorer-tab flex-1 md:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-all duration-200 text-gray-600 hover:text-gray-800" data-tab="add_on">
                            إضافات
                        </button>
                    </div>
                    
                    <!-- Search -->
                    <div class="relative w-full md:w-80">
                        <i class="fas fa-search absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                        <input type="text" id="explorer-search" 
                            class="w-full pl-4 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-secondary/20 focus:border-secondary outline-none transition-all text-sm" 
                            placeholder="ابحث عن خدمة...">
                    </div>
                </div>

                <!-- Content Area -->
                <div id="explorer-content" class="flex-1 overflow-y-auto p-6 bg-gray-50/30 relative custom-scrollbar">
                    <div id="explorer-loader" class="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-10 hidden">
                        <i class="fas fa-circle-notch fa-spin text-4xl text-secondary mb-3"></i>
                        <p class="text-gray-500 font-medium">جاري تحميل الخدمات...</p>
                    </div>
                    <div id="explorer-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <!-- Services will be injected here -->
                    </div>
                    <div id="explorer-empty" class="hidden flex flex-col items-center justify-center py-20 text-center">
                        <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-400">
                            <i class="fas fa-search text-2xl"></i>
                        </div>
                        <h3 class="text-lg font-bold text-gray-700">لا توجد نتائج</h3>
                        <p class="text-gray-500 text-sm mt-1">جرب البحث بكلمات مختلفة أو تغيير التصنيف</p>
                    </div>
                </div>
                
                <!-- Footer -->
                <div class="p-4 border-t border-gray-100 bg-white flex justify-between items-center text-xs text-gray-500">
                    <span>
                        <i class="fas fa-info-circle ml-1 text-secondary"></i>
                        يتم حفظ الخدمات تلقائياً عند إضافتها
                    </span>
                    <span id="explorer-status"></span>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // Reset and show
    modal.classList.remove('hidden');
    // Small delay to allow display:block to apply before opacity transition
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        const content = modal.querySelector('div');
        content.classList.remove('scale-95');
        content.classList.add('scale-100');
    });

    // State
    const state = {
        activeTab: prefCategory === 'all' ? 'main' : prefCategory, // Default to main if 'all' passed
        searchQuery: '',
        services: [],
        isLoading: false
    };

    // Elements
    const grid = modal.querySelector('#explorer-grid');
    const loader = modal.querySelector('#explorer-loader');
    const emptyState = modal.querySelector('#explorer-empty');
    const tabs = modal.querySelectorAll('.explorer-tab');
    const searchInput = modal.querySelector('#explorer-search');
    const closeBtn = modal.querySelector('#close-explorer-btn');

    // Methods
    const fetchServices = async () => {
        state.isLoading = true;
        updateUI();

        try {
            // Use strict gender filtering from the fetched salon info
            // If gender is 'mix', we might want to fetch all, but if it's specific, we strictly fetch specific
            const genderQuery = currentSalonGender === 'mix' ? 'all' : currentSalonGender;
            const endpoint = `/api/services/master/${genderQuery}`;
            
            const res = await fetch(endpoint);
            const data = await res.json();
            
            if (data.success) {
                // Filter strictly if gender is men/women, just in case API returns mixed
                state.services = data.services.filter(s => {
                    if (currentSalonGender === 'men' && s.gender === 'women') return false;
                    if (currentSalonGender === 'women' && s.gender === 'men') return false;
                    return true;
                });
            }
        } catch (error) {
            console.error('Failed to load services', error);
        } finally {
            state.isLoading = false;
            updateUI();
        }
    };

    const updateUI = () => {
        // Toggle Loader
        loader.classList.toggle('hidden', !state.isLoading);
        
        // Update Tabs
        tabs.forEach(t => {
            const isActive = t.dataset.tab === state.activeTab;
            t.className = `explorer-tab flex-1 md:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${isActive ? 'bg-white text-secondary shadow-sm ring-1 ring-black/5 font-bold' : 'text-gray-600 hover:text-gray-800 hover:bg-white/50'}`;
        });

        // Filter Services
        if (!state.isLoading) {
            const existingIds = new Set(Array.from(document.querySelectorAll('[data-service-id]')).map(el => parseInt(el.getAttribute('data-service-id'))));
            
            const filtered = state.services.filter(s => {
                const matchesTab = s.service_type === state.activeTab;
                const matchesSearch = s.name_ar.toLowerCase().includes(state.searchQuery.toLowerCase());
                const notAdded = !existingIds.has(s.id);
                return matchesTab && matchesSearch && notAdded;
            });

            renderGrid(filtered);
        }
    };

    const renderGrid = (items) => {
        if (items.length === 0) {
            grid.innerHTML = '';
            emptyState.classList.remove('hidden');
            return;
        }
        
        emptyState.classList.add('hidden');
        grid.innerHTML = items.map(s => {
            const isAddOn = s.service_type === 'add_on';
            const defaultPrice = isAddOn ? 25 : 50;
            const defaultDuration = isAddOn ? 0 : 30;
            
            return `
            <div class="group bg-white border border-gray-100 rounded-xl p-4 hover:shadow-md transition-all duration-300 hover:border-secondary/30 relative overflow-hidden">
                <div class="flex items-start justify-between mb-3">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-secondary group-hover:bg-secondary group-hover:text-white transition-colors duration-300">
                            ${s.icon ? (s.icon.includes('/') ? `<img src="${s.icon}" class="w-full h-full object-cover rounded-lg">` : `<i class="fas ${s.icon} text-lg"></i>`) : '<i class="fas fa-cut"></i>'}
                        </div>
                        <div>
                            <h4 class="font-bold text-gray-800 group-hover:text-primary-dark transition-colors">${s.name_ar}</h4>
                            <span class="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100">${isAddOn ? 'إضافة' : 'خدمة أساسية'}</span>
                        </div>
                    </div>
                </div>
                
                <div class="flex items-center gap-2 mb-3">
                    <div class="relative flex-1">
                        <input type="number" class="w-full pl-2 pr-7 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-secondary transition-colors text-center" 
                            placeholder="السعر" value="${defaultPrice}" min="0" data-field="price" data-id="${s.id}">
                        <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">₪</span>
                    </div>
                    <div class="relative flex-1">
                        ${isAddOn 
                            ? `<input type="hidden" data-field="duration" data-id="${s.id}" value="0"><div class="w-full py-1.5 text-sm text-center text-gray-400 bg-gray-50 rounded-lg border border-gray-100 cursor-not-allowed">-</div>`
                            : `<select class="w-full py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-secondary transition-colors text-center appearance-none cursor-pointer" data-field="duration" data-id="${s.id}">
                                ${[15,30,45,60,90,120].map(m => `<option value="${m}" ${m===defaultDuration?'selected':''}>${m} د</option>`).join('')}
                               </select>`
                        }
                    </div>
                </div>

                <button class="w-full py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-secondary transition-colors shadow-sm flex items-center justify-center gap-2 group-hover:shadow-md active:scale-95 transform" 
                    data-action="add" data-id="${s.id}">
                    <i class="fas fa-plus text-xs"></i>
                    <span>إضافة للصالون</span>
                </button>
            </div>
            `;
        }).join('');

        // Wire Events
        grid.querySelectorAll('button[data-action="add"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(btn.dataset.id);
                const s = state.services.find(x => x.id === id);
                if (!s) return;

                const card = btn.closest('.group');
                const priceVal = parseFloat(card.querySelector('[data-field="price"]').value) || 0;
                const durEl = card.querySelector('[data-field="duration"]');
                const durationVal = parseInt(durEl.value) || 0;

                // Add Service
                ensureServiceCardRendered(s, priceVal, durationVal);
                if (typeof window.scheduleAutoSave === 'function') window.scheduleAutoSave();

                // Feedback
                btn.innerHTML = `<i class="fas fa-check"></i> <span>تمت الإضافة</span>`;
                btn.className = "w-full py-2 rounded-lg bg-green-500 text-white text-sm font-medium shadow-sm flex items-center justify-center gap-2 cursor-default";
                card.classList.add('opacity-50', 'pointer-events-none');
                
                // Remove after delay
                setTimeout(() => updateUI(), 800);
            });
        });
    };

    // Listeners
    closeBtn.onclick = () => {
        modal.classList.add('opacity-0');
        const content = modal.querySelector('div');
        content.classList.remove('scale-100');
        content.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    };
    
    tabs.forEach(t => t.onclick = () => {
        state.activeTab = t.dataset.tab;
        updateUI();
    });

    searchInput.oninput = (e) => {
        state.searchQuery = e.target.value;
        updateUI();
    };

    // Init
    await fetchServices();
};
