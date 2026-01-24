FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
