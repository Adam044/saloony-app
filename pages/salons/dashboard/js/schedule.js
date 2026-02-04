import { showMessage, showConfirmationModal, formatTimeRange } from './ui.js';
import { getStaffList } from './staff.js';

let currentSalonId = null;

export const initSchedule = (salonId) => {
    console.log('initSchedule called with salonId:', salonId);
    if (!salonId) {
        console.error('initSchedule: salonId is missing!');
    }
    currentSalonId = salonId;
    attachScheduleListeners();
    populateScheduleStaffSelects();
    loadSchedule(salonId);
};

const populateScheduleStaffSelects = () => {
    const staffList = getStaffList();
    const breakSelect = document.getElementById('break-staff-select');
    const modSelect = document.getElementById('mod-staff-select');
    
    const createOptions = (selectElement) => {
        if (!selectElement) return;
        
        // Keep the "All Staff" option
        selectElement.innerHTML = '<option value="all">جميع العاملين</option>';
        
        staffList.forEach(staff => {
            const option = document.createElement('option');
            option.value = staff.id;
            option.textContent = staff.name;
            selectElement.appendChild(option);
        });
    };

    createOptions(breakSelect);
    createOptions(modSelect);
};

export const loadSchedule = async (salonId = currentSalonId) => {
    console.log('loadSchedule called for salonId:', salonId);
    if (!salonId) return;

    try {
        const response = await fetch(`/api/salon/schedule/${salonId}`);
        const data = await response.json();
        console.log('loadSchedule response:', data);
        if (data.success) {
            updateScheduleUI(data.schedule, data.breaks, data.modifications);
        }
    } catch (error) {
        console.error('Error loading schedule:', error);
        showMessage(null, 'فشل تحميل الجدول.', false);
    }
};

const updateScheduleUI = (schedule, breaks, modifications) => {
    // Update basic schedule
    const openingTimeInput = document.getElementById('opening-time');
    const closingTimeInput = document.getElementById('closing-time');
    const closedDaysInputs = document.querySelectorAll('#closed-days-container input');

    const safeSchedule = schedule || {};

    if (openingTimeInput) openingTimeInput.value = (safeSchedule.opening_time || '').slice(0, 5);
    if (closingTimeInput) closingTimeInput.value = (safeSchedule.closing_time || '').slice(0, 5);
    
    // Reset checkboxes
    closedDaysInputs.forEach(input => input.checked = false);
    
    if (safeSchedule.closed_days && Array.isArray(safeSchedule.closed_days)) {
        safeSchedule.closed_days.forEach(dayIndex => {
            const input = document.querySelector(`#closed-days-container input[value="${dayIndex}"]`);
            if (input) input.checked = true;
        });
    }

    renderBreaks(breaks || []);
    renderModifications(modifications || []);
};

const renderBreaks = (breaks) => {
    const breaksListContainer = document.getElementById('breaks-list-container');
    if (!breaksListContainer) return;
    
    const staffList = getStaffList();

    breaksListContainer.innerHTML = breaks.length > 0 ? '' : `
        <div class="empty-state p-6 border-dashed border-2 border-gray-200/50 rounded-xl text-center text-gray-500">
            <i class="fas fa-mug-hot"></i>
            <p>لم تُسجل فترات استراحة روتينية بعد.</p>
        </div>
    `;
    
    breaks.forEach(b => {
        let staffName = b.staff_name;
        if (!staffName && b.staff_id) {
            const staff = staffList.find(s => s.id === b.staff_id);
            staffName = staff ? staff.name : 'موظف غير موجود';
        }
        staffName = staffName || 'جميع العاملين';
        
        const breakDiv = document.createElement('div');
        breakDiv.className = 'flex justify-between items-center p-3 bg-red-50/50 rounded-xl border-r-4 border-red-400 shadow-sm border border-red-100/50';
        breakDiv.innerHTML = `
            <div class="space-y-1">
                <p class="font-medium text-red-800">${formatTimeRange(b.start_time, b.end_time)}</p>
                <p class="text-xs text-red-600">تنطبق على: ${staffName}</p>
                ${b.reason ? `<p class="text-xs text-red-600">السبب: ${b.reason}</p>` : ''}
            </div>
            <button type="button" class="text-red-500 hover:text-red-700 text-sm delete-break-btn p-1 rounded-full transition" data-id="${b.id}" data-staff="${staffName}">
                <i class="fas fa-times-circle"></i> حذف
            </button>
        `;
        breaksListContainer.appendChild(breakDiv);
    });

    document.querySelectorAll('.delete-break-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const breakId = e.currentTarget.getAttribute('data-id');
            const staffName = e.currentTarget.getAttribute('data-staff');
            showConfirmationModal(`هل أنت متأكد من حذف فترة الاستراحة الروتينية للمختص: ${staffName}؟`, 
                                () => deleteBreakConfirmed(breakId));
        });
    });
};

