#!/usr/bin/env node
/**
 * Ghostwriter → Bludit publisher
 *
 * Usage:
 *   node publish.mjs <path-to-post.md> [--publish] [--dry-run]
 *
 * The Markdown file starts with a front-matter block delimited by "---":
 *
 *   ---
 *   title: My Post Title
 *   description: Optional short summary used for meta/SEO.
 *   tags: streaming, obs, hardware
 *   category: General
 *   status: draft            # draft | published  (default: draft)
 *   ---
 *   # Body starts here (Markdown)
 *
 *   ![A caption](screenshot.png)   <- local image, uploaded automatically
 *
 * Images:
 *   Any Markdown image whose path is local (not http/https and not already a
 *   Bludit uploads URL) is uploaded to the post's own page folder, exactly like
 *   Bludit's editor does it. The local reference is then rewritten to the
 *   uploaded URL. Image files are resolved relative to the .md file's folder.
 *
 * Flags:
 *   --publish   Force status=published regardless of front matter.
 *   --dry-run   Print what would be sent (and which images would upload),
 *               but do not call the API.
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

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a) => !a.startsWith('--'));

  const filePath = positional[0];
  if (!filePath) {
    fail('Usage: node publish.mjs <path-to-post.md> [--publish] [--dry-run]');
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
  if (status !== 'draft' && status !== 'published') {
    fail(`Invalid status "${status}". Use "draft" or "published".`);
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

  // Common fields shared by create/edit.
  const baseFields = { title: frontMatter.title };
  if (frontMatter.description) baseFields.description = frontMatter.description;
  if (frontMatter.tags) baseFields.tags = frontMatter.tags;
  if (frontMatter.category) baseFields.category = frontMatter.category;
  if (frontMatter.slug) baseFields.slug = frontMatter.slug;

  console.log('\n── Ghostwriter publish ──────────────────────────────');
  console.log(`Site     : ${apiUrl}`);
  console.log(`Status   : ${status}`);
  console.log(`Title    : ${frontMatter.title}`);
  console.log(`Tags     : ${frontMatter.tags || '(none)'}`);
  console.log(`Category : ${frontMatter.category || '(none)'}`);
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
      console.log('  3. Rewrite the body to the uploaded URLs and save the page' +
        (status === 'published' ? ' (then publish).' : ' as a draft.'));
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
    reportResult(result, status);
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

  console.log(`[3/3] Saving page with image URLs${status === 'published' ? ' and publishing' : ' as draft'}...`);
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
  reportResult(editResult, status);
}

function reportResult({ res, data }, status) {
  if (res.status === 201 || res.status === 200 || data?.status === '0') {
    const key = data?.data?.key || '(unknown key)';
    const permalink = data?.data?.permalink;
    console.log(`\n✔ Page ${status === 'draft' ? 'saved as draft' : 'published'}.`);
    console.log(`  Key      : ${key}`);
    if (permalink) console.log(`  URL      : ${permalink}`);
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
