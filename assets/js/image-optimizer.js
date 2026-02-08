/**
 * Image Optimization Utility
 * Handles lazy loading, skeleton states, and error fallbacks for all platform images.
 */

const ImageOptimizer = {
    // Configuration
    config: {
        rootMargin: '50px 0px', // Preload images slightly before they enter viewport
        threshold: 0.01,
        placeholderClass: 'image-skeleton',
        errorIcon: 'fa-image', // FontAwesome icon for broken images
        defaultFadeDuration: 300
    },

    // Global Intersection Observer for lazy loading
    observer: null,

    init() {
        // Create CSS for skeleton and transitions if not exists
        if (!document.getElementById('image-optimizer-styles')) {
            const style = document.createElement('style');
            style.id = 'image-optimizer-styles';
            style.textContent = `
                .image-skeleton {
                    background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
                    background-size: 200% 100%;
                    animation: image-skeleton-loading 1.5s infinite;
                    position: relative;
                    overflow: hidden;
                }
                @keyframes image-skeleton-loading {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
                .img-loaded {
                    opacity: 1 !important;
                    transition: opacity 0.3s ease-in-out;
                }
                .img-loading {
                    opacity: 0;
                }
                .img-error-container {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background-color: #f8fafc;
                    color: #cbd5e1;
                    width: 100%;
                    height: 100%;
                }
            `;
            document.head.appendChild(style);
        }

        // Initialize Observer
        if ('IntersectionObserver' in window) {
            this.observer = new IntersectionObserver(this.handleIntersection.bind(this), {
                rootMargin: this.config.rootMargin,
                threshold: this.config.threshold
            });
        }
        
        // Auto-optimize existing images marked with data-optimize
        document.querySelectorAll('img[data-optimize]').forEach(img => this.optimize(img));

        // Auto-optimize background images marked with data-optimize-bg
        document.querySelectorAll('[data-optimize-bg]').forEach(el => {
            this.optimizeBackground(el, el.dataset.optimizeBg);
        });
    },

    handleIntersection(entries, observer) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const target = entry.target;
                if (target.tagName === 'IMG') {
                    this.loadImage(target);
                } else {
                    this.loadBackground(target);
                }
                observer.unobserve(target);
            }
        });
    },

    /**
     * Optimize an IMG element
     * @param {HTMLImageElement} img - The image element
     * @param {string} [src] - Optional source to set (if lazy loading manually)
     */
    optimize(img, src = null) {
        if (!img) return;

        // Add skeleton class initially
        img.classList.add(this.config.placeholderClass);
        
        // Ensure object-fit is set (default to cover if not specified)
        if (!img.style.objectFit && !img.className.includes('object-')) {
            img.classList.add('object-cover');
        }

        // Setup loading state
        img.classList.add('img-loading');

        // Store src in data attribute if we want to lazy load via observer
        // If src is provided, we override the current src or data-src
        if (src) {
            img.dataset.src = src;
            img.removeAttribute('src'); // Prevent immediate load
        } else if (img.src && !img.dataset.src) {
            img.dataset.src = img.src;
            img.removeAttribute('src');
        }

        // Handle Error
        img.onerror = () => this.handleError(img);
        
        // Handle Load
        img.onload = () => {
            img.classList.remove(this.config.placeholderClass);
            img.classList.remove('img-loading');
            img.classList.add('img-loaded');
        };

        // Observe
        if (this.observer) {
            this.observer.observe(img);
        } else {
            // Fallback if no observer support
            this.loadImage(img);
        }
    },

    loadImage(img) {
        const src = img.dataset.src;
        if (!src) return;

        img.src = src;
        // If cached, onload might not trigger, so check complete
        if (img.complete) {
            img.classList.remove(this.config.placeholderClass);
            img.classList.remove('img-loading');
            img.classList.add('img-loaded');
        }
    },

    /**
     * Handle Background Image Lazy Load
     * @param {HTMLElement} el - Container element
     * @param {string} imageUrl - URL of the image
     */
    optimizeBackground(el, imageUrl) {
        if (!el || !imageUrl) return;

        el.classList.add(this.config.placeholderClass);
        el.dataset.bg = imageUrl;

        if (this.observer) {
            this.observer.observe(el);
        } else {
            this.loadBackground(el);
        }
    },

    loadBackground(el) {
        const url = el.dataset.bg;
        if (!url) return;

        // Preload image to detect finish
        const loader = new Image();
        loader.src = url;
        loader.onload = () => {
            el.style.backgroundImage = `url('${url}')`;
            el.classList.remove(this.config.placeholderClass);
            el.classList.add('img-loaded'); // Optional fade effect
        };
        loader.onerror = () => {
            el.classList.remove(this.config.placeholderClass);
            // Optional: Set fallback background or icon
            el.style.backgroundColor = '#f1f5f9';
        };
    },

    handleError(img) {
        img.classList.remove(this.config.placeholderClass);
        img.classList.remove('img-loading');
        
        // Replace with error container
        const parent = img.parentElement;
        if (parent) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'img-error-container ' + img.className;
            // Preserve specific classes like rounded or sizing, remove object-fit/layout specific that might conflict
            errorDiv.innerHTML = `<i class="fas ${this.config.errorIcon} text-2xl"></i>`;
            
            // If img is hidden or replaced, we can insert errorDiv
            // Simple approach: Hide img, show div
            img.style.display = 'none';
            parent.insertBefore(errorDiv, img);
        }
    }
};

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    ImageOptimizer.init();
});

// Export for module usage if needed, or attach to window
window.ImageOptimizer = ImageOptimizer;
