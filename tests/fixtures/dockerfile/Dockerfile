FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci &&     npm cache clean --force
COPY . .
RUN npm run build && \
rm -rf node_modules && \
        npm ci --omit=dev
FROM node:20-alpine
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node","dist/server.js"]