const deleteBreakConfirmed = async (breakId) => {
    try {
        const response = await fetch(`/api/salon/break/${breakId}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            await loadSchedule();
            showMessage(null, 'تم حذف الاستراحة بنجاح.', true);
        } else {
            showMessage(null, data.message || 'فشل حذف الاستراحة.', false);
        }
    } catch (error) {
        console.error('Error deleting break:', error);
        showMessage(null, 'خطأ في الشبكة.', false);
    }
};

const renderModifications = (modifications) => {
    const modificationsListContainer = document.getElementById('modifications-list-container');
    if (!modificationsListContainer) return;

    const daysOfWeekNames = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

    modificationsListContainer.innerHTML = modifications.length > 0 ? '' : `
        <div class="empty-state p-6 glass-card border border-dashed border-gray-300/50 text-center text-gray-500 rounded-xl">
            <i class="fas fa-calendar-times text-2xl mb-2 opacity-50"></i>
            <p>لا توجد تعديلات مؤقتة أو إجازات مجدولة حالياً.</p>
        </div>
    `;
    
    modifications.forEach(mod => {
        const staffName = mod.staff_name || 'جميع العاملين';
        
        let modDetails = '';
        let typeColor = '';
        
        if (mod.mod_type === 'once') {
            modDetails = `بتاريخ: ${mod.mod_date}`;
            typeColor = 'border-blue-400 bg-blue-500/5';
        } else {
            // Handle day index safely (ensure it's a number)
            let dayIndex = -1;
            if (mod.mod_day_index !== null && mod.mod_day_index !== undefined) {
                dayIndex = parseInt(mod.mod_day_index);
            }
            modDetails = `كل: ${daysOfWeekNames[dayIndex] || 'يوم غير محدد'}`;
            typeColor = 'border-orange-400 bg-orange-500/5';
        }
        
        const closureType = mod.closure_type;
        let timeInfo = '';
        let badgeHtml = '';
        if (closureType === 'full_day') {
            timeInfo = '<span class="font-bold text-red-600">مغلق بالكامل</span>';
            badgeHtml = '<span class="inline-block text-xs bg-red-500/10 text-red-700 px-2 py-0.5 rounded ml-2 border border-red-500/20">إغلاق كامل</span>';
        } else if (closureType === 'interval') {
            timeInfo = `إغلاق من ${formatTimeRange(mod.start_time, mod.end_time)}`;
            badgeHtml = '<span class="inline-block text-xs bg-yellow-500/10 text-yellow-700 px-2 py-0.5 rounded ml-2 border border-yellow-500/20">إغلاق بفترة</span>';
        } else {
            timeInfo = `ساعات مخصصة (قديم): ${formatTimeRange(mod.start_time, mod.end_time)}`;
            badgeHtml = '<span class="inline-block text-xs bg-gray-500/10 text-gray-700 px-2 py-0.5 rounded ml-2 border border-gray-500/20">قديم</span>';
        }

        const modDiv = document.createElement('div');
        modDiv.className = `flex justify-between items-center p-3 glass-card border-r-4 mb-2 ${typeColor}`;
        modDiv.innerHTML = `
            <div class="space-y-1">
                <p class="font-medium text-primary-dark">${mod.reason} ${badgeHtml}</p>
                <p class="text-xs text-gray-700">${timeInfo} - ${modDetails}</p>
                <p class="text-xs text-gray-500">ينطبق على: ${staffName}</p>
            </div>
            <button type="button" class="text-red-500 hover:text-red-700 text-sm delete-mod-btn p-2 rounded-xl hover:bg-red-500/10 transition" data-id="${mod.id}" data-reason="${mod.reason}">
                <i class="fas fa-trash-alt ml-1"></i> حذف
            </button>
        `;
        modificationsListContainer.appendChild(modDiv);
    });

    document.querySelectorAll('.delete-mod-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modId = e.currentTarget.getAttribute('data-id');
            const reason = e.currentTarget.getAttribute('data-reason');
            showConfirmationModal(`هل أنت متأكد من حذف تعديل الجدول: "${reason}"؟`, 
                                () => deleteModificationConfirmed(modId));
        });
    });
};

const deleteModificationConfirmed = async (modId) => {
    try {
        const response = await fetch(`/api/salon/schedule/modification/${modId}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            await loadSchedule();
            showMessage(null, 'تم حذف التعديل بنجاح.', true);
        } else {
            showMessage(null, data.message || 'فشل حذف التعديل.', false);
        }
    } catch (error) {
        console.error('Error deleting modification:', error);
        showMessage(null, 'خطأ في الشبكة.', false);
    }
};

