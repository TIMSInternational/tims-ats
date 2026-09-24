namespace Tims.Application.Proctoring;

public sealed record ProctoringUploadGrant(
    string Url,
    IReadOnlyDictionary<string, string> Fields,
    DateTime ExpiresAt);

public sealed record ProctoringSealedObject(
    string Key,
    string Sha256,
    string SourceETag,
    string SealedETag,
    long SizeBytes);

public sealed record ProctoringReadGrant(string Url, DateTime ExpiresAt);

/// <summary>
/// Private media boundary. The browser receives only a short-lived, exact-key
/// POST grant; only the server can read and seal objects for inference.
/// </summary>
public interface IProctoringEvidenceStore
{
    Task<ProctoringUploadGrant> CreateUploadGrantAsync(string stagingKey,
        string contentType, int maximumBytes, DateTime expiresAt, CancellationToken ct);

    Task<ProctoringSealedObject> SealAsync(string stagingKey,
        string sealedKeyPrefix, string contentType, int maximumBytes,
        CancellationToken ct);

    Task<ProctoringReadGrant> CreateReadGrantAsync(string sealedKey,
        string contentType, DateTime expiresAt, CancellationToken ct);

    Task DeleteAsync(string key, CancellationToken ct);
}
