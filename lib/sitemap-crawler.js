const MAX_SITEMAP_FETCH = 5;

function extractLocs(xml) {
  return [...String(xml || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) =>
    m[1].trim(),
  );
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveSitemapUrls(sitemapUrl, origin, collected, depth = 0) {
  if (depth > MAX_SITEMAP_FETCH || collected.size > 500) return;
  let xml;
  try {
    xml = await fetchText(sitemapUrl);
  } catch {
    return;
  }

  const locs = extractLocs(xml);
  const childSitemaps = locs.filter((u) => /\.xml(\?|$)/i.test(u));

  if (childSitemaps.length > 0) {
    for (const child of childSitemaps.slice(0, MAX_SITEMAP_FETCH)) {
      await resolveSitemapUrls(child, origin, collected, depth + 1);
    }
    return;
  }

  for (const loc of locs) {
    try {
      const u = new URL(loc);
      if (u.origin === origin) collected.add(u.href);
    } catch {
      /* skip invalid */
    }
  }
}

async function discoverSitemapEntry(seedUrl) {
  const origin = new URL(seedUrl).origin;
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];

  try {
    const robots = await fetchText(`${origin}/robots.txt`);
    const match = robots.match(/^Sitemap:\s*(\S+)/im);
    if (match) candidates.unshift(match[1].trim());
  } catch {
    /* robots optional */
  }

  for (const url of candidates) {
    try {
      const xml = await fetchText(url);
      if (extractLocs(xml).length > 0) return url;
    } catch {
      /* try next */
    }
  }
  return candidates[0];
}

async function crawlSitemap({ seedUrl, maxPages = 20 }) {
  const parsed = new URL(seedUrl);
  const origin = parsed.origin;
  const sitemapUrl = await discoverSitemapEntry(parsed.href);
  const collected = new Set();

  await resolveSitemapUrls(sitemapUrl, origin, collected);

  if (collected.size === 0) {
    collected.add(parsed.href);
  }

  const urls = [...collected].slice(0, Math.min(maxPages, 50));
  return { urls, sitemapUrl, origin };
}

function parseUrlList(text) {
  return [...new Set(String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
}

function validateUrls(urls) {
  const valid = [];
  const errors = [];
  for (const raw of urls) {
    try {
      valid.push(new URL(raw).href);
    } catch {
      errors.push(`잘못된 URL: ${raw}`);
    }
  }
  return { valid, errors };
}

module.exports = { crawlSitemap, parseUrlList, validateUrls, extractLocs };