const attachScheduleListeners = () => {
    const scheduleForm = document.getElementById('salon-schedule-form');
    const addBreakForm = document.getElementById('add-break-form');
    const addModificationForm = document.getElementById('add-modification-form');
    
    if (scheduleForm) {
        scheduleForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const openingTime = document.getElementById('opening-time').value;
            const closingTime = document.getElementById('closing-time').value;
            const selectedDays = Array.from(document.querySelectorAll('#closed-days-container input:checked')).map(input => parseInt(input.value));
            
            const scheduleData = {
                opening_time: openingTime,
                closing_time: closingTime,
                closed_days: selectedDays
            };
    
            try {
                const btn = e.submitter;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin ml-1"></i> جاري الحفظ';
                
                const response = await fetch(`/api/salon/schedule/${currentSalonId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(scheduleData),
                });
                const data = await response.json();
                if (data.success) {
                    showMessage(null, 'تم تحديث أوقات العمل بنجاح.', true);
                } else {
                    showMessage(null, data.message || 'فشل تحديث أوقات العمل.', false);
                }
            } catch (error) {
                console.error('Error saving schedule:', error);
                showMessage(null, 'خطأ في الشبكة.', false);
            } finally {
                const btn = scheduleForm.querySelector('button[type="submit"]');
                if (btn) {
                    btn.innerHTML = '<i class="fas fa-save ml-1"></i> حفظ أوقات العمل';
                    btn.disabled = false;
                }
            }
        });
    }

    if (addBreakForm) {
        addBreakForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const startTime = document.getElementById('break-start-time').value;
            const endTime = document.getElementById('break-end-time').value;
            const reason = (document.getElementById('break-reason').value || '').trim();
            const staffSelect = document.getElementById('break-staff-select');
            
            if (startTime >= endTime) {
                showMessage(null, 'وقت بداية الاستراحة يجب أن يكون قبل وقت النهاية.', false);
                return;
            }
    
            const staffId = staffSelect.value === 'all' ? null : parseInt(staffSelect.value);
            
            const breakData = {
                start_time: startTime,
                end_time: endTime,
                staff_id: staffId,
                reason: reason || null,
            };
    
            try {
                const btn = e.submitter;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin ml-1"></i> جاري الإضافة';
    
                const response = await fetch(`/api/salon/break/${currentSalonId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(breakData),
                });
                const data = await response.json();
                if (data.success) {
                    addBreakForm.reset();
                    await loadSchedule();
                    showMessage(null, 'تم إضافة الاستراحة بنجاح.', true);
                } else {
                    showMessage(null, data.message || 'فشل إضافة الاستراحة.', false);
                }
            } catch (error) {
                console.error('Error adding break:', error);
                showMessage(null, 'خطأ في الشبكة.', false);
            } finally {
                 const btn = addBreakForm.querySelector('button[type="submit"]');
                 if (btn) {
                     btn.innerHTML = '<i class="fas fa-pause-circle ml-1"></i> إضافة استراحة روتينية';
                     btn.disabled = false;
                 }
            }
        });
    }

    if (addModificationForm) {
        // Toggle handlers for modification form (single date vs recurring) are handled in UI/HTML usually, 
        // but let's ensure we attach them if not present.
        const modTypeRadios = document.querySelectorAll('input[name="mod_type"]');
        const onceFields = document.getElementById('mod-once-fields');
        const recurringFields = document.getElementById('mod-recurring-fields');
        
        modTypeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'once') {
                    onceFields.classList.remove('hidden');
                    recurringFields.classList.add('hidden');
                } else {
                    onceFields.classList.add('hidden');
                    recurringFields.classList.remove('hidden');
                }
            });
        });

        // Toggle handlers for "Closed Full Day" checkbox
        const modIsClosedCheckbox = document.getElementById('mod-is-closed');
        const modTimeFields = document.getElementById('mod-time-fields');
        const modStartTimeInput = document.getElementById('mod-start-time');
        const modEndTimeInput = document.getElementById('mod-end-time');
        const modSubmitBtn = document.getElementById('btn-add-modification');

        if (modIsClosedCheckbox) {
            modIsClosedCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    modTimeFields.classList.add('hidden');
                    modStartTimeInput.required = false;
                    modEndTimeInput.required = false;
                    if (modSubmitBtn) {
                        modSubmitBtn.classList.remove('btn-action', 'hover:bg-green-600');
                        modSubmitBtn.classList.add('bg-red-600', 'hover:bg-red-700');
                        modSubmitBtn.innerHTML = '<i class="fas fa-ban ml-1"></i> إغلاق الصالون';
                    }
                } else {
                    modTimeFields.classList.remove('hidden');
                    modStartTimeInput.required = true;
                    modEndTimeInput.required = true;
                    if (modSubmitBtn) {
                        modSubmitBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
                        modSubmitBtn.classList.add('btn-action', 'hover:bg-green-600');
                        modSubmitBtn.innerHTML = '<i class="fas fa-calendar-times ml-1"></i> إضافة تعديل مؤقت';
                    }
                }
            });
        }

        addModificationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.submitter; 
    
            const modType = document.querySelector('input[name="mod_type"]:checked').value;
            const isClosedFullDay = modIsClosedCheckbox.checked;
            const modStaffSelect = document.getElementById('mod-staff-select');
            const staffId = modStaffSelect.value === 'all' ? null : parseInt(modStaffSelect.value);
    
            let modData = {
                salon_id: currentSalonId,
                mod_type: modType,
                closure_type: isClosedFullDay ? 'full_day' : 'interval',
                reason: document.getElementById('mod-reason-input').value.trim(),
                staff_id: staffId
            };
            
            if (modType === 'once') {
                modData.mod_date = document.getElementById('mod-date-input').value;
                modData.mod_day_index = null;
            } else {
                modData.mod_day_index = parseInt(document.getElementById('mod-day-index').value);
                modData.mod_date = null;
            }
    
            if (isClosedFullDay) {
                modData.start_time = null;
                modData.end_time = null;
            } else {
                if (!modStartTimeInput.value || !modEndTimeInput.value) {
                    showMessage(null, 'يرجى تحديد وقتي الإغلاق (من/إلى).', false);
                    return;
                }
                modData.start_time = modStartTimeInput.value;
                modData.end_time = modEndTimeInput.value;
                if (modData.start_time >= modData.end_time) {
                    showMessage(null, 'وقت الإغلاق (من) يجب أن يكون قبل (إلى).', false);
                    return;
                }
            }
    
            try {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin ml-1"></i> جاري الإضافة';
    
                const response = await fetch(`/api/salon/schedule/modification/${currentSalonId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(modData),
                });
                const data = await response.json();
                
                if (data.success) {
                    addModificationForm.reset();
                    modIsClosedCheckbox.checked = false;
                    modTimeFields.classList.remove('hidden'); 
                    modStartTimeInput.required = true;
                    modEndTimeInput.required = true;
                    
                    await loadSchedule();
                    showMessage(null, 'تم إضافة التعديل بنجاح.', true);
                } else {
                    showMessage(null, data.message || 'فشل إضافة التعديل.', false);
                }
            } catch (error) {
                console.error('Error adding modification:', error);
                showMessage(null, 'خطأ في الشبكة.', false);
            } finally {
                // Restore button state
                const isClosed = modIsClosedCheckbox.checked;
                btn.innerHTML = '<i class="fas fa-calendar-times ml-1"></i> إضافة تعديل مؤقت';
                btn.disabled = false;
            }
        });
    }
};
