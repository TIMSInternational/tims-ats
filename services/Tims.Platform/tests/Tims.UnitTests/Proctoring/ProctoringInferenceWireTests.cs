using System.Text.Json;
using Tims.Api.Proctoring;
using Tims.Application.Proctoring;

namespace Tims.UnitTests.Proctoring;

public sealed class ProctoringInferenceWireTests
{
    private static readonly Guid OrganizationId = Guid.Parse("00000000-0000-4000-8000-000000000002");
    private static readonly Guid SessionId = Guid.Parse("00000000-0000-4000-8000-000000000003");
    private static readonly Guid EvidenceId = Guid.Parse("00000000-0000-4000-8000-000000000001");
    private const string Sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private static readonly string Key = $"sealed/{OrganizationId:D}/{SessionId:D}/{EvidenceId:D}/{Sha}.jpg";
    private static readonly string AttemptKey = $"sealed/{OrganizationId:D}/{SessionId:D}/{EvidenceId:D}/{Sha}-0123456789abcdef0123456789abcdef.jpg";

    private static ProctoringOutboxClaim Claim(string? key = null, string mediaType = "camera") =>
        new(Guid.NewGuid(), OrganizationId, EvidenceId, key ?? Key, Sha, mediaType,
            "proctoring-v1", new DateTime(2026, 10, 1, 10, 0, 0, DateTimeKind.Utc), 1);

    private const string ValidResult = """
        {"schemaVersion":1,"organizationId":"00000000-0000-4000-8000-000000000002","evidenceId":"00000000-0000-4000-8000-000000000001","sha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","modelRevision":"proctoring-v1","status":"completed","detectors":[{"name":"rekognition_detect_faces","revision":"aws-rekognition-detect-faces-v1","status":"completed","findings":[{"label":"face_count","confidence":null,"count":1}],"failureCode":null},{"name":"hf_object_detector","revision":"hustvl-yolos-tiny-da86128da961944dd8e33bb7c1baea46ed0a4753","status":"unavailable","findings":[],"failureCode":"disabled"}],"processedAt":"2026-09-24T10:01:00.000Z"}
        """;

    [Fact]
    public void Request_encoding_matches_python_v1_and_binds_sealed_key()
    {
        var encoded = ProctoringInferenceWire.EncodeRequest(Claim());
        Assert.True(System.Text.Encoding.UTF8.GetByteCount(encoded) <= ProctoringInferenceWire.MaxRequestBytes);
        using var doc = JsonDocument.Parse(encoded);
        var root = doc.RootElement;
        Assert.Equal(8, root.EnumerateObject().Count());
        Assert.Equal(1, root.GetProperty("schemaVersion").GetInt32());
        Assert.Equal(OrganizationId.ToString("D"), root.GetProperty("organizationId").GetString());
        Assert.Equal(EvidenceId.ToString("D"), root.GetProperty("evidenceId").GetString());
        Assert.Equal(Key, root.GetProperty("objectKey").GetString());
        Assert.Equal(Sha, root.GetProperty("sha256").GetString());
        Assert.Equal("camera", root.GetProperty("mediaType").GetString());
        Assert.Equal("proctoring-v1", root.GetProperty("modelRevision").GetString());
        Assert.Equal("2026-10-01T10:00:00.000Z", root.GetProperty("expiresAt").GetString());
    }

    [Fact]
    public void Request_rejects_other_tenant_key_and_screen_media()
    {
        Assert.Throws<ProctoringWireException>(() =>
            ProctoringInferenceWire.EncodeRequest(Claim(Key.Replace(OrganizationId.ToString("D"),
                Guid.NewGuid().ToString("D"), StringComparison.Ordinal))));
        Assert.Throws<ProctoringWireException>(() =>
            ProctoringInferenceWire.EncodeRequest(Claim(mediaType: "screen")));
    }

