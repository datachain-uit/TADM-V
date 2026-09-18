const {
    Web3
} = require(
    "web3"
);

const {
    getBlockchainRpcUrl
} = require("../../config/environment");

const artifact =
    require(
        "../../../../contracts/artifacts/" +
        "contracts/ShieldedPool.sol/" +
        "ShieldedPool.json"
    );

let web3Instance:
    any;

function getWeb3() {
    if (!web3Instance) {
        web3Instance =
            new Web3(
                getBlockchainRpcUrl()
            );
    }

    return web3Instance;
}

function normalizeAddress(
    address:
        string
) {
    const web3 =
        getWeb3();

    if (
        !address
        ||
        !web3.utils.isAddress(
            address
        )
    ) {
        throw new Error(
            `Invalid Ethereum address: ${address}`
        );
    }

    return address.toLowerCase();
}

function normalizePrivateKey(
    privateKey:
        string
) {
    const normalized =
        privateKey.startsWith(
            "0x"
        )
            ?
            privateKey
            :
            "0x" + privateKey;

    if (
        !/^0x[0-9a-fA-F]{64}$/.test(
            normalized
        )
    ) {
        throw new Error(
            "Private key must contain exactly 32 bytes"
        );
    }

    return normalized;
}

function assertUnsignedWei(
    value:
        string,

    fieldName:
        string
) {
    if (
        !/^[0-9]+$/.test(
            value
        )
    ) {
        throw new Error(
            `${fieldName} must be an unsigned decimal wei string`
        );
    }

    return BigInt(
        value
    ).toString();
}

function addPrivateKeyAccount(
    privateKey:
        string
) {
    const web3 =
        getWeb3();

    const account =
        web3.eth.accounts
            .privateKeyToAccount(
                normalizePrivateKey(
                    privateKey
                )
            );

    web3.eth.accounts.wallet.add(
        account
    );

    return account;
}

async function resolveSender(
    expectedAddress:
        string,

    privateKey?:
        string
) {
    const web3 =
        getWeb3();

    const expected =
        normalizeAddress(
            expectedAddress
        );

    if (privateKey) {
        const account =
            addPrivateKeyAccount(
                privateKey
            );

        if (
            normalizeAddress(
                account.address
            )
            !==
            expected
        ) {
            throw new Error(
                "Private key does not belong to the expected wallet address"
            );
        }

        return account.address;
    }

    const unlockedAccounts =
        await web3.eth
            .getAccounts();

    const unlocked =
        unlockedAccounts.find(
            (
                address:
                    string
            ) =>
                address.toLowerCase()
                ===
                expected
        );

    if (!unlocked) {
        throw new Error(
            "Expected wallet is not unlocked by the RPC node. " +
            "Provide its private key through the documented environment variable."
        );
    }

    return unlocked;
}

function getShieldedPoolContract(
    contractAddress:
        string
) {
    const web3 =
        getWeb3();

    return new web3.eth.Contract(
        artifact.abi,
        normalizeAddress(
            contractAddress
        )
    );
}

function withGasBuffer(
    estimatedGas:
        bigint
) {
    return (
        estimatedGas
        *
        120n
        /
        100n
    ).toString();
}

