/**
 * LinkedLearnings — Deterministic Analysis Engine
 *
 * Keyword extraction via RAKE (Rapid Automatic Keyword Extraction).
 * Fixed tag mapping via keyword density.
 * No LLM, no network, no dependencies.
 */

// ─── Fixed Tag Categories ─────────────────────────────────

const FIXED_TAGS = {
  'AI / ML':          ['ai', 'ml', 'machine learning', 'deep learning', 'llm', 'large language model', 'gpt', 'neural', 'transformer', 'chatgpt', 'openai', 'anthropic', 'generative ai', 'nlp', 'computer vision', 'model', 'agent', 'automation', 'data science', 'algorithm'],
  'Leadership':       ['leadership', 'managing', 'manager', 'ceo', 'cto', 'executive', 'lead', 'team lead', 'director', 'vp', 'culture', 'vision', 'strategy', 'delegation', 'mentorship', 'mentoring'],
  'Career':           ['career', 'job', 'interview', 'resume', 'cv', 'promotion', 'laid off', 'layoff', 'job search', 'offer', 'salary', 'compensation', 'hiring', 'job hunt', 'career advice', 'linkedin'],
  'Startups':         ['startup', 'founder', 'fundraising', 'series a', 'series b', 'vc', 'venture capital', 'bootstrap', 'yc', 'y combinator', 'incubator', 'seed', 'pitch', 'traction', 'mvp', 'product market fit'],
  'Engineering':      ['engineering', 'software', 'developer', 'coding', 'programming', 'architecture', 'system design', 'devops', 'backend', 'frontend', 'api', 'microservices', 'cloud', 'aws', 'kubernetes', 'docker', 'open source', 'github', 'pull request', 'code review'],
  'Marketing':        ['marketing', 'brand', 'seo', 'content marketing', 'growth', 'social media', 'copywriting', 'ads', 'campaign', 'b2c', 'demand generation', 'funnel', 'conversion', 'audience'],
  'Product':          ['product', 'product manager', 'product management', 'roadmap', 'feature', 'user research', 'ux', 'user experience', 'mvp', 'sprint', 'agile', 'backlog', 'stakeholder'],
  'Finance':          ['finance', 'investing', 'revenue', 'profit', 'budget', 'financial', 'stock', 'valuation', 'ipo', 'cash flow', 'burn rate', 'roi', 'p&l', 'saas metrics', 'arr', 'mrr'],
  'Personal Growth':  ['personal growth', 'self-improvement', 'mindset', 'habits', 'discipline', 'motivation', 'mental health', 'burnout', 'work-life balance', 'resilience', 'focus', 'journaling', 'gratitude'],
  'Productivity':     ['productivity', 'time management', 'efficiency', 'workflow', 'tools', 'notion', 'calendar', 'deep work', 'distraction', 'system', 'process', 'second brain'],
  'Design':           ['design', 'ui', 'figma', 'interaction design', 'visual design', 'design system', 'accessibility', 'typography', 'wireframe', 'prototype', 'user testing', 'design thinking'],
  'Sales':            ['sales', 'pipeline', 'closing', 'cold outreach', 'cold email', 'b2b', 'crm', 'prospecting', 'deal', 'quota', 'revenue', 'account executive', 'sdr'],
};

// ─── RAKE Stopwords ───────────────────────────────────────

const STOPWORDS = new Set([
  'a','about','above','after','again','against','all','am','an','and','any','are',
  'as','at','be','because','been','before','being','below','between','both','but',
  'by','can','did','do','does','doing','down','during','each','few','for','from',
  'further','get','got','had','has','have','having','he','her','here','him','his',
  'how','i','if','in','into','is','it','its','itself','just','like','me','more',
  'most','my','myself','no','nor','not','now','of','off','on','once','only','or',
  'other','our','out','own','re','same','she','so','some','such','than','that',
  'the','their','them','then','there','these','they','this','those','through','to',
  'too','under','until','up','us','very','was','we','were','what','when','where',
  'which','while','who','whom','why','will','with','would','you','your','yours',
  'also','may','might','much','many','one','two','three','ll','ve','d','s','t',
  'via','new','great','good','best','well','time','day','today','year','week',
  'make','made','use','used','using','want','need','know','think','see','say',
  'said','going','go','come','back','look','way','thing','things','lot','always',
  'never','ever','even','still','every','first','last','next','right','left',
  'big','small','long','little','own','old','new','high','low','turn','start',
  'keep','work','working','help','share','let','put','take','give','find','try',
  'yes','no','not','just','really','actually','already','maybe','probably',
  'here','there','where','when','why','how','what','who','which','whom',
  'people','person','someone','everyone','anyone','something','anything',
  'every','some','any','all','both','each','few','more','most','other',
  'such','no','nor','not','only','own','same','so','than','too','very',
]);

