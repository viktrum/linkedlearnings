/**
 * LinkedLearnings — Background Service Worker
 *
 * Orchestrates extraction, manages tabs/tab groups, handles LLM calls,
 * and bridges communication between content scripts and side panel.
 */

import * as db from '../lib/db.js';
import { testConnection as llmTest } from '../lib/llm.js';
import { exportMarkdown, exportJSON } from '../lib/export.js';
import { runDeterministicPipeline, runLlmPipeline, runLlmReanalysis } from '../lib/pipeline.js';

// ─── State ───────────────────────────────────────────────

let extractionPort = null;   // Port to content script
let sidePanelPort = null;    // Port to side panel
let extractionTabId = null;
let extractionGroupId = null;
let analysisAborted = false; // Flag to stop analysis mid-run

// ─── Side Panel Setup ────────────────────────────────────

// Open side panel on extension icon click
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Enable side panel for all tabs
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ─── Port-Based Messaging ────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    sidePanelPort = port;
    port.onMessage.addListener(handleSidePanelMessage);
    port.onDisconnect.addListener(() => {
      sidePanelPort = null;
    });
  }

  if (port.name === 'extractor') {
    extractionPort = port;
    port.onMessage.addListener(handleExtractorMessage);
    port.onDisconnect.addListener(() => {
      extractionPort = null;
      // Content script disconnected — pause extraction
      handleExtractionDisconnect();
    });
  }
});

// ─── Side Panel Message Handler ──────────────────────────

async function handleSidePanelMessage(msg) {
  try {
    switch (msg.type) {
      case 'START_EXTRACTION':
        await startExtraction();
        break;

      case 'PAUSE_EXTRACTION':
        pauseExtraction();
        break;

      case 'RESUME_EXTRACTION':
        await resumeExtraction();
        break;

      case 'STOP_EXTRACTION':
        await stopExtraction();
        break;

      case 'START_ANALYSIS':
        await startAnalysis();
        break;

      case 'START_LLM_ENHANCEMENT':
        await startLlmEnhancement();
        break;

      case 'REANALYZE_LLM':
        await startLlmReanalysis();
        break;

      case 'STOP_ANALYSIS':
        analysisAborted = true;
        sendToSidePanel({ type: 'ANALYSIS_STOPPED' });
        break;

      case 'GET_POSTS':
        const posts = await db.searchPosts(msg.query, msg.filters);
        sendToSidePanel({ type: 'POSTS_RESULT', posts });
        break;

      case 'GET_STATS':
        const stats = await db.getStats();
        const state = await db.getExtractionState();
        sendToSidePanel({ type: 'STATS_RESULT', stats, extractionState: state });
        break;

      case 'SAVE_SETTINGS':
        await db.saveSettings(msg.settings);
        sendToSidePanel({ type: 'SETTINGS_SAVED' });
        break;

      case 'GET_SETTINGS':
        const settings = await db.getSettings();
        sendToSidePanel({ type: 'SETTINGS_RESULT', settings });
        break;

      case 'TEST_LLM':
        const testResult = await testLLMConnection();
        sendToSidePanel({ type: 'LLM_TEST_RESULT', success: testResult.success, error: testResult.error });
        break;

      case 'EXPORT':
        await handleExport(msg.format);
        break;

      case 'GET_ALL_TAGS':
        const tags = await db.getAllTags();
        sendToSidePanel({ type: 'TAGS_RESULT', tags });
        break;

      case 'GET_DASHBOARD_INSIGHTS':
        const insights = await db.getDashboardInsights();
        sendToSidePanel({ type: 'DASHBOARD_INSIGHTS_RESULT', insights });
        break;

      case 'CLEAR_DATA':
        await db.clearAllPosts();
        await db.resetExtractionState();
        sendToSidePanel({ type: 'DATA_CLEARED' });
        break;
    }
  } catch (err) {
    sendToSidePanel({ type: 'ERROR', message: err.message, recoverable: true });
  }
}

// ─── Content Script Message Handler ──────────────────────

