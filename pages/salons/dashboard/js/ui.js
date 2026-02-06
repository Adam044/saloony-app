
import { toEnglishDigits } from './utils.js';

// Toast Notification System
export const showToast = (message, isSuccess = true, duration = 4000) => {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        console.warn('Toast container not found');
        return;
    }

    const toast = document.createElement('div');
    const colors = isSuccess ? { bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30', text: 'text-emerald-800', icon: 'text-emerald-600' } : { bg: 'bg-rose-500/10', ring: 'ring-rose-500/30', text: 'text-rose-800', icon: 'text-rose-600' };
    const icon = isSuccess ? 'fa-check-circle' : 'fa-exclamation-circle';
    toast.className = `max-w-sm w-full glass-card ${colors.bg} ring-1 ${colors.ring} pointer-events-auto overflow-hidden transform translate-x-full opacity-0 transition-all duration-300 backdrop-blur-md`;
    toast.innerHTML = `
        <div class="p-4 flex items-center gap-3">
            <i class="fas ${icon} ${colors.icon} text-xl"></i>
            <div class="flex-1 ${colors.text} font-bold text-sm">${message}</div>
            <button class="toast-close w-8 h-8 rounded-full bg-white/40 hover:bg-white/60 flex items-center justify-center transition-colors"><i class="fas fa-times text-gray-600 text-sm"></i></button>
        </div>
        <div class="h-1 bg-black/5"><div class="h-full bg-current opacity-30" data-bar style="width: 100%; color: inherit;"></div></div>
    `;
    toastContainer.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-full', 'opacity-0');
        toast.classList.add('translate-x-0', 'opacity-100');
    });

    const closeBtn = toast.querySelector('.toast-close');
    const bar = toast.querySelector('[data-bar]');
    
    setTimeout(() => { 
        if(bar) {
            bar.style.transition = `width ${duration}ms linear`; 
            bar.style.width = '0%'; 
        }
    }, 100);

    const remove = () => { 
        toast.classList.add('translate-x-full', 'opacity-0'); 
        setTimeout(() => { toast.remove(); }, 280); 
    };
    
    if(closeBtn) closeBtn.addEventListener('click', remove);
    setTimeout(remove, duration + 150);
    
    return toast;
};

export const initHeaderSalon = async (salonId) => {
    const salonNameEl = document.getElementById('header-salon-name');
    const salonLinkEl = document.getElementById('header-salon-link');
    const salonLogoEl = document.getElementById('header-salon-logo');
    const salonFallbackEl = document.getElementById('header-salon-fallback');

    if (!salonId) return;

    // Set link immediately
    const publicUrl = `${window.location.origin}/pages/salons/salon.html?id=${salonId}`;
    if (salonLinkEl) salonLinkEl.href = publicUrl;

    try {
        const res = await fetch(`/api/salon/info/${salonId}`);
        const data = await res.json();

        if (data.success && data.salon) {
            if (salonNameEl) salonNameEl.textContent = data.salon.name_ar || data.salon.name_en || 'الصالون';
            
            const logoUrl = data.salon.logo_url || data.salon.image_url;
            const hasValidLogo = logoUrl && !logoUrl.includes('placehold.co');

            if (hasValidLogo) {
                if (salonLogoEl) {
                    salonLogoEl.src = logoUrl;
                    salonLogoEl.classList.remove('hidden');
                }
                if (salonFallbackEl) salonFallbackEl.classList.add('hidden');
            } else {
                if (salonLogoEl) salonLogoEl.classList.add('hidden');
                if (salonFallbackEl) salonFallbackEl.classList.remove('hidden');
            }
        }
    } catch (e) {
        console.error('Failed to fetch salon info for header', e);
    }
};

export const initUI = (currentUser) => {
    // Initialize Header Salon Info
    if (currentUser && (currentUser.salonId || currentUser.salon_id)) {
        initHeaderSalon(currentUser.salonId || currentUser.salon_id);
    }

    // Ensure toast container exists
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.className = 'fixed right-4 z-50 space-y-2';
        toastContainer.style.top = 'calc(env(safe-area-inset-top, 0px) + 80px)';
        document.body.appendChild(toastContainer);
    }
    
    // Initialize Navigation
    initNavigation(currentUser);
    
    // Global click listener for closing modals when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('fixed') && e.target.classList.contains('z-50') && e.target.classList.contains('flex')) {
            // It's likely a modal overlay
            if (!e.target.dataset.static) { // Allow some modals to be static (prevent close on outside click)
                const closeBtn = e.target.querySelector('.close-modal-btn');
                if (closeBtn) closeBtn.click();
                else {
                    e.target.classList.add('hidden');
                    e.target.classList.remove('flex');
                    document.body.classList.remove('overflow-hidden');
                }
            }
        }
    });
};

