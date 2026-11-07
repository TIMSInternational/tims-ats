using Tims.Application.PlatformInvitations;
using Tims.Domain.Identity;

namespace Tims.UnitTests.Identity;

public sealed class RoleLabelsTests
{
    [Theory]
    [InlineData("super_admin", "Super Administrador", "Super Administrator")]
    [InlineData("hr_admin", "Administrador de RR. HH.", "HR Administrator")]
    [InlineData("hrbp", "Socio de negocio de RR. HH. (HRBP)", "HR Business Partner (HRBP)")]
    [InlineData("recruiter", "Reclutador", "Recruiter")]
    [InlineData("leader", "Líder", "Leader")]
    [InlineData("committee", "Comité de entrevista", "Interview committee")]
    [InlineData("employee", "Colaborador", "Employee")]
    public void Every_staff_role_has_a_spanish_and_english_label(string slug, string es, string en)
    {
        Assert.Equal(es, RoleLabels.For(slug));
        Assert.Equal(es, RoleLabels.For(slug, "es"));
        Assert.Equal(en, RoleLabels.For(slug, "en"));
    }

    [Fact]
    public void Covers_exactly_the_assignable_staff_roles()
    {
        foreach (var slug in RoleSlugs.AssignableStaffRoles)
            Assert.NotEqual(slug.Replace('_', ' '), RoleLabels.For(slug));
    }

    [Fact]
    public void Unknown_value_is_shown_without_underscores()
    {
        Assert.Equal("custom role", RoleLabels.For("custom_role"));
    }

    [Theory]
    [InlineData("es", "recruiter", "Reclutador")]
    [InlineData("es", "super_admin", "Super Administrador")]
    [InlineData("en", "committee", "Interview committee")]
    public void Invitation_email_prints_the_role_label_never_the_slug(string locale, string slug, string label)
    {
        var body = InvitationEmail.Render("Org", slug, "https://app.example.test/accept-invitation?token=t",
            new DateTime(2026, 11, 9), locale);
        // The access line of the card is `<br>{role}<br>`.
        Assert.Contains("<br>" + label + "<br>", body);
        Assert.DoesNotContain("<br>" + slug + "<br>", body);
        Assert.DoesNotContain("<br>" + slug.Replace('_', ' ') + "<br>", body);
    }
}
