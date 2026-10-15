# Lightweight Node.js Runner for AWS EC2 / ECS / App Runner
FROM node:20-alpine

WORKDIR /app

# Copy project files
COPY package.json config.js classifier.js ai-pitch-generator.js engine.js worker.js ./

# Copy resume
COPY /Users/pnkj/Downloads/Resume-3177277-pankaj.kumar07@nagarro.com-2026.09.18-20.16.29.docx ./resume.docx

# Set default environment variables
ENV NODE_ENV=production
ENV TARGET=prod

# Run the automation worker daemon
CMD ["node", "worker.js", "--target=prod"]
