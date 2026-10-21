FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY service.mjs engine.mjs progress.mjs diagnostics.mjs ./
RUN mkdir -p /cache /control && chown -R node:node /cache /control
USER node
ENV PORT=8010 CODE_BROWSER_CACHE=/cache CODE_BROWSER_KEY_FILE=/control/key
EXPOSE 8010
CMD ["node", "service.mjs"]
