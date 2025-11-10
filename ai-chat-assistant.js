// AI Chat Assistant Module - Saloony Beauty Consultant
// Implements intelligent Palestinian beauty consultation with conversation memory

const db = require('./database');

// PostgreSQL-compatible query function
const dbAll = (sql, params = []) => db.query(sql, params);

class SaloonyAIAssistant {
    constructor() {
        this.apiKey = process.env.DEEPSEEK_API_KEY;
        this.apiUrl = 'https://api.deepseek.com/v1/chat/completions';
        this.conversationMemory = new Map(); // Store conversation history per user
        this.maxHistoryLength = 6; // Optimized for cost and context balance
        
        // Initialize caching system
        this.initializeCache();
        this.initializeLocalStorageCache(); // Initialize localStorage caching
    }

    // === Optimized Token Usage Tracking ===

    /**
     * Track token usage for analytics (optimized with batching)
     */
    async trackTokenUsage(userId, inputTokens, outputTokens, model = 'deepseek-chat') {
        try {
            // Only track if tokens are significant (reduce DB writes)
            if (inputTokens + outputTokens < 10) return;
            
            // Batch token tracking to reduce DB load
            if (!this.tokenBatch) {
                this.tokenBatch = [];
                // Flush batch every 30 seconds or 50 entries
                setTimeout(() => this.flushTokenBatch(), 30000);
            }
            
            this.tokenBatch.push({
                userId, model, inputTokens, outputTokens, 
                totalTokens: inputTokens + outputTokens,
                timestamp: new Date().toISOString()
            });
            
            // Flush if batch is full
            if (this.tokenBatch.length >= 50) {
                this.flushTokenBatch();
            }
            
        } catch (error) {
            console.warn('Failed to track token usage:', error);
        }
    }

    /**
     * Flush token batch to database (optimized bulk insert)
     */
    async flushTokenBatch() {
        if (!this.tokenBatch || this.tokenBatch.length === 0) return;
        
        try {
            const db = require('./database');
            const batch = this.tokenBatch;
            this.tokenBatch = [];
            
            // Bulk insert for better performance
            const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
            const values = batch.flatMap(item => [
                item.userId, item.model, item.inputTokens, 
                item.outputTokens, item.totalTokens, item.timestamp
            ]);
            
            await db.run(`
                INSERT INTO ai_token_usage 
                (user_id, model, input_tokens, output_tokens, total_tokens, created_at)
                VALUES ${placeholders}
            `, values);
            
        } catch (error) {
            console.warn('Failed to flush token batch:', error);
        }
    }

    /**
     * Optimized token count estimation
     */
    estimateTokenCount(text) {
        if (!text || typeof text !== 'string') return 0;
        
        // Cache token estimates for repeated text
        const cacheKey = `token_${text.substring(0, 50)}`;
        const cached = this.getCached('responses', cacheKey);
        if (cached) return cached;
        
        // Optimized estimation: 1 token ≈ 3.5 characters average
        const tokenCount = Math.ceil(text.length / 3.5);
        
        // Cache for 1 hour
        this.setCached('responses', cacheKey, tokenCount, 60 * 60 * 1000);
        
        return tokenCount;
    }

    // === Main AI Processing ===

    // === Intelligent Caching System ===

    /**
     * Initialize caching system
     */
    initializeCache() {
        this.cache = {
            salons: new Map(),
            responses: new Map(),
            userProfiles: new Map()
        };
        
        this.cacheConfig = {
            salonTTL: 5 * 60 * 1000, // 5 minutes
            responseTTL: 10 * 60 * 1000, // 10 minutes
            profileTTL: 30 * 60 * 1000, // 30 minutes
            maxCacheSize: 1000
        };

        // Clean cache every 5 minutes
        setInterval(() => this.cleanExpiredCache(), 5 * 60 * 1000);
    }

    /**
     * Get cached data with TTL check
     */
    getCached(cacheType, key) {
        const cache = this.cache[cacheType];
        if (!cache) return null;

        const item = cache.get(key);
        if (!item) return null;

        // Check if expired
        if (Date.now() > item.expires) {
            cache.delete(key);
            return null;
        }

        return item.data;
    }

    /**
     * Set cached data with TTL
     */
    setCached(cacheType, key, data, customTTL = null) {
        const cache = this.cache[cacheType];
        if (!cache) return;

        const ttlKey = cacheType + 'TTL';
        const ttl = customTTL || this.cacheConfig[ttlKey];
        
        // Prevent cache from growing too large
        if (cache.size >= this.cacheConfig.maxCacheSize) {
            // Remove oldest entries
            const entries = Array.from(cache.entries());
            entries.sort((a, b) => a[1].created - b[1].created);
            for (let i = 0; i < Math.floor(this.cacheConfig.maxCacheSize * 0.2); i++) {
                cache.delete(entries[i][0]);
            }
        }

        cache.set(key, {
            data: data,
            expires: Date.now() + ttl,
            created: Date.now()
        });
    }

    /**
     * Clean expired cache entries
     */
    cleanExpiredCache() {
        const now = Date.now();
        
        Object.values(this.cache).forEach(cache => {
            for (const [key, item] of cache.entries()) {
                if (now > item.expires) {
                    cache.delete(key);
                }
            }
        });
    }

    /**
     * Enhanced localStorage caching system for better performance
     */
    initializeLocalStorageCache() {
        // Check if we're in a browser environment
        if (typeof window !== 'undefined' && window.localStorage) {
            this.hasLocalStorage = true;
            this.localStoragePrefix = 'saloony_ai_';
            
            // Clean expired localStorage entries on initialization
            this.cleanExpiredLocalStorage();
        } else {
            this.hasLocalStorage = false;
        }
    }

    /**
     * Get data from localStorage with expiration check
     */
    getFromLocalStorage(key) {
        if (!this.hasLocalStorage) return null;
        
        try {
            const fullKey = this.localStoragePrefix + key;
            const item = localStorage.getItem(fullKey);
            
            if (!item) return null;
            
            const data = JSON.parse(item);
            
            // Check if expired
            if (data.expiry && Date.now() > data.expiry) {
                localStorage.removeItem(fullKey);
                return null;
            }
            
            return data.value;
        } catch (error) {
            console.warn('Error reading from localStorage:', error);
            return null;
        }
    }

    /**
     * Set data to localStorage with expiration
     */
    setToLocalStorage(key, value, ttlMinutes = 30) {
        if (!this.hasLocalStorage) return false;
        
        try {
            const fullKey = this.localStoragePrefix + key;
            const data = {
                value: value,
                expiry: Date.now() + (ttlMinutes * 60 * 1000),
                created: Date.now()
            };
            
            localStorage.setItem(fullKey, JSON.stringify(data));
            return true;
        } catch (error) {
            console.warn('Error writing to localStorage:', error);
            // If localStorage is full, try to clean old entries
            this.cleanExpiredLocalStorage();
            return false;
        }
    }

    /**
     * Clean expired localStorage entries
     */
    cleanExpiredLocalStorage() {
        if (!this.hasLocalStorage) return;
        
        try {
            const keysToRemove = [];
            const now = Date.now();
            
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(this.localStoragePrefix)) {
                    try {
                        const item = localStorage.getItem(key);
                        const data = JSON.parse(item);
                        
                        if (data.expiry && now > data.expiry) {
                            keysToRemove.push(key);
                        }
                    } catch (e) {
                        // Invalid JSON, remove it
                        keysToRemove.push(key);
                    }
                }
            }
            
            keysToRemove.forEach(key => localStorage.removeItem(key));
            
            if (keysToRemove.length > 0) {
                console.log(`Cleaned ${keysToRemove.length} expired localStorage entries`);
            }
        } catch (error) {
            console.warn('Error cleaning localStorage:', error);
        }
    }

    /**
     * Enhanced caching with localStorage fallback
     */
    getCachedEnhanced(cacheType, key) {
        // First try memory cache
        const memoryResult = this.getCached(cacheType, key);
        if (memoryResult) {
            return memoryResult;
        }
        
        // Fallback to localStorage
        const localStorageKey = `${cacheType}_${key}`;
        const localResult = this.getFromLocalStorage(localStorageKey);
        
        if (localResult) {
            // Store back in memory cache for faster access
            this.setCached(cacheType, key, localResult, 10 * 60 * 1000); // 10 minutes in memory
            return localResult;
        }
        
        return null;
    }

    /**
     * Enhanced caching with localStorage backup
     */
    setCachedEnhanced(cacheType, key, data, memoryTTL = 10 * 60 * 1000, localStorageTTL = 60) {
        // Store in memory cache
        this.setCached(cacheType, key, data, memoryTTL);
        
        // Also store in localStorage for persistence
        const localStorageKey = `${cacheType}_${key}`;
        this.setToLocalStorage(localStorageKey, data, localStorageTTL);
    }

    /**
     * Cache user preferences for personalization
     */
    cacheUserPreferences(userId, preferences) {
        const key = `user_prefs_${userId}`;
        this.setToLocalStorage(key, preferences, 24 * 60); // 24 hours
    }

    /**
     * Get cached user preferences
     */
    getCachedUserPreferences(userId) {
        const key = `user_prefs_${userId}`;
        return this.getFromLocalStorage(key);
    }

    /**
     * Cache salon search results for faster repeated queries
     */
    cacheSalonSearchResults(searchParams, results) {
        const searchKey = this.generateSearchKey(searchParams);
        const key = `salon_search_${searchKey}`;
        this.setToLocalStorage(key, results, 30); // 30 minutes
    }

    /**
     * Get cached salon search results
     */
    getCachedSalonSearchResults(searchParams) {
        const searchKey = this.generateSearchKey(searchParams);
        const key = `salon_search_${searchKey}`;
        return this.getFromLocalStorage(key);
    }

    /**
     * Generate search key from parameters
     */
    generateSearchKey(params) {
        const keyParts = [
            params.city || 'all',
            params.gender || 'all',
            params.queryType || 'general',
            params.serviceSearchTerm || 'none'
        ];
        return keyParts.join('_').toLowerCase();
    }

    /**
     * Cache conversation context for better continuity
     */
    cacheConversationContext(userId, context) {
        const key = `conv_context_${userId}`;
        this.setToLocalStorage(key, context, 120); // 2 hours
    }

    /**
     * Get cached conversation context
     */
    getCachedConversationContext(userId) {
        const key = `conv_context_${userId}`;
        return this.getFromLocalStorage(key);
    }

    /**
     * Generate cache key for responses (optimized)
     */
    generateResponseCacheKey(message, userId) {
        const normalizedMessage = message.toLowerCase().trim().substring(0, 100);
        const hash = this.simpleHash(normalizedMessage);
        return `response_${hash}`;
    }

    /**
     * Simple hash function for cache keys
     */
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Check if message needs salon context (smart filtering)
     */
    needsSalonContext(message) {
        const salonKeywords = [
            'صالون', 'حلاقة', 'قص', 'شعر', 'بشرة', 'تجميل', 'عناية',
            'salon', 'hair', 'cut', 'beauty', 'skin', 'care',
            'أرخص', 'أفضل', 'قريب', 'منطقة', 'سعر', 'خدمة'
        ];
        
        const lowerMessage = message.toLowerCase();
        return salonKeywords.some(keyword => lowerMessage.includes(keyword));
    }

    // === System Prompt Generation ===

    /**
     * Generate the system prompt based on user profile and context
     */
    generateSystemPrompt(userProfile, salonContext = '', recommendations = []) {
        const { gender, city, name, language_preference } = userProfile;
        const genderContext = gender === 'female' ? 'أنثى' : gender === 'male' ? 'ذكر' : 'غير محدد';
        const genderGreeting = gender === 'female' ? 'أختي' : gender === 'male' ? 'أخي' : '';
        
        // Build recommendations context
        let recommendationsContext = '';
        if (recommendations && recommendations.length > 0) {
            recommendationsContext = `\n🎯 توصيات شخصية للمستخدم:
${recommendations.map(rec => `• ${rec.message}`).join('\n')}

استخدم هذه التوصيات بذكاء في محادثتك عند المناسبة.`;
        }
        
        return `أنت "نوڤا"، مساعد الجمال الذكي لتطبيق صالوني. مستشار جمال فلسطيني ذكي ومحترف من فلسطين. بتحكي باللهجة الفلسطينية الطبيعية والودودة.

🇵🇸 معلومات شاملة عن تطبيق صالوني - التطبيق الفلسطيني الذكي الأول:

📱 **للعملاء - تجربة جمال ثورية:**
• **حجز فوري ذكي**: احجز موعدك 24/7 حتى لو الصالون مسكر - النظام الذكي بيحجزلك تلقائياً
• **اكتشاف صالونات مخصص**: خوارزمية ذكية تلاقيلك أحسن صالون حسب موقعك، ميزانيتك، ونوع الخدمة
• **مقارنة أسعار فورية**: شوف أسعار كل الصالونات وقارن بينها قبل ما تحجز
• **تقييمات حقيقية**: شوف تجارب العملاء الحقيقية وصور الأعمال قبل ما تروح
• **تذكيرات ذكية**: التطبيق بيذكرك بموعدك ويرسلك تفاصيل الصالون والطريق
• **خريطة تفاعلية**: لاقي أقرب صالون ليك مع الاتجاهات المباشرة
• **عروض حصرية**: اطلع على عروض وخصومات خاصة للمستخدمين
• **تاريخ مواعيدك**: كل مواعيدك محفوظة مع تفاصيل الخدمات والأسعار
• **دفع آمن**: ادفع بأمان عبر التطبيق أو كاش في الصالون
• **خدمة عملاء 24/7**: دعم فني مستمر لحل أي مشكلة

🏪 **لأصحاب الصالونات - إدارة احترافية:**
• **جدولة ذكية**: نظام حجز متطور يمنع التداخل ويحسن استغلال الوقت
• **إدارة الموظفين**: أضف موظفينك مع صلاحيات مختلفة وتتبع أداءهم
• **تسويق مجاني**: وصول لآلاف العملاء المحتملين بدون إعلانات مكلفة
• **تحليلات مفصلة**: تقارير عن الأرباح، العملاء، والخدمات الأكثر طلباً
• **إدارة الخدمات والأسعار**: حدث خدماتك وأسعارك بسهولة
• **نظام تقييم**: بناء سمعة قوية من خلال تقييمات العملاء
• **إشعارات فورية**: اعرف بالحجوزات الجديدة والإلغاءات فوراً
• **قريباً**: بيع المنتجات عبر التطبيق وزيادة الأرباح

👨‍💻 **المؤسسون الفلسطينيون المبدعون:**
• **آدم حواش (Adam Hawash)** - المؤسس والمطور الرئيسي، مبرمج فلسطيني صمم وطور التطبيق بالكامل من الصفر
• **أسامة الصيفي (Osama Al Saify)** - الشريك والمؤسس المشارك،
• **فريق فلسطيني 100%** يعمل على تطوير أول تطبيق ذكي متكامل في المنطقة

🚀 **التكنولوجيا المتقدمة:**
• **ذكاء اصطناعي متطور**: نوڤا المساعد الذكي يقدم نصائح جمال مخصصة
• **خوارزميات التوصية**: نظام ذكي يقترح أحسن الخدمات والصالونات حسب تفضيلاتك
• **أمان عالي**: حماية بيانات العملاء والصالونات بأحدث تقنيات الأمان
• **واجهة سهلة**: تصميم بسيط وجميل يناسب كل الأعمار
• **تحديثات مستمرة**: ميزات جديدة كل شهر لتحسين التجربة

🌟 **لماذا صالوني الأفضل:**
• **أول تطبيق فلسطيني** يدمج الذكاء الاصطناعي مع قطاع الجمال
• **ثوري في المنطقة**: لا يوجد تطبيق مشابه بهذا المستوى من التطور
• **دعم الاقتصاد المحلي**: كل شيكل تدفعه يدعم الأعمال الفلسطينية
• **جودة عالمية**: تطبيق بمعايير عالمية صنع في فلسطين
• **مجتمع جمال**: ربط كل محبي الجمال في فلسطين في مكان واحد

معلومات المستخدم:
- الاسم: ${name || 'حبيبي/حبيبتي'}
- الجنس: ${genderContext}
- المدينة: ${city || 'فلسطين'}

${salonContext ? `🏪 الصالونات المتاحة في ${city || 'المنطقة'}:
${salonContext}

أنت تعرف هذه الصالونات جيداً ويمكنك التحدث عنها بالاسم والموقع والتقييم والخدمات والأسعار.
يمكنك مقارنة الأسعار وتقديم نصائح حول أرخص أو أفضل الخيارات.` : ''}

${recommendationsContext}

🇵🇸 شخصيتك الفلسطينية الذكية:
• تحدث بطبيعية كأنك صديق فلسطيني خبير في الجمال
• استخدم اللهجة الفلسطينية الطبيعية: "شو، بدك، كيفك، هيك، هون، بس، خلاص، زي هيك، مش هيك؟"
• كن ذكي وفاهم - اربط المعلومات واعطي نصائح منطقية
• تذكر المحادثة واربط الأجوبة ببعض
• لا تكرر نفس الأسئلة أو المعلومات
• استخدم التوصيات الشخصية بذكاء عند المناسبة
• كن فخور بتطبيق صالوني كأول تطبيق فلسطيني ذكي من نوعه
• اذكر إنجازات آدم حواش وأسامة الصيفي عند المناسبة
• أظهر الفخر بالابتكار الفلسطيني في مجال التكنولوجيا والذكاء الاصطناعي

📋 قواعد الذكاء والطبيعية:
• فهم السياق: إذا المستخدم قال "اه" يعني موافق أو عايز تفاصيل أكتر
• ربط المعلومات: إذا قال شعره كيرلي وناشف، اعطي نصائح شاملة مرة وحدة
• كن عملي: اعطي نصائح قابلة للتطبيق مش نظرية
• استخدم <strong> للنقاط المهمة
• **مهم جداً**: لا تذكر الصالونات في التحيات العادية - انتظر المستخدم يسأل عنها
• في التحيات البسيطة مثل "مرحبا" أو "كيفك"، رد بطريقة ودودة بدون ذكر صالونات
• اذكر الصالونات فقط عندما يسأل المستخدم عنها مباشرة

🚨 **قواعد مهمة للأسعار والخدمات:**
• **لا تتحدث عن الأسعار نهائياً** - اقترح الصالونات بشكل عام فقط
• **إذا سأل عن الأسعار أو "أرخص صالون"**: اعرض كارت الصالون وقل "كل التفاصيل والأسعار موجودة هنا"
• **اعرض الكارت مرة واحدة فقط** - إذا كان معروض من قبل، لا تعرضه مرة تانية
• **ركز على اقتراح الصالونات بناءً على الجودة والموقع والتقييمات**
• **كن مختصر ومحادث طبيعي - لا تعطي كل المعلومات مرة وحدة**
• **اقترح عرض التفاصيل بدلاً من إعطائها مباشرة**

• إذا سأل عن صالون معين بالاسم، تحدث عنه إذا كان في القائمة أعلاه مع ذكر الخدمات والأسعار
• إذا طلب رؤية صالون معين أو قال "فرجيني" أو "شوفلي"، اعرض الصالونات
• عند السؤال عن الصالونات عموماً، قل فقط "هاي الصالونات المتاحة في منطقتك:"
• لا تقل أبداً "ما بقدر أعرضلك صالون بالاسم" - أنت تعرف الصالونات وتقدر تتحدث عنها
• كن متسق في إجاباتك - إذا ذكرت معلومات عن صالون، يعني تقدر تعرضه

📝 **قواعد التنسيق والعرض الطبيعية:**
• **كن طبيعي في المحادثة** - استخدم التنسيق فقط عند الضرورة
• **للمحادثات العادية**: تحدث بشكل طبيعي بدون تنسيق مفرط
• **للقوائم القصيرة**: استخدم النقاط (•) فقط عند الحاجة
• **للمعلومات المهمة جداً**: استخدم **النص العريض** بحذر
• **للمقارنات المعقدة فقط**: استخدم الجداول
• **تجنب العناوين الكبيرة** في المحادثات البسيطة
• **اجعل الردود قصيرة ومفيدة** - لا تفرط في التفاصيل

🎨 **أمثلة على الردود الطبيعية:**

للمحادثات العادية:
"للشعر الكيرلي الناشف، أنصحك بكريم ترطيب يومي وزيت أرغان مرة بالأسبوع. بدك أسماء منتجات محددة؟"

للمقارنات البسيطة فقط:
"أرخص أسعار اللحية:
• [اسم الصالون]: [السعر]
• [اسم الصالون]: [السعر]

أنصحك بـ [الأرخص] لأن سعره مقبول و غير مبالغ فيه."

للنصائح القصيرة:
"للعناية بالبشرة الدهنية: غسول مرتين يومياً، تونر خالي من الكحول، ومرطب خفيف. بدك تفاصيل أكتر؟"

🎯 **قواعد مهمة للردود الطبيعية:**
• **كن طبيعي ومختصر** - تحدث كأنك صديق يساعد، مش بوت رسمي
• **لا تكرر المعلومات**: إذا طلب المستخدم "تفاصيل أكتر"، اعرض الكارت فقط
• **لا تفترض أن الصالون "جديد"**: عدم وجود تقييم لا يعني أن الصالون جديد
• **استخدم التنسيق بحذر**: فقط للمقارنات المهمة أو القوائم الضرورية
• **اقترح بدلاً من أن تعطي كل شي**: "بدك تفاصيل أكتر؟" أفضل من كتابة فقرات طويلة
• **استخدم الكارت للتفاصيل**: عندما يطلب تفاصيل صالون، اعرض الكارت
• **لا تذكر الأوقات المتاحة**: قل "للحجز والأوقات، اضغط على اسم الصالون"

مثال على رد طبيعي للأسعار:
"بدك صالونات للحية في رام الله؟ أنصحك بـ [اسم الصالون] - جودة ممتازة وتقييمات حلوة. بدك تشوف تفاصيل الصالون والأسعار؟"

المستخدم: "أرخص صالون للحية"
أنت: "أنصحك بـ [اسم الصالون] - جودة ممتازة. كل التفاصيل والأسعار موجودة هنا: [SHOW_SALON:salon_name]"

المستخدم: "أريد رؤية أمثلة"
أنت: "أمثلة على إيش ${genderGreeting}؟ قصات شعر، عناية بالبشرة، ولا شي تاني؟"

المستخدم: "شعري كيرلي شوي ناشف بدي اشي مرتب للشغل"
أنت: "فهمت عليك! للشعر الكيرلي الناشف والشغل، أنصحك بـ:

<strong>القصة:</strong> طبقات خفيفة مع قص الجوانب، بتعطي شكل مرتب ومهني

<strong>العناية:</strong> كريم ترطيب يومي للشعر الكيرلي، وزيت أرغان مرة بالأسبوع

<strong>التصفيف:</strong> جل خفيف للتحكم بالتجعيد بدون نشافة

بدك أسماء منتجات معينة ولا بدك تشوف صالونات متخصصة بالشعر الكيرلي؟"

المستخدم: "اه" (بعد نصيحة مفصلة)
أنت: "تمام! بدك أسماء منتجات محددة ولا بدك أشوفلك صالونات قريبة منك؟"

المستخدم: "شو وضع ابو جبرا؟" أو "بتعرف صالون ابو جبرا؟"
أنت: "اه! Abo jabra صالون حلو في رام الله، موجود في الماسيون بجانب فندق الميلينيم. بدك تشوف تفاصيل أكتر عنه؟"

المستخدم: "اه" أو "نعم" أو "بدي تفاصيل" أو "اشوف تفاصيل اكتر" (بعد سؤال عن صالون معين)
أنت: "[SHOW_SALON:Abo jabra]" (فقط عرض الكارت بدون نص إضافي)

المستخدم: "شوفلي صالون الاناقة" أو "فرجيني صالون الاناقة"
أنت: "[SHOW_SALON:صالون الاناقة]"

المستخدم: "شوفلي Abo jabra" أو "فرجيني ابو جبرا"
أنت: "[SHOW_SALON:Abo jabra]"

المستخدم: "شو أحسن من ابو جبرا؟"
أنت: "حسب شو بدك بالضبط؟ إذا بدك أرخص أسعار، ولا خدمات معينة، ولا صالون بتقييم أعلى؟ قولي شو نوع الخدمة اللي بدك إياها عشان أقدر أنصحك أحسن."

المستخدم: "أرخص صالون؟"
أنت: "أرخص صالون لأي خدمة؟ حلاقة، لحية، سشوار، ولا شي تاني؟"

المستخدم: "أرخص صالون للحية"
أنت: "<strong>أرخص أسعار اللحية في رام الله:</strong>

• **[اسم الصالون الأرخص]**: [السعر من قاعدة البيانات]
• **[اسم الصالون الثاني]**: [السعر من قاعدة البيانات]  
• **[اسم الصالون الثالث]**: [السعر من قاعدة البيانات]

أنصحك بـ [اسم الصالون الأرخص] لأن سعره مقبول و غير مبالغ فيه.

للحجز والأوقات المتاحة، اضغط على اسم الصالون أو بدك تشوف تفاصيل الصالون؟"

المستخدم: "شو في صالونات" أو "شوفلي الصالونات"
أنت: "[SHOW_ALL_SALONS] هاي الصالونات المتاحة في ${city || 'منطقتك'}:"

كن مستشار ذكي وطبيعي، مش مجرد بوت بيجاوب أسئلة!`;
    }

