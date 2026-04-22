/**
 * LinkedLearnings — Side Panel Application
 *
 * Vanilla JS, single-file. Reactive state → view renderers.
 * Smart routing: has posts → Knowledge, no posts → Dashboard.
 */

// ─── State ────────────────────────────────────────────────────

const state = {
  currentView: 'dashboard',
  viewParams: {},
  stats: { totalPosts: 0, analyzedPosts: 0, unanalyzedPosts: 0, topTags: [] },
  extractionState: { status: 'idle', extracted: 0, totalFound: 0, lastError: null },
  progressMessage: '',
  analysisMessage: '',
  posts: [],
  searchQuery: '',
  activeTagFilter: null,
  settings: null,
  selectedPostId: null,
  dashboardInsights: null,
  initialRouted: false,         // only smart-route once per session
  insightsExpanded: true,       // collapse during active extraction
};

// ─── Port Connection ──────────────────────────────────────────

let port = null;

function connectPort() {
  port = chrome.runtime.connect({ name: 'sidepanel' });

  port.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'PROGRESS':
        state.extractionState.status = msg.status;
        state.extractionState.extracted = msg.extracted;
        state.extractionState.totalFound = msg.total;
        state.progressMessage = msg.message;
        if (msg.dbTotal != null) {
          state.stats.totalPosts = msg.dbTotal;
          state.stats.unanalyzedPosts = Math.max(0, msg.dbTotal - state.stats.analyzedPosts);
        }
        renderExtractionBanner();
        if (state.currentView === 'dashboard') renderDashboard();
        break;

      case 'ANALYSIS_PROGRESS':
        if (msg.analyzed != null) state.stats.analyzedPosts = msg.analyzed;
        state.analysisMessage = msg.message;
        if (state.currentView === 'dashboard') renderDashboard();
        break;

      case 'ANALYSIS_STOPPED':
        state.analysisMessage = '';
        send({ type: 'GET_STATS' });
        send({ type: 'GET_DASHBOARD_INSIGHTS' });
        if (state.currentView === 'dashboard') renderDashboard();
        break;

      case 'ANALYSIS_COMPLETE':
        state.analysisMessage = '';
        const wasStopped = msg.message?.toLowerCase().includes('stopped');
        showToast(msg.message || 'Analysis complete', wasStopped ? 'info' : 'success');
        send({ type: 'GET_STATS' });
        send({ type: 'GET_DASHBOARD_INSIGHTS' });
        if (state.currentView === 'dashboard') renderDashboard();
        if (state.currentView === 'knowledge') send({ type: 'GET_POSTS', query: state.searchQuery, filters: {} });
        break;

      case 'STATS_RESULT':
        state.stats = msg.stats;
        // Merge rather than replace — preserves live PROGRESS state (status, extracted, totalFound)
        // that may already be more up-to-date than the DB-persisted snapshot.
        state.extractionState = { ...msg.extractionState, ...state.extractionState,
          // Always take the DB values for fields PROGRESS doesn't set
          lastError: msg.extractionState.lastError
        };
        renderExtractionBanner();
        if (state.currentView === 'dashboard') renderDashboard();
        // No smart routing — user always starts on Dashboard
        break;

      case 'POSTS_RESULT':
        state.posts = msg.posts;
        if (state.currentView === 'knowledge') renderKnowledge();
        break;

      case 'SETTINGS_RESULT':
        state.settings = msg.settings;
        if (state.currentView === 'settings') renderSettings();
        break;

      case 'SETTINGS_SAVED':
        showToast('Settings saved', 'success');
        break;

      case 'LLM_TEST_RESULT':
        if (msg.success) showToast('LLM connection successful!', 'success');
        else showToast(`Connection failed: ${msg.error}`, 'error');
        break;

      case 'EXPORT_READY':
        downloadBlob(msg.content, msg.filename, msg.mimeType);
        showToast(`Exported ${msg.filename}`, 'success');
        break;

      case 'DASHBOARD_INSIGHTS_RESULT':
        state.dashboardInsights = msg.insights;
        if (state.currentView === 'dashboard') renderDashboard();
        break;

      case 'TAGS_RESULT':
        if (state.currentView === 'knowledge') renderTagFilters(msg.tags);
        break;

      case 'DATA_CLEARED':
        state.stats = { totalPosts: 0, analyzedPosts: 0, unanalyzedPosts: 0, topTags: [] };
        state.posts = [];
        state.dashboardInsights = null;
        state.initialRouted = false;
        showToast('All data cleared', 'info');
        navigate('dashboard');
        renderExtractionBanner();
        break;

      case 'ERROR':
        showToast(msg.message, 'error');
        break;

      case 'SCROLL_STATUS':
        state.progressMessage = msg.message;
        renderExtractionBanner();
        if (state.currentView === 'dashboard') renderDashboard();
        break;
    }
  });

  port.onDisconnect.addListener(() => setTimeout(connectPort, 1000));
}

