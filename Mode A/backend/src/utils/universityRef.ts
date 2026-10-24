function universityIdOf(reference: unknown): string {
  if (reference && typeof reference === 'object' && (reference as any)._id) {
    return String((reference as any)._id);
  }

  return String(reference ?? '');
}

export { universityIdOf };
