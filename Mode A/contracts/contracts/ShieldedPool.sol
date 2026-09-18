// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ShieldedPool {

    // =========================
    // STATE
    // =========================

    bytes32 public currentRoot;

    mapping(bytes32 => bool)
        public validRoot;

    mapping(bytes32 => bool)
        public usedNullifier;

    address public school;

    /*
     * V1(b) — MENH GIA CO DINH CUA POOL.
     *
     * `RFC 6973 muc 3.3` dinh nghia tap an danh la nhung ca the "have the
     * same attributes". Thuoc tinh quan sat vien nhin thay o day la
     * `amount`. Neu moi suat trong pool cung mot menh gia thi tap an danh
     * = ca pool; neu moi nguoi mot muc thi tap an danh = 1.
     *
     * Truoc day "cung menh gia" chi la LUA CHON CAU HINH cua backend —
     * khong co gi trong hop dong ngan mot lan trien khai cap moi nguoi
     * mot muc. Bien nay bien no thanh RANG BUOC CUONG CHE.
     *
     * 0 = KHONG cuong che. Giu lai co y, vi thi nghiem an danh C-13 can
     * kich ban doi chung `sameAmount: false` (moi nguoi mot muc) de chi
     * ra bien xau nhat. Pool that thi dat khac 0.
     */
    uint256 public denomination;

    // =========================
    // EVENTS
    // =========================

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

    /*
     * V4 — CONG BO TAP COMMITMENT.
     *
     * `NIST IR 8202 muc 4 tr.18`: "By combining the initial state and the
     * ability to verify every block since then, users can independently
     * agree on the current state of the blockchain."
     *
     * Truoc day hop dong chi phat `RootUpdated(root)`. Ben thu ba kiem
     * duoc "proof hop le doi voi root R" nhung KHONG kiem duoc "R chi
     * chua hoc bong cap hop le" — nha truong van co the chen mot la
     * khong ai duyet ma khong ai biet.
     *
     * Phat ca mang commitment thi ben thu ba TU DUNG LAI cay tren may
     * cua ho va so root. Lech la lo ngay.
     *
     * VI TRI TRONG MANG CHINH LA `merkleIndex` — `approveRootService` da
     * bat buoc chi so lien tuc 0..n-1, nen khong can phat chi so rieng.
     *
     * Hop dong KHONG kiem `root == computeRoot(commitments)`: chay
     * Poseidon cho n la trong EVM la khong kha thi. Viec kiem thuoc ve
     * ben thu ba — va do chinh la y nghia "kiem chung duoc".
     */
    event CommitmentsPublished(
        bytes32 indexed root,
        bytes32[] commitments
    );

    // =========================
    // CONSTRUCTOR
    // =========================

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

    // Cho phép nạp thêm tiền
    // vào scholarship pool.
    receive()
        external
        payable
    {
        emit Deposit(
            msg.value
        );
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
     * V4 — nhan them mang commitment de cong bo.
     *
     * Mang PHAI la dung mang da dung de tinh `newRoot`, theo dung thu tu
     * `merkleIndex`. Backend truyen thang bien do xuong, KHONG duoc truy
     * van MongoDB lan thu hai — hai lan doc co the lech nhau neu co suat
     * moi duoc cap xen vao.
     *
     * Cho phep mang RONG de tuong thich nguoc: cac luong chua kip sua
     * van goi duoc, chi la khong cong bo gi.
     */
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

    // =========================
    // OFF-CHAIN VERIFIED WITHDRAW
    // =========================

    /*
     * Proof đã được native Halo2 backend
     * xác thực trước khi request được tạo.
     *
     * Chỉ tài khoản school được gọi hàm này,
     * sau khi University phê duyệt giải ngân.
     */
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

        /*
         * V1(b) — cuong che menh gia. `denomination == 0` nghia la pool
         * nay khong cuong che (giu cho kich ban doi chung cua C-13).
         */
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

        /*
         * Đánh dấu trước khi gọi transfer
         * theo Checks-Effects-Interactions.
         */
        usedNullifier[nullifier] =
            true;

        (
            bool success,
            /* bytes memory data */
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

    // =========================
    // BALANCE
    // =========================

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