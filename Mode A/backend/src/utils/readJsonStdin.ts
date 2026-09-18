const fs =
    require(
        "fs"
    );

function readJsonFromStdin() {
    const rawInput =
        fs.readFileSync(
            0,
            "utf8"
        );

    /*
     * Loại bỏ UTF-8 BOM nếu PowerShell
     * hoặc một tiến trình Windows thêm vào.
     */
    const cleanedInput =
        rawInput
            .replace(
                /^\uFEFF/,
                ""
            )
            .trim();

    if (!cleanedInput) {
        throw new Error(
            "Expected JSON input from stdin. " +
            "Run the decrypt command and backend command " +
            "on the same pipeline."
        );
    }

    /*
     * Bình thường cleanedInput phải bắt đầu
     * bằng {"cid":...}.
     *
     * lastIndexOf là lớp bảo vệ phụ nếu một
     * thư viện vẫn vô tình ghi log trước JSON.
     */
    const jsonStart =
        cleanedInput.lastIndexOf(
            '{"cid"'
        );

    const jsonText =
        jsonStart >= 0
            ?
            cleanedInput.slice(
                jsonStart
            )
            :
            cleanedInput;

    try {
        const parsed =
            JSON.parse(
                jsonText
            );

        if (
            !parsed
            ||
            typeof parsed
            !==
            "object"
        ) {
            throw new Error(
                "Parsed input is not an object"
            );
        }

        return parsed;

    } catch (
        error:
            any
    ) {
        console.error(
            "STDIN RECEIVED BY BACKEND:"
        );

        // /*
        //  * Chỉ in một phần dữ liệu để debug,
        //  * tránh vô tình in toàn bộ rho.
        //  */
        // console.error(
        //     jsonText.slice(
        //         0,
        //         200
        //     )
        // );

        throw new Error(
            "Invalid JSON from stdin: " +
            error.message
        );
    }
}

module.exports = {
    readJsonFromStdin
};