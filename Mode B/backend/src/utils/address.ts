import { Web3 } from 'web3';

function normalizeAddress(address: string): string {
  if (!address || !Web3.utils.isAddress(address)) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }

  return address.toLowerCase();
}

export { normalizeAddress };
