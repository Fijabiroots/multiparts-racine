module.exports = {
  apps: [
    {
      name: 'price-request-generator',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // Logs
      error_file: './logs/error.log',
      out_file: './logs/output.log',
      log_file: './logs/combined.log',
      time: true,
      // Redémarrage automatique
      cron_restart: '0 4 * * *', // Redémarrer tous les jours à 4h du matin
      // Gestion des erreurs
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
    },
  ],
};
