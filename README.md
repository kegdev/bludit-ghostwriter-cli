# Ghostwriter CLI

A tiny, dependency-free tool for publishing Markdown blog posts to a
[Bludit](https://www.bludit.com) blog through the official **API** plugin.

There is no AI service, no GitHub integration, and nothing deployed. The workflow
is deliberately simple:

1. Write a post as a Markdown file with a short front-matter block.
2. (Optional) Preview what will be sent with `--dry-run`.
3. Run the script to save it as a draft or publish it live.

Because it's a plain command-line script, it slots into whatever workflow you
already use: write posts by hand, with your favorite editor, or with an AI
assistant that can save Markdown files and run a command.

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

A ready-to-run example lives at
[`examples/sample-post.md`](examples/sample-post.md) (with an image at
`examples/robot.png`). It demonstrates every field and an inline image, and you
can preview it right away:

```bash
node publish.mjs examples/sample-post.md --dry-run
```

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

## Images

Reference images with standard Markdown image syntax in the body:

```markdown
![A friendly robot](robot.png)
```

How each reference is handled depends on the path:

- **Local files** (e.g. `robot.png`, `images/diagram.png`) are uploaded to the
  post's own folder on your Bludit site, and the link is rewritten to the
  hosted URL automatically — the same way Bludit's own editor uploads images.
  Paths are resolved **relative to the `.md` file**, so keep images next to the
  post (or in a subfolder you reference).
- **Remote URLs** (`http://`, `https://`, or protocol-relative `//`) are left
  untouched and used as-is.
- Paths already pointing at `/bl-content/` (an existing Bludit upload) are left
  as-is.

If a local image can't be found next to the post, the script stops with an
error and lists the missing files before sending anything. When a post has
local images, it's always created as a draft first so the images upload before
the post can go public — even with `--publish`, you won't end up with a live
post full of broken image links.

See [`examples/sample-post.md`](examples/sample-post.md) for a complete post,
including an image example.

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

New here? Try it against the bundled example first:

```bash
node publish.mjs examples/sample-post.md --dry-run
```

## Safety notes

- Posts default to **draft** so you always get a final look in the admin before
  anything goes public. Pass `--publish` (or set `status: published`) only when
  you're ready.
- The script never prints your tokens, even in `--dry-run`.
- Credentials live only in `.env` on your machine.
```