const initNavigation = (currentUser) => {
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view-content');

    console.log(`Navigation init: Found ${navItems.length} nav items and ${views.length} views.`);

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            console.log('Nav item clicked:', item.id);
            // Prevent default behavior if it's a link (though these are buttons)
            e.preventDefault();
            
            const targetId = item.dataset.view;
            console.log('Target view:', targetId);
            if (!targetId) return;

            // Update Nav State
            navItems.forEach(nav => {
                nav.classList.remove('nav-active');
                nav.classList.add('text-slate-400');
            });
            // Add active class to clicked item (and ensure icon/text color changes)
            item.classList.add('nav-active');
            item.classList.remove('text-slate-400');

            // Switch View
            views.forEach(view => {
                if (view.id === targetId) {
                    view.classList.remove('hidden');
                    // Trigger a custom event that view is shown (optional, good for lazy loading)
                    view.dispatchEvent(new CustomEvent('viewShown'));
                } else {
                    view.classList.add('hidden');
                }
            });
            
            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    // Header Actions
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
             confirmAction('هل أنت متأكد من تسجيل الخروج؟', () => {
                localStorage.removeItem('salonToken');
                localStorage.removeItem('saloony_token');
                localStorage.removeItem('saloony_user');
                localStorage.removeItem('saloony_refresh_token');
                window.location.replace('/auth.html');
             }, 'تسجيل خروج');
        });
    }

    const shareBtn = document.getElementById('share-salon-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            const salonId = currentUser?.salonId || currentUser?.salon_id;
            const shareUrl = salonId ? `${window.location.origin}/pages/salons/salon.html?id=${salonId}` : window.location.origin;
            
            if (navigator.share) {
                navigator.share({
                    title: 'صالوني',
                    text: 'احجز موعدك الآن عبر صالوني',
                    url: shareUrl
                }).catch(console.error);
            } else {
                navigator.clipboard.writeText(shareUrl)
                    .then(() => showToast('تم نسخ رابط الصالون بنجاح'))
                    .catch(() => showToast('فشل نسخ الرابط', false));
            }
        });
    }
};

export const showActionSuccess = (message) => {
    showToast(message, true);
};

// Wrapper for legacy compatibility
export const showMessage = (_, message, isSuccess) => {
    showToast(message, isSuccess);
};

// Loading State Helpers
export const showLoading = () => {
    const spinner = document.getElementById('global-loading');
    if(spinner) spinner.classList.remove('hidden');
};

export const hideLoading = () => {
    const spinner = document.getElementById('global-loading');
    if(spinner) spinner.classList.add('hidden');
    
    // Ensure main content is visible
    const mainContent = document.getElementById('main-app-content');
    if(mainContent && mainContent.classList.contains('hidden')) {
        mainContent.classList.remove('hidden');
    }
};

// Modal System
export const openModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.classList.add('overflow-hidden');

        // Handle Animations
        // We look for a child that might be the content wrapper with transition classes
        // Standard pattern: backdrop is first child, content is second child (or wrapper)
        // But better to rely on class matching or data attributes if possible. 
        // For now, let's try to find elements with specific animation starting classes
        
        requestAnimationFrame(() => {
            const backdrop = modal.querySelector('[id$="-backdrop"]') || modal.querySelector('.backdrop-blur-sm');
            const content = modal.querySelector('[id$="-content"]') || modal.querySelector('.transform');

            if (backdrop) {
                backdrop.classList.remove('opacity-0');
                backdrop.classList.add('opacity-100');
            }

            if (content) {
                content.classList.remove('opacity-0', 'scale-95');
                content.classList.add('opacity-100', 'scale-100');
            }
        });
    }
};

export const closeModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) {
        const backdrop = modal.querySelector('[id$="-backdrop"]') || modal.querySelector('.backdrop-blur-sm');
        const content = modal.querySelector('[id$="-content"]') || modal.querySelector('.transform');

        if (backdrop) {
            backdrop.classList.remove('opacity-100');
            backdrop.classList.add('opacity-0');
        }

        if (content) {
            content.classList.remove('opacity-100', 'scale-100');
            content.classList.add('opacity-0', 'scale-95');
        }

        // Wait for animation to finish before hiding
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.classList.remove('overflow-hidden');
        }, 300);
    }
};

