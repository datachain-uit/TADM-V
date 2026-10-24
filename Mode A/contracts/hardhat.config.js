require('@nomiclabs/hardhat-ethers');

module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      evmVersion: 'paris',
    },
  },

  networks: {
    ganache: {
      url: 'http://127.0.0.1:8545',
    },
  },
};
