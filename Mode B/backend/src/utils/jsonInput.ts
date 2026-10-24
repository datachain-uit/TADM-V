import fs from 'fs';

function readJsonInput(filePath?: string): unknown {
  const hasPath = typeof filePath === 'string' && filePath.length > 0;

  let raw: string;
  if (hasPath) {
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (error: any) {
      throw new Error(
        `Cannot read JSON input file "${filePath}": ${error.message}.` +
          ' Check the path, or omit it to read from stdin.',
      );
    }
  } else {
    raw = fs.readFileSync(0, 'utf8');
  }

  const text = String(raw).replace(/^﻿/, '').trim();
  if (text.length === 0) {
    throw new Error('No JSON input: pass a file path' + ' (npm run <script> -- input.json) or pipe JSON on stdin');
  }

  try {
    return JSON.parse(text);
  } catch (error: any) {
    const source = hasPath ? `file ${filePath}` : 'stdin';
    throw new Error(`Input from ${source} is not valid JSON: ${error.message}`);
  }
}

export { readJsonInput };