// ─── RAKE Algorithm ──────────────────────────────────────

/**
 * Extract multi-word keyword phrases using RAKE.
 * @param {string} text
 * @param {number} minWords - skip posts shorter than this
 * @returns {string[]} top keywords/phrases, lowercased
 */
export function rakeKeywords(text, minWords = 20) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < minWords) return [];

  // Split text on stopwords and punctuation to find candidate phrases
  const clean = text.toLowerCase().replace(/[^\w\s-]/g, ' ');
  const tokens = clean.split(/\s+/).filter(Boolean);

  const phrases = [];
  let current = [];

  for (const token of tokens) {
    if (STOPWORDS.has(token) || /^\d+$/.test(token)) {
      if (current.length > 0) {
        phrases.push(current);
        current = [];
      }
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) phrases.push(current);

  // Filter: max 4 words per phrase, min 1
  const validPhrases = phrases.filter(p => p.length >= 1 && p.length <= 4);

  // Build word degree map (how many unique other words each word co-occurs with in phrases)
  const wordFreq = {};
  const wordDegree = {};

  for (const phrase of validPhrases) {
    const degree = phrase.length - 1;
    for (const word of phrase) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
      wordDegree[word] = (wordDegree[word] || 0) + degree;
    }
  }

  // Score each phrase: sum of (degree + freq) / freq for each word
  const phraseScores = validPhrases.map(phrase => {
    const score = phrase.reduce((sum, word) => {
      const freq = wordFreq[word] || 1;
      const degree = wordDegree[word] || 0;
      return sum + (degree + freq) / freq;
    }, 0);
    return { phrase: phrase.join(' '), score };
  });

  // Deduplicate and sort by score descending
  const seen = new Set();
  return phraseScores
    .sort((a, b) => b.score - a.score)
    .filter(({ phrase }) => {
      if (seen.has(phrase)) return false;
      seen.add(phrase);
      return true;
    })
    .slice(0, 8)
    .map(({ phrase }) => phrase);
}

// ─── Pre-compiled Fixed Tag Patterns ─────────────────────

const FIXED_TAG_PATTERNS = Object.entries(FIXED_TAGS).map(([category, keywords]) => ({
  category,
  patterns: keywords.map(kw => kw.includes(' ')
    ? { type: 'substring', kw }
    : { type: 'regex', re: new RegExp(`\\b${kw}\\b`, 'g') }
  ),
}));

// ─── Fixed Tag Mapping ────────────────────────────────────

/**
 * Map post text to fixed category tags.
 * Requires 2+ keyword hits per category. Returns top 2 by density.
 * @param {string} text
 * @returns {string[]} matched category names (max 2)
 */
export function mapToFixedTags(text) {
  const lower = text.toLowerCase();
  const wordCount = lower.split(/\s+/).filter(Boolean).length || 1;
  const scores = [];

  for (const { category, patterns } of FIXED_TAG_PATTERNS) {
    let hits = 0;
    for (const pat of patterns) {
      if (pat.type === 'substring') {
        if (lower.includes(pat.kw)) hits++;
      } else {
        pat.re.lastIndex = 0;
        const matches = lower.match(pat.re);
        if (matches) hits += matches.length;
      }
    }
    if (hits >= 2) {
      scores.push({ category, density: hits / wordCount });
    }
  }

  return scores
    .sort((a, b) => b.density - a.density)
    .slice(0, 2)
    .map(s => s.category);
}

// ─── Signals (used by LLM prompt hints too) ───────────────

/**
 * Extract deterministic signals from a post.
 * Exported so prompts.js can use it for LLM hint building.
 */
