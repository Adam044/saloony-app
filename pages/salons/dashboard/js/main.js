
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
import { initGallery } from './gallery.js';
import { initSubscriptions } from './subscriptions.js';

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
            initProducts(currentSalonId),
            initGallery(currentSalonId),
            initSubscriptions(currentSalonId)
        ]);

        // 5. Hide Loading Screen
        hideLoading();
        
        // 5. Initialize PWA Install Logic
        initInstallAppLogic();

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

// PWA Install Logic
const initInstallAppLogic = () => {
    const installArea = document.getElementById('pwa-install-area');
    const installBtn = document.getElementById('pwa-install-btn');
    const installedMsg = document.getElementById('pwa-installed-msg');
    let deferredPrompt = null;

    // Check if running in standalone mode (already installed)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (isStandalone) {
        if (installedMsg) {
            installedMsg.classList.remove('hidden');
            installedMsg.classList.add('flex');
        }
        // Also hide the install area if it's visible by default
        if (installArea) {
            installArea.classList.add('hidden');
            installArea.classList.remove('flex');
        }
        return; // Stop here, don't show install button
    }

    // Helper to enable install button
    const enableInstallButton = () => {
        if (installArea) {
            installArea.classList.remove('hidden');
            installArea.classList.add('flex', 'flex-col');
        }
    };

    // Check if AppMode already captured the event
    if (window.__canInstallApp) {
        enableInstallButton();
    }

    // Listen for AppMode event
    window.addEventListener('can-install-app', enableInstallButton);

    // Fallback: Listen for raw event if AppMode didn't catch it yet
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent Chrome 67 and earlier from automatically showing the prompt
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredPrompt = e;
        // Update UI notify the user they can add to home screen
        enableInstallButton();
    });

    const handleInstallClick = async (e) => {
        if (e && e.preventDefault) e.preventDefault();

        // Priority 1: Use local deferred prompt
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to the install prompt: ${outcome}`);
            deferredPrompt = null;
            return;
        }

        // Priority 2: Use AppMode to prompt (Only if available to avoid redirect)
        if (window.AppMode && window.AppMode.promptInstall && window.__canInstallApp) {
            const outcome = await window.AppMode.promptInstall();
            if (outcome) return;
        }

        // Priority 3: Fallback (Show Manual Instructions or Feedback)
        showToast('جاري تحضير التثبيت... إذا لم يظهر شيء، يرجى اتباع التعليمات اليدوية.', 'info');
        
        // Try to focus manual instructions if they exist
        const manualSection = document.getElementById('pwa-manual-instructions');
        if (manualSection) {
            manualSection.scrollIntoView({ behavior: 'smooth' });
            manualSection.classList.add('ring-2', 'ring-secondary', 'transition-all');
            setTimeout(() => manualSection.classList.remove('ring-2', 'ring-secondary'), 2000);
        }
    };

    // Main Install Button
    if (installBtn) {
        installBtn.addEventListener('click', handleInstallClick);
    }

    // New "Download Now" buttons in manual tabs
    document.querySelectorAll('.install-trigger-btn').forEach(btn => {
        btn.addEventListener('click', handleInstallClick);
    });

    // Manual Instructions Tab Logic
    const tabs = document.querySelectorAll('.manual-tab-btn');
    const contents = document.querySelectorAll('.manual-content');

    if (tabs.length > 0) {
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // 1. Reset all tabs
                tabs.forEach(t => {
                    t.classList.remove('active', 'bg-white', 'text-secondary', 'shadow-sm', 'border', 'border-slate-200');
                    t.classList.add('text-slate-500', 'hover:bg-white', 'hover:shadow-sm');
                });

                // 2. Activate clicked tab
                tab.classList.remove('text-slate-500', 'hover:bg-white', 'hover:shadow-sm');
                tab.classList.add('active', 'bg-white', 'text-secondary', 'shadow-sm', 'border', 'border-slate-200');

                // 3. Show target content
                const targetId = tab.dataset.target;
                contents.forEach(c => {
                    if (c.id === targetId) {
                        c.classList.remove('hidden');
                    } else {
                        c.classList.add('hidden');
                    }
                });
            });
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
