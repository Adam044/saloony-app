import { showToast, openModal, closeModal } from './ui.js';
import { getRoleSessionToken } from './auth.js';

export const initSubscriptions = async (salonId) => {
    // Listen for view shown event
    const view = document.getElementById('subscriptions-view');
    if (view) {
        view.addEventListener('viewShown', () => loadSubscriptionStatus(salonId));
    }

    // Bind UI interactions
    const btnIPaid = document.getElementById('btn-i-paid');
    if (btnIPaid) {
        btnIPaid.addEventListener('click', () => {
             // Reset modal state
             const confirmBtn = document.getElementById('confirm-payment-btn');
             if (confirmBtn) {
                 confirmBtn.disabled = true;
                 confirmBtn.classList.add('cursor-not-allowed', 'bg-slate-200', 'text-slate-400');
                 confirmBtn.classList.remove('bg-secondary', 'text-white', 'hover:bg-secondary-dark');
             }
             
             document.querySelectorAll('.payment-method-btn').forEach(btn => {
                 btn.classList.remove('border-blue-500', 'bg-blue-50');
                 btn.classList.add('border-slate-100');
             });

             openModal('payment-confirm-modal');
        });
    }

    const cancelBtn = document.getElementById('cancel-payment-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => closeModal('payment-confirm-modal'));
    }

    // Payment Method Selection
    let selectedMethod = null;
    document.querySelectorAll('.payment-method-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedMethod = btn.dataset.method;
            
            // UI Update
            document.querySelectorAll('.payment-method-btn').forEach(b => {
                b.classList.remove('border-blue-500', 'bg-blue-50');
                b.classList.add('border-slate-100');
            });
            btn.classList.remove('border-slate-100');
            btn.classList.add('border-blue-500', 'bg-blue-50');

            // Enable Confirm Button
            const confirmBtn = document.getElementById('confirm-payment-btn');
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.classList.remove('cursor-not-allowed', 'bg-slate-200', 'text-slate-400');
                confirmBtn.classList.add('bg-secondary', 'text-white', 'hover:bg-secondary-dark');
            }
        });
    });

    const confirmBtn = document.getElementById('confirm-payment-btn');
    if (confirmBtn) {
        // Remove old listeners (if any) to prevent duplicates (though init usually runs once)
        const newBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
        newBtn.addEventListener('click', () => handlePaymentConfirm(salonId, selectedMethod));
    }

    // Initial load if view is already visible
    if (view && !view.classList.contains('hidden')) {
        loadSubscriptionStatus(salonId);
    }
};

const loadSubscriptionStatus = async (salonId) => {
    const statusBadge = document.getElementById('sub-status-badge');
    
    if (!statusBadge) return; // UI not ready

    // Show loading state
    statusBadge.textContent = 'جاري التحميل...';

    try {
        const token = localStorage.getItem('saloony_token') || getRoleSessionToken(salonId);
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

        const res = await fetch('/api/subscriptions/status', { headers });
        const data = await res.json();

        if (data.success) {
            updateSubscriptionUI(data);
        } else {
            console.error('Failed to load status:', data.message);
            showToast('فشل تحميل حالة الاشتراك', false);
        }
    } catch (err) {
        console.error('Error loading subscription status:', err);
        showToast('خطأ في الاتصال', false);
    }
};

const updateSubscriptionUI = (data) => {
    const statusBadge = document.getElementById('sub-status-badge');
    const monthNameEl = document.getElementById('sub-month-name');
    const statusIcon = document.getElementById('sub-status-icon');
    
    const paymentInfo = document.getElementById('sub-payment-info');
    const pendingMsg = document.getElementById('sub-pending-msg');
    const paidMsg = document.getElementById('sub-paid-msg');
    
    // Set Month Name
    if (monthNameEl && data.month) {
        // Format: YYYY-MM
        const [year, month] = data.month.split('-');
        if (year && month) {
            const date = new Date(year, month - 1);
            // Arabic locale since HTML is dir="rtl"
            monthNameEl.textContent = date.toLocaleString('ar-EG', { month: 'long', year: 'numeric' });
        }
    }

    // Reset visibility
    if (paymentInfo) paymentInfo.classList.add('hidden');
    if (pendingMsg) pendingMsg.classList.add('hidden');
    if (paidMsg) paidMsg.classList.add('hidden');

    // Reset Badge & Icon
    statusBadge.className = 'relative inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-bold border transition-colors';
    if (statusIcon) statusIcon.className = 'fas text-4xl mb-2'; // Base class

    if (data.status === 'paid') {
        // Paid
        statusBadge.classList.add('bg-emerald-50', 'text-emerald-700', 'border-emerald-100');
        statusBadge.innerHTML = '<i class="fas fa-check-circle"></i> فعال';
        
        if (statusIcon) statusIcon.classList.add('fa-check-circle', 'text-emerald-500');
        if (paidMsg) paidMsg.classList.remove('hidden');

    } else if (data.status === 'pending') {
        // Pending
        statusBadge.classList.add('bg-amber-50', 'text-amber-700', 'border-amber-100');
        statusBadge.innerHTML = '<i class="fas fa-clock"></i> قيد المراجعة';
        
        if (statusIcon) statusIcon.classList.add('fa-clock', 'text-amber-500');
        if (pendingMsg) pendingMsg.classList.remove('hidden');

    } else {
        // Unpaid
        statusBadge.classList.add('bg-slate-50', 'text-slate-500', 'border-slate-100');
        statusBadge.innerHTML = '<i class="fas fa-exclamation-circle"></i> غير مدفوع';
        
        if (statusIcon) statusIcon.classList.add('fa-exclamation-circle', 'text-slate-300');
        if (paymentInfo) paymentInfo.classList.remove('hidden');
    }
};

const handlePaymentConfirm = async (salonId, method) => {
    if (!method) {
        showToast('الرجاء اختيار طريقة الدفع', false);
        return;
    }

    const btn = document.getElementById('confirm-payment-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري المعالجة...';

    try {
        const token = localStorage.getItem('saloony_token') || getRoleSessionToken(salonId);
        
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch('/api/subscriptions/notify-payment', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ payment_method: method })
        });

        const data = await res.json();

        if (data.success) {
            showToast('تم إرسال إشعار الدفع بنجاح', true);
            closeModal('payment-confirm-modal');
            loadSubscriptionStatus(salonId); // Reload status
        } else {
            showToast(data.message || 'فشل إرسال الإشعار', false);
            
            // Handle 401 Unauthorized (Stale Session)
            if (res.status === 401) {
                setTimeout(() => {
                    localStorage.removeItem('saloony_token');
                    localStorage.removeItem('saloony_user');
                    window.location.href = '/pages/salons/auth/login.html';
                }, 2000);
            }
        }
    } catch (err) {
        console.error('Payment notification error:', err);
        showToast('خطأ في الاتصال', false);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
};
