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
