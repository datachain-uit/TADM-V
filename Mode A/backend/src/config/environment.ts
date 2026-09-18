const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "../../.env"),
    quiet: true
});

function requiredEnvironment(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`${name} is missing. Check backend/.env`);
    }

    return value;
}

function getBlockchainRpcUrl(): string {
    return process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545";
}

function getIpfsConfiguration() {
    return {
        host: process.env.IPFS_HOST || "127.0.0.1",
        port: Number(process.env.IPFS_PORT || 5001),
        protocol: process.env.IPFS_PROTOCOL || "http"
    };
}

module.exports = {
    requiredEnvironment,
    getBlockchainRpcUrl,
    getIpfsConfiguration
};
