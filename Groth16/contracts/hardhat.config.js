// Sao y zk-halo2-onchain/contracts/hardhat.config.js, đổi ĐÚNG một thứ: cổng RPC.
//
// 🔴 KHÔNG bật optimizer. Bản ONC cũng không bật tường minh
// (artifact_sizes.json ghi: "optimizer: theo hardhat.config.js — mặc định,
// chưa bật tường minh"). Bật một bên mà không bật bên kia thì phép so kích
// thước bytecode và gas mất giá trị.

require("@nomiclabs/hardhat-ethers");

module.exports = {
    solidity: {
      compilers: [
        {
          version: "0.8.19",
        },
        {
          version: "0.8.20",
        }
      ],
    },

    networks: {
        hardhat: {
          blockGasLimit: 30000000
        },
        ganache: {
            // 8546 — KHÔNG phải 8545. Hai repo kia dùng 8545.
            url: "http://127.0.0.1:8546",
            gasLimit: 30000000
        }
    }
};
