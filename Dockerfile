FROM node:22.19.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
COPY docs ./docs
COPY scripts ./scripts
COPY tsconfig.json tsconfig.base.json ./
RUN npm ci --ignore-scripts
RUN npm run build

FROM node:22.19.0-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data/content /data/disputes && chown -R node:node /data
USER node
CMD ["npm", "--workspace", "@verity/providers", "start"]
