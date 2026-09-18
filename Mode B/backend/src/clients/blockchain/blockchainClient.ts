require("dotenv").config({ quiet: true });

const path = require("path");
const { Web3 } = require("web3");

function getWeb3() {
    return new Web3(process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545");
}

function loadArtifact(name: string) {
    return require(
        path.resolve(
            __dirname,
            `../../../../contracts/artifacts/contracts/${name}.sol/${name}.json`,
        ),
    );
}

async function requireUnlockedAccount(address: string) {
    const web3 = getWeb3();
    const accounts: string[] = await web3.eth.getAccounts();
    const account = accounts.find((candidate) => candidate.toLowerCase() === address.toLowerCase());
    if (!account) throw new Error(`RPC does not expose unlocked account ${address}`);
    return account;
}

async function deployContract(name: string, from: string, args: unknown[] = [], value = "0") {
    const web3 = getWeb3();
    const artifact = loadArtifact(name);
    const deployment = new web3.eth.Contract(artifact.abi).deploy({
        data: artifact.bytecode,
        arguments: args,
    });
    const estimatedGas = Number(await deployment.estimateGas({ from, value }));
    const contract = await deployment.send({
        from,
        value,
        gas: Math.ceil(estimatedGas * 1.2),
    });
    return { contract, estimatedGas };
}

function getContract(name: string, address: string) {
    const web3 = getWeb3();
    return new web3.eth.Contract(loadArtifact(name).abi, address);
}

function getPool(address: string) {
    return getContract("ShieldedPool", address);
}

function sameAddress(left: string, right: string) {
    return left.toLowerCase() === right.toLowerCase();
}

module.exports = {
    deployContract,
    getContract,
    getPool,
    getWeb3,
    loadArtifact,
    requireUnlockedAccount,
    sameAddress,
};
