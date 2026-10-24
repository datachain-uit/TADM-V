import { Web3 } from 'web3';
import { getBlockchainRpcUrl } from '../../config/env';
import { retryChainRead } from '../../utils/chainRead';

const artifact = require('../../../../contracts/artifacts/' + 'contracts/ShieldedPool.sol/' + 'ShieldedPool.json');

let web3Instance: any;

function getWeb3() {
  if (!web3Instance) {
    web3Instance = new Web3(getBlockchainRpcUrl());
  }

  return web3Instance;
}

function normalizeAddress(address: string) {
  const web3 = getWeb3();

  if (!address || !web3.utils.isAddress(address)) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }

  return address.toLowerCase();
}

function normalizePrivateKey(privateKey: string) {
  const normalized = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;

  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('Private key must contain exactly 32 bytes');
  }

  return normalized;
}

function assertUnsignedWei(
  value: string,

  fieldName: string,
) {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${fieldName} must be an unsigned decimal wei string`);
  }

  return BigInt(value).toString();
}

function addPrivateKeyAccount(privateKey: string) {
  const web3 = getWeb3();

  const account = web3.eth.accounts.privateKeyToAccount(normalizePrivateKey(privateKey));

  web3.eth.accounts.wallet.add(account);

  return account;
}

async function resolveSender(
  expectedAddress: string,

  privateKey?: string,
) {
  const web3 = getWeb3();

  const expected = normalizeAddress(expectedAddress);

  if (privateKey) {
    const account = addPrivateKeyAccount(privateKey);

    if (normalizeAddress(account.address) !== expected) {
      throw new Error('Private key does not belong to the expected wallet address');
    }

    return account.address;
  }

  const unlockedAccounts = await web3.eth.getAccounts();

  const unlocked = unlockedAccounts.find((address: string) => address.toLowerCase() === expected);

  if (!unlocked) {
    throw new Error(
      'Expected wallet is not unlocked by the RPC node. ' +
        'Provide its private key through the documented environment variable.',
    );
  }

  return unlocked;
}

function getShieldedPoolContract(contractAddress: string) {
  const web3 = getWeb3();

  return new web3.eth.Contract(artifact.abi, normalizeAddress(contractAddress));
}

function schoolAddressOf(pool: any): string {
  return String(pool.universityAddress);
}

function withGasBuffer(estimatedGas: bigint) {
  return ((estimatedGas * 120n) / 100n).toString();
}

async function deployShieldedPool(
  universityAddress: string,

  initialFundingWei: string,

  universityPrivateKey?: string,

  denominationWei: string = '0',
) {
  const web3 = getWeb3();

  const fundingWei = assertUnsignedWei(initialFundingWei, 'initialFundingWei');

  const sender = await resolveSender(universityAddress, universityPrivateKey);

  const deployment = new web3.eth.Contract(artifact.abi).deploy({
    data: artifact.bytecode,

    arguments: [assertUnsignedWei(denominationWei, 'denominationWei')],
  });

  const estimatedGas = BigInt(
    await deployment.estimateGas({
      from: sender,
      value: fundingWei,
    }),
  );

  let transactionHash = '';

  let gasUsed = '0';

  let deployBlock = 0n;

  const deployedContract = await deployment
    .send({
      from: sender,
      value: fundingWei,
      gas: withGasBuffer(estimatedGas),
    })
    .on('transactionHash', (hash: string) => {
      transactionHash = hash;
    })
    .on('receipt', (receipt: any) => {
      transactionHash = String(receipt.transactionHash);

      gasUsed = BigInt(receipt.gasUsed).toString();
      deployBlock = BigInt(receipt.blockNumber);
    });

  const contractAddress = normalizeAddress(deployedContract.options.address);

  if (!transactionHash) {
    throw new Error('Deployment completed without a transaction hash');
  }

  const contract = getShieldedPoolContract(contractAddress);

  const storedUniversity = normalizeAddress(
    String(await retryChainRead(() => contract.methods.school().call({}, deployBlock))),
  );

  if (storedUniversity !== normalizeAddress(universityAddress)) {
    throw new Error('Deployed pool stored an unexpected university address');
  }

  return {
    contractAddress,
    universityAddress: storedUniversity,
    chainId: BigInt(await web3.eth.getChainId()).toString(),
    transactionHash: transactionHash.toLowerCase(),
    gasUsed,
    balanceWei: await getPoolBalance(contractAddress, deployBlock),
  };
}

async function assertPoolUniversity(
  contractAddress: string,

  expectedUniversityAddress: string,

  expectedChainId?: string,
) {
  const web3 = getWeb3();

  if (expectedChainId && BigInt(await web3.eth.getChainId()).toString() !== BigInt(expectedChainId).toString()) {
    throw new Error('RPC chainId does not match the scholarship pool chainId');
  }

  const contract = getShieldedPoolContract(contractAddress);

  const onChainUniversity = normalizeAddress(String(await contract.methods.school().call()));

  if (onChainUniversity !== normalizeAddress(expectedUniversityAddress)) {
    throw new Error('Pool universityAddress does not match contract.school()');
  }

  return onChainUniversity;
}

async function getPoolBalance(contractAddress: string, blockNumber: bigint | 'latest' = 'latest') {
  const web3 = getWeb3();

  const address = normalizeAddress(contractAddress);

  return BigInt(await retryChainRead(() => web3.eth.getBalance(address, blockNumber))).toString();
}

async function fundScholarshipPool(
  contractAddress: string,

  amountWei: string,

  sponsorAddress: string,
) {
  const web3 = getWeb3();

  const amount = assertUnsignedWei(amountWei, 'amountWei');

  if (BigInt(amount) <= 0n) {
    throw new Error('Sponsor amount must be greater than zero');
  }

  const sponsor = await resolveSender(sponsorAddress);

  const receipt = await web3.eth.sendTransaction({
    from: sponsor,
    to: normalizeAddress(contractAddress),
    value: amount,
    gas: '50000',
  });

  return {
    sponsorAddress: normalizeAddress(sponsor),
    transactionHash: String(receipt.transactionHash).toLowerCase(),
    gasUsed: BigInt(receipt.gasUsed).toString(),
    balanceWei: await getPoolBalance(contractAddress, BigInt(receipt.blockNumber)),
  };
}

async function readSponsorFunding(
  contractAddress: string,

  transactionHash: string,
) {
  const web3 = getWeb3();

  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash || '')) {
    throw new Error('transactionHash must be a 0x-prefixed 32-byte hex string');
  }

  const hash = transactionHash.toLowerCase();

  let transaction: any;
  let receipt: any;

  try {
    [transaction, receipt] = await retryChainRead(() =>
      Promise.all([web3.eth.getTransaction(hash), web3.eth.getTransactionReceipt(hash)]),
    );
  } catch {
    throw new Error('Transaction not found or not mined yet');
  }

  if (BigInt(receipt.status) !== 1n) {
    throw new Error('Funding transaction reverted');
  }

  if (String(transaction.to || '').toLowerCase() !== normalizeAddress(contractAddress)) {
    throw new Error('Funding transaction was not sent to this pool');
  }

  const amountWei = BigInt(transaction.value).toString();

  if (BigInt(amountWei) <= 0n) {
    throw new Error('Funding transaction carries no ETH');
  }

  return {
    sponsorAddress: String(transaction.from).toLowerCase(),
    amountWei,
    transactionHash: hash,
    blockNumber: String(receipt.blockNumber),
    balanceWei: await getPoolBalance(contractAddress, BigInt(receipt.blockNumber)),
  };
}

export {
  artifact,
  getWeb3,
  normalizeAddress,
  assertUnsignedWei,
  resolveSender,
  getShieldedPoolContract,
  deployShieldedPool,
  assertPoolUniversity,
  getPoolBalance,
  fundScholarshipPool,
  readSponsorFunding,
  withGasBuffer,
  schoolAddressOf,
};
