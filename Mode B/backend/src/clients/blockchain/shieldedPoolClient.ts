import {
  deployContract,
  getPool,
  getWeb3,
  requireUnlockedAccount,
  resolveSender,
  sameAddress,
} from './blockchainClient';
import { retryChainRead } from '../../utils/chainRead';

const VERIFIER_CALL_GAS = 3_000_000;

function normalizeCalldata(proofData: any) {
  return proofData.calldata.startsWith('0x') ? proofData.calldata : `0x${proofData.calldata}`;
}

function extractPublicInputs(proofAndSignals: string) {
  if (!/^0x[0-9a-fA-F]+$/.test(proofAndSignals)) {
    throw new Error('Invalid calldata hex');
  }

  if (proofAndSignals.length < 2 + 256) {
    throw new Error('Calldata is too short for root, nullifier, amount and recipient');
  }

  const root = `0x${proofAndSignals.slice(2, 66)}`;

  const nullifier = `0x${proofAndSignals.slice(66, 130)}`;

  const amountHex = `0x${proofAndSignals.slice(130, 194)}`;

  const amountWei = BigInt(amountHex).toString();

  const recipientWord = `0x${proofAndSignals.slice(194, 258)}`;

  const recipient = `0x${recipientWord.slice(26)}`;

  return {
    root,
    nullifier,
    amountHex,
    amountWei,
    recipientWord,
    recipient,
  };
}

function extractRootAndNullifier(proofAndSignals: string) {
  const { root, nullifier } = extractPublicInputs(proofAndSignals);

  return {
    root,
    nullifier,
  };
}

async function verifyProofByCall(
  verifierAddress: string,

  proofAndSignals: string,
) {
  return await getWeb3().eth.call({
    to: verifierAddress,

    data: proofAndSignals,

    gas: VERIFIER_CALL_GAS,
  });
}

async function withdrawWithProofData(
  contract: any,

  proofData: any,

  recipient: string,

  amountWei: string,

  from: string,
) {
  const proofAndSignals = normalizeCalldata(proofData);

  const { root, nullifier } = extractRootAndNullifier(proofAndSignals);

  return await contract.methods.withdraw(proofAndSignals, root, nullifier, recipient, amountWei).send({
    from,

    gas: 5000000,
  });
}

async function verifyAndRecordWithProofData(
  contract: any,

  proofData: any,

  recipient: string,

  amountWei: string,

  from: string,
) {
  const proofAndSignals = normalizeCalldata(proofData);

  const { root, nullifier } = extractRootAndNullifier(proofAndSignals);

  return await contract.methods.verifyAndRecord(proofAndSignals, root, nullifier, recipient, amountWei).send({
    from,

    gas: 5000000,
  });
}

async function settleByNullifier(
  contract: any,

  nullifier: string,

  from: string,
) {
  return await contract.methods.settle(nullifier).send({
    from,

    gas: 5000000,
  });
}

function assertUnsignedWei(value: string, fieldName: string) {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${fieldName} must be an unsigned decimal wei string`);
  }

  return BigInt(value).toString();
}

function getShieldedPoolContract(contractAddress: string) {
  return getPool(contractAddress);
}

function withGasBuffer(estimatedGas: bigint) {
  return ((estimatedGas * 120n) / 100n).toString();
}

function schoolAddressOf(pool: any): string {
  return String(pool.operatorAddress || pool.universityAddress);
}

async function getPoolBalance(contractAddress: string, blockNumber: bigint | 'latest' = 'latest') {
  return BigInt(await retryChainRead(() => getWeb3().eth.getBalance(contractAddress, blockNumber))).toString();
}

async function deployShieldedPool(
  universityAddress: string,
  initialFundingWei: string,
  universityPrivateKey?: string,
  denominationWei: string = '0',
) {
  const fundingWei = assertUnsignedWei(initialFundingWei, 'initialFundingWei');
  const sender = await resolveSender(universityAddress, universityPrivateKey);
  const verifier = await deployContract('Halo2Verifier', sender);
  const verifierAddress = String(verifier.contract.options.address).toLowerCase();
  const deployment = await deployContract(
    'ShieldedPool',
    sender,
    [verifierAddress, assertUnsignedWei(denominationWei, 'denominationWei')],
    fundingWei,
  );
  const contractAddress = String(deployment.contract.options.address).toLowerCase();

  if (!deployment.transactionHash) {
    throw new Error('Deployment completed without a transaction hash');
  }

  const storedUniversity = String(
    await retryChainRead(() => getPool(contractAddress).methods.school().call({}, deployment.blockNumber)),
  ).toLowerCase();
  if (!sameAddress(storedUniversity, universityAddress)) {
    throw new Error('Deployed pool stored an unexpected university address');
  }

  return {
    contractAddress,
    verifierAddress,
    universityAddress: storedUniversity,
    chainId: BigInt(await getWeb3().eth.getChainId()).toString(),
    transactionHash: deployment.transactionHash,
    gasUsed: deployment.gasUsed,
    balanceWei: await getPoolBalance(contractAddress, deployment.blockNumber),
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

  const onChainUniversity = String(await getPool(contractAddress).methods.school().call()).toLowerCase();

  if (!sameAddress(onChainUniversity, expectedUniversityAddress)) {
    throw new Error('Pool universityAddress does not match contract.school()');
  }

  return onChainUniversity;
}

async function fundScholarshipPool(contractAddress: string, amountWei: string, sponsorAddress: string) {
  const web3 = getWeb3();
  const amount = assertUnsignedWei(amountWei, 'amountWei');

  if (BigInt(amount) <= 0n) {
    throw new Error('Sponsor amount must be greater than zero');
  }

  const sponsor = await requireUnlockedAccount(sponsorAddress);
  const transaction = { from: sponsor, to: contractAddress, value: amount };
  const estimatedGas = Number(await web3.eth.estimateGas(transaction));
  const receipt = await web3.eth.sendTransaction({ ...transaction, gas: Math.ceil(estimatedGas * 1.2) });

  return {
    sponsorAddress: sponsor.toLowerCase(),
    transactionHash: String(receipt.transactionHash).toLowerCase(),
    gasUsed: BigInt(receipt.gasUsed).toString(),
    balanceWei: await getPoolBalance(contractAddress, BigInt(receipt.blockNumber)),
  };
}

async function readSponsorFunding(contractAddress: string, transactionHash: string) {
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

  if (!sameAddress(String(transaction.to || ''), contractAddress)) {
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
  getWeb3,
  resolveSender,
  getShieldedPoolContract,
  withGasBuffer,
  assertUnsignedWei,
  schoolAddressOf,
  getPoolBalance,
  deployShieldedPool,
  assertPoolUniversity,
  fundScholarshipPool,
  readSponsorFunding,
  normalizeCalldata,
  extractPublicInputs,
  extractRootAndNullifier,
  verifyProofByCall,
  withdrawWithProofData,
  verifyAndRecordWithProofData,
  settleByNullifier,
};