function send(msg) {
  if (port) try { port.postMessage(msg); } catch {}
}

// ─── Navigation ───────────────────────────────────────────────

function navigate(view, params = {}) {
  state.currentView = view;
  state.viewParams = params;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  renderCurrentView();
}

function renderCurrentView() {
  switch (state.currentView) {
    case 'dashboard':   renderDashboard();   break;
    case 'knowledge':   renderKnowledge();   break;
    case 'settings':    renderSettings();    break;
    case 'post-detail': renderPostDetail();  break;
  }
}

// ─── Extraction Banner (persistent, outside scroll) ───────────

function renderExtractionBanner() {
  const el = document.getElementById('extraction-banner');
  if (!el) return;

  const ex = state.extractionState;
  const isActive = ex.status === 'running' || ex.status === 'paused';

  if (!isActive) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  el.style.display = 'block';

  const count = ex.extracted || 0;
  const timeEst = estimateExtractionTime(state.settings);
  const isPaused = ex.status === 'paused';

  el.innerHTML = `
    <div class="extraction-banner">
      <div class="extraction-banner-top">
        <div class="extraction-pulse ${isPaused ? 'paused' : ''}"></div>
        <span class="extraction-banner-label">${isPaused ? 'Extraction paused' : 'Extracting posts…'}</span>
        <span class="extraction-banner-count">${count} saved</span>
      </div>
      <div class="extraction-progress-track">
        <div class="extraction-progress-fill ${isPaused ? '' : 'running'}"
          style="width: ${count > 0 ? Math.min(100, (count / (state.settings?.extraction?.postLimit || 100)) * 100) : 3}%">
        </div>
      </div>
      <div class="extraction-banner-meta">
        <span class="extraction-time-estimate">${timeEst}</span>
        ${!isPaused ? `<span class="continue-nudge">✦ Keep working — this runs in the background</span>` : ''}
      </div>
    </div>
  `;
}

/**
 * Estimate how long extraction will take based on settings.
 * avg delay + batch pauses, expressed as a range.
 */
function estimateExtractionTime(settings) {
  if (!settings) return '';
  const ext = settings.extraction || {};
  const limit = ext.postLimit || 100;
  const avgDelay = ((ext.delayMin || 5000) + (ext.delayMax || 15000)) / 2 / 1000; // seconds
  const batchSize = ext.batchSize || 10;
  const avgPause = ((ext.batchPauseMin || 15000) + (ext.batchPauseMax || 45000)) / 2 / 1000;
  const batches = Math.ceil(limit / batchSize);
  const totalSec = limit * avgDelay + batches * avgPause;
  const minSec = limit * (ext.delayMin || 5000) / 1000;
  const maxSec = limit * (ext.delayMax || 15000) / 1000 + batches * (ext.batchPauseMax || 45000) / 1000;

  const fmtMin = (s) => {
    const m = Math.round(s / 60);
    return m < 1 ? '<1 min' : `~${m} min`;
  };

  const already = state.extractionState.extracted || 0;
  const remaining = Math.max(0, limit - already);
  if (remaining === 0) return 'Almost done…';

  const remainSec = (remaining / limit) * totalSec;
  return `${fmtMin(remainSec)} remaining for ${remaining} posts`;
}

// ─── Dashboard View ───────────────────────────────────────────

