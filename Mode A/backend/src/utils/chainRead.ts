const CHAIN_READ_ATTEMPTS = 20;
const CHAIN_READ_DELAY_MS = 3000;

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function retryChainRead<T>(
  read: () => Promise<T>,
  attempts: number = CHAIN_READ_ATTEMPTS,
  delayMs: number = CHAIN_READ_DELAY_MS,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await read();
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Chain read still failing after ${attempts} attempts: ${reason}`);
}

export { retryChainRead };
