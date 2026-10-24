import { getBlockchainRpcUrl } from '../../config/env';
import path from 'path';
import { Web3 } from 'web3';
import { retryChainRead } from '../../utils/chainRead';

const signingKeys = new Map<string, string>();

function getWeb3() {
  const web3 = new Web3(getBlockchainRpcUrl());
  for (const privateKey of signingKeys.values()) web3.eth.accounts.wallet.add(privateKey);
  return web3;
}

function loadArtifact(name: string) {
  return require(path.resolve(__dirname, `../../../../contracts/artifacts/contracts/${name}.sol/${name}.json`));
}

async function requireUnlockedAccount(address: string) {
  const web3 = getWeb3();
  const accounts: string[] = await web3.eth.getAccounts();
  const account = accounts.find((candidate) => candidate.toLowerCase() === address.toLowerCase());
  if (!account) throw new Error(`RPC does not expose unlocked account ${address}`);
  return account;
}

async function resolveSender(expectedAddress: string, privateKey?: string) {
  if (!privateKey) return requireUnlockedAccount(expectedAddress);
  const normalized = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error('Private key must contain exactly 32 bytes');
  const account = new Web3().eth.accounts.privateKeyToAccount(normalized);
  if (account.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error('Private key does not belong to the expected wallet address');
  }
  signingKeys.set(account.address.toLowerCase(), normalized);
  return account.address;
}

async function deployContract(name: string, from: string, args: unknown[] = [], value = '0') {
  const web3 = getWeb3();
  const artifact = loadArtifact(name);
  const deployment = new web3.eth.Contract(artifact.abi).deploy({
    data: artifact.bytecode,
    arguments: args,
  });
  const estimatedGas = Number(await retryChainRead(() => deployment.estimateGas({ from, value })));
  let transactionHash = '';
  let gasUsed = '0';
  let blockNumber = 0n;
  const contract = await deployment
    .send({
      from,
      value,
      gas: Math.ceil(estimatedGas * 1.2) as unknown as string,
    })
    .on('receipt', (receipt: any) => {
      transactionHash = String(receipt.transactionHash).toLowerCase();
      gasUsed = BigInt(receipt.gasUsed).toString();
      blockNumber = BigInt(receipt.blockNumber);
    });
  return { contract, estimatedGas, transactionHash, gasUsed, blockNumber };
}

function getContract(name: string, address: string): any {
  const web3 = getWeb3();
  return new web3.eth.Contract(loadArtifact(name).abi, address);
}

function getPool(address: string) {
  return getContract('ShieldedPool', address);
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

export {
  deployContract,
  getContract,
  getPool,
  getWeb3,
  loadArtifact,
  requireUnlockedAccount,
  resolveSender,
  sameAddress,
};
