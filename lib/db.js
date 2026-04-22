/**
 * LinkedLearnings — IndexedDB Storage Layer
 *
 * Wraps IndexedDB with a simple async API for posts and extraction state.
 * No external dependencies.
 */

const DB_NAME = 'linkedlearnings';
const DB_VERSION = 1;

let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Posts store
      if (!db.objectStoreNames.contains('posts')) {
        const postsStore = db.createObjectStore('posts', { keyPath: 'id' });
        postsStore.createIndex('by_extractedAt', 'extractedAt', { unique: false });
        postsStore.createIndex('by_postedAt', 'postedAt', { unique: false });
        postsStore.createIndex('by_batchId', 'batchId', { unique: false });
        postsStore.createIndex('by_authorName', 'author.name', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      dbInstance.onclose = () => { dbInstance = null; };
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(new Error(`IndexedDB open failed: ${event.target.error?.message}`));
    };
  });
}

function tx(storeName, mode = 'readonly') {
  return openDB().then(db => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    return { transaction, store };
  });
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─── Posts API ────────────────────────────────────────────

export async function putPost(post) {
  const { store } = await tx('posts', 'readwrite');
  return reqToPromise(store.put(post));
}

export async function putPostsBatch(posts) {
  const { store, transaction } = await tx('posts', 'readwrite');
  for (const post of posts) {
    store.put(post);
  }
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(posts.length);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getPost(id) {
  const { store } = await tx('posts');
  return reqToPromise(store.get(id));
}

export async function getAllPosts() {
  const { store } = await tx('posts');
  return reqToPromise(store.getAll());
}

export async function getPostCount() {
  const { store } = await tx('posts');
  return reqToPromise(store.count());
}

export async function getUnanalyzedPosts() {
  const posts = await getAllPosts();
  return posts.filter(p => p.analysis === null || p.analysis === undefined);
}

export async function getAnalyzedPosts() {
  const posts = await getAllPosts();
  return posts.filter(p => p.analysis !== null && p.analysis !== undefined);
}

// Posts with deterministic analysis but no LLM yet — eligible for LLM enhancement
export async function getDetAnalyzedPosts() {
  const posts = await getAllPosts();
  return posts.filter(p => p.analysis?.deterministic && !p.analysis?.llm);
}

export async function searchPosts(query, filters = {}) {
  const allPosts = await getAllPosts();
  let results = allPosts;

  // Text search across content, author, and analysis
  if (query && query.trim()) {
    const q = query.toLowerCase().trim();
    results = results.filter(post => {
      const text = (post.textContent || '').toLowerCase();
      const author = (post.author?.name || '').toLowerCase();
      const det = post.analysis?.deterministic;
      const llm = post.analysis?.llm;
      const summary = (llm?.summary || det?.summary || '').toLowerCase();
      const fixedTags = (det?.fixedTags || []).join(' ').toLowerCase();
      const keywords = (det?.keywords || []).join(' ').toLowerCase();
      const llmTags = (llm?.tags || []).join(' ').toLowerCase();
      const insights = (llm?.insights || []).join(' ').toLowerCase();
      return text.includes(q) || author.includes(q) || summary.includes(q)
        || fixedTags.includes(q) || keywords.includes(q) || llmTags.includes(q) || insights.includes(q);
    });
  }

  // Filter by tags (check fixedTags, keywords, and llm tags)
  if (filters.tags && filters.tags.length > 0) {
    results = results.filter(post => {
      const det = post.analysis?.deterministic;
      const llm = post.analysis?.llm;
      const allTags = [
        ...(det?.fixedTags || []),
        ...(det?.keywords || []),
        ...(llm?.tags || []),
      ];
      return filters.tags.some(t => allTags.includes(t));
    });
  }

  // Filter by category
  if (filters.category) {
    const cat = filters.category;
    results = results.filter(post => {
      return (post.analysis?.llm?.category || post.analysis?.deterministic?.category) === cat;
    });
  }

  // Sort by extractedAt descending (newest first)
  results.sort((a, b) => {
    const dateA = a.extractedAt || '';
    const dateB = b.extractedAt || '';
    return dateB.localeCompare(dateA);
  });

  return results;
}

export async function getAllTags() {
  const posts = await getAnalyzedPosts();
  const tagCounts = {};
  for (const post of posts) {
    const det = post.analysis?.deterministic;
    const llm = post.analysis?.llm;
    const tags = [...(det?.fixedTags || []), ...(det?.keywords || []), ...(llm?.tags || [])];
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  return Object.entries(tagCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getFixedTags() {
  const posts = await getAnalyzedPosts();
  const counts = {};
  for (const post of posts) {
    for (const tag of (post.analysis?.deterministic?.fixedTags || [])) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export async function getKeywordTags() {
  const posts = await getAnalyzedPosts();
  const counts = {};
  for (const post of posts) {
    for (const tag of (post.analysis?.deterministic?.keywords || [])) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export async function getStats() {
  const allPosts = await getAllPosts();
  const analyzed = allPosts.filter(p => p.analysis);
  const deterministicCount = analyzed.filter(p => p.analysis?.deterministic && !p.analysis?.llm).length;
  const llmCount = analyzed.filter(p => p.analysis?.llm).length;

  const tags = {};
  for (const post of analyzed) {
    const det = post.analysis?.deterministic;
    const llm = post.analysis?.llm;
    const allTags = [...(det?.fixedTags || []), ...(det?.keywords || []), ...(llm?.tags || [])];
    for (const tag of allTags) {
      tags[tag] = (tags[tag] || 0) + 1;
    }
  }
  const topTags = Object.entries(tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  return {
    totalPosts: allPosts.length,
    analyzedPosts: analyzed.length,
    unanalyzedPosts: allPosts.length - analyzed.length,
    deterministicCount,
    llmCount,
    topTags
  };
}

/**
 * Aggregate analysis data into a dashboard-ready insights object.
 * Only meaningful after analysis has run on at least some posts.
 */
export async function getDashboardInsights() {
  const allPosts = await getAllPosts();
  const analyzed = allPosts.filter(p => p.analysis);

  if (analyzed.length === 0) return null;

  // Topic distribution (fixedTags — the meaningful broad categories)
  const topicCounts = {};
  for (const post of analyzed) {
    for (const tag of (post.analysis?.deterministic?.fixedTags || [])) {
      topicCounts[tag] = (topicCounts[tag] || 0) + 1;
    }
  }
  const topicDistribution = Object.entries(topicCounts)
    .map(([name, count]) => ({ name, count, pct: Math.round((count / analyzed.length) * 100) }))
    .sort((a, b) => b.count - a.count);

  // Content type breakdown (category field)
  const typeCounts = {};
  for (const post of analyzed) {
    const cat = post.analysis?.llm?.category || post.analysis?.deterministic?.category || 'uncategorized';
    typeCounts[cat] = (typeCounts[cat] || 0) + 1;
  }
  const contentTypes = Object.entries(typeCounts)
    .map(([name, count]) => ({ name, count, pct: Math.round((count / analyzed.length) * 100) }))
    .sort((a, b) => b.count - a.count);

  // Top authors
  const authorCounts = {};
  for (const post of allPosts) {
    const name = post.author?.name;
    if (name) authorCounts[name] = (authorCounts[name] || 0) + 1;
  }
  const topAuthors = Object.entries(authorCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Engagement distribution
  const engagementProfile = { viral: 0, high: 0, moderate: 0, low: 0 };
  let totalWordCount = 0;
  let postsWithLinks = 0;
  let postsWithMedia = 0;

  for (const post of analyzed) {
    const det = post.analysis?.deterministic;
    if (det?.engagementTier) {
      engagementProfile[det.engagementTier] = (engagementProfile[det.engagementTier] || 0) + 1;
    }
    totalWordCount += det?.wordCount || 0;
    if (det?.hasLinks) postsWithLinks++;
    if (det?.hasMedia) postsWithMedia++;
  }

  return {
    topicDistribution,
    contentTypes,
    topAuthors,
    engagementProfile,
    avgWordCount: Math.round(totalWordCount / analyzed.length),
    postsWithLinks,
    postsWithMedia,
    analyzedCount: analyzed.length,
    totalCount: allPosts.length,
  };
}

export async function getAllPostIds() {
  const { store } = await tx('posts');
  return reqToPromise(store.getAllKeys());
}

export async function postExists(id) {
  const post = await getPost(id);
  return post !== undefined;
}

/**
 * Strip the LLM slot from all analyzed posts so they can be re-enhanced.
 * Deterministic analysis is preserved.
 */
export async function clearLlmAnalysis() {
  const posts = await getAllPosts();
  const { store, transaction } = await tx('posts', 'readwrite');
  for (const post of posts) {
    if (post.analysis?.llm) {
      post.analysis.llm = null;
      store.put(post);
    }
  }
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearAllPosts() {
  const { store, transaction } = await tx('posts', 'readwrite');
  store.clear();
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// ─── Settings & State (chrome.storage.local) ─────────────

const DEFAULT_SETTINGS = {
  llm: {
    provider: 'none',
    apiKey: '',
    baseUrl: '',
    model: ''
  },
  extraction: {
    postLimit: 100,
    delayMin: 5000,
    delayMax: 15000,
    batchSize: 15,
    batchPauseMin: 30000,
    batchPauseMax: 60000
  }
};

const DEFAULT_STATE = {
  status: 'idle',
  totalFound: 0,
  extracted: 0,
  analyzed: 0,
  lastError: null,
  startedAt: null,
  batchId: null,
  seenIds: []
};

export async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  const saved = result.settings || {};
  return {
    llm: { ...DEFAULT_SETTINGS.llm, ...saved.llm },
    extraction: { ...DEFAULT_SETTINGS.extraction, ...saved.extraction },
  };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export async function getExtractionState() {
  const result = await chrome.storage.local.get('extractionState');
  return { ...DEFAULT_STATE, ...result.extractionState };
}

export async function saveExtractionState(state) {
  await chrome.storage.local.set({ extractionState: state });
}

export async function resetExtractionState() {
  await chrome.storage.local.set({ extractionState: DEFAULT_STATE });
}
