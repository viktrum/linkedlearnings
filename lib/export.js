/**
 * LinkedLearnings — Export Module
 *
 * Exports the knowledge base to markdown or JSON format.
 */

/**
 * Export posts to a single markdown file.
 */
export function exportMarkdown(posts) {
  const lines = [];
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const analyzed = posts.filter(p => p.analysis);
  const unanalyzed = posts.filter(p => !p.analysis);

  lines.push('# LinkedLearnings Knowledge Base');
  lines.push(`> Exported ${posts.length} posts on ${date}`);
  lines.push('');

  // Tags index (only if we have analyzed posts)
  if (analyzed.length > 0) {
    const tagCounts = {};
    for (const post of analyzed) {
      const det = post.analysis?.deterministic;
      const llm = post.analysis?.llm;
      const tags = [...(det?.fixedTags || []), ...(det?.keywords || []), ...(llm?.tags || [])];
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

    if (sortedTags.length > 0) {
      lines.push('## Tags Index');
      lines.push('');
      for (const [tag, count] of sortedTags) {
        lines.push(`- \`${tag}\` (${count} posts)`);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  // Category groups (analyzed posts)
  if (analyzed.length > 0) {
    const byCategory = {};
    for (const post of analyzed) {
      const cat = post.analysis?.llm?.category || post.analysis?.deterministic?.category || 'uncategorized';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(post);
    }

    for (const [category, catPosts] of Object.entries(byCategory)) {
      lines.push(`## ${formatCategory(category)}`);
      lines.push('');

      for (const post of catPosts) {
        lines.push(...formatPostMarkdown(post));
      }
    }
  }

  // Unanalyzed posts (raw content)
  if (unanalyzed.length > 0) {
    lines.push('## Unanalyzed Posts');
    lines.push('');
    for (const post of unanalyzed) {
      lines.push(...formatPostMarkdown(post));
    }
  }

  return lines.join('\n');
}

function formatPostMarkdown(post) {
  const lines = [];
  const a = post.analysis;

  // Header
  const authorLine = post.author?.name || 'Unknown Author';
  const headlinePart = post.author?.headline ? ` — ${post.author.headline}` : '';
  lines.push(`### ${authorLine}${headlinePart}`);
  lines.push('');

  // Tags and category (layered analysis shape)
  const det = a?.deterministic;
  const llm = a?.llm;
  const summary = llm?.summary || det?.summary || '';
  const fixedTags = det?.fixedTags || [];
  const keywords = det?.keywords || [];
  const category = llm?.category || det?.category || '';
  const tone = llm?.tone || det?.tone || '';
  const analysisSource = llm ? 'llm' : (det ? 'deterministic' : '');

  if (fixedTags.length) {
    lines.push(`**Topics:** ${fixedTags.map(t => '`' + t + '`').join(' ')}`);
  }
  if (keywords.length) {
    lines.push(`**Keywords:** ${keywords.map(t => '`' + t + '`').join(' ')}`);
  }
  if (category) {
    const meta = [`**Category:** ${formatCategory(category)}`];
    if (tone) meta.push(`**Tone:** ${tone}`);
    if (analysisSource) meta.push(`**Analysis:** ${analysisSource}`);
    if (det?.wordCount) meta.push(`**Words:** ${det.wordCount}`);
    lines.push(meta.join(' | '));
  }
  if (fixedTags.length || keywords.length || category) lines.push('');

  // Summary
  if (summary) {
    lines.push(`*${summary}*`);
    lines.push('');
  }

  // Original text (truncated for readability)
  if (post.textContent) {
    const text = post.textContent.length > 500
      ? post.textContent.slice(0, 500) + '...'
      : post.textContent;
    lines.push(text);
    lines.push('');
  }

  // Insights (LLM only)
  if (llm?.insights?.length) {
    lines.push('**Key Insights:**');
    for (const insight of llm.insights) {
      lines.push(`- ${insight}`);
    }
    lines.push('');
  }

  // Action items (LLM only)
  if (llm?.actionItems?.length) {
    lines.push('**Action Items:**');
    for (const item of llm.actionItems) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push('');
  }

  // Links
  if (post.links?.length) {
    lines.push('**Links:**');
    for (const link of post.links) {
      const title = link.title || link.url;
      lines.push(`- [${title}](${link.url})`);
    }
    lines.push('');
  }

  // Source
  if (post.postUrl) {
    lines.push(`[Original Post](${post.postUrl})`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  return lines;
}

function formatCategory(category) {
  return category
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}


/**
 * Export posts as JSON.
 */
export function exportJSON(posts) {
  const exportData = {
    exportedAt: new Date().toISOString(),
    version: '0.1.0',
    totalPosts: posts.length,
    analyzedPosts: posts.filter(p => p.analysis).length,
    posts: posts.map(post => ({
      id: post.id,
      author: post.author,
      textContent: post.textContent,
      postUrl: post.postUrl,
      links: post.links,
      hasMedia: post.hasMedia,
      mediaType: post.mediaType,
      reactionCount: post.reactionCount,
      commentCount: post.commentCount,
      postedAt: post.postedAt,
      extractedAt: post.extractedAt,
      analysis: post.analysis
    }))
  };

  return JSON.stringify(exportData, null, 2);
}
