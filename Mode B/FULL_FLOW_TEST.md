# Hướng dẫn kiểm thử Scholarship Pool full flow

> # 🏗️ REFACTOR TẦNG BACKEND — 2026-08-18, đọc trước khi chạy
>
> Backend ONC nay **cùng khuôn tầng với ADV**: `cli/` → `controllers/` → `services/` → `clients/`.
>
> ✅ **Mọi lệnh `npm run` trong tài liệu này chạy Y NGUYÊN.** Tên script không đổi, chỉ đích đổi
> sang `cli/`. Đầu ra cũng không đổi một byte — vẫn `printJson`, nên các bước `ConvertFrom-Json`
> phía sau giữ nguyên.
>
> Sáu file đổi chỗ *(chỉ ảnh hưởng nếu bạn mở thẳng file, không ảnh hưởng lệnh chạy)*:
>
> | Cũ | Nay |
> |---|---|
> | `services/blockchainService.ts` | `clients/blockchain/blockchainClient.ts` |
> | `services/withdrawService.ts` | `clients/blockchain/shieldedPoolClient.ts` |
> | `services/uploadToIpfs.ts` | `clients/ipfs/ipfsClient.ts` |
> | `services/getStudentFromIpfs.ts` | `clients/ipfs/encryptedNoteStorage.ts` |
> | `client/decryptStudentNoteClient.ts` | `clients/ipfs/noteEncryption.ts` |
> | phần gọi prover của `generateStudentFile.ts` | `clients/prover/halo2ProverClient.ts` |
>
> 🟢 **Mới:** `npm test` nay chạy được ở ONC — **9/9 pass**. Trước đó ONC không có test backend nào.
>
> ⚠️ **Vòng đời MongoDB đã dời lên tầng controller.** Service không còn tự
> `connectDatabase()`. Nếu bạn viết script mới gọi thẳng service, script đó **phải tự mở kết nối** —
> ba chỗ đã phải sửa vì lý do này *(hai runner thí nghiệm và `fullFlowService`)*.


Tài liệu này kiểm thử flow theo từng service độc lập. `flow:full` ở cuối chỉ là
wrapper gọi lại các service, không chứa một bản nghiệp vụ song song.

Flow đã được đối chiếu với
`zk-circuits-halo2-advanced/docs/scholarship-pool-flow.md` và
`Outline of Paper.docx`. Nhánh này dùng Halo2 EVM calldata và
`Halo2Verifier`, thay vì sao chép cơ chế verify off-chain của repo advanced.

> # ⛔ CHẠY BẰNG POWERSHELL — ĐỪNG DÙNG WSL
>
> Backend chọn binary prover **theo nền tảng**:
>
> ```js
> process.platform === "win32" ? "prover.exe" : "prover"
> ```
>
> | Chạy ở | Dùng binary |
> |---|---|
> | **PowerShell** | `target/release/prover.exe` — bản bạn vừa `cargo build` |
> | **WSL / Git Bash Linux** | `target/release/prover` — **binary Linux cũ**, có thể còn sót từ lần build trước |
>
> Nếu còn file `target/release/prover` (không đuôi) từ một lần build cũ, WSL sẽ **âm thầm dùng nó**.
> Đã gặp thật: binary cũ ở `MERKLE_DEPTH = 3` sinh root khác hẳn bản depth 7, khiến verifier từ chối
> mà không rõ lý do, và thông điệp lỗi trông giống hệt lỗi mật mã.
>
> **Kiểm nhanh:**
>
> ```powershell
> Get-ChildItem target\release\prover*
> ```
>
> Thấy file `prover` không đuôi → **xoá nó đi**, nó chỉ gây hại:
>
> ```powershell
> Remove-Item target\release\prover
> ```
>
> `node_modules` cũng cài cho Windows — chạy dưới WSL còn kéo theo lỗi module native (chính Ganache
> cũng báo `Cannot find module '../binaries/uws_linux_x64_127.node'`).

## Vai trò của repo này

**`zk-circuits-halo2-advanced` (ADV) là hệ thống chính của bài báo. Repo này tồn tại để lấy số liệu
cho nhánh on-chain verification** — đặc biệt là gas, thứ ADV về cấu trúc không sinh ra được
(`withdrawOffChain` của ADV không nhận proof, không có verifier on-chain).

Hệ quả khi đọc số liệu, cần tách bạch:

- **Gas — so sánh ADV vs ONC hợp lệ.** Gas chỉ phụ thuộc đường code Solidity, không phụ thuộc đường
  cong hay `k`. `withdrawOffChain` của ADV (~62,500 gas, không verifier) vs `withdraw` của repo này
  (kèm proof ~3,2 KB calldata + `staticcall` sang `Halo2Verifier`) — chênh lệch **chính là** chi phí
  đưa verification lên chain.
- **Thời gian — so sánh ADV vs ONC bị nhiễu.** ADV dùng IPA/pasta `k=10`, repo này dùng KZG/BN254
  `k=13`. Đó là hai hệ chứng minh khác nhau, nên chênh lệch thời gian không quy về "verify ở đâu"
  được. Phải ghi chú rõ trong bài.

Chi tiết ở `../GAP_ANALYSIS.md` mục "Vai trò hai repo" và `../DECISIONS.md` mục C1.

> **Caveat khi đo proof generation time:** `gen_evm_proof_shplonk` của `snark-verifier-sdk` **tự
> verify native** rồi `assert!` ngay sau khi tạo proof, và khối đó không nằm sau
> `#[cfg(debug_assertions)]` nên chạy cả ở bản release. Nghĩa là mỗi lần sinh proof đã bao gồm sẵn
> một lần verify off-chain, bị gộp chìm vào thời gian proving. Cần con số proving "thuần" thì phải
> trừ ra hoặc nêu rõ.

Không file nào trong `zk-circuits-halo2-advanced` bị sửa bởi flow của repo này.

> # THỰC NGHIỆM ĐỊNH TÍNH — cách chạy đầy đủ

Chạy **độc lập** với luồng chạy tay bên dưới. Kết quả chính thức: `reports/qualitative_onchain.md`

### Bước 1 — Ba dịch vụ nền phải sẵn sàng

Ganache `127.0.0.1:8545` · IPFS API `127.0.0.1:5001` · MongoDB. Runner **không** tự khởi động chúng.

### Bước 2 — Tạo config (một lần)

```powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-halo2-onchain\backend
Copy-Item experiment.config.example.json experiment.config.json
notepad experiment.config.json
```

Điền địa chỉ từ Ganache: `university.walletAddress` = account[0] ·
`student.walletAddress` = account[2] · `pool.sponsorWalletAddress` = account[1].

`student.privateKey` là khoá **mã hoá note** 32 byte, **không** phải khoá ví Ganache.

Giữ nguyên khối:

```json
"run": { "resetDatabase": true }
```

File này chứa khoá riêng nên **đã nằm trong `.gitignore`** — đừng commit.

### Bước 3 — Trỏ sang **database riêng** rồi chạy

**Bắt buộc.** Runner tự tạo University/pool mới mỗi lượt; chạy chung database với luồng chạy tay sẽ
làm lẫn dữ liệu và **đổi `currentRoot` của pool đang dùng dở**.

```powershell
# Đọc MONGODB_URI từ .env rồi CHỈ đổi tên database — không gõ lại mật khẩu
$uri = (Get-Content .env | Select-String '^MONGODB_URI=').ToString() -replace '^MONGODB_URI=','' -replace '^["'']|["'']$',''
$env:MONGODB_URI = $uri -replace '/[^/?]*(\?|$)', '/scholarship_zkp_onchain_qualitative$1'

# Kiểm tra đã đổi đúng trước khi chạy (mật khẩu được che)
$env:MONGODB_URI -replace '://[^@]*@', '://<ẩn>@'

npm run experiment:qualitative -- .\experiment.config.json
```

