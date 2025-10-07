FROM node:23.11.1

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

RUN npm run build

RUN addgroup -g 1001 -S nodejs

RUN adduser -S fastify -u 1001

RUN chown -R fastify:nodejs /app

USER fastify

EXPOSE 3001

CMD ["npm", "start"]