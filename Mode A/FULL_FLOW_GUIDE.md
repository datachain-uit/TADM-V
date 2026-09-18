# FULL_FLOW_GUIDE.md — Chạy tay toàn bộ luồng off-chain

Hướng dẫn chạy tay end-to-end cho **`zk-circuits-halo2-advanced`** (cơ chế off-chain verification).
Mọi lệnh đều copy-paste được, ghi rõ thư mục đang đứng và kỳ vọng kết quả.

Tài liệu này **chỉ mô tả những gì thực sự có trong repo**. Chỗ nào repo không có cách chạy rõ ràng
thì ghi thẳng **KHÔNG XÁC ĐỊNH ĐƯỢC** thay vì đoán lệnh.

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

## Quy ước

- Shell: **PowerShell** trên Windows.
- Đường dẫn gốc repo trong tài liệu này:
  ```
  C:\Users\VivoBook\research-project\code\zk-circuits-halo2-advanced
  ```
- Ký hiệu `$VAR` là biến PowerShell bạn tự gán trong cùng một cửa sổ terminal. **Đừng đóng
  terminal giữa chừng**, sẽ mất hết biến.
- Đa số lệnh chạy trong `backend/`. Bước build Rust chạy ở gốc repo.

> # THỰC NGHIỆM ĐỊNH TÍNH — cách chạy đầy đủ

Chạy **độc lập** với luồng chạy tay bên dưới. Kết quả chính thức: `reports/qualitative_offchain.md`

### Bước 1 — Ba dịch vụ nền phải sẵn sàng

Ganache `127.0.0.1:8545` · IPFS API `127.0.0.1:5001` · MongoDB. Runner **không** tự khởi động chúng.

### Bước 2 — Tạo config (một lần)

```powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-circuits-halo2-advanced\backend
Copy-Item experiment.config.example.json experiment.config.json
notepad experiment.config.json
```

Điền địa chỉ từ Ganache: `university.walletAddress` = account[0] ·
`student.walletAddress` = account[2].

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
$env:MONGODB_URI = $uri -replace '/[^/?]*(\?|$)', '/scholarship_zkp_qualitative$1'

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
| `npm run withdrawal:review` | Phòng KH-TC duyệt và giải ngân — **cần `staffId` role `FINANCE`** | ✅ | ✅ |
| `npm run experiment:qualitative` | **thực nghiệm định tính** (outline 2.1.3 — 5 khoá) | ✅ | ✅ **(mới 2026-08-14)** |

Lệnh chỉ có ở một bên, vì cơ chế hai repo khác nhau:

| Lệnh | Chỉ ở | Việc |
|---|---|---|

| `npm run experiment:quantitative` | **ADV** | thực nghiệm định lượng một lượt — proof time · verify time · gas rút · gas deploy *(mới 2026-08-16)*. Dãy `n` nay là `1·10·30·60·100·500` |
| `npm run experiment:lap20` | **cả hai** | 🆕 **LAP20 · 14/09/2026** — lặp **20 lượt độc lập, 3 warm-up mỗi lượt**, báo `mean ± SD`. `THI_NGHIEM=theo_n` *(d = 9, n = 1…500)* hoặc `THI_NGHIEM=theo_d` *(d = 1…8, lấp đầy cây n = 2^d)*. Lượt có `xong.json` bị bỏ qua ⇒ **dừng giữa chừng rồi chạy tiếp được** |
| `npm run experiment:lap20:tonghop` | **cả hai** | 🆕 tổng hợp `mean ± SD` → `tong_hop_*.csv`, `bang_bai_bao_*.csv`. Chạy tệp `summarizeLap20.ts` *(tên cũ `tongHopLap20.ts`, đổi 16/09)*. Không đụng Ganache/prover, chạy lại bao nhiêu lần cũng được |
| `npm run experiment:proofs` · `:gas` · `:artifacts` | **ONC** | thực nghiệm định lượng (gas). ⛔ `experiment:prepare` **đang hỏng và không được chạy** — sinh lại dataset sẽ làm lệch khỏi ADV |
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

## ⚠️ Bốn dịch vụ nền, không phải ba

Đề bài liệt kê MongoDB + IPFS + backend server. Thực tế luồng off-chain của repo này **bắt buộc có
thêm Ethereum JSON-RPC** (Ganache hoặc Hardhat node): pool được deploy thật, `updateRoot` và
`withdrawOffChain` đều là giao dịch on-chain. Không có RPC thì dừng ở bước 6.

Ngược lại, **backend server thì không tồn tại** — xem mục A4.

---

# PHẦN A — Khởi động hạ tầng

## A0. Tạo `backend/.env` (làm trước tiên)

```powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-circuits-halo2-advanced\backend
Copy-Item .env.example .env
```

Nội dung tối thiểu (theo `.env.example` và `src/config/environment.ts`):

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/scholarship_zkp
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
IPFS_HOST=127.0.0.1
IPFS_PORT=5001
IPFS_PROTOCOL=http
```

Giá trị mặc định trong code nếu thiếu biến: RPC `http://127.0.0.1:8545`, IPFS
`127.0.0.1:5001/http`. Riêng `MONGODB_URI` **không có mặc định** — thiếu là lỗi
`MONGODB_URI is missing. Check backend/.env`.

Cài dependency (một lần):

```powershell
npm install
```

## A1. MongoDB

### Khởi động

**KHÔNG XÁC ĐỊNH ĐƯỢC — cần bạn bổ sung.** Repo **không có `docker-compose.yml`** (đã kiểm tra
toàn bộ `code/`, không có file nào), cũng không có script khởi động MongoDB. Bạn tự chạy MongoDB
theo cách đã cài trên máy — MongoDB Community chạy như Windows Service, `mongod` chạy tay, Docker,
hoặc MongoDB Atlas. Code chỉ cần **một MongoDB nào đó reachable qua `MONGODB_URI`**.

Nếu dùng **Atlas** thì đổi `MONGODB_URI` trong `.env` thành connection string của Atlas; script
kiểm tra bên dưới vốn được viết cho Atlas nên vẫn chạy đúng. Hai điều cần nhớ khi dùng Atlas:

- **Mọi công cụ xem/xóa dữ liệu cũng phải dùng đúng URI Atlas đó**, không phải `127.0.0.1:27017`.
  Đây là lỗi hay gặp nhất ở bước B10 — xem lại mục đó.
- **Không commit `.env`** (đã có trong `.gitignore`) và không dán connection string kèm mật khẩu vào
  chat/issue/log. Nếu lỡ lộ, đổi mật khẩu database user trong Atlas → *Database Access → Edit →
  Edit Password* rồi cập nhật lại `.env`.

### Kiểm tra đã kết nối được

```powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-circuits-halo2-advanced\backend
npm run --silent db:test
```

**Kỳ vọng THÀNH CÔNG** — stdout chứa đúng các dòng:

```
========================
MONGODB ATLAS CONNECTION TEST
========================
PING RESULT: 1
TEST DOCUMENT:
{ ... "name": "atlas-backend-test", "message": "MongoDB Atlas connection works", ... }

========================
MONGODB ATLAS TEST SUCCESS
========================
```

Dấu hiệu quyết định: **`PING RESULT: 1`** và dòng **`MONGODB ATLAS TEST SUCCESS`**.

**Kỳ vọng THẤT BẠI:** in `MONGODB ATLAS TEST FAILED` kèm exception, exit code 1. Lỗi hay gặp là
`MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017` → MongoDB chưa chạy.

Lưu ý: script này **ghi thật** một document vào collection `connection_tests`. Vô hại, nhưng đừng
ngạc nhiên khi thấy collection lạ.

## A2. IPFS

### Khởi động

Mở **terminal riêng** và giữ nó chạy:

```powershell
ipfs daemon
```

### Kiểm tra đã chạy

Trong log của `ipfs daemon`, tìm dòng:

```
API server listening on /ip4/127.0.0.1/tcp/5001
```

