/**
 * LinkedLearnings — Provider-Agnostic LLM Client
 *
 * Supports: OpenAI, Anthropic, Ollama, Groq, OpenRouter, any OpenAI-compatible endpoint.
 * Designed for cheap/free models — short prompts, JSON output, minimal tokens.
 */

/**
 * Send a completion request to the configured LLM provider.
 * @param {object} llmConfig — { provider, apiKey, baseUrl, model }
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>} — raw text response
 */
export async function complete(llmConfig, systemPrompt, userPrompt, maxTokens = 512) {
  const { provider, apiKey, baseUrl, model } = llmConfig;

  switch (provider) {
    case 'anthropic':
      return completeAnthropic(apiKey, baseUrl || 'https://api.anthropic.com', model, systemPrompt, userPrompt, maxTokens);
    case 'ollama':
      return completeOpenAI('', baseUrl || 'http://localhost:11434', model, systemPrompt, userPrompt, maxTokens);
    case 'openai':
      return completeOpenAI(apiKey, baseUrl || 'https://api.openai.com/v1', model, systemPrompt, userPrompt, maxTokens);
    case 'groq':
      return completeOpenAI(apiKey, baseUrl || 'https://api.groq.com/openai/v1', model, systemPrompt, userPrompt, maxTokens);
    case 'custom':
      return completeOpenAI(apiKey, baseUrl, model, systemPrompt, userPrompt, maxTokens);
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

/**
 * Test if the LLM connection works.
 */
export async function testConnection(llmConfig) {
  const { provider, apiKey, baseUrl, model } = llmConfig;

  if (provider === 'none' || !provider) {
    throw new Error('No LLM provider configured');
  }

  try {
    const response = await complete(llmConfig, 'Respond with OK.', 'Test');
    return response && response.length > 0;
  } catch (err) {
    throw new Error(`Connection test failed: ${err.message}`);
  }
}

/**
 * Request the necessary host permission for an LLM provider.
 * Must be called from a page context (side panel), not the service worker.
 */
export function getRequiredOrigin(provider, baseUrl) {
  switch (provider) {
    case 'openai': return 'https://api.openai.com/*';
    case 'anthropic': return 'https://api.anthropic.com/*';
    case 'groq': return 'https://api.groq.com/*';
    case 'ollama': return 'http://localhost:*';
    case 'custom': {
      if (!baseUrl) return null;
      try {
        const url = new URL(baseUrl);
        return `${url.protocol}//${url.host}/*`;
      } catch {
        return null;
      }
    }
    default: return null;
  }
}


// ─── OpenAI-Compatible Format ────────────────────────────
// Works for: OpenAI, Groq, Ollama, OpenRouter, Together, any OpenAI-compat API

async function completeOpenAI(apiKey, baseUrl, model, systemPrompt, userPrompt, maxTokens = 512) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  // OpenRouter requires these headers to identify the app
  if (baseUrl && baseUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://github.com/linkedlearnings';
    headers['X-Title'] = 'LinkedLearnings';
  }

  // Normalize baseUrl — ensure it ends with the right path
  let url = baseUrl.replace(/\/+$/, '');
  if (!url.endsWith('/chat/completions')) {
    if (!url.endsWith('/v1')) {
      url += '/v1';
    }
    url += '/chat/completions';
  }

  const body = {
    model: model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    max_tokens: maxTokens
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('LLM request timed out after 60s');
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`LLM API error ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}


// ─── Anthropic Format ────────────────────────────────────

async function completeAnthropic(apiKey, baseUrl, model, systemPrompt, userPrompt, maxTokens = 512) {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  let response;
  try {
    response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    })
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('LLM request timed out after 60s');
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Anthropic API error ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}
