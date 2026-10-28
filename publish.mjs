#!/usr/bin/env node
/**
 * Ghostwriter → Bludit publisher
 *
 * Usage:
 *   node publish.mjs <path-to-post.md> [--publish | --schedule "YYYY-MM-DD HH:MM"] [--dry-run]
 *
 * The Markdown file starts with a front-matter block delimited by "---":
 *
 *   ---
 *   title: My Post Title
 *   description: Optional short summary used for meta/SEO.
 *   tags: streaming, obs, hardware
 *   category: General
 *   status: draft            # draft | published | scheduled  (default: draft)
 *   date: 2026-01-01 09:00   # future time → queue the post (scheduled)
 *   ---
 *   # Body starts here (Markdown)
 *
 *   ![A caption](screenshot.png)   <- local image, uploaded automatically
 *
 * Categories:
 *   The `category:` field must be one that already exists on the site. Bludit
 *   does NOT create missing categories, so the script checks the value against
 *   GET /api/categories and stops with the list of valid options if it doesn't
 *   match. You can give either the display name ("Content Creation") or the key
 *   ("content-creation"); the script sends the key, which is what the API wants.
 *
 * Images:
 *   Any Markdown image whose path is local (not http/https and not already a
 *   Bludit uploads URL) is uploaded to the post's own page folder, exactly like
 *   Bludit's editor does it. The local reference is then rewritten to the
 *   uploaded URL. Image files are resolved relative to the .md file's folder.
 *
 * Scheduling:
 *   Give a future publish time via the `date:` front-matter field or the
 *   --schedule flag. The post is created with type=scheduled and Bludit
 *   publishes it automatically when that time arrives (it stays hidden until
 *   then). The time is read in the machine's local timezone. --publish and a
 *   schedule date are mutually exclusive.
 *
 * Flags:
 *   --publish            Force status=published regardless of front matter.
 *   --schedule <when>    Queue the post for a future "YYYY-MM-DD HH:MM[:SS]".
 *   --dry-run            Print what would be sent (and which images would
 *                        upload), but do not call the API.
 *
 * Credentials are read from a .env file next to this script (see .env.example).
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Tiny .env loader (no dependency) ──────────────────────────────────────
async function loadEnv() {
  const envPath = resolve(__dirname, '.env');
  if (!existsSync(envPath)) {
    fail(
      `No .env file found at ${envPath}\n` +
      `Copy .env.example to .env and fill in your Bludit tokens.`
    );
  }
  const raw = await readFile(envPath, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

// ── Front-matter parser (minimal YAML subset: key: value per line) ────────
function parseFrontMatter(fileText) {
  const fm = {};
  let body = fileText;

  const match = fileText.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (match) {
    const block = match[1];
    body = match[2];
    for (const line of block.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colon = trimmed.indexOf(':');
      if (colon === -1) continue;
      const key = trimmed.slice(0, colon).trim().toLowerCase();
      let val = trimmed.slice(colon + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      fm[key] = val;
    }
  }

  return { frontMatter: fm, body: body.trim() };
}

// ── Find local image references in the Markdown body ──────────────────────
// Matches Markdown images: ![alt](path "optional title")
// Returns unique local paths (skips http(s):// and protocol-relative //urls).
function findLocalImages(body) {
  const re = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
  const found = new Set();
  let m;
  while ((m = re.exec(body)) !== null) {
    const ref = m[1].trim();
    if (/^https?:\/\//i.test(ref) || ref.startsWith('//')) continue; // remote
    if (ref.startsWith('/bl-content/')) continue; // already a Bludit path
    found.add(ref);
  }
  return [...found];
}

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ── Upload one image to a page's folder via POST /api/images ──────────────
async function uploadImage({ apiUrl, apiToken, authToken, uuid, absImagePath }) {
  const fileBuf = await readFile(absImagePath);
  const filename = basename(absImagePath);

  const form = new FormData();
  form.append('token', apiToken);
  form.append('authentication', authToken);
  form.append('uuid', uuid);
  form.append('image', new Blob([fileBuf]), filename);

  const res = await fetch(`${apiUrl}/images`, { method: 'POST', body: form });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Image upload did not return JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (data.status !== '0' || !data.image) {
    throw new Error(`Image upload failed (HTTP ${res.status}): ${data.message || 'unknown error'}`);
  }
  return data.image; // absolute URL to the uploaded image
}

// ── Fetch existing categories via GET /api/categories ─────────────────────
// Returns an array of { name, key }. Throws on network/HTTP/JSON problems so
// the caller can decide whether to warn or stop.
async function fetchCategories({ apiUrl, apiToken }) {
  const res = await fetch(`${apiUrl}/categories?token=${encodeURIComponent(apiToken)}`);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Categories request did not return JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (data.status !== '0' || !Array.isArray(data.data)) {
    throw new Error(`Categories request failed (HTTP ${res.status}): ${data.message || 'unknown error'}`);
  }
  return data.data.map((c) => ({ name: c.name, key: c.key }));
}

// ── Resolve a front-matter category to an existing category key ────────────
// Bludit's API expects a category *key* (e.g. "content-creation"), not the
// display name ("Content Creation"). We accept either: a value matching a key
// or a name (case-insensitive) resolves to that category's key. An unknown
// category stops the run, because Bludit will not create it for you — the post
// would silently end up uncategorized. If the category list can't be fetched
// (old API plugin, network issue), we warn and skip validation rather than
// block publishing.
async function resolveCategoryKey(wanted, { apiUrl, apiToken }) {
  let categories;
  try {
    categories = await fetchCategories({ apiUrl, apiToken });
  } catch (err) {
    console.warn(`\n⚠ Could not verify categories (${err.message}).`);
    console.warn(`  Skipping category validation; sending "${wanted}" as-is.\n`);
    return wanted;
  }

  const target = wanted.trim().toLowerCase();
  const match = categories.find(
    (c) => c.key.toLowerCase() === target || (c.name || '').toLowerCase() === target
  );
  if (match) return match.key;

  const list = categories.length
    ? categories.map((c) => `  - ${c.name}  (key: ${c.key})`).join('\n')
    : '  (none defined yet)';
  fail(
    `Category "${wanted}" does not exist on the site, and Bludit will not create it automatically.\n` +
    `Use one of these (the key is what the API expects), or create the category in the Bludit admin first:\n` +
    list
  );
}

// ── Call POST /api/pages or PUT /api/pages/<key> ──────────────────────────
async function sendPage({ apiUrl, method, key, payload }) {
  const url = key ? `${apiUrl}/pages/${encodeURIComponent(key)}` : `${apiUrl}/pages`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`API did not return JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  return { res, data };
}

// ── Read the value of a "--flag value" or "--flag=value" option ────────────
// Returns the value string, or null if the flag was not supplied.
// Consuming the value here keeps it out of the positional (file path) args.
function getFlagValue(args, name) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === name) return args[i + 1] ?? '';          // --flag value
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1); // --flag=value
  }
  return null;
}

// ── Validate and normalize a schedule date to "YYYY-MM-DD HH:MM:SS" ────────
// Accepts "YYYY-MM-DD HH:MM[:SS]" or ISO "YYYY-MM-DDTHH:MM[:SS]". The time is
// interpreted in the machine's local timezone (matching the Bludit admin UI).
function normalizeScheduleDate(raw) {
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    fail(
      `Invalid schedule date "${raw}".\n` +
      `Use "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS" (e.g. "2026-01-01 09:30").`
    );
  }
  const [, Y, Mo, D, H, Mi, S = '00'] = m;
  const dt = new Date(Number(Y), Number(Mo) - 1, Number(D), Number(H), Number(Mi), Number(S));
  // Guard against impossible dates that JS would roll over (e.g. month 13).
  if (
    dt.getFullYear() !== Number(Y) || dt.getMonth() !== Number(Mo) - 1 ||
    dt.getDate() !== Number(D) || dt.getHours() !== Number(H) ||
    dt.getMinutes() !== Number(Mi) || dt.getSeconds() !== Number(S)
  ) {
    fail(`Invalid schedule date "${raw}": that calendar date/time does not exist.`);
  }
  if (dt.getTime() <= Date.now()) {
    fail(
      `Schedule date "${raw}" is not in the future.\n` +
      `Pick a later date/time, or publish now with --publish.`
    );
  }
  return `${Y}-${Mo}-${D} ${H}:${Mi}:${S}`;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const scheduleValue = getFlagValue(args, '--schedule');

  // Treat bare "--flag" tokens as flags, but don't count the value that follows
  // --schedule (or the --schedule=... form) as a positional file-path argument.
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a, i) => {
    if (a.startsWith('--')) return false;
    if (args[i - 1] === '--schedule') return false; // this token is --schedule's value
    return true;
  });

  const filePath = positional[0];
  if (!filePath) {
    fail('Usage: node publish.mjs <path-to-post.md> [--publish | --schedule "YYYY-MM-DD HH:MM"] [--dry-run]');
  }

  const absPath = resolve(process.cwd(), filePath);
  if (!existsSync(absPath)) {
    fail(`Post file not found: ${absPath}`);
  }
  const postDir = dirname(absPath);

  const env = await loadEnv();
  const apiUrl = (env.BLUDIT_API_URL || '').replace(/\/+$/, '');
  const apiToken = env.BLUDIT_API_TOKEN;
  const authToken = env.BLUDIT_AUTH_TOKEN;

  if (!apiUrl) fail('BLUDIT_API_URL is missing in .env');
  if (!apiToken) fail('BLUDIT_API_TOKEN is missing in .env');
  if (!authToken) fail('BLUDIT_AUTH_TOKEN is missing in .env');

  const fileText = await readFile(absPath, 'utf8');
  const { frontMatter, body } = parseFrontMatter(fileText);

  if (!frontMatter.title) fail('Front matter must include a "title:" field.');
  if (!body) fail('The post body (after the front-matter block) is empty.');

  // Determine publish status. Default draft; --publish flag or status: published wins.
  let status = (frontMatter.status || 'draft').toLowerCase();
  if (flags.has('--publish')) status = 'published';

  // Scheduling: a date can come from the --schedule flag or a `date:` front-matter
  // field. Either one implies a scheduled post unless --publish was given explicitly.
  const rawDate = scheduleValue || frontMatter.date || '';
  let scheduleDate = null;
  if (rawDate) {
    if (flags.has('--publish')) {
      fail('Use either --publish or a schedule date, not both.');
    }
    scheduleDate = normalizeScheduleDate(rawDate);
    status = 'scheduled';
  } else if (status === 'scheduled') {
    fail('status: scheduled requires a "date:" field (or the --schedule flag) with the publish time.');
  }

  if (status !== 'draft' && status !== 'published' && status !== 'scheduled') {
    fail(`Invalid status "${status}". Use "draft", "published", or "scheduled".`);
  }

  // Discover local images and validate they exist on disk.
  const localImages = findLocalImages(body);
  const missing = localImages.filter((ref) => !existsSync(resolve(postDir, ref)));
  if (missing.length > 0) {
    fail(
      `These image files referenced in the post were not found next to the .md:\n` +
      missing.map((m) => `  - ${m}`).join('\n') +
      `\n(Looked in: ${postDir})`
    );
  }

  // Validate the category against the site and resolve it to the key the API
  // expects. Stops here with a helpful list if the category doesn't exist.
  let categoryKey = null;
  if (frontMatter.category) {
    categoryKey = await resolveCategoryKey(frontMatter.category, { apiUrl, apiToken });
  }

  // Common fields shared by create/edit.
  const baseFields = { title: frontMatter.title };
  if (frontMatter.description) baseFields.description = frontMatter.description;
  if (frontMatter.tags) baseFields.tags = frontMatter.tags;
  if (categoryKey) baseFields.category = categoryKey;
  if (frontMatter.slug) baseFields.slug = frontMatter.slug;
  if (scheduleDate) baseFields.date = scheduleDate;

  console.log('\n── Ghostwriter publish ──────────────────────────────');
  console.log(`Site     : ${apiUrl}`);
  console.log(`Status   : ${status}`);
  if (scheduleDate) console.log(`Publish  : ${scheduleDate} (scheduled)`);
  console.log(`Title    : ${frontMatter.title}`);
  console.log(`Tags     : ${frontMatter.tags || '(none)'}`);
  console.log(`Category : ${categoryKey ? `${categoryKey}${frontMatter.category && frontMatter.category.trim().toLowerCase() !== categoryKey.toLowerCase() ? ` (from "${frontMatter.category}")` : ''}` : '(none)'}`);
  console.log(`Body     : ${body.length} chars`);
  console.log(`Images   : ${localImages.length ? localImages.join(', ') : '(none)'}`);
  console.log('─────────────────────────────────────────────────────');

  if (flags.has('--dry-run')) {
    console.log('\n(--dry-run) No request sent.');
    if (localImages.length) {
      console.log('\nImage upload plan:');
      console.log('  1. Create draft page → obtain its uuid');
      console.log('  2. Upload each image to that page folder:');
      for (const ref of localImages) {
        console.log(`       ${ref}  →  <site>/bl-content/uploads/pages/<uuid>/${basename(ref)}`);
      }
      const finalAction =
        status === 'published' ? ' (then publish).'
        : status === 'scheduled' ? ` (then schedule for ${scheduleDate}).`
        : ' as a draft.';
      console.log('  3. Rewrite the body to the uploaded URLs and save the page' + finalAction);
    } else {
      console.log('No local images; a single create request would be sent.');
    }
    return;
  }

  // ── Fast path: no local images → single create request ──────────────────
  if (localImages.length === 0) {
    const payload = { token: apiToken, authentication: authToken, type: status, content: body, ...baseFields };
    let result;
    try {
      result = await sendPage({ apiUrl, method: 'POST', payload });
    } catch (err) {
      fail(err.message);
    }
    reportResult(result, status, scheduleDate);
    return;
  }

  // ── Image path: create draft → upload images → edit with rewritten body ──
  // Step 1: create the page as a draft first so we have a uuid to attach images to.
  //         (We keep it a draft here even if publishing, then flip to published
  //          in the final edit, so the post never goes public with broken image
  //          links.)
  console.log('\n[1/3] Creating draft page to obtain a uuid...');
  let createResult;
  try {
    createResult = await sendPage({
      apiUrl,
      method: 'POST',
      payload: { token: apiToken, authentication: authToken, type: 'draft', content: body, ...baseFields },
    });
  } catch (err) {
    fail(err.message);
  }
  const { res: createRes, data: createData } = createResult;
  if (!(createRes.status === 201 || createData?.status === '0')) {
    fail(
      `Could not create the page (HTTP ${createRes.status}).\n` +
      `  Message: ${createData?.message || '(none)'}`
    );
  }
  const key = createData?.data?.key;
  const uuid = createData?.data?.uuid;
  if (!key || !uuid) {
    fail('Page was created but the API did not return a key/uuid, so images cannot be attached.');
  }
  console.log(`      key=${key}  uuid=${uuid}`);

  // Step 2: upload each image, building a ref → url map.
  console.log(`[2/3] Uploading ${localImages.length} image(s)...`);
  const urlMap = new Map();
  for (const ref of localImages) {
    const absImagePath = resolve(postDir, ref);
    try {
      const uploadedUrl = await uploadImage({ apiUrl, apiToken, authToken, uuid, absImagePath });
      urlMap.set(ref, uploadedUrl);
      console.log(`      ✔ ${ref} → ${uploadedUrl}`);
    } catch (err) {
      fail(
        `Image upload failed for "${ref}": ${err.message}\n` +
        `The page was created as a draft (key=${key}); fix the image and re-run, ` +
        `or delete the draft in the admin.`
      );
    }
  }

  // Step 3: rewrite the body's local image refs to the uploaded URLs, then save.
  let newBody = body;
  for (const [ref, url] of urlMap) {
    // Replace the exact path token inside image parentheses.
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(!\\[[^\\]]*\\]\\(\\s*)${escaped}(\\s*(?:"[^"]*")?\\s*\\))`, 'g');
    newBody = newBody.replace(re, `$1${url}$2`);
  }

  const savingSuffix =
    status === 'published' ? ' and publishing'
    : status === 'scheduled' ? ` and scheduling for ${scheduleDate}`
    : ' as draft';
  console.log(`[3/3] Saving page with image URLs${savingSuffix}...`);
  let editResult;
  try {
    editResult = await sendPage({
      apiUrl,
      method: 'PUT',
      key,
      payload: { token: apiToken, authentication: authToken, type: status, content: newBody, ...baseFields },
    });
  } catch (err) {
    fail(
      `Images uploaded but the final save failed: ${err.message}\n` +
      `The draft (key=${key}) still exists with the original local image refs.`
    );
  }
  reportResult(editResult, status, scheduleDate);
}

function reportResult({ res, data }, status, scheduleDate) {
  if (res.status === 201 || res.status === 200 || data?.status === '0') {
    const key = data?.data?.key || '(unknown key)';
    const permalink = data?.data?.permalink;
    const outcome =
      status === 'draft' ? 'saved as draft'
      : status === 'scheduled' ? `scheduled for ${scheduleDate}`
      : 'published';
    console.log(`\n✔ Page ${outcome}.`);
    console.log(`  Key      : ${key}`);
    if (permalink) console.log(`  URL      : ${permalink}`);
    if (status === 'scheduled') {
      console.log(`  Note     : not visible on the site until ${scheduleDate}; Bludit publishes it automatically.`);
    }
    console.log(`  Message  : ${data?.message || 'OK'}\n`);
  } else {
    fail(
      `API rejected the request (HTTP ${res.status}).\n` +
      `  Message: ${data?.message || '(none)'}\n` +
      `  Tip: a 401 usually means the API token or auth token is wrong,\n` +
      `       or the auth token's user is not an admin.`
    );
  }
}

main().catch((err) => fail(err.stack || String(err)));
