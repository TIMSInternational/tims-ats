using Tims.Application.Proctoring;

namespace Tims.UnitTests.Proctoring;

public sealed class CandidateExplanationUseCaseTests
{
    [Fact]
    public async Task Submission_is_bounded_and_trimmed_before_persistence()
    {
        var repository = new RecordingRepository();
        var useCase = new CandidateExplanationUseCase(repository);
        var org = Guid.NewGuid();
        var candidate = Guid.NewGuid();
        var assignment = Guid.NewGuid();
        var submission = Guid.NewGuid();

        foreach (var invalid in new string?[] { null, "", "   ", new('x', 2001), "NUL\0byte" })
        {
            var failure = await Assert.ThrowsAsync<ProctoringException>(() =>
                useCase.SubmitAsync(org, candidate, assignment, submission, invalid, default));
            Assert.Equal("explanation_invalid", failure.Code);
        }
        await Assert.ThrowsAsync<ProctoringException>(() =>
            useCase.SubmitAsync(org, candidate, assignment, Guid.Empty, "Valid", default));
        Assert.Null(repository.Text);

        await useCase.SubmitAsync(org, candidate, assignment, submission,
            "  I had a network problem.  ", default);
        Assert.Equal("I had a network problem.", repository.Text);
    }

    private sealed class RecordingRepository : ICandidateExplanationRepository
    {
        public string? Text { get; private set; }
        public Task<CandidateExplanationState> GetAsync(Guid organizationId,
            Guid candidateId, Guid assignmentId, CancellationToken ct) =>
            Task.FromResult(new CandidateExplanationState(null, false, null));

        public Task<CandidateExplanation> SubmitAsync(Guid organizationId,
            Guid candidateId, Guid assignmentId, Guid submissionId, string text,
            CancellationToken ct)
        {
            Text = text;
            var now = DateTime.UtcNow;
            return Task.FromResult(new CandidateExplanation(Guid.NewGuid(), text,
                now, now.AddDays(7)));
        }
    }
}
