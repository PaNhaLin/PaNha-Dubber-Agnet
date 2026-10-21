FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core fonts-khmeros fontconfig ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json server.mjs ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
RUN node scripts/install-voxcpm-runtime.mjs
ENV NODE_ENV=production PORT=3002
EXPOSE 3002
CMD ["node","server.mjs"]
