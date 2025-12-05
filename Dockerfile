# Используем официальный образ Node.js
FROM node:20

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код
COPY . .

# (Опционально) Указываем порт, если нужен для API
EXPOSE 4021

# Команда для запуска сервиса
CMD ["npm", "run", "start"]
