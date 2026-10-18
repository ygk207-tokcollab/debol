FROM node:22-slim

WORKDIR /app

COPY package*.json ./
# No --include=dev: everything the build needs is a production dependency (see render.yaml).
RUN npm ci

# server/data.ts reads docs/api-samples/*.json at startup, and server.ts serves public/ and dist/.
COPY index.html vite.config.ts tsconfig.json tailwind.config.js postcss.config.js ./
COPY src ./src
COPY public ./public
COPY server ./server
COPY server.ts ./
COPY docs ./docs

RUN npm run build

# DATABASE_URL / ADMIN_BOOTSTRAP_PASSWORD / ALLOWED_ORIGINS are supplied by the platform at runtime.
# Nothing secret belongs in this image: .env is excluded by .dockerignore and VITE_API_BASE_URL is
# only ever an origin, never a credential.
ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["npm", "start"]
