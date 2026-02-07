import { fetchAppointments, updateAppointmentStatus as apiUpdateStatus, fetchStaff } from './api.js';
import { showMessage, showToast } from './ui.js';
import { formatTimeWithPeriod } from './utils.js';

// --- State ---
let state = {
    filters: {
        date: 'today',      // today, yesterday, last7, last30, all, custom
        status: 'all',      // all, upcoming, completed, cancelled
        staffId: 'all',
        customDate: null
    },
    appointments: [],
    staff: [],
    loading: false,
    fetchController: null
};

// --- Utils ---

const toEnglishDigits = (str) => {
    if (!str) return '';
    return str.toString().replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)]);
};

const formatDateEnglish = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2); // YY
    return `${day}/${month}/${year}`;
};

const getRelativeDate = (daysOffset) => {
    const d = new Date();
    d.setDate(d.getDate() - daysOffset);
    return d.toISOString().split('T')[0];
};

const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'صباح الخير';
    if (hour < 17) return 'طاب مساؤك';
    return 'مساء الخير';
};

// --- Initialization ---

export const initAppointments = async () => {
    console.log('📅 Initializing Appointments Module...');
    
    // 1. Bind UI Events
    bindEvents();
    
    // 2. Fetch Initial Data (Staff first, then Appointments)
    await loadStaff();
    
    // Initial Filter Render
    renderFilters();

    // 3. Load Appointments based on default filters
    loadAppointments();

    // 4. Inject Modal
    injectDetailsModal();
};

