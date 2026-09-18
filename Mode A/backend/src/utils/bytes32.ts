function normalizeBytes32(
    value:
        string
): string {
    const normalized =
        value.startsWith(
            "0x"
        )
            ?
            value
            :
            "0x" + value;

    if (
        !/^0x[0-9a-fA-F]{64}$/.test(
            normalized
        )
    ) {
        throw new Error(
            `Invalid bytes32 value: ${normalized}`
        );
    }

    return normalized.toLowerCase();
}

/*
 * Đổi số wei dạng decimal string sang bytes32 hex.
 *
 * Prover nhận amount dưới dạng field element hex,
 * còn MongoDB lưu decimal string, nên cần bước này
 * khi verify lại proof từ dữ liệu đã lưu.
 */
function decimalToBytes32(
    value:
        string
): string {
    if (
        !/^[0-9]+$/.test(
            value
        )
    ) {
        throw new Error(
            `Invalid decimal value: ${value}`
        );
    }

    return normalizeBytes32(
        BigInt(value)
            .toString(16)
            .padStart(64, "0")
    );
}

module.exports = {
    normalizeBytes32,
    decimalToBytes32
};