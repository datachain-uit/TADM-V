require('@nomiclabs/hardhat-ethers');

module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.19',
      },
      {
        version: '0.8.20',
      },
    ],
  },

  networks: {
    hardhat: {
      blockGasLimit: 30000000,
    },
    ganache: {
      url: 'http://127.0.0.1:8546',
      gasLimit: 30000000,
    },
  },
};
