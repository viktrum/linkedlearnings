/**
 * LinkedLearnings — Analysis Prompts & Deterministic Pre-Processing
 *
 * Hybrid approach: deterministic analysis extracts what it can (hashtags, links,
 * word count, basic stats), then LLM fills in the semantic understanding.
 * This keeps prompts small and works with cheap/free models.
 */

// ─── Deterministic signals moved to lib/analysis.js ──────
// Import extractSignals from there for prompt hints.
import { extractSignals } from './analysis.js';

// ─── LLM Prompts ─────────────────────────────────────────
// Designed to be short and work with cheap models (7B parameter range)

export const SYSTEM_PROMPT = `You extract knowledge from LinkedIn posts. Return ONLY valid JSON. Be concise.`;

/**
 * Build analysis prompt for a single post.
 * Includes deterministic pre-processing results to help the LLM.
 */
export function buildAnalysisPrompt(post, signals) {
  // signals = extractSignals(post) from analysis.js
  const preAnalysis = signals || extractSignals(post);
  // Include pre-analysis hints so the LLM has less work to do
  const hints = [];
  if (preAnalysis.extractedHashtags?.length > 0) {
    hints.push(`Hashtags in post: ${preAnalysis.extractedHashtags.join(', ')}`);
  }
  if (preAnalysis.isList) hints.push('Post contains a list/steps.');
  if (preAnalysis.textSignals?.isTip) hints.push('Post appears to be tips/advice.');
  if (preAnalysis.textSignals?.isStory) hints.push('Post appears to be a personal story.');
  if (preAnalysis.textSignals?.isResource) hints.push('Post shares resources/links.');
  if (preAnalysis.textSignals?.isOpinion) hints.push('Post is an opinion/take.');
  if (preAnalysis.textSignals?.isAnnouncement) hints.push('Post is an announcement.');

  const hintsBlock = hints.length > 0 ? `\nHINTS: ${hints.join('. ')}\n` : '';

  // Truncate very long posts to keep token costs low
  const maxTextLength = 2000;
  let textContent = post.textContent || '';
  if (textContent.length > maxTextLength) {
    textContent = textContent.slice(0, maxTextLength) + '\n[...truncated]';
  }

  return `Analyze this LinkedIn post. Return JSON with these fields:
- summary: 1-2 sentences
- tags: array of 3-5 lowercase topic tags
- category: one of [career-advice, technical, industry-news, thought-leadership, how-to, resource, personal-story, announcement, hiring]
- insights: array of 1-3 key takeaways (short sentences)
- actionItems: array of 0-2 things to do (or empty array)
- tone: one of [informative, inspirational, cautionary, contrarian, practical, promotional]
${hintsBlock}
POST BY: ${post.author?.name || 'Unknown'}${post.author?.headline ? ` (${post.author.headline})` : ''}
POST:
${textContent}

JSON:`;
}

/**
 * Build a batch analysis prompt for multiple posts.
 * Returns a prompt asking for a JSON array — one result per post.
 * More efficient: fewer API calls, less rate limiting.
 *
 * @param {object[]} posts
 * @returns {string} prompt
 */
export function buildBatchAnalysisPrompt(posts) {
  const maxTextLength = 800; // shorter per post in batch mode

  const postsBlock = posts.map((post, i) => {
    let text = post.textContent || '';
    if (text.length > maxTextLength) text = text.slice(0, maxTextLength) + ' [...]';
    const author = post.author?.name || 'Unknown';
    return `POST ${i + 1} (by ${author}):\n${text}`;
  }).join('\n\n---\n\n');

  return `Analyze these ${posts.length} LinkedIn posts. Return a JSON ARRAY with one object per post, in order.
Each object must have:
- summary: 1-2 sentences
- tags: array of 3-5 lowercase topic tags
- category: one of [career-advice, technical, industry-news, thought-leadership, how-to, resource, personal-story, announcement, hiring]
- insights: array of 1-3 key takeaways
- actionItems: array of 0-2 things to do (or empty)
- tone: one of [informative, inspirational, cautionary, contrarian, practical, promotional]

${postsBlock}

JSON ARRAY (${posts.length} objects):`;
}

// Re-export extractSignals for callers that import from prompts.js
export { extractSignals } from './analysis.js';
