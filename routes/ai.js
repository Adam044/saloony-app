module.exports = function register(app, deps) {
  const { aiAssistant, dbGet } = deps;

  function getTimeCondition(timeframe) {
    const now = new Date();
    const map = {
      '1h': new Date(now.getTime() - 60 * 60 * 1000),
      '24h': new Date(now.getTime() - 24 * 60 * 60 * 1000),
      '7d': new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      '30d': new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    };
    return map[timeframe] || map['24h'];
  }

  async function getTokenUsage(timeframe) {
    try {
      const timeCondition = getTimeCondition(timeframe);
      const tokenStats = await dbGet(
        `SELECT 
           SUM(input_tokens) as total_input_tokens,
           SUM(output_tokens) as total_output_tokens,
           SUM(input_tokens + output_tokens) as total_tokens,
           AVG(input_tokens + output_tokens) as avg_tokens_per_request,
           COUNT(*) as total_requests
         FROM ai_token_usage 
         WHERE created_at > $1`,
        [timeCondition]
      );
      return {
        total: parseInt(tokenStats?.total_tokens) || 0,
        input: parseInt(tokenStats?.total_input_tokens) || 0,
        output: parseInt(tokenStats?.total_output_tokens) || 0,
        average: Math.round(tokenStats?.avg_tokens_per_request || 0),
        requests: parseInt(tokenStats?.total_requests) || 0,
      };
    } catch {
      return { total: 0, input: 0, output: 0, average: 0, requests: 0 };
    }
  }

  app.get('/api/ai-analytics', async (req, res) => {
    try {
      const timeframe = req.query.timeframe || '24h';
      const analytics = await aiAssistant.getConversationInsights(timeframe);
      if (!analytics) return res.json({ success: false, error: 'Failed to retrieve analytics data' });
      const tokens = await getTokenUsage(timeframe);
      analytics.tokens = tokens;
      res.json({ success: true, analytics, timeframe, last_updated: new Date().toISOString() });
    } catch {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  app.post('/api/ai-chat', async (req, res) => {
    try {
      const { message, user_id, context } = req.body;
      if (!message || !String(message).trim()) {
        return res.status(400).json({ success: false, error: 'الرسالة مطلوبة' });
      }
      const result = await aiAssistant.processChat(message, user_id, context);
      if (result?.success) return res.json(result);
      res.status(500).json({ success: false, error: result?.error, fallback_response: result?.fallback_response });
    } catch {
      res.status(500).json({ success: false, error: 'عذراً، حدث خطأ في المساعد الذكي. يرجى المحاولة مرة أخرى.' });
    }
  });

  app.post('/api/ai-chat/clear', async (req, res) => {
    try {
      const { user_id } = req.body;
      if (!user_id) return res.status(400).json({ success: false, error: 'معرف المستخدم مطلوب' });
      const result = aiAssistant.clearConversation(user_id);
      res.json(result);
    } catch {
      res.status(500).json({ success: false });
    }
  });

  app.get('/api/ai-chat/stats/:user_id', async (req, res) => {
    try {
      const user_id = req.params.user_id;
      const result = await aiAssistant.getConversationStats(user_id);
      res.json(result);
    } catch {
      res.status(500).json({ success: false });
    }
  });

  app.post('/api/ai-chat/learn', async (req, res) => {
    try {
      const { user_id, interaction } = req.body;
      if (!user_id || !interaction) return res.status(400).json({ success: false, error: 'معرف المستخدم وبيانات التفاعل مطلوبة' });
      const preferences = await aiAssistant.learnFromInteraction(user_id, interaction);
      res.json({ success: true, message: 'تم تسجيل التفاعل بنجاح', preferences });
    } catch {
      res.status(500).json({ success: false, error: 'عذراً، حدث خطأ في تسجيل التفاعل' });
    }
  });
}