const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const websiteAppDir = path.join(repoRoot, 'website', 'app');
const websitePublicDir = path.join(repoRoot, 'website', 'public');

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

function pageFileToRoute(filePath) {
  const relativePath = path.relative(websiteAppDir, filePath).replace(/\\/g, '/');
  if (relativePath === 'page.js') return '/';
  if (!relativePath.endsWith('/page.js')) return null;

  const rawRoute = relativePath.slice(0, -'/page.js'.length);
  const segments = rawRoute
    .split('/')
    .filter(Boolean)
    .filter((segment) => !segment.startsWith('(') && !segment.startsWith('@'));

  if (segments.length === 0) return '/';
  return `/${segments.join('/')}`;
}

async function importModule(modulePath) {
  return import(pathToFileURL(modulePath).href);
}

test('robots configuration allows crawlers and does not block root', async () => {
  const robotsPath = path.join(websiteAppDir, 'robots.js');
  const { default: robots } = await importModule(robotsPath);
  const config = robots();

  assert.ok(config);
  assert.equal(config.sitemap, 'https://amaprice.sh/sitemap.xml');
  assert.ok(Array.isArray(config.rules));

  const wildcardRule = config.rules.find((rule) => rule.userAgent === '*');
  assert.ok(wildcardRule, 'Expected wildcard robots rule');

  const allowList = Array.isArray(wildcardRule.allow)
    ? wildcardRule.allow
    : [wildcardRule.allow].filter(Boolean);

  assert.ok(allowList.includes('/'), 'Expected robots allow /');

  const disallowList = Array.isArray(wildcardRule.disallow)
    ? wildcardRule.disallow
    : [wildcardRule.disallow].filter(Boolean);

  assert.equal(disallowList.includes('/'), false, 'Root path must not be disallowed');
});

test('sitemap includes all public pages and llms documents', async () => {
  const sitemapPath = path.join(websiteAppDir, 'sitemap.js');
  const { default: sitemap } = await importModule(sitemapPath);
  const entries = sitemap();

  assert.ok(Array.isArray(entries));
  assert.ok(entries.length >= 3, 'Expected sitemap to include site and llms documents');

  const paths = new Set(entries.map((entry) => new URL(entry.url).pathname));

  const pageRoutes = walkFiles(websiteAppDir)
    .map(pageFileToRoute)
    .filter(Boolean)
    .filter((route) => !route.startsWith('/api/'));

  for (const route of pageRoutes) {
    assert.ok(paths.has(route), `Missing route in sitemap: ${route}`);
  }

  assert.ok(paths.has('/llms.txt'), 'Missing /llms.txt in sitemap');
  assert.ok(paths.has('/llms-full.txt'), 'Missing /llms-full.txt in sitemap');

  for (const entry of entries) {
    const url = new URL(entry.url);
    assert.equal(url.origin, 'https://amaprice.sh', `Unexpected sitemap origin: ${entry.url}`);
  }
});

test('llms documentation files exist and contain required sections', () => {
  const llmsPath = path.join(websitePublicDir, 'llms.txt');
  const llmsFullPath = path.join(websitePublicDir, 'llms-full.txt');

  assert.equal(fs.existsSync(llmsPath), true, 'Expected website/public/llms.txt to exist');
  assert.equal(fs.existsSync(llmsFullPath), true, 'Expected website/public/llms-full.txt to exist');

  const llms = fs.readFileSync(llmsPath, 'utf8');
  const llmsFull = fs.readFileSync(llmsFullPath, 'utf8');

  assert.match(llms, /^# amaprice/m);
  assert.match(llms, /https:\/\/amaprice\.sh\/sitemap\.xml/);
  assert.match(llms, /https:\/\/amaprice\.sh\/llms-full\.txt/);
  assert.match(llms, /## Robots \+ Crawl Policy/);
  assert.match(llms, /It starts with Amazon support/i);
  assert.match(llms, /Walmart/i);

  assert.match(llmsFull, /^# amaprice \(Full LLM Guide\)/m);
  assert.match(llmsFull, /## CLI Command Reference/);
  assert.match(llmsFull, /## Tiered Background Model/);
  assert.match(llmsFull, /## Crawl and LLM Access Policy/);
  assert.match(llmsFull, /https:\/\/amaprice\.sh\/robots\.txt/);
  assert.match(llmsFull, /## Store Coverage and Roadmap/);
  assert.match(llmsFull, /Live now:\s*Amazon/i);
  assert.match(llmsFull, /Next:\s*Walmart/i);
});

test('layout metadata includes canonical + crawl + social configuration', () => {
  const layoutPath = path.join(websiteAppDir, 'layout.js');
  const content = fs.readFileSync(layoutPath, 'utf8');

  assert.match(content, /metadataBase:\s*new URL\(siteUrl\)/);
  assert.match(content, /alternates:\s*\{\s*canonical:\s*"\/"/s);
  assert.match(content, /openGraph:\s*\{/);
  assert.match(content, /twitter:\s*\{/);
  assert.match(content, /robots:\s*\{\s*index:\s*true,\s*follow:\s*true/s);
  assert.match(content, /verification:\s*googleVerification/);
});
