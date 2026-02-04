
import { showMessage, showToast, confirmAction } from './ui.js';
import { currentUserRole, currentStaffId } from './auth.js';
import { createStaff } from './api.js';

let currentSalonId = null;
let staffList = [];

// DOM Elements
let staffListContainer;
let addStaffForm;
let blockStaffSelect;
let roleStaffSelect;

export const initStaff = async (salonId) => {
    currentSalonId = salonId;
    
    staffListContainer = document.getElementById('staff-list-container');
    addStaffForm = document.getElementById('add-staff-form');
    blockStaffSelect = document.getElementById('block-staff-select');
    roleStaffSelect = document.getElementById('role-staff-select'); // Used in roles, but populated here mostly

    if (addStaffForm) {
        addStaffForm.addEventListener('submit', handleAddStaff);
    }

    await loadStaff();
};

export const loadStaff = async () => {
    if (!currentSalonId) return;

    try {
        const res = await fetch(`/api/salon/staff/${currentSalonId}`);
        const data = await res.json();
        
        if (data.success) {
            staffList = data.staff;
            renderStaffList(staffList);
            populateStaffSelects(staffList);
        }
    } catch (error) {
        console.error('Error loading staff:', error);
        showToast('فشل تحميل قائمة الموظفين', 'error');
    }
};

const renderStaffList = (staff) => {
    if (!staffListContainer) return;
    
    if (staff.length === 0) {
        staffListContainer.innerHTML = `
            <div class="text-center py-8 glass-card border border-dashed border-gray-300/50">
                <i class="fas fa-users text-gray-300 text-4xl mb-3"></i>
                <p class="text-gray-500 font-medium">لا يوجد موظفين حالياً</p>
                <p class="text-gray-400 text-sm mt-1">أضف موظفين لإدارة مواعيدهم</p>
            </div>
        `;
        return;
    }

    staffListContainer.innerHTML = staff.map(member => `
        <div class="flex items-center justify-between p-4 glass-card mb-3 group transition-transform hover:scale-[1.01]">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary-dark font-bold text-lg backdrop-blur-sm">
                    ${member.name.charAt(0)}
                </div>
                <div>
                    <h4 class="font-bold text-gray-800">${member.name}</h4>
                    <p class="text-xs text-gray-500">تمت الإضافة: ${new Date(member.created_at || Date.now()).toLocaleDateString('ar-EG')}</p>
                </div>
            </div>
            <button class="delete-staff-btn w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100" data-id="${member.id}" title="حذف الموظف">
                <i class="fas fa-trash-alt"></i>
            </button>
        </div>
    `).join('');

    // Attach event listeners
    document.querySelectorAll('.delete-staff-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            confirmAction('هل أنت متأكد من حذف هذا الموظف؟ سيتم حذف جميع مواعيده المستقبلية.', () => {
                deleteStaff(id);
            });
        });
    });
};

const populateStaffSelects = (staff) => {
    const options = staff.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    
    // Block Modal Select
    if (blockStaffSelect) {
        blockStaffSelect.innerHTML = `<option value="all">جميع الموظفين</option>${options}`;
        
        // If current user is staff, restrict selection
        if (currentUserRole === 'staff' && currentStaffId) {
            blockStaffSelect.value = currentStaffId;
            blockStaffSelect.disabled = true;
            // Or only show their option
             blockStaffSelect.innerHTML = `<option value="${currentStaffId}">${staff.find(s=>s.id==currentStaffId)?.name || 'أنا'}</option>`;
        }
    }

    // Role Select (managed in roles.js usually, but good to have helper)
    // We will let roles.js handle roleStaffSelect specifically because it needs to filter out existing roles
};

const handleAddStaff = async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('staff-name-input');
    const name = nameInput.value.trim();
    
    if (!name) return;

    const btn = addStaffForm.querySelector('button[type="submit"]');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        const data = await createStaff(currentSalonId, name);
        
        if (data.success) {
            showToast('تم إضافة الموظف بنجاح');
            nameInput.value = '';
            loadStaff(); // Reload list
        } else {
            showToast(data.message || 'فشل إضافة الموظف', 'error');
        }
    } catch (error) {
        console.error('Error adding staff:', error);
        showToast('حدث خطأ أثناء الإضافة', 'error');
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
};

const deleteStaff = async (id) => {
    try {
        const res = await fetch(`/api/salon/staff/${id}`, { method: 'DELETE' });
        const data = await res.json();
        
        if (data.success) {
            showToast('تم حذف الموظف بنجاح');
            loadStaff();
        } else {
            showToast(data.message || 'فشل حذف الموظف', 'error');
        }
    } catch (error) {
        console.error('Error deleting staff:', error);
        showToast('حدث خطأ أثناء الحذف', 'error');
    }
};

export const getStaffList = () => staffList;
