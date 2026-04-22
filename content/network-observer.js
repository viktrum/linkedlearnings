/**
 * LinkedLearnings — Passive Network Observer
 *
 * Intercepts LinkedIn's own Voyager API responses as the user scrolls.
 * We make ZERO additional requests — just read what LinkedIn already fetches.
 * This enriches our DOM-extracted data with structured fields like
 * exact timestamps, engagement counts, and author details.
 */

/* eslint-disable no-var */

var LinkedLearningsNetworkData = {
  posts: new Map(),  // URN → enrichment data from API responses

  /**
   * Look up enrichment data for a post URN
   */
  get(urn) {
    return this.posts.get(urn) || null;
  },

  /**
   * Store enrichment data
   */
  set(urn, data) {
    this.posts.set(urn, data);
  }
};

(function installNetworkObserver() {
  // Only install once
  if (window.__linkedLearningsNetworkObserverInstalled) return;
  window.__linkedLearningsNetworkObserverInstalled = true;

  const originalFetch = window.fetch;

  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

      // Only intercept LinkedIn's Voyager API responses
      if (url.includes('/voyager/api/') || url.includes('/voyager/api')) {
        // Clone the response so we don't consume it
        const clone = response.clone();

        // Process asynchronously — don't block the original caller
        clone.json().then(data => {
          extractPostDataFromResponse(data);
        }).catch(() => {
          // Not JSON or parsing failed — ignore
        });
      }
    } catch {
      // Any error in our observer should never break LinkedIn
    }

    return response;
  };

  /**
   * Extract post data from a Voyager API response.
   * LinkedIn's API responses include an `included` array with entity data.
   */
  function extractPostDataFromResponse(data) {
    if (!data) return;

    // LinkedIn responses typically have a `data` or `included` array
    const items = data.included || data.elements || [];
    if (!Array.isArray(items)) return;

    for (const item of items) {
      try {
        // Look for activity/post entities
        const urn = item.entityUrn || item.trackingUrn || item['*updateMetadata'] || '';

        if (urn.includes('urn:li:activity:') || urn.includes('urn:li:ugcPost:')) {
          const enrichment = {};

          // Extract author info from actor
          if (item.actor) {
            enrichment.authorName = item.actor.name?.text || item.actor.title?.text;
            enrichment.authorHeadline = item.actor.description?.text;
            enrichment.authorProfileUrl = item.actor.navigationUrl;
          }

          // Extract engagement
          if (item.socialDetail) {
            enrichment.reactionCount = item.socialDetail.totalSocialActivityCounts?.numLikes || 0;
            enrichment.commentCount = item.socialDetail.totalSocialActivityCounts?.numComments || 0;
          }

          // Extract text
          if (item.commentary?.text?.text) {
            enrichment.textContent = item.commentary.text.text;
          } else if (item.summary?.text) {
            enrichment.textContent = item.summary.text;
          }

          // Extract timestamp
          if (item.actor?.subDescription?.text) {
            enrichment.relativeTime = item.actor.subDescription.text;
          }

          // Extract post URL
          if (item.navigationUrl || item.updateUrl) {
            enrichment.postUrl = item.navigationUrl || item.updateUrl;
          }

          if (Object.keys(enrichment).length > 0) {
            LinkedLearningsNetworkData.set(urn, enrichment);
          }
        }

        // Also capture profile data for author enrichment
        if (urn.includes('urn:li:fsd_profile:') || urn.includes('urn:li:member:')) {
          if (item.firstName || item.lastName) {
            const profileData = {
              name: [item.firstName, item.lastName].filter(Boolean).join(' '),
              headline: item.headline,
              profileUrl: item.navigationUrl
            };
            // Store by profile URN for later cross-reference
            LinkedLearningsNetworkData.set(urn, profileData);
          }
        }
      } catch {
        // Individual item parsing failed — continue with others
      }
    }
  }
})();
