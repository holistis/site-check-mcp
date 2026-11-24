# Runs the server over stdio, so a directory (or you) can start it and ask it for its tools.
# The check itself is not run in this container: the check_site tool forwards the call to the hosted,
# payment-guarded endpoint, and without a payment it answers with the payment instructions.
FROM node:22-alpine

WORKDIR /app

# Manifest and lockfile first, so a change to the source does not invalidate the install layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY index.mjs client-ip.mjs ./

USER node
ENTRYPOINT ["node", "index.mjs", "--stdio"]
