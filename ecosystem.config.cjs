module.exports = {
  apps: [
    {
      name: "demand-automator",
      script: "worker.js",
      args: "--target=prod",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      env: {
        NODE_ENV: "production",
        AUTH_TOKEN: "" // Put your Azure AD Bearer Token here
      }
    }
  ]
};
