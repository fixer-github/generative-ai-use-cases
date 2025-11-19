type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogContext {
  [key: string]: unknown;
}

interface StructuredLog {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

class Logger {
  private formatLog(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): StructuredLog {
    const log: StructuredLog = {
      level,
      message,
      timestamp: new Date().toISOString(),
    };

    if (context) {
      log.context = context;
    }

    if (error) {
      log.error = {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    }

    return log;
  }

  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): void {
    const structuredLog = this.formatLog(level, message, context, error);
    console.log(JSON.stringify(structuredLog));
  }

  debug(message: string, context?: LogContext): void {
    this.log('DEBUG', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('INFO', message, context);
  }

  warn(message: string, context?: LogContext, error?: Error): void {
    this.log('WARN', message, context, error);
  }

  error(message: string, context?: LogContext, error?: Error): void {
    this.log('ERROR', message, context, error);
  }
}

export const logger = new Logger();
