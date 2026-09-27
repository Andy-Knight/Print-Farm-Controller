FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public
COPY emulator ./emulator

RUN mkdir -p /data /logs \
    && chown -R node:node /data /logs

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4242
ENV DATA_DIR=/data
ENV LOG_DIR=/logs

USER node

EXPOSE 4242

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4242/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
