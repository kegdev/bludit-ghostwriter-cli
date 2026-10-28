---
title: Ghostwriter 1.0 Goes Live Monday Morning
description: A real-world example of a post written ahead of time and queued to publish on launch day.
tags: release, announcement, changelog
category: News
slug: ghostwriter-1-0-release
date: 2099-01-06 08:00
status: scheduled
---

We're shipping **Ghostwriter 1.0** on Monday, and this post is proof of one of
its features: it was written days in advance and queued to publish itself at
8:00 on launch morning. Nobody had to be awake to hit a button.

## Why schedule a post

Writing and publishing rarely happen at the same convenient moment. You might
finish a release write-up on a Friday but want it to land Monday, or line up a
week of content before heading out of town. Scheduling lets you separate the
two: write when you have time, publish when it matters.

## What's in 1.0

- **Markdown in, Bludit out.** Write a post as a plain `.md` file and publish it
  straight to your site through the API plugin.
- **Draft by default.** Posts stay drafts until you explicitly publish, so you
  always get a final look first.
- **Automatic image uploads.** Local images referenced in the post are uploaded
  for you and the links are rewritten to their hosted URLs.
- **Scheduling.** The feature you're reading right now.

## How this post was queued

The front matter above sets a future `date` and `status: scheduled`. Publishing
it was a single command:

```bash
node publish.mjs examples/scheduled-release-announcement.md
```

From there Bludit took over: it held the post back, kept it off the public site,
and released it automatically at the scheduled time. Until then it sat under
Content → Scheduled in the admin, ready to go.

## Try it yourself

Change the `date` to a few minutes from now and run the command above (or pass
`--schedule "YYYY-MM-DD HH:MM"` to override it without editing the file). Watch
it appear in the scheduled queue, then flip live on its own when the clock
catches up.

Thanks for reading — and see you Monday.