`$env:MONGODB_URI` chỉ sống trong cửa sổ PowerShell đó — đóng terminal là mất, **không** đụng `.env`.

> ⚠️ Đoạn `-replace '^["'']|["'']$',''` là **bắt buộc**: `.env` bọc giá trị trong dấu nháy, thiếu nó
> thì biến môi trường mang theo cả dấu nháy và MongoDB sẽ từ chối kết nối.

> ### Runner có khoá an toàn
>
> Nó **từ chối reset** nếu tên database không chứa `qualitative` hoặc `experiment`. Nghĩa là
> **không thể** xoá nhầm dữ liệu chạy tay của bạn, kể cả khi bạn quên bước 3.

### Bước 4 — Đọc kết quả

CLI in ra **bốn** đường dẫn *(năm khi `studentCount > 1`)*:

```text
QUALITATIVE EXPERIMENT RESULT: ...\qualitative-<timestamp>.json
  CSV 1 (5 criteria)        : ...\qualitative-<timestamp>-tieuchi.csv
  CSV 2 (C3 amount binding) : ...\qualitative-<timestamp>-C3-rangbuoc-amount.csv
  CSV 3 (measurement + limits): ...\qualitative-<timestamp>-dieukiendo.csv
```

| File | Dùng để |
|---|---|
| **`-tieuchi.csv`** | **file chính** — **5 khoá** tiêu chí *(tiêu chí 2 tách `2a`/`2b` từ 29/08)*, mỗi dòng một bằng chứng, không có ô trống |
| `-C3-rangbuoc-amount.csv` | ràng buộc `amount` ở mức contract — đối chứng ADV ↔ ONC |
| `-dieukiendo.csv` | điều kiện đo (CPU/RAM/`k`/đường cong) + giới hạn của thí nghiệm |
| `.json` | bằng chứng gốc đầy đủ — **giữ lại khi nộp** |

Điểm chấm nằm ở `qualitativeCriteria_2_1_3`, **do runner tự suy ra từ số đo**, không gán tay.
**5 khoá**: `1_replay_prevention` · `2a_state_readable` · `2b_state_verifiable` ·
`3_encrypted_note` · `4_private_witness` — bốn dòng của outline 2.1.3, tiêu chí 2 tách đôi
ngày 2026-08-29 *(xem `STATUS.md` mục T5·A)*.

### Chạy lại lần hai

Chạy thẳng lại được, không phải dọn tay — `resetDatabase` lo phần đó. Quên bật nó thì lỗi sẽ là
`University name or wallet address already exists`.

---

## Quy ước lệnh — **giống hệt nhau ở cả hai repo**

Hai repo dùng **chung một bộ tên lệnh**. Học một lần, chạy được cả hai:

| Lệnh | Việc | ADV | ONC |
|---|---|:--:|:--:|
| `npm run db:test` | kiểm tra kết nối MongoDB | ✅ | ✅ |
| `npm run flow:reset` | xoá sạch dữ liệu flow | ✅ | ✅ |
| `npm run university:create` | tạo University | ✅ | ✅ |
| `npm run student:create` | tạo hồ sơ sinh viên | ✅ | ✅ |
| `npm run staff:create` | thêm nhân sự kèm phòng ban — **cần `actingStaffId` là nhân sự hiện hữu** *(K6 · K9a)* | ✅ | ✅ |
| `npm run staff:password` | đặt / đổi mật khẩu nhân sự *(**K9b**, mới)* | ✅ | ✅ |
| `npm run staff:login` | đăng nhập, trả về vai trò để tầng gọi giữ phiên *(**K9b**, mới)* | ✅ | ✅ |
| `npm run student:eligibility` | Phòng CTSV duyệt điều kiện — **cần `staffId` role `STUDENT_AFFAIRS`** | ✅ | ✅ |
| `npm run student:finance` | Phòng KH-TC duyệt số tiền — **cần `staffId` role `FINANCE`** | ✅ | ✅ |
| `npm run student:pubkey` | dẫn xuất public key từ private key | ✅ | ✅ |
| `npm run student:wallet` | đăng ký ví + public key — 🆕 **cần `poolId`** | ✅ | ✅ |

> 🆕 **A22 (30/08) — thêm `poolId`, BẮT BUỘC.** Từ **A19** một trường có **nhiều chương trình học
> bổng**, mỗi chương trình một pool. Chỉ biết `universityId` thì **không xác định được đăng ký vào
> chương trình nào**, nên lệnh phải nói rõ.
>
> `universityId` **vẫn giữ** — nó dùng để **gác quyền** *(`authorizeStaff` chạy trước)* và để
> **kiểm chéo** rằng pool đó thuộc đúng trường; nếu bỏ, cán bộ trường A đăng ký được vào pool
> trường B.
>
> 🔴 **Một ví chỉ dùng cho ĐÚNG MỘT suất học bổng** *(A21)*. Sinh viên tham gia hai chương trình
> thì phải **đăng ký ví mới** — dùng lại ví cũ sẽ bị chặn với thông báo
> *"Wallet address is already used by another scholarship"*. Lý do: quan sát viên thấy cùng một địa
> chỉ ở hai `event Withdraw` thì **giao hai tập ứng viên**, tập ẩn danh co lại.
| `npm run pool:create` | tạo pool | ✅ | ✅ |

> 🆕 **A19 (29/08): đối số thứ 3 tuỳ chọn — TÊN CHƯƠNG TRÌNH.** Một trường nay có **nhiều pool**,
> mỗi pool là một chương trình học bổng. Không truyền thì dùng tên mặc định
> *"Hoc bong khuyen khich hoc tap"*, nên **mọi lệnh cũ chạy y như trước**.
>
> ```powershell
> npm run pool:create -- $university._id KHTC-01 Hoc bong tai tro doanh nghiep
> ```
>
> Tên có dấu cách **không cần quote** — CLI gộp phần còn lại của `argv`.
>
> 🔴 **Trước khi tạo pool THỨ HAI cho cùng một trường, phải chạy một lần:**
> `npx ts-node src/scripts/dropLegacyPoolIndex.ts` — index cũ `university_1` không tự mất khi bỏ
> `unique` trong schema, và `resetDatabase` cũng không xoá index. Xem `STATUS.md` **A19**.
| `npm run pool:deploy` | deploy pool (ONC deploy kèm verifier) | ✅ | ✅ |
| `npm run pool:fund` | sponsor nạp ETH | ✅ | ✅ |
| `npm run pool:balance` | xem số dư pool | ✅ | ✅ |
| `npm run scholarship:issue` | phát học bổng, tạo note mã hoá | ✅ | ✅ |
| `npm run root:approve` | University duyệt và publish Merkle root | ✅ | ✅ |
| `npm run note:decrypt` | sinh viên giải mã note | ✅ | ✅ |
| `npm run withdrawal:create` | sinh proof + tạo yêu cầu rút *(đọc **stdin**)* | ✅ | ✅ |
| `npm run withdrawal:review` | University duyệt và giải ngân | ✅ | ✅ |
| `npm run withdrawal:review-batch` | Duyệt **cả lô**, hệ thống **tự xáo thứ tự chi** | ✅ | ✅ |
| `npm run experiment:multipool-parallel` | 6 chương trình **chạy song song** — cần `--miner.blockTime` | ✅ | ✅ |
| `npm run experiment:lap20` | 🆕 **LAP20 · 14/09/2026** — lặp **20 lượt độc lập, 3 warm-up mỗi lượt**, báo `mean ± SD`. `THI_NGHIEM=theo_n` *(d = 9, n = 1…500)* hoặc `THI_NGHIEM=theo_d` *(d = 1…8, lấp đầy cây n = 2^d)*. Lượt có `xong.json` bị bỏ qua ⇒ **dừng rồi chạy tiếp được** | ✅ | ✅ |
| `npm run experiment:lap20:tonghop` | 🆕 tổng hợp `mean ± SD`, chạy `summarizeLap20.ts` *(tên cũ `tongHopLap20.ts`, đổi 16/09)*. Không đụng Ganache/prover | ✅ | ✅ |

