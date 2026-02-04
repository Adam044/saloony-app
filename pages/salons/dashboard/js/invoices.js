
import { fetchInvoices } from './api.js';
import { renderEmptyState, showToast } from './ui.js';
import { toEnglishDigits, formatCurrency } from './utils.js';

export const initInvoices = (salonId) => {
    loadInvoices(salonId);
    
    // Attach refresh listener if button exists
    document.getElementById('refresh-invoices-btn')?.addEventListener('click', () => loadInvoices(salonId));

    // Close modal on outside click
    document.getElementById('invoice-modal-overlay')?.addEventListener('click', function(e) {
        if (e.target === this) {
            this.classList.add('hidden');
        }
    });
};

export const loadInvoices = async (salonId) => {
    const container = document.getElementById('invoices-list');
    if (!container) return;
    
    container.innerHTML = '<p class="text-gray-500 text-center py-4">جاري تحميل الفواتير...</p>';
    
    try {
        const response = await fetchInvoices(salonId);
        
        if (response.success && response.payments && response.payments.length > 0) {
            renderInvoicesList(response.payments);
        } else {
            renderEmptyState(container, 'لا توجد فواتير حالياً.', 'fa-receipt');
        }
    } catch (error) {
        console.error('Error loading invoices:', error);
        renderEmptyState(container, 'فشل تحميل الفواتير.', 'fa-exclamation-circle');
        showToast('فشل تحميل الفواتير', false);
    }
};

const friendlyType = (p) => {
    const t = (p?.payment_type || '').toLowerCase();
    switch (t) {
        case 'offer_200ils':
            return 'عرض شهرين (200 شيكل)';
        case 'monthly_subscription':
        case 'monthly_200':
            return 'اشتراك شهري (200 شيكل)';
        case 'per_chair':
        case 'monthly_60': {
            const chairs = Math.max(1, Math.round((Number(p.amount) || 0) / 60));
            return `اشتراك شهري لكل كرسي (عدد الكراسي: ${chairs})`;
        }
        case 'per_booking':
            return 'الدفع لكل حجز';
        default:
            return p?.description ? p.description : 'دفعة اشتراك';
    }
};