const injectDetailsModal = () => {
    if (document.getElementById('appt-details-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'appt-details-modal';
    modal.className = 'fixed inset-0 z-[60] hidden';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity opacity-0" id="appt-modal-backdrop"></div>
        <div class="absolute inset-x-0 bottom-0 md:top-1/2 md:left-1/2 md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2 w-full md:w-[500px] bg-white md:rounded-3xl rounded-t-3xl shadow-2xl transform transition-all translate-y-full md:translate-y-10 opacity-0 duration-300 flex flex-col max-h-[90vh]" id="appt-modal-content">
            
            <!-- Header -->
            <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-white rounded-t-3xl">
                <div>
                    <h3 class="text-xl font-bold text-slate-800">تفاصيل الموعد</h3>
                    <p class="text-xs text-gray-500 mt-1" id="md-appt-date">...</p>
                </div>
                <button id="md-close-btn" class="w-10 h-10 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-colors">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <!-- Body -->
            <div class="p-6 overflow-y-auto custom-scrollbar space-y-6">
                
                <!-- Status Badge -->
                <div class="flex justify-center">
                    <div id="md-status-badge" class="px-4 py-1.5 rounded-full font-bold text-sm bg-gray-100 text-gray-600">
                        ...
                    </div>
                </div>

                <!-- Client Info -->
                <div class="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                    <div class="flex items-center gap-4 mb-3">
                        <div class="w-12 h-12 rounded-full bg-white flex items-center justify-center text-xl text-secondary shadow-sm">
                            <i class="fas fa-user"></i>
                        </div>
                        <div>
                            <h4 class="font-bold text-slate-800 text-lg" id="md-client-name">...</h4>
                            <a href="#" id="md-client-phone" class="text-sm text-gray-500 hover:text-secondary flex items-center gap-2">
                                <i class="fas fa-phone-alt"></i> <span>...</span>
                            </a>
                        </div>
                        <div id="md-client-strikes" class="mr-auto flex gap-1">
                            <!-- Strikes injected here -->
                        </div>
                    </div>
                </div>

                <!-- Service Details -->
                <div class="space-y-3">
                    <div class="flex justify-between items-center p-3 rounded-xl border border-gray-100 hover:border-secondary/30 transition-colors">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                                <i class="fas fa-cut"></i>
                            </div>
                            <div>
                                <p class="text-xs text-gray-400 font-bold">الخدمة</p>
                                <p class="font-bold text-slate-700" id="md-service-name">...</p>
                            </div>
                        </div>
                        <div class="text-left">
                            <p class="font-black text-slate-800" id="md-price">...</p>
                        </div>
                    </div>

                    <div class="flex justify-between items-center p-3 rounded-xl border border-gray-100 hover:border-secondary/30 transition-colors">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                                <i class="fas fa-clock"></i>
                            </div>
                            <div>
                                <p class="text-xs text-gray-400 font-bold">الوقت</p>
                                <p class="font-bold text-slate-700" id="md-time">...</p>
                            </div>
                        </div>
                        <div class="text-left">
                             <p class="text-sm font-bold text-gray-500" id="md-duration">...</p>
                        </div>
                    </div>

                    <div class="flex justify-between items-center p-3 rounded-xl border border-gray-100 hover:border-secondary/30 transition-colors">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
                                <i class="fas fa-user-tag"></i>
                            </div>
                            <div>
                                <p class="text-xs text-gray-400 font-bold">الموظف</p>
                                <p class="font-bold text-slate-700" id="md-staff-name">...</p>
                            </div>
                        </div>
                    </div>
                </div>

            </div>

            <!-- Actions Footer -->
            <div class="p-4 border-t border-gray-100 bg-gray-50 rounded-b-3xl grid grid-cols-2 gap-3" id="md-actions">
                <!-- Injected dynamically -->
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Close Events
    const close = () => {
        const content = modal.querySelector('#appt-modal-content');
        const backdrop = modal.querySelector('#appt-modal-backdrop');
        
        content.classList.remove('md:translate-y-0', 'translate-y-0', 'opacity-100');
        content.classList.add('translate-y-full', 'md:translate-y-10', 'opacity-0');
        backdrop.classList.remove('opacity-100');
        backdrop.classList.add('opacity-0');
        
        setTimeout(() => modal.classList.add('hidden'), 300);
    };

    modal.querySelector('#md-close-btn').onclick = close;
    modal.querySelector('#appt-modal-backdrop').onclick = close;
    
    // Expose close globally for internal use
    window.closeApptDetails = close;
};

// Open Details Function
window.openApptDetails = (id) => {
    const appt = state.appointments.find(a => a.id == id);
    if (!appt) return;

    const modal = document.getElementById('appt-details-modal');
    const content = modal.querySelector('#appt-modal-content');
    const backdrop = modal.querySelector('#appt-modal-backdrop');

    // Populate Data
    const dateStr = formatDateEnglish(appt.start_time.split('T')[0]);
    document.getElementById('md-appt-date').textContent = dateStr;
    document.getElementById('md-client-name').textContent = appt.user_name;
    const cleanPhone = appt.user_phone ? appt.user_phone.replace(/\D/g, '') : '';
    document.getElementById('md-client-phone').href = `https://wa.me/${cleanPhone}`;
    document.getElementById('md-client-phone').target = '_blank';
    document.getElementById('md-client-phone').querySelector('span').textContent = appt.user_phone;
    
    // Strikes
    const strikesContainer = document.getElementById('md-client-strikes');
    const strikes = appt.user_strikes || 0;
    strikesContainer.innerHTML = '';
    
    // 3 Dots
    for (let i = 0; i < 3; i++) {
        const isStrike = i < strikes;
        const dot = document.createElement('div');
        dot.className = `w-3 h-3 rounded-full ${isStrike ? 'bg-red-500 shadow-sm shadow-red-500/50' : 'bg-gray-200'}`;
        // Tooltip or title
        dot.title = isStrike ? 'Strike' : 'Clean';
        strikesContainer.appendChild(dot);
    }
    if (strikes >= 3) {
        strikesContainer.innerHTML += '<span class="text-[10px] text-red-600 font-bold mr-1 self-center">محظور</span>';
    } else if (strikes > 0) {
        strikesContainer.innerHTML += `<span class="text-[10px] text-red-500 font-bold mr-1 self-center">${strikes} مخالفة</span>`;
    }

    document.getElementById('md-service-name').textContent = appt.service_name; // or appt.services_names if multi
    document.getElementById('md-price').textContent = parseFloat(appt.price).toFixed(0) + ' ₪';
    
    const timeDisplay = formatTimeWithPeriod(appt.start_time);
    document.getElementById('md-time').textContent = timeDisplay;
    
    const duration = appt.end_time ? Math.round((new Date(appt.end_time) - new Date(appt.start_time)) / 60000) : 0;
    document.getElementById('md-duration').textContent = duration + ' دقيقة';
    
    document.getElementById('md-staff-name').textContent = appt.staff_name || 'أي موظف';

    // Status Badge
    const badge = document.getElementById('md-status-badge');
    if (appt.status === 'Scheduled') {
        badge.className = 'px-4 py-1.5 rounded-full font-bold text-sm bg-emerald-100 text-emerald-700 border border-emerald-200';
        badge.innerHTML = '<i class="fas fa-clock mr-1"></i> قادم';
    } else if (appt.status === 'Completed') {
        badge.className = 'px-4 py-1.5 rounded-full font-bold text-sm bg-blue-100 text-blue-700 border border-blue-200';
        badge.innerHTML = '<i class="fas fa-check-circle mr-1"></i> مكتمل';
    } else if (appt.status === 'Cancelled') {
        badge.className = 'px-4 py-1.5 rounded-full font-bold text-sm bg-red-100 text-red-700 border border-red-200';
        badge.innerHTML = '<i class="fas fa-times-circle mr-1"></i> ملغي';
    }

    // Actions
    const actionsContainer = document.getElementById('md-actions');
    actionsContainer.innerHTML = '';

    if (appt.status === 'Scheduled') {
        actionsContainer.innerHTML = `
            <button onclick="window.updateApptStatus(${appt.id}, 'Completed')" class="bg-secondary hover:bg-emerald-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-emerald-200 transition-all active:scale-95 flex items-center justify-center gap-2">
                <i class="fas fa-check"></i> إكمال الموعد
            </button>
            <button onclick="window.updateApptStatus(${appt.id}, 'Cancelled')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 py-3 rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2">
                <i class="fas fa-times"></i> إلغاء
            </button>
        `;
    } else {
        actionsContainer.innerHTML = `
            <button disabled class="col-span-2 bg-gray-100 text-gray-400 py-3 rounded-xl font-bold cursor-not-allowed border border-gray-200">
                لا يمكن تغيير حالة هذا الموعد
            </button>
        `;
    }

    // Show
    modal.classList.remove('hidden');
    // Animate in
    requestAnimationFrame(() => {
        backdrop.classList.remove('opacity-0');
        backdrop.classList.add('opacity-100');
        
        content.classList.remove('translate-y-full', 'md:translate-y-10', 'opacity-0');
        content.classList.add('md:translate-y-0', 'translate-y-0', 'opacity-100');
    });
};

window.updateApptStatus = async (id, status) => {
    if (!confirm(status === 'Completed' ? 'هل أنت متأكد من إكمال الموعد؟' : 'هل أنت متأكد من إلغاء الموعد؟')) return;
    
    window.closeApptDetails();
    
    try {
        const res = await apiUpdateStatus(id, status);
        if (res.success) {
            showToast(status === 'Completed' ? 'تم إكمال الموعد بنجاح' : 'تم إلغاء الموعد', 'success');
            loadAppointments();
        } else {
            showToast('حدث خطأ أثناء تحديث الحالة', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('خطأ في الاتصال', 'error');
    }
};

const bindEvents = () => {
    // Custom Date Input
    const customDateInput = document.getElementById('appt-date-custom');
    if (customDateInput) {
        customDateInput.addEventListener('change', (e) => {
            state.filters.customDate = e.target.value;
            if (state.filters.date === 'custom') {
                loadAppointments();
            }
        });
    }

    // Date Navigation Scroll
    const dateContainer = document.getElementById('appt-date-filter-container');
    const prevBtn = document.getElementById('date-nav-prev');
    const nextBtn = document.getElementById('date-nav-next');

    if (dateContainer && prevBtn && nextBtn) {
        prevBtn.onclick = () => dateContainer.scrollBy({ left: 100, behavior: 'smooth' });
        nextBtn.onclick = () => dateContainer.scrollBy({ left: -100, behavior: 'smooth' });
    }
};

// --- Data Loading ---

const loadStaff = async () => {
    try {
        const salonId = window.salonId;
        if (!salonId) return;
        
        const data = await fetchStaff(salonId);
        if (data.success) {
            state.staff = data.staff || [];
            renderStaffFilter();
        }
    } catch (e) {
        console.error('Failed to load staff:', e);
    }
};

// --- Filters Rendering ---

const DATE_FILTERS = [
    { id: 'yesterday', label: 'أمس' },
    { id: 'today', label: 'اليوم' },
    { id: 'tomorrow', label: 'غداً' }, // Added tomorrow logic helper needed if used
    { id: 'all', label: 'الكل' },
    { id: 'custom', label: 'محدد' }
];

const STATUS_FILTERS = [
    { id: 'all', label: 'الكل', icon: 'fa-th-large' },
    { id: 'upcoming', label: 'القادمة', icon: 'fa-clock' },
    { id: 'completed', label: 'مكتملة', icon: 'fa-check-circle' },
    { id: 'cancelled', label: 'ملغاة', icon: 'fa-times-circle' }
];

const renderFilters = () => {
    renderDateFilter();
    renderStatusFilter();
    renderStaffFilter();
};

const renderDateFilter = () => {
    const container = document.getElementById('appt-date-filter-container');
    if (!container) return;
    container.innerHTML = '';
    
    // We modify DATE_FILTERS slightly for display
    const displayFilters = [
        { id: 'yesterday', label: 'أمس', icon: 'fa-history' },
        { id: 'today', label: 'اليوم', icon: 'fa-calendar-day' },
        { id: 'tomorrow', label: 'غداً', icon: 'fa-calendar-plus' },
        { id: 'all', label: 'الكل', icon: 'fa-layer-group' },
        { id: 'custom', label: 'تاريخ..', icon: 'fa-calendar-days' }
    ];

    displayFilters.forEach(opt => {
        // Special case: if active is custom but not in list, handle it? 
        // For now, simple.
        let isActive = state.filters.date === opt.id;
        
        // Handle custom date display
        let label = opt.label;
        if (opt.id === 'custom' && state.filters.date === 'custom' && state.filters.customDate) {
             label = formatDateEnglish(state.filters.customDate);
             isActive = true;
        }

        const btn = document.createElement('button');
        // Pill Style
        btn.className = `shrink-0 px-4 py-1.5 rounded-full text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2 ${
            isActive 
            ? 'bg-slate-800 text-white shadow-md transform scale-105' 
            : 'bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        }`;
        
        btn.innerHTML = `<i class="fas ${opt.icon} text-xs ${isActive ? 'text-white' : 'text-gray-400'}"></i> <span>${label}</span>`;
        
        btn.onclick = () => {
            if (opt.id === 'custom') {
                 // Trigger hidden input
                 const trigger = document.getElementById('date-custom-trigger');
                 const input = document.getElementById('appt-date-custom');
                 if (input) input.showPicker ? input.showPicker() : input.click();
                 return;
            }

            state.filters.date = opt.id;
            // Handle Tomorrow Logic in Load (need to add it)
            loadAppointments();
        };
        container.appendChild(btn);
    });

    // Scroll to active
    // setTimeout(() => {
    //     const active = container.querySelector('.bg-slate-800');
    //     if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    // }, 100);
};

const renderStatusFilter = () => {
    const container = document.getElementById('appt-status-filter-container');
    if (!container) return;
    container.innerHTML = '';

    // Calculate Counts
    const counts = {
        all: state.appointments.length,
        upcoming: state.appointments.filter(a => a.status === 'Scheduled').length,
        completed: state.appointments.filter(a => a.status === 'Completed' || a.status === 'Absent').length,
        cancelled: state.appointments.filter(a => a.status === 'Cancelled').length
    };

    STATUS_FILTERS.forEach(opt => {
        const isActive = state.filters.status === opt.id;
        const count = counts[opt.id] || 0;
        
        const btn = document.createElement('button');
        // Tab Style
        btn.className = `shrink-0 px-3 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
            isActive 
            ? 'bg-secondary/10 text-secondary' 
            : 'text-gray-400 hover:text-gray-600'
        }`;
        
        btn.innerHTML = `
            <i class="fas ${opt.icon} text-xs ${isActive ? 'text-secondary' : 'text-gray-400'}"></i>
            <span>${opt.label}</span>
            ${count > 0 ? `<span class="text-[10px] bg-gray-100 px-1.5 rounded-md ${isActive ? 'text-secondary font-black' : 'text-gray-400'}">${count}</span>` : ''}
        `;
        
        btn.onclick = () => {
            state.filters.status = opt.id;
            renderStatusFilter();
            renderAppointmentsList();
        };
        container.appendChild(btn);
    });
};

const renderStaffFilter = () => {
    const container = document.getElementById('appt-staff-filter-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    // "All" Button
    const isAllActive = state.filters.staffId === 'all';
    const allBtn = document.createElement('button');
    allBtn.className = `shrink-0 px-3 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 border ${
        isAllActive 
        ? 'bg-slate-800 text-white border-slate-800 shadow-md transform scale-105' 
        : 'bg-white text-gray-500 border-gray-100 hover:bg-gray-50'
    }`;
    allBtn.innerHTML = `<i class="fas fa-users text-xs"></i> <span>الكل</span>`;
    allBtn.onclick = () => {
        state.filters.staffId = 'all';
        loadAppointments();
    };
    container.appendChild(allBtn);
    
    // Staff Buttons
    state.staff.forEach(s => {
        const isActive = state.filters.staffId == s.id;
        const btn = document.createElement('button');
        
        btn.className = `shrink-0 px-3 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 border whitespace-nowrap ${
            isActive 
            ? 'bg-indigo-600 text-white border-indigo-600 shadow-md transform scale-105' 
            : 'bg-white text-gray-500 border-gray-100 hover:bg-gray-50'
        }`;
        
        btn.innerHTML = `
            <i class="fas fa-user-tie text-xs ${isActive ? 'text-white' : 'text-indigo-400'}"></i>
            <span>${s.name}</span>
        `;
        
        btn.onclick = () => {
            state.filters.staffId = s.id;
            loadAppointments();
        };
        container.appendChild(btn);
    });
};

const createStaffFilterBtn = (id, name, isActive) => {
    const btn = document.createElement('button');
    btn.className = `shrink-0 px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all active:scale-95 border ${
        isActive 
        ? 'bg-slate-800 text-white border-slate-800' 
        : 'bg-white text-gray-600 border-gray-200 hover:border-secondary hover:text-secondary'
    }`;
    btn.textContent = name;
    btn.onclick = () => {
        state.filters.staffId = id;
        renderStaffFilter(); // Re-render to update active state
        loadAppointments();
    };
    return btn;
};

// Expose globally for reload
window.reloadAppointments = () => loadAppointments();

export const loadAppointments = async () => {
    const container = document.getElementById('appointments-list-container');
    if (!container) return;

    // Show Loading
    state.loading = true;
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12 text-gray-400">
            <i class="fas fa-circle-notch fa-spin text-3xl mb-4 text-secondary"></i>
            <p class="font-bold">جاري تحديث القائمة...</p>
        </div>
    `;

    // Abort previous fetch
    if (state.fetchController) state.fetchController.abort();
    state.fetchController = new AbortController();

    try {
        const salonId = window.salonId;
        if (!salonId) throw new Error('No Salon ID');

        // Build Query String
        const queryParams = new URLSearchParams();
        
        // Date Logic
        const today = new Date().toISOString().split('T')[0];
        
        switch (state.filters.date) {
            case 'today':
                queryParams.append('startDate', today);
                queryParams.append('endDate', today);
                break;
            case 'yesterday':
                const y = getRelativeDate(1);
                queryParams.append('startDate', y);
                queryParams.append('endDate', y);
                break;
            case 'tomorrow':
                const t = getRelativeDate(-1);
                queryParams.append('startDate', t);
                queryParams.append('endDate', t);
                break;
            case 'last7':
                queryParams.append('startDate', getRelativeDate(7));
                queryParams.append('endDate', today);
                break;
            case 'last30':
                queryParams.append('startDate', getRelativeDate(30));
                queryParams.append('endDate', today);
                break;
            case 'custom':
                if (state.filters.customDate) {
                    queryParams.append('startDate', state.filters.customDate);
                    queryParams.append('endDate', state.filters.customDate); // Single day for now, or could add range UI
                }
                break;
            case 'all':
                // No date params = all time
                break;
        }

        // Status - WE FETCH ALL AND FILTER CLIENT SIDE TO SHOW COUNTS
        // if (state.filters.status !== 'all') {
        //    queryParams.append('status', state.filters.status);
        // }

        // Staff
        if (state.filters.staffId !== 'all') {
            queryParams.append('staffId', state.filters.staffId);
        }

        // Call API
        // We use 'query' as the filter path param, and append query string
        const filterPath = `query?${queryParams.toString()}`;
        console.log('Fetching:', filterPath);
        
        const data = await fetchAppointments(salonId, filterPath, state.fetchController.signal);
        
        if (data.success) {
            state.appointments = data.appointments || [];
            renderFilters(); // Update counts based on new data
            renderAppointmentsList();
        } else {
            throw new Error(data.message || 'Failed to load');
        }

    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error('Load Error:', e);
        container.innerHTML = `
            <div class="text-center py-10 text-red-500 bg-red-50 rounded-2xl border border-red-100 mx-4">
                <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
                <p>حدث خطأ أثناء تحميل المواعيد</p>
                <button onclick="window.reloadAppointments()" class="mt-3 text-sm font-bold underline">إعادة المحاولة</button>
            </div>
        `;
    } finally {
        state.loading = false;
    }
};

// --- Rendering ---

const renderAppointmentsList = () => {
    const container = document.getElementById('appointments-list-container');
    const countEl = document.getElementById('appt-filtered-count');
    
    if (!container) return;

    // Filter Client-Side by Status
    let filtered = state.appointments;
    if (state.filters.status !== 'all') {
        filtered = filtered.filter(a => {
            if (state.filters.status === 'upcoming') return a.status === 'Scheduled';
            if (state.filters.status === 'completed') return a.status === 'Completed' || a.status === 'Absent';
            if (state.filters.status === 'cancelled') return a.status === 'Cancelled';
            return true;
        });
    }

    if (countEl) countEl.textContent = filtered.length;
    container.innerHTML = '';

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="text-center py-16 text-gray-400">
                <div class="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-100">
                    <i class="fas fa-calendar-check text-3xl text-gray-300"></i>
                </div>
                <p class="font-bold text-gray-500">لا توجد مواعيد تطابق الفلتر المحدد</p>
                <p class="text-sm mt-1">جرب تغيير التاريخ أو الحالة</p>
            </div>
        `;
        return;
    }

    // Sort: Date Descending (Newest first)
    const sorted = [...filtered].sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

    // Group by Date for better UI
    const grouped = groupByDate(sorted);

    Object.keys(grouped).forEach(dateKey => {
        const group = grouped[dateKey];
        
        // Date Header
        const dateHeader = document.createElement('div');
        dateHeader.className = 'sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm py-2 px-2 mb-2 border-b border-gray-200/50 flex items-center gap-2';
        
        const isToday = new Date(dateKey).toDateString() === new Date().toDateString();
        const dateDisplay = formatDateEnglish(dateKey); // DD/MM/YY
        
        dateHeader.innerHTML = `
            <span class="text-xs font-black text-slate-400 uppercase tracking-wider bg-white px-2 py-1 rounded-lg border border-gray-100 shadow-sm font-mono">${dateDisplay}</span>
            ${isToday ? '<span class="text-xs font-bold text-secondary bg-secondary/10 px-2 py-0.5 rounded-md">اليوم</span>' : ''}
        `;
        container.appendChild(dateHeader);

        // Cards
        group.forEach(appt => {
            container.appendChild(createAppointmentCard(appt));
        });
    });
};

const groupByDate = (list) => {
    return list.reduce((groups, item) => {
        const date = item.start_time.split('T')[0];
        if (!groups[date]) groups[date] = [];
        groups[date].push(item);
        return groups;
    }, {});
};

const createAppointmentCard = (appt) => {
    const el = document.createElement('div');
    
    // Status Logic
    let statusColor = 'border-l-4 border-gray-300';
    let statusIcon = '';
    
    if (appt.status === 'Scheduled') {
        statusColor = 'border-l-4 border-secondary';
    } else if (appt.status === 'Completed') {
        statusColor = 'border-l-4 border-blue-500 opacity-75';
        statusIcon = '<i class="fas fa-check-circle text-blue-500"></i>';
    } else if (appt.status === 'Cancelled') {
        statusColor = 'border-l-4 border-red-500 opacity-60 bg-red-50/30';
        statusIcon = '<i class="fas fa-times-circle text-red-500"></i>';
    }

    // Time Formatting (Start - End)
    const startTimeStr = formatTimeWithPeriod(appt.start_time); // "7:30 PM"
    
    // Calculate End Time
    let endTimeStr = '';
    const start = new Date(appt.start_time);
    const end = appt.end_time ? new Date(appt.end_time) : null;
    
    if (end) {
        endTimeStr = formatTimeWithPeriod(appt.end_time).split(' ')[0]; // Just "8:20"
    }
    
    const timeRange = endTimeStr ? `${startTimeStr.split(' ')[0]} - ${endTimeStr}` : startTimeStr.split(' ')[0];
    const period = startTimeStr.split(' ')[1] || '';

    const duration = appt.end_time ? 
        Math.round((new Date(appt.end_time) - new Date(appt.start_time)) / 60000) : 
        0;

    el.className = `bg-white p-4 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all cursor-pointer relative group ${statusColor}`;
    el.onclick = () => window.openApptDetails(appt.id);

    el.innerHTML = `
        <div class="flex justify-between items-start">
            <div class="flex items-start gap-4">
                <!-- Time Box -->
                <div class="flex flex-col items-center justify-center bg-gray-50 rounded-xl px-3 py-2 min-w-[80px] border border-gray-100">
                    <span class="text-lg font-black text-slate-800 font-mono tracking-tight leading-none">${startTimeStr.split(' ')[0]}</span>
                    ${endTimeStr ? `
                    <div class="text-gray-300 my-1"><i class="fas fa-arrow-down text-[10px]"></i></div>
                    <span class="text-lg font-black text-slate-800 font-mono tracking-tight leading-none">${endTimeStr}</span>
                    ` : ''}
                    <span class="text-[10px] text-secondary font-bold mt-1 uppercase tracking-wider bg-secondary/10 px-1.5 rounded-md">${period}</span>
                </div>

                <!-- Info -->
                <div>
                    <h4 class="font-bold text-slate-800 text-lg leading-tight mb-1">${appt.user_name}</h4>
                    <div class="flex items-center gap-2 text-xs text-gray-500 mb-2">
                        <span class="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md font-bold">
                            <i class="fas fa-cut mr-1"></i> ${appt.service_name}
                        </span>
                        <span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md">
                            <i class="fas fa-clock mr-1"></i> ${duration} دقيقة
                        </span>
                    </div>
                    <div class="flex items-center gap-2 text-xs text-gray-400">
                        <i class="fas fa-user-tag"></i>
                        <span>${appt.staff_name || 'أي موظف'}</span>
                    </div>
                </div>
            </div>

            <!-- Price & Status -->
            <div class="text-left flex flex-col items-end gap-2">
                ${statusIcon}
                <span class="font-black text-slate-800 text-lg">${parseFloat(appt.price).toFixed(0)} <span class="text-xs font-normal text-gray-400">₪</span></span>
            </div>
        </div>
        
        <!-- Hover Action Hint -->
        <div class="absolute inset-0 bg-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none"></div>
    `;

    return el;
};
