import type { NextFunction, Request, Response } from 'express';

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function notFoundHandler(_request: Request, response: Response) {
  response.status(404).json({ error: 'Not found' });
}

function errorHandler(error: any, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message });
    return;
  }

  if (error?.type === 'entity.parse.failed') {
    response.status(400).json({ error: 'Request body is not valid JSON' });
    return;
  }

  console.error('HTTP request failed:', error?.message ?? error);
  response.status(400).json({ error: String(error?.message ?? 'Request failed') });
}

export { HttpError, notFoundHandler, errorHandler };
