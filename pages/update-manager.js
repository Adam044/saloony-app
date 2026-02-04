// PWA Update Manager
// This script handles service worker updates and displays update notifications

class UpdateManager {
    constructor() {
        this.registration = null;
        this.updateModal = null;
        this.updateBtn = null;
        this.hasUpdate = false;
        
        this.init();
    }

    async init() {
        // Check if service workers are supported
        if ('serviceWorker' in navigator) {
            try {
                // Register service worker if not already registered
                this.registration = await navigator.serviceWorker.register('/service-worker.js');
                
                // Set up update detection
                this.setupUpdateDetection();
                
                // Set up UI elements
                this.setupUI();
                
                console.log('Update Manager initialized successfully');
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    }

    setupUpdateDetection() {
        if (!this.registration) return;

        // Listen for service worker updates
        this.registration.addEventListener('updatefound', () => {
            const newWorker = this.registration.installing;
            
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    // New service worker is available
                    this.hasUpdate = true;
                    this.showUpdateModal();
                }
            });
        });

        // Listen for messages from service worker
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'SW_UPDATED') {
                this.hasUpdate = true;
                this.showUpdateModal();
            }
        });

        // Check for updates periodically (every 30 minutes)
        setInterval(() => {
            this.checkForUpdates();
        }, 30 * 60 * 1000);

        // Check for updates when page becomes visible
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkForUpdates();
            }
        });
    }

    setupUI() {
        this.updateModal = document.getElementById('update-modal');
        this.updateBtn = document.getElementById('update-btn');

        if (this.updateBtn) {
            this.updateBtn.addEventListener('click', () => {
                this.applyUpdate();
            });
        }
    }

    async checkForUpdates() {
        if (!this.registration) return;

        try {
            await this.registration.update();
        } catch (error) {
            console.error('Failed to check for updates:', error);
        }
    }

    showUpdateModal() {
        if (this.updateModal && !this.updateModal.classList.contains('show')) {
            this.updateModal.classList.add('show');
            
            // Add animation delay
            setTimeout(() => {
                if (this.updateModal) {
                    this.updateModal.style.display = 'flex';
                }
            }, 100);
        }
    }

    hideUpdateModal() {
        if (this.updateModal) {
            this.updateModal.classList.remove('show');
            
            setTimeout(() => {
                if (this.updateModal) {
                    this.updateModal.style.display = 'none';
                }
            }, 300);
        }
    }

    async applyUpdate() {
        if (!this.hasUpdate) return;

        try {
            // Show loading state
            if (this.updateBtn) {
                this.updateBtn.innerHTML = '<i class="fas fa-spinner fa-spin ml-2"></i>جاري التحديث...';
                this.updateBtn.disabled = true;
            }

            // Tell the service worker to skip waiting
            if (this.registration && this.registration.waiting) {
                this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }

            // Wait a moment for the service worker to activate
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Reload the page to apply updates
            window.location.reload();
            
        } catch (error) {
            console.error('Failed to apply update:', error);
            
            // Reset button state
            if (this.updateBtn) {
                this.updateBtn.innerHTML = '<i class="fas fa-download ml-2"></i>تحديث الآن';
                this.updateBtn.disabled = false;
            }
        }
    }

    // Force check for updates (can be called manually)
    async forceUpdateCheck() {
        await this.checkForUpdates();
    }
}

// Initialize update manager when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.updateManager = new UpdateManager();
    });
} else {
    window.updateManager = new UpdateManager();
}

// Export for manual usage
window.UpdateManager = UpdateManager;