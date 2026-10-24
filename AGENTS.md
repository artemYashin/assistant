# Orbit: maintaining product help

When adding, changing, or removing user-visible behavior, settings, permissions,
buttons, workflows, limits, or errors:
1. Read the relevant Markdown articles in docs/help/articles and update them in the
   same change. Write Russian user instructions with exact current UI labels.
2. Keep articles focused with short titles/summaries and useful Russian/English
   keywords. Preserve stable article IDs. Do not put full help into model prompts.
3. Describe local versus Azure effects, prerequisites, confirmations, partial
   failure, caching/expiry, and recovery. Never invent behavior from UI labels.
4. Run npm run docs:generate after source edits, then npm run docs:check.
   Generated message/control indexes are supplements, not substitutes for authored
   explanations. Their source fingerprints deliberately detect undocumented drift.
5. For help/search changes run tests/help.test.ts and the TypeScript checks.
   If user explicitly asks to skip tests, honor that and report what was skipped.
6. Never put PATs, tokens, customer data, real ticket content, or raw private logs
   into documentation. Document error templates, not runtime secrets.
7. Keep docs/help bundled in Docker runtime. New help tools remain lazy-loaded.
   General greetings/capability questions must not automatically load articles.

Read docs/help/README.md for the article format and coverage limitations.

When adding or changing tools available to PR review, update the review tool groups
in server/review-progress.ts. All tools share the analysis status; do not add
per-tool UI labels. Answer text switches to result preparation; further tool calls
switch back to analysis. Track concurrent tools and clear progress on
completion/error/stop. Keep it independent of debug-log retention and do not expose
arguments, code, ticket content or model reasoning in the status. Update the PR
review help article and tests/review-progress.test.ts in the same change.

When changing tools available to either agent, update docs/help/articles/chat-agent-tools.md
and docs/help/articles/review-agent-tools.md as applicable. Keep shared implementations;
chat and review have independent Agent instances, cancellation and session state.