Cổng `5001` phải khớp `IPFS_PORT` trong `.env`.

Kiểm tra chủ động (**lệnh này không phải của repo**, là API chuẩn của IPFS Kubo):

```powershell
curl.exe -s -X POST http://127.0.0.1:5001/api/v0/version
```

Kỳ vọng: JSON có `{"Version":"0.x.y",...}`. Không phản hồi → daemon chưa chạy.

Repo **không có** script health-check IPFS riêng.

## A3. Ethereum JSON-RPC (Ganache hoặc Hardhat)

Mở **terminal riêng** và giữ chạy. Chọn một trong hai:

```powershell
# Cách 1 — Ganache
ganache --wallet.totalAccounts 10 --chain.chainId 1337 --server.port 8545
```

```powershell
# Cách 2 — Hardhat node (từ thư mục contracts của repo này)
Set-Location C:\Users\VivoBook\research-project\code\zk-circuits-halo2-advanced\contracts
npx hardhat node
```

**Kỳ vọng:** Ganache in `RPC Listening on 127.0.0.1:8545`; Hardhat in danh sách 20 account kèm
private key và `Started HTTP and WebSocket JSON-RPC server at http://127.0.0.1:8545/`.

**Ghi lại 3 địa chỉ** từ output để dùng suốt hướng dẫn:

- account[0] → University
- account[1] → Sponsor
- account[2] → ví nhận học bổng của sinh viên

Cả hai node đều **unlock sẵn account**, nên backend không cần private key Ethereum. Nếu dùng RPC
không unlock, phải set `$env:UNIVERSITY_PRIVATE_KEY` trước các lệnh cần University ký.

Compile contract (một lần):

```powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-circuits-halo2-advanced\contracts
npm install
npm run compile
```

Kỳ vọng: `Compiled 1 Solidity file successfully`. Backend đọc ABI/bytecode từ
`contracts/artifacts/`, nên bước này bắt buộc trước khi deploy pool.

> Hardhat 2 cảnh báo Node 22 không được hỗ trợ. Cảnh báo này vô hại nhưng repo kỳ vọng **Node 20 LTS**.

## A4. Backend server

**KHÔNG CÓ — và đây không phải thiếu sót cần bổ sung, mà là kiến trúc của repo.**

Backend của `zk-circuits-halo2-advanced` **không phải server**. Nó là tập hợp **tiến trình CLI
một-lần**: mỗi lệnh `npm run ...` mở kết nối MongoDB, làm một việc, đóng kết nối rồi thoát. Các
bước chia sẻ trạng thái với nhau **chỉ qua MongoDB**.

Hệ quả cụ thể:

- Không có lệnh `start`/`dev` nào trong `backend/package.json` — toàn bộ script đều là
  `ts-node src/cli/...`.
- **Không có port nào để mở.**
- **Không có health-check endpoint.** Thứ gần nhất là `testDatabaseConnection.ts` ở mục A1.
- Không có REST/GraphQL API. Mọi thao tác ở PHẦN B đều là lệnh CLI, không phải HTTP call.

---

# PHẦN B — Luồng hợp lệ (happy path)

## B4. Key generation (params / verifying key)

Chạy **một lần** sau khi build prover (B5), và chạy lại mỗi khi đổi `K` hoặc `MERKLE_DEPTH`:

```powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-circuits-halo2-advanced\backend
..\target\release\prover.exe setup
```

**Kỳ vọng** — một dòng JSON trên stdout:

```json
{"k":10,"merkle_depth":9,"params_file":"../shared/params.bin","params_bytes":65604,"setup_ms":448.49}
```

và file `shared/params.bin` (~65 KB) được tạo:

```powershell
Get-Item ..\shared\params.bin
```

> **Chạy `setup` từ `backend/`**, vì đường dẫn `../shared/params.bin` là tương đối so với thư mục
> đang đứng — giống cách backend spawn prover.

### Hai điều cần hiểu đúng về key ở đây

**`params` được lưu thật.** `prove` và `verify` đều nạp lại từ `shared/params.bin`. Nếu file chưa
có, chúng tự sinh rồi ghi lại — nên bỏ qua bước `setup` vẫn chạy được, chỉ là lần đầu chậm hơn.

**`vk` KHÔNG được lưu thành file** — `halo2_proofs 0.3.2` không có `VerifyingKey::write`/`read` và
crate không có feature serde. Thay vào đó `vk` được **tái sinh xác định** từ một circuit rỗng
witness mỗi lần verify. `keygen_vk` chỉ phụ thuộc *shape* của circuit (số cột cố định, selector,
permutation) chứ không phụ thuộc giá trị witness, nên vk dựng lại luôn trùng vk lúc tạo proof —
miễn là `K` và `MERKLE_DEPTH` không đổi. Chi phí này được tính vào `setup_ms`, **không** vào
`verify_ms`.

**`shared/vk.txt` không phải key.** Nó là `format!("{:?}", vk)` — bản dump Debug để đọc bằng mắt,
không nạp lại được. Đừng dùng làm đầu vào cho bước nào.

## B5. Build circuit + prover

```powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-circuits-halo2-advanced
cargo build --release -p prover
```

**Kỳ vọng:** kết thúc bằng `Finished \`release\` profile [optimized] target(s) in ...`, và file
`target\release\prover.exe` tồn tại. Lần đầu build mất vài phút.

Cảnh báo `warning: function ... is never used` (ví dụ `eth_address_to_fp`) là **có sẵn từ trước**,
không phải lỗi.

Backend spawn đúng binary này theo đường dẫn tương đối `../../../../target/release/prover.exe`
(`src/clients/prover/halo2ProverClient.ts`), nên **phải build trước mọi bước nghiệp vụ**, và phải
build lại mỗi khi sửa code Rust.

Kiểm tra nhanh circuit chạy được (tùy chọn, chạy proof thật trong thư mục tạm):

```powershell
cargo test --workspace --locked
```

Kỳ vọng: `test creates_and_verifies_a_real_proof_from_fixture ... ok` và `1 passed; 0 failed`.

> **Thứ tự đúng là B5 rồi mới B4** (build trước, sinh params sau) — mục B4 đánh số theo đề bài chứ
> không theo thứ tự chạy. Xem bảng lệnh ở Phụ lục.

Danh sách mode của prover sau khi build:

```
setup · check-k · rho · commitment · nullifier · root · prove · prove-batch · verify
```

| Mode | Thêm khi nào | Việc |
|---|---|---|
| `rho` | **A26 · 12/09/2026** | lấy mẫu `rho` trong trường bằng rejection sampling trên `OsRng`. Node **không** tự sinh `rho` nữa, chỉ định dạng lại thành chuỗi thập phân |
| `check-k` | **LAP20 · 14/09/2026** | chạy `keygen_vk` trên mạch rỗng witness, thoát khác 0 khi `NotEnoughRowsAvailable` — đúng phép thử đã chọn `K = 9`. Dùng để dò `K` nhỏ nhất cho từng `MERKLE_DEPTH` |
| `prove-batch` | **17/09/2026** | sinh **n chứng minh trong MỘT tiến trình**: nạp params + keygen **một lần**, rồi lặp witness → `create_proof` → verify ngay tại chỗ. Vào: **một MẢNG JSON** sinh viên qua stdin. Ra: một đối tượng JSON `{setup_ms, k, merkle_depth, proofs[]}`. Mode `prove` và `verify` **không đổi một dòng nào** |

### Hai biến môi trường đọc lúc chạy *(LAP20)*

| Biến | Không đặt | Đặt sai |
|---|---|---|
| `MERKLE_DEPTH` | **9** — y hệt trước | **panic**, không lặng lẽ quay về mặc định |
| `HALO2_K` | **9** — y hệt trước | panic. `K ≠ 9` ghi params ra `target/params_k<K>.bin`, **không bao giờ** đụng `shared/params.bin` |

