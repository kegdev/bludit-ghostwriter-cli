---
title: Hello from Ghostwriter CLI
description: A sample post showing the front-matter fields and Markdown body this tool expects.
tags: example, getting-started, bludit
category: General
slug: hello-from-ghostwriter-cli
status: draft
---

This is a sample post you can use to try out **Ghostwriter CLI**. Everything
above the second `---` is front matter; everything below it is the post body,
written in plain Markdown.

## What the front matter does

Only `title` is required. The rest are optional:

- `description` fills in the meta/SEO summary.
- `tags` is a comma-separated list.
- `category` must match a category that exists in your Bludit site.
- `slug` sets the URL; omit it and Bludit derives one from the title.
- `status` is `draft` (default) or `published`.

## Writing the body

Use any Markdown you like — headings, **bold**, _italics_, lists, and
[links](https://www.bludit.com).

1. Write your post as a `.md` file like this one.
2. Preview it first with `--dry-run`.
3. Save it as a draft, or publish with `--publish`.

> Tip: posts default to draft, so you always get a final look in the Bludit
> admin before anything goes public.

## Images

Reference a local image with standard Markdown and the script uploads it for
you, rewriting the link to the hosted URL. The image here lives next to this
file as `robot.png`:

![A sample image](robot.png)

Image paths are resolved relative to this `.md` file, so keep images alongside
the post (or in a subfolder you point to). Remote `http(s)://` URLs are left
untouched.
