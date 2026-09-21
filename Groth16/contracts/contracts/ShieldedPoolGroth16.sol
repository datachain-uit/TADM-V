// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// =============================================================================
// SOI GƯƠNG zk-halo2-onchain/contracts/contracts/ShieldedPool.sol
//
// Cập nhật 2026-09-07: port đủ V1(b) · V4 · luồng HAI GIAI ĐOẠN
// (verifyAndRecord -> settle). Trước đó baseline còn dùng bản `withdraw` một
// giao dịch, nên gas_groth16_raw.csv thiếu 4 cột mà ONC có
// (verify_record_gas · verify_record_ms · settle_gas · settle_ms) và phép so
// ONC <-> G16 lệch NHIỀU HƠN một biến.
//
// -----------------------------------------------------------------------------
// GIỮ NGUYÊN TỪNG CHI TIẾT so với bản gốc:
//   - bien trang thai: currentRoot · validRoot · usedNullifier · school
//                      · verifier · denomination · claims
//   - struct Claim {root, amount, recipient, verified}
//   - event: Deposit · RootUpdated · CommitmentsPublished · Withdraw
//            · ClaimVerified · ClaimSettled
//   - constructor(address _verifier, uint256 poolDenomination) payable
//   - updateRoot(bytes32, bytes32[]) — V4, cong bo mang commitment
//   - verifyAndRecord: KHONG onlySchool (ai cung verify duoc), dung thu tu
//     require, chan ghi de ban ghi, verify ROI moi ghi claims
//   - settle: onlySchool, CHI nhan `nullifier`, doc moi thu tu claims
//   - Checks-Effects-Interactions: bat usedNullifier TRUOC khi chuyen tien
//   - getBalance()
//
// KHÁC ĐÚNG MỘT CHỖ, bắt buộc phải khác:
//   Halo2Verifier nhan MOT khoi `bytes calldata` roi tu boc public input, nen
//   ban goc dung decodePublicInputs + assembly + staticcall tho.
//   Verifier snarkjs sinh ra co giao dien CO KIEU:
//       verifyProof(uint[2], uint[2][2], uint[2], uint[4]) view returns (bool)
//   => public input den duoi dang uint[4] pubSignals, khong phai blob.
//   A25 (12/09/2026): them `recipient` lam public input thu tu => uint[3] -> uint[4].
//   => bo decodePublicInputs; phan "rang buoc tham so ham vao public input cua
//      proof" van con nguyen, chi doc tu mang co kieu thay vi calldataload.
//
//   Hệ quả lên gas — PHẢI NÊU trong bài, đừng lặng lẽ bỏ qua:
//     calldata ban goc  ~4 128 byte (proof Halo2 d=9 + 96 byte public input)
//     calldata ban nay  ~352 byte  (8 field element + 96 byte public input)
//   Chenh lech calldata la HE QUA THAT cua he chung minh, khong phai nhieu do
//   cach viet contract. No thuoc ve phep so, KHONG duoc tru di.
//
// KHÔNG mang sang: `event Debug(uint256 step)` cua ban goc — khai bao thua,
//   khong noi nao emit, khong anh huong bytecode da trien khai.
// =============================================================================

interface IGroth16Verifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[4] calldata _pubSignals
    ) external view returns (bool);
}