> 🔴 **`prove-batch` KHÔNG phải luồng thật.** Luồng rút tiền thật vẫn là **một tiến trình `prove` cho
> mỗi lượt rút**, cộng **một tiến trình `verify`** riêng — nên khoá được sinh lại ở mỗi lượt. Mode lô
> chỉ tồn tại để đo ở **cùng điều kiện** với nhánh on-chain *(`bench-from-dataset`)*, giúp hai cột
> `setup_ms` đặt cạnh nhau được. Xem `code/PLAN_ALIGN_MEASUREMENT_CONDITIONS.md`.

## B6. Tạo 1 note hợp lệ qua đúng luồng thật

Note **không** được tạo bằng lệnh riêng lẻ. Nó là kết quả của chuỗi nghiệp vụ bên dưới, và
`scholarship:issue` sẽ từ chối nếu thiếu bất kỳ điều kiện nào phía trước.

Tất cả lệnh trong mục này chạy ở:

```powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-circuits-halo2-advanced\backend
```

### B6.1 — Tạo University

```powershell
$UNIVERSITY_ADDRESS = "0x..."   # account[0] từ Ganache/Hardhat
npm run university:create -- "Demo University" $UNIVERSITY_ADDRESS
```

**Kỳ vọng:** một object JSON trên stdout (đây là một trong số ít CLI in JSON thật):

```json
{
  "universityId": "...",
  "name": "Demo University",
  "walletAddress": "0x...",
  "status": "ACTIVE"
}
```

```powershell
$UNIVERSITY_ID = "..."   # dán universityId vừa in ra
```

### B6.2 — Hồ sơ sinh viên + hai bước phê duyệt

> 🔑 **Không cần tạo nhân sự thủ công.** `university:create` tự dựng sẵn **`CTSV-01`**
> *(Phòng CTSV)* và **`KHTC-01`** *(Phòng KH-TC)* — đây là **giả định tin cậy lúc khởi tạo** (K9).
> `staff:create` chỉ dùng khi muốn thêm nhân sự **ngoài** hai tài khoản đó, và **bắt buộc** có một
> nhân sự hiện hữu bảo lãnh:
> `npm run staff:create -- <universityId> <actingStaffId> <staffId> <STUDENT_AFFAIRS|FINANCE>`

```powershell
$STUDENT_ID = 1001
$STUDENT_EMAIL = "student@example.edu"
$STUDENT_AMOUNT_WEI = "100000000000000000"   # 0.1 ETH

npm run student:create -- $UNIVERSITY_ID CTSV-01 $STUDENT_ID $STUDENT_EMAIL
npm run student:eligibility -- $UNIVERSITY_ID CTSV-01 $STUDENT_ID approve
npm run student:finance -- $UNIVERSITY_ID KHTC-01 $STUDENT_ID $STUDENT_AMOUNT_WEI
```

**Kỳ vọng:** log lần lượt cho thấy `eligibilityStatus: ELIGIBLE`, rồi `financeStatus: APPROVED` với
`approved amount: 100000000000000000 wei`.

**Kiểm tra thứ tự bắt buộc (tùy chọn):** chạy `student:finance` **trước** `student:eligibility` phải
báo lỗi. Đó là hành vi đúng, không phải bug.

### B6.3 — Tạo, deploy và nạp tiền pool

```powershell
npm run pool:create -- $UNIVERSITY_ID KHTC-01
$POOL_ID = "..."   # dán poolId từ output JSON

npm run pool:deploy -- $POOL_ID KHTC-01 1000000000000000000
```

**Kỳ vọng** (JSON trên stdout):

```json
{
  "poolId": "...",
  "contractAddress": "0x...",
  "universityAddress": "0x...",
  "chainId": "...",
  "deploymentTransactionHash": "0x...",
  "deploymentGasUsed": "816796",
  "balanceWei": "1000000000000000000",
  "status": "DEPLOYED"
}
```

`deploymentGasUsed` là **số liệu gas §2.1.2 (cột off-chain)** — được lưu luôn vào
`ScholarshipPool.deploymentGasUsed`. Lệnh `pool:fund` cũng trả thêm `gasUsed` tương tự (~22,245).

Nạp thêm từ sponsor và đọc số dư:

```powershell
$SPONSOR_ADDRESS = "0x..."   # account[1]
npm run pool:fund -- $POOL_ID KHTC-01 500000000000000000 $SPONSOR_ADDRESS
npm run pool:balance -- $POOL_ID
```

**Kỳ vọng:** `balanceWei` = `1500000000000000000` (1 ETH deploy + 0.5 ETH sponsor).

### B6.4 — Khóa mã hóa note và đăng ký ví

Khóa này là **khóa ECDH secp256k1 riêng**, độc lập với private key ví Ethereum. Bất kỳ hex 32 byte
hợp lệ nào cũng dùng được:

```powershell
$STUDENT_PRIVATE_KEY = "0x1c0de00000000000000000000000000000000000000000000000000000000002"
npm run --silent student:pubkey -- $STUDENT_PRIVATE_KEY
```

**Kỳ vọng:** in `STUDENT PUBLIC KEY: 0x04...` — chuỗi uncompressed 65 byte, luôn bắt đầu `0x04`.

```powershell
$STUDENT_PUBLIC_KEY = "0x04..."      # dán từ output
$STUDENT_WALLET_ADDRESS = "0x..."    # account[2]
npm run student:wallet -- $UNIVERSITY_ID CTSV-01 $POOL_ID $STUDENT_EMAIL $STUDENT_WALLET_ADDRESS $STUDENT_PUBLIC_KEY
```

### B6.5 — Issue note (đây mới là bước tạo note)

IPFS daemon phải đang chạy.

```powershell
npm run scholarship:issue -- $UNIVERSITY_ID CTSV-01 $STUDENT_ID
```

Bên trong, theo thứ tự (`src/services/issueScholarshipService.ts`): xác định `merkleIndex` kế tiếp
trong pool → tạo note `{student_id, amount, rho}` với `rho` random 32 byte → gọi prover mode
`commitment` tính Poseidon commitment → mã hóa note bằng ECDH + HKDF-SHA256 + AES-256-GCM → upload
ciphertext lên IPFS → lưu CID/commitment/merkleIndex vào MongoDB.

**Kỳ vọng — các dòng quyết định:**

```
========================
SCHOLARSHIP NOTE ISSUED
========================
studentId: 1001
approved amount: 100000000000000000 wei
CID: Qm...            (hoặc bafy...)
commitment: 0x<64 hex>
merkleIndex: 0
status: NOTE_CREATED
Nullifier was not stored in MongoDB
Merkle root was not stored in MongoDB
```

```powershell
$CID = "Qm..."   # dán CID
```

Kiểm chứng IPFS chỉ chứa ciphertext (tùy chọn, lệnh IPFS chuẩn, không phải script repo):

```powershell
ipfs cat $CID
```

**Kỳ vọng:** JSON gồm `version`, `ephemeralPublicKey`, `iv`, `authTag`, `ciphertext` — **không có**
`student_id`, `amount` hay `rho` ở dạng rõ.

### B6.6 — University duyệt Merkle root lên chain

```powershell
npm run root:approve -- $POOL_ID CTSV-01
```

**Kỳ vọng:**

```
Candidate root computed by Rust: 0x<64 hex>
currentRoot before update: 0x0000...0000
Root update tx: 0x...
Root update gasUsed: 69776                <- số liệu gas §2.1.2
currentRoot after update: 0x<đúng candidate root>
validRoot[candidateRoot]: true
Newly approved commitments: 1
========================
ROOT APPROVAL SUCCESS
========================
```

Sau bước này `StudentScholarship.status` chuyển `NOTE_CREATED` → `ROOT_APPROVED`. **Chưa có proof
nào được tạo** — log nói rõ `PROOF HAS NOT BEEN CREATED YET`.

