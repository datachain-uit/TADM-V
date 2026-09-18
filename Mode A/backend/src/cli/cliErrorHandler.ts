function handleCliError(error: unknown) {
    console.error(error);
    process.exitCode = 1;
}

module.exports = {
    handleCliError
};
