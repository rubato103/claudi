---
name: git-report
description: Generate git activity reports
trigger: git report,git 리포트,커밋 요약,what changed
---

When asked for a git report:

1. Run `git log` with appropriate time range (default: last 24h)
2. Group commits by author
3. Summarize changes per author with bullet points
4. Include stats: total commits, files changed, insertions/deletions
5. Highlight any notable changes (new files, deleted files, large diffs)

Format the output as a clean readable report.
