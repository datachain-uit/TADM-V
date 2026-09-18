require("@nomiclabs/hardhat-ethers");

module.exports = {
    // solidity: "0.8.19",
    /*
     * evmVersion GHIM TUONG MINH — 2026-08-23. Xem ban ADV cua file
     * nay va code/DINH_NGHIA_PHEP_DO.md muc 3c.
     *
     * Truoc day: 0.8.20 -> "paris" (Hardhat chot), 0.8.19 -> KHONG
     * ghim, an theo mac dinh cua solc. Hai compiler an theo hai co
     * che khac nhau ma tinh co ra cung "paris". Ghim lai cho ca hai
     * => bytecode KHONG DOI, chi bo cho mong manh.
     *
     * GAS la dai luong dem theo dac ta EVM: cung bytecode + cung
     * hardfork thi Ganache va mainnet dem ra CUNG MOT SO. Do la co so
     * de noi "so gas do tren Ganache dai dien duoc cho mainnet" —
     * khac han THOI GIAN, thu khong chuyen duoc (Ganache chay EVM
     * bang JavaScript). Khong ghim hardfork thi lap luan do mat co so.
     */
    solidity: {
      compilers: [
        {
          version: "0.8.19",
          settings: { evmVersion: "paris" }
        },
        {
          version: "0.8.20",
          settings: { evmVersion: "paris" }
        }
      ],
    },

    networks: {
        hardhat: {
          blockGasLimit: 30000000 // Đảm bảo block gas đủ lớn
        },
        ganache: {
            url: "http://127.0.0.1:8545",
            gasLimit: 30000000
        }
    }
};