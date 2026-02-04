
import { showMessage, showToast, confirmAction } from './ui.js';
import { getStaffList } from './staff.js';

let currentSalonId = null;
let currentRoleConfig = { roles_enabled: false };
let currentStaffRoles = [];

// DOM Elements
let rolesSection;
let rolesToggle;
let rolesEnabledContent;
let rolesDisabledMessage;
let showAddRoleBtn;
let addRoleFormContainer;
let addRoleForm;
let roleStaffSelect;
let rolesListContainer;

export const initRoles = (salonId) => {
    currentSalonId = salonId;
    
    rolesSection = document.getElementById('roles-section');
    rolesToggle = document.getElementById('roles-toggle');
    rolesEnabledContent = document.getElementById('roles-enabled-content');
    rolesDisabledMessage = document.getElementById('roles-disabled-message');
    showAddRoleBtn = document.getElementById('show-add-role-btn');
    addRoleFormContainer = document.getElementById('add-role-form-container');
    addRoleForm = document.getElementById('add-role-form');
    roleStaffSelect = document.getElementById('role-staff-select');
    rolesListContainer = document.getElementById('roles-list-container');

    if (rolesToggle) {
        rolesToggle.addEventListener('change', (e) => toggleRoleSystem(e.target.checked));
    }

    if (showAddRoleBtn) {
        showAddRoleBtn.addEventListener('click', () => {
            addRoleFormContainer.classList.remove('hidden');
            showAddRoleBtn.classList.add('hidden');
            populateRoleStaffSelect();
        });
    }

    if (document.getElementById('cancel-add-role-btn')) {
        document.getElementById('cancel-add-role-btn').addEventListener('click', () => {
            addRoleFormContainer.classList.add('hidden');
            showAddRoleBtn.classList.remove('hidden');
            addRoleForm.reset();
        });
    }

    if (addRoleForm) {
        addRoleForm.addEventListener('submit', handleAddRole);
    }

    loadRoleManagement();
};

const loadRoleManagement = async () => {
    if (!currentSalonId) return;

    try {
        const res = await fetch(`/api/salon/roles/${currentSalonId}`);
        const data = await res.json();
        
        if (data.success) {
            currentRoleConfig = data.config || { roles_enabled: false };
            currentStaffRoles = data.staff_roles || [];
            
            if (rolesToggle) rolesToggle.checked = currentRoleConfig.roles_enabled;
            updateRoleUI();
            renderRolesList();
        }
    } catch (error) {
        console.error('Error loading roles:', error);
    }
};

const updateRoleUI = () => {
    if (!rolesEnabledContent || !rolesDisabledMessage) return;

    if (currentRoleConfig.roles_enabled) {
        rolesEnabledContent.classList.remove('hidden');
        rolesDisabledMessage.classList.add('hidden');
    } else {
        rolesEnabledContent.classList.add('hidden');
        rolesDisabledMessage.classList.remove('hidden');
    }
};

const toggleRoleSystem = async (enabled) => {
    try {
        const res = await fetch(`/api/salon/roles/${currentSalonId}/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                enabled: enabled 
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            currentRoleConfig.roles_enabled = enabled;
            updateRoleUI();
            showToast(enabled ? 'تم تفعيل نظام الأدوار' : 'تم تعطيل نظام الأدوار');
        } else {
            rolesToggle.checked = !enabled; // Revert
            showToast('فشل تحديث الإعدادات', 'error');
        }
    } catch (error) {
        console.error('Error toggling roles:', error);
        rolesToggle.checked = !enabled; // Revert
        showToast('حدث خطأ', 'error');
    }
};

const populateRoleStaffSelect = () => {
    if (!roleStaffSelect) return;
    
    const allStaff = getStaffList();
    roleStaffSelect.innerHTML = '<option value="">اختر موظف...</option>';
    
    allStaff.forEach(staff => {
        // Only show staff who don't have a role yet
        if (!currentStaffRoles.some(r => r.staff_id === staff.id)) {
            const opt = document.createElement('option');
            opt.value = staff.id;
            opt.textContent = staff.name;
            roleStaffSelect.appendChild(opt);
        }
    });
};

const renderRolesList = () => {
    if (!rolesListContainer) return;
    
    if (currentStaffRoles.length === 0) {
        rolesListContainer.innerHTML = `
            <div class="text-center py-4 text-gray-400 text-sm">
                لا يوجد أدوار معرفة حالياً
            </div>
        `;
        return;
    }

    const allStaff = getStaffList();

    rolesListContainer.innerHTML = currentStaffRoles.map(role => {
        const staffName = allStaff.find(s => s.id === role.staff_id)?.name || 'موظف محذوف';
        const roleLabel = role.role_type === 'admin' ? 'مدير' : 'موظف';
        const roleColor = role.role_type === 'admin' ? 'text-purple-600 bg-purple-500/10' : 'text-blue-600 bg-blue-500/10';
        
        return `
            <div class="flex items-center justify-between p-4 glass-card mb-3 transition-transform hover:scale-[1.01]">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full ${roleColor} flex items-center justify-center font-bold backdrop-blur-sm">
                        ${role.role_type === 'admin' ? '<i class="fas fa-crown"></i>' : '<i class="fas fa-user"></i>'}
                    </div>
                    <div>
                        <h4 class="font-bold text-gray-800">${staffName}</h4>
                        <div class="flex items-center gap-2 text-xs">
                            <span class="font-medium ${roleColor} px-2 py-0.5 rounded-full border border-current opacity-80">${roleLabel}</span>
                            <span class="text-gray-400 font-mono tracking-widest">PIN: ****</span>
                        </div>
                    </div>
                </div>
                <button class="delete-role-btn text-gray-400 hover:text-red-500 w-8 h-8 flex items-center justify-center rounded-xl hover:bg-red-500/10 transition-colors" data-id="${role.staff_id}" title="إزالة الدور">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.delete-role-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = parseInt(e.currentTarget.dataset.id);
            confirmAction('هل أنت متأكد من إزالة صلاحيات هذا الموظف؟', () => {
                removeRole(id);
            });
        });
    });
};

const handleAddRole = async (e) => {
    e.preventDefault();
    
    const staffId = parseInt(roleStaffSelect.value);
    const roleType = document.getElementById('role-type-select').value;
    const pin = document.getElementById('role-pin-input').value;
    
    if (!staffId || !pin || pin.length !== 6) {
        showToast('يرجى ملء جميع البيانات بشكل صحيح', 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/salon/roles/${currentSalonId}/staff`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                staff_id: staffId,
                role_type: roleType,
                pin: pin
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            showToast('تم إضافة الدور بنجاح');
            addRoleForm.reset();
            addRoleFormContainer.classList.add('hidden');
            showAddRoleBtn.classList.remove('hidden');
            loadRoleManagement();
        } else {
            showToast(data.message || 'فشل إضافة الدور', 'error');
        }
    } catch (error) {
        console.error('Error adding role:', error);
        showToast('حدث خطأ', 'error');
    }
};

const removeRole = async (staffId) => {
    try {
        const res = await fetch(`/api/salon/roles/${currentSalonId}/staff/${staffId}`, {
            method: 'DELETE'
        });
        
        const data = await res.json();
        
        if (data.success) {
            showToast('تم إزالة الدور بنجاح');
            loadRoleManagement();
        } else {
            showToast('فشل إزالة الدور', 'error');
        }
    } catch (error) {
        console.error('Error removing role:', error);
        showToast('حدث خطأ', 'error');
    }
};
