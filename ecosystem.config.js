module.exports = {
  apps: [{
    name: 'video-generator',
    script: 'server.js',
    watch: true,
    ignore_watch: ['node_modules', 'temp', 'output'],
    instances: 1,
    autorestart: true,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
}
