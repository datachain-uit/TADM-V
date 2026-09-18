async function main() {

    const [university] =
        await ethers.getSigners();

    const initialFundingWei =
        process.env.INITIAL_FUNDING_WEI
        ||
        ethers.utils
            .parseEther(
                "1"
            )
            .toString();

    const Pool = await ethers.getContractFactory(
        "ShieldedPool",
        university
    );

    const pool = await Pool.deploy({
        value:
            initialFundingWei
    });

    await pool.deployed();

    console.log(
        JSON.stringify(
            {
                contractAddress:
                    pool.address,
                universityAddress:
                    await pool.school(),
                initialFundingWei,
                balanceWei:
                    (
                        await pool.getBalance()
                    ).toString()
            },
            null,
            2
        )
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
