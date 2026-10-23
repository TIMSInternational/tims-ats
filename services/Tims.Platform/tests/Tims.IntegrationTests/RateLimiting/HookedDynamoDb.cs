using System.Reflection;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace Tims.IntegrationTests.RateLimiting;

/// <summary>
/// Forwards every call to a real <see cref="IAmazonDynamoDB"/> (DynamoDB Local) but lets a test run code
/// just before each UpdateItem — a write by "another instance" landing between the store's read and its
/// conditional write — or replace a call outright (a hang, an error).
/// </summary>
public class HookedDynamoDb : DispatchProxy
{
    public IAmazonDynamoDB Inner { get; set; } = null!;

    /// <summary>Awaited before each UpdateItemAsync is forwarded.</summary>
    public Func<UpdateItemRequest, Task>? BeforeUpdate { get; set; }

    /// <summary>When set, replaces the named method entirely (args → result).</summary>
    public Func<MethodInfo, object?[]?, object?>? Override { get; set; }

    public int UpdateCalls { get; private set; }

    public static (IAmazonDynamoDB Client, HookedDynamoDb Hooks) Wrap(IAmazonDynamoDB inner)
    {
        var client = Create<IAmazonDynamoDB, HookedDynamoDb>();
        var hooks = (HookedDynamoDb)(object)client;
        hooks.Inner = inner;
        return (client, hooks);
    }

    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
    {
        if (Override is not null)
        {
            var replaced = Override(targetMethod!, args);
            if (replaced is not null) return replaced;
        }

        if (targetMethod!.Name == nameof(IAmazonDynamoDB.UpdateItemAsync) && args?[0] is UpdateItemRequest request)
        {
            UpdateCalls++;
            if (BeforeUpdate is not null) return ForwardAfterHook(request, (CancellationToken)args[1]!);
        }

        return targetMethod.Invoke(Inner, args);
    }

    private async Task<UpdateItemResponse> ForwardAfterHook(UpdateItemRequest request, CancellationToken token)
    {
        await BeforeUpdate!(request);
        return await Inner.UpdateItemAsync(request, token);
    }
}
