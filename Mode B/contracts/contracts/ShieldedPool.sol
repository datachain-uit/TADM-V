// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

contract ShieldedPool {

    bytes32 public currentRoot;

    mapping(bytes32 => bool) public validRoot;

    mapping(bytes32 => bool) public usedNullifier;

    address public school;

    address public verifier;

    struct Claim {
        bytes32 root;
        uint256 amount;
        address recipient;
        bool verified;
    }

    mapping(bytes32 => Claim) public claims;

    uint256 public denomination;

    event Deposit(uint256 amount);

    event RootUpdated(bytes32 root);

    event CommitmentsPublished(bytes32 indexed root, bytes32[] commitments);

    event Withdraw(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed nullifier,
        bytes32 root
    );

    event ClaimVerified(
        bytes32 indexed nullifier,
        bytes32 root,
        address indexed recipient,
        uint256 amount
    );

    event ClaimSettled(
        bytes32 indexed nullifier,
        address indexed recipient,
        uint256 amount
    );

    constructor(address _verifier, uint256 poolDenomination) payable {
        require(_verifier.code.length > 0, "invalid verifier");
        school = msg.sender;
        verifier = _verifier;
        denomination = poolDenomination;
        if (msg.value > 0) {
            emit Deposit(msg.value);
        }
    }

    receive() external payable {
        emit Deposit(msg.value);
    }

    modifier onlySchool() {
        require(
            msg.sender == school,
            "not school"
        );
        _;
    }

    function updateRoot(
        bytes32 newRoot,
        bytes32[] calldata commitments
    )
        external
        onlySchool
    {
        require(newRoot != bytes32(0), "empty root");
        currentRoot = newRoot;
        validRoot[newRoot] = true;
        emit RootUpdated(newRoot);

        if (commitments.length > 0) {
            emit CommitmentsPublished(newRoot, commitments);
        }
    }

    function decodePublicInputs(
        bytes calldata proofAndSignals
    )
        internal
        pure
        returns (
            bytes32 proofRoot,
            bytes32 proofNullifier,
            uint256 proofAmount,
            uint256 proofRecipient
        )
    {
        require(
            proofAndSignals.length >= 128,
            "invalid proof calldata"
        );

        assembly {
            proofRoot :=
                calldataload(
                    proofAndSignals.offset
                )

            proofNullifier :=
                calldataload(
                    add(
                        proofAndSignals.offset,
                        32
                    )
                )

            proofAmount :=
                calldataload(
                    add(
                        proofAndSignals.offset,
                        64
                    )
                )
            proofRecipient :=
                calldataload(
                    add(
                        proofAndSignals.offset,
                        96
                    )
                )
        }
    }

    event Debug(uint256 step);
    function withdraw(
        bytes calldata proofAndSignals,
        bytes32 root,
        bytes32 nullifier,
        address payable recipient,
        uint256 amount
    )
        external
        onlySchool
    {
        (
            bytes32 proofRoot,
            bytes32 proofNullifier,
            uint256 proofAmount,
            uint256 proofRecipient
        ) =
            decodePublicInputs(
                proofAndSignals
            );

        require(
            root == proofRoot,
            "root differs from proof"
        );

        require(
            nullifier
                ==
            proofNullifier,
            "nullifier differs from proof"
        );

        require(
            amount
                ==
            proofAmount,
            "amount differs from proof"
        );

        require(
            uint256(uint160(address(recipient))) == proofRecipient,
            "recipient differs from proof"
        );

        require(
            denomination == 0
            ||
            proofAmount == denomination,
            "wrong denomination"
        );

        require(
            validRoot[
                proofRoot
            ],
            "root not in history"
        );

        require(
            !usedNullifier[
                proofNullifier
            ],
            "nullifier already used"
        );

        require(
            proofAmount > 0,
            "invalid amount"
        );

        require(
            recipient != address(0),
            "invalid recipient"
        );

        require(
            address(this).balance
                >=
            proofAmount,
            "insufficient pool"
        );

        (
            bool ok,

        ) =
            verifier.staticcall(
                proofAndSignals
            );

        require(
            ok,
            "invalid proof"
        );

        usedNullifier[
            proofNullifier
        ] = true;

        (bool transferred, ) = recipient.call{value: proofAmount}("");
        require(transferred, "transfer failed");

        emit Withdraw(
            recipient,
            proofAmount,
            proofNullifier,
            proofRoot
        );
    }

    function verifyAndRecord(
        bytes calldata proofAndSignals,
        bytes32 root,
        bytes32 nullifier,
        address payable recipient,
        uint256 amount
    )
        external
        onlySchool
    {
        (
            bytes32 proofRoot,
            bytes32 proofNullifier,
            uint256 proofAmount,
            uint256 proofRecipient
        ) =
            decodePublicInputs(
                proofAndSignals
            );

        require(
            root == proofRoot,
            "root differs from proof"
        );

        require(
            nullifier == proofNullifier,
            "nullifier differs from proof"
        );

        require(
            amount == proofAmount,
            "amount differs from proof"
        );

        require(
            uint256(uint160(address(recipient))) == proofRecipient,
            "recipient differs from proof"
        );

        require(
            proofAmount > 0,
            "invalid amount"
        );

        require(
            recipient != address(0),
            "invalid recipient"
        );

        require(
            !claims[nullifier].verified,
            "claim already recorded"
        );

        require(
            !usedNullifier[nullifier],
            "nullifier already used"
        );

        (
            bool ok,

        ) =
            verifier.staticcall(
                proofAndSignals
            );

        require(
            ok,
            "invalid proof"
        );

        claims[nullifier] = Claim({
            root: root,
            amount: amount,
            recipient: recipient,
            verified: true
        });

        emit ClaimVerified(
            nullifier,
            root,
            recipient,
            amount
        );
    }

    function settle(
        bytes32 nullifier
    )
        external
        onlySchool
    {
        Claim memory c =
            claims[nullifier];

        require(
            c.verified,
            "claim not verified"
        );

        require(
            validRoot[c.root],
            "root not in history"
        );

        require(
            !usedNullifier[nullifier],
            "nullifier already used"
        );

        require(
            address(this).balance >= c.amount,
            "insufficient pool"
        );

        usedNullifier[nullifier] = true;

        (bool transferred, ) =
            c.recipient.call{value: c.amount}("");

        require(
            transferred,
            "transfer failed"
        );

        emit ClaimSettled(
            nullifier,
            c.recipient,
            c.amount
        );

        emit Withdraw(
            c.recipient,
            c.amount,
            nullifier,
            c.root
        );
    }

    function getBalance()
        external
        view
        returns (uint256)
    {
        return address(this).balance;
    }
}
