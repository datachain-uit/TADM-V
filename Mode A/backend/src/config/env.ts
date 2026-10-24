import path from 'path';

const NETWORKS = ['ganache', 'sepolia'];

const network = process.env.NETWORK;

if (network !== undefined && !NETWORKS.includes(network)) {
  throw new Error(`NETWORK must be one of ${NETWORKS.join(', ')}, got "${network}"`);
}

const environmentFile = path.resolve(__dirname, network ? `../../.env.${network}` : '../../.env');

require('dotenv').config({
  path: environmentFile,
  quiet: true,
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing. Check ${path.basename(environmentFile)}`);
  return value;
}

function getBlockchainRpcUrl(): string {
  return process.env.BLOCKCHAIN_RPC_URL || 'http://127.0.0.1:8545';
}

function getIpfsConfiguration() {
  return {
    host: process.env.IPFS_HOST || '127.0.0.1',
    port: Number(process.env.IPFS_PORT || 5001),
    protocol: process.env.IPFS_PROTOCOL || 'http',
  };
}

export { requiredEnvironment, getBlockchainRpcUrl, getIpfsConfiguration, network, environmentFile };
