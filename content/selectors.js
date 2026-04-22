/**
 * LinkedLearnings — LinkedIn DOM Selectors
 *
 * All LinkedIn DOM selectors are isolated here for easy updates.
 * Last validated: 2026-04-22 against live LinkedIn saved posts page.
 *
 * LinkedIn saved posts uses a search-result-like layout, NOT the feed layout.
 * Posts are <li> items inside a <ul role="list">, each containing a div
 * with data-chameleon-result-urn="urn:li:activity:...".
 */

/* eslint-disable no-var */

var LinkedLearningsSelectors = {
  // ─── Post Containers ─────────────────────────────────

  // Each saved post is inside an <li> containing a div with the URN
  postContainers: [
    '[data-chameleon-result-urn^="urn:li:activity:"]',
    '[data-chameleon-result-urn]'
  ],

  // The list that holds all posts
  feedContainer: [
    'ul[role="list"]',
    'main ul'
  ],

  // ─── Author Info ──────────────────────────────────────

  // Author name — inside the first profile link's span[aria-hidden="true"]
  authorName: [
    '.entity-result__content-actor a[href*="/in/"] span[dir="ltr"] span[aria-hidden="true"]',
    'a[href*="/in/"] span[dir="ltr"] span[aria-hidden="true"]'
  ],

  // Author headline — the div under the actor section with job title
  authorHeadline: [
    '.entity-result__content-actor .linked-area div[class*="t-14 t-black t-normal"]',
    '.entity-result__content-actor .linked-area div'
  ],

  // Author profile link
  authorProfileLink: [
    '.entity-result__content-actor a[href*="/in/"]',
    'a[href*="/in/"]'
  ],

  // Author avatar
  authorAvatar: [
    '.presence-entity__image',
    '.entity-result__content-image img'
  ],

  // ─── Post Content ─────────────────────────────────────

  // Post text content — the paragraph with the actual post text
  postText: [
    'p.entity-result__content-summary',
    '.entity-result__content-summary'
  ],

  // "…see more" button — specific class used on saved posts page
  seeMoreButton: [
    'button.reusable-search-show-more-link',
    'button[aria-label*="See more"]',
    'button[aria-label*="see more"]'
  ],

  // ─── Post Metadata ────────────────────────────────────

  // Timestamp — inside a <p> in the actor area, contains relative time
  timestamp: [
    '.entity-result__content-actor p.t-black--light span[aria-hidden="true"]',
    '.entity-result__content-actor p span[aria-hidden="true"]'
  ],

  // Permalink to the post (links to /feed/update/urn:li:activity:...)
  postPermalink: [
    'a[href*="/feed/update/urn:li:activity:"]',
    'a[href*="/feed/update/"]'
  ],

  // ─── Media / Attachments ──────────────────────────────

  // Image preview (thumbnail of attached media)
  imagePreview: [
    '.entity-result__embedded-object-image',
    'img[alt="Image preview"]'
  ],

  // Video indicator
  videoIndicator: [
    '.ivm-view-attr__video-icon',
    'span.ivm-view-attr__video-icon'
  ],

  // ─── Pagination ───────────────────────────────────────

  // "Show more results" button at bottom of the list
  showMoreResults: [
    'button.scaffold-finite-scroll__load-button',
    'button[aria-label*="Show more results"]',
    'button[aria-label*="more results"]'
  ],

  // ─── Filter Tabs ──────────────────────────────────────

  // "All" / "Articles" filter pills at top of saved posts
  filterPills: [
    'button.artdeco-pill',
    'button[class*="pill"]'
  ],

  // ─── Rate Limit Signals ───────────────────────────────

  captcha: [
    '[data-test="captcha"]',
    '#captcha-challenge'
  ]
};

/**
 * Try multiple selectors and return the first match.
 */
var LLQuerySelector = function(context, selectors) {
  for (const selector of selectors) {
    try {
      const el = context.querySelector(selector);
      if (el) return el;
    } catch { /* invalid selector, skip */ }
  }
  return null;
};

/**
 * Try multiple selectors and return all matches from the first one that finds anything.
 */
var LLQuerySelectorAll = function(context, selectors) {
  for (const selector of selectors) {
    try {
      const els = context.querySelectorAll(selector);
      if (els.length > 0) return Array.from(els);
    } catch { /* skip */ }
  }
  return [];
};
