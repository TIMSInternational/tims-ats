using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Tims.Application.Proctoring;

namespace Tims.Api.Proctoring;

/// <summary>Strict v1 SQS contract shared with services/proctoring-inference/contract.py.</summary>
public static partial class ProctoringInferenceWire
{
    public const int MaxRequestBytes = 4096;
    public const int MaxResultBytes = 8192;
    private const string RekognitionRevision = "aws-rekognition-detect-faces-v1";
    private const string HfRevision = "hustvl-yolos-tiny-da86128da961944dd8e33bb7c1baea46ed0a4753";
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private static readonly JsonDocumentOptions JsonOptions = new() { MaxDepth = 8 };
    private static readonly HashSet<string> FailureCodes = new(StringComparer.Ordinal)
    {
        "disabled", "expired", "revision_mismatch", "source_unavailable", "source_invalid",
        "source_checksum_mismatch", "rekognition_unavailable", "artifact_missing",
        "artifact_checksum_mismatch", "model_load_failed", "model_inference_failed",
    };

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex ShaPattern();
    [GeneratedRegex("^[0-9a-f]{32}$", RegexOptions.CultureInvariant)]
    private static partial Regex SealAttemptPattern();
    [GeneratedRegex("^[A-Za-z0-9._:+-]{1,120}$", RegexOptions.CultureInvariant)]
    private static partial Regex RevisionPattern();
    [GeneratedRegex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,7})?(Z|\\+00:00)$", RegexOptions.CultureInvariant)]
    private static partial Regex UtcPattern();

    public static string EncodeRequest(ProctoringOutboxClaim claim)
    {
        if (claim.OrganizationId == Guid.Empty || claim.EvidenceId == Guid.Empty
            || claim.MediaType != "camera" || !IsSha(claim.Sha256)
            || !IsRevision(claim.ModelRevision)
            || !ValidSealedKey(claim.ObjectKey, claim.OrganizationId,
                claim.EvidenceId, claim.Sha256)
            || claim.ExpiresAt == default)
            throw new ProctoringWireException("invalid_outbox_claim");

        using var stream = new MemoryStream(capacity: 512);
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteNumber("schemaVersion", 1);
            writer.WriteString("organizationId", Canonical(claim.OrganizationId));
            writer.WriteString("evidenceId", Canonical(claim.EvidenceId));
            writer.WriteString("objectKey", claim.ObjectKey);
            writer.WriteString("sha256", claim.Sha256);
            writer.WriteString("mediaType", "camera");
            writer.WriteString("modelRevision", claim.ModelRevision);
            writer.WriteString("expiresAt", UtcText(claim.ExpiresAt));
            writer.WriteEndObject();
        }
        if (stream.Length > MaxRequestBytes)
            throw new ProctoringWireException("request_too_large");
        return StrictUtf8.GetString(stream.ToArray());
    }

    public static ProctoringInferenceResult DecodeResult(string? body)
    {
        if (body is null) throw new ProctoringWireException("invalid_result");
        byte[] utf8;
        try { utf8 = StrictUtf8.GetBytes(body); }
        catch (EncoderFallbackException) { throw new ProctoringWireException("invalid_utf8"); }
        if (utf8.Length > MaxResultBytes) throw new ProctoringWireException("result_too_large");
        JsonDocument document;
        try { document = JsonDocument.Parse(utf8, JsonOptions); }
        catch (JsonException) { throw new ProctoringWireException("invalid_json"); }
        using (document)
        {
            var root = document.RootElement;
            RequireFields(root, "schemaVersion", "organizationId", "evidenceId", "sha256",
                "modelRevision", "status", "detectors", "processedAt");
            var schemaElement = root.GetProperty("schemaVersion");
            if (schemaElement.ValueKind != JsonValueKind.Number
                || !schemaElement.TryGetInt32(out var schemaVersion)
                || schemaVersion != 1)
                throw new ProctoringWireException("invalid_schema_version");
            var organizationId = ReadGuid(root.GetProperty("organizationId"));
            var evidenceId = ReadGuid(root.GetProperty("evidenceId"));
            var sha = ReadString(root.GetProperty("sha256"));
            var revision = ReadString(root.GetProperty("modelRevision"));
            var status = ReadString(root.GetProperty("status"));
            if (!IsSha(sha) || !IsRevision(revision)
                || status is not ("completed" or "unavailable"))
                throw new ProctoringWireException("invalid_result_fields");
            var detectorsElement = root.GetProperty("detectors");
            if (detectorsElement.ValueKind != JsonValueKind.Array
                || detectorsElement.GetArrayLength() != 2)
                throw new ProctoringWireException("invalid_detector_set");
            var detectors = new List<ProctoringDetectorResult>(2);
            foreach (var element in detectorsElement.EnumerateArray())
                detectors.Add(ReadDetector(element));
            if (detectors.Select(x => x.Name).Distinct(StringComparer.Ordinal).Count() != 2
                || !detectors.Any(x => x.Name == "rekognition_detect_faces")
                || !detectors.Any(x => x.Name == "hf_object_detector"))
                throw new ProctoringWireException("invalid_detector_set");
            var rekognition = detectors.Single(x => x.Name == "rekognition_detect_faces");
            if ((status == "completed") != (rekognition.Status == "completed"))
                throw new ProctoringWireException("invalid_overall_status");
            return new ProctoringInferenceResult(schemaVersion, organizationId,
                evidenceId, sha, revision, status, detectors,
                ReadUtc(root.GetProperty("processedAt")));
        }
    }

    private static ProctoringDetectorResult ReadDetector(JsonElement element)
    {
        RequireFields(element, "name", "revision", "status", "findings", "failureCode");
        var name = ReadString(element.GetProperty("name"));
        var revision = ReadString(element.GetProperty("revision"));
        var status = ReadString(element.GetProperty("status"));
        if (name is not ("rekognition_detect_faces" or "hf_object_detector")
            || (name == "rekognition_detect_faces" && revision != RekognitionRevision)
            || (name == "hf_object_detector" && revision != HfRevision)
            || status is not ("completed" or "unavailable"))
            throw new ProctoringWireException("invalid_detector");
        var failureElement = element.GetProperty("failureCode");
        var failureCode = failureElement.ValueKind == JsonValueKind.Null
            ? null : ReadString(failureElement);
        if ((status == "completed" && failureCode is not null)
            || (status == "unavailable" && (failureCode is null || !FailureCodes.Contains(failureCode))))
            throw new ProctoringWireException("invalid_detector_failure");
        var findingsElement = element.GetProperty("findings");
        if (findingsElement.ValueKind != JsonValueKind.Array
            || findingsElement.GetArrayLength() > 8
            || (status == "unavailable" && findingsElement.GetArrayLength() != 0))
            throw new ProctoringWireException("invalid_findings");
        var findings = new List<ProctoringDetectorFinding>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in findingsElement.EnumerateArray())
        {
            RequireFields(item, "label", "confidence", "count");
            var label = ReadString(item.GetProperty("label"));
            if (!seen.Add(label) || !AllowedLabel(name, label))
                throw new ProctoringWireException("invalid_finding_label");
            var countElement = item.GetProperty("count");
            if (countElement.ValueKind != JsonValueKind.Number
                || !countElement.TryGetInt32(out var count) || count is < 0 or > 100)
                throw new ProctoringWireException("invalid_finding_count");
            var confidenceElement = item.GetProperty("confidence");
            double? confidence = confidenceElement.ValueKind == JsonValueKind.Null
                ? null : ReadConfidence(confidenceElement);
            if ((name == "rekognition_detect_faces" && confidence is not null)
                || (name == "hf_object_detector" && (confidence is null || count == 0)))
                throw new ProctoringWireException("invalid_finding_confidence");
            findings.Add(new ProctoringDetectorFinding(label, confidence, count));
        }
        if (name == "rekognition_detect_faces" && status == "completed"
            && (findings.Count != 1 || findings[0].Label != "face_count"))
            throw new ProctoringWireException("invalid_face_count");
        return new ProctoringDetectorResult(name, revision, status, findings, failureCode);
    }

    private static bool AllowedLabel(string detector, string label) => detector switch
    {
        "rekognition_detect_faces" => label == "face_count",
        "hf_object_detector" => label is "person" or "cell_phone",
        _ => false,
    };

    private static double ReadConfidence(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Number || !element.TryGetDouble(out var value)
            || !double.IsFinite(value) || value is < 0 or > 1)
            throw new ProctoringWireException("invalid_confidence");
        return value;
    }

    private static DateTime ReadUtc(JsonElement element)
    {
        var value = ReadString(element);
        if (value.Length > 40 || !UtcPattern().IsMatch(value)
            || !DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var parsed) || parsed.Offset != TimeSpan.Zero)
            throw new ProctoringWireException("invalid_utc_time");
        return parsed.UtcDateTime;
    }

    private static string UtcText(DateTime value) =>
        DateTime.SpecifyKind(value, DateTimeKind.Utc).ToString(
            "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static Guid ReadGuid(JsonElement element)
    {
        var value = ReadString(element);
        if (!Guid.TryParseExact(value, "D", out var id)
            || id == Guid.Empty || value != Canonical(id))
            throw new ProctoringWireException("invalid_guid");
        return id;
    }

    private static string Canonical(Guid id) => id.ToString("D");
    private static string ReadString(JsonElement element) =>
        element.ValueKind == JsonValueKind.String && element.GetString() is { } value
            ? value : throw new ProctoringWireException("invalid_string");
    private static bool IsSha(string value) => ShaPattern().IsMatch(value);
    private static bool IsRevision(string value) => RevisionPattern().IsMatch(value);

    private static bool ValidSealedKey(string key, Guid organizationId, Guid evidenceId, string sha)
    {
        if (key.Length > 512 || key.Contains("//", StringComparison.Ordinal)) return false;
        var parts = key.Split('/');
        if (parts.Length != 5) return false;
        var file = parts[4];
        var validFile = file == sha + ".jpg" || file == sha + ".webp";
        if (!validFile && (file.EndsWith(".jpg", StringComparison.Ordinal)
            || file.EndsWith(".webp", StringComparison.Ordinal)))
        {
            var extensionLength = file.EndsWith(".jpg", StringComparison.Ordinal) ? 4 : 5;
            var stem = file[..^extensionLength];
            validFile = stem.Length == sha.Length + 1 + 32
                && stem.StartsWith(sha + "-", StringComparison.Ordinal)
                && SealAttemptPattern().IsMatch(stem[(sha.Length + 1)..]);
        }
        return parts[0] == "sealed"
            && parts[1] == Canonical(organizationId)
            && Guid.TryParseExact(parts[2], "D", out var sessionId)
            && sessionId != Guid.Empty && parts[2] == Canonical(sessionId)
            && parts[3] == Canonical(evidenceId)
            && validFile;
    }

    private static void RequireFields(JsonElement element, params string[] expected)
    {
        if (element.ValueKind != JsonValueKind.Object)
            throw new ProctoringWireException("invalid_object");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            if (!expected.Contains(property.Name, StringComparer.Ordinal)
                || !seen.Add(property.Name))
                throw new ProctoringWireException("unexpected_or_duplicate_field");
        }
        if (seen.Count != expected.Length)
            throw new ProctoringWireException("missing_field");
    }
}

public sealed class ProctoringWireException(string code) : Exception(code)
{
    public string Code { get; } = code;
}
