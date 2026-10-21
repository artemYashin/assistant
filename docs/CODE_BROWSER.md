# Repository browser design

## Boundaries and data flow

1. The header opens `/code` for the currently selected Orbit customer/project.
2. Orbit resolves its configured Azure repository and authenticates requests using the existing session, Origin and CSRF middleware. The browser never supplies a Git URL or a credential.
3. Orbit calls `code-browser` over the Compose network, authenticating with a random service key in a dedicated shared control volume. Only Orbit can write that volume; the service mounts it read-only. The service has no published port and no access to Orbit's database or the user's working tree.
4. The service accepts an allowlist of operations: branches, status, pull, tree, file, search. It runs Git/ripgrep directly with argument arrays, never a shell. There is no write/commit/push API and no LLM execution.
5. Git fetches the selected branch into a bare cache. Reading uses immutable commit IDs. Switching branches changes the requested snapshot, never a working checkout. `pull` advances the cached snapshot to the fetched remote commit (no merge/rebase).

## Authentication

Existing Azure PAT, HTTPS, Code Read and repository Read permission. A token with greater permissions is usable but the service exposes no remote writes. Authorization is supplied to Git in its process environment, not URL, argv, persistent Git config or logs. Redirects, credential helpers, hooks, submodules, LFS downloads and checkout filters are disabled/not invoked. SSH is deliberately not required for this version. Token auth does not make Git transfer inherently slower than SSH: the initial transfer and repository size dominate.

## Freshness and efficiency

Branch listings are cached for 60 seconds. Opening a branch refreshes its remote ref at most once per minute. Checking updates explicitly fetches the latest remote ref without advancing the displayed snapshot. Pull advances it. The response includes displayed SHA, fetched SHA and last successful check time. History is shallow (200 commits); an exact behind count is shown only when ancestry is proven, otherwise the UI reports changed history/unknown distance. Failed checks never claim that a snapshot is current.

One operation runs at a time with a bounded queue. Fetch timeout is 120 seconds. Files/tree/search read from the cache without Azure requests. Only selected branches are fetched. The cache lives in its own named volume; existing Orbit data volumes are unchanged.

## Search and limits

Filename search uses Git's tree manifest. Content search uses literal, case-insensitive ripgrep over an immutable snapshot of regular UTF-8 files, including hidden and gitignored tracked files. Symlinks and submodules are not followed. LFS pointer files are displayed as pointers. Binary, oversized and omitted files are explicitly reported. File preview limit: 2 MiB. Search snapshot: 20,000 regular files / 128 MiB; two most recent snapshots per repository are retained. Tree manifest: bounded to 16 MiB. Results are bounded/paginated; partial search coverage is returned to the UI. Snapshot writes are atomic and only use validated relative paths.

There is no background polling or automatic pull. Git object storage persists; fetch is rejected once the configured total cache limit is reached (default 2 GiB), and an oversized fetch is discarded. The first fetch can take time. There is no execution/build of repository contents.

## API

Orbit: `POST /api/code-browser` with `{ client, project, operation, branch?, path?, query?, mode?, offset? }`.
Internal: `POST /v1/repository`, service key in Authorization; Orbit adds the resolved HTTPS URL and PAT. `GET /health` contains no repository data.

Tree paths and file reads are bound to the cached selected commit. Switching/pulling invalidates displayed file/search data. A file response carries its SHA and path so stale UI responses can be rejected. Tree pagination is per directory; searches return `more` and coverage information.

## Deployment and validation

`docker compose up -d --build` builds the new service with Git and ripgrep. No extra token is configured by the user; Orbit initializes the internal key. Local development can run the service with `CODE_BROWSER_CACHE`, `CODE_BROWSER_KEY_FILE` and `PORT`, and Orbit with `CODE_BROWSER_URL` and the same key-file path.

Tests use disposable local Git repositories and a constructor-only local transport option; the HTTP service never enables that option. Live Azure access and Docker/browser verification must be reported separately from fixture tests.
