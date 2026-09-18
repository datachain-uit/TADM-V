const { create } = require("ipfs-http-client");
const {
    getIpfsConfiguration
} = require("../../config/environment");

let ipfsClient: any;

function getIpfsClient() {
    if (!ipfsClient) {
        ipfsClient = create(getIpfsConfiguration());
    }

    return ipfsClient;
}

module.exports = {
    getIpfsClient
};
