FROM node:18

WORKDIR /app

COPY package.json ./
RUN npm install
RUN npm install sequelize sqlite3

COPY . .

CMD ["node", "index.js"]