/**
 * Saloony Global Components
 * Handles rendering of the unified Header and Footer across all pages.
 */

const SaloonyComponents = {
    /**
     * Renders the global header
     * @param {string} containerId - ID of the container element (default: 'global-header')
     * @param {object} options - Configuration options
     * @param {string} options.basePath - Relative path to the root/assets folder (e.g., '../../')
     * @param {string} options.activePage - Key of the active page ('home', 'salons', 'contact')
     */
    renderHeader: (containerId = 'global-header', options = {}) => {
        const { basePath = '../../', activePage = '' } = options;
        const container = document.getElementById(containerId);
        if (!container) return;

        // Resolve paths (removing double slashes if any)
        const assetsPath = `${basePath}assets`.replace('//', '/');
        const pagesPath = `${basePath}pages/saloony`.replace('//', '/');

        // Determine active classes for menu items
        const getActiveClass = (page) => activePage === page ? 'text-[#06C167]' : 'text-white hover:text-[#06C167]';

        // Check Auth for Menu
        const token = localStorage.getItem('saloony_token');
        const accountText = token ? 'حسابي' : 'تسجيل الدخول';
        
        // Determine Account Link based on User Type
        let accountHref = token ? `${pagesPath}/user_account.html` : `${pagesPath}/auth.html`;
        if (token) {
            try {
                const userStr = localStorage.getItem('saloony_user');
                if (userStr) {
                    const user = JSON.parse(userStr);
                    const userType = String(user.user_type || '').toLowerCase().trim();
                    
                    if (userType === 'salon' || userType === 'salon_owner') {
                        accountHref = '/admin_salon';
                    } else if (userType === 'admin' || userType === 'administrator') {
                        accountHref = '/admin_dashboard';
                    } else if (userType === 'employee') {
                        accountHref = '/presentation';
                    }
                    // 'user' type keeps the default user_account.html
                }
            } catch (e) {
                console.error('Error parsing user data for menu link', e);
            }
        }

        const accountIcon = token ? 'fa-user' : 'fa-right-to-bracket';

        const html = `
            <header class="glass fixed top-0 w-full z-[70] border-b border-white/5 transition-all duration-300 text-white" id="main-header">
                <div class="max-w-7xl mx-auto px-6 h-[80px] flex items-center justify-between">
                    <!-- Logo Area -->
                    <a href="${pagesPath}/index.html" class="flex items-center gap-3 group relative z-[70]">
                        <div class="relative w-20 h-20 flex items-center justify-center">
                            <div class="absolute inset-0 bg-[#06C167] rounded-full blur-[15px] opacity-0 group-hover:opacity-30 transition-opacity duration-500"></div>
                            <img src="${assetsPath}/images/Saloony_logo.png" 
                                 onerror="this.src='https://placehold.co/48x48/1E293B/ffffff?text=S'" 
                                 alt="Saloony" 
                                 class="w-[72px] h-[72px] object-contain relative z-10 transition-transform duration-300 group-hover:scale-110">
                        </div>
                    </a>

                    <!-- Hamburger Button (Visible on all screens) -->
                    <button id="menu-toggle" class="group relative z-[70] w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition-all duration-300 focus:outline-none">
                        <div class="relative w-6 h-[14px] flex flex-col justify-between">
                            <span class="w-full h-0.5 bg-white rounded-full transition-all duration-300 origin-center group-[.open]:rotate-45 group-[.open]:translate-y-[6px]"></span>
                            <span class="w-2/3 ml-auto h-0.5 bg-[#06C167] rounded-full transition-all duration-300 group-[.open]:w-0 group-[.open]:opacity-0"></span>
                            <span class="w-full h-0.5 bg-white rounded-full transition-all duration-300 origin-center group-[.open]:-rotate-45 group-[.open]:-translate-y-[6px]"></span>
                        </div>
                    </button>
                </div>
            </header>

            <!-- Fullscreen Menu Overlay -->
            <div id="fullscreen-menu" class="fixed inset-0 bg-[#020617]/95 backdrop-blur-3xl z-[60] translate-x-full transition-transform duration-500 ease-[cubic-bezier(0.87,0,0.13,1)]">
                
                <!-- Decorative Background Elements -->
                <div class="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] bg-[#06C167]/10 rounded-full blur-[120px] pointer-events-none"></div>
                <div class="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none"></div>
                
                <div class="w-full h-full flex flex-col items-center justify-center relative z-10 px-6">
                    <nav class="flex flex-col items-start gap-6 w-full max-w-lg">
                        <a href="${pagesPath}/index.html" class="menu-link group w-full flex items-center gap-6 p-4 rounded-2xl hover:bg-white/5 transition-all duration-300 opacity-0 translate-y-8">
                            <span class="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center text-2xl text-white group-hover:bg-[#06C167] group-hover:scale-110 transition-all duration-300">
                                <i class="fa-solid fa-house"></i>
                            </span>
                            <span class="text-4xl font-bold text-white group-hover:text-[#06C167] transition-colors ${getActiveClass('home')}">الرئيسية</span>
                            <i class="fa-solid fa-arrow-left mr-auto text-white/20 group-hover:text-[#06C167] group-hover:-translate-x-2 transition-all duration-300 text-2xl"></i>
                        </a>

                            <a href="${accountHref}" class="menu-link group w-full flex items-center gap-6 p-4 rounded-2xl hover:bg-white/5 transition-all duration-300 opacity-0 translate-y-8" style="transition-delay: 100ms;">
                            <span class="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center text-2xl text-white group-hover:bg-[#06C167] group-hover:scale-110 transition-all duration-300">
                                <i class="fa-solid ${accountIcon}"></i>
                            </span>
                            <span class="text-4xl font-bold text-white group-hover:text-[#06C167] transition-colors ${getActiveClass('profile')}">${accountText}</span>
                            <i class="fa-solid fa-arrow-left mr-auto text-white/20 group-hover:text-[#06C167] group-hover:-translate-x-2 transition-all duration-300 text-2xl"></i>
                        </a>

                        <a href="${pagesPath}/registred_salons.html" class="menu-link group w-full flex items-center gap-6 p-4 rounded-2xl hover:bg-white/5 transition-all duration-300 opacity-0 translate-y-8" style="transition-delay: 200ms;">
                            <span class="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center text-2xl text-white group-hover:bg-[#06C167] group-hover:scale-110 transition-all duration-300">
                                <i class="fa-solid fa-shop"></i>
                            </span>
                            <span class="text-4xl font-bold text-white group-hover:text-[#06C167] transition-colors ${getActiveClass('salons')}">الصالونات</span>
                            <i class="fa-solid fa-arrow-left mr-auto text-white/20 group-hover:text-[#06C167] group-hover:-translate-x-2 transition-all duration-300 text-2xl"></i>
                        </a>

                        <a href="${pagesPath}/contact.html" class="menu-link group w-full flex items-center gap-6 p-4 rounded-2xl hover:bg-white/5 transition-all duration-300 opacity-0 translate-y-8" style="transition-delay: 300ms;">
                            <span class="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center text-2xl text-white group-hover:bg-[#06C167] group-hover:scale-110 transition-all duration-300">
                                <i class="fa-solid fa-envelope"></i>
                            </span>
                            <span class="text-4xl font-bold text-white group-hover:text-[#06C167] transition-colors ${getActiveClass('contact')}">تواصل معنا</span>
                            <i class="fa-solid fa-arrow-left mr-auto text-white/20 group-hover:text-[#06C167] group-hover:-translate-x-2 transition-all duration-300 text-2xl"></i>
                        </a>
                        
                        <div class="w-full h-px bg-white/10 my-4 opacity-0 translate-y-8 menu-link" style="transition-delay: 400ms;"></div>
                        
                        <div class="flex items-center justify-center w-full gap-8 opacity-0 translate-y-8 menu-link" style="transition-delay: 500ms;">
                            <a href="#" class="group relative w-14 h-14 rounded-full bg-white/5 flex items-center justify-center text-white hover:bg-gradient-to-tr hover:from-purple-500 hover:to-pink-500 hover:scale-110 transition-all duration-300">
                                <i class="fa-brands fa-instagram text-2xl"></i>
                            </a>
                            <a href="#" class="group w-14 h-14 rounded-full bg-white/5 flex items-center justify-center text-white hover:bg-[#1877F2] hover:scale-110 transition-all duration-300">
                                <i class="fa-brands fa-facebook-f text-2xl"></i>
                            </a>
                            <a href="#" class="group w-14 h-14 rounded-full bg-white/5 flex items-center justify-center text-white hover:bg-black hover:border hover:border-white/20 hover:scale-110 transition-all duration-300">
                                <i class="fa-brands fa-tiktok text-2xl"></i>
                            </a>
                        </div>
                    </nav>
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Initialize Menu Functionality
        const menuToggle = document.getElementById('menu-toggle');
        const fullscreenMenu = document.getElementById('fullscreen-menu');
        const menuLinks = document.querySelectorAll('.menu-link');
        const body = document.body;
        const header = document.getElementById('main-header');

        const closeMenu = () => {
            menuToggle.classList.remove('open');
            fullscreenMenu.classList.add('translate-x-full');
            body.style.overflow = ''; // Restore scrolling
            
            // Restore header styles
            if (header) {
                header.classList.remove('!bg-transparent', '!border-transparent', '!backdrop-blur-none');
            }
            
            // Reset links for next open
            menuLinks.forEach(link => {
                link.classList.add('opacity-0', 'translate-y-8');
            });
        };

        const openMenu = () => {
            menuToggle.classList.add('open');
            fullscreenMenu.classList.remove('translate-x-full');
            body.style.overflow = 'hidden'; // Prevent scrolling
            
            // Make header transparent so menu bg shows through
            if (header) {
                header.classList.add('!bg-transparent', '!border-transparent', '!backdrop-blur-none');
            }
            
            // Animate links in
            setTimeout(() => {
                menuLinks.forEach(link => {
                    link.classList.remove('opacity-0', 'translate-y-8');
                });
            }, 300);
        };

        if (menuToggle && fullscreenMenu) {
            menuToggle.addEventListener('click', () => {
                const isOpen = menuToggle.classList.contains('open');
                if (isOpen) closeMenu();
                else openMenu();
            });

            // Close on backdrop click (optional but good UX)
            fullscreenMenu.addEventListener('click', (e) => {
                if (e.target === fullscreenMenu) closeMenu();
            });
            
            // Close on Escape key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && menuToggle.classList.contains('open')) closeMenu();
            });
        }
    },

    /**
     * Renders the global footer
     * @param {string} containerId - ID of the container element (default: 'global-footer')
     * @param {object} options - Configuration options
     * @param {string} options.basePath - Relative path to the root/assets folder
     */
    renderFooter: (containerId = 'global-footer', options = {}) => {
        const { basePath = '../../' } = options;
        const container = document.getElementById(containerId);
        if (!container) return;

        const assetsPath = `${basePath}assets`.replace('//', '/');
        const pagesPath = `${basePath}pages/saloony`.replace('//', '/');

        const html = `
            <footer class="relative border-t border-white/5 bg-[#020617] pt-16 pb-8 overflow-hidden">
                <!-- Decorative Elements -->
                <div class="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#06C167]/30 to-transparent"></div>
                <div class="absolute -top-[100px] -left-[100px] w-[300px] h-[300px] bg-[#06C167]/5 rounded-full blur-[100px] pointer-events-none"></div>

                <div class="max-w-7xl mx-auto px-6 grid md:grid-cols-12 gap-12 relative z-10">
                    <!-- Brand Section (Col 1-5) -->
                    <div class="md:col-span-5 text-center md:text-right">
                        <div class="inline-flex items-center gap-3 mb-6">
                            <img src="${assetsPath}/images/Saloony_logo.png" 
                                 onerror="this.src='https://placehold.co/48x48/1E293B/ffffff?text=S'" 
                                 class="w-10 h-10 object-contain brightness-110">
                        </div>
                        <p class="text-slate-400 text-sm leading-7 mb-6 max-w-sm mx-auto md:mx-0">
                            منصتك الأولى لاكتشاف وحجز مواعيد الصالونات. نجمع بين الأناقة والتكنولوجيا لنقدم لك تجربة جمال لا تضاهى.
                        </p>
                        <!-- Social Links -->
                        <div class="flex justify-center md:justify-start gap-3">
                            <a href="#" class="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 hover:bg-[#06C167] hover:text-white hover:border-[#06C167] hover:-translate-y-1 transition-all duration-300">
                                <i class="fa-brands fa-instagram text-lg"></i>
                            </a>
                            <a href="#" class="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 hover:bg-[#1877F2] hover:text-white hover:border-[#1877F2] hover:-translate-y-1 transition-all duration-300">
                                <i class="fa-brands fa-facebook-f text-lg"></i>
                            </a>
                            <a href="#" class="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 hover:bg-[#000000] hover:text-white hover:border-[#333] hover:-translate-y-1 transition-all duration-300">
                                <i class="fa-brands fa-tiktok text-lg"></i>
                            </a>
                        </div>
                    </div>
                    
                    <!-- Quick Links (Col 6-8) -->
                    <div class="md:col-span-3 text-center md:text-right">
                        <h3 class="text-white font-bold text-lg mb-6 relative inline-block">
                            روابط سريعة
                            <span class="absolute -bottom-2 right-0 w-8 h-1 bg-[#06C167] rounded-full"></span>
                        </h3>
                        <ul class="space-y-4 text-sm text-slate-400">
                            <li><a href="${pagesPath}/index.html" class="hover:text-[#06C167] transition-colors flex items-center justify-center md:justify-start gap-2 group"><span class="w-1.5 h-1.5 rounded-full bg-[#06C167] opacity-0 group-hover:opacity-100 transition-opacity"></span>الرئيسية</a></li>
                            <li><a href="${pagesPath}/registred_salons.html" class="hover:text-[#06C167] transition-colors flex items-center justify-center md:justify-start gap-2 group"><span class="w-1.5 h-1.5 rounded-full bg-[#06C167] opacity-0 group-hover:opacity-100 transition-opacity"></span>الصالونات المنضمة</a></li>
                            <li><a href="${pagesPath}/contact.html" class="hover:text-[#06C167] transition-colors flex items-center justify-center md:justify-start gap-2 group"><span class="w-1.5 h-1.5 rounded-full bg-[#06C167] opacity-0 group-hover:opacity-100 transition-opacity"></span>تواصل معنا</a></li>
                        </ul>
                    </div>

                    <!-- Contact Info (Col 9-12) -->
                    <div class="md:col-span-4 text-center md:text-right">
                        <h3 class="text-white font-bold text-lg mb-6 relative inline-block">
                            تواصل معنا
                            <span class="absolute -bottom-2 right-0 w-8 h-1 bg-[#06C167] rounded-full"></span>
                        </h3>
                        <ul class="space-y-4 text-sm text-slate-400">
                            <li class="flex flex-col md:flex-row items-center md:items-start gap-3">
                                <div class="w-8 h-8 rounded-full bg-[#06C167]/10 flex items-center justify-center text-[#06C167] shrink-0">
                                    <i class="fa-solid fa-location-dot"></i>
                                </div>
                                <span>فلسطين</span>
                            </li>
                            <li class="flex flex-col md:flex-row items-center md:items-start gap-3">
                                <div class="w-8 h-8 rounded-full bg-[#06C167]/10 flex items-center justify-center text-[#06C167] shrink-0">
                                    <i class="fa-solid fa-envelope"></i>
                                </div>
                                <a href="mailto:saloony.service@gmail.com" class="hover:text-white transition">saloony.service@gmail.com</a>
                            </li>
                            <li class="flex flex-col md:flex-row items-center md:items-start gap-3">
                                <div class="w-8 h-8 rounded-full bg-[#06C167]/10 flex items-center justify-center text-[#06C167] shrink-0">
                                    <i class="fa-solid fa-phone"></i>
                                </div>
                                <span dir="ltr">+970 59 4444403</span>
                            </li>
                        </ul>
                    </div>
                </div>

                <div class="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-white/5">
                    <div class="flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
                        <p>© ${new Date().getFullYear()} صالوني. جميع الحقوق محفوظة.</p>
                        <div class="flex gap-6">
                            <a href="#" class="hover:text-white transition">سياسة الخصوصية</a>
                            <a href="#" class="hover:text-white transition">الشروط والأحكام</a>
                        </div>
                    </div>
                </div>
            </footer>
        `;

        container.innerHTML = html;
    }
};