export function extractSignals(post) {
  const text = post.textContent || '';
  const result = {};

  result.extractedHashtags = (text.match(/#[\w-]+/g) || []).map(h => h.slice(1).toLowerCase());
  result.mentions = (text.match(/@[\w-]+/g) || []).map(m => m.slice(1));
  result.wordCount = text.split(/\s+/).filter(Boolean).length;
  result.isList = /^\s*[\d•\-*]\s/m.test(text) || /\n\s*[\d•\-*]\s/m.test(text);
  result.hasQuestion = text.includes('?');
  result.linkCount = (post.links || []).length;
  result.linkTypes = (post.links || []).map(link => {
    const url = link.url || '';
    if (url.includes('github.com')) return 'github';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
    if (url.includes('medium.com') || url.includes('substack.com')) return 'article';
    if (url.includes('arxiv.org')) return 'paper';
    return 'other';
  });
  result.textSignals = {
    isHiring:       /hiring|we're looking|join our team|open role/i.test(text),
    isAnnouncement: /excited to announce|thrilled to share|big news/i.test(text),
    isTip:          /tip[s]?:|here's how|pro tip|lesson[s]? learned/i.test(text),
    isStory:        /years ago|looking back|my journey|i remember when/i.test(text),
    isResource:     /check out|must-read|bookmark this|save this/i.test(text),
    isOpinion:      /unpopular opinion|hot take|controversial|i think|i believe/i.test(text),
  };
  result.hasMedia = post.hasMedia || false;
  result.mediaType = post.mediaType || null;

  const reactions = post.reactionCount || 0;
  if (reactions >= 1000)     result.engagementTier = 'viral';
  else if (reactions >= 100) result.engagementTier = 'high';
  else if (reactions >= 10)  result.engagementTier = 'moderate';
  else                       result.engagementTier = 'low';

  return result;
}

// ─── Full Deterministic Analysis ─────────────────────────

/**
 * Build a complete deterministic analysis object for a post.
 * No LLM needed. Produces the `analysis.deterministic` slot.
 */
export function buildDeterministicAnalysis(post) {
  const text = post.textContent || '';
  const signals = extractSignals(post);

  // Keywords: RAKE phrases + stripped hashtags, deduplicated
  const rakeResults = rakeKeywords(text);
  const hashtagKeywords = signals.extractedHashtags;
  const allKeywords = [...new Set([...rakeResults, ...hashtagKeywords])].slice(0, 10);

  // Fixed tags (max 2 categories)
  const fixedTags = mapToFixedTags(text);

  // Summary: first meaningful sentence (not too short)
  let summary = '';
  const sentences = text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed.length >= 30) {
      summary = trimmed.slice(0, 200);
      if (trimmed.length > 200) summary += '...';
      break;
    }
  }

  // Category from text signals
  const sig = signals.textSignals;
  let category = 'thought-leadership';
  if (sig.isHiring)       category = 'hiring';
  else if (sig.isAnnouncement) category = 'announcement';
  else if (sig.isTip)     category = 'how-to';
  else if (sig.isStory)   category = 'personal-story';
  else if (sig.isResource) category = 'resource';
  else if (sig.isOpinion) category = 'thought-leadership';

  // Tone from text signals
  let tone = 'informative';
  if (sig.isTip)           tone = 'practical';
  else if (sig.isStory)    tone = 'inspirational';
  else if (sig.isOpinion)  tone = 'contrarian';
  else if (sig.isAnnouncement) tone = 'promotional';
  else if (sig.isResource) tone = 'informative';

  return {
    summary,
    fixedTags,
    keywords: allKeywords,
    category,
    tone,
    wordCount: signals.wordCount,
    engagementTier: signals.engagementTier,
    hasLinks: signals.linkCount > 0,
    hasMedia: signals.hasMedia,
    analyzedAt: new Date().toISOString(),
  };
}

// ─── Related Posts ────────────────────────────────────────

/**
 * Compute tag-based related posts.
 * Incremental: only compute for newPosts against the full set.
 * Two posts are related if they share 2+ tags (fixedTags ∪ keywords).
 * @param {object[]} newPosts - posts to compute relationships for
 * @param {object[]} allPosts - full corpus (includes newPosts)
 * @returns {Map<string, string[]>} postId → relatedPostIds (top 5)
 */
export function computeRelatedPosts(newPosts, allPosts) {
  const result = new Map();

  const getTags = (post) => {
    const d = post.analysis?.deterministic;
    if (!d) return new Set();
    return new Set([...(d.fixedTags || []), ...(d.keywords || [])]);
  };

  for (const post of newPosts) {
    const postTags = getTags(post);
    if (postTags.size === 0) continue;

    const scored = [];
    for (const other of allPosts) {
      if (other.id === post.id) continue;
      const otherTags = getTags(other);
      let overlap = 0;
      for (const tag of postTags) {
        if (otherTags.has(tag)) overlap++;
      }
      if (overlap >= 2) scored.push({ id: other.id, overlap });
    }

    result.set(
      post.id,
      scored.sort((a, b) => b.overlap - a.overlap).slice(0, 5).map(s => s.id)
    );
  }

  return result;
}