    [Fact]
    public void Request_accepts_unique_attempt_key_but_rejects_malformed_suffix()
    {
        Assert.Equal(AttemptKey, JsonDocument.Parse(
            ProctoringInferenceWire.EncodeRequest(Claim(AttemptKey)))
            .RootElement.GetProperty("objectKey").GetString());
        Assert.Throws<ProctoringWireException>(() =>
            ProctoringInferenceWire.EncodeRequest(Claim(AttemptKey.Replace(
                "-0123456789abcdef0123456789abcdef", "-XYZ", StringComparison.Ordinal))));
        Assert.Throws<ProctoringWireException>(() =>
            ProctoringInferenceWire.EncodeRequest(Claim(AttemptKey.Replace(
                "-0123456789abcdef0123456789abcdef", "-", StringComparison.Ordinal))));
    }

    [Fact]
    public void Result_decodes_valid_face_count_and_unavailable_hf_without_inventing_confidence()
    {
        var result = ProctoringInferenceWire.DecodeResult(ValidResult);
        Assert.Equal(OrganizationId, result.OrganizationId);
        Assert.Equal(EvidenceId, result.EvidenceId);
        Assert.Equal("completed", result.Status);
        var face = Assert.Single(result.Detectors.Single(d => d.Name == "rekognition_detect_faces").Findings);
        Assert.Equal("face_count", face.Label);
        Assert.Equal(1, face.Count);
        Assert.Null(face.Confidence);
        Assert.Equal("unavailable", result.Detectors.Single(d => d.Name == "hf_object_detector").Status);
        Assert.Equal(DateTimeKind.Utc, result.ProcessedAt.Kind);
    }

    [Theory]
    [InlineData("\"schemaVersion\":1,", "\"schemaVersion\":1,\"schemaVersion\":1,")]
    [InlineData("\"name\":\"rekognition_detect_faces\",", "\"name\":\"rekognition_detect_faces\",\"name\":\"rekognition_detect_faces\",")]
    [InlineData("\"label\":\"face_count\"", "\"label\":\"emotion\"")]
    [InlineData("\"failureCode\":\"disabled\"", "\"failureCode\":\"unknown\"")]
    [InlineData("\"count\":1", "\"count\":101")]
    [InlineData("\"processedAt\":\"2026-09-24T10:01:00.000Z\"", "\"processedAt\":\"2026-09-24T10:01:00-05:00\"")]
    public void Result_rejects_duplicate_or_invalid_fields(string original, string replacement)
    {
        var tampered = ValidResult.Replace(original, replacement, StringComparison.Ordinal);
        Assert.NotEqual(ValidResult, tampered);
        Assert.Throws<ProctoringWireException>(() => ProctoringInferenceWire.DecodeResult(tampered));
    }

    [Fact]
    public void Result_rejects_extra_field_status_inconsistency_and_oversize()
    {
        Assert.Throws<ProctoringWireException>(() => ProctoringInferenceWire.DecodeResult(
            ValidResult.Replace("\"processedAt\":", "\"candidateEmail\":\"pii@example.test\",\"processedAt\":", StringComparison.Ordinal)));
        Assert.Throws<ProctoringWireException>(() => ProctoringInferenceWire.DecodeResult(
            ValidResult.Replace("\"modelRevision\":\"proctoring-v1\",\"status\":\"completed\"",
                "\"modelRevision\":\"proctoring-v1\",\"status\":\"unavailable\"", StringComparison.Ordinal)));
        Assert.Throws<ProctoringWireException>(() => ProctoringInferenceWire.DecodeResult(
            ValidResult + new string(' ', ProctoringInferenceWire.MaxResultBytes)));
        Assert.Throws<ProctoringWireException>(() => ProctoringInferenceWire.DecodeResult(
            ValidResult.Replace("aws-rekognition-detect-faces-v1",
                "unreviewed-detector-v1", StringComparison.Ordinal)));
    }
}