function renderDashboard() {
  const main = document.getElementById('app-content');
  const s = state.stats;
  const ex = state.extractionState;
  const ins = state.dashboardInsights;

  const isActive = ex.status === 'running' || ex.status === 'paused';
  const hasAnalysis = s.analyzedPosts > 0;
  const hasPosts = s.totalPosts > 0;

  const statusClass = ex.status || 'idle';
  const statusLabel = { idle: 'Ready', running: 'Extracting', paused: 'Paused', completed: 'Done', error: 'Error' }[statusClass] || 'Ready';

  main.innerHTML = `
    <div class="status-badge ${statusClass}">
      <span class="status-dot"></span>${statusLabel}
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">${s.totalPosts}</div>
        <div class="stat-label">Posts</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${s.analyzedPosts}</div>
        <div class="stat-label">Analyzed</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${ins?.topicDistribution?.length || 0}</div>
        <div class="stat-label">Topics</div>
      </div>
    </div>

    ${state.analysisMessage ? `
      <div class="analysis-progress-banner">
        <span class="analysis-spinner"></span>
        <span class="analysis-progress-text">${escapeHtml(state.analysisMessage)}</span>
        <button class="btn btn-danger-outline btn-sm" id="btn-stop-analysis">Stop</button>
      </div>
    ` : ''}

    ${ex.lastError ? `<div class="banner banner-error">${escapeHtml(ex.lastError)}</div>` : ''}

    <div class="btn-row" style="margin-top: 0">
      ${!isActive ? `
        <button class="btn btn-primary btn-block" id="btn-extract">
          ${hasPosts ? 'Extract More' : 'Start Extraction'}
        </button>
      ` : ''}
      ${ex.status === 'running' ? `
        <button class="btn btn-secondary" id="btn-pause">Pause</button>
        <button class="btn btn-danger-outline" id="btn-stop">Stop</button>
      ` : ''}
      ${ex.status === 'paused' ? `
        <button class="btn btn-primary" id="btn-resume">Resume</button>
        <button class="btn btn-danger-outline" id="btn-stop">Stop</button>
      ` : ''}
    </div>

    ${renderAnalyzeCTA(s, isActive, state.settings)}

    ${hasPosts ? `
      <div class="export-row">
        <button class="btn btn-secondary btn-sm" id="btn-export-md">↓ Export .md</button>
        ${hasAnalysis ? `<button class="btn btn-secondary btn-sm" id="btn-export-json">↓ Export .json</button>` : ''}
      </div>
    ` : ''}

    ${hasAnalysis && ins ? renderInsightsSection(ins, isActive) : ''}

    ${!hasPosts && !isActive ? `
      <div class="divider"></div>
      <div class="empty-state">
        <div class="empty-icon">&#128218;</div>
        <div class="empty-title">No posts yet</div>
        <div class="empty-sub">Click <strong>Start Extraction</strong> and we'll pull your LinkedIn saved posts automatically.</div>
      </div>
    ` : ''}
  `;

  // Events
  main.querySelector('#btn-extract')?.addEventListener('click', () => {
    send({ type: 'START_EXTRACTION' });
    state.insightsExpanded = false; // collapse insights while new extraction starts
  });
  main.querySelector('#btn-pause')?.addEventListener('click', () => send({ type: 'PAUSE_EXTRACTION' }));
  main.querySelector('#btn-resume')?.addEventListener('click', () => send({ type: 'RESUME_EXTRACTION' }));
  main.querySelector('#btn-stop')?.addEventListener('click', () => {
    send({ type: 'STOP_EXTRACTION' });
    state.insightsExpanded = true;
  });
  main.querySelector('#btn-analyze')?.addEventListener('click', () => send({ type: 'START_ANALYSIS' }));
  main.querySelector('#btn-enhance-llm')?.addEventListener('click', () => send({ type: 'START_LLM_ENHANCEMENT' }));
  main.querySelector('#btn-reanalyze-llm')?.addEventListener('click', () => {
    if (confirm('Re-run LLM analysis on all posts? Existing LLM results will be replaced.')) {
      send({ type: 'REANALYZE_LLM' });
    }
  });
  main.querySelector('#btn-stop-analysis')?.addEventListener('click', () => send({ type: 'STOP_ANALYSIS' }));
  main.querySelector('#btn-go-settings')?.addEventListener('click', () => navigate('settings'));
  main.querySelector('#btn-export-md')?.addEventListener('click', () => send({ type: 'EXPORT', format: 'markdown' }));
  main.querySelector('#btn-export-json')?.addEventListener('click', () => send({ type: 'EXPORT', format: 'json' }));
  main.querySelector('#btn-reanalyze-llm')?.addEventListener('click', () => {
    if (confirm('Re-run LLM analysis on all posts? Existing LLM results will be replaced.')) {
      send({ type: 'REANALYZE_LLM' });
    }
  });

  // Insights strip toggle
  main.querySelector('#insights-strip')?.addEventListener('click', () => {
    state.insightsExpanded = !state.insightsExpanded;
    renderDashboard();
  });

  // Topic bar → filter knowledge view
  main.querySelectorAll('.dist-bar-row[data-tag]').forEach(el => {
    el.addEventListener('click', () => {
      state.activeTagFilter = el.dataset.tag;
      navigate('knowledge');
    });
  });

  // Author → search knowledge view
  main.querySelectorAll('.author-row[data-author]').forEach(el => {
    el.addEventListener('click', () => {
      state.searchQuery = el.dataset.author;
      state.activeTagFilter = null;
      navigate('knowledge');
    });
  });
}

function renderInsightsSection(ins, isActive) {
  // During active extraction: show a collapsed summary strip
  if (isActive) {
    const topTopics = ins.topicDistribution.slice(0, 3).map(t => t.name).join(', ');
    const expanded = state.insightsExpanded;
    return `
      <div class="divider"></div>
      <div class="insights-strip" id="insights-strip">
        <span class="insights-strip-icon">&#9723;</span>
        <div class="insights-strip-text">
          <div class="insights-strip-title">Previous analysis</div>
          <div class="insights-strip-sub">${ins.analyzedCount} posts · ${topTopics || 'No topics yet'}</div>
        </div>
        <span class="insights-strip-chevron">${expanded ? '▲' : '▼'}</span>
      </div>
      ${expanded ? renderInsightsBody(ins) : ''}
    `;
  }

  return `<div class="divider"></div>${renderInsightsBody(ins)}`;
}

