/**
 * LinkedLearnings — Analysis Pipeline
 *
 * Two explicit operations:
 *   runDeterministicPipeline — Phase 1. No LLM. Always works.
 *   runLlmPipeline           — Phase 2. Requires configured LLM.
 *   runLlmReanalysis         — Clears LLM data then re-runs Phase 2.
 */

import { buildDeterministicAnalysis, computeRelatedPosts } from './analysis.js';
import { buildBatchAnalysisPrompt, SYSTEM_PROMPT } from './prompts.js';
import { complete } from './llm.js';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Phase 1: Deterministic ────────────────────────────────────

export async function runDeterministicPipeline(db, onProgress, isAborted = () => false) {
  const unanalyzed = await db.getUnanalyzedPosts();

  if (unanalyzed.length === 0) {
    onProgress({ type: 'ANALYSIS_COMPLETE', message: 'All posts already analyzed.' });
    return;
  }

  const alreadyAnalyzed = await db.getAnalyzedPosts();
  const total = unanalyzed.length + alreadyAnalyzed.length;
  let done = alreadyAnalyzed.length;

  onProgress({ type: 'ANALYSIS_PROGRESS', analyzed: done, total, message: `Analyzing ${unanalyzed.length} posts…` });

  for (const post of unanalyzed) {
    if (isAborted()) {
      onProgress({ type: 'ANALYSIS_COMPLETE', analyzed: done, total, message: `Stopped. ${done} posts analyzed.` });
      return;
    }
    post.analysis = { deterministic: buildDeterministicAnalysis(post), llm: null, relatedPostIds: [] };
    await db.putPost(post);
    done++;
    onProgress({ type: 'ANALYSIS_PROGRESS', analyzed: done, total, message: `Analyzed ${done}/${total}…` });
  }

  const allPosts = await db.getAnalyzedPosts();
  const relatedMap = computeRelatedPosts(unanalyzed, allPosts);
  for (const [postId, relatedIds] of relatedMap) {
    const post = await db.getPost(postId);
    if (post?.analysis) { post.analysis.relatedPostIds = relatedIds; await db.putPost(post); }
  }

  onProgress({ type: 'ANALYSIS_COMPLETE', analyzed: done, total, message: `Done! ${done} posts analyzed.` });
}

// ── Phase 2: LLM Enhancement ──────────────────────────────────

export async function runLlmPipeline(db, llmConfig, onProgress, isAborted = () => false) {
  const toLlm = await db.getDetAnalyzedPosts();

  if (toLlm.length === 0) {
    onProgress({ type: 'ANALYSIS_COMPLETE', message: 'No posts to enhance — run Analyze first.' });
    return;
  }

  const total = toLlm.length;
  let done = 0;
  let backoffMs = 4000;
  const BATCH_SIZE = 10;
  const batches = [];
  for (let i = 0; i < toLlm.length; i += BATCH_SIZE) batches.push(toLlm.slice(i, i + BATCH_SIZE));

  onProgress({ type: 'ANALYSIS_PROGRESS', message: `Enhancing ${total} posts with LLM…` });

  for (const batch of batches) {
    if (isAborted()) {
      onProgress({ type: 'ANALYSIS_COMPLETE', message: `Stopped. ${done}/${total} posts enhanced.` });
      return;
    }

    const saved = await runBatch(db, batch, llmConfig, onProgress, isAborted);
    done += saved;
    backoffMs = saved > 0 ? Math.max(4000, backoffMs * 0.85) : backoffMs;
    onProgress({ type: 'ANALYSIS_PROGRESS', message: `LLM enhanced ${done}/${total} posts…` });
    await sleep(backoffMs);
  }

  onProgress({ type: 'ANALYSIS_COMPLETE', message: `LLM enhancement complete! ${done}/${total} posts enhanced.` });
}

async function runBatch(db, batch, llmConfig, onProgress, isAborted) {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (isAborted()) return 0;

    if (attempt > 0) {
      onProgress({ type: 'ANALYSIS_PROGRESS', message: `Rate limit — waiting 60s (retry ${attempt}/${MAX_RETRIES})…` });
      await sleep(60000);
      if (isAborted()) return 0;
      onProgress({ type: 'ANALYSIS_PROGRESS', message: `Retrying batch (attempt ${attempt}/${MAX_RETRIES})…` });
    }

    try {
      const raw = await complete(llmConfig, SYSTEM_PROMPT, buildBatchAnalysisPrompt(batch), 4000);
      let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const arrStart = text.indexOf('[');
      const arrEnd = text.lastIndexOf(']');
      if (arrStart === -1 || arrEnd === -1) throw new Error('No JSON array in response');
      const results = JSON.parse(text.slice(arrStart, arrEnd + 1));

      let saved = 0;
      for (let i = 0; i < batch.length; i++) {
        const post = batch[i];
        const r = results[i];
        if (!r) continue;
        post.analysis.llm = {
          summary:     r.summary || '',
          tags:        r.tags || [],
          category:    r.category || post.analysis.deterministic.category,
          insights:    r.insights || [],
          actionItems: r.actionItems || [],
          tone:        r.tone || post.analysis.deterministic.tone,
          provider:    llmConfig.provider,
          model:       llmConfig.model,
          analyzedAt:  new Date().toISOString(),
        };
        await db.putPost(post);
        saved++;
      }
      return saved;

    } catch (err) {
      console.error(`Batch attempt ${attempt} failed:`, err.message);
      const retryable = err.message?.includes('429') || err.message?.includes('rate')
        || err.message?.includes('500') || err.message?.includes('503')
        || err.message?.includes('timed out');
      if (!retryable || attempt === MAX_RETRIES) {
        console.warn('Skipping batch after failure:', err.message);
        return 0;
      }
    }
  }
  return 0;
}

export async function runLlmReanalysis(db, llmConfig, onProgress, isAborted = () => false) {
  await db.clearLlmAnalysis();
  await runLlmPipeline(db, llmConfig, onProgress, isAborted);
}

