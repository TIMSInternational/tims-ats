using System.Globalization;
using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.OrgProvisioning;

/// <summary>Seeds the scoped access matrix in the caller's tenant transaction.
/// The embedded JSON is generated from packages/db/prisma/seed-access-matrix.ts and
/// a cross-runtime test prevents it from drifting from the TypeScript source.</summary>
public static class RoleAccessProvisioner
{
    private static readonly string RoleGrants = LoadRoleGrants();

    public static async Task ProvisionAsync(DbContext db, Guid organizationId, DateTime now, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Role provisioning requires a transaction");
        var timestamp = now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO roles(id,organization_id,name,slug,description,is_system,updated_at)
            SELECT gen_random_uuid(),{organizationId},item.value->>'name',item.value->>'slug',
                item.value->>'description',true,{timestamp}::timestamp
            FROM jsonb_array_elements({RoleGrants}::jsonb->'roles') AS item(value)
            ON CONFLICT(organization_id,slug) DO NOTHING
            """, ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO permissions(id,module,action,description)
            SELECT gen_random_uuid(),code.module,code.action,code.module || '.' || code.action
            FROM (SELECT DISTINCT g.value->>'module' AS module,g.value->>'action' AS action
                FROM jsonb_array_elements({RoleGrants}::jsonb->'roles') AS item(value)
                CROSS JOIN LATERAL jsonb_array_elements(item.value->'grants') AS g(value)) AS code
            ON CONFLICT(module,action) DO NOTHING
            """, ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO role_permissions(id,role_id,permission_id,scope)
            SELECT gen_random_uuid(),r.id,p.id,g.value->>'scope'
            FROM jsonb_array_elements({RoleGrants}::jsonb->'roles') AS item(value)
            CROSS JOIN LATERAL jsonb_array_elements(item.value->'grants') AS g(value)
            JOIN roles r ON r.organization_id={organizationId} AND r.slug=item.value->>'slug'
            JOIN permissions p ON p.module=g.value->>'module' AND p.action=g.value->>'action'
            ON CONFLICT(role_id,permission_id) DO NOTHING
            """, ct);
    }

    private static string LoadRoleGrants()
    {
        using var stream = typeof(RoleAccessProvisioner).Assembly.GetManifestResourceStream(
            "Tims.Infrastructure.OrgProvisioning.role-grants.json")
            ?? throw new InvalidOperationException("Embedded role-grants.json missing");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
