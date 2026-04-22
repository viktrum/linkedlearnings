/**
 * LinkedLearnings — Content Script Extractor
 *
 * Injected into LinkedIn's saved posts page.
 * Scrolls through posts with human-like behavior, clicks "See more",
 * extracts content, and sends batches to the service worker.
 */

/* eslint-disable no-var */
/* globals LinkedLearningsSelectors, LLQuerySelector, LLQuerySelectorAll, LinkedLearningsNetworkData */

(function() {
  'use strict';

  // ─── State ─────────────────────────────────────────────

  let port = null;
  let status = 'idle'; // 'idle' | 'scrolling' | 'paused'
  let config = {};
  let batchId = '';
  let seenUrns = new Set();
  // Posts are sent one-at-a-time now (no batching needed)
  let postsExtracted = 0;
  let consecutiveEmptyScrolls = 0;

  // ─── Connect to Service Worker ─────────────────────────

  function connect() {
    try {
      port = chrome.runtime.connect({ name: 'extractor' });
    } catch (e) {
      console.warn('[LL] Failed to connect to service worker:', e.message);
      port = null;
      return;
    }

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'BEGIN_SCROLL':
          config = msg.settings || {};
          batchId = msg.batchId || '';
          // Seed seenUrns with posts already in the database to skip them
          if (msg.existingIds && msg.existingIds.length > 0) {
            for (const id of msg.existingIds) {
              seenUrns.add(id);
            }
            console.log(`[LL] Skipping ${msg.existingIds.length} already-extracted posts`);
          }
          startScrolling();
          break;
        case 'PAUSE_SCROLL':
          status = 'paused';
          stopHeartbeat();
          break;
        case 'RESUME_SCROLL':
          status = 'scrolling';
          startHeartbeat();
          scrollLoop();
          break;
        case 'STOP_SCROLL':
          status = 'idle';
          stopHeartbeat();
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      stopHeartbeat();

      if (status === 'scrolling') {
        // SW died mid-extraction — try to reconnect automatically
        console.warn('[LL] Port disconnected during extraction — reconnecting...');
        setTimeout(() => {
          connect();
          if (port) {
            // Tell SW we're still here and scrolling
            sendMessage({ type: 'EXTRACTOR_RECONNECTED' });
            startHeartbeat();
          } else {
            status = 'idle';
            console.warn('[LL] Reconnect failed. Extraction stopped.');
          }
        }, 1000);
      } else {
        status = 'idle';
        console.warn('[LL] Port disconnected. Extraction idle.');
      }
    });
  }

  // ─── Heartbeat (keeps MV3 service worker alive) ────────

  let heartbeatTimer = null;

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      sendMessage({ type: 'HEARTBEAT' });
    }, 20000); // Every 20s — well under MV3's 30s timeout
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  connect();

  // ─── Scroll Loop ───────────────────────────────────────

  async function startScrolling() {
    status = 'scrolling';
    startHeartbeat();
    console.log('[LL] Starting extraction. URL:', window.location.href);
    console.log('[LL] Page title:', document.title);

    // Wait for initial page load
    await sleep(2000);

    // Ensure we're on the "All" tab (not "Articles" or other filter)
    await clickAllTab();

    // Wait for tab switch to load
    await sleep(2000);

    await scrollLoop();
  }

  async function clickAllTab() {
    // LinkedIn saved posts page has filter pills: "All" | "Articles"
    // We need to click "All" to get every post type
    // The pills are typically <button> elements with text content
    const pills = document.querySelectorAll('button.artdeco-pill, button[class*="pill"], [role="tab"]');
    console.log(`[LL] Found ${pills.length} filter pills`);

    for (const pill of pills) {
      const text = pill.textContent?.trim().toLowerCase();
      console.log(`[LL] Filter pill: "${pill.textContent?.trim()}" selected=${pill.getAttribute('aria-selected')}`);
      if (text === 'all') {
        const isSelected = pill.getAttribute('aria-selected') === 'true' ||
                           pill.classList.contains('artdeco-pill--selected') ||
                           pill.classList.contains('active');
        if (!isSelected) {
          console.log('[LL] Clicking "All" tab to show all post types');
          pill.click();
          await sleep(1500);
        } else {
          console.log('[LL] "All" tab already selected');
        }
        return;
      }
    }
    console.log('[LL] Could not find "All" filter tab — proceeding with current view');
  }

  async function scrollLoop() {
    const postLimit = config.postLimit || 100;
    const delayMin = config.delayMin || 5000;
    const delayMax = config.delayMax || 15000;
    const batchPauseMin = config.batchPauseMin || 15000;
    const batchPauseMax = config.batchPauseMax || 45000;

    let postsSinceBatchPause = 0;
    // Random batch size each cycle — pause after 5-12 posts
    let nextBatchPause = 5 + Math.floor(Math.random() * 8);

    while (status === 'scrolling') {
      // Check rate limit signals
      const rateSignal = detectRateLimit();
      if (rateSignal) {
        sendMessage({ type: 'RATE_LIMIT_DETECTED', signal: rateSignal });
        status = 'paused';
        return;
      }

      // Check post limit
      if (postsExtracted >= postLimit) {
        sendMessage({ type: 'EXTRACTION_COMPLETE' });
        status = 'idle';
        return;
      }

      // Extract one post at a time (human-like: scroll to it, expand, read, extract)
      const post = await extractNextPost();
      if (status !== 'scrolling') break; // Pause was triggered during extraction

      if (!post) {
        // No unseen posts on screen — try pagination button first
        const clickedMore = await clickShowMoreResults();
        if (clickedMore) {
          consecutiveEmptyScrolls = 0;
          await waitForNewContent(5000);
          if (status !== 'scrolling') break;
          await interruptibleSleep(randomDelay(2000, 4000));
          continue;
        }

        // No pagination button — scroll down and look for more
        consecutiveEmptyScrolls++;
        if (consecutiveEmptyScrolls >= 5) {
          sendMessage({ type: 'EXTRACTION_COMPLETE' });
          status = 'idle';
          return;
        }

        await humanScroll();
        await waitForNewContent(3000);
        if (status !== 'scrolling') break;
        await interruptibleSleep(randomDelay(delayMin, delayMax));
        continue;
      }

      // Got a post — send immediately (one-at-a-time extraction, no need to buffer)
      consecutiveEmptyScrolls = 0;
      postsExtracted++;
      postsSinceBatchPause++;

      sendMessage({ type: 'POSTS_BATCH', posts: [post] });

      // Batch pause — take a longer break after random number of posts
      if (postsSinceBatchPause >= nextBatchPause) {
        postsSinceBatchPause = 0;
        nextBatchPause = 5 + Math.floor(Math.random() * 8); // pick new random for next cycle
        const batchPause = randomDelay(batchPauseMin, batchPauseMax);
        sendMessage({
          type: 'SCROLL_STATUS',
          message: `Pausing for ${Math.round(batchPause / 1000)}s to avoid detection...`,
          extracted: postsExtracted
        });
        await interruptibleSleep(batchPause);
        if (status !== 'scrolling') break;
      }

      // Brief gap between posts
      await interruptibleSleep(randomDelay(800, 1500));
    }

  }

  // ─── Domains to skip when visiting links (email walls, login walls) ───

  const SKIP_LINK_DOMAINS = [
    'substack.com',
    'medium.com',          // metered paywall
    'patreon.com',
    'linkedin.com',        // already on LinkedIn
  ];

  function shouldSkipLink(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return SKIP_LINK_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
    } catch {
      return true; // malformed URL
    }
  }

  /**
   * Calculate human-like reading time in ms based on word count.
   * Skimming saved posts — not deep reading.
   *
   *   30 words  → ~2s
   *  100 words  → ~5s
   *  300+ words → ~8s (capped)
   */
  function readingTimeMs(text) {
    if (!text) return 2000;
    const words = text.split(/\s+/).length;
    const wpm = 800 + Math.random() * 400; // 800-1200 wpm fast skim
    const baseMs = (words / wpm) * 60 * 1000;
    return Math.max(2000, Math.min(8000, baseMs + Math.random() * 500));
  }

  // ─── Post Extraction (one post at a time, human-like) ───

  async function extractNextPost() {
    const S = LinkedLearningsSelectors;
    const containers = LLQuerySelectorAll(document, S.postContainers);

    for (const el of containers) {
      if (status !== 'scrolling') return null;

      const urn = extractUrn(el);
      if (!urn || seenUrns.has(urn)) continue;
      seenUrns.add(urn);

      // Step 1: Scroll this post into view (human-like: big scroll, not tiny nudge)
      const rect = el.getBoundingClientRect();
      const viewH = window.innerHeight;
      const distFromCenter = rect.top - viewH / 2;

      if (Math.abs(distFromCenter) > viewH * 0.3) {
        // Post is far enough off-screen — scroll with a natural amount
        const scrollTarget = window.scrollY + rect.top - viewH * (0.3 + Math.random() * 0.2);
        const scrollDelta = scrollTarget - window.scrollY;
        // Ensure minimum scroll of 300px to look natural
        if (Math.abs(scrollDelta) > 150) {
          window.scrollBy({ top: scrollDelta, behavior: 'smooth' });
        } else {
          // Too small — do a proper human scroll instead
          window.scrollBy({ top: 400 + Math.random() * 300, behavior: 'smooth' });
        }
      } else {
        // Post is already roughly visible — no scroll needed
      }
      await interruptibleSleep(800 + Math.random() * 600);
      if (status !== 'scrolling') return null;

      // Step 2: Click "...see more" if present
      let seeMoreBtn = LLQuerySelector(el, S.seeMoreButton);
      if (!seeMoreBtn) {
        const allClickable = el.querySelectorAll('button, span[role="button"], a');
        for (const candidate of allClickable) {
          const txt = candidate.textContent?.trim().toLowerCase();
          if (txt === '...see more' || txt === 'see more' || txt === '…see more') {
            seeMoreBtn = candidate;
            break;
          }
        }
      }
      if (seeMoreBtn) {
        console.log('[LL] Clicking "see more" for post');
        // Scroll naturally until the button is in viewport — don't snap to center
        await scrollUntilVisible(seeMoreBtn);
        await interruptibleSleep(300 + Math.random() * 200);
        clickSeeMore(seeMoreBtn);
        // Wait for content to expand
        await interruptibleSleep(800 + Math.random() * 400);
        if (status !== 'scrolling') return null;
      }

      // Step 3: "Read" the post — time proportional to content length
      const postText = el.textContent || '';
      const readTime = readingTimeMs(postText);
      console.log(`[LL] Reading post (~${Math.round(readTime / 1000)}s for ${postText.split(/\s+/).length} words)`);
      await interruptibleSleep(readTime);
      if (status !== 'scrolling') return null;

      // Step 4: Extract the post data
      const post = parsePost(el, urn);
      if (!post || !post.textContent) continue;

      // Step 5: Visit one external link (if any) — shows LinkedIn we engaged
      const visitableLink = findVisitableLink(el);
      if (visitableLink) {
        console.log('[LL] Visiting link:', visitableLink);
        sendMessage({ type: 'VISIT_LINK', url: visitableLink });
        // Brief wait — SW handles the tab lifecycle independently
        await interruptibleSleep(randomDelay(1500, 3000));
        if (status !== 'scrolling') return null;
      }

      return post;
    }

    return null;
  }

  /**
   * Find one random external link in a post worth visiting.
   * Picks randomly from eligible links so it doesn't always hit the first one.
   * Returns URL string or null.
   */
  function findVisitableLink(postEl) {
    const links = postEl.querySelectorAll('a[href]');
    const eligible = [];

    for (const a of links) {
      const href = a.getAttribute('href') || '';

      // Skip internal LinkedIn links (profile links, hashtags, etc.)
      if (!href.startsWith('http')) continue;
      if (href.includes('linkedin.com/in/')) continue;
      if (href.includes('linkedin.com/company/')) continue;
      if (href.includes('linkedin.com/feed/hashtag/')) continue;

      // Skip domains with login/email walls
      if (shouldSkipLink(href)) continue;

      eligible.push(href);
    }

    if (eligible.length === 0) return null;

    // Pick one at random
    return eligible[Math.floor(Math.random() * eligible.length)];
  }

  function extractUrn(el) {
    // LinkedIn saved posts use data-chameleon-result-urn
    let urn = el.getAttribute('data-chameleon-result-urn');
    if (urn && urn.includes('urn:li:activity:')) return urn;

    // Try data-urn as fallback
    urn = el.getAttribute('data-urn');
    if (urn && urn.includes('urn:li:activity:')) return urn;

    // Try child elements
    const chameleonEl = el.querySelector('[data-chameleon-result-urn]');
    if (chameleonEl) return chameleonEl.getAttribute('data-chameleon-result-urn');

    const urnEl = el.querySelector('[data-urn^="urn:li:activity:"]');
    if (urnEl) return urnEl.getAttribute('data-urn');

    // Try extracting from a permalink
    const S = LinkedLearningsSelectors;
    const link = LLQuerySelector(el, S.postPermalink);
    if (link) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/urn:li:activity:(\d+)/);
      if (match) return `urn:li:activity:${match[1]}`;
    }

    // Generate a hash from content as last resort
    const text = el.textContent?.trim().slice(0, 200) || '';
    if (text.length > 20) {
      return `generated:${simpleHash(text)}`;
    }

    return null;
  }

  function parsePost(el, urn) {
    const S = LinkedLearningsSelectors;

    // ── Author ──
    const authorNameEl = LLQuerySelector(el, S.authorName);
    const authorHeadlineEl = LLQuerySelector(el, S.authorHeadline);
    const authorLinkEl = LLQuerySelector(el, S.authorProfileLink);
    const authorAvatarEl = LLQuerySelector(el, S.authorAvatar);

    const author = {
      name: cleanText(authorNameEl?.textContent) || 'Unknown',
      headline: cleanText(authorHeadlineEl?.textContent) || '',
      profileUrl: authorLinkEl?.getAttribute('href') || '',
      avatarUrl: authorAvatarEl?.getAttribute('src') || null
    };

    // ── Text Content ──
    // On saved posts page, text is inside p.entity-result__content-summary
    // The text has <!-- --> comment nodes and <br> for newlines
    const textContainer = LLQuerySelector(el, S.postText);
    let textContent = '';
    if (textContainer) {
      // Walk child nodes to preserve line breaks from <br> tags
      textContent = extractTextWithBreaks(textContainer);
    }

    // ── Post URL ──
    const permalinkEl = LLQuerySelector(el, S.postPermalink);
    let postUrl = '';
    if (permalinkEl) {
      const href = permalinkEl.getAttribute('href') || '';
      postUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
    }

    // ── Timestamp ──
    const timeEl = LLQuerySelector(el, S.timestamp);
    let postedAt = null;
    if (timeEl) {
      // Saved posts show relative time like "22h •" or "4d •"
      const timeText = cleanText(timeEl.textContent);
      postedAt = parseRelativeTime(timeText);
    }

    // ── Links in post text ──
    const links = [];
    if (textContent) {
      // Extract URLs from the text itself (LinkedIn sometimes uses lnkd.in links)
      const urlRegex = /https?:\/\/[^\s<>"]+/g;
      const urls = textContent.match(urlRegex) || [];
      for (const url of urls) {
        if (!url.includes('linkedin.com/in/')) {
          links.push({ url, title: null });
        }
      }
    }

    // ── Media detection ──
    const hasImagePreview = !!LLQuerySelector(el, S.imagePreview);
    const hasVideo = !!LLQuerySelector(el, S.videoIndicator);
    const hasMedia = hasImagePreview || hasVideo;

    let mediaType = null;
    if (hasVideo) mediaType = 'video';
    else if (hasImagePreview) mediaType = 'image';

    // ── Enrich from passive network data ──
    const networkData = LinkedLearningsNetworkData.get(urn);
    if (networkData) {
      if (!textContent && networkData.textContent) {
        textContent = networkData.textContent;
      }
      if (author.name === 'Unknown' && networkData.authorName) {
        author.name = networkData.authorName;
      }
      if (!author.headline && networkData.authorHeadline) {
        author.headline = networkData.authorHeadline;
      }
      if (!postUrl && networkData.postUrl) {
        postUrl = networkData.postUrl;
      }
    }

    return {
      id: urn,
      author,
      textContent,
      postUrl,
      links,
      hasMedia,
      mediaType,
      reactionCount: 0,  // Not shown on saved posts list view
      commentCount: 0,
      postedAt,
      extractedAt: new Date().toISOString(),
      batchId,
      analysis: null
    };
  }

  /**
   * Extract text from an element, converting <br> to newlines
   * and stripping HTML comments.
   */
  function extractTextWithBreaks(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BR') {
          text += '\n';
        } else if (node.tagName === 'BUTTON') {
          // Skip "see more" button text
          continue;
        } else {
          text += extractTextWithBreaks(node);
        }
      }
      // Skip comment nodes (nodeType 8)
    }
    return text.trim();
  }

  function cleanText(str) {
    if (!str) return '';
    return str.replace(/\s+/g, ' ').trim();
  }

  // ─── Human-Like Scrolling ──────────────────────────────

  // Scroll in natural increments until element is in viewport — no snapping
  async function scrollUntilVisible(el, maxAttempts = 6) {
    for (let i = 0; i < maxAttempts; i++) {
      const r = el.getBoundingClientRect();
      const viewH = window.innerHeight;
      // Element is in viewport (with some margin)
      if (r.top >= 50 && r.bottom <= viewH - 50) return;

      // Scroll a natural amount toward it
      const overshoot = r.top - viewH * (0.4 + Math.random() * 0.2);
      const scrollAmt = Math.max(250, Math.min(Math.abs(overshoot), 700)) * Math.sign(overshoot);
      window.scrollBy({ top: scrollAmt, behavior: 'smooth' });
      await sleep(400 + Math.random() * 300);
    }
  }

  async function humanScroll() {
    const scrollAmount = 600 + Math.random() * 400; // 600-1000px

    window.scrollBy({
      top: scrollAmount,
      behavior: 'smooth'
    });

    // Small pause to simulate reading
    await sleep(800 + Math.random() * 1200);

    // 10% chance of scrolling up slightly (natural behavior)
    if (Math.random() < 0.1) {
      const upAmount = -(100 + Math.random() * 150);
      window.scrollBy({ top: upAmount, behavior: 'smooth' });
      await sleep(500 + Math.random() * 500);
    }
  }

  async function clickShowMoreResults() {
    const S = LinkedLearningsSelectors;
    let btn = LLQuerySelector(document, S.showMoreResults);

    // Fallback: find by text content
    if (!btn) {
      const candidates = document.querySelectorAll('button');
      for (const candidate of candidates) {
        const txt = candidate.textContent?.trim().toLowerCase();
        if (txt.includes('show more results') || txt.includes('more results')) {
          btn = candidate;
          break;
        }
      }
    }

    if (btn && btn.offsetHeight > 0) {
      console.log('[LL] Clicking "Show more results" pagination button');
      sendMessage({
        type: 'SCROLL_STATUS',
        message: 'Loading more results...',
        extracted: postsExtracted
      });
      await scrollUntilVisible(btn);
      await sleep(500 + Math.random() * 500);
      btn.click();
      return true;
    }

    return false;
  }

  function clickSeeMore(button) {
    // Simulate hover first
    try {
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    } catch { /* ok */ }

    // Small delay then click
    setTimeout(() => {
      try { button.click(); } catch { /* ok */ }
    }, 200 + Math.random() * 300);
  }

  // ─── Rate Limit Detection ─────────────────────────────

  function detectRateLimit() {
    const S = LinkedLearningsSelectors;

    // Login redirect — only if the URL actually changed to login/checkpoint
    if (window.location.pathname.startsWith('/login') ||
        window.location.pathname.startsWith('/checkpoint')) {
      console.warn('[LL] Rate limit: login redirect detected. URL:', window.location.pathname);
      return 'login_redirect';
    }

    // CAPTCHA — real captcha challenge page (must be visible)
    const captchaEl = LLQuerySelector(document, S.captcha);
    if (captchaEl && captchaEl.offsetHeight > 0) {
      console.warn('[LL] Rate limit: CAPTCHA detected. Element:', captchaEl.tagName, captchaEl.className);
      return 'captcha';
    }

    // NOTE: Auth wall (.authentication-outlet) check REMOVED.
    // LinkedIn wraps the entire page in .authentication-outlet even when logged in.
    // It's a React app container, not a real auth wall.
    // Real auth blocks redirect to /login or /checkpoint (caught above).

    // Error page — only if the MAIN content area shows an error
    const mainEl = document.querySelector('main') || document.querySelector('.scaffold-layout__main');
    if (mainEl) {
      const mainText = mainEl.innerText || '';
      if (mainText.length < 500) {
        const hasError = mainText.includes('Something went wrong') ||
          mainText.includes('Unable to load') ||
          mainText.includes('Please try again later');
        if (hasError) {
          console.warn('[LL] Rate limit: Error page detected. Main text length:', mainText.length, 'Content:', mainText.slice(0, 200));
          return 'error_page';
        }
      }
    }

    return null;
  }

  // ─── Utilities ─────────────────────────────────────────

  function waitForNewContent(timeout) {
    return new Promise(resolve => {
      const target = document.querySelector('main') || document.body;
      let timer = setTimeout(done, timeout);

      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(done, 1500); // Reset — wait for mutations to settle
      });

      observer.observe(target, { childList: true, subtree: true });

      // Safety max
      const maxTimer = setTimeout(done, 10000);

      function done() {
        clearTimeout(timer);
        clearTimeout(maxTimer);
        observer.disconnect();
        resolve();
      }
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Sleep that checks status every 500ms and resolves early if paused/idle.
   * This makes pause responsive instead of waiting for the full delay.
   */
  function interruptibleSleep(ms) {
    return new Promise(resolve => {
      let elapsed = 0;
      const interval = 500;
      const tick = () => {
        elapsed += interval;
        if (status !== 'scrolling' || elapsed >= ms) {
          resolve();
        } else {
          setTimeout(tick, interval);
        }
      };
      setTimeout(tick, Math.min(interval, ms));
    });
  }

  function randomDelay(min, max) {
    return min + Math.random() * (max - min);
  }

  function sendMessage(msg) {
    if (port) {
      try {
        port.postMessage(msg);
      } catch {
        // Port disconnected
        status = 'idle';
      }
    }
  }

  function parseEngagementNumber(text) {
    if (!text) return 0;
    text = text.trim().replace(/,/g, '');
    if (text.endsWith('K') || text.endsWith('k')) {
      return Math.round(parseFloat(text) * 1000);
    }
    if (text.endsWith('M') || text.endsWith('m')) {
      return Math.round(parseFloat(text) * 1000000);
    }
    return parseInt(text, 10) || 0;
  }

  function parseRelativeTime(text) {
    if (!text) return null;
    // LinkedIn shows "22h •", "4d •", "3w •", "2mo •", "1yr •"
    // Strip the bullet and whitespace
    text = text.replace(/[•·]/g, '').trim().toLowerCase();

    const now = new Date();
    const date = new Date(now);

    // Short format: "22h", "4d", "3w", "2mo", "1yr", "30m", "45s"
    const shortMatch = text.match(/^(\d+)\s*(s|m|h|d|w|mo|yr)$/);
    if (shortMatch) {
      const amount = parseInt(shortMatch[1], 10);
      const unit = shortMatch[2];
      switch (unit) {
        case 's': date.setSeconds(date.getSeconds() - amount); break;
        case 'm': date.setMinutes(date.getMinutes() - amount); break;
        case 'h': date.setHours(date.getHours() - amount); break;
        case 'd': date.setDate(date.getDate() - amount); break;
        case 'w': date.setDate(date.getDate() - amount * 7); break;
        case 'mo': date.setMonth(date.getMonth() - amount); break;
        case 'yr': date.setFullYear(date.getFullYear() - amount); break;
      }
      return date.toISOString();
    }

    // Long format fallback: "22 hours ago", "4 days ago"
    const longMatch = text.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/);
    if (longMatch) {
      const amount = parseInt(longMatch[1], 10);
      const unit = longMatch[2];
      switch (unit) {
        case 'second': date.setSeconds(date.getSeconds() - amount); break;
        case 'minute': date.setMinutes(date.getMinutes() - amount); break;
        case 'hour': date.setHours(date.getHours() - amount); break;
        case 'day': date.setDate(date.getDate() - amount); break;
        case 'week': date.setDate(date.getDate() - amount * 7); break;
        case 'month': date.setMonth(date.getMonth() - amount); break;
        case 'year': date.setFullYear(date.getFullYear() - amount); break;
      }
      return date.toISOString();
    }

    return null;
  }

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
})();
