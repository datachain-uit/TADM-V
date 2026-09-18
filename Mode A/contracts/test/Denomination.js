/*
 * ===================================================================
 * V1(b) — HOP DONG CUONG CHE MOT MENH GIA
 * ===================================================================
 *
 * VI SAO CO FILE NAY. `RFC 6973 muc 3.3` dinh nghia tap an danh la mot
 * tap ca the "have the same attributes, making them indistinguishable".
 * Thuoc tinh ma quan sat vien thay tren chuoi o he nay la SO TIEN.
 *
 * Neu moi nguoi mot muc thi tap an danh ve 1. Truoc 2026-09-02, dieu
 * kien "cung menh gia" chi dat NHO DU LIEU tinh co dong nhat — hop dong
 * co truong `denomination` nhung MOI luot deploy deu de gia tri 0, ma
 * `require(denomination == 0 || amount == denomination)` thi ve dau
 * dung nen require LUON QUA. Nhanh cuong che CHUA TUNG CHAY mot lan nao,
 * va khong file test nao dong toi no.
 *
 * File nay dong lo hong do: chung minh nhanh cuong che CHAY THAT.
 */

const assert = require("assert");

const {
    ethers
} = require("hardhat");

async function assertReverted(action, expectedMessage) {
    try {
        await action();
        assert.fail(
            "Expected transaction to revert"
        );

    } catch (error) {
        assert.match(
            String(error.message),
            new RegExp(expectedMessage)
        );
    }
}

describe(
    "ShieldedPool - V1(b) denomination",
    function () {
        let university;
        let student;
        let studentTwo;

        const MENH_GIA = ethers.utils.parseEther("0.1");

        async function trienKhai(denomination) {
            const Pool = await ethers.getContractFactory(
                "ShieldedPool",
                university
            );

            const pool = await Pool.deploy(
                denomination,
                {
                    value: ethers.utils.parseEther("1")
                }
            );

            await pool.deployed();

            return pool;
        }

        function bam(hex) {
            return ethers.utils.hexZeroPad(hex, 32);
        }

        beforeEach(
            async function () {
                [
                    university,
                    student,
                    studentTwo
                ] = await ethers.getSigners();
            }
        );

        it(
            "ghi lai menh gia luc deploy, doc nguoc duoc tu chuoi",
            async function () {
                const pool = await trienKhai(MENH_GIA);

                /*
                 * Doc nguoc duoc la dieu kien de runner dinh tinh ghi
                 * duoc `denomination` vao bang chung cua `R1`. Khong co
                 * getter cong khai thi khong chung minh duoc gi.
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
                const root = bam("0xabcd");

                await pool.updateRoot(root, []);

                await assertReverted(
                    () => pool.withdrawOffChain(
                        root,
                        bam("0x01"),
                        student.address,

                        // Lech dung 1 wei — du de bi tu choi.
                        MENH_GIA.add(1)
                    ),
                    "wrong denomination"
                );
            }
        );

        it(
            "CHO QUA lan rut dung menh gia",
            async function () {
                const pool = await trienKhai(MENH_GIA);
                const root = bam("0xabcd");

                await pool.updateRoot(root, []);

                const truoc = await ethers.provider.getBalance(
                    student.address
                );

                await pool.withdrawOffChain(
                    root,
                    bam("0x02"),
                    student.address,
                    MENH_GIA
                );

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
                const root = bam("0xabcd");

                await pool.updateRoot(root, []);

                const bien = await pool.filters.Withdraw();

                await pool.withdrawOffChain(
                    root,
                    bam("0x11"),
                    student.address,
                    MENH_GIA
                );

                await pool.withdrawOffChain(
                    root,
                    bam("0x12"),
                    studentTwo.address,
                    MENH_GIA
                );

                const suKien = await pool.queryFilter(bien);

                assert.strictEqual(suKien.length, 2);

                assert.strictEqual(
                    suKien[0].args.amount.toString(),
                    suKien[1].args.amount.toString()
                );

                // Nhung NGUOI NHAN thi van khac nhau — dung nhu thiet ke:
                // `R1` noi ve "khong phan biet duoc BANG THUOC TINH", con
                // dia chi vi la thu cong khai co chu y, va `A21` bao dam
                // moi suat mot vi moi nen no khong noi nguoc ve sinh vien.
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
                 * KHAC nhau de cho thay tap an danh co lai. Neu bo mat
                 * duong `denomination = 0` thi kich ban do khong chay
                 * duoc nua. Test nay chot hanh vi do lai.
                 */
                const pool = await trienKhai(0);
                const root = bam("0xabcd");

                await pool.updateRoot(root, []);

                await pool.withdrawOffChain(
                    root,
                    bam("0x21"),
                    student.address,
                    ethers.utils.parseEther("0.1")
                );

                await pool.withdrawOffChain(
                    root,
                    bam("0x22"),
                    studentTwo.address,
                    ethers.utils.parseEther("0.2")
                );

                assert.strictEqual(
                    (await pool.denomination()).toString(),
                    "0"
                );
            }
        );
    }
);