contract ShieldedPoolGroth16 {

    // =========================
    // STATE
    // =========================

    bytes32 public currentRoot;

    mapping(bytes32 => bool) public validRoot;

    mapping(bytes32 => bool) public usedNullifier;

    address public school;

    address public verifier;

    /*
     * V1(b) — MENH GIA CO DINH CUA POOL.
     *
     * RFC 6973 muc 3.3: tap an danh la nhung ca the "have the same
     * attributes". Thuoc tinh quan sat vien thay o day la `amount`.
     * Pool moi menh gia mot con so => moi lan rut trong pool trong khong
     * phan biet duoc nhau bang `amount`.
     *
     * `denomination == 0` nghia la pool KHONG cuong che — giu de tuong
     * thich nguoc voi cac pool tao truoc V1(b).
     */
    uint256 public denomination;

    /*
     * LUONG HAI GIAI DOAN.
     *
     * `settle` CHI duoc nhan `nullifier`. Nhan them bat ky tham so nao la
     * mo lai lo hong: ke tan cong verify proof hop le cho A 2 wei, roi goi
     * settle voi recipient khac va amount khac — verify chung minh mot
     * chuyen, thanh toan lam chuyen khac.
     */
    struct Claim {
        bytes32 root;
        uint256 amount;
        address recipient;
        bool verified;
    }

    mapping(bytes32 => Claim) public claims;

    // =========================
    // EVENTS
    // =========================

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

    // =========================
    // CONSTRUCTOR
    // =========================

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

    // =========================
    // ONLY SCHOOL
    // =========================

    modifier onlySchool() {
        require(
            msg.sender == school,
            "not school"
        );
        _;
    }

    // =========================
    // UPDATE ROOT  —  V4
    // =========================
    /*
     * V4 — nhan them mang commitment de cong bo. Mang PHAI la dung mang da
     * dung de tinh `newRoot`, theo dung thu tu `merkleIndex`. Cho phep rong
     * de tuong thich nguoc.
     */
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

    // =========================
    // WITHDRAW — MOT GIAO DICH  (giu de doi chieu)
    // =========================
    //
    // ONC GIU CA HAI luong: `withdraw` mot giao dich VA cap
    // `verifyAndRecord` -> `settle`. Benchmark cua no do CA BA.
    // Baseline phai giu theo, khong thi bang thieu han mot cot.
    //
    // Do duoc o ONC: withdraw 564 375 · verifyAndRecord 595 197 · settle 69 624
    // => luong hai giai doan dat hon ~100 000 gas (phi khoi tao giao dich thu
    //    hai + ghi struct Claim). Do la CAI GIA cua viec tach verify khoi chi
    //    tien — mot ket qua dang viet, khong phai nhieu.

    function withdraw(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[4] calldata _pubSignals,
        bytes32 root,
        bytes32 nullifier,
        address payable recipient,
        uint256 amount
    )
        external
        onlySchool
    {
        bytes32 proofRoot = bytes32(_pubSignals[0]);
        bytes32 proofNullifier = bytes32(_pubSignals[1]);
        uint256 proofAmount = _pubSignals[2];
        uint256 proofRecipient = _pubSignals[3];

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

        // A25 — vi nhan phai trung public input thu tu cua proof.
        require(
            uint256(uint160(address(recipient))) == proofRecipient,
            "recipient differs from proof"
        );

        require(
            validRoot[proofRoot],
            "root not in history"
        );

        require(
            !usedNullifier[proofNullifier],
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
            denomination == 0
                || proofAmount == denomination,
            "wrong denomination"
        );

        require(
            address(this).balance >= proofAmount,
            "insufficient pool"
        );

        bool ok =
            IGroth16Verifier(verifier).verifyProof(
                _pA,
                _pB,
                _pC,
                _pubSignals
            );

        require(
            ok,
            "invalid proof"
        );

        // Checks-Effects-Interactions
        usedNullifier[proofNullifier] = true;

        (bool transferred, ) =
            recipient.call{value: proofAmount}("");

        require(
            transferred,
            "transfer failed"
        );

        emit Withdraw(
            recipient,
            proofAmount,
            proofNullifier,
            proofRoot
        );
    }

    // =========================
    // GIAI DOAN 1 — VERIFY VA GHI NHAN
    // =========================
    //
    // A25 (12/09/2026) — NAY onlySchool, va vi nhan la public input thu tu.
    // Truoc A25 ham nay de mo, trong khi proof khong gan voi vi nhan: ke doc
    // mempool chep proof, gui truoc voi vi cua han, va Claim ghi SAI vi. Hop
    // dong VAN tu xac thuc proof — onlySchool chi quy dinh AI NOP.
    // Giu doi xung voi zk-halo2-onchain; xem DECISIONS.md A25.

    function verifyAndRecord(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[4] calldata _pubSignals,
        bytes32 root,
        bytes32 nullifier,
        address payable recipient,
        uint256 amount
    )
        external
        onlySchool
    {
        // Public input cua mach, DUNG THU TU [root, nullifier, amount, recipient]
        // — khop component main cua withdraw.circom.
        bytes32 proofRoot = bytes32(_pubSignals[0]);
        bytes32 proofNullifier = bytes32(_pubSignals[1]);
        uint256 proofAmount = _pubSignals[2];
        uint256 proofRecipient = _pubSignals[3];

        // Rang buoc tham so voi public input da nuong trong proof.
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

        // A25 — vi nhan phai trung public input thu tu cua proof.
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

        // V1(b) — cuong che menh gia. `denomination == 0` nghia la pool
        // khong cuong che (tuong thich nguoc).
        require(
            denomination == 0
                || proofAmount == denomination,
            "wrong denomination"
        );

        /*
         * CHAN GHI DE.
         *
         * Thieu dong nay thi ke tan cong verify mot proof hop le, roi goi
         * lai chinh no voi `recipient` la vi cua minh — ban ghi bi ghi de
         * va `settle` se chi tien cho ke do.
         */
        require(
            !claims[nullifier].verified,
            "claim already recorded"
        );

        require(
            !usedNullifier[nullifier],
            "nullifier already used"
        );

        // =========================
        // VERIFY PROOF
        // =========================

        bool ok =
            IGroth16Verifier(verifier).verifyProof(
                _pA,
                _pB,
                _pC,
                _pubSignals
            );

        require(
            ok,
            "invalid proof"
        );

        /*
         * Ghi DU BON: root, amount, recipient, va co `verified`.
         * `settle` doc tu day chu KHONG nhan tham so moi.
         */
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

    // =========================
    // GIAI DOAN 2 — DUYET VA CHI
    // =========================
    //
    // CHI nhan `nullifier`. Moi thu khac doc tu `claims`.

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

        /*
         * Van kiem root o day chu khong chi o giai doan 1: giua luc verify
         * va luc duyet, root van phai nam trong lich su hop le.
         */
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

        // Danh dau TRUOC khi chuyen, theo Checks-Effects-Interactions.
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

    // =========================
    // BALANCE
    // =========================

    function getBalance()
        external
        view
        returns (uint256)
    {
        return address(this).balance;
    }
}