> 🔴 **`experiment:lap20` của ONC ở chế độ `theo_d`** xuất và biên dịch **một verifier cho mỗi độ sâu**,
> rồi **trả `Halo2Verifier.sol` về bản git HEAD** và kiểm bytecode trùng bản cũ. Runner **từ chối chạy**
> nếu tệp đó khác HEAD — dấu hiệu một lần `theo_d` trước bị giết giữa chừng. Khôi phục bằng
> `git checkout -- contracts/contracts/Halo2Verifier.sol` rồi `npm run compile` trong `contracts/`.
>
> ⚠️ **ADV và ONC dùng chung một Ganache** *(cùng `accounts[0]`)* nên **tuyệt đối không chạy cùng lúc**.

> ### 🔴 Lệnh khởi động Ganache — cờ nào cho việc gì
>
> **Viết một dòng.** Shell của dự án là PowerShell; dấu `\` cuối dòng là cú pháp bash và sẽ báo
> `Missing expression after unary operator '--'`.
>
> Luồng thường · định lượng · định tính — instamine, KHÔNG `blockTime`:
>
> ```
> ganache --wallet.totalAccounts 501 --wallet.mnemonic "test test test test test test test test test test test junk"
> ```
>
> Riêng `experiment:multipool-parallel` — thêm cờ đào theo đồng hồ:
>
> ```
> ganache --wallet.totalAccounts 501 --wallet.mnemonic "test test test test test test test test test test test junk" --miner.blockTime 2
> ```
>
> | Cờ | Bắt buộc khi nào |
> |---|---|
> | `--wallet.totalAccounts 501` | **luôn luôn** — mỗi sinh viên một ví (`accounts[1..n]`), `n = 500` cần 501. Mặc định 10 ví chỉ đủ tới `n = 9` |
> | `--wallet.mnemonic "test … junk"` | **luôn luôn** — phải khớp `GANACHE_MNEMONIC`, sai là `assertGanacheAccountMatches` dừng ngay |
> | `--miner.blockTime 2` | **chỉ** cho `experiment:multipool-parallel` |
>
> 🔴 **Vì sao `--miner.blockTime` là bắt buộc cho phép đo song song.** Ganache mặc định *instamine*:
> đào ngay một block cho **mỗi** giao dịch. Ở chế độ đó số block luôn bằng số giao dịch, dù các pool
> có chạy đồng thời hay không — con số thu được là **tạo tác của Ganache**, không phải tính chất hệ
> thống. Runner **tự phát hiện và dừng lại** thay vì cho ra số sai.
>
> ⚠️ Đổi lại, dưới `blockTime` block được đào **theo đồng hồ**, nên `withdraw_ms` bị thổi lên vì chờ
> nhịp block — **không so được** với lượt chạy chính.
>
> ⚠️ **Hai repo dùng CHUNG một Ganache** (cùng RPC, cùng mnemonic) ⇒ **không chạy ADV và ONC cùng
> lúc**, `accounts[0]` sẽ đụng nonce.
>
> ⚠️ **IPFS chỉ cần cho `experiment:prepare`** (mã hoá note, lấy CID). Sinh proof và đo gas không
> đụng tới — tắt đi tiết kiệm ~255 MB nếu thiếu RAM.
| `npm run experiment:qualitative` | **thực nghiệm định tính** (outline 2.1.3 — 5 khoá) | ✅ | ✅ **(mới 2026-08-14)** |

Lệnh chỉ có ở một bên, vì cơ chế hai repo khác nhau:

| Lệnh | Chỉ ở | Việc |
|---|---|---|

| `npm run experiment:prepare` · `:proofs` · `:gas` · `:artifacts` | **ONC** | thực nghiệm định lượng (gas) |
| `npm run flow:full` | **ONC** | wrapper gọi lại các bước trên |

### ⚠️ Hai điều bắt buộc khi gõ lệnh

**1. Phải có `--silent`** khi bạn hứng kết quả bằng `ConvertFrom-Json`. Không có nó, `npm` in thêm
banner **ra stdout** và JSON bị hỏng:

```powershell
# SAI - banner lot vao stdout, ConvertFrom-Json bao loi
$pool = (npm run pool:create -- $university._id KHTC-01) | ConvertFrom-Json

