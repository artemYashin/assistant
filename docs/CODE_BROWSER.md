# Repository browser design

## Boundaries and data flow

1. The sidebar opens `/code` for the currently selected Orbit customer/project.
2. Orbit resolves its configured Azure repository and authenticates requests using the existing session, Origin and CSRF middleware. The browser never supplies a Git URL or a credential.
3. Orbit calls `code-browser` over the Compose network, authenticating with a random service key in a dedicated shared control volume. Only Orbit can write that volume; the service mounts it read-only. The service has no published port and no access to Orbit's database or the user's working tree.
4. The service accepts an allowlist of operations: branches, status, pull, tree, file, search. It runs Git/ripgrep directly with argument arrays, never a shell. There is no write/commit/push API and no LLM execution.
5. Git fetches the selected branch into a bare cache. Reading uses immutable commit IDs. Switching branches changes the requested snapshot, never a working checkout. `pull` advances the cached snapshot to the fetched remote commit (no merge/rebase).

## Authentication

Existing Azure PAT, HTTPS, Code Read and repository Read permission. A token with greater permissions is usable but the service exposes no remote writes. Authorization is supplied to Git in its process environment, not URL, argv, persistent Git config or logs. Redirects, credential helpers, hooks, submodules, LFS downloads and checkout filters are disabled/not invoked. SSH is deliberately not required for this version. Token auth does not make Git transfer inherently slower than SSH: the initial transfer and repository size dominate.

## Freshness and efficiency

Branch listings are persisted in the service cache and refreshed only on an explicit request or a scheduled background check. Repository IDs are persisted in Orbit with a credential/configuration-specific hashed key. Opening a cached branch uses its saved snapshot regardless of age; only the first opening downloads it automatically. Reloading the page does not fetch objects. Checking updates explicitly fetches the latest remote ref without advancing the displayed snapshot. Pull advances it. The response includes displayed SHA, fetched SHA and last successful check time. History is shallow (one commit by default; CODE_BROWSER_FETCH_DEPTH accepts 1–1000); an exact behind count is shown only when ancestry is proven, otherwise the UI reports changed history/unknown distance. Failed checks never claim that a snapshot is current.

One operation runs at a time with a bounded queue. Git network timeout defaults to 300 seconds and is configurable per repository from 60 to 1800 seconds. The backend allows an additional 180 seconds for queue/processing; queued work expires after 60 seconds and never starts after that expiry. Files/tree/search read from the cache without Azure requests. Only selected branches are fetched. The cache lives in its own named volume; existing Orbit data volumes are unchanged.

## Search and limits

Filename search uses Git's tree manifest. Content search uses literal, case-insensitive ripgrep over an immutable snapshot of regular UTF-8 files, including hidden and gitignored tracked files. Symlinks and submodules are not followed. LFS pointer files are displayed as pointers. Binary, oversized and omitted files are explicitly reported. File preview limit: 2 MiB. Search snapshot: 20,000 regular files / 128 MiB; two most recent snapshots per repository are retained. Tree manifest: bounded to 16 MiB. Results are bounded/paginated; partial search coverage is returned to the UI. Snapshot writes are atomic and only use validated relative paths.

Background checks run per repository at a configurable interval (30 minutes by default, 0 disables them). They respect the global sync schedule, refresh the branch catalog and check the last opened branch of an already downloaded repository. They do not start first-time clones or automatically advance the displayed snapshot. Git object storage persists; fetch is rejected once the configured total cache limit is reached (default 20 GiB). An oversized completed fetch is retained, but the displayed snapshot is not advanced; increase the quota and retry to reuse downloaded objects. This is a pre/post-operation quota, not a hard filesystem limit. The first fetch can take time. There is no execution/build of repository contents.

## API

Orbit: `POST /api/code-browser` with `{ client, project, operation, branch?, path?, query?, mode?, offset? }`.
Internal: `POST /v1/repository`, service key in Authorization; Orbit adds the resolved HTTPS URL and PAT. `GET /health` contains no repository data.

Tree paths and file reads are bound to the cached selected commit. Switching/pulling invalidates displayed file/search data. A file response carries its SHA and path so stale UI responses can be rejected. Tree pagination is per directory; searches return `more` and coverage information.

## Deployment and validation

