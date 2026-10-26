FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY service.mjs engine.mjs progress.mjs diagnostics.mjs recovery.mjs jobs.mjs ./
RUN mkdir -p /cache /control && chown -R node:node /cache /control
USER node
ENV PORT=8010 CODE_BROWSER_CACHE=/cache CODE_BROWSER_KEY_FILE=/control/key
EXPOSE 8010
# Hold a kernel lock for the entire service lifetime, including across containers.
# A second service must not serve requests against this cache concurrently.
CMD ["sh", "-c", "exec flock --exclusive --nonblock --conflict-exit-code 75 \"$CODE_BROWSER_CACHE/.service.lock\" env CODE_BROWSER_EXCLUSIVE_CACHE=1 node service.mjs"]
