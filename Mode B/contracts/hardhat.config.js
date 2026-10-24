require('@nomiclabs/hardhat-ethers');

module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.19',
        settings: { evmVersion: 'paris' },
      },
      {
        version: '0.8.20',
        settings: { evmVersion: 'paris' },
      },
    ],
  },

  networks: {
    hardhat: {
      blockGasLimit: 30000000,
    },
    ganache: {
      url: 'http://127.0.0.1:8545',
      gasLimit: 30000000,
    },
  },
};
