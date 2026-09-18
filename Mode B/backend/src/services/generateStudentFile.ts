const {
    projectRoot,
    proverBinary,
    runProver
} = require("../clients/prover/halo2ProverClient");
const path = require("path");
const fs = require("fs");
const { derivePublicKeyFromPrivateKey } = require("../clients/ipfs/ipfsClient");

type StudentNote = {
    student_id: number;
    amount: string;
    rho: string;
};

type ProofPackage = {
    proof: string;
    calldata: string;
    root: string;
    nullifier: string;
    amount: string;
    // A25 — vi nhan, public input thu 4 (word 32 byte dem trai).
    recipient: string;
};





function normalizeBytes32(value: string) {
    const normalized = value.startsWith("0x") ? value : `0x${value}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
        throw new Error(`Expected bytes32, received ${value}`);
    }
    return normalized;
}

function computeCommitment(note: StudentNote): string {
    return normalizeBytes32(runProver("commitment", note).commitment);
}

function computeNullifier(note: StudentNote): string {
    return normalizeBytes32(runProver("nullifier", note).nullifier);
}

function computeMerkleRoot(commitments: string[]) {
    const result = runProver("root", { commitments: commitments.map(normalizeBytes32) });
    /*
     * K10 — `nodes` va `zeros` de backend luu cay vao collection
     * `merkleNodes`. Prover cu khong tra ve => `undefined`, nguoi goi
     * bo qua va buoc rut giu nguyen duong cu.
     */
    return {
        root: normalizeBytes32(result.root),
        leafCount: Number(result.leaf_count),
        nodes: result.nodes,
        zeros: result.zeros,
    };
}

/*
 * K10 — `duongDaLuu` la duong Merkle doc san tu `merkleNodes`.
 * Co thi prover BO QUA buoc dung lai cay (O(depth) thay vi
 * O(n x depth)); khong co thi giu nguyen duong cu bang
 * `commitments`. Hai duong cho ra cung mot proof — xem
 * prover/src/flow_inputs.rs K10.
 */
function generateStudentFile(
    note: StudentNote,
    commitments: string[],
    merkleIndex: number,
    expectedRoot: string,
    // A25 — vi nhan tien; proof gan voi dung vi nay.
    recipient: string,
    duongDaLuu?: { siblings: string[]; directions: boolean[] } | null,
): ProofPackage {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(recipient))) {
        throw new Error("Invalid recipient wallet address");
    }
    const coDuongDaLuu = Boolean(duongDaLuu)
        && Array.isArray(duongDaLuu?.siblings)
        && (duongDaLuu?.siblings.length || 0) > 0;
    const result = runProver("prove", {
        ...note,
        commitments: coDuongDaLuu ? [] : commitments.map(normalizeBytes32),
        merkle_index: merkleIndex,
        expected_root: normalizeBytes32(expectedRoot),
        recipient,
        ...(coDuongDaLuu
            ? {
                siblings: (duongDaLuu as any).siblings.map(normalizeBytes32),
                directions: (duongDaLuu as any).directions,
            }
            : {}),
    });
    const proofPackage: ProofPackage = {
        proof: String(result.proof),
        calldata: String(result.calldata),
        root: normalizeBytes32(result.root),
        nullifier: normalizeBytes32(result.nullifier),
        amount: normalizeBytes32(result.amount),
        recipient: normalizeBytes32(result.recipient),
    };
    if (!/^0x[0-9a-fA-F]+$/.test(proofPackage.calldata)) {
        throw new Error("Prover returned invalid calldata hex");
    }
    const publicInputs = [
        `0x${proofPackage.calldata.slice(2, 66)}`,
        `0x${proofPackage.calldata.slice(66, 130)}`,
        `0x${proofPackage.calldata.slice(130, 194)}`,
        `0x${proofPackage.calldata.slice(194, 258)}`,
    ];
    if (
        publicInputs[0]?.toLowerCase() !== proofPackage.root.toLowerCase()
        || publicInputs[1]?.toLowerCase() !== proofPackage.nullifier.toLowerCase()
        || publicInputs[2]?.toLowerCase() !== proofPackage.amount.toLowerCase()
        || publicInputs[3]?.toLowerCase() !== proofPackage.recipient.toLowerCase()
        || BigInt(proofPackage.recipient) !== BigInt(recipient)
    ) {
        throw new Error("Public inputs do not match root/nullifier/amount/recipient in calldata");
    }
    return proofPackage;
}



module.exports = {
    computeCommitment,
    computeMerkleRoot,
    computeNullifier,
    generateProof: generateStudentFile,
    generateStudentFile,
    normalizeBytes32,
};

if (require.main === module) {
    require("../cli/generateStudentFileCli")
        .runGenerateStudentFileCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
