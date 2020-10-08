FROM node:alpine

WORKDIR /app

COPY package.json ./

RUN npm install

COPY index.js ./
COPY config.js ./
COPY melcloud/ ./melcloud

CMD [ "node", "index.js" ]