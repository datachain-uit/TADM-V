/*
 * ===================================================================
 * V1(b) — HOP DONG CUONG CHE MOT MENH GIA (nhanh on-chain)
 * ===================================================================
 *
 * VI SAO CO FILE NAY. `RFC 6973 muc 3.3` dinh nghia tap an danh la mot
 * tap ca the "have the same attributes, making them indistinguishable".
 * Thuoc tinh quan sat vien thay tren chuoi o he nay la SO TIEN.
 *
 * Truoc 2026-09-02, dieu kien "cung menh gia" chi dat NHO DU LIEU tinh
 * co dong nhat: hop dong co truong `denomination` nhung MOI luot deploy
 * deu de gia tri 0, ma `require(denomination == 0 || ...)` thi ve dau
 * dung nen require LUON QUA. Nhanh cuong che CHUA TUNG CHAY, va khong
 * file test nao dong toi no.
 *
 * KHAC BAN OFF-CHAIN: o day `withdraw` doc so tien tu PUBLIC INPUT cua
 * proof (`proofAmount`), khong phai tu tham so. Nen phep chan menh gia
 * rang buoc vao chinh proof — chat hon mot bac.
 *
 * Dung `MockHalo2Verifier` (nhan moi proof) vi muc tieu o day la kiem
 * NHANH CUONG CHE MENH GIA, khong phai kiem verifier. Phep kiem verifier
 * that nam o `Halo2VerifierGate.js`.
 */

const assert = require("assert");

const {
    ethers
} = require("hardhat");

/*
 * Dung blob calldata tong hop: 32 byte root + 32 byte nullifier +
 * 32 byte amount + 32 byte recipient (A25), roi mot khuc dem cho giong
 * proof that. `decodePublicInputs` doc 128 byte dau va doi do dai >= 128.
 */
function dungCalldata(root, nullifier, amount, recipient) {
    const w = (v) => ethers.utils.hexZeroPad(
        ethers.BigNumber.from(v).toHexString(),
        32
    ).replace(/^0x/, "");

    return "0x"
        + w(root)
        + w(nullifier)
        + w(amount)
        + w(recipient)
        + "00".repeat(64);
}

async function expectRevert(action, message) {
    try {
        await action();
        assert.fail(
            `Giao dich PHAI revert voi "${message}" nhung lai thanh cong`
        );
    } catch (error) {
        assert.match(
            String(error.message),
            new RegExp(message),
            `Revert sai ly do. Mong doi "${message}", nhan: ${error.message}`
        );
    }
}