const renderInvoicesList = (payments) => {
    const container = document.getElementById('invoices-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Group by month
    const groups = payments.reduce((acc, p) => {
        const d = new Date(p.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(p);
        return acc;
    }, {});

    const groupOrder = Object.keys(groups).sort((a,b) => b.localeCompare(a)); // Newest month first

    groupOrder.forEach(key => {
        const [year, month] = key.split('-');
        const headerDate = new Date(Number(year), Number(month)-1, 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
        
        // Header
        const headerDiv = document.createElement('div');
        headerDiv.className = 'flex items-center gap-2 mb-3 px-2 mt-4 first:mt-0';
        headerDiv.innerHTML = `
            <i class="fas fa-calendar-alt text-secondary"></i>
            <h4 class="text-sm font-bold text-gray-700">${headerDate}</h4>
        `;
        container.appendChild(headerDiv);

        // Items
        const items = groups[key].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
        
        items.forEach(payment => {
            const div = document.createElement('div');
            div.className = 'glass-card p-4 transition-transform hover:scale-[1.01] mb-3 cursor-pointer';
            
            const date = new Date(payment.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
            const amountStr = formatCurrency(payment.amount, payment.currency);
            const typeStr = friendlyType(payment);
            
            const statusColor = (payment.payment_status === 'completed' || payment.payment_status === 'مكتملة') ? 'text-green-600' : 
                               (payment.payment_status === 'pending' || payment.payment_status === 'معلق') ? 'text-yellow-600' : 
                               'text-red-600';
            
            const statusIcon = (payment.payment_status === 'completed' || payment.payment_status === 'مكتملة') ? 'fas fa-check-circle' : 
                              (payment.payment_status === 'pending' || payment.payment_status === 'معلق') ? 'fas fa-clock' : 
                              'fas fa-times-circle';

            div.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-4">
                        <div class="flex items-center justify-center w-12 h-12 bg-primary/10 rounded-full backdrop-blur-sm">
                            <i class="fas fa-receipt text-primary-dark text-lg"></i>
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800">فاتورة ${toEnglishDigits(payment.invoice_number || '#' + payment.id)}</h3>
                            <p class="text-sm text-gray-600">${date}</p>
                            <p class="text-sm font-medium text-primary-dark">${typeStr}</p>
                            <div class="flex items-center gap-2 mt-1">
                                <span class="font-bold text-lg text-gray-800">${amountStr}</span>
                                <i class="${statusIcon} ${statusColor} text-sm"></i>
                            </div>
                        </div>
                    </div>
                    <button class="px-4 py-2 bg-primary-dark text-white rounded-lg hover:bg-primary-darker transition-colors font-medium shadow-md hover:shadow-lg">
                        <i class="fas fa-eye ml-2"></i>
                        معاينة
                    </button>
                </div>
            `;
            
            div.addEventListener('click', () => showInvoiceModal(payment));
            container.appendChild(div);
        });
    });
};

export const showInvoiceModal = (payment) => {
    const modal = document.getElementById('invoice-modal-overlay');
    if (!modal) return;
    
    // Populate modal with payment data
    const invoiceNumber = document.getElementById('invoice-modal-number');
    const statusContainer = document.getElementById('invoice-status-container');
    const statusIcon = document.getElementById('invoice-status-icon');
    const statusText = document.getElementById('invoice-status-text');
    const invoiceDate = document.getElementById('invoice-date');
    const invoiceType = document.getElementById('invoice-type');
    const invoiceAmount = document.getElementById('invoice-amount');
    const invoiceMethod = document.getElementById('invoice-method');
    const invoiceValidUntil = document.getElementById('invoice-valid-until');
    const invoiceDescription = document.getElementById('invoice-description');
    const invoiceNotes = document.getElementById('invoice-notes');
    
    // Containers for conditional display
    const methodContainer = document.getElementById('invoice-method-container');
    const validContainer = document.getElementById('invoice-valid-container');
    const descriptionContainer = document.getElementById('invoice-description-container');
    const notesContainer = document.getElementById('invoice-notes-container');
    
    // Set invoice number
    if (invoiceNumber) {
        invoiceNumber.textContent = `رقم الفاتورة: ${toEnglishDigits(payment.invoice_number || payment.id)}`;
    }
    
    // Set status
    if (statusContainer && statusIcon && statusText) {
        if (payment.payment_status === 'completed' || payment.payment_status === 'مكتملة') {
            statusContainer.className = 'flex items-center justify-center p-4 rounded-xl bg-green-50 border border-green-200';
            statusIcon.className = 'fas fa-check-circle text-2xl text-green-600';
            statusText.textContent = 'دفع مكتمل';
            statusText.className = 'font-bold text-lg text-green-800';
        } else if (payment.payment_status === 'pending' || payment.payment_status === 'معلق') {
            statusContainer.className = 'flex items-center justify-center p-4 rounded-xl bg-yellow-50 border border-yellow-200';
            statusIcon.className = 'fas fa-clock text-2xl text-yellow-600';
            statusText.textContent = 'دفع معلق';
            statusText.className = 'font-bold text-lg text-yellow-800';
        } else {
            statusContainer.className = 'flex items-center justify-center p-4 rounded-xl bg-red-50 border border-red-200';
            statusIcon.className = 'fas fa-times-circle text-2xl text-red-600';
            statusText.textContent = 'دفع فاشل';
            statusText.className = 'font-bold text-lg text-red-800';
        }
    }
    
    // Set date
    if (invoiceDate) {
        invoiceDate.textContent = new Date(payment.created_at).toLocaleDateString('en-GB');
    }
    
    // Set type
    if (invoiceType) {
        invoiceType.textContent = payment.description || payment.payment_type || 'دفعة اشتراك';
    }
    
    // Set amount
    if (invoiceAmount) {
        const num = Number(payment.amount || 0);
        const formatted = num.toLocaleString('en-US');
        invoiceAmount.textContent = `${formatted} ${payment.currency || ''}`.trim();
    }
    
    // Set payment method (conditional)
    if (payment.payment_method && methodContainer && invoiceMethod) {
        methodContainer.style.display = 'flex';
        methodContainer.classList.remove('hidden');
        invoiceMethod.textContent = payment.payment_method;
    } else if (methodContainer) {
        methodContainer.style.display = 'none';
        methodContainer.classList.add('hidden');
    }
    
    // Set valid until (conditional)
    if (payment.valid_until && validContainer && invoiceValidUntil) {
        validContainer.style.display = 'flex';
        validContainer.classList.remove('hidden');
        invoiceValidUntil.textContent = new Date(payment.valid_until).toLocaleDateString('en-GB');
    } else if (validContainer) {
        validContainer.style.display = 'none';
        validContainer.classList.add('hidden');
    }
    
    // Set description (conditional)
    if (payment.description && descriptionContainer && invoiceDescription) {
        descriptionContainer.style.display = 'block';
        descriptionContainer.classList.remove('hidden');
        invoiceDescription.textContent = payment.description;
    } else if (descriptionContainer) {
        descriptionContainer.style.display = 'none';
        descriptionContainer.classList.add('hidden');
    }
    
    // Set admin notes (conditional)
    if (payment.admin_notes && notesContainer && invoiceNotes) {
        notesContainer.style.display = 'block';
        notesContainer.classList.remove('hidden');
        invoiceNotes.textContent = payment.admin_notes;
    } else if (notesContainer) {
        notesContainer.style.display = 'none';
        notesContainer.classList.add('hidden');
    }
    
    // Generate QR Code
    generateInvoiceQRCode(payment.invoice_number || payment.id);

    // Show modal
    modal.classList.remove('hidden');
};

const generateInvoiceQRCode = (data) => {
    const qrContainer = document.getElementById('invoice-qr-code');
    if (!qrContainer) return;
    
    qrContainer.innerHTML = '';
    
    const qrSize = 150;
    const qrImg = document.createElement('img');
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(data)}`;
    qrImg.alt = 'Invoice QR Code';
    qrImg.className = 'border-2 border-white/20 rounded-xl shadow-sm';
    qrImg.style.width = `${qrSize}px`;
    qrImg.style.height = `${qrSize}px`;
    
    qrContainer.appendChild(qrImg);
};
