// config/database.js - Environment-specific database configuration
const path = require('path');

const environments = {
  development: {
    database: path.join(__dirname, '../.data/chatcast-dev.db'),
    messages: path.join(__dirname, '../.data/messages-dev.db')
  },
  production: {
    database: path.join(__dirname, '../data/chatcast-prod.db'),
    messages: path.join(__dirname, '../data/messages-prod.db')
  },
  test: {
    database: path.join(__dirname, '../.data/chatcast-test.db'),
    messages: path.join(__dirname, '../.data/messages-test.db')
  }
};

const env = process.env.NODE_ENV || 'development';

module.exports = {
  current: environments[env],
  environment: env,
  isDevelopment: env === 'development',
  isProduction: env === 'production',
  isTest: env === 'test'
};

// config/telegram.js - Environment-specific Telegram configuration
const telegramConfig = {
  development: {
    token: process.env.TELEGRAM_BOT_TOKEN_DEV || process.env.TELEGRAM_BOT_TOKEN,
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL_DEV,
    disabled: process.env.TELEGRAM_DISABLED === 'true'
  },
  production: {
    token: process.env.TELEGRAM_BOT_TOKEN_PROD || process.env.TELEGRAM_BOT_TOKEN,
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL_PROD,
    disabled: process.env.TELEGRAM_DISABLED === 'true'
  },
  test: {
    token: process.env.TELEGRAM_BOT_TOKEN_TEST,
    webhookUrl: null,
    disabled: true // Always disabled in test environment
  }
};

const env = process.env.NODE_ENV || 'development';

module.exports = {
  ...telegramConfig[env],
  environment: env
};