async function deployShieldedPool(
    universityAddress:
        string,

    initialFundingWei:
        string,

    universityPrivateKey?:
        string,

    /*
     * V1(b) — menh gia co dinh cua pool. "0" = KHONG cuong che.
     *
     * Dat cuoi va co mac dinh, nen moi loi goi cu van chay y nhu truoc.
     * Pool that nen truyen menh gia thuc; de "0" thi hop dong khong chan
     * duoc mot lan trien khai cap moi sinh vien mot muc — luc do tap an
     * danh tut ve 1 ma khong ai bao loi.
     */
    denominationWei: string = "0"
) {
    const web3 =
        getWeb3();

    const fundingWei =
        assertUnsignedWei(
            initialFundingWei,
            "initialFundingWei"
        );

    const sender =
        await resolveSender(
            universityAddress,
            universityPrivateKey
        );

    const deployment =
        new web3.eth.Contract(
            artifact.abi
        ).deploy({
            data:
                artifact.bytecode,

            // V1(b) — tham so constructor `poolDenomination`.
            arguments: [
                assertUnsignedWei(
                    denominationWei,
                    "denominationWei"
                )
            ]
        });

    const estimatedGas =
        BigInt(
            await deployment
                .estimateGas({
                    from: sender,
                    value: fundingWei
                })
        );

    let transactionHash =
        "";

    /*
     * Gas thực tế của giao dịch deploy.
     * Đây là số liệu cho cột off-chain
     * của bảng gas trong bài báo.
     */
    let gasUsed =
        "0";

    const deployedContract =
        await deployment
            .send({
                from: sender,
                value: fundingWei,
                gas:
                    withGasBuffer(
                        estimatedGas
                    )
            })
            .on(
                "transactionHash",
                (
                    hash:
                        string
                ) => {
                    transactionHash =
                        hash;
                }
            )
            .on(
                "receipt",
                (
                    receipt:
                        any
                ) => {
                    transactionHash =
                        String(
                            receipt.transactionHash
                        );

                    gasUsed =
                        BigInt(
                            receipt.gasUsed
                        ).toString();
                }
            );

    const contractAddress =
        normalizeAddress(
            deployedContract
                .options
                .address
        );

    if (!transactionHash) {
        throw new Error(
            "Deployment completed without a transaction hash"
        );
    }

    const contract =
        getShieldedPoolContract(
            contractAddress
        );

    const storedUniversity =
        normalizeAddress(
            String(
                await contract.methods
                    .school()
                    .call()
            )
        );

    if (
        storedUniversity
        !==
        normalizeAddress(
            universityAddress
        )
    ) {
        throw new Error(
            "Deployed pool stored an unexpected university address"
        );
    }

    return {
        contractAddress,
        universityAddress:
            storedUniversity,
        chainId:
            BigInt(
                await web3.eth
                    .getChainId()
            ).toString(),
        transactionHash:
            transactionHash.toLowerCase(),
        gasUsed,
        balanceWei:
            BigInt(
                await web3.eth
                    .getBalance(
                        contractAddress
                    )
            ).toString()
    };
}

async function assertPoolUniversity(
    contractAddress:
        string,

    expectedUniversityAddress:
        string,

    expectedChainId?:
        string
) {
    const web3 =
        getWeb3();

    if (
        expectedChainId
        &&
        BigInt(
            await web3.eth
                .getChainId()
        ).toString()
        !==
        BigInt(
            expectedChainId
        ).toString()
    ) {
        throw new Error(
            "RPC chainId does not match the scholarship pool chainId"
        );
    }

    const contract =
        getShieldedPoolContract(
            contractAddress
        );

    const onChainUniversity =
        normalizeAddress(
            String(
                await contract.methods
                    .school()
                    .call()
            )
        );

    if (
        onChainUniversity
        !==
        normalizeAddress(
            expectedUniversityAddress
        )
    ) {
        throw new Error(
            "Pool universityAddress does not match contract.school()"
        );
    }

    return onChainUniversity;
}

async function getPoolBalance(
    contractAddress:
        string
) {
    const web3 =
        getWeb3();

    return BigInt(
        await web3.eth
            .getBalance(
                normalizeAddress(
                    contractAddress
                )
            )
    ).toString();
}

async function fundScholarshipPool(
    contractAddress:
        string,

    amountWei:
        string,

    sponsorAddress:
        string
) {
    const web3 =
        getWeb3();

    const amount =
        assertUnsignedWei(
            amountWei,
            "amountWei"
        );

    if (
        BigInt(
            amount
        )
        <=
        0n
    ) {
        throw new Error(
            "Sponsor amount must be greater than zero"
        );
    }

    const sponsor = await resolveSender(sponsorAddress)
        // addPrivateKeyAccount(
        //     sponsorAddress
        // );

    const receipt =
        await web3.eth
            .sendTransaction({
                from:
                    sponsor,
                to:
                    normalizeAddress(
                        contractAddress
                    ),
                value:
                    amount,
                gas:
                    "50000"
            });

    return {
        sponsorAddress:
            normalizeAddress(
                sponsor
            ),
        transactionHash:
            String(
                receipt.transactionHash
            ).toLowerCase(),
        gasUsed:
            BigInt(
                receipt.gasUsed
            ).toString(),
        balanceWei:
            await getPoolBalance(
                contractAddress
            )
    };
}

module.exports = {
    artifact,
    getWeb3,
    normalizeAddress,
    assertUnsignedWei,
    resolveSender,
    getShieldedPoolContract,
    deployShieldedPool,
    assertPoolUniversity,
    getPoolBalance,
    fundScholarshipPool,
    withGasBuffer
};
