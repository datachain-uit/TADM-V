// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

contract ShieldedPool {

    bytes32 public currentRoot;

    mapping(bytes32 => bool)
        public validRoot;

    mapping(bytes32 => bool)
        public usedNullifier;

    address public school;

    uint256 public denomination;

    event Deposit(
        uint256 amount
    );

    event RootUpdated(
        bytes32 root
    );

    event Withdraw(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed nullifier,
        bytes32 root
    );

    event CommitmentsPublished(
        bytes32 indexed root,
        bytes32[] commitments
    );

    constructor(
        uint256 poolDenomination
    )
        payable
    {
        school =
            msg.sender;

        denomination =
            poolDenomination;

        if (
            msg.value > 0
        ) {
            emit Deposit(
                msg.value
            );
        }
    }

    receive()
        external
        payable
    {
        emit Deposit(
            msg.value
        );
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
        require(
            newRoot != bytes32(0),
            "empty root"
        );

        currentRoot =
            newRoot;

        validRoot[newRoot] =
            true;

        emit RootUpdated(
            newRoot
        );

        if (
            commitments.length > 0
        ) {
            emit CommitmentsPublished(
                newRoot,
                commitments
            );
        }
    }

    function withdrawOffChain(
        bytes32 root,
        bytes32 nullifier,
        address payable recipient,
        uint256 amount
    )
        external
        onlySchool
    {
        require(
            validRoot[root],
            "root not in history"
        );

        require(
            !usedNullifier[nullifier],
            "nullifier already used"
        );

        require(
            recipient != address(0),
            "invalid recipient"
        );

        require(
            amount > 0,
            "invalid amount"
        );

        require(
            denomination == 0
            ||
            amount == denomination,
            "wrong denomination"
        );

        require(
            address(this).balance
            >=
            amount,
            "insufficient pool"
        );

        usedNullifier[nullifier] =
            true;

        (
            bool success,

        ) =
            recipient.call{
                value:
                    amount
            }("");

        require(
            success,
            "transfer failed"
        );

        emit Withdraw(
            recipient,
            amount,
            nullifier,
            root
        );
    }

    function getBalance()
        external
        view
        returns (
            uint256
        )
    {
        return
            address(this).balance;
    }
}
