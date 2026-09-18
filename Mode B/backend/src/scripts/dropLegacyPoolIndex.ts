/*
 * GO INDEX CU `university_1` TREN COLLECTION POOL  (S-36, 2026-08-29)
 *
 * VI SAO CAN SCRIPT NAY. Truoc 29/08, `ScholarshipPool.university` khai
 * `unique: true`, tuc MOT TRUONG CHI DUOC MOT POOL. Ngay 29/08 bo rang
 * buoc do de mot truong chay duoc NHIEU CHUONG TRINH hoc bong.
 *
 * 🔴 NHUNG bo `unique` trong schema KHONG xoa index da nam trong
 * MongoDB. Mongoose tao index that luc ket noi lan dau; xoa dong khai
 * bao trong code khong dong vao index cu. Va `resetDatabase` dung
 * `deleteMany({})` — xoa DOCUMENT, GIU INDEX.
 *
 * ⇒ Database nao da tung chay ban cu thi tao pool thu hai VAN LOI
 *   `E11000 duplicate key error ... index: university_1`
 *   du code da sua dung. Chay script nay MOT LAN de go.
 *
 * AN TOAN: chi xoa dung mot index co ten `university_1`. Khong dung
 * toi document nao. Chay lai nhieu lan khong sao — lan sau bao "khong
 * tim thay", coi nhu xong.
 *
 * CHAY:  npx ts-node src/scripts/dropLegacyPoolIndex.ts
 *
 * ONC: collection la `onchain_scholarship_pools` (tien to `onchain_`
 * de khong de len du lieu cua repo ADV).
 */

const {
    connectDatabase,
    disconnectDatabase
} = require("../config/database");

const {
    ScholarshipPool
} = require("../models/ScholarshipPool");

const LEGACY_INDEX_NAME = "university_1";

async function dropLegacyPoolIndex() {
    await connectDatabase();

    const collection = ScholarshipPool.collection;
    const indexes = await collection.indexes();
    const found = indexes.some(
        (index: any) => index.name === LEGACY_INDEX_NAME
    );

    if (!found) {
        console.log(JSON.stringify({
            collection: collection.collectionName,
            legacyIndex: LEGACY_INDEX_NAME,
            dropped: false,
            reason: "index not present - nothing to do",
            currentIndexes: indexes.map((index: any) => index.name)
        }, null, 2));

        await disconnectDatabase();

        return;
    }

    await collection.dropIndex(LEGACY_INDEX_NAME);

    const remaining = await collection.indexes();

    console.log(JSON.stringify({
        collection: collection.collectionName,
        legacyIndex: LEGACY_INDEX_NAME,
        dropped: true,
        note: "one university can now hold several scholarship programs",
        currentIndexes: remaining.map((index: any) => index.name)
    }, null, 2));

    await disconnectDatabase();
}

module.exports = {
    dropLegacyPoolIndex
};

if (require.main === module) {
    dropLegacyPoolIndex().catch((error: any) => {
        console.error("DROP LEGACY POOL INDEX FAILED");
        console.error(error);
        process.exitCode = 1;
    });
}
