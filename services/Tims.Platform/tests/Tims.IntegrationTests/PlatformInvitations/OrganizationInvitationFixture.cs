using Npgsql;
using Tims.IntegrationTests.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformInvitations;

[CollectionDefinition("OrganizationInvitationCreate")]
public sealed class OrganizationInvitationCollection : ICollectionFixture<OrganizationInvitationFixture>;

public sealed class OrganizationInvitationFixture : IAsyncLifetime
{
    public PlatformOrganizationsCreateFixture Organizations { get; } = new();
    public string ConnectionString => Organizations.ConnectionString;
    public async Task InitializeAsync()
    {
        await Organizations.InitializeAsync();
        foreach (var connectionString in new[] { ConnectionString, Organizations.MissingAuditTableConnectionString })
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = Schema;
            await command.ExecuteNonQueryAsync();
        }
    }
    public Task DisposeAsync() => Organizations.DisposeAsync();
    private const string Schema = """
        CREATE TYPE public."InvitationType" AS ENUM ('org_admin', 'user');
        CREATE TYPE public."InvitationStatus" AS ENUM ('pending', 'sent', 'accepted', 'expired', 'revoked');

        CREATE TABLE platform_invitations (
            id uuid PRIMARY KEY,
            email text NOT NULL,
            type public."InvitationType" NOT NULL,
            organization_id uuid NULL REFERENCES organizations (id),
            organization_name text NULL,
            organization_slug text NULL,
            organization_plan text NULL,
            role_slug text NULL,
            token text NOT NULL UNIQUE,
            status public."InvitationStatus" DEFAULT 'pending'::public."InvitationStatus" NOT NULL,
            invited_by_id uuid NOT NULL REFERENCES users (id),
            sent_at timestamp(3) without time zone NULL,
            accepted_at timestamp(3) without time zone NULL,
            expires_at timestamp(3) without time zone NOT NULL,
            created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
            updated_at timestamp(3) without time zone NOT NULL
        );
        GRANT SELECT, INSERT, UPDATE ON platform_invitations TO app_tenant;
        ALTER TABLE platform_invitations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE platform_invitations FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON platform_invitations
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        """;
}