`docker compose up -d --build` builds the new service with Git and ripgrep. No extra token is configured by the user; Orbit initializes the internal key. Local development can run the service with `CODE_BROWSER_CACHE`, `CODE_BROWSER_KEY_FILE` and `PORT`, and Orbit with `CODE_BROWSER_URL` and the same key-file path.

Tests use disposable local Git repositories and a constructor-only local transport option; the HTTP service never enables that option. Live Azure access and Docker/browser verification must be reported separately from fixture tests.

## Request progress

Clients opt into `Accept: application/x-ndjson` on the existing POST. Orbit forwards only validated `{stage, percent?}` progress events and a terminal result/error; the normal JSON API remains supported. This uses one authenticated, CSRF-protected request, not polling or an extra Azure request. Git fetch uses `--progress`; a bounded parser recognizes known stage names/numeric percentages and never forwards raw stderr. Events are throttled by the service. Snapshot generation reports processed-file progress; phases without a denominator remain indeterminate.

The UI displays current-phase progress and elapsed time, not a total percentage or estimated completion time. Callbacks are scoped to the latest UI request and ignored after navigation. Closing the page disconnects its stream; the existing bounded service operation can finish in the cache. There is no durable job history, automatic retry or job cancellation. Reloading the page can reconnect to in-flight work in the same service process (see below). Incomplete streams are reported as errors, never success.

### Interrupted fetch recovery

The Docker service holds an exclusive kernel `flock` on `/cache/.service.lock`
for its lifetime. Another instance using the same volume exits rather than
serving concurrent cache mutations. The lock file itself is never removed.
Automatic recovery is enabled only by this locked Docker entrypoint; direct
`node service.mjs` launches leave recovery disabled.

Before a fetch, the serialized worker checks for `git/shallow.lock`. It removes
only this regular file, only after inspecting `/proc` and finding no running
Git processes, and checking that the file has not changed during inspection.
Missing/unreadable process information, a live Git process, or a symlink blocks
recovery with a readable error. Other lock files, refs, history and application
data are not removed. Recovery is streamed as a progress stage and logged;
the requested fetch then proceeds normally. No time-based lock expiry is used.
The cache volume is private to this service: do not mount it in unrelated Git
writers or run maintenance Git commands there concurrently. Recreate the old
container when upgrading so all service instances use the exclusive entrypoint.

### Reconnect after a page reload

In-flight work is shared by repository URL, credential identity, branch and request
parameters. Repeated requests attach to the same promise and receive its latest
progress immediately. A status request can also attach to an existing Pull.
The last branch catalog can be read without queueing while that repository has
work in progress, and the browser remembers the selected branch in session storage.
Progress carries the original start time and the observer's current queue position.
The queue is bounded to five distinct jobs; duplicate observers do not take slots.
Disconnecting an observer does not cancel the job. State lives in the service
process: a container restart does not resume a running job.

Git receiving progress includes reported transfer bytes, bytes per second and
received/total object counts. These numeric fields and the last update timestamp
are replayed to reconnecting observers. Object percentages are not byte
percentages; no total download size or ETA is inferred from them. The UI hides
rates after 15 seconds without progress and shows an inactivity hint, which does
not diagnose host sleep, network failure or a stopped container.


### Cache capacity and download volume

Compose passes CODE_BROWSER_MAX_CACHE_BYTES (default 21474836480 = 20 GiB)
and CODE_BROWSER_FETCH_DEPTH (default 1) from the project's .env to the service.
After changing them, recreate the container with
`docker compose up -d --build code-browser`. Existing named volumes are retained.
This does not reserve disk space: ensure Docker's disk has sufficient free space.
Lowering history depth reduces newly requested history, but does not automatically
remove objects from an existing cache. All files at the selected commit are still
downloaded, so a large current tree may remain large. Partial/blobless clone is
not used, preserving local-only file browsing and content search.


### Background check scheduling

The main backend checks due Git work every 30 seconds independently of the normal
ticket/PR sync interval. Per-repository `code_sync_minutes` accepts 0–1440 and
survives context rename. Successful foreground status reads register the last
opened branch; explicit checks/Pull reset its interval. Attempt timestamps persist
so failures do not retry on every timer tick or backend restart. Errors are
retained for display on the code page. Changing repository/source requires opening
the new repository before background checks start. Only one background pass runs
at a time, and service jobs retain their existing queue/deduplication rules.
