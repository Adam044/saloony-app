const TopBar = {
    render: () => {
        return `
            <nav class="fixed top-0 left-0 right-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-3 flex items-center justify-between md:hidden shadow-sm">
                <div class="flex items-center gap-3">
                    <button onclick="toggleSidebar()" class="p-2 -ml-2 text-slate-600 hover:text-emerald-600 hover:bg-slate-50 rounded-lg transition-colors">
                        <i class="fa-solid fa-bars text-xl"></i>
                    </button>
                    <div class="flex items-center gap-2">
                        <img src="/images/Saloony-app_icon.png" class="w-8 h-8 rounded-lg" alt="Logo">
                        <span class="font-bold text-slate-800 text-lg">Saloony Admin</span>
                    </div>
                </div>
            </nav>
            <!-- Spacer to prevent content from being hidden behind fixed topbar on mobile -->
            <div class="h-16 md:hidden"></div>
        `;
    }
};

window.TopBar = TopBar;
