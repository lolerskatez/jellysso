FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Environment variables for reverse proxy support
ENV TRUST_PROXY=true
ENV DOCKER=true

EXPOSE 3000

CMD ["npm", "start"]