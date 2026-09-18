const assert =
    require("assert");

const {
    ethers
} = require(
    "hardhat"
);

async function assertReverted(
    action,
    expectedMessage
) {
    try {
        await action();
        assert.fail(
            "Expected transaction to revert"
        );

    } catch (error) {
        assert.match(
            String(
                error.message
            ),
            new RegExp(
                expectedMessage
            )
        );
    }
}

describe(
    "ShieldedPool",
    function () {
        let university;
        let sponsor;
        let student;
        let pool;

        beforeEach(
            async function () {
                [
                    university,
                    sponsor,
                    student
                ] =
                    await ethers
                        .getSigners();

                const Pool =
                    await ethers
                        .getContractFactory(
                            "ShieldedPool",
                            university
                        );

                // V1(b) — poolDenomination = 0 (khong cuong che menh gia).
                pool =
                    await Pool.deploy(0, {
                        value:
                            ethers.utils
                                .parseEther(
                                    "1"
                                )
                    });

                await pool.deployed();
            }
        );

        it(
            "stores the university deployer and initial balance",
            async function () {
                assert.strictEqual(
                    (
                        await pool.school()
                    ).toLowerCase(),
                    university.address
                        .toLowerCase()
                );

                assert.strictEqual(
                    (
                        await pool.getBalance()
                    ).toString(),
                    ethers.utils
                        .parseEther(
                            "1"
                        )
                        .toString()
                );
            }
        );

        it(
            "accepts sponsor ETH through receive()",
            async function () {
                await sponsor.sendTransaction({
                    to:
                        pool.address,
                    value:
                        ethers.utils
                            .parseEther(
                                "0.25"
                            )
                });

                assert.strictEqual(
                    (
                        await pool.getBalance()
                    ).toString(),
                    ethers.utils
                        .parseEther(
                            "1.25"
                        )
                        .toString()
                );
            }
        );

        it(
            "keeps updateRoot restricted to the university",
            async function () {
                const root =
                    ethers.utils
                        .hexZeroPad(
                            "0x1234",
                            32
                        );

                await pool.updateRoot(
                    root,
                    []
                );

                assert.strictEqual(
                    await pool.currentRoot(),
                    root
                );

                assert.strictEqual(
                    await pool.validRoot(
                        root
                    ),
                    true
                );

                await assertReverted(
                    () =>
                        pool
                            .connect(
                                sponsor
                            )
                            .updateRoot(
                                root,
                                []
                            ),
                    "not school"
                );
            }
        );

        it(
            "keeps withdrawOffChain and nullifier protection unchanged",
            async function () {
                const root =
                    ethers.utils
                        .hexZeroPad(
                            "0xabcd",
                            32
                        );

                const nullifier =
                    ethers.utils
                        .hexZeroPad(
                            "0x99",
                            32
                        );

                const amount =
                    ethers.utils
                        .parseEther(
                            "0.1"
                        );

                await pool.updateRoot(
                    root,
                    []
                );

                const before =
                    await ethers.provider
                        .getBalance(
                            student.address
                        );

                await pool.withdrawOffChain(
                    root,
                    nullifier,
                    student.address,
                    amount
                );

                const after =
                    await ethers.provider
                        .getBalance(
                            student.address
                        );

                assert.strictEqual(
                    after.sub(
                        before
                    ).toString(),
                    amount.toString()
                );

                assert.strictEqual(
                    await pool.usedNullifier(
                        nullifier
                    ),
                    true
                );

                await assertReverted(
                    async () => {
                        const transaction =
                            await pool.withdrawOffChain(
                            root,
                            nullifier,
                            student.address,
                            amount,
                            {
                                gasLimit:
                                    300000
                            }
                        );

                        await transaction.wait();
                    },
                    "nullifier already used"
                );
            }
        );
    }
);
