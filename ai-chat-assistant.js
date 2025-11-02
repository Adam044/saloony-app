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

🇵🇸 معلومات عن تطبيق صالوني - التطبيق الفلسطيني الذكي الأول:
• صالوني هو أول تطبيق فلسطيني ذكي يدمج الذكاء الاصطناعي مع قطاع الجمال والصالونات
• تطبيق ثوري يربط بين العملاء وصالونات التجميل بطريقة ذكية ومبتكرة
• يوفر تجربة حجز سهلة وسريعة للعملاء، وأدوات إدارة متقدمة لأصحاب الصالونات
• التطبيق الأول من نوعه في فلسطين الذي يجمع بين التكنولوجيا والذكاء الاصطناعي مع قطاع الجمال

👨‍💻 المؤسسون والمطورون:
• آدم حواش (Adam Hawash) - المؤسس والمطور الرئيسي، فلسطيني مبدع صمم وطور التطبيق بالكامل
• أسامة الصيفي (Osama Al Saify) - الشريك والمؤسس المشارك
• فريق فلسطيني 100% يعمل على تطوير أول تطبيق ذكي متكامل في المنطقة

🚀 مميزات التطبيق الذكية:
• حجز فوري 24/7 حتى خارج ساعات العمل
• جدولة ذكية تمنع التداخل وترسل تذكيرات
• اكتشاف الصالونات بالبحث الذكي والتوصيات المخصصة
• تقييمات وصور تبني الثقة وتجذب عملاء جدد
• تسويق ذكي مستهدف بدون إعلانات مكلفة
• إدارة متقدمة للموظفين مع أدوار مخصصة وحماية عالية
• قريباً: بيع المنتجات عبر التطبيق

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
• **لا تذكر الأسعار إلا إذا سأل المستخدم عنها مباشرة**
• **كن مختصر ومحادث طبيعي - لا تعطي كل المعلومات مرة وحدة**
• **اقترح عرض التفاصيل بدلاً من إعطائها مباشرة**
• إذا سأل عن صالون معين بالاسم، تحدث عنه إذا كان في القائمة أعلاه مع ذكر الخدمات والأسعار
• إذا سأل عن أسعار أو "أرخص" أو "أغلى"، قارن الأسعار من المعلومات المتوفرة
• إذا طلب رؤية صالون معين أو قال "فرجيني" أو "شوفلي"، اعرض الصالونات
• عند السؤال عن الصالونات عموماً، قل فقط "هاي الصالونات المتاحة في منطقتك:"
• لا تقل أبداً "ما بقدر أعرضلك صالون بالاسم" - أنت تعرف الصالونات وتقدر تتحدث عنها
• كن متسق في إجاباتك - إذا ذكرت معلومات عن صالون، يعني تقدر تعرضه

🎯 أمثلة على الردود الذكية:

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

المستخدم: "اه" أو "نعم" أو "بدي تفاصيل" (بعد سؤال عن صالون معين)
أنت: "[SHOW_SALON:Abo jabra] هاي تفاصيل Abo jabra:"

المستخدم: "شوفلي صالون الاناقة" أو "فرجيني صالون الاناقة"
أنت: "[SHOW_SALON:صالون الاناقة] صالون الاناقة موجود في شارع الإرسال في رام الله، وعنده تقييم ممتاز 5.0 نجوم. بيقدم خدمات زي تنظيف البشرة بـ25 شيكل وماسك مرطب بـ25 شيكل. بدك تشوف تفاصيل أكتر ولا تحجز موعد؟"

المستخدم: "شوفلي Abo jabra" أو "فرجيني ابو جبرا"
أنت: "[SHOW_SALON:Abo jabra] Abo jabra صالون حلو في الماسيون بجانب فندق الميلينيم في رام الله. صالون جديد وبيقدم خدمات متنوعة زي السشوار بـ15 شيكل واللحية بـ20 شيكل. بدك تحجز موعد؟"

المستخدم: "شو أحسن من ابو جبرا؟"
أنت: "حسب شو بدك بالضبط؟ إذا بدك أرخص أسعار، ولا خدمات معينة، ولا صالون بتقييم أعلى؟ قولي شو نوع الخدمة اللي بدك إياها عشان أقدر أنصحك أحسن."

المستخدم: "أرخص صالون؟"
أنت: "أرخص الأسعار في صالون الاناقة - الحلاقة بـ 20 شيكل، وفي Abo jabra بـ 25 شيكل. بدك تشوف كل الصالونات ولا معلومات أكثر عن صالون معين؟"

المستخدم: "شو في صالونات" أو "شوفلي الصالونات"
أنت: "[SHOW_ALL_SALONS] هاي الصالونات المتاحة في ${city || 'منطقتك'}:"

