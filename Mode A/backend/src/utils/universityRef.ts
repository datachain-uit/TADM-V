/*
 * Rut `universityId` tu mot tham chieu truong.
 *
 * VI SAO CAN HAM NAY
 * Truong `pool.university` KHONG phai luc nao cung cung mot kieu:
 *
 *   - `ScholarshipPool.findById(...)`        -> ObjectId
 *   - `resolveDeployedPool(...)`             -> DOCUMENT day du,
 *     va `request.pool` trong `reviewWithdrawalRequestService`,
 *     vi ca hai duong deu co `.populate("university")`
 *
 * Voi ObjectId thi `String(...)` ra chuoi hex 24 ky tu, dung.
 * Voi document thi `String(...)` ra ban mo ta nhieu dong cua mongoose:
 *
 *   "{\n  _id: new ObjectId('...'),\n  name: 'Truong Dai hoc',\n ... }"
 *
 * Chuoi do khong cast duoc sang ObjectId, nen `UniversityStaff.findOne`
 * nem `CastError`. Da gap that 2026-08-22 khi chay thuc nghiem dinh tinh.
 *
 * VI SAO KHONG SUA TRONG `authorizeStaffService.ts`
 * Do la cong phan quyen. Noi long kieu tham so o do (`string` -> `any`)
 * se lam mat kiem tra kieu ngay tai cho nhay cam nhat. Gac o day thi
 * `authorizeStaff` van chi nhan `string`, va compiler van bat duoc loi
 * neu ai do truyen nham.
 */
function universityIdOf(
    reference: unknown
): string {
    if (
        reference
        && typeof reference === "object"
        && (reference as any)._id
    ) {
        return String((reference as any)._id);
    }

    return String(reference ?? "");
}

module.exports = {
    universityIdOf
};
