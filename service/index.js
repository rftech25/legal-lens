const express = require('express');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const IS_DEV = process.env.NODE_ENV === 'development';
const REQUEST_TIMEOUT_MS = 30_000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /analyze
// Body: { text, agent_id, system_prompt }
app.post('/analyze', async (req, res) => {
  const { text, agent_id, system_prompt } = req.body;

  // 1. Input validation
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: 'text is required and must not be empty' });
  }

  // 2. Timeout protection — abort both API calls if they exceed the limit
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // 3. Run OpenAI and Anthropic calls in parallel
    const [openaiResult, anthropicResult] = await Promise.all([
      openai.chat.completions.create(
        {
          model: 'gpt-4o',
          messages: [
            ...(system_prompt ? [{ role: 'system', content: system_prompt }] : []),
            { role: 'user', content: text },
          ],
        },
        { signal: controller.signal }
      ),
      anthropic.messages.create(
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          ...(system_prompt ? { system: system_prompt } : {}),
          messages: [{ role: 'user', content: text }],
        },
        { signal: controller.signal }
      ),
    ]);

    clearTimeout(timeoutId);

    return res.json({
      agent_id: agent_id ?? null,
      openai: openaiResult.choices[0].message.content,
      anthropic: anthropicResult.content[0].text,
    });
  } catch (err) {
    clearTimeout(timeoutId);

    // 4. Improved error handling — always log, expose details only in development
    console.error('[/analyze] error:', err);

    const status = err.name === 'AbortError' ? 504 : 500;
    const message =
      err.name === 'AbortError'
        ? 'Request timed out'
        : 'An error occurred while processing your request';

    return res.status(status).json({
      error: message,
      ...(IS_DEV && { details: err.message }),
    });
  }
});

app.listen(PORT, () => {
  console.log(`legal-lens service listening on port ${PORT}`);
});