> ### ⚠️ Issue thêm note thì **phải duyệt lại root**
>
> Root là hàm của **toàn bộ** tập commitment trong pool. Mỗi lần issue thêm một sinh viên, cây đổi →
> root đổi → `currentRoot` trên chain **lỗi thời ngay lập tức**.
>
> Proof của sinh viên cũ (sinh trước lần issue mới) mang root cũ, nên ở B8/B9 sẽ bị mode `verify`
> từ chối — mà thông điệp trông **giống hệt lỗi mật mã**, rất dễ đi lạc hướng chẩn đoán.
>
> Cách xử lý: chạy lại bước duyệt root ở trên, rồi **sinh lại proof** (proof cũ không dùng lại
> được). Thứ tự an toàn: **issue hết tất cả sinh viên → duyệt root một lần → mới sang B8/B9.**

## B7. Backend chuẩn bị private witnesses + public inputs

**Không có lệnh riêng cho bước này.** Việc chuẩn bị witness nằm *bên trong* lệnh ở B8/B9, không tách
rời được qua CLI.

Cụ thể `createWithdrawalRequestService.ts` làm, theo thứ tự: đọc `currentRoot` **từ smart contract**
(không phải từ MongoDB) → kiểm tra `validRoot(currentRoot)` → lấy toàn bộ commitment đã approve của
pool, sort theo `merkleIndex` và kiểm tra index liên tục → tính `expected_nullifier` độc lập bằng
prover mode `nullifier` → truyền `{student_id, amount, rho, commitments[], merkle_index,
expected_root, recipient}` sang prover mode `prove` *(`recipient` = ví đã đăng ký, A25)*. Rust dựng lại cây, lấy `siblings[]`/`directions[]` và so
root dựng lại với root on-chain.

> 🆕 **K10 — 03/09/2026: bước rút không dựng lại cây nữa.**
>
> `approveRootService` lưu cây vào collection `merkleNodes` ngay sau khi đổi root thành công, nên
> `createWithdrawalRequestService` chỉ **đọc `depth` nút** rồi truyền thẳng `siblings`/`directions`
> sang prover — `O(depth)` thay vì `O(n × depth)`. Kiểm bằng dòng stderr:
>
> ```
> MERKLE PATH: read 9 stored nodes
> ```
>
> Thấy `MERKLE PATH: not stored - rebuilding from N commitments` nghĩa là pool này được duyệt root
> **trước** K10. Đó không phải lỗi — hệ thống tự quay về đường cũ, kết quả y hệt, chỉ chậm hơn.
> Muốn dùng đường mới thì chạy lại bước duyệt root cho pool đó.
>
> Hai đường cho ra **cùng một proof** — `backend/src/tests/merklePath.test.ts` chạy prover thật và
> so `root`, `nullifier`, kích thước proof của cả hai.

Bước sinh viên giải mã note (chạy được độc lập để xem note):

```powershell
npm run --silent note:decrypt -- $CID $STUDENT_PRIVATE_KEY
```

**Kỳ vọng:** đúng **một dòng JSON** trên stdout:

```json
{"cid":"Qm...","note":{"student_id":1001,"amount":"100000000000000000","rho":"..."}}
```

CLI này cố tình chuyển mọi `console.log` sang stderr để stdout sạch cho pipe.

## B8 + B9. Sinh proof và verify off-chain

Một lệnh chạy cả hai, nhưng **verify giờ là một tiến trình prover riêng** (mode `verify`), tách hẳn
khỏi bước tạo proof:

```powershell
npm run --silent note:decrypt -- $CID $STUDENT_PRIVATE_KEY | npm run --silent withdrawal:create
```

Lệnh này spawn prover **ba lần**, theo thứ tự:

| # | Mode | Việc |
|---|---|---|
| 1 | `nullifier` | backend tự tính `expected_nullifier` từ `rho` |
| 2 | `prove` | tạo proof |
| 3 | `verify` | xác thực proof, trả `{verified, setup_ms, verify_ms}` |

Bất kỳ bước nào fail → CLI exit ≠ 0 → **không có WithdrawalRequest nào được tạo**.

> `prove` vẫn tự verify một lần bên trong (`verify_proof` + `SingleVerifier` ngay sau
> `create_proof`) — đó là hành vi có sẵn, giữ nguyên làm lưới an toàn. Hệ quả khi đọc số liệu:
> **thời gian sinh proof đã bao gồm sẵn ~7 ms verify.** Con số verification time dùng cho bài báo
> phải lấy từ `verify_ms` của mode `verify`, không phải suy ra từ thời gian chạy `prove`.

**Kỳ vọng PASS — dấu hiệu quyết định là ba khối này xuất hiện theo thứ tự:**

```
Witness commitment = 0x...
Common Merkle root = 0x...
Proof student index = 0
Local Merkle root       = 0x...
Root from smart contract = 0x...        <- hai dòng này phải BẰNG NHAU
Public root = 0x...
Public nullifier = 0x...
Public amount = 0x...

========================
CREATE PROOF COMPLETED
========================
proof bytes len = <số>

========================
OFF-CHAIN VERIFICATION OK               <- CỔNG CHẶN DUY NHẤT (mode verify)
========================
setup_ms  = 104.661
verify_ms = 7.084                       <- SỐ LIỆU CHO §2.1.1
OFF-CHAIN VERIFY PASSED - verify_ms: 7.0835

========================
WITHDRAWAL REQUEST CREATED
========================
requestId: <ObjectId>
amount: 100000000000000000 wei
recipient: 0x...
expectedRoot: 0x...
expectedNullifier: 0x...
status: PENDING_APPROVAL
No blockchain transfer has occurred
```

**Dòng phân định PASS/FAIL:**

> 🔄 **Đổi 2026-08-13:** `prove` **không còn verify gì cả**. Dòng `SELF-VERIFY SUCCESS` và trường
> `self_verified` đã bị gỡ — chúng dư thừa (mode `verify` bắt được mọi thứ chúng bắt được) và cộng
> ~7 ms vào proof generation time. Nếu bạn thấy hai thứ đó trong output thì `prover.exe` đang là bản
> cũ, phải `cargo build --release -p prover`.

- `OFF-CHAIN VERIFICATION OK` kèm `verify_ms` — **đây mới là cổng chặn**. Ba public input được nạp
  từ nguồn độc lập với prover: `root` đọc từ smart contract, `nullifier` do backend tự tính từ
  `rho`, `amount` là số Phòng KH-TC đã duyệt.

Dòng thứ hai bắt buộc phải xuất hiện thì request mới được tạo. Giải thích đầy đủ vì sao phải tách
hai lần verify: [VERIFY_MECHANISM.md](../VERIFY_MECHANISM.md).

> ### Nếu verify TỪ CHỐI — thông điệp bạn sẽ thấy
>
> Verify chạy **ngay sau khi sinh proof, trước mọi kiểm tra JS** — để thứ từ chối là ràng buộc mật
> mã, không phải một dòng `if` trong JavaScript.
>
> ```
> ========================
> OFF-CHAIN VERIFICATION FAILED
> ========================
> thread 'main' panicked at prover\src\generate_proof.rs:
> Proof was rejected by the native Halo2 verifier
>
> CREATE WITHDRAWAL REQUEST FAILED
> Error: Proof rejected by Halo2 verifier: root does not match currentRoot on-chain
> ```
>
> Dòng cuối do backend thêm vào. Verify kiểm **cả ba** public input bằng **một** phép kiểm nên chỉ
> trả đúng/sai — không tách được số nào sai. Backend bắt lỗi rồi chạy ba phép so để chỉ ra chỗ lệch:
>
> | Thông điệp | Nghĩa |
> |---|---|
> | `… root does not match currentRoot on-chain` | root trong proof ≠ root nhà trường đã duyệt |
> | `… nullifier does not match the value computed by backend` | nullifier trong proof ≠ nullifier backend tính từ `rho` |
> | `… amount does not match the Finance-approved amount` | số tiền trong proof ≠ số Phòng KH-TC duyệt |
>
> **Ba phép so đó không quyết định gì** — verify đã quyết rồi. Chúng chỉ giải thích.
>
> Request **không** được tạo trong mọi trường hợp trên.

