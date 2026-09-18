const {
    connectDatabase,
    disconnectDatabase
} = require("../config/database");

/*
 * Vòng đời kết nối MongoDB cho MỘT lượt chạy CLI.
 *
 * Trước refactor, mỗi service tự gọi connectDatabase() ở đầu hàm và
 * .finally(disconnectDatabase) ở khối process.argv. Nghĩa là service vừa
 * làm nghiệp vụ vừa quản vòng đời kết nối — gọi service từ một service
 * khác là ngắt kết nối giữa chừng.
 *
 * Nay chỉ tầng controller mở/đóng, service thuần nghiệp vụ.
 */
async function withDatabaseCleanup<T>(
    operation: () => Promise<T>
): Promise<T> {
    try {
        await connectDatabase();
        return await operation();
    } finally {
        await disconnectDatabase();
    }
}

module.exports = {
    withDatabaseCleanup
};