async function handleExtractorMessage(msg) {
  switch (msg.type) {
    case 'POSTS_BATCH': {
      const state = await db.getExtractionState();
      const newPosts = [];

      for (const post of msg.posts) {
        if (!state.seenIds.includes(post.id)) {
          state.seenIds.push(post.id);
          newPosts.push(post);
        }
      }

      if (newPosts.length > 0) {
        await db.putPostsBatch(newPosts);
        state.extracted += newPosts.length;
        state.totalFound = state.extracted;
        await db.saveExtractionState(state);
      }

      // Get actual DB total (includes posts from previous runs)
      const stats = await db.getStats();

      sendToSidePanel({
        type: 'PROGRESS',
        status: 'running',
        extracted: state.extracted,
        total: state.totalFound,
        message: `Extracted ${state.extracted} posts...`,
        dbTotal: stats.totalPosts
      });
      break;
    }

    case 'RATE_LIMIT_DETECTED': {
      const state = await db.getExtractionState();
      state.status = 'paused';
      state.lastError = `Rate limit detected: ${msg.signal}`;
      await db.saveExtractionState(state);

      sendToSidePanel({
        type: 'PROGRESS',
        status: 'paused',
        extracted: state.extracted,
        total: state.totalFound,
        message: `LinkedIn detected unusual activity (${msg.signal}). Wait a few minutes and resume.`
      });
      break;
    }

    case 'EXTRACTION_COMPLETE': {
      const state = await db.getExtractionState();
      state.status = 'completed';
      await db.saveExtractionState(state);

      sendToSidePanel({
        type: 'PROGRESS',
        status: 'completed',
        extracted: state.extracted,
        total: state.totalFound,
        message: `Extraction complete! ${state.extracted} posts extracted.`
      });
      break;
    }

    case 'SCROLL_STATUS': {
      // Informational — update side panel
      sendToSidePanel({
        type: 'SCROLL_STATUS',
        ...msg
      });
      break;
    }

    case 'HEARTBEAT': {
      // Content script keepalive — just receiving this keeps the SW alive
      break;
    }

    case 'EXTRACTOR_RECONNECTED': {
      // Content script reconnected after a port drop — it's still scrolling
      console.log('[LL] Extractor reconnected, extraction continuing');
      break;
    }

    case 'VISIT_LINK': {
      // Open a link in a background tab within the same tab group, "read" it, close it.
      // This signals to LinkedIn that the user engaged with the post's link.
      visitLinkInBackground(msg.url);
      break;
    }
  }
}

// ─── Link Visiting ──────────────────────────────────────

/**
 * Open a URL in a background tab inside the LinkedLearnings tab group,
 * wait a human-like duration (simulating reading), then close it.
 * Fire-and-forget — the content script doesn't wait for completion.
 */
async function visitLinkInBackground(url) {
  let linkTabId = null;
  try {
    console.log('[LL] Opening link tab:', url);
    const tab = await chrome.tabs.create({
      url,
      active: false
    });
    linkTabId = tab.id;
    console.log('[LL] Link tab created:', linkTabId);

    // Add to the same tab group if we have one
    if (extractionGroupId) {
      try {
        await chrome.tabs.group({ tabIds: [linkTabId], groupId: extractionGroupId });
      } catch (e) {
        console.warn('[LL] Could not add link tab to group:', e.message);
        // Group might have been closed — create a new one
        try {
          const gid = await chrome.tabs.group({ tabIds: [linkTabId] });
          await chrome.tabGroups.update(gid, { title: 'LinkedLearnings', color: 'green', collapsed: true });
        } catch { /* ok, tab still works ungrouped */ }
      }
    }

    // Brief visit — just enough to register the click
    const readTime = 3000 + Math.random() * 5000;
    await sleep(readTime);

    try { await chrome.tabs.remove(linkTabId); } catch {}
    console.log(`[LL] Visited link: ${url} (${Math.round(readTime / 1000)}s)`);
  } catch (err) {
    console.error('[LL] Failed to visit link:', url, err);
    if (linkTabId) {
      try { await chrome.tabs.remove(linkTabId); } catch {}
    }
  }
}

// ─── Extraction Control ──────────────────────────────────

async function startExtraction() {
  const settings = await db.getSettings();

  // Reset state for new extraction
  const batchId = `batch_${Date.now()}`;
  await db.saveExtractionState({
    status: 'running',
    totalFound: 0,
    extracted: 0,
    analyzed: 0,
    lastError: null,
    startedAt: new Date().toISOString(),
    batchId,
    seenIds: []
  });

  // Create tab for LinkedIn saved posts
  const tab = await chrome.tabs.create({
    url: 'https://www.linkedin.com/my-items/saved-posts/',
    active: true
  });
  extractionTabId = tab.id;

  await ensureTabInGroup(tab.id);

  // The content script will auto-inject (declared in manifest for saved-posts URL)
  // and establish a port connection. Once connected, we send BEGIN_SCROLL.

  // Set up an alarm as a keepalive backup
  chrome.alarms.create('extraction-heartbeat', { periodInMinutes: 1 });

  sendToSidePanel({
    type: 'PROGRESS',
    status: 'running',
    extracted: 0,
    total: 0,
    message: 'Opening LinkedIn saved posts...'
  });

  // Wait a bit for the page to load and content script to connect
  sendBeginScrollDelayed(batchId);
}