كن مستشار ذكي وطبيعي، مش مجرد بوت بيجاوب أسئلة!`;
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
• Adam Hawash (آدم حواش) - Founder and lead developer, a creative Palestinian who designed and developed the entire app
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
     * Main chat processing function with comprehensive error handling and optimization
     */
    async processChat(message, userId, additionalContext = {}) {
        const startTime = Date.now();
        
        try {
            // Validate input first
            const sanitizedMessage = this.validateInput(message);
            
            // Check for cached responses first (smart caching)
            const responseCacheKey = this.generateResponseCacheKey(sanitizedMessage, userId);
            const cachedResponse = this.getCached('responses', responseCacheKey);
            if (cachedResponse) {
                return {
                    success: true,
                    response: cachedResponse.response,
                    language: cachedResponse.language,
                    response_time: Date.now() - startTime,
                    cached: true
                };
            }
            
            // Analyze message for user preferences (non-blocking)
            this.analyzeMessageForPreferences(sanitizedMessage, userId);
            
            // Get user profile with fallback
            let userProfile;
            try {
                userProfile = await this.getUserProfile(userId);
            } catch (error) {
                console.warn('Failed to get user profile, using defaults:', error);
                userProfile = { 
                    name: 'صديقي', 
                    gender: 'male', 
                    city: 'رام الله',
                    language_preference: 'ar'
                };
            }

            const detectedLanguage = this.detectLanguage(sanitizedMessage);
            
            // Get salon context with timeout (only for salon-related queries)
            let salonContext = '';
            const needsSalonContext = this.needsSalonContext(sanitizedMessage);
            if (needsSalonContext) {
                try {
                    const contextPromise = this.getSalonContext(userId);
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Salon context timeout')), 3000) // Reduced timeout
                    );
                    salonContext = await Promise.race([contextPromise, timeoutPromise]);
                } catch (error) {
                    console.warn('Failed to get salon context:', error);
                    // Continue without salon context
                }
            }
            
            // Get personalized recommendations (only for returning users)
            let recommendations = [];
            if (this.conversationMemory.has(userId)) {
                recommendations = await this.getPersonalizedRecommendations(userId, { message: sanitizedMessage });
            }
            
            // Generate appropriate system prompt based on language
            const systemPrompt = detectedLanguage === 'en' ? 
                this.generateBilingualPrompt(userProfile, detectedLanguage, salonContext, recommendations) :
                this.generateSystemPrompt(userProfile, salonContext, recommendations);
                
            const conversationContext = this.buildConversationContext(userId);

            // Add language instruction to ensure proper response language
            const languageInstruction = detectedLanguage === 'en' ? 
                'IMPORTANT: The user wrote in English, so respond in English only.' :
                'مهم: المستخدم كتب بالعربية، لذا أجب بالعربية فقط.';

            const messages = [
                { role: 'system', content: systemPrompt + '\n\n' + languageInstruction },
                ...conversationContext,
                { role: 'user', content: sanitizedMessage }
            ];

            // AI API call with retry logic
            let aiResponse;
            let attempts = 0;
            const maxAttempts = 3;

            while (attempts < maxAttempts) {
                try {
                    const response = await fetch(this.apiUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.apiKey}`
                        },
                        body: JSON.stringify({
                            model: 'deepseek-chat',
                            messages: messages,
                            max_tokens: 500,
                            temperature: 0.7,
                            timeout: 10000 // 10 second timeout
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`AI API error: ${response.status} ${response.statusText}`);
                    }

                    const data = await response.json();
                    
                    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                        throw new Error('Invalid AI response format');
                    }

                    aiResponse = data.choices[0].message.content.trim();
                    
                    // Track token usage if available in response
                    if (data.usage) {
                        this.trackTokenUsage(
                            userId, 
                            data.usage.prompt_tokens || this.estimateTokenCount(JSON.stringify(messages)),
                            data.usage.completion_tokens || this.estimateTokenCount(aiResponse),
                            'deepseek-chat'
                        ).catch(error => console.warn('Token tracking failed:', error));
                    } else {
                        // Estimate tokens if not provided
                        const inputTokens = this.estimateTokenCount(JSON.stringify(messages));
                        const outputTokens = this.estimateTokenCount(aiResponse);
                        this.trackTokenUsage(userId, inputTokens, outputTokens, 'deepseek-chat')
                            .catch(error => console.warn('Token tracking failed:', error));
                    }
                    
                    break; // Success, exit retry loop

                } catch (error) {
                    attempts++;
                    console.warn(`AI API attempt ${attempts} failed:`, error);
                    
                    if (attempts >= maxAttempts) {
                        // All attempts failed, use fallback
                        aiResponse = this.getFallbackResponse(error, sanitizedMessage);
                        break;
                    }
                    
                    // Wait before retry (exponential backoff)
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 1000));
                }
            }

            // Add to conversation history
            this.addToHistory(userId, sanitizedMessage, aiResponse);

            const responseTime = Date.now() - startTime;

            // Cache successful responses for future use (smart caching)
            if (aiResponse && !aiResponse.includes('عذراً') && !aiResponse.includes('خطأ')) {
                const responseCacheKey = this.generateResponseCacheKey(sanitizedMessage, userId);
                this.setCached('responses', responseCacheKey, {
                    response: aiResponse,
                    language: detectedLanguage
                }, 10 * 60 * 1000); // Cache for 10 minutes
            }

            // Log to database (non-blocking)
            this.logChatMessage(userId, sanitizedMessage, aiResponse, detectedLanguage)
                .catch(error => console.warn('Failed to log chat:', error));

            // Track analytics (non-blocking)
            this.trackConversationAnalytics(userId, sanitizedMessage, aiResponse, {
                language: detectedLanguage,
                response_time: responseTime,
                salon_context_available: !!salonContext,
                recommendations_count: recommendations.length,
                error_occurred: false
            }).catch(error => console.warn('Failed to track analytics:', error));

            return {
                success: true,
                response: aiResponse,
                language: detectedLanguage,
                response_time: responseTime,
                salon_context_available: !!salonContext,
                recommendations_shown: recommendations.length
            };

        } catch (error) {
            console.error('Chat processing error:', error);
            
            const fallbackResponse = this.getFallbackResponse(error, message);
            const responseTime = Date.now() - startTime;

            return {
                success: false,
                response: fallbackResponse,
                error: error.message,
                response_time: responseTime,
                fallback_used: true
            };
        }
    }
    /**
     * Get salon context for AI awareness (super optimized)
     */
    async getSalonContext(userId) {
        try {
            // Get user's city to fetch relevant salons
            const userProfile = await this.getUserProfile(userId);
            const city = userProfile.city || 'رام الله';
            
            // Check cache first (extended to 15 minutes for better performance)
            const cacheKey = `salon_context_${city}`;
            const cachedContext = this.getCached('salons', cacheKey);
            if (cachedContext) {
                return cachedContext;
            }
            
            // Use internal server call instead of external fetch
            const db = require('./database');
            
            console.log('Getting salon context for city:', city);
            
            // Handle undefined city
            if (!city || city === 'غير محدد' || city === 'undefined') {
                city = 'رام الله'; // Default to Ramallah
            }
            
            // Optimized query: only get essential fields and limit results
            const salons = await dbAll(`
                SELECT id, salon_name, address, city, special
                FROM salons 
                WHERE city = $1 AND status = 'accepted'
                ORDER BY special DESC, id DESC
                LIMIT 10
            `, [city]);
            
            // Only get services for top 5 salons to reduce DB load
            const topSalons = salons.slice(0, 5);
            const detailedSalons = await Promise.all(
                topSalons.map(async (salon) => {
                    try {
                        // Check cache for services first
                        const servicesCacheKey = `services_${salon.id}`;
                        let services = this.getCached('salons', servicesCacheKey);
                        
                        if (!services) {
                            // Fetch only top 3 services per salon with correct JOIN
                            services = await dbAll(`
                                SELECT s.name_ar, ss.price 
                                FROM salon_services ss
                                JOIN services s ON ss.service_id = s.id
                                WHERE ss.salon_id = $1
                                ORDER BY ss.price ASC
                                LIMIT 3
                            `, [salon.id]);
                            
                            // Cache services for 30 minutes
                            this.setCached('salons', servicesCacheKey, services, 30 * 60 * 1000);
                        }
                        
                        return {
                            ...salon,
                            services: services || []
                        };
                    } catch (error) {
                        return salon;
                    }
                })
            );
            
            // Add remaining salons without services (for basic info)
            const remainingSalons = salons.slice(5).map(salon => ({
                ...salon,
                services: []
            }));
            
            const allSalons = [...detailedSalons, ...remainingSalons];
            
            // Create optimized salon knowledge string (shorter for fewer tokens)
            const salonInfo = allSalons.map(salon => {
                let info = `- ${salon.salon_name}: ${salon.city}`;
                if (salon.special) info += ` ⭐ مميز`;
                
                if (salon.services && salon.services.length > 0) {
                    const topServices = salon.services.slice(0, 2); // Only top 2 services
                    const servicesList = topServices.map(service => 
                        `${service.name_ar} ${parseFloat(service.price).toFixed(0)}ش`
                    ).join(', ');
                    info += ` | ${servicesList}`;
                }
                
                return info;
            }).join('\n');
            
            // Cache the result for 15 minutes (longer for better performance)
            this.setCached('salons', cacheKey, salonInfo, 15 * 60 * 1000);
            
            return salonInfo;
        } catch (error) {
            console.warn('Failed to get salon context:', error);
        }
        return '';
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
            
            // Get salon context for AI awareness
            const salonContext = await this.getSalonContext(userId);
            
            // Build conversation context
            const conversationHistory = this.buildConversationContext(userId);
            const systemPrompt = this.generateSystemPrompt(userProfile, salonContext);

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
}

// Create and export singleton instance
const aiAssistant = new SaloonyAIAssistant();

module.exports = {
    aiAssistant,
    SaloonyAIAssistant
};