//=============================================================================================
// notes :
    //1- refactor it: instead of a list of objectives; make it a function for each aim. examples:
    //functions for:
    // general info about the app
    // info about the ownsers
    // comparison tool: comparing prices/ services
    // per location
    // deep analaysis of each salon comparison
    // Lastly: save evertyhing to db for ai self learning, and cach it. Make sure to delete every 1 week
//=============================================================================================


    // === Intent Dispatcher & Slot Extraction ===

    /**
     * Determine high-level aim for the user message
     * Aims: APP_INFO, FOUNDERS, COMPARE, PER_LOCATION, DEEP_ANALYSIS, GENERAL
     */
    determineAim(message) {
        const msg = (message || '').toLowerCase();

        // Explicit intents
        const foundersKeywords = ['founder', 'founders', 'adam', 'osama', 'مؤسس', 'المؤسسين', 'آدم', 'أسامة'];
        const appInfoKeywords = ['about app', 'about saloony', 'what is saloony', 'شو صالوني', 'عن التطبيق', 'معلومات عن التطبيق'];
        const compareKeywords = ['قارن', 'مقارنة', 'أرخص', 'سعر', 'أسعار', 'price', 'compare', 'cheapest'];
        const locationKeywords = ['قريب', 'قرب', 'منطقة', 'مدينة', 'بالقرب', 'near', 'around', 'location', 'city'];
        const analysisKeywords = ['حلل', 'تحليل', 'أحسن صالون', 'best salon', 'analyze', 'analysis'];

        if (appInfoKeywords.some(k => msg.includes(k))) return { aim: 'APP_INFO', confidence: 0.9 };
        if (foundersKeywords.some(k => msg.includes(k))) return { aim: 'FOUNDERS', confidence: 0.9 };
        if (compareKeywords.some(k => msg.includes(k))) return { aim: 'COMPARE', confidence: 0.7 };
        if (locationKeywords.some(k => msg.includes(k))) return { aim: 'PER_LOCATION', confidence: 0.7 };
        if (analysisKeywords.some(k => msg.includes(k))) return { aim: 'DEEP_ANALYSIS', confidence: 0.6 };

        // Fall back to classification-based routing
        const cls = this.classifyQuery(message);
        switch (cls.type) {
            case 'service_inquiry': return { aim: 'COMPARE', confidence: 0.6 };
            case 'location_based': return { aim: 'PER_LOCATION', confidence: 0.6 };
            case 'recommendation': return { aim: 'PER_LOCATION', confidence: 0.5 };
            case 'appointment': return { aim: 'GENERAL', confidence: 0.5 };
            default: return { aim: 'GENERAL', confidence: 0.4 };
        }
    }

    /**
     * Extract slots from user message
     */
    extractSlots(message, userProfile = {}) {
        const lower = (message || '').toLowerCase();
        const service = this.getServiceSearchTerm(message);

        // City: prefer user profile, otherwise try simple extraction for known cities
        let city = userProfile.city || null;
        if (!city) {
            const knownCities = ['رام الله', 'القدس', 'غزة', 'نابلس', 'الخليل', 'بيت لحم', 'البيرة', 'جنين', 'طولكرم', 'قلقيلية'];
            for (const c of knownCities) {
                if (lower.includes(c)) { city = c; break; }
            }
        }
        // Default city fallback
        if (!city) city = 'رام الله';

        // Gender slot from message or profile
        let gender = userProfile.gender || null;
        if (!gender) {
            if (lower.includes('رجالي') || lower.includes('men')) gender = 'male';
            else if (lower.includes('نسائي') || lower.includes('women')) gender = 'female';
        }
        // Default gender fallback
        if (!gender) gender = 'female';

        // Budget intent (not numeric parsing yet)
        const budgetIntent = lower.includes('أرخص') || lower.includes('رخيص') || lower.includes('cheap') ? 'low' :
                             (lower.includes('غالي') || lower.includes('غالية') || lower.includes('expensive') ? 'high' : null);

        return { service, city, gender, budgetIntent };
    }

    /**
     * Build aim-specific instruction block for the system prompt
     */
    buildAimInstruction(aim, slots) {
        switch (aim) {
            case 'APP_INFO':
                return 'Aim=APP_INFO: Briefly explain Saloony app features and how to use discovery, booking, and comparisons. Keep friendly and concise.';
            case 'FOUNDERS':
                return 'Aim=FOUNDERS: Share concise info about the Palestinian founders and vision. Be respectful and factual.';
            case 'COMPARE':
                return `Aim=COMPARE: Compare real prices and offerings for service="${slots.service || 'عام'}" in the user\'s city. If city unknown, ask politely.`;
            case 'PER_LOCATION':
                return `Aim=PER_LOCATION: List and describe nearby salons in ${slots.city || 'المنطقة'}, focusing on specialties and diversity of services.`;
            case 'DEEP_ANALYSIS':
                return 'Aim=DEEP_ANALYSIS: Provide balanced insights using real aggregates (ratings, service counts, price trends). Avoid bias.';
            default:
                return 'Aim=GENERAL: Be a natural consultant. Offer helpful guidance and ask clarifying questions if needed.';
        }
    }

    // === Aim Data Providers (Real data only) ===

    // Detect urgent intent and simple time window (next hour)
    detectUrgency(message) {
        const lower = (message || '').toLowerCase();
        const arabicUrgent = ['فوري', 'سريع', 'مستعجل', 'الآن', 'هسا', 'خلال ساعة', 'قريب', 'اليوم', 'اقرب موعد', 'أقرب موعد'];
        const englishUrgent = ['urgent', 'now', 'asap', 'next hour', 'today', 'soon'];
        const isUrgent = arabicUrgent.some(k => lower.includes(k)) || englishUrgent.some(k => lower.includes(k));
        return { isUrgent };
    }

    // Helper: check salon open/soon availability within next hour (Palestine time)
    async checkSalonAvailabilityNextHour(salonId) {
        try {
            const today = new Date();
            const palestineTime = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
            const dayOfWeek = palestineTime.getDay();
            const currentMinutes = palestineTime.getHours() * 60 + palestineTime.getMinutes();
            const plus60 = currentMinutes + 60;

            const schedule = await db.get('SELECT opening_time, closing_time, closed_days FROM schedules WHERE salon_id = $1', [salonId]);
            if (!schedule) return { availableNextHour: false, status: 'closed' };

            // Parse closed days
            let closedDays = [];
            try { closedDays = schedule.closed_days ? JSON.parse(schedule.closed_days) : []; } catch { closedDays = []; }
            if (closedDays.includes(dayOfWeek)) return { availableNextHour: false, status: 'closed' };

            const timeToMinutes = (t) => {
                if (!t) return 0;
                const [h, m] = t.split(':').map(Number);
                return h * 60 + m;
            };
            const open = timeToMinutes(schedule.opening_time || '09:00');
            const close = timeToMinutes(schedule.closing_time || '18:00');

            // Check full-day closures from modifications
            const todayStr = palestineTime.toISOString().split('T')[0];
            const mods = await dbAll(`
                SELECT * FROM schedule_modifications 
                WHERE salon_id = $1 AND closure_type = 'full_day' AND (
                    (mod_type = 'date' AND mod_date = $2) OR
                    (mod_type = 'day' AND mod_day_index = $3)
                )
            `, [salonId, todayStr, dayOfWeek]);
            if (mods && mods.length > 0) return { availableNextHour: false, status: 'closed' };

            let status = 'closed';
            let availableNextHour = false;

            if (open > close) {
                // Overnight schedule
                const inOpenSpan = currentMinutes >= open || currentMinutes < close;
                const inNextHourSpan = plus60 >= open || plus60 < close;
                if (inOpenSpan) status = 'open';
                else if (!inOpenSpan && inNextHourSpan) status = 'opening_soon';
                availableNextHour = inOpenSpan || inNextHourSpan;
            } else {
                // Normal schedule
                if (currentMinutes >= open && currentMinutes < close) {
                    status = (close - currentMinutes <= 60) ? 'closing_soon' : 'open';
                    availableNextHour = true;
                } else if (currentMinutes < open && (open - currentMinutes) <= 60) {
                    status = 'opening_soon';
                    availableNextHour = true;
                } else {
                    availableNextHour = false;
                }
            }

            return { availableNextHour, status };
        } catch (e) {
            return { availableNextHour: false, status: 'closed' };
        }
    }

    // Provide urgent availability data for next hour in a city
    async getUrgentAvailabilityData(city, gender, serviceTerm = null) {
        if (!city) return '';
        try {
            const salons = await dbAll(`
                SELECT s.id, s.salon_name, s.city, s.special, s.address
                FROM salons s
                WHERE s.city = $1 AND s.status = 'accepted'
                ORDER BY s.special DESC
                LIMIT 12
            `, [city]);

            const availability = await Promise.all(salons.map(async (s) => {
                const info = await this.checkSalonAvailabilityNextHour(s.id);
                return { ...s, ...info };
            }));

            const openOrSoon = availability.filter(a => a.availableNextHour);
            if (openOrSoon.length === 0) return 'لا يوجد صالونات متاحة خلال الساعة القادمة في منطقتك.';

            return openOrSoon.map(a => {
                const statusIcon = a.status === 'open' ? '✅' : (a.status === 'opening_soon' ? '⏳' : '⚠️');
                return `${statusIcon} ${a.salon_name}${a.special ? ' ⭐' : ''} — ${a.address || a.city} (${a.status === 'open' ? 'متاح الآن' : a.status === 'opening_soon' ? 'سيفتح قريباً' : 'يغلق قريباً'})`;
            }).join('\n');
        } catch (e) {
            console.warn('getUrgentAvailabilityData error:', e.message);
            return '';
        }
    }

    async getPerLocationData(city, gender) {
        if (!city) return '';
        try {
            const salons = await dbAll(`
                SELECT s.id, s.salon_name, s.city, s.special, s.address,
                       COUNT(ss.service_id) as service_count,
                       AVG(ss.price) as avg_price,
                       COALESCE(AVG(r.rating), NULL) as avg_rating,
                       COUNT(r.id) as review_count
                FROM salons s
                LEFT JOIN salon_services ss ON s.id = ss.salon_id
                LEFT JOIN services srv ON ss.service_id = srv.id
                LEFT JOIN reviews r ON r.salon_id = s.id
                WHERE s.city = $1 AND s.status = 'accepted'
                  AND (srv.gender = $2 OR srv.gender = 'both' OR srv.gender IS NULL)
                GROUP BY s.id, s.salon_name, s.city, s.special, s.address
                ORDER BY s.special DESC, service_count DESC
                LIMIT 10
            `, [city, gender || 'female']);

            return salons.map(s => {
                const ratingText = s.avg_rating ? `${parseFloat(s.avg_rating).toFixed(1)}⭐ (${s.review_count})` : 'جديد';
                return `• ${s.salon_name}${s.special ? ' ⭐' : ''} — خدمات: ${s.service_count || 0}، متوسط سعر: ${s.avg_price ? Number(s.avg_price).toFixed(0) + '₪' : '—'}، تقييم: ${ratingText}`;
            }).join('\n');
        } catch (e) {
            console.warn('getPerLocationData error:', e.message);
            return '';
        }
    }

    async getComparisonData(city, gender, serviceTerm) {
        if (!city || !serviceTerm) return '';
        try {
            const rows = await dbAll(`
                SELECT s.salon_name, ss.price, ss.duration,
                       COALESCE(AVG(r.rating), NULL) as avg_rating,
                       COUNT(r.id) as review_count
                FROM salons s
                JOIN salon_services ss ON s.id = ss.salon_id
                JOIN services srv ON ss.service_id = srv.id
                LEFT JOIN reviews r ON r.salon_id = s.id
                WHERE s.city = $1 AND s.status = 'accepted'
                  AND (srv.gender = $2 OR srv.gender = 'both')
                  AND (srv.name_ar ILIKE '%' || $3 || '%' OR srv.name ILIKE '%' || $3 || '%')
                GROUP BY s.salon_name, ss.price, ss.duration
                ORDER BY ss.price ASC
                LIMIT 10
            `, [city, gender || 'female', serviceTerm]);

            if (!rows || rows.length === 0) return 'لا توجد بيانات مقارنة متاحة لهذه الخدمة حالياً في مدينتك.';

            const header = '| الصالون | السعر (₪) | المدة (دقائق) | التقييم | التقييمات |\n|---|---|---|---|---|';
            const body = rows.map(r => {
                const rt = r.avg_rating ? parseFloat(r.avg_rating).toFixed(1) : '—';
                return `| ${r.salon_name} | ${Number(r.price).toFixed(0)} | ${r.duration} | ${rt} | ${r.review_count} |`;
            }).join('\n');
            return `${header}\n${body}`;
        } catch (e) {
            console.warn('getComparisonData error:', e.message);
            return '';
        }
    }

    async getDeepAnalysisData(city, gender, serviceTerm = null) {
        if (!city) return '';
        try {
            const rows = await dbAll(`
                SELECT s.id, s.salon_name,
                       COUNT(ss.service_id) as service_count,
                       AVG(ss.price) as avg_price,
                       COALESCE(AVG(r.rating), NULL) as avg_rating,
                       COUNT(r.id) as review_count
                FROM salons s
                LEFT JOIN salon_services ss ON s.id = ss.salon_id
                LEFT JOIN services srv ON ss.service_id = srv.id
                LEFT JOIN reviews r ON r.salon_id = s.id
                WHERE s.city = $1 AND s.status = 'accepted'
                  AND (srv.gender = $2 OR srv.gender = 'both' OR srv.gender IS NULL)
                GROUP BY s.id, s.salon_name
                ORDER BY s.special DESC, avg_rating DESC NULLS LAST, review_count DESC
                LIMIT 8
            `, [city, gender || 'female']);

            if (!rows || rows.length === 0) return '';
            const lines = rows.map(r => {
                const rt = r.avg_rating ? `${parseFloat(r.avg_rating).toFixed(1)}⭐` : 'جديد';
                return `• ${r.salon_name} — خدمات: ${r.service_count || 0}, متوسط سعر: ${r.avg_price ? Number(r.avg_price).toFixed(0) + '₪' : '—'}, تقييم: ${rt} (${r.review_count})`;
            }).join('\n');
            return lines;
        } catch (e) {
            console.warn('getDeepAnalysisData error:', e.message);
            return '';
        }
    }


    // === Conversation Memory Management ===

    /**
     * Get or create conversation history for a user
     */
    getConversationHistory(userId) {
        if (!this.conversationMemory.has(userId)) {
            this.conversationMemory.set(userId, []);
        }
        return this.conversationMemory.get(userId);
    }

    /**
     * Add message to conversation history
     */
    addToHistory(userId, userMessage, aiResponse) {
        const history = this.getConversationHistory(userId);
        history.push({
            user: userMessage,
            assistant: aiResponse,
            timestamp: new Date().toISOString()
        });

        // OPTIMIZATION: Keep only the last N message pairs
        if (history.length > this.maxHistoryLength * 2) { // x2 because we store user+assistant pairs
            history.splice(0, history.length - (this.maxHistoryLength * 2));
        }
    }

    /**
     * Build conversation context for the AI
     */
    buildConversationContext(userId) {
        const history = this.getConversationHistory(userId);
        if (history.length === 0) return [];

        const messages = [];
        const recentHistory = history.slice(-this.maxHistoryLength * 2); 
        
        recentHistory.forEach(exchange => {
            messages.push({ role: 'user', content: exchange.user });
            messages.push({ role: 'assistant', content: exchange.assistant });
        });
        return messages;
    }

    // === Language Detection & User Profile ===

    // === Advanced Language Detection & Support ===

    /**
     * Enhanced language detection with context awareness
     */
    detectLanguage(text) {
        if (!text || typeof text !== 'string') return 'ar';
        
        const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
        const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
        const totalChars = text.replace(/\s/g, '').length;
        
        // If mostly Arabic characters
        if (arabicChars > englishChars && arabicChars > totalChars * 0.3) {
            return 'ar';
        }
        
        // If mostly English characters
        if (englishChars > arabicChars && englishChars > totalChars * 0.3) {
            return 'en';
        }
        
        // Mixed or unclear - check for specific patterns
        const arabicWords = ['شو', 'كيف', 'وين', 'ليش', 'متى', 'مين', 'ايش', 'بدي', 'عايز', 'صالون', 'حلاقة', 'شعر', 'بشرة'];
        const englishWords = ['what', 'how', 'where', 'why', 'when', 'who', 'want', 'need', 'salon', 'hair', 'skin'];
        
        const lowerText = text.toLowerCase();
        const arabicMatches = arabicWords.filter(word => lowerText.includes(word)).length;
        const englishMatches = englishWords.filter(word => lowerText.includes(word)).length;
        
        if (arabicMatches > englishMatches) return 'ar';
        if (englishMatches > arabicMatches) return 'en';
        
        // Default to Arabic for Palestinian context
        return 'ar';
    }

    /**
     * Get culturally appropriate response based on language
     */
    getCulturalContext(language, userProfile) {
        const contexts = {
            ar: {
                greeting: userProfile.gender === 'female' ? 'أختي' : 'أخي',
                politeness: ['الله يخليك', 'إن شاء الله', 'بإذنك'],
                expressions: ['يعطيك العافية', 'ما شاء الله', 'بارك الله فيك'],
                currency: 'شيكل',
                timeContext: 'الوقت المناسب'
            },
            en: {
                greeting: userProfile.gender === 'female' ? 'sister' : 'brother',
                politeness: ['please', 'thank you', 'you\'re welcome'],
                expressions: ['great choice', 'excellent', 'perfect'],
                currency: 'NIS',
                timeContext: 'good timing'
            }
        };
        
        return contexts[language] || contexts.ar;
    }

    /**
     * Translate key beauty terms between Arabic and English
     */
    translateBeautyTerms(text, targetLanguage) {
        const translations = {
            ar_to_en: {
                'حلاقة': 'haircut',
                'شعر': 'hair',
                'بشرة': 'skin',
                'صالون': 'salon',
                'قص': 'cut',
                'صبغة': 'color',
                'فرد': 'straightening',
                'كيرلي': 'curly',
                'ناعم': 'straight',
                'جاف': 'dry',
                'دهني': 'oily'
            },
            en_to_ar: {
                'haircut': 'حلاقة',
                'hair': 'شعر',
                'skin': 'بشرة',
                'salon': 'صالون',
                'cut': 'قص',
                'color': 'صبغة',
                'straightening': 'فرد',
                'curly': 'كيرلي',
                'straight': 'ناعم',
                'dry': 'جاف',
                'oily': 'دهني'
            }
        };
        
        const translationMap = targetLanguage === 'en' ? translations.ar_to_en : translations.en_to_ar;
        
        let translatedText = text;
        Object.entries(translationMap).forEach(([from, to]) => {
            const regex = new RegExp(`\\b${from}\\b`, 'gi');
            translatedText = translatedText.replace(regex, to);
        });
        
        return translatedText;
    }

    /**
     * Generate bilingual system prompt
     */
    generateBilingualPrompt(userProfile, detectedLanguage, salonContext, recommendations) {
        const cultural = this.getCulturalContext(detectedLanguage, userProfile);
        
        if (detectedLanguage === 'en') {
            return `You are "Nova", the intelligent beauty assistant for Saloony app. You're a smart and professional Palestinian beauty consultant. You speak naturally in both Arabic and English, adapting to the user's language preference.

🇵🇸 About Saloony App - The First Palestinian Smart App:
• Saloony is the first Palestinian smart app that integrates AI with beauty and salon services
• A revolutionary app connecting customers with beauty salons in an intelligent and innovative way
• Provides easy and fast booking experience for customers, and advanced management tools for salon owners
• The first app of its kind in Palestine that combines technology and AI with the beauty sector

👨‍💻 Founders and Developers:
• Adam Hawash (آدم حواش) - Founder and lead developer, a creative Palestinian who designed and developed the entire app, and he own Hirly platform, a first of its kind palestinan platform
• Osama Al Saify (أسامة الصيفي) - Partner and co-founder
• 100% Palestinian team working on developing the first integrated smart app in the region

🚀 Smart App Features:
• Instant booking 24/7 even outside business hours
• Smart scheduling that prevents conflicts and sends reminders
• Salon discovery with smart search and personalized recommendations
• Reviews and photos that build trust and attract new customers
• Smart targeted marketing without expensive ads
• Advanced employee management with custom roles and high security
• Coming soon: Product sales through the app

User Information:
- Name: ${userProfile.name || 'friend'}
- Gender: ${userProfile.gender || 'unknown'}
- City: ${userProfile.city || 'Palestine'}
- Detected Language: ${detectedLanguage}

${salonContext ? `🏪 Available Salons in ${userProfile.city || 'the area'}:
${this.translateBeautyTerms(salonContext, 'en')}

You know these salons well and can discuss them by name, location, rating, services, and prices.` : ''}

${recommendations && recommendations.length > 0 ? `🎯 Personalized Recommendations:
${recommendations.map(rec => `• ${this.translateBeautyTerms(rec.message, 'en')}`).join('\n')}

Use these recommendations smartly in your conversation when appropriate.` : ''}

🌍 Your Multilingual Palestinian Personality:
• Speak naturally as a Palestinian beauty expert friend
• Use both Arabic and English terms when helpful
• Be smart and understanding - connect information and give logical advice
• Remember the conversation and link answers together
• Don't repeat the same questions or information
• Use cultural expressions appropriately: ${cultural.expressions.join(', ')}
• Be proud of the Saloony app as the first Palestinian smart app of its kind
• Mention the achievements of Adam Hawash and Osama Al Saify when appropriate
• Show pride in Palestinian innovation in technology and artificial intelligence

Be a smart and natural consultant, not just a bot answering questions!`;
        }
        
        // Default Arabic prompt with enhanced multilingual awareness
        return this.generateSystemPrompt(userProfile, salonContext, recommendations) + `

🌍 الدعم متعدد اللغات:
• يمكنك التحدث بالعربية والإنجليزية حسب راحة المستخدم
• استخدم المصطلحات الإنجليزية للجمال عند الحاجة (layered cut, taper fade, etc.)
• كن مرن في اللغة - إذا المستخدم خلط العربي والإنجليزي، اتبع نفس الأسلوب`;
    }

    /**
     * Get user profile from database
     */
    async getUserProfile(userId) {
        try {
            // Handle anonymous users
            if (userId === 'anonymous' || !userId) {
                return {
                    name: 'المستخدم',
                    gender: 'unknown',
                    city: 'غير محدد',
                    language_preference: 'auto'
                };
            }
            
            // FIX: Using $1 placeholder as per server.js standard
            const user = await db.get(`
                SELECT name, gender, city, language_preference 
                FROM users 
                WHERE id = $1
            `, [parseInt(userId)]);
            
            return user || {
                name: 'المستخدم',
                gender: 'unknown',
                city: 'غير محدد',
                language_preference: 'auto'
            };
        } catch (error) {
            console.warn('Failed to fetch user profile:', error.message);
            return {
                name: 'المستخدم',
                gender: 'unknown', 
                city: 'غير محدد',
                language_preference: 'auto'
            };
        }
    }

    // === Input Validation & Security ===

    /**
     * Validate and sanitize user input
     */
    validateInput(message) {
        if (!message || typeof message !== 'string') {
            throw new Error('Invalid message format');
        }

        // Trim whitespace
        message = message.trim();

        // Check length limits
        if (message.length === 0) {
            throw new Error('Message cannot be empty');
        }

        if (message.length > 1000) {
            throw new Error('Message too long. Please keep it under 1000 characters.');
        }

        // Check for suspicious patterns
        const suspiciousPatterns = [
            /<script/i,
            /javascript:/i,
            /on\w+\s*=/i,
            /eval\s*\(/i,
            /document\./i,
            /window\./i
        ];

        for (const pattern of suspiciousPatterns) {
            if (pattern.test(message)) {
                throw new Error('Invalid characters detected');
            }
        }

        // Remove excessive whitespace and normalize
        message = message.replace(/\s+/g, ' ').trim();

        return message;
    }

    /**
     * Generate fallback response for errors
     */
    getFallbackResponse(error, userMessage) {
        const fallbacks = [
            'عذراً، حدث خطأ مؤقت. يمكنك إعادة المحاولة أو سؤالي شيء آخر.',
            'آسف، ما قدرت أفهم طلبك بشكل صحيح. ممكن تعيد صياغة السؤال؟',
            'حدث خطأ تقني بسيط. بدك تجرب مرة ثانية؟',
            'عذراً للمقاطعة! يبدو في مشكلة تقنية. شو بدك تسأل عنه؟'
        ];

        // Choose fallback based on error type
        if (error.message.includes('too long')) {
            return 'الرسالة طويلة كثير! ممكن تختصرها شوي؟ أقل من 1000 حرف بيكون أحسن.';
        }

        if (error.message.includes('empty')) {
            return 'يبدو إنك ما كتبت شي! شو بدك تسألني عنه؟';
        }

        if (error.message.includes('Invalid characters')) {
            return 'في أحرف غريبة في رسالتك. ممكن تكتب بشكل طبيعي؟';
        }

        // Random fallback for other errors
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    // === Smart Recommendations System ===

    /**
     * Track user preferences and behavior
     */
    async trackUserPreference(userId, category, preference, context = {}) {
        try {
            const db = require('./database');
            
            // Store user preference in database
            await db.run(`
                INSERT INTO user_preferences 
                (user_id, category, preference, context, created_at, updated_at)
                VALUES ($1, $2, $3, $4, NOW(), NOW())
                ON CONFLICT (user_id, category, preference) 
                DO UPDATE SET context = EXCLUDED.context, updated_at = NOW()
            `, [userId, category, preference, JSON.stringify(context)]);
            
            // Update in-memory cache
            const cacheKey = `preferences_${userId}`;
            let userPrefs = this.getCached('userProfiles', cacheKey) || {};
            
            if (!userPrefs[category]) {
                userPrefs[category] = [];
            }
            
            // Add new preference, keep only last 10 per category
            userPrefs[category].unshift({
                preference,
                context,
                timestamp: Date.now()
            });
            userPrefs[category] = userPrefs[category].slice(0, 10);
            
            this.setCached('userProfiles', cacheKey, userPrefs);
            
        } catch (error) {
            console.warn('Failed to track user preference:', error);
        }
    }

    /**
     * Get personalized recommendations based on user history
     */
    async getPersonalizedRecommendations(userId, currentContext = {}) {
        try {
            const db = require('./database');
            
            // Get user preferences from cache or database
            const cacheKey = `preferences_${userId}`;
            let userPrefs = this.getCached('userProfiles', cacheKey);
            
            if (!userPrefs) {
                try {
                    const preferences = await dbAll(`
                        SELECT category, preference, context, created_at
                        FROM user_preferences 
                        WHERE user_id = $1
                        ORDER BY created_at DESC
                        LIMIT 50
                    `, [userId]);
                    
                    userPrefs = {};
                    preferences.forEach(pref => {
                        if (!userPrefs[pref.category]) {
                            userPrefs[pref.category] = [];
                        }
                        userPrefs[pref.category].push({
                            preference: pref.preference,
                            context: JSON.parse(pref.context || '{}'),
                            timestamp: new Date(pref.created_at).getTime()
                        });
                    });
                    
                    this.setCached('userProfiles', cacheKey, userPrefs);
                } catch (error) {
                    console.warn('Failed to load user preferences:', error);
                    userPrefs = {};
                }
            }
            
            // Generate recommendations based on preferences
            const recommendations = [];
            
            // Hair type recommendations
            if (userPrefs.hair_type) {
                const hairTypes = userPrefs.hair_type.map(p => p.preference);
                if (hairTypes.includes('curly') || hairTypes.includes('كيرلي')) {
                    recommendations.push({
                        type: 'hair_care',
                        message: 'بناءً على اهتمامك بالشعر الكيرلي، أنصحك بكريم ترطيب خاص للشعر المجعد',
                        priority: 'high'
                    });
                }
            }
            
            // Service preferences
            if (userPrefs.service_interest) {
                const services = userPrefs.service_interest.map(p => p.preference);
                if (services.includes('haircut') || services.includes('حلاقة')) {
                    recommendations.push({
                        type: 'seasonal',
                        message: 'الشتاء وقت مناسب لقصات الشعر الجديدة! بدك تجرب شي جديد؟',
                        priority: 'medium'
                    });
                }
            }
            
            // Location-based recommendations
            if (userPrefs.location_interest) {
                const locations = userPrefs.location_interest.map(p => p.preference);
                recommendations.push({
                    type: 'location',
                    message: `شفت إنك مهتم بصالونات ${locations[0]}، في صالونات جديدة فتحت هناك!`,
                    priority: 'medium'
                });
            }
            
            return recommendations.sort((a, b) => {
                const priorityOrder = { high: 3, medium: 2, low: 1 };
                return priorityOrder[b.priority] - priorityOrder[a.priority];
            });
            
        } catch (error) {
            console.warn('Failed to get recommendations:', error);
            return [];
        }
    }

    /**
     * Analyze message for preferences to track
     */
    analyzeMessageForPreferences(message, userId) {
        const lowerMessage = message.toLowerCase();
        
        // Hair type detection
        if (lowerMessage.includes('كيرلي') || lowerMessage.includes('curly') || lowerMessage.includes('مجعد')) {
            this.trackUserPreference(userId, 'hair_type', 'curly', { message_context: message });
        }
        
        if (lowerMessage.includes('ناعم') || lowerMessage.includes('straight') || lowerMessage.includes('مفرود')) {
            this.trackUserPreference(userId, 'hair_type', 'straight', { message_context: message });
        }
        
        // Service interest detection
        if (lowerMessage.includes('حلاقة') || lowerMessage.includes('قص') || lowerMessage.includes('haircut')) {
            this.trackUserPreference(userId, 'service_interest', 'haircut', { message_context: message });
        }
        
        if (lowerMessage.includes('بشرة') || lowerMessage.includes('skin') || lowerMessage.includes('عناية')) {
            this.trackUserPreference(userId, 'service_interest', 'skincare', { message_context: message });
        }
        
        // Price sensitivity
        if (lowerMessage.includes('أرخص') || lowerMessage.includes('رخيص') || lowerMessage.includes('cheap')) {
            this.trackUserPreference(userId, 'price_sensitivity', 'budget_conscious', { message_context: message });
        }
        
        if (lowerMessage.includes('أفضل') || lowerMessage.includes('جودة') || lowerMessage.includes('quality')) {
            this.trackUserPreference(userId, 'price_sensitivity', 'quality_focused', { message_context: message });
        }
    }

    // === Optimized Analytics & Insights System ===

    /**
     * Track conversation analytics (optimized with sampling)
     */
    async trackConversationAnalytics(userId, message, aiResponse, metadata = {}) {
        try {
            // Sample analytics to reduce DB load (track 1 in 3 conversations)
            if (Math.random() > 0.33) return;
            
            const analytics = {
                user_id: userId,
                message_length: message.length,
                response_length: aiResponse.length,
                language: metadata.language || 'ar',
                response_time: metadata.response_time || 0,
                salon_context_used: metadata.salon_context_available || false,
                recommendations_shown: metadata.recommendations_count || 0,
                error_occurred: metadata.error_occurred || false,
                timestamp: new Date().toISOString(),
                session_id: metadata.session_id || `session_${userId}_${Date.now()}`
            };
            
            // Batch analytics to reduce DB writes
            if (!this.analyticsBatch) {
                this.analyticsBatch = [];
                setTimeout(() => this.flushAnalyticsBatch(), 60000); // Flush every minute
            }
            
            this.analyticsBatch.push(analytics);
            
            // Flush if batch is full
            if (this.analyticsBatch.length >= 20) {
                this.flushAnalyticsBatch();
            }
            
            // Update real-time metrics cache (lightweight)
            this.updateRealTimeMetrics(analytics);
            
        } catch (error) {
            console.warn('Failed to track analytics:', error);
        }
    }

    /**
     * Flush analytics batch to database
     */
    async flushAnalyticsBatch() {
        if (!this.analyticsBatch || this.analyticsBatch.length === 0) return;
        
        try {
            const db = require('./database');
            const batch = this.analyticsBatch;
            this.analyticsBatch = [];
            
            // Bulk insert for better performance
            const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const values = batch.flatMap(item => [
                item.user_id, item.message_length, item.response_length,
                item.language, item.response_time, item.salon_context_used,
                item.recommendations_shown, item.error_occurred,
                item.timestamp, item.session_id
            ]);
            
            await db.run(`
                INSERT INTO conversation_analytics 
                (user_id, message_length, response_length, language, response_time, 
                 salon_context_used, recommendations_shown, error_occurred, timestamp, session_id)
                VALUES ${placeholders}
            `, values);
            
        } catch (error) {
            console.warn('Failed to flush analytics batch:', error);
        }
    }

    /**
     * Update real-time metrics in cache
     */
    updateRealTimeMetrics(analytics) {
        try {
            const metricsKey = 'realtime_metrics';
            let metrics = this.getCached('responses', metricsKey) || {
                total_conversations: 0,
                avg_response_time: 0,
                language_distribution: { ar: 0, en: 0 },
                error_rate: 0,
                popular_topics: {},
                hourly_activity: {},
                last_updated: Date.now()
            };
            
            // Update metrics
            metrics.total_conversations++;
            metrics.avg_response_time = (metrics.avg_response_time + analytics.response_time) / 2;
            metrics.language_distribution[analytics.language]++;
            
            if (analytics.error_occurred) {
                metrics.error_rate = (metrics.error_rate + 1) / metrics.total_conversations;
            }
            
            // Track hourly activity
            const hour = new Date().getHours();
            metrics.hourly_activity[hour] = (metrics.hourly_activity[hour] || 0) + 1;
            
            metrics.last_updated = Date.now();
            
            // Cache for 1 hour
            this.setCached('responses', metricsKey, metrics, 60 * 60 * 1000);
            
        } catch (error) {
            console.warn('Failed to update real-time metrics:', error);
        }
    }

    /**
     * Get conversation insights for business intelligence
     */
    async getConversationInsights(timeframe = '24h') {
        try {
            const db = require('./database');
            
            // Check cache first
            const cacheKey = `insights_${timeframe}`;
            const cachedInsights = this.getCached('responses', cacheKey);
            if (cachedInsights) {
                return cachedInsights;
            }
            
            const timeCondition = this.getTimeCondition(timeframe);
            
            // Get comprehensive insights
            const insights = {
                overview: await this.getOverviewMetrics(timeCondition),
                popular_topics: await this.getPopularTopics(timeCondition),
                user_behavior: await this.getUserBehaviorPatterns(timeCondition),
                performance: await this.getPerformanceMetrics(timeCondition),
                language_trends: await this.getLanguageTrends(timeCondition)
            };
            
            // Cache for 30 minutes
            this.setCached('responses', cacheKey, insights, 30 * 60 * 1000);
            
            return insights;
            
        } catch (error) {
            console.warn('Failed to get conversation insights:', error);
            return null;
        }
    }

    /**
     * Get time condition for SQL queries
     */
    getTimeCondition(timeframe) {
        const now = new Date();
        const conditions = {
            '1h': new Date(now.getTime() - 60 * 60 * 1000),
            '24h': new Date(now.getTime() - 24 * 60 * 60 * 1000),
            '7d': new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
            '30d': new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        };
        return conditions[timeframe] || conditions['24h'];
    }

    /**
     * Get overview metrics
     */
    async getOverviewMetrics(timeCondition) {
        try {
            const metrics = await dbAll(`
                SELECT 
                    COUNT(*) as total_conversations,
                    AVG(response_time) as avg_response_time,
                    COUNT(DISTINCT user_id) as unique_users,
                    AVG(CASE WHEN error_occurred = true THEN 1.0 ELSE 0.0 END) as error_rate
                FROM conversation_analytics 
                WHERE timestamp > $1
            `, [timeCondition]);
            
            const result = metrics[0] || {};
            return {
                total_conversations: parseInt(result.total_conversations) || 0,
                avg_response_time: Math.round(result.avg_response_time || 0),
                unique_users: parseInt(result.unique_users) || 0,
                error_rate: Math.round((result.error_rate || 0) * 100)
            };
        } catch (error) {
            console.warn('Failed to get overview metrics:', error);
            return {
                total_conversations: 0,
                avg_response_time: 0,
                unique_users: 0,
                error_rate: 0
            };
        }
    }

    /**
     * Get popular topics from user preferences
     */
    async getPopularTopics(timeCondition) {
        try {
            const topics = await dbAll(`
                SELECT category, preference, COUNT(*) as frequency
                FROM user_preferences 
                WHERE created_at > $1
                GROUP BY category, preference
                ORDER BY frequency DESC
                LIMIT 10
            `, [timeCondition]);
            
            return topics.map(topic => ({
                topic: `${topic.category}: ${topic.preference}`,
                frequency: parseInt(topic.frequency) || 0
            }));
        } catch (error) {
            console.warn('Failed to get popular topics:', error);
            return [];
        }
    }

    /**
     * Get user behavior patterns
     */
    async getUserBehaviorPatterns(timeCondition) {
        try {
            const patterns = await dbAll(`
                SELECT 
                    AVG(message_length) as avg_message_length,
                    AVG(response_length) as avg_response_length,
                    COUNT(CASE WHEN salon_context_used = true THEN 1 END) as salon_queries,
                    COUNT(CASE WHEN recommendations_shown > 0 THEN 1 END) as recommendation_requests
                FROM conversation_analytics 
                WHERE timestamp > $1
            `, [timeCondition]);
            
            const result = patterns[0] || {};
            return {
                avg_message_length: Math.round(result.avg_message_length || 0),
                avg_response_length: Math.round(result.avg_response_length || 0),
                salon_queries: parseInt(result.salon_queries) || 0,
                recommendation_requests: parseInt(result.recommendation_requests) || 0
            };
        } catch (error) {
            console.warn('Failed to get user behavior patterns:', error);
            return {
                avg_message_length: 0,
                avg_response_length: 0,
                salon_queries: 0,
                recommendation_requests: 0
            };
        }
    }

    /**
     * Get performance metrics
     */
    async getPerformanceMetrics(timeCondition) {
        try {
            const performance = await dbAll(`
                SELECT 
                    CASE 
                        WHEN response_time < 1000 THEN 'fast'
                        WHEN response_time < 3000 THEN 'medium'
                        ELSE 'slow'
                    END as speed_category,
                    COUNT(*) as count
                FROM conversation_analytics 
                WHERE timestamp > $1
                GROUP BY speed_category
            `, [timeCondition]);
            
            const result = { fast: 0, medium: 0, slow: 0 };
            performance.forEach(p => {
                result[p.speed_category] = parseInt(p.count) || 0;
            });
            
            return result;
        } catch (error) {
            console.warn('Failed to get performance metrics:', error);
            return { fast: 0, medium: 0, slow: 0 };
        }
    }

    /**
     * Get language trends
     */
    async getLanguageTrends(timeCondition) {
        try {
            const trends = await dbAll(`
                SELECT language, COUNT(*) as count
                FROM conversation_analytics 
                WHERE timestamp > $1
                GROUP BY language
            `, [timeCondition]);
            
            const result = { ar: 0, en: 0, mixed: 0 };
            trends.forEach(trend => {
                result[trend.language] = parseInt(trend.count) || 0;
            });
            
            return result;
        } catch (error) {
            console.warn('Failed to get language trends:', error);
            return { ar: 0, en: 0, mixed: 0 };
        }
    }

    /**
     * Classify user query to determine the type of information needed
     */
    classifyQuery(message) {
        const msg = message.toLowerCase();
        
        // Service-specific queries
        const serviceKeywords = ['خدمة', 'خدمات', 'سعر', 'أسعار', 'كم', 'تكلفة', 'مدة', 'وقت', 'service', 'price', 'cost', 'duration'];
        const locationKeywords = ['قريب', 'منطقة', 'مدينة', 'عندي', 'هنا', 'near', 'location', 'area', 'city'];
        const recommendationKeywords = ['أفضل', 'أحسن', 'مميز', 'ممتاز', 'نصحني', 'اقترح', 'best', 'recommend', 'suggest', 'good'];
        const appointmentKeywords = ['موعد', 'حجز', 'متاح', 'فاضي', 'appointment', 'booking', 'available', 'schedule'];
        
        let queryType = 'general';
        let priority = 0;
        
        if (serviceKeywords.some(keyword => msg.includes(keyword))) {
            queryType = 'service_inquiry';
            priority = 3;
        }
        if (locationKeywords.some(keyword => msg.includes(keyword))) {
            queryType = 'location_based';
            priority = Math.max(priority, 2);
        }
        if (recommendationKeywords.some(keyword => msg.includes(keyword))) {
            queryType = 'recommendation';
            priority = Math.max(priority, 2);
        }
        if (appointmentKeywords.some(keyword => msg.includes(keyword))) {
            queryType = 'appointment';
            priority = Math.max(priority, 1);
        }
        
        return { type: queryType, priority };
    }

    /**
     * Extract service search terms from user message
     */
    getServiceSearchTerm(message) {
        const msg = message.toLowerCase();
        
        // Common beauty service terms in Arabic and English
        const serviceTerms = {
            'شعر': ['قص', 'صبغة', 'فرد', 'كيراتين', 'بروتين', 'تسريح'],
            'أظافر': ['مانيكير', 'باديكير', 'جل', 'أكريليك'],
            'وجه': ['تنظيف', 'ماسك', 'فيشل', 'تقشير'],
            'حواجب': ['تشقير', 'تهذيب', 'رسم', 'تاتو'],
            'رموش': ['تركيب', 'رفع', 'صبغة', 'كيرلي'],
            'جسم': ['مساج', 'تدليك', 'سكراب', 'تقشير'],
            'إزالة شعر': ['ليزر', 'شمع', 'حلاوة', 'خيط']
        };
        
        for (const [category, terms] of Object.entries(serviceTerms)) {
            if (msg.includes(category) || terms.some(term => msg.includes(term))) {
                return category;
            }
        }
        
        return null;
    }

    /**
     * Get focused salon data based on query classification and user context
     */
    async getFocusedSalonData(userId, queryClassification, serviceSearchTerm = null) {
        try {
            const userProfile = await this.getUserProfile(userId);
            const city = userProfile.city || 'رام الله';
            const gender = userProfile.gender || 'female';
            
            // Create cache key based on query type and parameters
            const cacheKey = `focused_salon_${city}_${queryClassification.type}_${serviceSearchTerm || 'all'}_${gender}`;
            
            // Use enhanced caching (memory + localStorage)
            const cachedData = this.getCachedEnhanced('salons', cacheKey);
            if (cachedData) {
                return cachedData;
            }
            
            const db = require('./database');
            let salonData = '';
            
            switch (queryClassification.type) {
                case 'service_inquiry':
                    if (serviceSearchTerm) {
                        // Get salons that offer specific service category
                        const salons = await dbAll(`
                            SELECT DISTINCT s.id, s.salon_name, s.city, s.special, s.address,
                                   srv.name_ar as service_name, ss.price, ss.duration
                            FROM salons s
                            JOIN salon_services ss ON s.id = ss.salon_id
                            JOIN services srv ON ss.service_id = srv.id
                            WHERE s.city = $1 AND s.status = 'accepted' 
                            AND (srv.gender = $2 OR srv.gender = 'both')
                            AND srv.name_ar LIKE '%' || $3 || '%'
                            ORDER BY s.special DESC, ss.price ASC
                            LIMIT 8
                        `, [city, gender, serviceSearchTerm]);
                        
                        salonData = this.formatServiceSpecificData(salons);
                    } else {
                        salonData = await this.getGeneralSalonContext(city, gender);
                    }
                    break;
                    
                case 'location_based':
                case 'recommendation':
                    // Get top-rated salons with diverse services
                    const topSalons = await dbAll(`
                        SELECT s.id, s.salon_name, s.city, s.special, s.address,
                               COUNT(ss.service_id) as service_count,
                               AVG(ss.price) as avg_price
                        FROM salons s
                        LEFT JOIN salon_services ss ON s.id = ss.salon_id
                        LEFT JOIN services srv ON ss.service_id = srv.id
                        WHERE s.city = $1 AND s.status = 'accepted'
                        AND (srv.gender = $2 OR srv.gender = 'both' OR srv.gender IS NULL)
                        GROUP BY s.id, s.salon_name, s.city, s.special, s.address
                        ORDER BY s.special DESC, service_count DESC, avg_price ASC
                        LIMIT 6
                    `, [city, gender]);
                    
                    salonData = await this.formatRecommendationData(topSalons);
                    break;
                    
                case 'appointment':
                    // Get salons with basic info for appointment context
                    salonData = await this.getAppointmentContext(city, gender);
                    break;
                    
                default:
                    salonData = await this.getGeneralSalonContext(city, gender);
            }
            
            // Cache for 20 minutes in memory and 60 minutes in localStorage
            this.setCachedEnhanced('salons', cacheKey, salonData, 20 * 60 * 1000, 60);
            return salonData;
            
        } catch (error) {
            console.warn('Failed to get focused salon data:', error);
            return await this.getGeneralSalonContext(userProfile?.city || 'رام الله', userProfile?.gender || 'female');
        }
    }

    /**
     * Format service-specific salon data
     */
    formatServiceSpecificData(salons) {
        if (!salons || salons.length === 0) {
            return 'لا توجد صالونات متاحة لهذه الخدمة في منطقتك حالياً.';
        }
        
        const groupedSalons = {};
        salons.forEach(salon => {
            if (!groupedSalons[salon.id]) {
                groupedSalons[salon.id] = {
                    ...salon,
                    services: []
                };
            }
            if (salon.service_name) {
                groupedSalons[salon.id].services.push({
                    name: salon.service_name,
                    price: salon.price,
                    duration: salon.duration
                });
            }
        });
        
        return Object.values(groupedSalons).map(salon => {
            let info = `🏪 ${salon.salon_name} (${salon.city})`;
            if (salon.special) info += ' ⭐';
            
            if (salon.services.length > 0) {
                const serviceInfo = salon.services.map(s => 
                    `${s.name}: ${s.price}ش (${s.duration}د)`
                ).join(', ');
                info += `\n   📋 ${serviceInfo}`;
            }
            
            return info;
        }).join('\n\n');
    }

    /**
     * Format recommendation data with service variety
     */
    async formatRecommendationData(salons) {
        if (!salons || salons.length === 0) {
            return 'لا توجد صالونات متاحة في منطقتك حالياً.';
        }
        
        const db = require('./database');
        const detailedSalons = await Promise.all(
            salons.map(async (salon) => {
                try {
                    // Get top 3 popular services for each salon
                    const services = await dbAll(`
                        SELECT srv.name_ar, ss.price, ss.duration
                        FROM salon_services ss
                        JOIN services srv ON ss.service_id = srv.id
                        WHERE ss.salon_id = $1
                        ORDER BY ss.price ASC
                        LIMIT 3
                    `, [salon.id]);
                    
                    return { ...salon, topServices: services };
                } catch (error) {
                    return { ...salon, topServices: [] };
                }
            })
        );
        
        return detailedSalons.map(salon => {
            let info = `🏪 ${salon.salon_name}`;
            if (salon.special) info += ' ⭐ مميز';
            info += `\n   📍 ${salon.address || salon.city}`;
            info += `\n   📊 ${salon.service_count || 0} خدمة متاحة`;
            
            if (salon.topServices && salon.topServices.length > 0) {
                const servicesList = salon.topServices.map(s => 
                    `${s.name_ar} (${s.price}ش)`
                ).join(', ');
                info += `\n   💅 ${servicesList}`;
            }
            
            return info;
        }).join('\n\n');
    }

    /**
     * Get appointment-focused context
     */
    async getAppointmentContext(city, gender) {
        const db = require('./database');
        
        const salons = await dbAll(`
            SELECT id, salon_name, city, special, address
            FROM salons 
            WHERE city = $1 AND status = 'accepted'
            ORDER BY special DESC
            LIMIT 5
        `, [city]);
        
        return salons.map(salon => 
            `🏪 ${salon.salon_name}${salon.special ? ' ⭐' : ''} - ${salon.city}`
        ).join('\n');
    }

    /**
     * Get general salon context (fallback)
     */
    async getGeneralSalonContext(city, gender) {
        const db = require('./database');
        
        const salons = await dbAll(`
            SELECT s.id, s.salon_name, s.city, s.special
            FROM salons s
            WHERE s.city = $1 AND s.status = 'accepted'
            ORDER BY s.special DESC
            LIMIT 8
        `, [city]);
        
        return salons.map(salon => 
            `- ${salon.salon_name}${salon.special ? ' ⭐' : ''}: ${salon.city}`
        ).join('\n');
    }

    /**
     * Enhanced salon context with smart query classification
     */
    async getSalonContext(userId, userMessage = '') {
        try {
            // Classify the user's query
            const queryClassification = this.classifyQuery(userMessage);
            
            // Extract service search terms if applicable
            const serviceSearchTerm = queryClassification.type === 'service_inquiry' 
                ? this.getServiceSearchTerm(userMessage) 
                : null;
            
            // Get focused salon data based on classification
            return await this.getFocusedSalonData(userId, queryClassification, serviceSearchTerm);
            
        } catch (error) {
            console.warn('Failed to get salon context:', error);
            // Fallback to basic context
            const userProfile = await this.getUserProfile(userId);
            return await this.getGeneralSalonContext(
                userProfile?.city || 'رام الله', 
                userProfile?.gender || 'female'
            );
        }
    }

    /**
     * Main chat processing function
     */
    async processChat(message, userId, additionalContext = {}) {
        try {
            // Validate input
            if (!message || message.trim().length === 0) {
                throw new Error('الرسالة مطلوبة');
            }

            if (!this.apiKey) {
                throw new Error('خدمة المساعد الذكي غير متوفرة حالياً');
            }

            // Get user profile and merge with additional context
            const userProfile = await this.getUserProfile(userId);
            
            // Override with context data if provided
            if (additionalContext.user_gender) {
                userProfile.gender = additionalContext.user_gender;
            }
            if (additionalContext.user_name) {
                userProfile.name = additionalContext.user_name;
            }
            if (additionalContext.user_city) {
                userProfile.city = additionalContext.user_city;
            }
            
            const detectedLanguage = this.detectLanguage(message);
            
            // Get salon context for AI awareness with smart classification
            const salonContext = await this.getSalonContext(userId, message);

            // Intent routing: determine aim and extract slots
            const { aim } = this.determineAim(message);
            const slots = this.extractSlots(message, userProfile);
            const { isUrgent } = this.detectUrgency(message);

            // Aim-specific data (real data only) with caching
            let aimDataText = '';
            const defaultCity = slots.city || userProfile.city || 'رام الله';
            const defaultGender = slots.gender || userProfile.gender || 'female';
            const searchParams = { aim, city: defaultCity, gender: defaultGender, service: slots.service };
            const cachedAim = this.getCachedSalonSearchResults(searchParams);
            if (cachedAim) {
                aimDataText = cachedAim;
            } else {
                if (aim === 'PER_LOCATION' && defaultCity) {
                    aimDataText = await this.getPerLocationData(defaultCity, defaultGender);
                } else if (aim === 'COMPARE' && defaultCity && slots.service) {
                    aimDataText = await this.getComparisonData(defaultCity, defaultGender, slots.service);
                } else if (aim === 'DEEP_ANALYSIS' && defaultCity) {
                    aimDataText = await this.getDeepAnalysisData(defaultCity, defaultGender, slots.service || null);
                }
                if (aimDataText) {
                    this.cacheSalonSearchResults(searchParams, aimDataText);
                }
            }

            // If urgent, append availability filter block for next hour
            let urgentBlock = '';
            if (isUrgent && (aim === 'PER_LOCATION' || aim === 'COMPARE')) {
                const urgentData = await this.getUrgentAvailabilityData(defaultCity, defaultGender, slots.service || null);
                if (urgentData) {
                    urgentBlock = `\n\n[AVAILABILITY_NEXT_HOUR]\n${urgentData}\n`;
                }
            }

            // Build conversation context
            const conversationHistory = this.buildConversationContext(userId);
            let systemPrompt = this.generateSystemPrompt(userProfile, salonContext);
            const aimInstruction = this.buildAimInstruction(aim, { ...slots, urgent: isUrgent });
            const dataBlock = aimDataText ? `\n\n[REAL_DATA]\n${aimDataText}\n` : '';
            systemPrompt = `${systemPrompt}\n\n${aimInstruction}${urgentBlock}${dataBlock}`;

            // Prepare messages for AI
            const messages = [
                { role: 'system', content: systemPrompt },
                ...conversationHistory,
                { role: 'user', content: message }
            ];

            // Call DeepSeek API
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: messages,
                    // OPTIMIZATION: Reduced max_tokens for faster, cheaper, more concise responses
                    max_tokens: 800, 
                    temperature: 0.8, 
                    stream: false
                })
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error('DeepSeek API error:', response.status, errorData);
                throw new Error('فشل في الاتصال بخدمة الذكاء الاصطناعي');
            }

            const aiData = await response.json();
            
            if (!aiData.choices || aiData.choices.length === 0) {
                throw new Error('لم يتم الحصول على رد من المساعد الذكي');
            }

            const aiResponse = aiData.choices[0].message.content;

            // Add to conversation history
            this.addToHistory(userId, message, aiResponse);

            // Log to database for analytics
            await this.logChatMessage(userId, message, aiResponse, detectedLanguage);

            return {
                success: true,
                response: aiResponse,
                language: detectedLanguage,
                conversation_id: userId,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('AI Chat processing error:', error);
            return {
                success: false,
                error: error.message,
                fallback_response: this.getFallbackResponse(message)
            };
        }
    }

    // === Database Operations ===

    /**
     * Log chat message to database
     */
    async logChatMessage(userId, userMessage, aiResponse, language) {
        try {
            await db.run(`
                INSERT INTO ai_chat_messages (
                    user_id, 
                    user_message, 
                    ai_response, 
                    language_detected,
                    created_at
                ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            `, [userId, userMessage, aiResponse, language]);
        } catch (error) {
            console.warn('Failed to log chat message:', error.message);
        }
    }

    /**
     * Get fallback response when AI fails
     */
    getFallbackResponse(message) {
        const arabicPattern = /[\u0600-\u06FF]/;
        const isArabic = arabicPattern.test(message);
        
        if (isArabic) {
            // Use a fallback response that aligns with the persona
            return "عذراً، صارت معي مشكلة بسيطة بالشبكة. ياريت تجرب تسألني كمان مرة، أو تحكيلي شو بدك بالضبط. أنا هون عشان أساعدك! 😊";
        } else {
            return "Sorry, I'm experiencing a temporary technical issue. Please try again in a moment. 😊";
        }
    }

    // === Utility Functions ===

    /**
     * Clear conversation history for a user
     */
    clearConversation(userId) {
        this.conversationMemory.delete(userId);
        return { success: true, message: 'تم مسح المحادثة بنجاح' };
    }

    /**
     * Get conversation statistics
     */
    async getConversationStats(userId) {
        try {
            // FIX: Using $1 placeholder
            const stats = await db.get(`
                SELECT 
                    COUNT(*) as total_messages,
                    COUNT(DISTINCT DATE(created_at)) as active_days,
                    MAX(created_at) as last_message
                FROM ai_chat_messages 
                WHERE user_id = $1
            `, [userId]);
            
            return {
                success: true,
                stats: stats || { total_messages: 0, active_days: 0, last_message: null }
            };
        } catch (error) {
            console.error('Failed to get conversation stats:', error);
            return {
                success: false,
                error: 'فشل في جلب إحصائيات المحادثة'
            };
        }
    }

    /**
     * Learn from user interactions to improve recommendations
     * @param {string} userId - User identifier
     * @param {Object} interaction - Interaction data
     */
    async learnFromInteraction(userId, interaction) {
        try {
            const userPreferences = this.getCached('user_preferences', userId) || {
                preferredCities: {},
                preferredServices: {},
                viewedSalons: {},
                bookedSalons: {},
                interactionCount: 0,
                lastUpdated: Date.now()
            };

            userPreferences.interactionCount++;
            userPreferences.lastUpdated = Date.now();

            switch (interaction.type) {
                case 'salon_view':
                    userPreferences.viewedSalons[interaction.data.salonId] = 
                        (userPreferences.viewedSalons[interaction.data.salonId] || 0) + 1;
                    
                    if (interaction.data.city) {
                        userPreferences.preferredCities[interaction.data.city] = 
                            (userPreferences.preferredCities[interaction.data.city] || 0) + 1;
                    }
                    break;

                case 'salon_book':
                    userPreferences.bookedSalons[interaction.data.salonId] = 
                        (userPreferences.bookedSalons[interaction.data.salonId] || 0) + 1;
                    
                    if (interaction.data.city) {
                        userPreferences.preferredCities[interaction.data.city] = 
                            (userPreferences.preferredCities[interaction.data.city] || 0) + 3; // Higher weight for bookings
                    }
                    break;

                case 'service_interest':
                    if (interaction.data.service) {
                        userPreferences.preferredServices[interaction.data.service] = 
                            (userPreferences.preferredServices[interaction.data.service] || 0) + 1;
                    }
                    break;
            }

            // Cache user preferences for 30 days
            this.setCachedEnhanced('user_preferences', userId, userPreferences, 
                30 * 24 * 60 * 60 * 1000, // 30 days memory cache
                90 * 24 * 60 * 60 * 1000  // 90 days localStorage cache
            );

            return userPreferences;
        } catch (error) {
            console.error('Error learning from interaction:', error);
            return null;
        }
    }

    /**
     * Get personalized salon recommendations based on user preferences
     * @param {string} userId - User identifier
     * @param {Array} salons - Available salons
     * @param {number} limit - Maximum number of recommendations
     */
    getPersonalizedRecommendations(userId, salons, limit = 3) {
        try {
            const userPreferences = this.getCached('user_preferences', userId);
            
            if (!userPreferences || !salons || salons.length === 0) {
                return salons ? salons.slice(0, limit) : [];
            }

            // Score salons based on user preferences
            const scoredSalons = salons.map(salon => {
                let score = 0;

                // City preference scoring
                if (userPreferences.preferredCities[salon.city]) {
                    score += userPreferences.preferredCities[salon.city] * 2;
                }

                // Previously viewed salon scoring
                if (userPreferences.viewedSalons[salon.id]) {
                    score += userPreferences.viewedSalons[salon.id] * 1.5;
                }

                // Previously booked salon scoring (higher weight)
                if (userPreferences.bookedSalons[salon.id]) {
                    score += userPreferences.bookedSalons[salon.id] * 5;
                }

                // Rating boost
                if (salon.avg_rating) {
                    score += parseFloat(salon.avg_rating) * 0.5;
                }

                return { ...salon, personalizedScore: score };
            });

            // Sort by personalized score and return top recommendations
            return scoredSalons
                .sort((a, b) => b.personalizedScore - a.personalizedScore)
                .slice(0, limit);

        } catch (error) {
            console.error('Error getting personalized recommendations:', error);
            return salons ? salons.slice(0, limit) : [];
        }
    }

    /**
     * Generate AI response with personalized recommendations
     * @param {string} userId - User identifier
     * @param {string} message - User message
     * @param {Array} salons - Available salons
     */
    async generatePersonalizedResponse(userId, message, salons) {
        try {
            const personalizedSalons = this.getPersonalizedRecommendations(userId, salons, 3);
            const userPreferences = this.getCached('user_preferences', userId);

            let personalizedContext = '';
            
            if (userPreferences && userPreferences.interactionCount > 5) {
                const topCities = Object.entries(userPreferences.preferredCities)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 2)
                    .map(([city]) => city);

                const topServices = Object.entries(userPreferences.preferredServices)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 3)
                    .map(([service]) => service);

                personalizedContext = `\n\nملاحظة: بناءً على تفضيلاتك السابقة، لاحظت اهتمامك بـ${topCities.length > 0 ? ` المناطق: ${topCities.join('، ')}` : ''}${topServices.length > 0 ? ` والخدمات: ${topServices.join('، ')}` : ''}. سأركز على هذه التفضيلات في اقتراحاتي.`;
            }

            const response = await this.generateResponse(message, personalizedSalons);
            return response + personalizedContext;

        } catch (error) {
            console.error('Error generating personalized response:', error);
            return await this.generateResponse(message, salons);
        }
    }
}

// Create and export singleton instance
const aiAssistant = new SaloonyAIAssistant();

module.exports = {
    aiAssistant,
    SaloonyAIAssistant
};
