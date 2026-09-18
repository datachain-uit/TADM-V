// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ShieldedPool {

    // =========================
    // STATE
    // =========================

    bytes32 public currentRoot;

    mapping(bytes32 => bool) public validRoot;

    mapping(bytes32 => bool) public usedNullifier;

    address public school;

    address public verifier;

    // =========================
    // TACH XAC MINH KHOI THANH TOAN  (them 2026-08-25)
    // =========================
    //
    // VI SAO CO:
    // `withdraw` gop XAC MINH va THANH TOAN vao mot giao dich. Dieu do
    // dung ve an ninh, nhung gop hai VAI nghiep vu khac nhau:
    // sinh vien CHUNG MINH quyen nhan, Phong KH-TC DUYET va CHI.
    //
    // Tach ra:
    //   verifyAndRecord  <- sinh vien/backend goi. Verify roi GHI len chuoi.
    //   settle           <- KH-TC goi. Chi doc ban ghi roi chi tien.
    //
    // Loi ich do duoc cho bai bao: chi phi xac minh tro thanh MOT GIAO
    // DICH RIENG, do thang duoc, khong lan voi chi phi thanh toan. Va
    // buoc `settle` cua nhanh nay tro nen SO SANH DUOC voi
    // `withdrawOffChain` cua nhanh off-chain (cung mot cong viec).
    //
    // 🔴 RANG BUOC AN NINH COT LOI:
    // `Claim` phai luu DU root + amount + recipient. Neu chi luu mot bit
    // "da verify" thi ke tan cong verify proof hop le cho An 2 wei, roi
    // goi settle voi recipient khac va amount khac — verify chung minh
    // mot chuyen, thanh toan lam chuyen khac.
    //
    // Va `settle` CHI duoc nhan `nullifier`. Nhan them bat ky tham so
    // nao la mo lai dung lo hong do.

    struct Claim {
        bytes32 root;
        uint256 amount;
        address recipient;
        bool verified;
    }

    mapping(bytes32 => Claim) public claims;

    /*
     * V1(b) — MENH GIA CO DINH CUA POOL.
     *
     * `RFC 6973 muc 3.3`: tap an danh la nhung ca the "have the same
     * attributes". Thuoc tinh quan sat vien thay o day la `amount`.
     * Cung menh gia => tap an danh = ca pool; moi nguoi mot muc => = 1.
     *
     * Truoc day "cung menh gia" chi la LUA CHON CAU HINH; bien nay bien
     * no thanh RANG BUOC CUONG CHE.
     *
     * 0 = KHONG cuong che — giu co y cho kich ban doi chung cua C-13.
     */
    uint256 public denomination;

    // =========================
    // EVENTS
    // =========================

    event Deposit(uint256 amount);

    event RootUpdated(bytes32 root);

    /*
     * V4 — CONG BO TAP COMMITMENT.
     *
     * `NIST IR 8202 muc 4 tr.18`: "users can independently agree on the
     * current state of the blockchain."
     *
     * Chi phat root thi ben thu ba kiem duoc "proof hop le voi root R"
     * nhung khong kiem duoc "R chi chua hoc bong cap hop le". Phat ca
     * mang commitment thi ho tu dung lai cay va so root.
     *
     * Vi tri trong mang CHINH LA `merkleIndex` (approveRootService da
     * bat buoc lien tuc 0..n-1). Hop dong KHONG kiem
     * `root == computeRoot(commitments)` — chay Poseidon cho n la trong
     * EVM khong kha thi; viec kiem thuoc ve ben thu ba.
     */
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
    // UPDATE ROOT
    // =========================

    /*
     * V4 — nhan them mang commitment de cong bo. Mang PHAI la dung mang
     * da dung de tinh `newRoot`, theo dung thu tu `merkleIndex`. Cho
     * phep rong de tuong thich nguoc.
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
    // DECODE PUBLIC INPUTS
    //
    // calldata layout:
    // [0..32]   root
    // [32..64]  nullifier
    // [64..96]  amount
    // [96..128] recipient — A25, word 32 byte dem trai
    // [128..]   proof bytes
    // =========================

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





    // =========================
    // WITHDRAW
    // =========================

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

        // =========================
        // BIND FUNCTION ARGUMENTS
        // TO ZKP PUBLIC INPUTS
        // =========================

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

        /*
         * A25 — vi nhan phai dung vi ghi trong proof: chep proof sang
         * vi khac thi khong qua. So theo uint256 de mot word co bit cao
         * khac 0 khong bao gio khop voi dia chi nao.
         */
        require(
            uint256(uint160(address(recipient))) == proofRecipient,
            "recipient differs from proof"
        );

        /*
         * V1(b) — cuong che menh gia. `denomination == 0` nghia la pool
         * nay khong cuong che (giu cho kich ban doi chung cua C-13).
         */
        require(
            denomination == 0
            ||
            proofAmount == denomination,
            "wrong denomination"
        );

        // =========================
        // ROOT CHECK
        // =========================

        require(
            validRoot[
                proofRoot
            ],
            "root not in history"
        );

        // =========================
        // NULLIFIER CHECK
        // =========================

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

        // =========================
        // BALANCE CHECK
        // =========================

        require(
            address(this).balance
                >=
            proofAmount,
            "insufficient pool"
        );

        // =========================
        // VERIFY PROOF
        // =========================

        (
            bool ok,
            /* bytes memory data */
        ) =
            verifier.staticcall(
                proofAndSignals
            );

        require(
            ok,
            "invalid proof"
        );

        // =========================
        // EFFECTS BEFORE TRANSFER
        // =========================

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


 

    // =========================
    // GIAI DOAN 1 — XAC MINH VA GHI NHAN
    // =========================
    //
    // Nha truong goi. Hop dong TU verify roi ghi ket qua len chuoi. Sau
    // buoc nay, yeu cau rut moi dung nghia "pending": DA duoc chung
    // minh, cho duyet.
    //
    // A25 (2026-09-12) — onlySchool, va vi nhan la public input thu 4.
    // Truoc A25 ham nay de mo cho moi nguoi, trong khi proof KHONG gan
    // voi vi nhan: ke doc mempool chep proof, gui truoc voi vi cua han,
    // va `require(!claims[nullifier].verified)` bao ve ban ghi CUA HAN
    // — tien sinh vien ket vinh vien. Nay hai lop cung chan:
    //   - chi truong ghi duoc Claim;
    //   - vi nhan phai trung word thu 4 cua proof, nen ke ca truong
    //     cung khong doi duoc vi khi sinh vien tu tao proof.

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

        /*
         * A25 — vi nhan phai dung vi ghi trong proof: chep proof sang
         * vi khac thi khong qua. So theo uint256 de mot word co bit cao
         * khac 0 khong bao gio khop voi dia chi nao.
         */
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

        /*
         * 🔴 CHAN GHI DE.
         *
         * Thieu dong nay thi ke tan cong verify mot proof hop le, roi
         * goi lai chinh no voi `recipient` la vi cua minh — ban ghi bi
         * ghi de va `settle` se chi tien cho ke do.
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

        (
            bool ok,
            /* bytes memory data */
        ) =
            verifier.staticcall(
                proofAndSignals
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
    // Phong KH-TC goi. KHONG verify lai — ket qua da nam tren chuoi.
    //
    // 🔴 CHI NHAN `nullifier`. Moi gia tri khac doc tu `Claim` da ghi.
    //    Nhan them tham so nao la mo lai lo hong "verify mot dang,
    //    thanh toan mot neo".

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
         * Van kiem root o day chu khong chi o giai doan 1: giua luc
         * verify va luc duyet, root van phai nam trong lich su hop le.
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
