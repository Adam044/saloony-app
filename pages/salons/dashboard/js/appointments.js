import { fetchAppointments, updateAppointmentStatus as apiUpdateStatus, createBlockedTime, deleteBlockedTime, fetchSchedule, fetchStaff } from './api.js';
import { showMessage, showConfirmationModal, showToast } from './ui.js';
import { formatTimeWithPeriod } from './utils.js';
import { getStaffList } from './staff.js';

let currentAppointmentsFilter = 'today';
let appointmentsFetchController = null;
let currentTimelineStaffId = 'all';
let currentAppointmentsData = [];

// --- Constants & Config ---
const TIMELINE_START_HOUR = 9;
const TIMELINE_END_HOUR = 23;
const PIXELS_PER_HOUR_VERT = 100;

// --- Utils ---
const timeToPixelsVert = (timeStr) => {
    const [h, m] = timeStr.split(':').map(Number);
    const totalHours = h + (m / 60);
    return (totalHours - TIMELINE_START_HOUR) * PIXELS_PER_HOUR_VERT;
};

const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'صباح الخير';
    if (hour < 17) return 'طاب مساؤك';
    return 'مساء الخير';
};

// --- Render Functions ---

const renderAppointmentCard = (appointment, filter) => {
    const isScheduled = appointment.status === 'Scheduled';
    const startTimeDisplay = formatTimeWithPeriod(appointment.start_time);
    
    return `
        <div class="glass-card p-4 mb-3 border-r-4 ${isScheduled ? 'border-secondary' : 'border-gray-300'}" onclick="window.openApptDetails(${appointment.id})">
            <div class="flex justify-between items-center">
                <h4 class="font-bold text-gray-800">${appointment.user_name}</h4>
                <span class="text-sm font-bold text-secondary dir-ltr">${startTimeDisplay}</span>
            </div>
            <p class="text-sm text-gray-500 mt-1">${appointment.service_name}</p>
        </div>
    `;
};

const renderEmptyState = (container, text, icon) => {
    container.innerHTML = `
        <div class="empty-state text-center py-12 text-gray-500">
            <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fas ${icon} text-2xl text-gray-400"></i>
            </div>
            <p class="font-medium">${text}</p>
        </div>
    `;
};

// --- Main Timeline Controller ---

const renderTimeline = (appointments, blockedSlots, staffList) => {
    const container = document.getElementById('timeline-view');
    if (!container) return;
    container.innerHTML = '';
    
    // Check Role
    const isStaff = window.currentUserRole === 'staff';
    const myStaffId = window.currentStaffId;

    if (isStaff && myStaffId) {
        // --- EMPLOYEE VIEW ---
        const myAppts = appointments.filter(a => a.staff_id == myStaffId);
        const myBlocks = blockedSlots.filter(b => b.staff_id == myStaffId);
        const me = staffList.find(s => s.id == myStaffId) || { name: window.currentStaffName || 'الموظف' };
        
        renderEmployeeAgendaView(container, myAppts, myBlocks, me);
    } else {
        // --- MANAGER VIEW ---
        // Filter staff if selected
        let displayStaff = staffList;
        if (currentTimelineStaffId && currentTimelineStaffId !== 'all') {
            displayStaff = staffList.filter(s => s.id == currentTimelineStaffId);
        }
        
        renderManagerSchedulerView(container, appointments, blockedSlots, displayStaff, staffList);
    }
};

