const {
    createStudentNote,
    derivePublicKeyFromPrivateKey
} = require("../clients/ipfs/noteEncryption");
const {
    uploadToIpfs,
    getStudentFromIpfs
} = require("../clients/ipfs/encryptedNoteStorage");
const {
    runRust
} = require("../clients/prover/halo2ProverClient");
const {
    normalizeBytes32
} = require("../utils/bytes32");

function createPublicKeyFromPrivateKey(
    studentPrivateKeyHex: string
) {
    const publicKey = derivePublicKeyFromPrivateKey(
        studentPrivateKeyHex
    );

    console.log("STUDENT PUBLIC KEY:", publicKey);
    return publicKey;
}

async function createEncryptedNote(
    studentId: number,
    amountWei: string,
    studentPublicKeyHex: string,

    // A23 — `rho` co san tu dataset dinh luong. Khong truyen => ngau nhien.
    rho?: string
) {
    const note = createStudentNote(studentId, amountWei, rho);
    console.log("Student note created in memory");

    const commitmentResult = runRust("commitment", note);
    const commitment = normalizeBytes32(
        commitmentResult.commitment
    );
    console.log(
        "COMMITMENT COMPUTED BY RUST:",
        commitment
    );

    const cid = await uploadToIpfs(
        note,
        studentPublicKeyHex
    );
    console.log("ENCRYPTED NOTE CID:", cid);

    return {
        cid,
        commitment
    };
}

function computeNullifier(note: any) {
    if (
        !note
        || note.student_id === undefined
        || note.amount === undefined
        || note.rho === undefined
    ) {
        throw new Error("Invalid decrypted note");
    }

    const nullifierResult = runRust("nullifier", note);
    const nullifier = normalizeBytes32(
        nullifierResult.nullifier
    );
    console.log(
        "NULLIFIER COMPUTED BY RUST:",
        nullifier
    );

    return nullifier;
}

/*
 * Xác thực proof off-chain bằng một tiến trình
 * prover riêng, tách hẳn khỏi bước tạo proof.
 *
 * Trả { verified, setupMs, verifyMs } — verifyMs
 * là số liệu cho bảng verification time §2.1.1.
 */
function verifyProofOffChain(
    proof: string,
    rootHex: string,
    nullifierHex: string,
    amountHex: string,
    // A25 — ví nhận, public input thứ 4 (địa chỉ 20 byte hoặc word 32 byte).
    recipientHex: string
) {
    const result = runRust("verify", {
        proof,
        root: normalizeBytes32(rootHex),
        nullifier: normalizeBytes32(nullifierHex),
        amount: normalizeBytes32(amountHex),
        recipient: recipientHex
    });

    if (result.verified !== true) {
        throw new Error(
            "Off-chain verification did not return verified=true"
        );
    }

    console.log(
        "OFF-CHAIN VERIFY PASSED - verify_ms:",
        result.verify_ms
    );

    return {
        verified: true,
        setupMs: Number(result.setup_ms),
        verifyMs: Number(result.verify_ms)
    };
}

function computeMerkleRoot(commitments: string[]) {
    if (commitments.length === 0) {
        throw new Error(
            "Cannot compute root from empty commitments"
        );
    }

    const rootResult = runRust("root", {
        commitments: commitments.map(normalizeBytes32)
    });

    console.log("COMPUTED ROOT:", rootResult.root);
    return rootResult;
}

/*
 * K10 — `duongDaLuu` la duong Merkle doc san tu collection
 * `merkleNodes`. Co thi prover BO QUA buoc dung lai cay
 * (O(depth) thay vi O(n x depth)); khong co thi giu nguyen
 * duong cu bang `commitments`. Hai duong cho ra cung mot
 * proof — xem prover/src/inputs_builder.rs K10.
 */
