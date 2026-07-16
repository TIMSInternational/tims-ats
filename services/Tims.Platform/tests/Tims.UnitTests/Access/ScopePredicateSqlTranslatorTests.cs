using Tims.Domain.Access;

namespace Tims.UnitTests.Access;

/// <summary>
/// WP2.5b: pure (DB-free) proof that <see cref="ScopePredicateSqlTranslator"/> lowers each
/// <see cref="ScopePredicate"/> node to the right parameterized SQL against the fixed
/// <see cref="ScopeProbeRegistry"/>. Every id/value must be a bound <c>@pN</c> parameter — never
/// interpolated — and identifiers must resolve from the registry (unknown field/table → throw).
/// </summary>
public sealed class ScopePredicateSqlTranslatorTests
{
    private static readonly Guid UserId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid TeamId = Guid.Parse("cccccccc-0000-0000-0000-000000000001");

    [Fact]
    public void FieldEquals_null_emits_IS_NULL_with_no_parameter()
    {
        var translated = ScopePredicateSqlTranslator.Translate(
            "vacancies", new ScopePredicate.FieldEquals("deletedAt", null));

        Assert.Equal("t.deleted_at IS NULL", translated.Sql);
        Assert.Empty(translated.Parameters);
    }

    [Fact]
    public void FieldEquals_value_binds_a_guid_parameter()
    {
        var translated = ScopePredicateSqlTranslator.Translate(
            "vacancies", new ScopePredicate.FieldEquals("assignedTo", UserId.ToString()));

        Assert.Equal("t.assigned_to = @p0", translated.Sql);
        Assert.Equal(new object[] { UserId }, translated.Parameters);
    }

    [Fact]
    public void FieldIn_binds_a_guid_array_via_ANY()
    {
        var translated = ScopePredicateSqlTranslator.Translate(
            "teams", new ScopePredicate.FieldIn("id", new[] { TeamId.ToString() }));

        Assert.Equal("t.id = ANY(@p0)", translated.Sql);
        var array = Assert.IsType<Guid[]>(Assert.Single(translated.Parameters));
        Assert.Equal(new[] { TeamId }, array);
    }

    [Fact]
    public void FieldIn_empty_still_binds_an_empty_array_matching_nothing()
    {
        var translated = ScopePredicateSqlTranslator.Translate(
            "teams", new ScopePredicate.FieldIn("id", Array.Empty<string>()));

        Assert.Equal("t.id = ANY(@p0)", translated.Sql);
        var array = Assert.IsType<Guid[]>(Assert.Single(translated.Parameters));
        Assert.Empty(array);
    }

    [Fact]
    public void Empty_Or_is_FALSE_and_empty_And_is_TRUE()
    {
        Assert.Equal("FALSE", ScopePredicateSqlTranslator
            .Translate("vacancies", new ScopePredicate.Or(Array.Empty<ScopePredicate>())).Sql);
        Assert.Equal("TRUE", ScopePredicateSqlTranslator
            .Translate("vacancies", new ScopePredicate.And(Array.Empty<ScopePredicate>())).Sql);
    }

    [Fact]
    public void MatchAll_is_TRUE_org_scope()
    {
        Assert.Equal("TRUE", ScopePredicateSqlTranslator.Translate("vacancies", ScopePredicate.MatchAll).Sql);
    }

    [Fact]
    public void Vacancy_team_fragment_emits_OR_of_ANY_and_scalar()
    {
        // scopeWhereFor(vacancy, team) → OR[ teamId in ledTeams, assignedTo = userId ]
        var predicate = new ScopePredicate.Or(new ScopePredicate[]
        {
            new ScopePredicate.FieldIn("teamId", new[] { TeamId.ToString() }),
            new ScopePredicate.FieldEquals("assignedTo", UserId.ToString()),
        });

        var translated = ScopePredicateSqlTranslator.Translate("vacancies", predicate);

        Assert.Equal("(t.team_id = ANY(@p0) OR t.assigned_to = @p1)", translated.Sql);
        Assert.Equal(new object[] { new[] { TeamId }, UserId }, translated.Parameters);
    }

    [Fact]
    public void Candidate_via_applications_to_vacancy_nests_two_EXISTS()
    {
        // scopeWhereFor(candidate, team) → applications.some( vacancy.to( AND[ vacancyFragment, deletedAt=null ] ) )
        var predicate = new ScopePredicate.RelationSome(
            "applications",
            new ScopePredicate.RelationTo(
                "vacancy",
                new ScopePredicate.And(new ScopePredicate[]
                {
                    new ScopePredicate.Or(new ScopePredicate[]
                    {
                        new ScopePredicate.FieldIn("teamId", new[] { TeamId.ToString() }),
                        new ScopePredicate.FieldEquals("assignedTo", UserId.ToString()),
                    }),
                    new ScopePredicate.FieldEquals("deletedAt", null),
                })));

        var translated = ScopePredicateSqlTranslator.Translate("candidates", predicate);

        Assert.Equal(
            "EXISTS (SELECT 1 FROM applications c0 WHERE c0.candidate_id = t.id AND "
            + "EXISTS (SELECT 1 FROM vacancies r1 WHERE r1.id = c0.vacancy_id AND "
            + "((r1.team_id = ANY(@p0) OR r1.assigned_to = @p1) AND r1.deleted_at IS NULL)))",
            translated.Sql);
        Assert.Equal(new object[] { new[] { TeamId }, UserId }, translated.Parameters);
    }

    [Fact]
    public void Interview_evaluators_some_uses_child_fk_back_to_parent_id()
    {
        var predicate = new ScopePredicate.RelationSome(
            "evaluators", new ScopePredicate.FieldEquals("userId", UserId.ToString()));

        var translated = ScopePredicateSqlTranslator.Translate("interviews", predicate);

        Assert.Equal(
            "EXISTS (SELECT 1 FROM interview_evaluators c0 WHERE c0.interview_id = t.id AND c0.user_id = @p0)",
            translated.Sql);
        Assert.Equal(new object[] { UserId }, translated.Parameters);
    }

    [Fact]
    public void Unknown_field_throws_a_clear_error()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            ScopePredicateSqlTranslator.Translate(
                "vacancies", new ScopePredicate.FieldEquals("notAColumn", UserId.ToString())));

        Assert.Contains("notAColumn", ex.Message);
    }
}
