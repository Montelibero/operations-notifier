# Use the official Node.js image
FROM node:20

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the source code
COPY . .

# Metadata for the container image
ENV SERVICE_VERSION=0.5.3
LABEL org.opencontainers.image.version="0.5.3"

# Expose the API port
EXPOSE 4021

# Start the service
CMD ["npm", "run", "start"]
