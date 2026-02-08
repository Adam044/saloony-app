
export const CropperManager = {
    cropper: null,
    modal: null,
    resolvePromise: null,
    currentFile: null,
    options: null,

    init() {
        if (document.getElementById('cropper-modal')) return;

        const modalHTML = `
        <div id="cropper-modal" class="fixed inset-0 z-[200] hidden" role="dialog" aria-modal="true">
            <!-- Backdrop -->
            <div class="absolute inset-0 bg-black/90 backdrop-blur-sm transition-opacity opacity-0" id="cropper-backdrop"></div>
            
            <!-- Modal Content -->
            <div class="absolute inset-0 flex items-center justify-center p-4">
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col transform transition-all scale-95 opacity-0 overflow-hidden" id="cropper-content">
                    
                    <!-- Header -->
                    <div class="flex items-center justify-between p-4 border-b border-gray-100 bg-white z-10">
                        <h3 class="text-lg font-bold text-gray-800" id="cropper-title">تعديل الصورة</h3>
                        <button type="button" class="text-gray-400 hover:text-gray-600 transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100" id="cropper-close-btn">
                            <i class="fas fa-times text-lg"></i>
                        </button>
                    </div>

                    <!-- Body (Image Area) -->
                    <div class="flex-1 relative bg-slate-900 overflow-hidden min-h-[300px] flex items-center justify-center">
                        <img id="cropper-image" class="max-w-full max-h-full block" src="" alt="To Crop">
                    </div>

                    <!-- Simple Toolbar (Zoom Only) -->
                    <div class="p-4 bg-white border-t border-gray-100 flex flex-col gap-4 z-10">
                        
                        <!-- Zoom Slider -->
                        <div class="flex items-center gap-4 px-2">
                            <i class="fas fa-minus text-gray-400 text-sm"></i>
                            <input type="range" id="cropper-zoom-slider" min="0" max="100" value="0" step="1" 
                                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-secondary hover:accent-secondary-dark transition-all">
                            <i class="fas fa-plus text-gray-400 text-sm"></i>
                        </div>

                        <!-- Action Buttons -->
                        <div class="flex justify-between items-center pt-2">
                            <button type="button" id="cropper-cancel-btn" class="px-6 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition text-sm">
                                إلغاء
                            </button>
                            <button type="button" id="cropper-save-btn" class="px-8 py-2.5 bg-secondary hover:bg-secondary-dark text-white font-bold rounded-xl shadow-lg shadow-green-100 transition flex items-center gap-2 text-sm transform active:scale-95">
                                <i class="fas fa-check"></i>
                                <span>حفظ الصورة</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('cropper-modal');
        this.bindEvents();
    },

    bindEvents() {
        const closeBtn = document.getElementById('cropper-close-btn');
        const cancelBtn = document.getElementById('cropper-cancel-btn');
        const saveBtn = document.getElementById('cropper-save-btn');
        const zoomSlider = document.getElementById('cropper-zoom-slider');

        const closeHandler = () => this.close();
        closeBtn.addEventListener('click', closeHandler);
        cancelBtn.addEventListener('click', closeHandler);

        saveBtn.addEventListener('click', () => this.crop());

        // Zoom Slider Logic
        zoomSlider.addEventListener('input', (e) => {
            if (!this.cropper) return;
            
            const value = parseInt(e.target.value);
            // Convert 0-100 slider to zoom ratio (0.1 to 3.0)
            // Base zoom is usually around 1 (fit to container) or initialized zoom
            // We need to manage relative zoom. 
            // Better approach: zoomTo(initialRatio + value * factor)
            
            const containerData = this.cropper.getContainerData();
            const canvasData = this.cropper.getCanvasData(); // current image size
            
            // We want 0 on slider = fit to crop box
            // 100 on slider = 3x zoom
            
            // To make this smooth, we need to know the 'min zoom' which fits the image to the crop box.
            // But cropper.js handles 'viewMode: 1' to keep image covering the crop box.
            // So 'min zoom' is whatever keeps it covering.
            
            // Let's try simpler relative zoom for now:
            // Map 0-100 to scale 1.0 - 3.0 relative to initial load
            // But initial load might already be zoomed out/in.
            
            // Alternative: Use `zoomTo`.
            // Let's assume the user starts at "fit" state (which is minimum zoom in viewMode 1/3).
            // We can get the initial zoom data when image loads.
        });
    },

    open(file, options = {}) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type.startsWith('image/')) {
                reject('Invalid file type');
                return;
            }

            this.init(); // Ensure modal exists
            this.currentFile = file;
            this.resolvePromise = resolve;
            this.options = options;

            const image = document.getElementById('cropper-image');
            const content = document.getElementById('cropper-content');
            const backdrop = document.getElementById('cropper-backdrop');
            const title = document.getElementById('cropper-title');
            const zoomSlider = document.getElementById('cropper-zoom-slider');

            // Set Title
            title.textContent = options.title || 'تعديل الصورة';
            
            // Reset Slider
            zoomSlider.value = 0;

            // Handle Circular View (Visual Only)
            if (options.isCircle) {
                const style = document.createElement('style');
                style.id = 'cropper-circle-style';
                style.innerHTML = `
                    .cropper-view-box, .cropper-face {
                        border-radius: 50%;
                        outline: 0;
                    }
                    /* Dim the area outside the crop box more */
                    .cropper-modal {
                        opacity: 0.8; 
                        background-color: #000;
                    }
                    /* Hide the dashed lines and drag handles */
                    .cropper-dashed, .cropper-point, .cropper-line {
                        display: none !important;
                    }
                    /* Make the crop box border subtle or invisible */
                    .cropper-view-box {
                        outline: 2px solid rgba(255, 255, 255, 0.5);
                    }
                `;
                document.head.appendChild(style);
            } else {
                // For non-circle (rectangular) masks, we also want to hide handles/lines if fixedAspect is true
                const style = document.createElement('style');
                style.id = 'cropper-circle-style'; // Reuse ID for cleanup
                if (options.fixedAspect) {
                    style.innerHTML = `
                        .cropper-dashed, .cropper-point, .cropper-line {
                            display: none !important;
                        }
                        .cropper-view-box {
                            outline: 2px solid rgba(255, 255, 255, 0.5);
                        }
                        .cropper-modal {
                            opacity: 0.8;
                        }
                    `;
                } else {
                    style.innerHTML = ``; // Reset
                }
                document.head.appendChild(style);
            }

            // Prepare Image
            const reader = new FileReader();
            reader.onload = (e) => {
                image.src = e.target.result;
                
                // Show Modal
                this.modal.classList.remove('hidden');
                setTimeout(() => {
                    backdrop.classList.remove('opacity-0');
                    content.classList.remove('opacity-0', 'scale-95');
                }, 10);

                // Init Cropper
                if (this.cropper) this.cropper.destroy();
                
                const isFixed = options.fixedAspect === true;
                
                this.cropper = new Cropper(image, {
                    aspectRatio: options.aspectRatio !== undefined ? options.aspectRatio : NaN,
                    viewMode: 1, // Restrict crop box to not exceed canvas, but allow image to be moved freely? 
                                 // viewMode: 1 = Restrict the crop box to not exceed the size of the canvas.
                                 // viewMode: 3 = Restrict the minimum canvas size to fit within the container. 
                                 // If the proportions of the canvas and the container differ, the minimum canvas will be surrounded by extra space in one of the dimensions.
                    
                    dragMode: isFixed ? 'move' : 'crop', // Move image if fixed, else draw crop box
                    autoCropArea: isFixed ? 0.8 : 0.8,
                    restore: false,
                    guides: !isFixed,
                    center: !isFixed,
                    highlight: false,
                    cropBoxMovable: !isFixed, // Disable crop box move if fixed
                    cropBoxResizable: !isFixed, // Disable crop box resize if fixed
                    toggleDragModeOnDblclick: false,
                    zoomOnTouch: true,
                    zoomOnWheel: true,
                    minCropBoxWidth: 50,
                    minCropBoxHeight: 50,
                    
                    ready: () => {
                        // On load, capture the initial zoom ratio for the slider
                        // We want the slider to control zoom relative to this initial fit state
                        
                        // Also, if fixed, center the crop box once
                        if (isFixed) {
                            // The crop box is auto-centered by default with autoCropArea
                        }
                        
                        // Bind slider real-time
                        zoomSlider.oninput = (ev) => {
                            const val = parseInt(ev.target.value); // 0 to 100
                            
                            // Get initial data if not stored
                            if (!this.initialZoomData) {
                                this.initialZoomData = this.cropper.getCanvasData();
                                this.initialContainerData = this.cropper.getContainerData();
                            }
                            
                            // Calculate zoom. 
                            // 0 = fit (initial)
                            // 100 = 2.5x zoom
                            const minZoom = this.initialZoomData.width / this.cropper.getImageData().naturalWidth; 
                            // Actually cropper.zoomTo uses ratio relative to natural size
                            
                            // Let's use relative scaling from the initial loaded state
                            // initial width
                            const initialWidth = this.initialZoomData.width;
                            const targetWidth = initialWidth * (1 + (val / 100) * 2); // Up to 3x size
                            
                            // We can't set width directly easily without math. 
                            // Simplest: cropper.zoomTo(ratio)
                            
                            // Let's use getCanvasData to see current width vs natural
                            // But easier:
                            // Just use zoom(ratio) relative to previous? No, slider needs absolute value.
                            
                            // Best way:
                            // ratio = (val / 50) + initialRatio? 
                            // Let's just use a simple approach: 
                            // We know at 0 it is 'fit'. 
                            // We can trigger 'reset' then zoom? No, jerky.
                            
                            // Correct approach with Cropper.js:
                            // The library doesn't expose 'current zoom level' nicely as a single 0-1 float we can set.
                            // But we can set the canvas data.
                            
                            // Let's do this:
                            // On 'ready', store the `imageData` (natural dimensions) and `canvasData` (rendered dimensions).
                            // Calculate the `baseRatio` = canvasData.width / imageData.naturalWidth.
                            // Slider 0 => baseRatio.
                            // Slider 100 => baseRatio * 3.
                            
                            const imageData = this.cropper.getImageData();
                            // If we don't have baseRatio, calc it
                            if (!this.baseRatio) {
                                const canvasData = this.cropper.getCanvasData();
                                this.baseRatio = canvasData.width / imageData.naturalWidth;
                            }
                            
                            const zoomRatio = this.baseRatio * (1 + (val / 40)); // Gentler zoom
                            this.cropper.zoomTo(zoomRatio);
                        };
                        
                        // Reset baseRatio on new image
                        this.baseRatio = null;
                        
                        // If user zooms via touch/wheel, update slider?
                        image.addEventListener('zoom', (e) => {
                             // Update slider position based on new zoom?
                             // This is complex because of event loops. Let's keep it simple: Slider controls zoom. Wheel controls zoom. 
                             // Updating slider from wheel might be jerky.
                        });
                    }
                });
            };
            reader.readAsDataURL(file);
        });
    },

    close() {
        const content = document.getElementById('cropper-content');
        const backdrop = document.getElementById('cropper-backdrop');

        if (content && backdrop) {
            content.classList.add('opacity-0', 'scale-95');
            backdrop.classList.add('opacity-0');
            
            setTimeout(() => {
                this.modal.classList.add('hidden');
                if (this.cropper) {
                    this.cropper.destroy();
                    this.cropper = null;
                }
                document.getElementById('cropper-image').src = '';
                // Clean up styles
                const style = document.getElementById('cropper-circle-style');
                if (style) style.remove();
            }, 300);
        }
    },

    crop() {
        if (!this.cropper) return;

        this.cropper.getCroppedCanvas({
            maxWidth: 4096,
            maxHeight: 4096,
            fillColor: '#fff',
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
        }).toBlob((blob) => {
            if (blob) {
                // Create a new File object
                const newFile = new File([blob], this.currentFile.name, {
                    type: this.currentFile.type,
                    lastModified: Date.now(),
                });

                if (this.resolvePromise) {
                    this.resolvePromise(newFile);
                    this.resolvePromise = null;
                }
                this.close();
            }
        }, this.currentFile.type);
    }
};