```powershell
$REQUEST_ID = "..."   # dán requestId
```

**Chưa có ETH nào được chuyển ở bước này.**

## B10. Trạng thái MongoDB sau khi verify PASS

### Cách kết nối để xem dữ liệu

> ⚠️ **Dùng đúng `MONGODB_URI` đang có trong `backend/.env`.** Nếu bạn trỏ `MONGODB_URI` sang
> MongoDB Atlas thì mọi lệnh `mongosh "mongodb://127.0.0.1:27017/..."` đều **sai chỗ** — nó nối tới
> localhost (nơi không có gì chạy) chứ không phải cluster đang chứa dữ liệu. Backend ghi vào đúng
> URI trong `.env`, nên công cụ xem dữ liệu cũng phải dùng đúng URI đó.

Chọn một trong ba cách:

**Cách 1 — MongoDB Compass (GUI, dễ nhất).** Dán nguyên connection string trong `.env` vào ô
Connect. Không cần cài thêm gì.

**Cách 2 — `mongosh`.** Không đi kèm Node, phải cài riêng:

```powershell
winget install MongoDB.Shell
# hoặc: npm install -g mongosh
```

Kết nối bằng **đúng URI trong `.env`**:

```powershell
# Local
mongosh "mongodb://127.0.0.1:27017/scholarship_zkp"

# Atlas — thay bằng URI thật trong .env (giữ nguyên cả dấu ngoặc kép)
mongosh "mongodb+srv://<user>:<password>@<cluster>.mongodb.net/scholarship_zkp?retryWrites=true&w=majority"
```

```javascript
show collections
db.studentscholarships.find().pretty()
db.withdrawalrequests.find().pretty()
```

**Cách 3 — không cài gì thêm.** `mongoose` và `dotenv` đã có sẵn trong `backend/node_modules`, và
cách này tự đọc `MONGODB_URI` từ `.env` nên **không thể trỏ nhầm database**. Tạo file tạm
`backend/inspect.js`:

```javascript
require("dotenv").config({ path: "./.env" });
const mongoose = require("mongoose");

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;

    const names = (await db.listCollections().toArray()).map((c) => c.name);
    console.log("DATABASE:", db.databaseName);
    console.log("COLLECTIONS:", names);

    for (const name of ["studentscholarships", "withdrawalrequests"]) {
        if (!names.includes(name)) continue;
        console.log("\n===", name, "===");
        console.log(
            JSON.stringify(await db.collection(name).find({}).toArray(), null, 2)
        );
    }

    await mongoose.disconnect();
})();
```

```powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-circuits-halo2-advanced\backend
node inspect.js
```

Xóa `inspect.js` sau khi dùng xong — nó không phải file của repo.

> Tên collection là **mặc định của mongoose** (viết thường + số nhiều từ tên model:
> `University`, `UniversityStudent`, `ScholarshipPool`, `StudentScholarship`, `WithdrawalRequest`).
> Repo không đặt `collection:` tường minh trong schema, nên hãy xem danh sách collection thực tế
> trước thay vì tin tuyệt đối vào tài liệu này.

**Kỳ vọng — `studentscholarships`:**

| Field | Giá trị |
|---|---|
| `status` | `WITHDRAWAL_REQUESTED` *(đổi từ `ROOT_APPROVED`)* |
| `commitment` | `0x` + 64 hex |
| `merkleIndex` | `0` |
| `encryptedNoteCid` | CID đã dùng |
| `withdrawTxHash` | **chưa có** |

**Kỳ vọng — `withdrawalrequests`, document mới:**

| Field | Giá trị |
|---|---|
| `status` | `PENDING_APPROVAL` |
| `localVerificationPassed` | `true` ← **dấu hiệu verify off-chain đã PASS** |
| `verificationMs` | ~7 (ms) ← **số liệu §2.1.1** |
| `verificationSetupMs` | ~100 (ms) — nạp params + dựng vk, không tính vào verification time |
| `expectedRoot` | bằng `currentRoot` trên contract |
| `expectedNullifier` | `0x` + 64 hex |
| `amountWei` | `"100000000000000000"` |
| `proof` | chuỗi hex dài |
| `proofPreparedAt` | có timestamp |
| `transactionHash` | **chưa có** |
| `withdrawGasUsed` | **chưa có** (chỉ có sau B11) |

**Ba điều KHÔNG được thấy** (nếu thấy là lỗi nghiêm trọng về quyền riêng tư):

```javascript
db.studentscholarships.find({ $or: [ {rho: {$exists:true}}, {student_id: {$exists:true}},
                                     {siblings: {$exists:true}}, {directions: {$exists:true}} ] })
db.withdrawalrequests.find({ $or: [ {rho: {$exists:true}}, {siblings: {$exists:true}} ] })
```

Cả hai truy vấn phải trả **rỗng**.

### Trả lời trực tiếp câu hỏi "note đã được đánh dấu đã dùng chưa?"

**Chưa, và đó là đúng thiết kế.** Ở thời điểm verify PASS:

- nullifier **chưa** được đánh dấu đã dùng ở đâu cả;
- MongoDB **không bao giờ** lưu cờ "nullifier đã dùng" — trạng thái đó nằm ở
  `usedNullifier` **trên smart contract**, không phải trong DB;
- `expectedNullifier` trong `withdrawalrequests` chỉ là **public input gắn với proof**, không phải
  dấu hiệu đã tiêu.

Nullifier chỉ thực sự bị đánh dấu ở bước duyệt giải ngân bên dưới.

## B11. University duyệt và giải ngân (bắt buộc chạy trước PHẦN C)

```powershell
npm run withdrawal:review -- $REQUEST_ID KHTC-01 approve
```

**Kỳ vọng:**

```
OFF-CHAIN VERIFICATION OK
verify_ms = 7.0xx
re-verify before withdraw: PASSED verify_ms: 7.0xx    <- verify LẠI trước khi tiêu tiền

========================
UNIVERSITY APPROVED
EXECUTING WITHDRAWAL
========================
usedNullifier before: false
pool balance before: 1500000000000000000 wei
on-chain replay attempt: false
submitted transactionHash: 0x...

========================
WITHDRAWAL EXECUTED
========================
transactionHash: 0x...
amount: 100000000000000000 wei
withdraw gasUsed: 62520                     <- số liệu gas §2.1.2
usedNullifier after: true                   <- nullifier BÂY GIỜ mới bị đánh dấu
WithdrawalRequest.status: EXECUTED
StudentScholarship.status: WITHDRAWN
```

> Bước **re-verify** là mới: backend verify lại proof lấy từ MongoDB ngay trước khi gửi giao dịch,
> thay vì chỉ tin cờ `localVerificationPassed`. Nếu ai đó sửa `proof` trong DB, bước này chặn trước
> khi tiền được chuyển.

Kiểm tra lại MongoDB: `withdrawalrequests.status = EXECUTED` + có `transactionHash`;
`studentscholarships.status = WITHDRAWN` + có `withdrawTxHash`. Số dư ví sinh viên tăng 0.1 ETH.

---

# PHẦN C — Case lỗi / tấn công

> ## ⏱ Đọc trước: hai case này cần HAI trạng thái khác nhau
>
> Không chạy tuần tự C11 rồi C12 được. `createWithdrawalRequestService.ts` chặn ngay từ đầu nếu
> scholarship không ở đúng trạng thái `ROOT_APPROVED`, nên:
>
> | Case | Trạng thái scholarship cần có | Chạy ở thời điểm nào |
> |---|---|---|
> | **C12-a** (note giả) | `ROOT_APPROVED` | **giữa B6.6 và B8** — trước khi tạo request thật |
> | **C12-b** (khóa sai) | bất kỳ | bất kỳ lúc nào sau B6.5 |
> | **C11** (double-spend) | `WITHDRAWN` | **sau B11** |
>
> Máy trạng thái: `ROOT_APPROVED` → *(B8/B9)* → `WITHDRAWAL_REQUESTED` → *(B11)* → `WITHDRAWN`.
>
> **Thứ tự chạy đúng:** B6.6 → **C12-a** → **C12-b** → B8/B9 → B11 → **C11**.
>
> Nếu chạy C12-a sau B11, bạn sẽ nhận
> `Error: Scholarship status must be ROOT_APPROVED. Current status: WITHDRAWN` — đó là guard tầng
> ứng dụng bắn đúng, không phải bug, nhưng nó **không** kiểm chứng được điều C12-a định kiểm chứng.