// --- View 1: Employee Agenda (Clean, Focused, Mobile-First) ---
const renderEmployeeAgendaView = (container, appointments, blockedSlots, staff) => {
    const total = appointments.length;
    const completed = appointments.filter(a => a.status === 'Completed').length;
    const nextAppt = appointments
        .filter(a => a.status === 'Scheduled' && new Date(a.start_time) > new Date())
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))[0];

    container.className = "h-full overflow-hidden bg-gray-50 flex flex-col";
    
    const html = `
        <!-- Header -->
        <div class="bg-white p-6 pb-8 rounded-b-3xl shadow-sm z-10 relative">
            <div class="flex justify-between items-start mb-6">
                <div>
                    <p class="text-gray-500 text-sm mb-1">${getGreeting()}،</p>
                    <h2 class="text-2xl font-bold text-gray-800">${staff.name}</h2>
                </div>
                <div class="w-10 h-10 rounded-full bg-secondary/10 flex items-center justify-center text-secondary">
                    <i class="fas fa-user"></i>
                </div>
            </div>
            
            <!-- Stats Cards -->
            <div class="grid grid-cols-2 gap-3">
                <div class="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                    <span class="block text-2xl font-bold text-blue-600 mb-1">${total}</span>
                    <span class="text-xs text-blue-400 font-medium">مواعيد اليوم</span>
                </div>
                <div class="bg-green-50 p-4 rounded-2xl border border-green-100">
                    <span class="block text-2xl font-bold text-green-600 mb-1">${completed}</span>
                    <span class="text-xs text-green-400 font-medium">مكتملة</span>
                </div>
            </div>

            ${nextAppt ? `
                <div class="mt-6">
                    <p class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">الموعد التالي</p>
                    <div class="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl p-5 text-white shadow-lg shadow-slate-200 cursor-pointer transform transition-transform active:scale-95" onclick="window.openApptDetails(${nextAppt.id})">
                        <div class="flex justify-between items-start mb-3">
                            <span class="bg-white/20 px-3 py-1 rounded-lg text-xs font-medium backdrop-blur-sm">
                                ${formatTimeWithPeriod(nextAppt.start_time)}
                            </span>
                            <span class="text-xs text-slate-300">${nextAppt.duration} دقيقة</span>
                        </div>
                        <h3 class="text-lg font-bold mb-1">${nextAppt.user_name}</h3>
                        <p class="text-slate-400 text-sm flex items-center gap-2">
                            <i class="fas fa-cut text-xs"></i> ${nextAppt.service_name}
                        </p>
                    </div>
                </div>
            ` : ''}
        </div>

        <!-- Timeline Feed -->
        <div class="flex-1 overflow-y-auto custom-scrollbar p-6 relative">
            ${appointments.length === 0 ? `
                <div class="flex flex-col items-center justify-center h-full text-gray-400 opacity-50">
                    <i class="fas fa-calendar-check text-4xl mb-4"></i>
                    <p>لا توجد مواعيد اليوم</p>
                </div>
            ` : `
                <div class="absolute left-8 top-0 bottom-0 w-0.5 bg-gray-200"></div>
                <div class="space-y-6 relative">
                    ${appointments.sort((a,b) => new Date(a.start_time) - new Date(b.start_time)).map(appt => {
                        const time = formatTimeWithPeriod(appt.start_time);
                        const isDone = appt.status === 'Completed';
                        const isCancelled = appt.status === 'Cancelled';
                        
                        return `
                        <div class="flex gap-6 relative group" onclick="window.openApptDetails(${appt.id})">
                            <!-- Time Node -->
                            <div class="w-16 flex-shrink-0 flex flex-col items-end pt-2 z-10">
                                <span class="text-sm font-bold text-gray-800 dir-ltr">${time}</span>
                                <div class="w-3 h-3 rounded-full border-2 border-white shadow-sm mt-1 ${
                                    isDone ? 'bg-green-500' : 
                                    isCancelled ? 'bg-red-500' : 'bg-secondary'
                                } absolute left-[29px]"></div>
                            </div>
                            
                            <!-- Card -->
                            <div class="flex-1 bg-white p-4 rounded-2xl shadow-sm border border-gray-100 active:scale-[0.98] transition-transform ${isDone ? 'opacity-60' : ''}">
                                <div class="flex justify-between items-start">
                                    <h4 class="font-bold text-gray-800">${appt.user_name}</h4>
                                    ${isDone ? '<i class="fas fa-check-circle text-green-500"></i>' : ''}
                                </div>
                                <p class="text-sm text-gray-500 mt-1">${appt.service_name}</p>
                                <div class="mt-3 flex gap-2">
                                    <span class="px-2 py-1 bg-gray-50 rounded-lg text-xs text-gray-500 font-medium">
                                        ${parseFloat(appt.price).toFixed(0)} ₪
                                    </span>
                                </div>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            `}
        </div>
    `;
    
    container.innerHTML = html;
};

// --- View 2: Manager Scheduler (Robust, Grid-Based, Comprehensive) ---
const renderManagerSchedulerView = (container, appointments, blockedSlots, displayStaff, allStaff) => {
    container.className = "h-full flex flex-col bg-white overflow-hidden";
    
    // 1. Staff Filter Bar (Sticky Top)
    const filterBar = document.createElement('div');
    filterBar.className = 'flex items-center gap-2 p-3 border-b border-gray-100 bg-white overflow-x-auto custom-scrollbar flex-shrink-0';
    
    // "All" Button
    const allBtn = document.createElement('button');
    const isAll = currentTimelineStaffId === 'all';
    allBtn.className = `px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 ${isAll ? 'bg-slate-800 text-white shadow-md' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`;
    allBtn.innerHTML = '<i class="fas fa-users ml-2"></i>الكل';
    allBtn.onclick = () => { currentTimelineStaffId = 'all'; renderTimeline(appointments, blockedSlots, allStaff); };
    filterBar.appendChild(allBtn);

    // Staff Buttons
    allStaff.forEach(staff => {
        const btn = document.createElement('button');
        const isActive = currentTimelineStaffId == staff.id;
        btn.className = `px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 flex items-center ${isActive ? 'bg-secondary text-white shadow-md' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`;
        btn.innerHTML = `<span class="w-2 h-2 rounded-full bg-current ml-2 opacity-50"></span>${staff.name}`;
        btn.onclick = () => { currentTimelineStaffId = staff.id; renderTimeline(appointments, blockedSlots, allStaff); };
        filterBar.appendChild(btn);
    });
    
    container.appendChild(filterBar);

    // 2. Scheduler Grid Container
    const gridContainer = document.createElement('div');
    gridContainer.className = 'flex-1 overflow-auto custom-scrollbar relative bg-gray-50/50';
    gridContainer.id = 'scheduler-grid';

    // 3. Render Grid
    // Header Row (Staff Names)
    const headerRow = document.createElement('div');
    headerRow.className = 'flex sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200';
    headerRow.innerHTML = `<div class="w-16 flex-shrink-0 bg-white border-l border-gray-100"></div>`; // Time col spacer
    
    displayStaff.forEach(staff => {
        const colHeader = document.createElement('div');
        colHeader.className = 'flex-1 min-w-[200px] p-3 text-center border-l border-gray-100';
        colHeader.innerHTML = `
            <div class="font-bold text-gray-800 text-sm truncate">${staff.name}</div>
            <div class="text-xs text-gray-400">${staff.role || 'موظف'}</div>
        `;
        headerRow.appendChild(colHeader);
    });
    gridContainer.appendChild(headerRow);

    // Time Slots & Columns
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'flex relative min-h-[1200px]'; // Fixed height for scrolling
    
    // Time Column (Left Sticky)
    const timeCol = document.createElement('div');
    timeCol.className = 'w-16 flex-shrink-0 bg-white border-l border-gray-100 sticky right-0 z-10 flex flex-col text-xs text-gray-400 font-medium';
    for (let i = TIMELINE_START_HOUR; i <= TIMELINE_END_HOUR; i++) {
        const timeSlot = document.createElement('div');
        timeSlot.style.height = `${PIXELS_PER_HOUR_VERT}px`;
        timeSlot.className = 'border-b border-gray-50 flex justify-center pt-2 relative';
        timeSlot.innerHTML = `<span class="bg-white px-1 z-10">${i}:00</span><div class="absolute top-0 right-0 w-2 border-t border-gray-200"></div>`;
        timeCol.appendChild(timeSlot);
    }
    bodyContainer.appendChild(timeCol);

    // Staff Columns
    displayStaff.forEach(staff => {
        const col = document.createElement('div');
        col.className = 'flex-1 min-w-[200px] border-l border-gray-100 relative scheduler-grid-bg';
        col.style.height = `${(TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1) * PIXELS_PER_HOUR_VERT}px`;
        
        // Ghost Slot for Hover Effect
        const ghostSlot = document.createElement('div');
        ghostSlot.className = 'timeline-slot-hover';
        col.appendChild(ghostSlot);

        // Hover Interaction
        col.addEventListener('mousemove', (e) => {
            // Hide if hovering over an existing card
            if (e.target.closest('.appt-card-modern') || e.target.closest('.absolute.rounded-lg')) {
                ghostSlot.style.display = 'none';
                return;
            }
            
            const rect = col.getBoundingClientRect();
            const relativeY = e.clientY - rect.top;
            
            // Snap to 30 mins (50px)
            const snapY = Math.floor(relativeY / 50) * 50;
            
            // Don't show if out of bounds (bottom edge case)
            if (snapY >= col.offsetHeight) return;

            ghostSlot.style.top = `${snapY}px`;
            ghostSlot.style.display = 'block';
        });

        col.addEventListener('mouseleave', () => {
            ghostSlot.style.display = 'none';
        });

        // Click to Add (Empty Slots)
        col.addEventListener('click', (e) => {
            if (e.target !== col) return; // Ignore clicks on cards
            const rect = col.getBoundingClientRect();
            const y = e.clientY - rect.top + gridContainer.scrollTop; // Adjust for scroll
            const hourOffset = y / PIXELS_PER_HOUR_VERT;
            const clickedHour = TIMELINE_START_HOUR + Math.floor(hourOffset);
            const clickedMin = Math.floor((hourOffset % 1) * 60);
            
            // Round to nearest 15
            const roundedMin = Math.round(clickedMin / 15) * 15;
            const timeStr = `${String(clickedHour).padStart(2, '0')}:${String(roundedMin).padStart(2, '0')}`;
            
            // Open Block/Book Modal
            openBlockSlotModal({ staffId: staff.id, time: timeStr, date: new Date().toISOString().split('T')[0] });
        });

        // 1. Render Blocked Slots
        const staffBlocks = blockedSlots.filter(b => b.staff_id == staff.id);
        staffBlocks.forEach(block => {
            const top = timeToPixelsVert(block.start_time);
            const bottom = timeToPixelsVert(block.end_time);
            const height = bottom - top;
            
            const el = document.createElement('div');
            el.className = 'absolute left-1 right-1 rounded-lg flex items-center justify-center text-xs font-bold shadow-sm cursor-pointer transition-transform hover:scale-[0.98] z-0';
            
            // Check reason for color
            const reason = (block.reason || '').toLowerCase();
            if (reason.includes('break') || reason.includes('استراحة') || reason.includes('فطور') || reason.includes('غداء')) {
                el.className += ' break-card-pattern';
                el.innerHTML = `<i class="fas fa-coffee mr-1"></i> ${block.reason || 'استراحة'}`;
            } else {
                el.className += ' block-card-pattern';
                el.innerHTML = `<i class="fas fa-ban mr-1"></i> ${block.reason || 'مغلق'}`;
            }
            
            el.style.top = `${top}px`;
            el.style.height = `${height}px`;
            
            // Delete block on click
            el.onclick = (e) => {
                e.stopPropagation();
                showConfirmationModal('هل تريد حذف هذا الوقت المحجوز؟', () => {
                    deleteBlockedTime(block.id).then(res => {
                        if (res.success) loadAppointments('today');
                    });
                }, 'حذف الحجز');
            };
            
            col.appendChild(el);
        });

        // 2. Render Appointments
        const staffAppts = appointments.filter(a => a.staff_id == staff.id);
        staffAppts.forEach(appt => {
            const top = timeToPixelsVert(formatTimeWithPeriod(appt.start_time));
            const duration = appt.duration || 30;
            const height = (duration / 60) * PIXELS_PER_HOUR_VERT;
            
            const card = document.createElement('div');
            // Determine Color Style
            let statusClass = 'appt-card-scheduled'; 
            if (appt.status === 'Completed') statusClass = 'appt-card-completed';
            if (appt.status === 'Cancelled') statusClass = 'appt-card-cancelled';
            
            card.className = `absolute left-1 right-1 p-2 text-xs cursor-pointer z-10 appt-card-modern ${statusClass}`;
            card.style.top = `${top}px`;
            card.style.height = `${Math.max(height, 40)}px`;
            
            card.innerHTML = `
                <div class="font-bold truncate">${appt.user_name}</div>
                <div class="opacity-90 truncate text-[10px]">${appt.service_name}</div>
                ${height > 50 ? `<div class="mt-1 opacity-80 truncate">${formatTimeWithPeriod(appt.start_time)}</div>` : ''}
            `;
            
            card.onclick = (e) => {
                e.stopPropagation();
                showAppointmentDetails(appt);
            };
            
            col.appendChild(card);
        });

        bodyContainer.appendChild(col);
    });

    gridContainer.appendChild(bodyContainer);
    container.appendChild(gridContainer);
    
    // Auto-scroll to 9 AM
    setTimeout(() => {
        gridContainer.scrollTop = 0;
    }, 100);
};

// --- Shared Logic ---

let blockModal, blockDateInput, blockStartInput, blockEndInput, blockStaffSelect, blockReasonInput, blockSubmitBtn, blockCancelBtn;

const openBlockSlotModal = (data = {}) => {
    if (!blockModal) return;
    
    // Reset
    blockDateInput.value = data.date || new Date().toISOString().split('T')[0];
    blockStartInput.value = data.time || '12:00';
    blockEndInput.value = ''; 
    blockReasonInput.value = '';
    
    // Pre-select staff
    if (blockStaffSelect) {
        blockStaffSelect.value = data.staffId || '';
        // If employee view, lock it
        if (window.currentUserRole === 'staff' && window.currentStaffId) {
            blockStaffSelect.value = window.currentStaffId;
            blockStaffSelect.disabled = true;
        } else {
            blockStaffSelect.disabled = false;
        }
    }
    
    blockModal.classList.remove('hidden');
    blockModal.classList.add('flex');
};

const closeBlockSlotModal = () => {
    if (blockModal) {
        blockModal.classList.add('hidden');
        blockModal.classList.remove('flex');
    }
};

const submitBlockSlot = async () => {
    const date = blockDateInput.value;
    const start = blockStartInput.value;
    const end = blockEndInput.value;
    const staffId = blockStaffSelect.value;
    const reason = blockReasonInput.value;

    if (!date || !start || !end || !staffId) {
        showToast('يرجى تعبئة جميع الحقول المطلوبة', 'error');
        return;
    }

    try {
        const res = await createBlockedTime({
            salon_id: window.salonId,
            staff_id: staffId,
            date,
            start_time: start,
            end_time: end,
            reason
        });

        if (res.success) {
            showToast('تم حجز الوقت بنجاح', 'success');
            closeBlockSlotModal();
            loadAppointments('today');
        } else {
            showToast(res.message || 'فشل في حجز الوقت', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('حدث خطأ غير متوقع', 'error');
    }
};

const showAppointmentDetails = (appt) => {
    const modal = document.getElementById('appointment-details-modal');
    const content = document.getElementById('appt-modal-content');
    const actions = document.getElementById('appt-modal-actions');
    const closeBtn = document.getElementById('close-appt-modal-btn');
    
    if (!modal) return;
    
    const date = new Date(appt.start_time).toLocaleDateString('ar-EG');
    const time = formatTimeWithPeriod(appt.start_time);
    
    content.innerHTML = `
        <div class="flex items-center gap-4 mb-4">
            <div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-2xl text-slate-600">
                <i class="fas fa-user"></i>
            </div>
            <div>
                <h4 class="font-bold text-xl text-slate-800">${appt.user_name}</h4>
                <p class="text-slate-500 dir-ltr text-right">${appt.user_phone}</p>
            </div>
        </div>
        
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2 text-sm">
            <div class="flex justify-between">
                <span class="text-slate-500">الخدمة:</span>
                <span class="font-bold text-slate-800">${appt.service_name}</span>
            </div>
            <div class="flex justify-between">
                <span class="text-slate-500">التاريخ:</span>
                <span class="font-bold text-slate-800">${date}</span>
            </div>
            <div class="flex justify-between">
                <span class="text-slate-500">الوقت:</span>
                <span class="font-bold text-slate-800 dir-ltr">${time}</span>
            </div>
            <div class="flex justify-between">
                <span class="text-slate-500">الموظف:</span>
                <span class="font-bold text-slate-800">${appt.staff_name || 'غير محدد'}</span>
            </div>
            <div class="flex justify-between border-t border-slate-200 pt-2 mt-2">
                <span class="text-slate-500">السعر:</span>
                <span class="font-bold text-secondary text-lg">${parseFloat(appt.price).toFixed(0)} ₪</span>
            </div>
        </div>
        
        <div class="text-center mt-4">
             <span class="inline-block px-3 py-1 rounded-full text-xs font-bold ${
                 appt.status === 'Scheduled' ? 'bg-blue-100 text-blue-700' :
                 appt.status === 'Completed' ? 'bg-green-100 text-green-700' :
                 appt.status === 'Cancelled' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
             }">
                 ${appt.status === 'Scheduled' ? 'مؤكد' : appt.status === 'Completed' ? 'منتهي' : appt.status}
             </span>
        </div>
    `;
    
    actions.innerHTML = '';
    if (appt.status === 'Scheduled') {
        const completeBtn = document.createElement('button');
        completeBtn.className = 'flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold transition-colors shadow-lg shadow-green-200';
        completeBtn.innerHTML = '<i class="fas fa-check ml-1"></i> إتمام';
        completeBtn.onclick = () => {
             updateStatus(appt.id, 'Completed', 'today');
             modal.classList.add('hidden');
        };
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'flex-1 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl font-bold transition-colors border border-red-200';
        cancelBtn.innerHTML = '<i class="fas fa-times ml-1"></i> إلغاء';
        cancelBtn.onclick = () => {
             updateStatus(appt.id, 'Cancelled', 'today');
             modal.classList.add('hidden');
        };
        
        actions.appendChild(completeBtn);
        actions.appendChild(cancelBtn);
    } else {
        const closeBtnAction = document.createElement('button');
        closeBtnAction.className = 'flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition-colors';
        closeBtnAction.innerHTML = 'إغلاق';
        closeBtnAction.onclick = () => modal.classList.add('hidden');
        actions.appendChild(closeBtnAction);
    }
    
    modal.classList.remove('hidden');
    
    if (closeBtn) {
        closeBtn.onclick = () => modal.classList.add('hidden');
    }
};

window.openApptDetails = (id) => {
    const appt = currentAppointmentsData.find(a => a.id == id);
    if (appt) showAppointmentDetails(appt);
};

// Expose reload for auth changes
window.reloadAppointments = () => loadAppointments(currentAppointmentsFilter);

export const loadAppointments = async (filter, opts = {}) => {
    const listContainer = document.getElementById('appointments-list-container');
    const timelineView = document.getElementById('timeline-view');
    
    // Update Tab UI
    document.querySelectorAll('.tab-appointments').forEach(btn => {
        btn.classList.remove('bg-primary-dark', 'text-white');
        btn.classList.add('text-gray-500', 'bg-gray-200');
        if (btn.getAttribute('data-filter') === filter) {
            btn.classList.add('bg-primary-dark', 'text-white');
            btn.classList.remove('text-gray-500', 'bg-gray-200');
        }
    });
    
    currentAppointmentsFilter = filter;

    if (appointmentsFetchController) {
        try { appointmentsFetchController.abort(); } catch (e) {}
    }
    appointmentsFetchController = new AbortController();
    const { signal } = appointmentsFetchController;
    
    try {
        const salonId = window.salonId;
        if (!salonId) throw new Error('Salon ID not found');

        if (filter === 'today') {
            if (listContainer) listContainer.classList.add('hidden');
            if (timelineView) {
                timelineView.classList.remove('hidden');
                timelineView.innerHTML = '<div class="flex items-center justify-center h-full text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i> جاري تحميل الجدول...</div>';
            }
            
            const [apptData, scheduleData, staffData] = await Promise.all([
                fetchAppointments(salonId, filter, signal),
                fetchSchedule(salonId),
                fetchStaff(salonId)
            ]);
            
            if (apptData.success) {
                currentAppointmentsData = apptData.appointments;
                
                if (timelineView) {
                    renderTimeline(
                        apptData.appointments,
                        scheduleData ? scheduleData.modifications : [],
                        staffData.staff || []
                    );
                }
                
                const countEl = document.getElementById('appointments-count');
                if (countEl) { 
                    countEl.textContent = apptData.appointments.length; 
                    countEl.classList.remove('hidden'); 
                }
            }
            
        } else {
            if (timelineView) timelineView.classList.add('hidden');
            if (listContainer) {
                listContainer.classList.remove('hidden');
                listContainer.innerHTML = '<div class="text-center py-12"><i class="fas fa-spinner fa-spin text-2xl text-primary-dark"></i><p class="mt-2 text-gray-500">جاري تحميل المواعيد...</p></div>';
            }

            const data = await fetchAppointments(salonId, filter, signal);
            
            if (data.success) {
                let appointments = data.appointments;
                currentAppointmentsData = appointments;
                
                if (window.currentUserRole === 'staff' && window.currentStaffId) {
                    appointments = appointments.filter(appt => appt.staff_id === window.currentStaffId);
                }
                
                if (appointments.length > 0) {
                    listContainer.innerHTML = appointments.map(appt => renderAppointmentCard(appt, filter)).join('');
                    attachAppointmentListeners(filter);
                    const countEl = document.getElementById('appointments-count');
                    if (countEl) { countEl.textContent = appointments.length; countEl.classList.remove('hidden'); }
                } else {
                    let emptyText = window.currentUserRole === 'staff' ? 'لا توجد مواعيد مخصصة لك' : 'لا توجد مواعيد';
                    renderEmptyState(listContainer, emptyText, 'fa-calendar-times');
                }
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Error loading appointments:', error);
    }
};

const attachAppointmentListeners = (currentFilter) => {
    // Only used for list view actions if any
};

const updateStatus = async (appointmentId, status, currentFilter) => {
    try {
        const data = await apiUpdateStatus(appointmentId, status);
        if (data.success) {
            showMessage(null, data.message || 'تم تحديث حالة الموعد بنجاح.', true);
            loadAppointments(currentFilter);
        } else {
            showMessage(null, data.message || 'فشل في تحديث حالة الموعد.', false);
        }
    } catch (error) {
        showMessage(null, 'خطأ في الشبكة أثناء تحديث الحالة.', false);
    }
};

export const initAppointments = async () => {
    const container = document.getElementById('appointments-list-container');
    const timelineView = document.getElementById('timeline-view');
    if (!container && !timelineView) return;

    // Listeners for filter buttons
    document.querySelectorAll('.tab-appointments').forEach(btn => {
        btn.addEventListener('click', () => loadAppointments(btn.getAttribute('data-filter')));
    });

    // Block Slot Buttons
    const openBlockBtn = document.getElementById('open-block-slot-btn');
    if (openBlockBtn) openBlockBtn.addEventListener('click', () => openBlockSlotModal());

    // Block Slot Modal Elements
    blockModal = document.getElementById('block-slot-modal');
    blockDateInput = document.getElementById('block-date');
    blockStartInput = document.getElementById('block-start');
    blockEndInput = document.getElementById('block-end');
    blockStaffSelect = document.getElementById('block-staff-select');
    blockReasonInput = document.getElementById('block-reason');
    blockSubmitBtn = document.getElementById('block-submit-btn');
    blockCancelBtn = document.getElementById('block-cancel-btn');

    if (blockCancelBtn) blockCancelBtn.addEventListener('click', closeBlockSlotModal);
    if (blockModal) blockModal.addEventListener('click', (e) => { if (e.target === blockModal) closeBlockSlotModal(); });
    if (blockSubmitBtn) blockSubmitBtn.addEventListener('click', submitBlockSlot);

    // Initial Load
    loadAppointments('today');
};
