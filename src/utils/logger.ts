import winston from 'winston';
import { config } from '../config';

const fmt = config.app.env === 'production'
  ? winston.format.combine(winston.format.timestamp(), winston.format.json())
  : winston.format.combine(winston.format.colorize(), winston.format.timestamp({ format: 'HH:mm:ss' }), winston.format.simple());

export const logger = winston.createLogger({
  level: 'debug',
  format: fmt,
  defaultMeta: { service: 'recon-engine' },
  transports: [new winston.transports.Console()],
});
