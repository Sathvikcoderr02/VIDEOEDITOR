module.exports = {
  apps: [
    {
      name: 'video-generator',
      script: 'server.js',
      watch: true,
      ignore_watch: ['node_modules', 'temp', 'output'],
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        NODE_OPTIONS: '--max-old-space-size=4096' // Increase memory to 4GB
      },
      env_production: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=4096'
      }
    }
  ]
};
