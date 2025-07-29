FROM node:18

WORKDIR /appdata

COPY package.json ./
RUN npm install

COPY . .

CMD ["node", "index.js"]