# DUNG
$pool = (npm run --silent pool:create -- $university._id KHTC-01) | ConvertFrom-Json
```

**2. Dấu `--` đứng trước tham số**, để `npm` chuyển tiếp chúng cho script thay vì tự diễn giải.

> **Dạng cũ vẫn chạy được.** `npm run` chỉ là bí danh trỏ vào đúng file cũ — không có dòng logic nào
> bị đổi. Nếu bạn có ghi chép cũ dùng `npx ts-node src/services/...` thì nó vẫn đúng. Dùng `npm run`
> vì tên lệnh không phụ thuộc đường dẫn: mai mốt refactor có dời file thì lệnh vẫn nguyên.

## 1. Luồng và trạng thái

| # | Service on-chain | Kết quả |
|---:|---|---|
| 1 | `createUniversityService.ts` | University `ACTIVE` |
| 2 | `createStudentProfileService.ts` | eligibility/finance `PENDING` |
| 3 | `approveEligibilityService.ts` | eligibility `ELIGIBLE` |
| 4 | `approveFinanceService.ts` | finance `APPROVED` và có budget |
| 5 | `createScholarshipPoolService.ts` | pool `PENDING_DEPLOYMENT` |
| 6 | `deployScholarshipPoolService.ts` | deploy verifier + pool, `DEPLOYED` |
| 7 | `fundScholarshipPoolService.ts` | sponsor nạp ETH, event `Deposit` |
| 8 | `registerStudentWalletService.ts` | lưu wallet + public key |
| 9 | `issueScholarshipService.ts` | gán Merkle index, tạo commitment, encrypted note lên IPFS; `NOTE_CREATED` |
| 10 | `approveRootService.ts` | dựng cây/root từ ordered commitments, University gọi `updateRoot`; `ROOT_APPROVED`. 🆕 **K10**: sau khi `updateRoot` thành công, cây được lưu vào collection `merkleNodes` (stderr in `Merkle nodes saved: … | depth: …`) |
| 11 | `decryptStudentNoteClient.ts` | student xuất `{cid, note: {student_id, amount, rho}}` |
| 12 | `createWithdrawalRequestService.ts` | ràng buộc CID, sinh nullifier + proof/calldata, verifier thật accept; `PENDING_APPROVAL`. 🆕 **K10**: đọc đường Merkle đã lưu thay vì dựng lại cây — stderr in `MERKLE PATH: read 9 stored nodes`, hoặc `not stored - rebuilding from N commitments` nếu pool duyệt root trước K10 |
| 13 | `reviewWithdrawalRequestService.ts` | University approve, contract withdraw, `EXECUTED`/`WITHDRAWN` |
| 14 | approve lại cùng request | transaction revert, `usedNullifier == true` |

Các CLI/process riêng chia sẻ dữ liệu qua MongoDB, đúng cấu trúc backend của
advanced. On-chain dùng 6 collection được namespace riêng — 🆕 `onchain_merkle_nodes` thêm ở K10:
`onchain_universities`, `onchain_university_students`,
`onchain_scholarship_pools`, `onchain_student_scholarships` và
`onchain_withdrawal_requests`. Vì vậy không đụng collection của repo advanced.

## 2. Yêu cầu và build

- Rust/Cargo.
- Node.js/npm. Hardhat 2 cảnh báo với Node 22; nên dùng Node 20 LTS.
- Ganache CLI.
- Kubo/IPFS CLI.
- MongoDB local hoặc MongoDB Atlas.

~~~powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-halo2-onchain
cargo build --release -p prover

# BẮT BUỘC nếu circuit vừa đổi (xem mục 2b). Ghi đè
# contracts/contracts/Halo2Verifier.sol.
.\target\release\prover.exe export-verifier

Set-Location .\contracts
npm install
npm run compile

Set-Location ..\backend
npm install
npm run typecheck
npm run db:test
~~~

## 2b. Merkle depth và verifier — đọc trước khi chạy

**`MERKLE_DEPTH = 9`**, tức mỗi pool tối đa **`2^9 = 512` sinh viên**
(`prover/src/flow_inputs.rs`, `backend/src/services/issueScholarshipService.ts`). Sinh viên thứ 513
bị `issueScholarshipService` từ chối. Depth đã đi 3 → 7 → **9** *(9 từ 2026-08-30, để chứa đợt
HBKKHT thật của UIT là **353 suất**; xem `code/STATUS.md` mục `d = 9`)*.

> 🔴 **Runner định lượng của ONC KHÔNG đọc hằng số này.** `bench-from-dataset` dựng cây từ trường
> `merkle_depth` **trong file** `experiments/data/dataset_n*.json` (`prover/src/inputs_builder.rs:802`).
> Cả 12 file đã đổi sang `9` ngày 2026-08-30. Sửa hằng số Rust mà quên file thì runner vẫn lặng lẽ
> chạy ở depth cũ.
>
> 🔴 **Verifier đang deploy vẫn là bản `d = 7`** — phải `export-verifier` → `npx hardhat compile` →
> deploy lại trước khi chạy bất cứ thứ gì, nếu không mọi proof mới đều bị từ chối.

**`Halo2Verifier.sol` bị ràng buộc vào circuit shape.** Đổi `MERKLE_DEPTH`, đổi `K`, hoặc đổi số
public input đều làm verifier cũ **vô hiệu**. Phải chạy lại:

~~~powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-halo2-onchain
.\target\release\prover.exe export-verifier
~~~

Kỳ vọng:

~~~
Verifier.sol generated at ...\prover\../contracts/contracts/Halo2Verifier.sol
{"success":true,"file":"contracts/contracts/Halo2Verifier.sol"}
~~~

rồi `npm run compile` trong `contracts/` và **deploy lại pool** (verifier được deploy cùng pool ở
mục 6). Verifier cho depth 7 có kích thước ~73 KB source / ~17 KB bytecode.

> ⚠️ **`contracts/test/ShieldedPool.js` deploy `MockHalo2Verifier`, không phải verifier thật.**
> Nghĩa là `npm test` **vẫn 4 passing** kể cả khi `Halo2Verifier.sol` đã lỗi thời so với circuit.
> Muốn chắc verifier thật còn khớp thì phải chạy hết mục 10 — ở đó backend gửi giao dịch `verifyAndRecord` sang
> verifier thật với calldata thật.

`backend/.env`:

~~~dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/scholarship_zkp_onchain
IPFS_HOST=127.0.0.1
IPFS_PORT=5001
IPFS_PROTOCOL=http
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
~~~

## 3. Chạy dịch vụ nền

Terminal 1:

~~~powershell
ganache --wallet.totalAccounts 10 --chain.chainId 1337 --server.port 8545
~~~

Cần thấy `RPC Listening on 127.0.0.1:8545`.

Terminal 2:

~~~powershell
ipfs daemon
~~~

Cần thấy API nghe ở `/ip4/127.0.0.1/tcp/5001`.

Terminal 3:

~~~powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-halo2-onchain\backend
~~~

## 4. Reset database test và gán role

~~~powershell
npm run flow:reset

$accounts = (node -e "const {Web3}=require('web3'); new Web3('http://127.0.0.1:8545').eth.getAccounts().then(a=>console.log(JSON.stringify(a)))") | ConvertFrom-Json
$UNIVERSITY_WALLET = $accounts[0]
$SPONSOR_WALLET = $accounts[1]
$STUDENT_WALLET = $accounts[2]

# Chỉ dùng mã hóa note, không cần trùng private key ví Ganache.
$NOTE_PRIVATE_KEY = "0x1c0de00000000000000000000000000000000000000000000000000000000002"
~~~

Ba wallet phải khác nhau. `flow:reset` chỉ xóa document trong 6 collection có
prefix `onchain_`; nó không xóa collection advanced, không drop database và
không reset Ganache/IPFS. MongoDB Compass vẫn hiển thị database/collection sau
reset, nhưng `deletedDocuments` cho biết số record đã xóa.

## 5. University tạo và duyệt hồ sơ

> 🔑 **Không cần tạo nhân sự thủ công.** `university:create` tự dựng sẵn **`CTSV-01`**
> *(Phòng CTSV)* và **`KHTC-01`** *(Phòng KH-TC)* — đây là **giả định tin cậy lúc khởi tạo** (K9).
> `staff:create` chỉ dùng khi muốn thêm nhân sự **ngoài** hai tài khoản đó, và **bắt buộc** có một
> nhân sự hiện hữu bảo lãnh:
> `npm run staff:create -- <universityId> <actingStaffId> <staffId> <STUDENT_AFFAIRS|FINANCE>`

~~~powershell
$university = (npm run --silent university:create -- "CLI University" $UNIVERSITY_WALLET) | ConvertFrom-Json
$student = (npm run --silent student:create -- $university._id CTSV-01 24560003 cli-student@example.edu) | ConvertFrom-Json

npm run --silent student:eligibility -- $university._id CTSV-01 24560003 approve
npm run --silent student:finance -- $university._id KHTC-01 24560003 100000000000000000
~~~

Cần thấy hồ sơ ban đầu có cả hai trạng thái `PENDING`; sau đó eligibility là
`ELIGIBLE`; cuối cùng finance là `APPROVED` và
`amountWei = "100000000000000000"`. Chạy finance trước eligibility phải
fail.

## 6. Tạo, deploy và fund pool

~~~powershell
$pool = (npm run --silent pool:create -- $university._id KHTC-01) | ConvertFrom-Json
$deployed = (npm run --silent pool:deploy -- $pool._id KHTC-01 1000000000000000000) | ConvertFrom-Json

npm run --silent pool:fund -- $pool._id KHTC-01 500000000000000000 $SPONSOR_WALLET
npm run --silent pool:balance -- $pool._id
~~~

Cần thấy pool chuyển `PENDING_DEPLOYMENT -> DEPLOYED`, có
`verifierAddress`/`contractAddress`, `universityAddress` là University và balance là
`1500000000000000000` wei (1 ETH initial funding + 0.5 ETH sponsor).

## 7. Đăng ký public key và issue note

~~~powershell
$STUDENT_PUBLIC_KEY = (npm run --silent student:pubkey -- $NOTE_PRIVATE_KEY).Trim()
npm run --silent student:wallet -- $university._id CTSV-01 $pool._id cli-student@example.edu $STUDENT_WALLET $STUDENT_PUBLIC_KEY

$scholarship = (npm run --silent scholarship:issue -- $university._id CTSV-01 24560003) | ConvertFrom-Json
$scholarship | Select-Object _id,status,encryptedNoteCid,commitment,merkleIndex
~~~

Cần thấy:

- `status: "NOTE_CREATED"`;
- CID bắt đầu bằng `Qm` hoặc `bafy`;
- commitment là bytes32;
- `merkleIndex: 0` với scholarship đầu;
- MongoDB document không chứa `rho` hoặc `$NOTE_PRIVATE_KEY`.

Thứ tự nội bộ bám đúng advanced: xác định Merkle index kế tiếp trong pool → tạo
note → Poseidon commitment → ECDH/AES-GCM encrypt → IPFS → lưu CID, commitment,
index và `NOTE_CREATED`. Nullifier chưa được lưu; nó chỉ được sinh từ `rho` sau
khi student giải mã note ở bước tạo withdrawal request.

## 8. University duyệt và publish root

~~~powershell
$rootApproval = (npm run --silent root:approve -- $pool._id CTSV-01) | ConvertFrom-Json
$rootApproval
~~~

Service đọc các commitment theo `merkleIndex`, kiểm tra index liên tục, dựng
Merkle tree/root bằng Rust rồi mới gọi chain. Cần thấy `currentRoot` trùng root,
`validRoot: true`, có transaction hash và scholarship chuyển
`NOTE_CREATED -> ROOT_APPROVED`. Chỉ University deployer gọi được `updateRoot`.

> ### ⚠️ Issue thêm note thì **phải chạy lại mục 8**
>
> Root là hàm của **toàn bộ** tập commitment trong pool. Mỗi lần mục 7 issue thêm một sinh viên,
> cây đổi → root đổi → `currentRoot` trên chain **lỗi thời ngay lập tức**.
>
> Proof của sinh viên cũ (sinh trước lần issue mới) mang root cũ, nên ở mục 10 sẽ bị verifier từ
> chối với đúng thông điệp này:
>
> ```
> Proof rejected by Halo2Verifier: root does not match currentRoot on-chain
> ```
>
> Đây **không phải lỗi mật mã** — proof hoàn toàn hợp lệ, chỉ là nó chứng minh membership trong một
> cây không còn là cây hiện hành. Cách xử lý: chạy lại mục 8 để publish root mới, rồi **sinh lại
> proof** ở mục 10 (proof cũ không dùng lại được).
>
> Thứ tự an toàn: **issue hết tất cả sinh viên (mục 7) → approve root một lần (mục 8) → mới sang mục
> 9/10.** Kịch bản n = 5/10/20/50/100 ở mục 13b đi theo đúng thứ tự này.
>
> `validRoot` giữ **lịch sử** các root đã duyệt, nên root cũ vẫn nằm trong `validRoot` — nhưng
> `Halo2Verifier` ở mục 10 được nạp `currentRoot` (root **hiện hành**), không phải lịch sử. Hai chỗ
> này khác nhau, đừng lẫn.

## 9. Student giải mã note

~~~powershell
$submissionJson = (npm run --silent note:decrypt -- $scholarship.encryptedNoteCid $NOTE_PRIVATE_KEY).Trim()
$submissionJson
~~~

Ví dụ:

~~~json
{"cid":"Qm...","note":{"student_id":24560003,"amount":"100000000000000000","rho":"..."}}
~~~

Đây là bước phía student. Không ghi note/private key vào state. Private key sai
phải làm AES-GCM authentication fail.

## 10. Tạo proof/calldata và request

~~~powershell
$request = ($submissionJson | npm run --silent withdrawal:create) | ConvertFrom-Json
$request
~~~

Service sẽ:

1. tìm đúng scholarship bằng CID rồi đối chiếu student ID/Finance amount;
2. tính lại commitment từ note và so với commitment đã lưu;
3. sinh nullifier từ `rho` nhưng không ghi nó vào scholarship;
4. lấy commitments theo Merkle index, dựng path và đọc current root từ chain;
5. sinh Halo2 proof với public input `root | nullifier | amount`;
6. 🔄 gửi **giao dịch thật** `ShieldedPool.verifyAndRecord(...)` — hợp đồng tự `staticcall` sang
   `Halo2Verifier` rồi **ghi `claims[nullifier]`** và phát sự kiện `ClaimVerified`;
7. lưu nullifier trong request `PENDING_APPROVAL`, **chưa chi tiền**.

Cần thấy `status: "PENDING_APPROVAL"`, `verifierChecked: true`, `calldataBytes > 96`, và
🆕 **`verifyRecordTxHash`** *(hash giao dịch xác minh)* + **`verifyRecordGas`** *(~500 000)*.
Pool/student balance **chưa đổi** — `verifyAndRecord` không chuyển tiền.

> 🔄 **Đổi 2026-08-25.** Bước 6 trước đây là `eth.call` — miễn phí và **không để lại dấu vết**,
> nên hợp đồng ở bước rút phải verify **lại**. Nay xác minh chỉ chạy một lần và kết quả nằm trên
> chuỗi. Kiểm được bằng:
>
> ~~~powershell
> # calldata thật của giao dịch xác minh, đọc thẳng từ chuỗi
> $request.verifyRecordTxHash
> ~~~
>
> Lý do đầy đủ: `code/DECISIONS.md` **B6**.

## 11. University approve và settle

~~~powershell
$withdrawal = (npm run --silent withdrawal:review -- $request.id KHTC-01 approve) | ConvertFrom-Json
$withdrawal
~~~

Cần thấy `status: "EXECUTED"`, transaction hash, `usedNullifier: true`, 🆕 **`settleGas`**
*(~63 000 — rẻ vì **không verify lại**)*, pool giảm
từ `1500000000000000000` xuống `1400000000000000000` wei, student nhận đúng
`100000000000000000` wei và scholarship chuyển
`ROOT_APPROVED -> WITHDRAWN`.

> 🔄 **Bước này nay gọi `settle(nullifier)`, không phải `withdraw(...)`.**
>
> `settle` **chỉ nhận một tham số `bytes32`**. Người nhận, số tiền và root đều đọc từ `Claim` đã
> ghi ở bước 10 — **không có tham số nào để truyền sai**. Đó là điều làm cho việc tách xác minh
> khỏi thanh toán vẫn an toàn: nếu `settle` nhận thêm `recipient`/`amount` thì kẻ tấn công có thể
> verify một đằng, chi tiền một nẻo.
>
> `withdraw(...)` **vẫn còn** trong hợp đồng, dùng để đo thiết kế gộp làm đối chứng trong thực
> nghiệm định lượng. Luồng nghiệp vụ **không gọi** nó.
> Kiểm chứng: `contracts/test/ClaimBinding.js` *(7/7; từ A25 **9/9** — thêm ca kẻ gian gửi trước và ca sai ví)*.
>
> 🔴 **A25 (2026-09-12):** `verifyAndRecord` nay là `onlySchool`, và ví nhận là **public input thứ 4**
> — hợp đồng `require` ví = word thứ 4 của proof, vẫn tự verify proof. Backend thay **128** byte đầu
> calldata *(thêm word ví đã đăng ký)* và đọc lại `claims[nf]` trên chuỗi trước `settle`. Lệnh chạy
> không đổi. Lý do: `../DECISIONS.md` A25.

> **Root chỉ được kiểm tra bằng dữ liệu on-chain.** Service đọc `currentRoot`/`validRoot` từ
> contract; bản `pool.currentRoot` trong MongoDB chỉ là bản sao phục vụ audit, **không** tham gia
> vào điều kiện chặn. Trước đây có thêm một điều kiện so với MongoDB, đã gỡ vì nó làm yếu chính
> luận điểm "root là trạng thái on-chain".

## 12. Chặn rút lần hai

~~~powershell
npm run --silent withdrawal:review -- $request.id KHTC-01 approve
$LASTEXITCODE
~~~

Bắt buộc: transaction thứ hai bị EVM revert, exit code `1`,
`usedNullifier` vẫn true và balance không đổi lần hai.

Contract test:

~~~powershell
Set-Location ..\contracts
npm test
~~~

Cần thấy `4 passing`, gồm test trả tiền một lần rồi reject cùng nullifier.

## 13. Wrapper kiểm tra nhanh (tùy chọn)

Sau khi Ganache/IPFS đang chạy:

~~~powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-halo2-onchain\backend
npm run flow:full
~~~

Wrapper tạo một bộ record test mới rồi gọi tuần tự function export của từng
service; nó không reset database và không có implementation nghiệp vụ riêng.
JSON cuối cần có:

~~~json
{
  "success": true,
  "studentBalanceDeltaWei": "100000000000000000",
  "poolBalanceAfterWei": "1400000000000000000",
  "usedNullifier": true,
  "replayRejected": true
}
~~~

## 13b. Thực nghiệm định lượng (đường riêng, không đi qua MongoDB)

Đây là mục đích chính của repo này. Ba bước chạy trong `backend/`:

~~~powershell
npm run --silent experiment:prepare
npm run --silent experiment:proofs
npm run --silent experiment:gas
~~~

- Input: `experiments/data/dataset_n*.json` cho n = 1, 5, 10, 20, 50, 100.
- Output: `experiments/results/quantitative/performance_onchain_n*.csv` và `proofs_n*.json`.
- Cột trong CSV: `deploy_pool_gas`, `deploy_verifier_gas`, `update_root_gas`, `verify_gas`,
  `verify_onchain_ms`, `withdraw_gas`, `withdraw_ms`, 🆕 `verify_record_gas`, `verify_record_ms`,
  🆕 `settle_gas`, `settle_ms`.

> 🆕 **Bốn cột cuối thêm 2026-08-25 — hai thiết kế, cùng một lượt chạy.**
>
> | Cột | Là gì |
> |---|---|
> | `withdraw_gas` | thiết kế **gộp** — một giao dịch làm cả xác minh lẫn chi tiền |
> | `verify_record_gas` | thiết kế **tách**, giai đoạn 1 — **riêng phần xác minh** |
> | `settle_gas` | thiết kế **tách**, giai đoạn 2 — **riêng phần chi tiền** |
>
> 🔴 Runner chụp `evm_snapshot` **trước mỗi proof**, đo thiết kế tách, `evm_revert` về đúng điểm
> đó, rồi đo thiết kế gộp. Bắt buộc phải vậy: **cả hai đều tiêu cùng một `nullifier`**, chạy nối
> tiếp trên một chuỗi thì cái sau revert với `"nullifier already used"` và `gasUsed` thu được là
> của một giao dịch **thất bại**.
>
> `settle_gas` là cột **so thẳng được** với `withdraw_gas` của nhánh off-chain *(cùng công việc)*.
> Đặc tả: `code/DINH_NGHIA_PHEP_DO.md` **Đ3a / Đ3b**, phép tự kiểm **K4**.

**Đường này độc lập với luồng nghiệp vụ ở mục 4–13.** Nó đọc `merkle_depth` từ chính file dataset
(`dataset_n100.json` dùng `merkle_depth: 7`) chứ không dùng hằng số `MERKLE_DEPTH` trong
`flow_inputs.rs`, và không đi qua MongoDB. Vì vậy nó chạy được ở n = 100 kể cả trước khi luồng
nghiệp vụ bỏ giới hạn 8 sinh viên.

Prover có **ba** mode riêng cho đường này. **Phải chạy từ trong `prover/`** — chúng ghi ra
`../experiments/results`, tức đường dẫn **tương đối với thư mục đang đứng**. Chạy từ gốc repo sẽ
tạo một thư mục lạc ở `code/experiments/` và kết quả thật **không** được cập nhật:

~~~powershell
Set-Location .\prover
..\target\release\prover.exe export-verifier-from-dataset ..\experiments\data\dataset_n100.json
..\target\release\prover.exe bench-from-dataset ..\experiments\data\dataset_n100.json
..\target\release\prover.exe check-k ..\experiments\data\dataset_n100.json   # LAP20, 14/09/2026
~~~

| Mode | Việc |
|---|---|
| `export-verifier-from-dataset` | sinh `contracts/contracts/Halo2Verifier.sol` cho **đúng `d` của dataset** |
| `bench-from-dataset` | sinh toàn bộ chứng minh của một kịch bản, ghi `performance_onchain_n*.csv` + `proofs_n*.json` |
| `check-k` 🆕 | chạy `keygen_vk` trên mạch mẫu, **thoát khác 0** khi thiếu hàng/cột. Dùng để dò `K` nhỏ nhất cho từng độ sâu |

### Ba biến môi trường đọc lúc chạy *(LAP20 · 14–16/09/2026)*

| Biến | Không đặt | Việc |
|---|---|---|
| `HALO2_K` | **13** — y hệt trước, giá trị sai thì **panic** | quyết định **cả** `use_k` của mạch **lẫn** kích thước params KZG *(cùng gọi `circuits::circuit::k_mach()`)* — không bao giờ lệch nhau |
| `BENCH_OUT_DIR` | ghi thẳng vào `experiments/results/quantitative/` | 🔴 đổi thư mục ra để **không đè** `proofs_n*.json` mà test hardhat và `recordArtifactSizes` đang đọc |
| `BENCH_WARMUP` | 0 | số lần chứng minh warm-up ghi ở **đầu** tệp CSV, **không** vào `proofs_n*.json` |

> ⚠️ **13/09/2026:** `bench-from-dataset` keygen **một lần** cho cả kịch bản rồi sinh chứng minh trong
> tiến trình đã chạy nóng — **khác luồng thật** *(mode `prove` keygen mỗi lần gọi)*. Giữ nguyên có chủ
> ý; xem `code/DECISIONS.md` A27 *(đã rút lại)*.
>
> ✅ **17/09/2026 — hai nhánh nay đo CÙNG điều kiện.** Nhánh off-chain đã có mode `prove-batch` làm
> đúng như `bench-from-dataset`: một tiến trình cho cả lượt, keygen một lần, xác minh ngay trong tiến
> trình đó. Nhờ vậy hai cột `setup_ms` đặt cạnh nhau được. Xem
> `code/PLAN_ALIGN_MEASUREMENT_CONDITIONS.md`.
>
> 🔴 Vẫn phải nhớ: **cả hai đều không phải luồng thật.** Luồng rút tiền thật mở một tiến trình mới cho
> mỗi lượt rút, nên khoá được sinh lại mỗi lần — `setup_ms` trong lô định lượng là **cận dưới**.

### ⛔ Ba việc phải làm trước khi tin số liệu định lượng

| # | Vấn đề | Phải làm gì |
|---|---|---|
| 1 | ~~**`proofs_n*.json` LỖI THỜI** — calldata 3072 byte, bị `Halo2Verifier` từ chối~~ | ✅ **SAI TỪ 2026-08-16.** Cả 6 file đọc ra **3 296 byte** và đã nạp thử lên Ganache: verifier đang biên dịch **chấp nhận cả 6**. Năm biến thể proof bị sửa (đổi byte giữa / byte cuối / `root` / calldata rỗng / cắt ngắn) đều **revert**. Không phải sinh lại |
| 2 | ~~**`benchmarkGas.ts` chưa chạy được** — ba hàm import đang bị comment~~ | ✅ **ĐÃ KHÔI PHỤC.** Ba hàm nay nằm ở `clients/blockchain/shieldedPoolClient.ts` *(đổi tên từ `withdrawService.ts`, refactor 2026-08-18)* và đã export. ⚠️ Khối comment quanh dòng 145–427 là **code chết**, đừng nhầm nó là bản đang dùng |
| 3 | ~~CSV **không có cột gas nào**~~ | ✅ **`gas_onchain_raw.csv` nay có 186 dòng** với đủ `deploy_pool_gas`, `deploy_verifier_gas`, `update_root_gas`, `verify_gas`, `verify_time_ms`, `withdraw_gas`, `withdraw_time_ms`. `performance_onchain_n*.csv` vẫn chỉ có cột proof-gen — **đúng thiết kế**, hai file đo hai thứ khác nhau |

> ### ✅ Mục 13b đã chạy xong 2026-08-16 — kết quả và cách chạy lại
>
> Lệnh: `npm run experiment:gas` *(từ `backend/`)* — khoảng **5–7 phút**, chỉ cần **Ganache**,
> **không** cần MongoDB, **không** cần IPFS.
>
> | Phép đo | Kết quả (186 mẫu, n = 1…100) |
> |---|---|
> | `verify_gas` | **442 644 – 442 896** — biên độ 252 gas = 0,06 % |
> | `withdraw_gas` | **hai băng**: 490 626 – 490 866 *(86 mẫu)* · 515 626 – 515 842 *(100 mẫu)*, chênh đúng 25 000 gas (EIP-161) |
> | `deploy_verifier_gas` | **3 734 187** — hằng số 186/186 |
> | `deploy_pool_gas` | 1 148 927 / 1 148 939 |
> | `update_root_gas` | 69 764 / 69 776 |
>
> ⚠️ **Một lỗi đã sửa khi chạy, đừng làm lại:** `benchmarkGas.ts` từng hằng hoá
> `AMOUNT_ETH = "0.01"` trong khi dataset dùng `amount = 2` wei. Vì `amount` là public input đã
> nướng vào proof, `require("amount differs from proof")` chặn **mọi** lần rút — cả lượt chạy
> revert ngay ở n = 1 với `gasUsed` 78 929. Nay `amount` lấy từ chính calldata của proof.
>
> ⛔ **Đừng chạy `npm run experiment:prepare`** — đang hỏng (`createExperimentStudentRecord` không
> được export), và kể cả sửa được cũng không nên chạy: `rho` mới sẽ làm 6 dataset lệch khỏi nhánh
> ADV, bài **mất quyền** nói *"cùng một đầu vào"*.
>
> Chi tiết đầy đủ — cách đo, vì sao ra kết quả đó, ý nghĩa, cách chạy tay:
> [`reports/quantitative_onchain.md`](reports/quantitative_onchain.md).

## 13c. Kiểm chứng verifier thật là cổng chặn

Bản ONC tương ứng với `prover/tests/verify_gate.rs` của repo off-chain. Dùng **`Halo2Verifier`
thật**, không dùng `MockHalo2Verifier`:

~~~powershell
# 1) sinh proof mới khớp verifier hiện tại
Set-Location .\prover
..\target\release\prover.exe bench-from-dataset ..\experiments\data\dataset_n1.json

# 2) chạy test
Set-Location ..\contracts
npx hardhat test test\Halo2VerifierGate.js
~~~

Kỳ vọng **4 passing**:

| Ca | Kỳ vọng |
|---|---|
| calldata thật | chấp nhận (`status 1`) |
| đổi 1 byte `nullifier` | **từ chối** |
| đổi 1 byte `amount` | **từ chối** |
| đổi 1 byte trong phần proof | **từ chối** |

Nếu thấy `1 pending` thay vì 4 passing: fixture `experiments/results/quantitative/proofs_n1.json` đang lỗi thời,
test positive tự `skip` cả nhóm. Trỏ sang proof vừa sinh bằng biến môi trường:

~~~powershell
$env:ONC_PROOF_FIXTURE = "<đường dẫn tới proofs_n1.json vừa sinh>"
npx hardhat test test\Halo2VerifierGate.js
~~~

> ### ⚠️ Bẫy đo đạc — dùng sai oracle sẽ ra kết luận sai hoàn toàn
>
> `Halo2Verifier` từ chối bằng **`revert(0, 0)`** — revert **không kèm dữ liệu lỗi**. Khi đó
> `ethers.provider.call` bọc `try/catch` **không phản ánh được** revert một cách nhất quán: có ca
> nó trả về `"0x"` như thể thành công.
>
> | Oracle | Tin được? |
> |---|---|
> | `ethers.provider.call` + `try/catch` | ❌ **không** |
> | `sendTransaction` rồi đọc `receipt.status` | ✅ **dùng cái này** |
> | `estimateGas` thành công/thất bại | ✅ dùng kiểm chéo |
>
> Lần đo đầu tiên dùng `provider.call` đã kết luận nhầm rằng verifier chấp nhận mọi public input.
> Dấu hiệu nhận ra thước đo hỏng: **calldata rỗng cũng "được chấp nhận"**. Chuỗi rỗng không thể là
> proof hợp lệ.
>
> `Halo2VerifierGate.js` dùng `receipt.status`. **Đừng đổi sang `provider.call`.**

> ### Vì sao `contracts/test/ShieldedPool.js` không thay thế được test này
>
> File đó deploy **`MockHalo2Verifier`** — contract luôn chấp nhận proof. Nên `npm test` vẫn xanh
> kể cả khi `Halo2Verifier` thật hỏng hoặc lỗi thời. Hai file phục vụ hai mục đích khác nhau, giữ
> cả hai.

## 14. Negative cases

- Finance trước eligibility: fail.
- Tạo pool khi chưa có sinh viên được duyệt cả hai bước: fail.
- Issue trước register wallet/public key hoặc vượt balance: fail.
- Tạo request trước approve root: không có scholarship `ROOT_APPROVED`.
- **Note bị sửa** *(đổi 2026-08-10 — xem khối bên dưới)*: prover **vẫn tạo proof**, `Halo2Verifier`
  từ chối → `Proof rejected by Halo2Verifier: root does not match currentRoot on-chain`.
- **Note bị sửa, nhưng kẻ gian bỏ qua backend** tự gửi giao dịch: lúc này **không ai thay 128 byte *(96 trước A25)*
  đầu calldata** nên calldata tự nhất quán và `Halo2Verifier` **sẽ chấp nhận** — cổng chặn là
  `require(validRoot[root])` → `"root not in history"` *(require **bước 4**, trước `staticcall` ở
  **bước 7**)*. Xem [VERIFY_MECHANISM.md mục 5b](../VERIFY_MECHANISM.md#5b-bốn-ví-dụ-cụ-thể--mỗi-repo-một-ca-đúng-một-ca-sai).
- Caller khác University gọi updateRoot/withdraw: `not school`.
- Calldata/root/nullifier/amount không khớp: contract revert.
- Approve cùng request lần hai: contract revert vì nullifier đã dùng.

> ### 🔄 Note bị sửa — hành vi ĐÃ ĐỔI (2026-08-10)
>
> **Trước:** `flow_inputs.rs` `panic` ngay, **không sinh proof**.
> **Nay:** prover chỉ **cảnh báo**, proof **vẫn được tạo**, và **`Halo2Verifier` là nơi từ chối**.
>
> Lý do: guard trong prover chạy ở **phía người dùng** nên không phải ranh giới tin cậy. Đúng mô
> hình ZK thì prover là bên không được tin, verifier mới quyết định. Đối xứng với repo off-chain.
>
> **Ba thay đổi:**
>
> | # | File | Sửa |
> |---|---|---|
> | 1 | `circuits/src/circuit.rs` | thêm `native_merkle_root(leaf, witness)` |
> | 2 | `prover/src/flow_inputs.rs` | 2 guard nghiệp vụ → cảnh báo · truyền `witness_path_root` thay `expected_root` vào `ScholarshipCircuit::new` |
> | 3 | `backend/.../createWithdrawalRequestService.ts` | **thay 128 byte đầu calldata** *(96 trước A25)* bằng `currentRoot` · `nullifier` backend tính · `amountWei` Finance duyệt · ví đã đăng ký, **trước** khi gửi lên hợp đồng *(từ 25/08 là `verifyAndRecord`)* |
>
> **`vk` KHÔNG đổi** — prover in `Halo2Verifier.sol was NOT regenerated`. Không export lại, không
> deploy lại, không sinh lại fixture.
>
> **Output bạn sẽ thấy khi note bị sửa:**
>
> ```
> CANH BAO: commitment tai merkle_index khong khop note da giai ma.
>           Proof van duoc tao; viec tu choi thuoc ve lop on-chain.
> CANH BAO: root dung tu note khong khop currentRoot tren smart contract.
>           Proof van duoc tao; viec tu choi thuoc ve lop on-chain.
>
> Local Merkle root        = 0x...
> Root from smart contract = 0x...
> Root from witness path   = 0x<KHÁC hai dòng trên>
>
> End:     Create EVM proof ...          <- proof VẪN được tạo
>
> Error: Proof rejected by Halo2Verifier: root does not match currentRoot on-chain
> ```
>
> **Bốn điều đối chiếu:**
>
> 1. **CÓ** dòng `Create EVM proof` — proof được tạo thật *(trước đây không có)*.
> 2. Hai dòng `CANH BAO` xuất hiện.
> 3. `Root from witness path` **khác** `Root from smart contract`.
> 4. Lỗi cuối do **`Halo2Verifier`** từ chối, không phải panic từ `flow_inputs`.
>
> **128 byte đầu calldata là `[root | nullifier | amount | recipient]`** *(A25; trước 12/09 là 96 byte, ba word)*. Gửi nguyên calldata prover sinh ra thì
> verifier chỉ tự so với chính nó — luôn khớp. Backend thay ba số đó bằng nguồn độc lập nên verifier
> mới thành cổng chặn thật.
>
> Ba dòng so chuỗi trong JS vẫn còn nhưng nằm **sau** lời gọi hợp đồng — chúng **không quyết định gì**,
> chỉ chỉ ra số nào lệch để thông điệp lỗi rõ nghĩa.
>
> ⚠️ **Thư viện:** `web3` v4 `eth.call` **throw** đúng khi verifier `revert(0,0)` — đã đo. Nhưng
> `ethers` v5 `provider.call` thì **không**; test viết bằng ethers phải dùng `sendTransaction` +
> `receipt.status`.
>
> Chi tiết đầy đủ: `../CONSTRAINT_FLOW.md` mục 7b · `../VERIFY_MECHANISM.md`.

## 15. Dữ liệu lưu và không lưu

Năm collection `onchain_*` lưu approval, wallet/public key, pool/verifier
address, chain ID, root history, funding, CID, commitment, expected nullifier,
Merkle index, proof/calldata, request status và transaction hash.

Không lưu student note plaintext, `rho`, student encryption private key hoặc
Merkle witness riêng. Witness được dựng lại từ ordered commitments lúc tạo proof.

## 16. Tên file đồng bộ và danh sách thay đổi

Các service nghiệp vụ được đặt cùng tên với flow advanced:

- `createUniversityService.ts`, `createStudentProfileService.ts`;
- `approveEligibilityService.ts`, `approveFinanceService.ts`;
- `createScholarshipPoolService.ts`, `deployScholarshipPoolService.ts`,
  `fundScholarshipPoolService.ts`, `getScholarshipPoolBalanceService.ts`;
- `registerStudentWalletService.ts`, `issueScholarshipService.ts`;
- `approveRootService.ts`, `createWithdrawalRequestService.ts`,
  `reviewWithdrawalRequestService.ts`;
- `clients/ipfs/noteEncryption.ts` *(trước là `client/decryptStudentNoteClient.ts`)* và
  `generateStudentFile.ts`.

`config/database.ts` và 5 file trong `backend/src/models` giữ cùng ranh giới
backend với advanced. Các phần riêng on-chain là `clients/blockchain/blockchainClient.ts` *(trước là
`blockchainService.ts`)* và `fullFlowService.ts`: một file bọc Web3/artifact, file còn lại
orchestration test.

Tạo mới:

- `README.md`, `FULL_FLOW_TEST.md`;
- `backend/src/clients/ipfs/noteEncryption.ts`;
- các service nghiệp vụ còn thiếu trong nhóm trên (trừ
  `generateStudentFile.ts`/`approveRootService.ts` vốn đã tồn tại),
  `blockchainService.ts` và `fullFlowService.ts`;
- `backend/src/config/database.ts`, `backend/src/models/*.ts`,
  `backend/src/scripts/testDatabaseConnection.ts`,
  `backend/src/scripts/resetDatabase.ts`, `backend/src/utils/serviceOutput.ts`
  và `backend/.env.example`;
- `prover/src/flow_inputs.rs`;
- `contracts/contracts/MockHalo2Verifier.sol` và
  `contracts/test/ShieldedPool.js`.

Sửa:

- `backend/src/services/generateStudentFile.ts`,
  `approveRootService.ts`, `uploadToIpfs.ts` và `getStudentFromIpfs.ts`;
- `contracts/contracts/ShieldedPool.sol`;
- `prover/src/main.rs`, `generate_proof.rs`, `lib.rs`;
- các Cargo manifest/lock, npm package scripts và `.gitignore` cần cho build,
  test và MongoDB dependency.

Xóa test mẫu `contracts/test/Lock.js` vì test đó dành cho contract `Lock`
không thuộc scholarship flow; thay bằng test `ShieldedPool.js`.

## 17. Thay đổi sau khi port (cập nhật gần nhất)

### Đợt 2026-08-10 — kiểm chứng verifier

**Không đổi dòng code nghiệp vụ nào trong repo này.** Repo on-chain đã đúng kiến trúc: `prove`
không tự verify, bên xác thực là `Halo2Verifier.sol` — một contract độc lập, không do prover sinh
ra. Repo off-chain vừa được sửa để **giống kiến trúc này**.

| Thêm gì | Ở đâu |
|---|---|
| Test negative cho verifier thật (4 ca) | `contracts/test/Halo2VerifierGate.js` — xem mục **13c** |
| ~~Cảnh báo fixture lỗi thời + `benchmarkGas.ts` chưa chạy được~~ → **cả hai đã hết hiệu lực 2026-08-16**, mục 13b nay ghi kết quả thật | mục **13b** |
| Cảnh báo `bench-from-dataset` phải chạy từ `prover/` | mục **13b** |

**Kết quả đo:** `Halo2Verifier` ràng buộc đúng **cả** ba public input **lẫn** phần proof — sửa 1
byte ở bất kỳ đâu trong calldata đều bị từ chối. Chi tiết và bảng đo: `../CONSTRAINT_FLOW.md` mục 7.

### Đợt port

Bốn thay đổi ảnh hưởng trực tiếp tới cách chạy tài liệu này. Lý do đầy đủ ở `../DECISIONS.md`.

| Mục | Thay đổi | Ảnh hưởng tới flow |
|---|---|---|
| **A1** | `MERKLE_DEPTH` 3 → 7, `MAX_LEAVES` 8 → 128 (`flow_inputs.rs`, `issueScholarshipService.ts`) | Pool nhận tối đa 128 sinh viên. **Bắt buộc export lại verifier + deploy pool mới** — xem mục 2b. ⚠️ *Đây là hồ sơ của A1 (giữ nguyên văn). Giá trị **đang chạy** không còn là 7/128 mà là **9/512** từ 2026-08-30 — xem mục 2b và `code/STATUS.md`.* |
| **A1** | `prover/src/export_verifier.rs` — sửa lỗi **không ghi file** | `export-verifier` trước đây build xong `sol_code` rồi vứt đi (`fs::write` bị comment, `PathBuf` không dùng), in `Verifier.sol generated!` nhưng không tạo file. Giờ ghi thật |
| **A5** | `reviewWithdrawalRequestService.ts` bỏ điều kiện chặn theo `pool.currentRoot` từ MongoDB | Root chỉ quyết định bằng dữ liệu on-chain — xem mục 11 |
| **C3** | Gỡ `express` + `cors` khỏi `backend/package.json` | Không có gì để chạy như server; backend vẫn là các tiến trình CLI một-lần. Script `start`/`dev` nay trỏ tới `clients/blockchain/shieldedPoolClient.ts` — vẫn **không phải** HTTP server, chỉ là tàn dư |

**Dữ liệu cũ không dùng lại được sau A1.** Root dựng bằng depth 7 khác root đã ghi on-chain bằng
depth 3, nên `createWithdrawalRequestService` sẽ báo
`Proof rejected by Halo2Verifier: root does not match currentRoot on-chain`. Phải
`npm run flow:reset` và deploy pool mới.

*(Trước 2026-08-10 thông điệp là `Merkle root rebuilt from commitments does not match currentRoot`
— prover panic. Nay prover chỉ cảnh báo và `Halo2Verifier` là nơi từ chối; xem mục 14.)*
