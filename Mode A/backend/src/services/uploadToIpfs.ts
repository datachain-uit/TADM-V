// Compatibility export. New code should import from clients/ipfs.
module.exports = {
    ...require("../clients/ipfs/encryptedNoteStorage"),
    ...require("../clients/ipfs/noteEncryption")
};