function generateStudentFileFromNote(
    student: any,
    expectedRoot: string,
    commitments: string[],
    merkleIndex: number,
    // A25 — ví nhận tiền; proof gắn với đúng ví này.
    recipient: string,
    duongDaLuu?: {
        siblings: string[];
        directions: boolean[];
    } | null
) {
    if (
        !student
        || student.student_id === undefined
        || student.amount === undefined
        || student.rho === undefined
    ) {
        throw new Error("Invalid decrypted note");
    }

    if (!Number.isInteger(merkleIndex) || merkleIndex < 0) {
        throw new Error("Invalid Merkle index");
    }

    if (!/^0x[0-9a-fA-F]{40}$/.test(String(recipient))) {
        throw new Error("Invalid recipient wallet address");
    }

    const coDuongDaLuu =
        Boolean(duongDaLuu)
        && Array.isArray(duongDaLuu?.siblings)
        && (duongDaLuu?.siblings.length || 0) > 0;

    if (!coDuongDaLuu && commitments.length === 0) {
        throw new Error("Commitment list is empty");
    }

    const proverInput = coDuongDaLuu
        ? {
            ...student,
            recipient,
            expected_root: normalizeBytes32(expectedRoot),
            commitments: [],
            merkle_index: merkleIndex,
            siblings: (duongDaLuu as any).siblings
                .map(normalizeBytes32),
            directions: (duongDaLuu as any).directions
        }
        : {
            ...student,
            recipient,
            expected_root: normalizeBytes32(expectedRoot),
            commitments: commitments.map(normalizeBytes32),
            merkle_index: merkleIndex
        };

    console.log("ROOT PASSED TO RUST:", expectedRoot);
    console.log(
        "MERKLE INDEX PASSED TO RUST:",
        merkleIndex
    );
    console.log(
        "COMMITMENT COUNT PASSED TO RUST:",
        coDuongDaLuu ? 0 : commitments.length
    );
    console.log(
        "MERKLE PATH SOURCE:",
        coDuongDaLuu
            ? "merkleNodes (stored)"
            : "rebuilt from commitments"
    );

    return runRust("prove", proverInput);
}

async function generateStudentFile(
    cid: string,
    studentPrivateKeyHex: string,
    expectedRoot: string,
    commitments: string[],
    merkleIndex: number,
    recipient: string
) {
    const student = await getStudentFromIpfs(
        cid,
        studentPrivateKeyHex
    );
    console.log(
        "Encrypted note decrypted for proof generation"
    );

    return generateStudentFileFromNote(
        student,
        expectedRoot,
        commitments,
        merkleIndex,
        recipient
    );
}

async function fullFlow(
    studentId: number,
    amountWei: string,
    studentPrivateKeyHex: string
) {
    console.log(
        "\n==============================\n" +
        "STEP 1 - DERIVE PUBLIC KEY\n" +
        "=============================="
    );
    const publicKey = createPublicKeyFromPrivateKey(
        studentPrivateKeyHex
    );

    console.log(
        "\n==============================\n" +
        "STEP 2 - CREATE ENCRYPTED NOTE\n" +
        "=============================="
    );
    const createResult = await createEncryptedNote(
        studentId,
        amountWei,
        publicKey
    );

    console.log(
        "\n==============================\n" +
        "ENCRYPTED NOTE CREATED\n" +
        "NEXT: APPROVE MERKLE ROOT BEFORE CREATING PROOF\n" +
        "=============================="
    );

    return {
        cid: createResult.cid,
        publicKey,
        message:
            "Encrypted note created. Run approveRootService.ts before generating proof."
    };
}

module.exports = {
    createPublicKeyFromPrivateKey,
    createEncryptedNote,
    computeNullifier,
    verifyProofOffChain,
    computeMerkleRoot,
    generateStudentFile,
    generateStudentFileFromNote,
    fullFlow
};

if (require.main === module) {
    require("../cli/generateStudentFileCli")
        .runGenerateStudentFileCli()
        .catch(require("../cli/cliErrorHandler").handleCliError);
}
