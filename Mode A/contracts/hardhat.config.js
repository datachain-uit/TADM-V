require("@nomiclabs/hardhat-ethers");

module.exports = {
    /*
     * evmVersion GHIM TUONG MINH — 2026-08-23.
     *
     * Truoc day khong ghim, solc 0.8.20 mac dinh ra "paris" (Hardhat
     * chot nhu vay de tranh PUSH0). Bytecode KHONG DOI khi ghim lai —
     * chi bo cho mong manh: nang solc la mac dinh co the doi, keo theo
     * bytecode va deploy gas doi AM THAM.
     *
     * Vi sao quan trong: GAS la dai luong dem theo dac ta EVM, nen so
     * do tren Ganache bang dung so tren mainnet — NHUNG CHI KHI cung
     * hardfork. Gia gas tung doi qua cac dot nang cap (Berlin doi gia
     * SLOAD/CALL, London doi hoan tien). Khong ghim hardfork thi lap
     * luan "gas chuyen duoc sang mainnet" mat co so.
     *
     * Cac opcode he nay dung (SLOAD, SSTORE, CALL, STATICCALL, bo nho,
     * calldata) co gia doi lan cuoi o Berlin/London — deu TRUOC paris.
     * Shanghai va Cancun chi THEM opcode moi, khong doi gia opcode cu.
     * => so gas do duoc van dung cho mainnet hien tai.
     *
     * Xem code/DINH_NGHIA_PHEP_DO.md muc 3c.
     */
    solidity: {
        version: "0.8.20",
        settings: {
            evmVersion: "paris"
        }
    },

    networks: {
        ganache: {
            url: "http://127.0.0.1:8545",
        }
    }
};