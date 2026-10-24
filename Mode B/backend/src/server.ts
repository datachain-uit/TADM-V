import fs from 'fs';
import { network, environmentFile, requiredEnvironment } from './config/env';
import { holdDatabaseConnection } from './config/db';
import { getWeb3 } from './clients/blockchain/blockchainClient';
import { createApp } from './app';

const EXPECTED_CHAIN_ID: Record<string, bigint> = {
  ganache: 1337n,
  sepolia: 11155111n,
};

const PROTECTED_DATABASE_WORDS = ['qualitative', 'experiment'];

function databaseName(uri: string): string {
  const name = new URL(uri).pathname.replace(/^\//, '');

  if (!name) {
    throw new Error('MONGODB_URI must name a database (…/<databaseName>?…)');
  }

  return name;
}

async function startServer() {
  if (!network) {
    throw new Error('NETWORK is not set. Start with NETWORK=ganache or NETWORK=sepolia');
  }

  if (!fs.existsSync(environmentFile)) {
    throw new Error(
      `Configuration file not found: ${environmentFile}` + ` (copy .env.${network}.example and fill it in)`,
    );
  }

  const database = databaseName(requiredEnvironment('MONGODB_URI'));

  if (PROTECTED_DATABASE_WORDS.some((word) => database.toLowerCase().includes(word))) {
    throw new Error(
      `Refusing to serve on database "${database}": it belongs to an experiment.` +
        ' Point MONGODB_URI in the network file at a database of its own.',
    );
  }

  const chainId = BigInt(await getWeb3().eth.getChainId());
  const expected = EXPECTED_CHAIN_ID[network];

  if (chainId !== expected) {
    throw new Error(`RPC chainId is ${chainId}, but NETWORK=${network} expects ${expected}`);
  }

  await holdDatabaseConnection();

  const port = Number(process.env.HTTP_PORT || 3001);

  createApp().listen(port, () => {
    console.error(`TADM-V server: network=${network} chainId=${chainId}` + ` database=${database} port=${port}`);
  });
}

export { startServer };

if (require.main === module) {
  startServer().catch((error: any) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
