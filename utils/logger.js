const moment = require('moment');

class Logger {
  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
  }

  formatMessage(level, message, data = null) {
    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
    const emoji = {
      info: 'ℹ️',
      success: '✅',
      error: '❌',
      warn: '⚠️',
      debug: '🔍'
    }[level] || 'ℹ️';

    let logMessage = `[${timestamp}] ${emoji} ${level.toUpperCase()}: ${message}`;
    
    if (data && this.isDevelopment) {
      logMessage += `\n${JSON.stringify(data, null, 2)}`;
    }
    
    return logMessage;
  }

  info(message, data) {
    console.log(this.formatMessage('info', message, data));
  }

  success(message, data) {
    console.log(this.formatMessage('success', message, data));
  }

  error(message, error) {
    const errorData = error ? {
      message: error.message,
      stack: this.isDevelopment ? error.stack : undefined
    } : null;
    console.error(this.formatMessage('error', message, errorData));
  }

  warn(message, data) {
    console.warn(this.formatMessage('warn', message, data));
  }

  debug(message, data) {
    if (this.isDevelopment) {
      console.log(this.formatMessage('debug', message, data));
    }
  }

  // Log API requests (for development)
  logRequest(req) {
    if (this.isDevelopment) {
      this.debug(`${req.method} ${req.originalUrl}`, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        body: req.body
      });
    }
  }

  // Log cron job execution
  logCron(jobName, result) {
    this.info(`Cron job: ${jobName}`, result);
  }

  // Log SMS sent
  logSMS(mobile, type, success) {
    const status = success ? '✅ Sent' : '❌ Failed';
    this.info(`SMS ${status}: ${type} to ${mobile}`);
  }

  // Log database operations
  logDB(operation, collection, success) {
    if (success) {
      this.debug(`DB: ${operation} on ${collection}`);
    } else {
      this.error(`DB: Failed ${operation} on ${collection}`);
    }
  }
}

module.exports = new Logger();
