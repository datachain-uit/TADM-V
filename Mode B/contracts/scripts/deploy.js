async function main() {
    const Verifier = await ethers.getContractFactory("Halo2Verifier");
    const verifier = await Verifier.deploy();
    await verifier.deployed();

    console.log("Verifier:", verifier.address);

    const Pool = await ethers.getContractFactory("ShieldedPool");
    const pool = await Pool.deploy(verifier.address, {
        value: ethers.utils.parseEther("1")
    });

    await pool.deployed();

    console.log("Pool:", pool.address);
}


main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });