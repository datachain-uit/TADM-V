import fs from 'fs';

function printJson(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');

  console.error(`JSON written to ${filePath}`);
}

function emitJson(filePath: string | undefined, value: unknown) {
  if (typeof filePath === 'string' && filePath.length > 0) {
    writeJson(filePath, value);
    return;
  }
  printJson(value);
}

export { printJson, writeJson, emitJson };
