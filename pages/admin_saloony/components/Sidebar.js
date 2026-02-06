const Sidebar = {
    render: () => {
        // Detect current page based on URL path
        const path = window.location.pathname;
        
        const menuItems = [
            { label: 'Dashboard', icon: 'fa-solid fa-home', href: '/admin_saloony/dashboard/index.html' },
            { label: 'Progress', icon: 'fa-solid fa-chart-line', href: '/admin_saloony/dashboard/progress.html' },
            { label: 'Salons', icon: 'fa-solid fa-store', href: '/admin_saloony/dashboard/salons.html' },
            { label: 'Subscriptions', icon: 'fa-solid fa-file-invoice-dollar', href: '/admin_saloony/dashboard/subscriptions.html' },
            { label: 'Users', icon: 'fa-solid fa-users', href: '/admin_saloony/dashboard/users.html' },
            { label: 'Create Salon', icon: 'fa-solid fa-plus-circle', href: '/admin_saloony/dashboard/create_salon.html' },
            { label: 'Employees', icon: 'fa-solid fa-id-card', href: '/admin_saloony/employees/index.html' },
            { label: 'Reports', icon: 'fa-solid fa-chart-pie', href: '/admin_saloony/employees/report.html' },
        ];

        return `
            <aside id="sidebar" class="fixed top-0 left-0 z-40 w-72 h-screen transition-transform -translate-x-full md:translate-x-0 bg-white border-r border-gray-100 shadow-xl md:shadow-none" aria-label="Sidebar">
                <div class="h-full flex flex-col bg-white">
                    <!-- Logo Section -->
                    <div class="flex flex-col items-center justify-center py-8 border-b border-gray-100 mb-4">
                        <div class="relative w-20 h-20 mb-3 rounded-2xl bg-emerald-50 flex items-center justify-center shadow-sm">
                            <img src="/images/Saloony-app_icon.png" class="w-12 h-12 object-contain" alt="Saloony Logo" />
                        </div>
                        <span class="text-2xl font-extrabold text-slate-800 tracking-tight">Saloony Admin</span>
                        <span class="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full mt-1">Control Panel</span>
                    </div>

                    <!-- Menu Items -->
                    <div class="px-4 flex-1 overflow-y-auto custom-scrollbar">
                        <ul class="space-y-1.5 font-medium">
                            ${menuItems.map(item => {
                                // Simple active check (can be improved)
                                const isActive = path.includes(item.href.split('/').pop()); 
                                // Active State: Green bg, bold text, shadow, left border
                                const activeClass = isActive 
                                    ? 'bg-gradient-to-r from-emerald-50 to-white text-emerald-700 shadow-sm border-l-4 border-emerald-500 translate-x-[4px]' 
                                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 border-l-4 border-transparent';
                                
                                return `
                                    <li>
                                        <a href="${item.href}" class="flex items-center p-3.5 rounded-xl group transition-all duration-200 ${activeClass}">
                                            <i class="${item.icon} w-6 h-6 text-lg transition duration-200 ${isActive ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-600'}"></i>
                                            <span class="ml-3 text-sm font-bold">${item.label}</span>
                                            ${isActive ? '<i class="fa-solid fa-chevron-right ml-auto text-xs text-emerald-400"></i>' : ''}
                                        </a>
                                    </li>
                                `;
                            }).join('')}
                        </ul>
                    </div>

                    <!-- Footer / Logout -->
                    <div class="mt-auto border-t border-gray-100 bg-gray-50/50 p-4">
                        <button id="admin-logout" class="flex w-full items-center justify-center gap-2 p-3 text-red-600 bg-white border border-red-100 rounded-xl hover:bg-red-50 hover:border-red-200 shadow-sm transition-all duration-200 group">
                            <i class="fa-solid fa-arrow-right-from-bracket group-hover:translate-x-1 transition-transform"></i>
                            <span class="font-bold text-sm">Logout</span>
                        </button>
                    </div>
                </div>
            </aside>
            <div id="sidebar-overlay" class="fixed inset-0 bg-slate-900/60 z-30 hidden md:hidden backdrop-blur-sm transition-opacity" onclick="toggleSidebar()"></div>
        `;
    }
};

window.Sidebar = Sidebar;
