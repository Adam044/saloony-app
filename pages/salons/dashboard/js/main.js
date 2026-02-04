
import { initAuth, checkRoleSystemEnabled } from './auth.js';
import { initUI, showLoading, hideLoading, showToast } from './ui.js';
import { initAppointments } from './appointments.js';
import { initNotifications } from './notifications.js';
import { initStaff } from './staff.js';
import { initRoles } from './roles.js';
import { initSchedule } from './schedule.js';
import { initServices } from './services.js';
import { initProfile } from './profile.js';
import { initInvoices } from './invoices.js';
import { initLocation } from './location.js';
import { initReviews } from './reviews.js';
import { initSocial } from './social.js';
import { initProducts } from './products.js';

// Global State
export let currentUser = null;
export let currentSalonId = null;

// Main Initialization
const initDashboard = async () => {
    try {
        // 1. Initialize Authentication
        const authData = await initAuth();
        if (!authData) return; // Auth failed or redirecting
        
        currentUser = authData;
        currentSalonId = authData.salonId;
        
        console.log(`🚀 Dashboard initializing for Salon: ${currentSalonId}, User: ${currentUser.name} (${currentUser.role})`);

        // 2. Initialize UI (Navigation, Header, etc.)
        initUI(currentUser);
        
        // 3. Check Role/PIN System
        await checkRoleSystemEnabled();
        
        // 4. Initialize Core Modules
        // We start notifications early for real-time updates
        initNotifications(currentSalonId);
        
        // Load staff first so other modules can use the staff list (e.g. Schedule)
        await initStaff(currentSalonId);

        await Promise.all([
            initAppointments(), // This might need salonId internally or get it from window
            initRoles(currentSalonId),
            initSchedule(currentSalonId),
            initServices(currentSalonId),
            initProfile(currentSalonId),
            initInvoices(currentSalonId),
            initLocation(),
            initReviews(currentSalonId),
            initSocial(currentSalonId),
            initProducts(currentSalonId)
        ]);

        // 5. Hide Loading Screen
        hideLoading();
        
        // 5. Check for install banner (PWA)
        checkInstallBanner();

    } catch (error) {
        console.error('❌ Critical Error during initialization:', error);
        showToast('حدث خطأ أثناء تحميل لوحة التحكم. يرجى تحديث الصفحة.', false);
        // Don't hide loading if it's a critical failure, or show error state
        document.getElementById('global-loading').innerHTML = `
            <div class="text-center p-8 glass-card rounded-2xl max-w-md mx-4">
                <i class="fas fa-exclamation-triangle text-5xl text-red-500 mb-6 animate-pulse"></i>
                <h3 class="text-xl font-bold text-primary-dark mb-2">حدث خطأ غير متوقع</h3>
                <p class="text-gray-600 mb-6">نعتذر عن الإزعاج، يرجى محاولة تحديث الصفحة.</p>
                <button onclick="window.location.reload()" class="btn-primary w-full justify-center">
                    <i class="fas fa-sync-alt ml-2"></i>
                    تحديث الصفحة
                </button>
            </div>
        `;
    }
};

// PWA Install Banner Logic
const checkInstallBanner = () => {
    let deferredPrompt;
    const banner = document.getElementById('header-install-banner');
    const installBtn = document.getElementById('header-install-now-btn');
    const dismissBtn = document.getElementById('dismiss-header-banner-btn');

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (banner && !localStorage.getItem('installBannerDismissed')) {
            banner.classList.remove('hidden');
        }
    });

    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    banner.classList.add('hidden');
                }
                deferredPrompt = null;
            }
        });
    }

    if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
            banner.classList.add('hidden');
            localStorage.setItem('installBannerDismissed', 'true');
        });
    }
};

// Start the engine
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
} else {
    initDashboard();
}

// Expose global helpers for debugging
window.reloadDashboard = () => window.location.reload();
