const { authorizeStaff } = require("./authorizeStaffService");
const { ScholarshipPool } = require("../models/ScholarshipPool");
const { getWeb3, requireUnlockedAccount } = require("../clients/blockchain/blockchainClient");

async function fundScholarshipPool(poolId: string, staffId: string, amountWei: string, sponsorAddress: string) {
    if (!/^\d+$/.test(amountWei) || BigInt(amountWei) <= 0n) throw new Error("amountWei must be positive");
    const pool = await ScholarshipPool.findById(poolId);
    if (!pool || pool.status !== "DEPLOYED" || !pool.contractAddress) throw new Error("Deployed pool not found");

    // K9 — nap tien thuoc Phong KH-TC.
    await authorizeStaff(String(pool.university), staffId, "FINANCE");
    const sponsor = await requireUnlockedAccount(sponsorAddress);
    const web3 = getWeb3();
    const transaction = { from: sponsor, to: pool.contractAddress, value: amountWei };
    const estimatedGas = Number(await web3.eth.estimateGas(transaction));
    const receipt = await web3.eth.sendTransaction({ ...transaction, gas: Math.ceil(estimatedGas * 1.2) });
    pool.totalSponsorFundingWei =
        (BigInt(pool.totalSponsorFundingWei || "0") + BigInt(amountWei)).toString();
    await pool.save();
    return {
        poolId: pool.id,
        sponsor,
        amountWei,
        transactionHash: receipt.transactionHash,
        balanceWei: String(await web3.eth.getBalance(pool.contractAddress)),
        totalSponsorFundingWei: pool.totalSponsorFundingWei,
    };
}



module.exports = { fundScholarshipPool };

if (require.main === module) {
    require("../cli/poolCli")
        .runFundPoolCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
