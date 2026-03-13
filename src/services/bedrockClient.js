/**
 * Amazon Bedrock — Claude Client
 * ================================
 * Calls Claude via Amazon Bedrock Runtime using API key (Bearer auth).
 *
 * Required env vars:
 *   BEDROCK_API_KEY    — Your Bedrock API key
 *   AWS_REGION         — Bedrock region (default: us-east-1)
 *   BEDROCK_MODEL_ID   — Inference profile ID (default: us.anthropic.claude-sonnet-4-20250514-v1:0)
 */

const DEFAULT_REGION = 'ap-south-1';
const DEFAULT_MODEL  = 'apac.anthropic.claude-sonnet-4-6';

/**
 * Check if Bedrock is configured
 */
export function isBedrockConfigured() {
  return !!process.env.BEDROCK_API_KEY;
}

/**
 * Call Claude via Amazon Bedrock Runtime
 *
 * @param {string} prompt   — The full prompt text
 * @param {object} [opts]
 * @param {string} [opts.model]     — Override inference profile ID
 * @param {number} [opts.maxTokens] — Max output tokens (default 8192)
 * @returns {Promise<string>}       — Claude's text response
 */
export async function callClaude(prompt, { model, maxTokens = 8192 } = {}) {
  const apiKey = process.env.BEDROCK_API_KEY;
  if (!apiKey) {
    throw new Error('BEDROCK_API_KEY not configured in .env');
  }

  const region  = process.env.AWS_REGION || DEFAULT_REGION;
  const modelId = model || process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL;

  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    messages: [
      { role: 'user', content: prompt }
    ]
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Bedrock API error (${response.status}): ${errText}`);
  }

  const data = await response.json();

  const text = (data.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('')
    .trim();

  return text;
}

export default { callClaude, isBedrockConfigured };
