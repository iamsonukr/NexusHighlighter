import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      // The extension's background service worker calls this API directly
      // and isn't subject to page-style CORS the way a browser tab is, so
      // this mainly matters if/when a web dashboard is added later.
      origin: config.clientUrl,
    })
  );
  app.use(express.json({ limit: '256kb' })); // highlight/note payloads are small; this also caps abuse
  app.use(
    morgan('tiny', {
      stream: { write: (line) => logger.info('http_request', { line: line.trim() }) },
    })
  );

  app.use('/api', apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
