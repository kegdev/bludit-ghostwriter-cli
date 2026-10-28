---
title: A Scheduled Post
description: Shows how to queue a post to publish automatically at a future time.
tags: example, scheduling
category: General
date: 2099-01-01 09:00
status: scheduled
---

# A Scheduled Post

This post is **scheduled**: instead of going live immediately, it's queued to
publish at the `date` set in the front matter above.

When you run Ghostwriter CLI on this file, it creates the page with Bludit's
`scheduled` status. Bludit keeps it hidden on the site and publishes it
automatically when the scheduled time arrives — you'll see it under
Content → Scheduled in the admin until then.

## Try it

The `date` above is set far in the future so this example stays "scheduled".
To see it actually go live, pick a time a few minutes out. You can edit the
`date` field, or override it on the command line:

```bash
node publish.mjs examples/scheduled-post.md --schedule "2099-01-01 09:05"
```

The time is `YYYY-MM-DD HH:MM` (seconds optional), read in your machine's local
timezone. It must be in the future, and `--schedule` can't be combined with
`--publish`.