## C11. Double-spend: rút lần hai với cùng nullifier

Chạy **đúng lệnh cũ, đúng `$REQUEST_ID` cũ**, sau khi request đã `EXECUTED`:

```powershell
npm run withdrawal:review -- $REQUEST_ID KHTC-01 approve
```

Backend cố tình **không** chặn ở tầng ứng dụng: nó chỉ đọc nullifier để in log, và **không gọi
`estimateGas`** (vì estimate sẽ mô phỏng rồi trả lỗi ngay trong Node.js, khiến giao dịch không bao
giờ được gửi lên chain). Giao dịch được broadcast với gas limit cố định `300000` để **chính smart
contract** revert.

**Kỳ vọng BỊ TỪ CHỐI ĐÚNG:**

```
usedNullifier before: true                  <- khác lần đầu (false)
on-chain replay attempt: true
submitted transactionHash: 0x...            <- CÓ gửi lên chain

========================
WITHDRAWAL EXECUTION FAILED
========================
Reason: <thông báo revert chứa "nullifier already used">
```

exit code ≠ 0.

**Cách phân biệt với lỗi hệ thống thật** — đây là điểm quan trọng nhất của bước này:

| | Từ chối ĐÚNG (đạt tiêu chí) | Lỗi hệ thống (không tính là đạt) |
|---|---|---|
| `usedNullifier before` | `true` | `false`, hoặc không in ra |
| `submitted transactionHash` | **có in ra** | không có |
| Lý do | chứa `nullifier already used` | `ECONNREFUSED`, `not school`, `insufficient pool`, `invalid recipient`, `Withdrawal request not found`, timeout… |
| Nơi phát sinh | revert từ `ShieldedPool.withdrawOffChain()` | backend / RPC / MongoDB |

Nếu thấy `Reason: not school` thì đó là sai account chứ không phải chống double-spend. Nếu thấy
`insufficient pool` thì là hết tiền. Cả hai đều **không** chứng minh được tiêu chí này.

**Trạng thái sau khi bị từ chối phải không đổi:**

- `usedNullifier[nullifier]` vẫn `true`;
- sinh viên **không** nhận thêm ETH;
- `withdrawalrequests` vẫn `EXECUTED` với `transactionHash` của lần **đầu** (code không ghi đè khi
  `isReplayAttempt = true`);
- pool balance không giảm thêm.

## C12. Verify với input sai

Có **ba** cách, chạy được cả ba thì càng chắc. Cách C12-0 là kịch bản đúng như đề bài yêu cầu
("đổi nullifier rồi verify"), làm được nhờ mode `verify` của mục A2.

### C12-0. Đổi nullifier rồi verify — kịch bản trực tiếp

Mode `verify` nhận `{proof, root, nullifier, amount, recipient}` từ stdin *(A25 — thêm `recipient`)*,
nên đổi thẳng public input được.

> ✅ **Kịch bản này đã có test tự động** —
> [`prover/tests/verify_gate.rs`](prover/tests/verify_gate.rs), chạy bằng
> `cargo test --release --test verify_gate`. Nó tự tạo proof rồi lật 1 bit ở `nullifier` và
> `amount`, kỳ vọng bị từ chối. Chạy tay bên dưới để tự mắt thấy, nhưng test mới là thứ giữ cho
> tính chất này không bị phá về sau.

**Bước 1 — verify với dữ liệu ĐÚNG (đối chứng).** Lần `prove` gần nhất đã ghi sẵn
`shared/proof.json` với đủ **năm** trường (`proof`, `root`, `nullifier`, `amount`, `recipient` — A25):

```powershell
Set-Location C:\Users\VivoBook\research-project\code\zk-circuits-halo2-advanced\backend
Get-Content ..\shared\proof.json | ..\target\release\prover.exe verify
```

Kỳ vọng: `{"verified":true,"setup_ms":...,"verify_ms":...}`

**Bước 2 — verify với nullifier BỊ SỬA.** Copy `shared/proof.json` thành `proof_gia.json`, đổi vài
ký tự hex trong `"nullifier"` (giữ đủ 64 hex), rồi:

```powershell
Get-Content proof_gia.json | ..\target\release\prover.exe verify
```

**Kỳ vọng BỊ TỪ CHỐI ĐÚNG:**

```
========================
OFF-CHAIN VERIFICATION FAILED
========================
verification error = ...

thread 'main' panicked at prover\src\generate_proof.rs:...:
Proof was rejected by the native Halo2 verifier
```

exit ≠ 0, và **không** in ra dòng JSON `{"verified":true,...}`.

Làm tương tự với `"root"`, `"amount"` hoặc `"recipient"` đều phải bị từ chối — cả bốn đều là public
input được ràng buộc vào proof *(`recipient` từ A25; `verify_gate.rs` có ca này)*.

> **Vì sao không đổi được `siblings[]`/`directions[]`:** chúng là private witness, nằm *bên trong*
> proof chứ không phải tham số của `verify`. Đổi Merkle path nghĩa là phải tạo proof mới — và khi đó
> `root` tính ra sẽ khác, nên rơi về đúng trường hợp "đổi root" ở trên.

> ### Vì sao `prove` không còn tự chặn proof xấu
>
> Trước đây `prove` verify nội bộ rồi `panic` nếu thất bại. Nghĩa là proof xấu chết ngay trong
> `prove` và **mode `verify` không bao giờ có việc để làm** — không thể kiểm chứng được nó có khả
> năng từ chối hay không.
>
> Nay `prove` trả proof vô điều kiện, **không verify gì cả**. **Quyền từ chối thuộc về mode
> `verify`**, và mode `verify` được backend nạp bốn public input từ **nguồn độc lập với prover**:
>
> | Public input | Nguồn |
> |---|---|
> | `root` | `currentRoot` đọc từ smart contract |
> | `nullifier` | backend tự tính từ `rho` trong note |
> | `amount` | số tiền Phòng KH-TC đã duyệt |
> | `recipient` | ví sinh viên đã đăng ký *(A25)* |
>
> Nhờ vậy verify bắt được cả những ca mà verify nội bộ mù: proof hợp lệ nhưng `root`/`nullifier`/
> `amount` không khớp trạng thái thật của hệ thống. Chi tiết:
> [`VERIFY_MECHANISM.md`](../VERIFY_MECHANISM.md) và [`CONSTRAINT_FLOW.md`](../CONSTRAINT_FLOW.md).
>
> **Hệ thống vẫn chặn proof xấu** — chỉ đổi chỗ chặn, và còn một cổng thứ hai ở bước
> `withdrawal:review` (verify lại rồi hỏi contract `validRoot` / `usedNullifier`).

### Hai cách gián tiếp (vẫn nên chạy)

Hai cách dưới đi qua đúng luồng nghiệp vụ thật, kiểm chứng các lớp chặn *trước* khi tới verify.

### C12-a. Sửa note (đổi `rho`) rồi đẩy vào đúng luồng withdrawal