/**
 * Build and send BEGIN_SCROLL to the content script after a delay.
 * Includes all existing post IDs so the extractor can skip them.
 */
function sendBeginScrollDelayed(batchId) {
  setTimeout(async () => {
    if (extractionPort) {
      const settings = await db.getSettings();
      const existingIds = await db.getAllPostIds();
      extractionPort.postMessage({
        type: 'BEGIN_SCROLL',
        settings: {
          postLimit: settings.extraction.postLimit,
          delayMin: settings.extraction.delayMin,
          delayMax: settings.extraction.delayMax,
          batchSize: settings.extraction.batchSize,
          batchPauseMin: settings.extraction.batchPauseMin,
          batchPauseMax: settings.extraction.batchPauseMax
        },
        batchId,
        existingIds
      });
    }
  }, 5000);
}

function pauseExtraction() {
  if (extractionPort) {
    extractionPort.postMessage({ type: 'PAUSE_SCROLL' });
  }
  db.getExtractionState().then(state => {
    state.status = 'paused';
    db.saveExtractionState(state);
    sendToSidePanel({
      type: 'PROGRESS',
      status: 'paused',
      extracted: state.extracted,
      total: state.totalFound,
      message: 'Extraction paused.'
    });
  });
}

async function resumeExtraction() {
  const state = await db.getExtractionState();
  if (state.status !== 'paused') return;

  state.status = 'running';
  state.lastError = null;
  await db.saveExtractionState(state);

  // Check if existing tab is still alive
  let tabAlive = false;
  if (extractionTabId) {
    try {
      await chrome.tabs.get(extractionTabId);
      tabAlive = true;
    } catch {
      tabAlive = false;
    }
  }

  if (tabAlive && extractionPort) {
    // Best case — tab and port still alive, just resume scrolling
    console.log('[LL] Resuming on existing tab', extractionTabId);
    extractionPort.postMessage({ type: 'RESUME_SCROLL' });
  } else if (tabAlive && !extractionPort) {
    // Tab exists but port disconnected — navigate back to saved posts and re-inject
    console.log('[LL] Tab alive but port dead — navigating back to saved posts', extractionTabId);
    await chrome.tabs.update(extractionTabId, {
      url: 'https://www.linkedin.com/my-items/saved-posts/',
      active: true
    });
    // Re-add to existing group if it still exists, otherwise create a new one
    await ensureTabInGroup(extractionTabId);
    sendBeginScrollDelayed(state.batchId);
  } else {
    // Tab gone — open a new one but DON'T reset state (keep previously extracted posts)
    console.log('[LL] Tab gone — opening new tab, preserving state');
    const tab = await chrome.tabs.create({
      url: 'https://www.linkedin.com/my-items/saved-posts/',
      active: true
    });
    extractionTabId = tab.id;
    await ensureTabInGroup(tab.id);
    chrome.alarms.create('extraction-heartbeat', { periodInMinutes: 1 });
    sendBeginScrollDelayed(state.batchId);
  }

  sendToSidePanel({
    type: 'PROGRESS',
    status: 'running',
    extracted: state.extracted,
    total: state.totalFound,
    message: `Resuming extraction from ${state.extracted} posts...`
  });
}

async function stopExtraction() {
  // Fully stop and reset to idle — keeps extracted data but resets extraction state
  if (extractionPort) {
    try { extractionPort.postMessage({ type: 'STOP_SCROLL' }); } catch {}
  }

  // Brief wait for content script to flush remaining buffered posts before killing the tab
  await new Promise(r => setTimeout(r, 500));

  // Close the extraction tab if it still exists
  if (extractionTabId) {
    try { await chrome.tabs.remove(extractionTabId); } catch {}
    extractionTabId = null;
  }

  extractionPort = null;
  chrome.alarms.clear('extraction-heartbeat');

  const state = await db.getExtractionState();
  state.status = 'idle';
  state.lastError = null;
  await db.saveExtractionState(state);

  sendToSidePanel({
    type: 'PROGRESS',
    status: 'idle',
    extracted: state.extracted,
    total: state.totalFound,
    message: `Extraction stopped. ${state.extracted} posts saved.`
  });
}

