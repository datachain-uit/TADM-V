// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockHalo2Verifier {
    bool public acceptsProof = true;

    function setAcceptsProof(bool value) external {
        acceptsProof = value;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        require(acceptsProof, "mock invalid proof");
        return "";
    }
}
