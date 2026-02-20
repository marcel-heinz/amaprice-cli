FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY bin ./bin
COPY src ./src

CMD ["npm", "run", "worker"]