> **⏱ Phải chạy giữa B6.6 và B8**, khi scholarship còn ở `ROOT_APPROVED`.
>
> **Nếu đã lỡ chạy qua B11/C11 rồi** (scholarship đã `WITHDRAWN`), chọn một trong hai cách để có
> lại một scholarship ở trạng thái `ROOT_APPROVED`:
>
> - **Cách sạch — thêm sinh viên thứ hai** (khuyên dùng, không đụng dữ liệu cũ):
>   ```powershell
>   $STUDENT_ID_2 = 1002
>   $STUDENT_EMAIL_2 = "student2@example.edu"
>   npm run student:create -- $UNIVERSITY_ID CTSV-01 $STUDENT_ID_2 $STUDENT_EMAIL_2
>   npm run student:eligibility -- $UNIVERSITY_ID CTSV-01 $STUDENT_ID_2 approve
>   npm run student:finance -- $UNIVERSITY_ID KHTC-01 $STUDENT_ID_2 $STUDENT_AMOUNT_WEI
>   npm run student:wallet -- $UNIVERSITY_ID CTSV-01 $POOL_ID $STUDENT_EMAIL_2 <ví account[3]> $STUDENT_PUBLIC_KEY
>   npm run scholarship:issue -- $UNIVERSITY_ID CTSV-01 $STUDENT_ID_2
>   npm run root:approve -- $POOL_ID CTSV-01
>   ```
>   Lấy CID mới của sinh viên 2 rồi làm C12-a trên note đó. Root sẽ đổi vì cây có 2 leaf — đúng như
>   mong đợi.
>
> - **Cách nhanh — reset toàn bộ** rồi chạy lại theo đúng thứ tự ở đầu PHẦN C (xem mục "Chạy lại từ
>   đầu" ở Phụ lục).

`createWithdrawalRequestCli` đọc JSON `{cid, note}` từ stdin, nên chỉ cần sửa `rho` trong JSON đó.
Đổi `rho` sẽ làm commitment tính lại không khớp commitment đã nằm trong cây.

```powershell
# 1. Lấy note thật ra file (trong backend/)
npm run --silent note:decrypt -- $CID $STUDENT_PRIVATE_KEY > note_that.json

# 2. Mở note_that.json, đổi vài chữ số trong "rho", lưu thành note_gia.json
#    (giữ nguyên cid, student_id, amount)

# 3. Đẩy note giả vào đúng luồng
Get-Content note_gia.json | npm run --silent withdrawal:create
```

> ### 🔄 Kết quả kỳ vọng ĐÃ ĐỔI (2026-08-10)
>
> Trước đây prover `panic` ngay tại `inputs_builder`, **không sinh proof**. Nay hai guard đó
> **chỉ cảnh báo**: proof vẫn được tạo, và **`verify` mới là nơi từ chối**.
>
> Lý do: guard trong prover chạy ở phía người dùng nên không phải ranh giới tin cậy. Chi tiết ở
> [`CONSTRAINT_FLOW.md`](../CONSTRAINT_FLOW.md) mục 7b.

**Kỳ vọng BỊ TỪ CHỐI ĐÚNG** — hai cảnh báo, rồi verify từ chối:

```
========================
CREATE AND VERIFY PROOF
========================
RUST STDERR: Witness commitment = 0x<khác commitment đã lưu>

CẢNH BÁO: commitment tại merkle_index không khớp note đã giải mã.
          Proof vẫn được tạo; việc từ chối thuộc về bước verify.

Local Merkle root        = 0x...
Root from smart contract = 0x...
Root from witness path   = 0x<khác hai cái trên>

CẢNH BÁO: root dựng từ note không khớp currentRoot trên smart contract.
          Proof vẫn được tạo; việc từ chối thuộc về bước verify.

========================
CREATE PROOF COMPLETED          <- CÓ dòng này, khác trước
========================

========================
OFF-CHAIN VERIFICATION FAILED   <- ĐÂY mới là chỗ từ chối
========================
thread 'main' panicked at prover\src\generate_proof.rs:
Proof was rejected by the native Halo2 verifier

CREATE WITHDRAWAL REQUEST FAILED
Error: Proof rejected by Halo2 verifier: root does not match currentRoot on-chain
```

Dòng `Error:` cuối cùng do backend thêm vào để chỉ rõ **số nào lệch** — xem bảng ba thông điệp ở
mục B8+B9.

exit ≠ 0, và **không** có document nào được thêm vào `withdrawalrequests`.

Bốn điều cần đối chiếu để chắc đây là từ chối đúng chứ không phải lỗi khác:

1. **CÓ dòng `CREATE PROOF COMPLETED`** — proof được tạo thật. *(Trước đây không có dòng này.)*
2. **Hai dòng `CẢNH BÁO`** xuất hiện — prover vẫn báo cho người dùng trung thực biết sai ở đâu.
3. `Root from witness path` **khác** `Root from smart contract` — đây là con số làm verify từ chối.
4. Panic đến từ **`generate_proof.rs`** với `OFF-CHAIN VERIFICATION FAILED`, **không phải** từ
   `inputs_builder.rs`, và không phải lỗi parse JSON hay kết nối.

> **Vì sao đổi kiểu này lại tốt hơn:** chứng minh được rằng thứ chặn kẻ gian là **ràng buộc mật mã**,
> không phải một câu `if` trong chương trình mà chính kẻ gian đang chạy. Bằng chứng tự động:
> `prover/tests/verify_gate.rs` → `a_forged_note_still_produces_a_proof_but_verify_rejects_it`.

Nếu note giả tình cờ vượt qua được bước commitment, lớp chặn kế tiếp là kiểm tra do mục A3 thêm vào:

```
Proof nullifier does not match the nullifier computed by backend
```

Trong thực tế lớp này **không bắn** — nhưng **không phải** vì commitment check chặn trước. Từ **D0**
commitment check chỉ **cảnh báo**; thứ chặn là `OFF-CHAIN VERIFICATION FAILED` ở trên, khiến prover
exit ≠ 0 nên backend **chưa bao giờ tới** được bước so nullifier. Nó là lưới dự phòng cho trường hợp
verify bị vô hiệu, không phải lớp thứ hai đang hoạt động.

> 📖 Đối chiếu hai nhánh — cùng note giả này bị chặn ở đâu bên ONC *(đáp án phụ thuộc **đường đi**:
> `Halo2Verifier` nếu qua backend, `validRoot` nếu bỏ qua backend)* — xem
> [VERIFY_MECHANISM.md mục 5b](../VERIFY_MECHANISM.md#5b-bốn-ví-dụ-cụ-thể--mỗi-repo-một-ca-đúng-một-ca-sai).

### C12-b. Giải mã bằng khóa sai

```powershell
npm run --silent note:decrypt -- $CID "0xdeadbeef00000000000000000000000000000000000000000000000000000001"
```

**Kỳ vọng:**

```
STUDENT NOTE DECRYPTION FAILED
Error: Unsupported state or unable to authenticate data
```

exit ≠ 0. Đây là AES-GCM auth tag từ chối — chứng minh IPFS chỉ giữ ciphertext và sai khóa thì không
đọc được.

### Cách phân biệt FAIL đúng với crash / sai cú pháp

| | Từ chối ĐÚNG | Crash / sai cú pháp (làm lại) |
|---|---|---|
| Thông điệp | câu nghiệp vụ rõ nghĩa: `Proof was rejected by the native Halo2 verifier`, `Proof root does not match currentRoot`, `Proof amount does not match Finance-approved amount`, `Unsupported state or unable to authenticate data`, hoặc dòng `CẢNH BÁO:` từ prover | `SyntaxError: Unexpected token`, `Rust root mode received empty stdin`, `ECONNREFUSED`, `MONGODB_URI is missing`, `Missing release prover at ...` |
| Vị trí | panic trong prover, hoặc `throw` trong service sau khi đã đọc đủ dữ liệu | lỗi ngay khi parse đầu vào, hoặc lỗi kết nối |
| MongoDB | **không** phát sinh document mới | không phát sinh document mới (nhưng vì lý do khác) |

Điểm mấu chốt: từ chối đúng **luôn kèm một câu mô tả ràng buộc nghiệp vụ bị vi phạm**. Nếu thông
điệp nói về JSON, kết nối, biến môi trường hay file thiếu, thì đó là lỗi môi trường — sửa rồi chạy
lại, đừng tính là "hệ thống đã chặn".

---

# Phụ lục

## Bảng lệnh theo thứ tự

| # | Lệnh | Thư mục |
|---|---|---|
| A0 | `Copy-Item .env.example .env` · `npm install` | `backend/` |
| A1 | `npm run --silent db:test` | `backend/` |
| A2 | `ipfs daemon` | terminal riêng |
| A3 | `ganache ...` hoặc `npx hardhat node` · `npm run compile` | terminal riêng · `contracts/` |
| B5 | `cargo build --release -p prover` | gốc repo |
| B4 | `..\target\release\prover.exe setup` | `backend/` |
| B6.1 | `npm run university:create -- <name> <address>` | `backend/` |
| B6.2 | `npm run student:create` / `student:eligibility` / `student:finance` | `backend/` |
| B6.3 | `npm run pool:create` / `pool:deploy` / `pool:fund` / `pool:balance` | `backend/` |
| B6.4 | `npm run --silent student:pubkey -- <key>` · `npm run student:wallet` | `backend/` |
| B6.5 | `npm run scholarship:issue -- <universityId> <staffId> <studentId>` | `backend/` |
| B6.6 | `npm run root:approve -- <poolId> <staffId>` | `backend/` |
| B8/B9 | `... decryptStudentNoteCli.ts \| ... createWithdrawalRequestCli.ts` | `backend/` |
| B11 | `npm run withdrawal:review -- <requestId> <staffId> approve` | `backend/` |
| C11 | lặp lại lệnh B11 | `backend/` |

## Các bước KHÔNG XÁC ĐỊNH ĐƯỢC / KHÔNG CÓ

| Bước đề bài | Tình trạng |
|---|---|
| A1 — khởi động MongoDB bằng docker | **KHÔNG XÁC ĐỊNH ĐƯỢC** — repo không có `docker-compose.yml` hay script nào |
| A3 — backend server, port, health check | **KHÔNG CÓ** — backend là CLI một-lần, không có server/port/endpoint. Đây là kiến trúc, không phải thiếu sót |

**Ba mục đã được khép lại** bởi mục **A2** trong `../DECISIONS.md`:

| Bước | Trước A2 | Sau A2 |
|---|---|---|
| B4 — key generation | không có lệnh | `prover setup` → `shared/params.bin` |
| B9 — verify như bước riêng | nằm chung với `prove` | `prover verify` → `{verified, setup_ms, verify_ms}` |
| C12 — đổi nullifier rồi verify | không làm được | C12-0 làm trực tiếp |

Riêng `vk` vẫn không lưu thành file được (`halo2_proofs 0.3.2` không có `VerifyingKey::write`) —
nó được tái sinh xác định, xem B4.

## Thu số liệu cho bài báo

Sau một lượt chạy đầy đủ, các con số nằm ở đây:

| Số liệu | Lấy ở đâu | Giá trị tham chiếu |
|---|---|---|
| Verification time off-chain (§2.1.1) | `withdrawalrequests.verificationMs`, hoặc `verify_ms` trong log | ~7 ms |
| Deploy pool gas (§2.1.2) | `scholarshippools.deploymentGasUsed` | 816,796 |
| `updateRoot` gas | `scholarshippools.lastRootUpdateGasUsed` | 69,776 |
| `withdrawOffChain` gas | `withdrawalrequests.withdrawGasUsed` | 62,520 |
| Fund pool gas | output JSON của `pool:fund` (không lưu DB) | 22,245 |

Giá trị tham chiếu đo trên Ganache ở n = 1, depth 7 — dùng để đối chiếu xem lượt chạy của bạn có
bất thường không, **không phải** số liệu chính thức cho bài.

> ~~**Chưa có runner định lượng theo n cho ADV.**~~ → ✅ **ĐÃ CÓ từ 2026-08-16.**
>
> `backend/src/experiments/quantitativeExperiment.ts` — chạy bằng:
>
> ```powershell
> npm run experiment:quantitative        # 6 kịch bản n = 1,5,10,20,50,100 — khoảng 6–8 phút
> ```
>
> Chỉ cần **Ganache** mở ≥ 101 tài khoản (`--wallet.totalAccounts 120`); **không** cần MongoDB,
> **không** cần IPFS. Chạy thử một phần: `$env:KICH_BAN = "1,5"` — nhớ `Remove-Item Env:\KICH_BAN`
> sau đó, biến môi trường PowerShell sống qua nhiều lệnh.
>
> Xuất ra `experiments/results/`: `performance_offchain_n*.csv`, `gas_offchain_raw.csv`
> *(186 dòng)*, `proofs_offchain_n*.json`.
>
> ⚠️ Con số ở bảng trên là **n = 1, một lượt** — chỉ để đối chiếu bất thường. **Số chính thức cho
> bài** nằm ở [`reports/quantitative_offchain.md`](reports/quantitative_offchain.md), kèm giải thích cách đo, vì sao
> ra kết quả đó, và **hai cái bẫy trích dẫn** (gas rút có hai băng chênh 25 000 do EIP-161; quy ước
> "trung vị trên").

## Chạy lại từ đầu

Xóa sạch 6 collection của ADV bằng script có sẵn (chạy trong `backend/`) — 🆕 từ K10 gồm cả
`merklenodes`:

```powershell
npm run flow:reset
```

In ra `RESETTING DATABASE: <tên db>` trên stderr, rồi một JSON tổng kết trên stdout:

```json
{
  "reset": true,
  "storage": "MongoDB",
  "database": "...",
  "deletedDocuments": {
    "withdrawalrequests": 1,
    "studentscholarships": 1,
    "scholarshippools": 1,
    "universitystudents": 1,
    "universities": 1
  }
}
```

Muốn xóa tay thì dùng mongosh / Compass (nhớ kết nối đúng URI trong `.env`):

```javascript
db.withdrawalrequests.deleteMany({})
db.studentscholarships.deleteMany({})
db.scholarshippools.deleteMany({})
db.universitystudents.deleteMany({})
db.universities.deleteMany({})
```

> ⚠️ **Nếu `MONGODB_URI` trỏ tới Atlas thì lệnh này xóa dữ liệu thật trên cloud.** Đọc kỹ dòng
> `RESETTING DATABASE:` in ra trước khi tin là mình đang xóa đúng database.

Ganache/Hardhat khởi động lại là mất sạch state chain — nhớ **xóa MongoDB cùng lúc**, nếu không
MongoDB sẽ trỏ tới contract address không còn tồn tại. Với Atlas thì điều này càng dễ quên, vì dữ
liệu cũ vẫn nằm nguyên trên cloud sau khi bạn restart chain.

## Ràng buộc cần nhớ

- **Tối đa 512 sinh viên mỗi pool** (`MERKLE_DEPTH = 9`, `MAX_LEAVES = 1 << 9`). Sinh viên thứ 513
  sẽ bị `scholarship:issue` từ chối. *(Trước 2026-08-30 là depth 7 ⇒ trần 128 — nâng lên 9 để chứa
  được đợt HBKKHT thật của UIT, **353 suất**; xem `code/STATUS.md` mục `d = 9`.)* Depth khai ở **hai**
  chỗ và phải khớp: `prover/src/inputs_builder.rs` và `backend/src/services/issueScholarshipService.ts`.
- **Đổi `MERKLE_DEPTH` hoặc `K` thì phải chạy lại `prover setup`** và **không dùng lại được dữ liệu
  cũ**: root dựng bằng depth mới sẽ khác root đã ghi on-chain, nên `withdrawal:create` sẽ báo
  `Merkle root rebuilt from MongoDB commitments does not match currentRoot`. Phải reset MongoDB và
  deploy pool mới.
- **Đừng chạy luồng tay này và `npm run experiment:qualitative` trên cùng một database** — runner tự
  tạo University/student/pool riêng, chạy lẫn sẽ gây trùng dữ liệu.
- `merkleIndex` phải liên tục từ 0. Xóa lẻ document ở giữa sẽ làm `root:approve` và
  `withdrawal:create` báo `Merkle indexes are not continuous`.
