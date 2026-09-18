function handleCliError(error: unknown) {
    const message =
        error instanceof Error
            ? error.message
            : String(error);

    console.error(message);
    process.exitCode = 1;
}

module.exports = {
    handleCliError
};