function renderInsightsBody(ins) {
  const maxTopicCount = ins.topicDistribution[0]?.count || 1;

  return `
    ${ins.topicDistribution.length > 0 ? `
      <div class="section-label">What You Save About</div>
      <div class="dist-chart">
        ${ins.topicDistribution.slice(0, 6).map(t => `
          <div class="dist-bar-row clickable" data-tag="${escapeHtml(t.name)}">
            <div class="dist-label">${escapeHtml(t.name)}</div>
            <div class="dist-track">
              <div class="dist-fill" style="width: ${Math.max(4, (t.count / maxTopicCount) * 100)}%"></div>
            </div>
            <div class="dist-count">${t.count}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${ins.contentTypes.length > 1 ? `
      <div class="section-label" style="margin-top: var(--space-5)">Content Mix</div>
      <div class="content-mix">
        ${ins.contentTypes.map(ct => `
          <div class="mix-chip">
            <span class="mix-label">${escapeHtml(formatCategoryLabel(ct.name))}</span>
            <span class="mix-count">${ct.pct}%</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${ins.topAuthors.length > 0 ? `
      <div class="section-label" style="margin-top: var(--space-5)">Saved Most From</div>
      <div class="author-list">
        ${ins.topAuthors.map((a, i) => `
          <div class="author-row clickable" data-author="${escapeHtml(a.name)}">
            <span class="author-rank">${i + 1}</span>
            <span class="author-name">${escapeHtml(a.name)}</span>
            <span class="author-count">${a.count} post${a.count !== 1 ? 's' : ''}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="section-label" style="margin-top: var(--space-5)">At a Glance</div>
    <div class="glance-grid">
      <div class="glance-item">
        <div class="glance-value">${ins.avgWordCount}</div>
        <div class="glance-label">Avg words</div>
      </div>
      <div class="glance-item">
        <div class="glance-value">${ins.postsWithLinks}</div>
        <div class="glance-label">With links</div>
      </div>
      <div class="glance-item">
        <div class="glance-value">${ins.postsWithMedia}</div>
        <div class="glance-label">With media</div>
      </div>
      <div class="glance-item">
        <div class="glance-value">${(ins.engagementProfile?.viral || 0) + (ins.engagementProfile?.high || 0)}</div>
        <div class="glance-label">High engagement</div>
      </div>
    </div>
  `;
}

function formatCategoryLabel(cat) {
  return { 'how-to': 'How-To', 'personal-story': 'Story', 'thought-leadership': 'Opinion', 'resource': 'Resource', 'announcement': 'News', 'hiring': 'Hiring', 'uncategorized': 'Other' }[cat]
    || cat.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// ─── Knowledge Base View ──────────────────────────────────────

function renderKnowledge() {
  const main = document.getElementById('app-content');

  if (state.posts.length === 0 && state.stats.totalPosts > 0) {
    send({ type: 'GET_POSTS', query: state.searchQuery, filters: {} });
    main.innerHTML = `<div class="empty-state"><div class="empty-icon">⋯</div><div class="empty-sub">Loading posts…</div></div>`;
    return;
  }

  let filtered = state.posts;
  if (state.activeTagFilter) {
    filtered = filtered.filter(p => {
      const det = p.analysis?.deterministic;
      const llm = p.analysis?.llm;
      return [...(det?.fixedTags || []), ...(det?.keywords || []), ...(llm?.tags || [])]
        .includes(state.activeTagFilter);
    });
  }

  main.innerHTML = `
    <div class="search-container">
      <input type="text" class="search-input" id="search-input"
        placeholder="Search posts, topics, authors…"
        value="${escapeHtml(state.searchQuery)}" autocomplete="off">
    </div>

    <div class="filter-tags" id="filter-tags">
      ${state.activeTagFilter ? `
        <button class="filter-tag active" data-tag="${escapeHtml(state.activeTagFilter)}">
          ${escapeHtml(state.activeTagFilter)} ×
        </button>
      ` : ''}
    </div>

    <div class="posts-count">${filtered.length} post${filtered.length !== 1 ? 's' : ''}</div>

    <div id="posts-list">
      ${filtered.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">&#9697;</div>
          <div class="empty-sub">${state.searchQuery ? 'No posts match your search.' : 'No posts yet — extract some first.'}</div>
        </div>
      ` : filtered.map(renderPostCard).join('')}
    </div>
  `;

  const searchInput = main.querySelector('#search-input');
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value;
      send({ type: 'GET_POSTS', query: state.searchQuery, filters: {} });
    }, 280);
  });
  // Only auto-focus when the user explicitly navigated here, not on every POSTS_RESULT re-render
  if (state.viewParams?.focusSearch) searchInput.focus();

  main.querySelector('.filter-tag.active')?.addEventListener('click', () => {
    state.activeTagFilter = null;
    send({ type: 'GET_POSTS', query: state.searchQuery, filters: {} });
  });

  main.querySelectorAll('.post-card').forEach(card => {
    card.addEventListener('click', () => {
      state.selectedPostId = card.dataset.id;
      navigate('post-detail');
    });
  });

  send({ type: 'GET_ALL_TAGS' });
}

function renderTagFilters(tags) {
  const container = document.getElementById('filter-tags');
  if (!container) return;

  const existing = state.activeTagFilter;
  const otherTags = tags.filter(t => t.name !== existing).slice(0, 8);

  let html = existing ? `<button class="filter-tag active" data-tag="${escapeHtml(existing)}">${escapeHtml(existing)} ×</button>` : '';
  html += otherTags.map(t => `<button class="filter-tag" data-tag="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>`).join('');
  container.innerHTML = html;

  container.querySelectorAll('.filter-tag').forEach(el => {
    el.addEventListener('click', () => {
      state.activeTagFilter = el.classList.contains('active') ? null : el.dataset.tag;
      send({ type: 'GET_POSTS', query: state.searchQuery, filters: {} });
    });
  });
}

function renderPostCard(post) {
  const det = post.analysis?.deterministic;
  const llm = post.analysis?.llm;
  const summary = llm?.summary || det?.summary || '';
  const displayText = summary || truncate(post.textContent, 140);
  const fixedTags = (det?.fixedTags || []).slice(0, 2);
  const keywords = (det?.keywords || []).slice(0, 3);
  const isAnalyzed = !!(det || llm);

  return `
    <div class="post-card${isAnalyzed ? ' analyzed' : ''}" data-id="${escapeHtml(post.id)}">
      <div class="post-author">${escapeHtml(post.author?.name || 'Unknown')}</div>
      ${post.author?.headline ? `<div class="post-headline">${escapeHtml(post.author.headline)}</div>` : ''}
      <div class="post-excerpt">${escapeHtml(displayText)}</div>
      ${(fixedTags.length || keywords.length) ? `
        <div class="post-tags">
          ${fixedTags.map(t => `<span class="tag tag-fixed">${escapeHtml(t)}</span>`).join('')}
          ${keywords.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
          ${llm ? `<span class="tag tag-llm">✦ LLM</span>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

// ─── Post Detail View ─────────────────────────────────────────

function renderPostDetail() {
  const main = document.getElementById('app-content');
  const post = state.posts.find(p => p.id === state.selectedPostId);

  if (!post) {
    main.innerHTML = `<div class="empty-state"><div class="empty-sub">Post not found.</div></div>`;
    return;
  }

  const det = post.analysis?.deterministic;
  const llm = post.analysis?.llm;
  const summary = llm?.summary || det?.summary || '';
  const fixedTags = det?.fixedTags || [];
  const keywords = det?.keywords || [];
  const insights = llm?.insights || [];
  const actionItems = llm?.actionItems || [];
  const relatedIds = post.analysis?.relatedPostIds || [];

  main.innerHTML = `
    <button class="back-btn" id="btn-back">← Back to Knowledge</button>

    <div class="post-detail-card">
      <div class="post-detail-header">
        <div class="post-detail-author">${escapeHtml(post.author?.name || 'Unknown')}</div>
        ${post.author?.headline ? `<div class="post-detail-headline">${escapeHtml(post.author.headline)}</div>` : ''}
      </div>

      ${det || llm ? `
        ${summary ? `
          <div class="post-detail-section">
            <div class="post-detail-section-label">Summary</div>
            <div class="post-detail-summary">${escapeHtml(summary)}</div>
          </div>
        ` : ''}

        ${(fixedTags.length || keywords.length) ? `
          <div class="post-detail-section">
            <div class="post-tags">
              ${fixedTags.map(t => `<span class="tag tag-fixed">${escapeHtml(t)}</span>`).join('')}
              ${keywords.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
              ${llm ? `<span class="tag tag-llm">✦ LLM</span>` : ''}
            </div>
          </div>
        ` : ''}

        ${insights.length ? `
          <div class="post-detail-section">
            <div class="post-detail-section-label">Key Insights</div>
            <ul class="insight-list">
              ${insights.map(i => `<li>${escapeHtml(i)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${actionItems.length ? `
          <div class="post-detail-section">
            <div class="post-detail-section-label">Action Items</div>
            <ul class="action-list">
              ${actionItems.map(i => `<li>${escapeHtml(i)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${relatedIds.length ? `
          <div class="post-detail-section">
            <div class="post-detail-section-label">Related Posts</div>
            ${relatedIds.map(id => {
              const rel = state.posts.find(p => p.id === id);
              if (!rel) return '';
              const relSummary = rel.analysis?.llm?.summary || rel.analysis?.deterministic?.summary || truncate(rel.textContent, 60);
              return `<a class="related-post-link" data-id="${escapeHtml(id)}">${escapeHtml(rel.author?.name || 'Unknown')} — ${escapeHtml(relSummary)}</a>`;
            }).filter(Boolean).join('')}
          </div>
        ` : ''}
      ` : `
        <div class="post-detail-section">
          <div class="banner banner-warning">This post hasn't been analyzed yet. Run analysis from the Dashboard.</div>
        </div>
      `}

      <div class="post-detail-section">
        <div class="post-detail-section-label">Original Post</div>
        <div class="post-body-text">${escapeHtml(post.textContent || 'No content')}</div>
      </div>

      ${post.links?.length ? `
        <div class="post-detail-section">
          <div class="post-detail-section-label">Links</div>
          ${post.links.map(l => `
            <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener"
              style="display:block; font-size:var(--text-xs); color:var(--color-accent); margin-bottom:4px; word-break:break-all; line-height:1.5">
              ${escapeHtml(l.title || l.url)}
            </a>
          `).join('')}
        </div>
      ` : ''}

      ${post.postUrl ? `
        <div class="post-detail-section">
          <a href="${escapeHtml(post.postUrl)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">
            View on LinkedIn →
          </a>
        </div>
      ` : ''}
    </div>
  `;

  main.querySelector('#btn-back').addEventListener('click', () => navigate('knowledge'));
  main.querySelectorAll('.related-post-link').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedPostId = el.dataset.id;
      navigate('post-detail');
    });
  });
}

// ─── Settings View ────────────────────────────────────────────

function renderSettings() {
  const main = document.getElementById('app-content');

  if (!state.settings) {
    send({ type: 'GET_SETTINGS' });
    main.innerHTML = `<div class="empty-state"><div class="empty-sub">Loading…</div></div>`;
    return;
  }

  const s = state.settings;
  const llm = s.llm || {};
  const ext = s.extraction || {};

  main.innerHTML = `
    <div class="settings-section-title">Settings</div>

    <div class="settings-group">
      <div class="settings-group-label">Extraction</div>
      <div class="form-field">
        <label class="form-label" for="ext-limit">Post limit</label>
        <input type="number" class="form-input" id="ext-limit" value="${ext.postLimit || 100}" min="10" max="2000">
        <div class="form-hint">Maximum posts per extraction session.</div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="form-label" for="ext-delay-min">Min delay (sec)</label>
          <input type="number" class="form-input" id="ext-delay-min" value="${(ext.delayMin || 5000) / 1000}" min="2" max="60">
        </div>
        <div class="form-field">
          <label class="form-label" for="ext-delay-max">Max delay (sec)</label>
          <input type="number" class="form-input" id="ext-delay-max" value="${(ext.delayMax || 15000) / 1000}" min="5" max="120">
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="settings-group">
      <div class="settings-group-label">Data</div>
      <div class="btn-row-sm" style="margin-bottom: var(--space-3)">
        <button class="btn btn-secondary btn-sm" id="btn-export-md">↓ Export Markdown</button>
        <button class="btn btn-secondary btn-sm" id="btn-export-json">↓ Export JSON</button>
      </div>
      <button class="btn btn-danger btn-sm" id="btn-clear">Clear All Data</button>
    </div>

    <div class="divider"></div>

    <div class="settings-group">
      <div class="settings-group-label">LLM Provider <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--color-text-tertiary)">— optional, for richer analysis</span></div>
      <div class="form-field">
        <label class="form-label" for="llm-provider">Provider</label>
        <select class="form-select" id="llm-provider">
          <option value="none"      ${llm.provider === 'none'      ? 'selected' : ''}>None (deterministic only)</option>
          <option value="openai"    ${llm.provider === 'openai'    ? 'selected' : ''}>OpenAI</option>
          <option value="anthropic" ${llm.provider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
          <option value="groq"      ${llm.provider === 'groq'      ? 'selected' : ''}>Groq</option>
          <option value="ollama"    ${llm.provider === 'ollama'    ? 'selected' : ''}>Ollama (local)</option>
          <option value="custom"    ${llm.provider === 'custom'    ? 'selected' : ''}>Custom / OpenRouter</option>
        </select>
      </div>

      <div id="llm-config" ${llm.provider === 'none' ? 'style="display:none"' : ''}>
        <div class="form-field" id="apikey-group" ${llm.provider === 'ollama' ? 'style="display:none"' : ''}>
          <label class="form-label" for="llm-apikey">API Key</label>
          <input type="password" class="form-input" id="llm-apikey" value="${escapeHtml(llm.apiKey || '')}" placeholder="sk-…">
          <div class="form-hint">Stored locally. Never shared except with your chosen provider.</div>
        </div>

        <div class="form-field" id="baseurl-group" ${['ollama', 'custom'].includes(llm.provider) ? '' : 'style="display:none"'}>
          <label class="form-label" for="llm-baseurl">Base URL</label>
          <input type="text" class="form-input" id="llm-baseurl"
            value="${escapeHtml(llm.baseUrl || (llm.provider === 'ollama' ? 'http://localhost:11434/api' : 'https://openrouter.ai/api/v1'))}">
        </div>

        <div class="form-field">
          <label class="form-label" for="llm-model">Model</label>
          <input type="text" class="form-input" id="llm-model" value="${escapeHtml(llm.model || '')}"
            placeholder="${getModelPlaceholder(llm.provider)}">
          <div class="form-hint" id="model-hint">${llm.provider === 'custom'
            ? getFreeModelsHint()
            : 'Leave blank for the default model.'
          }</div>
        </div>

        ${llm.provider && llm.provider !== 'none' && llm.provider !== 'ollama' ? `
          <div class="banner banner-warning" style="margin-top:0">
            Post content is sent to ${providerLabel(llm.provider)} for analysis. For full privacy, use Ollama (local).
          </div>
        ` : ''}

        <button class="btn btn-secondary btn-sm" id="btn-test-llm">Test Connection</button>
      </div>
    </div>

    <div style="height: var(--space-4)"></div>
    <button class="btn btn-primary btn-block" id="btn-save-settings">Save Settings</button>
    <div style="height: var(--space-12)"></div>
  `;

  // Provider visibility + auto-fill base URL for known providers
  main.querySelector('#llm-provider').addEventListener('change', (e) => {
    const p = e.target.value;
    main.querySelector('#llm-config').style.display   = p === 'none' ? 'none' : '';
    main.querySelector('#apikey-group').style.display  = p === 'ollama' ? 'none' : '';
    main.querySelector('#baseurl-group').style.display = ['ollama','custom'].includes(p) ? '' : 'none';
    main.querySelector('#llm-model').placeholder = getModelPlaceholder(p);

    // Auto-fill base URL when switching to a known provider
    const baseurlInput = main.querySelector('#llm-baseurl');
    const knownUrls = {
      ollama: 'http://localhost:11434/api',
      custom: 'https://openrouter.ai/api/v1',
    };
    if (knownUrls[p]) baseurlInput.value = knownUrls[p];

    // Update model hint for free OpenRouter models
    const modelHint = main.querySelector('#model-hint');
    if (modelHint) {
      modelHint.innerHTML = p === 'custom' ? getFreeModelsHint() : 'Leave blank for the default model.';
      if (p === 'custom') bindModelHintClicks(main);
    }
  });

  main.querySelector('#btn-save-settings').addEventListener('click', () => {
    const newSettings = {
      llm: {
        provider: main.querySelector('#llm-provider').value,
        apiKey:   main.querySelector('#llm-apikey')?.value   || '',
        baseUrl:  main.querySelector('#llm-baseurl')?.value  || '',
        model:    main.querySelector('#llm-model').value
      },
      extraction: {
        postLimit:     parseInt(main.querySelector('#ext-limit').value, 10) || 100,
        delayMin:      (parseFloat(main.querySelector('#ext-delay-min').value) || 5) * 1000,
        delayMax:      (parseFloat(main.querySelector('#ext-delay-max').value) || 15) * 1000,
        batchSize:     ext.batchSize     || 10,
        batchPauseMin: ext.batchPauseMin || 15000,
        batchPauseMax: ext.batchPauseMax || 45000
      }
    };
    state.settings = newSettings;
    send({ type: 'SAVE_SETTINGS', settings: newSettings });
  });

  main.querySelector('#btn-test-llm')?.addEventListener('click', () => {
    main.querySelector('#btn-save-settings').click();
    setTimeout(() => send({ type: 'TEST_LLM' }), 500);
  });

  main.querySelector('#btn-export-md').addEventListener('click', () => send({ type: 'EXPORT', format: 'markdown' }));
  main.querySelector('#btn-export-json').addEventListener('click', () => send({ type: 'EXPORT', format: 'json' }));

  // Click any free model chip → fill the model input
  if (llm.provider === 'custom') bindModelHintClicks(main);

  main.querySelector('#btn-clear').addEventListener('click', () => {
    if (confirm('Delete all posts and analysis? This cannot be undone.')) send({ type: 'CLEAR_DATA' });
  });
}

// ─── Analyze CTA ─────────────────────────────────────────────

function renderAnalyzeCTA(s, isActive, settings) {
  const hasLLM = settings?.llm?.provider && settings.llm.provider !== 'none';
  const model = settings?.llm?.model || settings?.llm?.provider || '';
  const unanalyzed = s.unanalyzedPosts > 0;
  const hasDetOnly = (s.deterministicCount || 0) > 0; // posts with det analysis but no LLM yet

  if (isActive) {
    return unanalyzed ? `
      <div class="banner banner-info" style="margin-top: var(--space-3)">
        <span>&#9711;</span>
        <span>${s.unanalyzedPosts} posts queued for analysis after extraction.</span>
      </div>` : '';
  }

  const parts = [];

  // Primary: Analyze (deterministic)
  if (unanalyzed) {
    parts.push(`
      <div class="analyze-cta">
        <div class="analyze-cta-text">
          <div class="analyze-cta-title">Analyze ${s.unanalyzedPosts} post${s.unanalyzedPosts !== 1 ? 's' : ''}</div>
          <div class="analyze-cta-sub">Topics, keywords &amp; summaries — no API key needed</div>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-analyze">Analyze</button>
      </div>`);
  }

  // LLM actions — only shown when LLM is configured
  if (hasLLM && hasDetOnly) {
    const llmLabel = model ? model.split('/').pop().replace(':free', '') : 'LLM';
    if (unanalyzed) {
      // Already showing Analyze above — offer LLM as a secondary action
      parts.push(`
        <button class="btn btn-secondary btn-sm btn-block" id="btn-enhance-llm"
          style="margin-top: var(--space-2); color: var(--color-accent); border-color: var(--color-accent-light);">
          ✦ Also enhance with ${llmLabel}
        </button>`);
    } else {
      // All analyzed — primary action is LLM enhancement
      parts.push(`
        <div class="analyze-cta">
          <div class="analyze-cta-text">
            <div class="analyze-cta-title">Enhance with LLM</div>
            <div class="analyze-cta-sub">Using ${llmLabel} — adds summaries, insights &amp; action items</div>
          </div>
          <button class="btn btn-primary btn-sm" id="btn-enhance-llm">Enhance</button>
        </div>`);
    }

    // Re-analyze option (already has LLM results)
    if (s.analyzedPosts > 0 && !unanalyzed) {
      parts.push(`
        <button class="btn btn-secondary btn-sm btn-block" id="btn-reanalyze-llm"
          style="margin-top: var(--space-2); color: var(--color-text-tertiary);">
          ↺ Re-run LLM analysis
        </button>`);
    }
  } else if (!hasLLM && hasDetOnly && !unanalyzed) {
    // No LLM configured — nudge to settings
    parts.push(`
      <div class="banner banner-info" style="margin-top: var(--space-3)">
        <span>✦</span>
        <span>Add an LLM key in <button class="inline-link" id="btn-go-settings">Settings</button> for richer summaries &amp; insights.</span>
      </div>`);
  }

  return parts.join('');
}

// ─── OpenRouter Free Models ───────────────────────────────────

const FREE_MODELS = [
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 120B' },
  { id: 'google/gemma-4-31b-it:free',             label: 'Gemma 4 31B' },
  { id: 'google/gemma-4-26b-a4b-it:free',         label: 'Gemma 4 26B' },
  { id: 'arcee-ai/trinity-large-preview:free',     label: 'Trinity Large' },
  { id: 'inclusionai/ling-2.6-flash:free',         label: 'Ling 2.6 Flash' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free',     label: 'Nemotron 30B' },
  { id: 'minimax/minimax-m2.5:free',               label: 'MiniMax M2.5' },
  { id: 'z-ai/glm-4.5-air:free',                  label: 'GLM-4.5 Air' },
];

function getFreeModelsHint() {
  const chips = FREE_MODELS.map(m =>
    `<span class="model-chip" data-model="${m.id}" title="${m.id}">${m.label}</span>`
  ).join('');
  return `Click to use a free model:<br><span class="model-chips">${chips}</span>`;
}

function bindModelHintClicks(container) {
  container.querySelectorAll('.model-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = container.querySelector('#llm-model');
      if (input) {
        input.value = chip.dataset.model;
        input.focus();
        // Flash to confirm
        chip.classList.add('selected');
        container.querySelectorAll('.model-chip').forEach(c => {
          if (c !== chip) c.classList.remove('selected');
        });
      }
    });
  });
}

// ─── Utilities ────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function getModelPlaceholder(provider) {
  return { openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5-20251001', ollama: 'llama3.1', groq: 'llama-3.1-70b-versatile', custom: 'model-name' }[provider] || '';
}

function providerLabel(provider) {
  return { openai: 'OpenAI', anthropic: 'Anthropic', groq: 'Groq', custom: 'a third-party API' }[provider] || provider;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 150);
}

// ─── Init ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  connectPort();

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });

  send({ type: 'GET_STATS' });
  send({ type: 'GET_SETTINGS' });
  send({ type: 'GET_DASHBOARD_INSIGHTS' });

  renderDashboard();
});