describe(
    "ShieldedPool - V1(b) denomination (on-chain)",
    function () {
        let university;
        let student;
        let studentTwo;
        let verifier;

        const MENH_GIA = ethers.utils.parseEther("0.1");

        const ROOT = ethers.utils.hexZeroPad("0xabcd", 32);

        async function trienKhai(denomination) {
            const Pool = await ethers.getContractFactory(
                "ShieldedPool",
                university
            );

            const pool = await Pool.deploy(
                verifier.address,
                denomination,
                {
                    value: ethers.utils.parseEther("1")
                }
            );

            await pool.deployed();
            await (await pool.updateRoot(ROOT, [])).wait();

            return pool;
        }

        beforeEach(
            async function () {
                [
                    university,
                    student,
                    studentTwo
                ] = await ethers.getSigners();

                const Verifier = await ethers.getContractFactory(
                    "MockHalo2Verifier",
                    university
                );

                verifier = await Verifier.deploy();
                await verifier.deployed();
            }
        );

        it(
            "ghi lai menh gia luc deploy, doc nguoc duoc tu chuoi",
            async function () {
                const pool = await trienKhai(MENH_GIA);

                /*
                 * Doc nguoc duoc la dieu kien de runner dinh tinh ghi
                 * `denomination` vao bang chung cua `R1`. Khong co getter
                 * cong khai thi khong chung minh duoc gi.
                 */
                assert.strictEqual(
                    (await pool.denomination()).toString(),
                    MENH_GIA.toString()
                );
            }
        );

        it(
            "TU CHOI lan rut sai menh gia",
            async function () {
                const pool = await trienKhai(MENH_GIA);

                // Lech dung 1 wei — du de bi tu choi.
                const sai = MENH_GIA.add(1);

                await expectRevert(
                    () => pool.withdraw(
                        dungCalldata(ROOT, 1, sai, student.address),
                        ROOT,
                        ethers.utils.hexZeroPad("0x01", 32),
                        student.address,
                        sai
                    ),
                    "wrong denomination"
                );
            }
        );

        it(
            "CHO QUA lan rut dung menh gia",
            async function () {
                const pool = await trienKhai(MENH_GIA);

                const truoc = await ethers.provider.getBalance(
                    student.address
                );

                await (
                    await pool.withdraw(
                        dungCalldata(ROOT, 2, MENH_GIA, student.address),
                        ROOT,
                        ethers.utils.hexZeroPad("0x02", 32),
                        student.address,
                        MENH_GIA
                    )
                ).wait();

                const sau = await ethers.provider.getBalance(
                    student.address
                );

                assert.strictEqual(
                    sau.sub(truoc).toString(),
                    MENH_GIA.toString()
                );
            }
        );

        it(
            "moi lan rut deu cung mot so tien => khong phan biet duoc",
            async function () {
                /*
                 * DAY MOI LA DIEU `R1` CAN. Hai test tren chung minh co
                 * che chan; test nay chung minh HE QUA: hai lan rut khac
                 * nguoi phat ra `event Withdraw` co truong `amount`
                 * GIONG HET nhau, nen so tien khong con la thuoc tinh
                 * phan biet duoc hai ung vien.
                 */
                const pool = await trienKhai(MENH_GIA);

                await (
                    await pool.withdraw(
                        dungCalldata(ROOT, 0x11, MENH_GIA, student.address),
                        ROOT,
                        ethers.utils.hexZeroPad("0x11", 32),
                        student.address,
                        MENH_GIA
                    )
                ).wait();

                await (
                    await pool.withdraw(
                        dungCalldata(ROOT, 0x12, MENH_GIA, studentTwo.address),
                        ROOT,
                        ethers.utils.hexZeroPad("0x12", 32),
                        studentTwo.address,
                        MENH_GIA
                    )
                ).wait();

                const suKien = await pool.queryFilter(
                    pool.filters.Withdraw()
                );

                assert.strictEqual(suKien.length, 2);

                assert.strictEqual(
                    suKien[0].args.amount.toString(),
                    suKien[1].args.amount.toString()
                );

                // Nguoi nhan van khac nhau — dung nhu thiet ke: `R1` noi
                // ve "khong phan biet duoc BANG THUOC TINH", con dia chi
                // vi la thu cong khai co chu y, va `A21` bao dam moi suat
                // mot vi moi nen no khong noi nguoc ve sinh vien.
                assert.notStrictEqual(
                    suKien[0].args.recipient,
                    suKien[1].args.recipient
                );
            }
        );

        it(
            "denomination = 0 thi KHONG cuong che - giu duoc kich ban doi chung C-13",
            async function () {
                /*
                 * Kich ban doi chung cua C-13 phai cap moi nguoi mot muc
                 * KHAC nhau de cho thay tap an danh co lai. Bo mat duong
                 * `denomination = 0` thi kich ban do khong chay duoc nua.
                 */
                const pool = await trienKhai(0);

                const mucMot = ethers.utils.parseEther("0.1");
                const mucHai = ethers.utils.parseEther("0.2");

                await (
                    await pool.withdraw(
                        dungCalldata(ROOT, 0x21, mucMot, student.address),
                        ROOT,
                        ethers.utils.hexZeroPad("0x21", 32),
                        student.address,
                        mucMot
                    )
                ).wait();

                await (
                    await pool.withdraw(
                        dungCalldata(ROOT, 0x22, mucHai, studentTwo.address),
                        ROOT,
                        ethers.utils.hexZeroPad("0x22", 32),
                        studentTwo.address,
                        mucHai
                    )
                ).wait();

                assert.strictEqual(
                    (await pool.denomination()).toString(),
                    "0"
                );
            }
        );
    }
);