export const formatTimeRange = (startTime, endTime) => {
    if (!startTime || !endTime) return '';
    
    // Helper to format a single time string (HH:MM or ISO)
    const formatSingleTime = (t) => {
        let h, m;
        if (t.includes('T') || t.includes(' ')) {
            const d = new Date(t.replace(' ', 'T'));
            h = d.getHours();
            m = d.getMinutes();
        } else if (t.includes(':')) {
            const parts = t.split(':');
            h = parseInt(parts[0]);
            m = parseInt(parts[1]);
        } else {
            return t; // fallback
        }
        
        const ampm = h >= 12 ? 'م' : 'ص';
        const h12 = h % 12 || 12;
        const mStr = m < 10 ? '0' + m : m;
        return `${h12}:${mStr} ${ampm}`;
    };

    return `${formatSingleTime(startTime)} - ${formatSingleTime(endTime)}`;
};

// Confirmation Modal Helper
export const confirmAction = (message, onConfirm, confirmText = 'نعم، متابعة') => {
    const overlay = document.getElementById('confirm-modal-overlay');
    const msgEl = document.getElementById('confirm-modal-message');
    const yesBtn = document.getElementById('confirm-modal-yes');
    const noBtn = document.getElementById('confirm-modal-no');

    if (!overlay || !msgEl || !yesBtn || !noBtn) {
        // Fallback to browser confirm if modal elements are missing
        if (confirm(message)) {
            onConfirm();
        }
        return;
    }

    msgEl.textContent = message;
    yesBtn.textContent = confirmText; // Update button text
    
    overlay.classList.remove('hidden');
    overlay.classList.add('flex'); // Ensure flex is added if it was removed

    // Remove existing listeners to avoid duplicates (cleaner way would be to clone nodes)
    const newYes = yesBtn.cloneNode(true);
    const newNo = noBtn.cloneNode(true);
    yesBtn.parentNode.replaceChild(newYes, yesBtn);
    noBtn.parentNode.replaceChild(newNo, noBtn);

    const close = () => {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
    };

    newYes.addEventListener('click', () => {
        close();
        onConfirm();
    });

    newNo.addEventListener('click', close);
    
    // Also close on overlay click
    overlay.onclick = (e) => {
        if (e.target === overlay) close();
    };
};

export const showConfirmationModal = confirmAction;

// Empty State Helper
export const renderEmptyState = (container, text, icon) => {
    container.innerHTML = `
        <div class="empty-state flex flex-col items-center justify-center py-16 text-center animate-fade-in">
            <div class="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4 shadow-sm border border-gray-100">
                <i class="fas ${icon} text-4xl text-gray-300"></i>
            </div>
            <p class="text-gray-500 font-medium text-lg">${text}</p>
        </div>
    `;
};

// Action Progress HUD (for long running tasks)
export const showActionProgress = (initialMessage) => {
    const toast = showToast(initialMessage, true, 999999); // Long duration
    const msgEl = toast.querySelector('.flex-1');
    const iconEl = toast.querySelector('i');
    
    // Change icon to spinner
    if(iconEl) {
        iconEl.className = 'fas fa-spinner fa-spin text-blue-600';
    }
    
    return {
        update: (msg) => {
            if(msgEl) msgEl.textContent = msg;
        },
        success: (msg) => {
            if(msgEl) msgEl.textContent = msg;
            if(iconEl) iconEl.className = 'fas fa-check-circle text-emerald-600';
            setTimeout(() => {
                toast.classList.add('translate-x-full', 'opacity-0');
                setTimeout(() => toast.remove(), 280);
            }, 2000);
        },
        error: (msg) => {
            if(msgEl) msgEl.textContent = msg;
            if(iconEl) iconEl.className = 'fas fa-exclamation-circle text-rose-600';
            // Change style to error
            toast.classList.remove('bg-emerald-50', 'ring-emerald-200', 'text-emerald-800');
            toast.classList.add('bg-rose-50', 'ring-rose-200', 'text-rose-800');
            
            setTimeout(() => {
                toast.classList.add('translate-x-full', 'opacity-0');
                setTimeout(() => toast.remove(), 280);
            }, 3000);
        },
        close: () => {
            toast.classList.add('translate-x-full', 'opacity-0');
            setTimeout(() => toast.remove(), 280);
        }
    };
};
