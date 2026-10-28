# Ghostwriter CLI

A tiny, dependency-free tool for drafting blog posts with Kiro and publishing
them to a [Bludit](https://www.bludit.com) blog through the official **API** plugin.

There is no AI service, no GitHub integration, and nothing deployed. The workflow
is deliberately simple:

1. You and Kiro write a post together in chat.
2. Kiro saves it as a Markdown file (e.g. on your Desktop).
3. You read it over.
4. You tell Kiro "publish it" and Kiro runs this script.

## Requirements

- Node.js 18 or newer (uses the built-in `fetch`; no `npm install` needed).
- The Bludit **API** plugin activated on your site.

## Setup

1. Copy the env template and fill in your tokens:

   ```bash
   cp .env.example .env
   ```

2. Get the two tokens from your Bludit admin panel:

   - **`BLUDIT_API_TOKEN`** — Plugins → API → Settings → *API Token*.
     (Regenerated whenever the API plugin is reinstalled.)
   - **`BLUDIT_AUTH_TOKEN`** — Users → your admin user → *Security* tab →
     *Authentication Token*. Must be an **admin** user; write access is
     rejected otherwise.

3. Paste both into `.env`. That file is git-ignored and never leaves your machine.

## Post format

A post is a Markdown file with a front-matter block at the top:

```markdown
---
title: Building a StreamDeck on a Budget
description: Turning a cheap macro pad into a stream controller.
tags: streaming, obs, hardware
category: General
status: draft
---

Here's the body of the post in **Markdown**.

## A heading

Some content...
```

Front-matter fields:

| Field         | Required | Notes                                                        |
| ------------- | -------- | ------------------------------------------------------------ |
| `title`       | yes      | The post title.                                              |
| `description` | no       | Short summary used for meta/SEO.                             |
| `tags`        | no       | Comma-separated.                                             |
| `category`    | no       | Category name as it appears in Bludit.                       |
| `slug`        | no       | Custom URL slug; Bludit derives one from the title if omitted.|
| `status`      | no       | `draft` (default) or `published`.                            |

## Publishing

Save as a draft (default — safest):

```bash
node publish.mjs ~/Desktop/my-post.md
```

Publish live immediately:

```bash
node publish.mjs ~/Desktop/my-post.md --publish
```

Preview the request without sending it (tokens are never printed):

```bash
node publish.mjs ~/Desktop/my-post.md --dry-run
```

## Safety notes

- Posts default to **draft** so you always get a final look in the admin before
  anything goes public. Pass `--publish` (or set `status: published`) only when
  you're ready.
- The script never prints your tokens, even in `--dry-run`.
- Credentials live only in `.env` on your machine.
```