async function handleExtractionDisconnect() {
  const state = await db.getExtractionState();
  if (state.status === 'running') {
    state.status = 'paused';
    state.lastError = 'Extraction tab was closed or disconnected.';
    await db.saveExtractionState(state);

    sendToSidePanel({
      type: 'PROGRESS',
      status: 'paused',
      extracted: state.extracted,
      total: state.totalFound,
      message: 'Extraction paused — tab was closed. You can resume anytime.'
    });
  }
  extractionTabId = null;
  chrome.alarms.clear('extraction-heartbeat');
}

// ─── Tab Lifecycle ───────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === extractionTabId) {
    handleExtractionDisconnect();
  }
});

// If the extraction tab navigates away from the saved posts URL, pause extraction
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== extractionTabId) return;
  if (changeInfo.url && !changeInfo.url.includes('linkedin.com/my-items/saved-posts')) {
    console.warn('[LL] Extraction tab navigated away — pausing extraction');
    handleExtractionDisconnect();
  }
});

/**
 * Ensure the extraction tab is in the LinkedLearnings tab group.
 * Re-uses extractionGroupId if it still exists, otherwise creates a new group.
 */
async function ensureTabInGroup(tabId) {
  try {
    if (extractionGroupId) {
      try {
        await chrome.tabs.group({ tabIds: [tabId], groupId: extractionGroupId });
        return;
      } catch {
        extractionGroupId = null; // group gone, create a new one
      }
    }
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { title: 'LinkedLearnings', color: 'green', collapsed: false });
    extractionGroupId = groupId;
  } catch (e) {
    console.warn('[LL] Could not manage tab group:', e.message);
  }
}

// ─── Alarm Heartbeat ─────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'extraction-heartbeat') {
    const state = await db.getExtractionState();
    if (state.status !== 'running') {
      chrome.alarms.clear('extraction-heartbeat');
    }
    // Just keeping the service worker alive — the alarm firing is enough
  }
});

// ─── Service Worker Recovery ─────────────────────────────

chrome.runtime.onStartup.addListener(async () => {
  const state = await db.getExtractionState();
  if (state.status === 'running') {
    state.status = 'paused';
    state.lastError = 'Browser was restarted. Resume extraction to continue.';
    await db.saveExtractionState(state);
  }
});

// Also handle install/update
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Initialize default settings
    await db.saveSettings(await db.getSettings());
  }
});

// ─── Analysis ────────────────────────────────────────────

async function startAnalysis() {
  analysisAborted = false;
  await runDeterministicPipeline(db, (msg) => sendToSidePanel(msg), () => analysisAborted);
}

async function startLlmEnhancement() {
  analysisAborted = false;
  const settings = await db.getSettings();
  await runLlmPipeline(db, settings.llm, (msg) => sendToSidePanel(msg), () => analysisAborted);
}

async function startLlmReanalysis() {
  analysisAborted = false;
  const settings = await db.getSettings();
  await runLlmReanalysis(db, settings.llm, (msg) => sendToSidePanel(msg), () => analysisAborted);
}

async function testLLMConnection() {
  try {
    const settings = await db.getSettings();
    const result = await llmTest(settings.llm);
    return { success: result, error: null };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Export ──────────────────────────────────────────────

async function handleExport(format) {
  const posts = await db.getAllPosts();
  let content, filename, mimeType;

  if (format === 'markdown') {
    content = exportMarkdown(posts);
    filename = `linkedlearnings-${dateStamp()}.md`;
    mimeType = 'text/markdown';
  } else {
    content = exportJSON(posts);
    filename = `linkedlearnings-${dateStamp()}.json`;
    mimeType = 'application/json';
  }

  // Send the export data to the side panel for download
  // (Service workers can't trigger downloads directly — need a page context)
  sendToSidePanel({ type: 'EXPORT_READY', content, filename, mimeType });
}

function dateStamp() {
  return new Date().toISOString().split('T')[0];
}

// ─── Utilities ───────────────────────────────────────────

function sendToSidePanel(msg) {
  if (sidePanelPort) {
    try {
      sidePanelPort.postMessage(msg);
    } catch {
      // Port disconnected
      sidePanelPort = null;
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
