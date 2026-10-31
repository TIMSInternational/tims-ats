using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Amazon.Runtime;
using Testcontainers.DynamoDb;
using Tims.Infrastructure.RateLimiting;

namespace Tims.IntegrationTests.RateLimiting;

/// <summary>
/// Spins up one real DynamoDB Local container with the shared rate-limit table (pk String, same shape as
/// production) so the tests run the C# store against a real DynamoDB engine: the exact expression strings
/// both stacks send (contracts/ratelimit-fixtures/dynamodb.json) are parsed and evaluated by DynamoDB
/// itself, not by a fake. Items are inspected directly — the value a TS reader would also see.
/// </summary>
public sealed class DynamoDbRateLimitFixture : IAsyncLifetime
{
    public const string TableName = "tims-ats-ratelimit";

    private readonly DynamoDbContainer _container = new DynamoDbBuilder("amazon/dynamodb-local:3.3.1").Build();

    public IAmazonDynamoDB Client { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();

        // Setup uses a patient client: DynamoDB Local is a JVM, and its first requests can take well over
        // the production 1 s budget while the rest of the suite is starting containers. A slow setup call
        // must not fail every test in the collection; the tests themselves keep the production policy.
        using (var setup = new AmazonDynamoDBClient(
            new BasicAWSCredentials("local", "local"),
            new AmazonDynamoDBConfig
            {
                ServiceURL = _container.GetConnectionString(),
                AuthenticationRegion = "us-west-2",
                Timeout = TimeSpan.FromSeconds(30),
                MaxErrorRetry = 5,
            }))
        {
            await setup.CreateTableAsync(new CreateTableRequest
            {
                TableName = TableName,
                AttributeDefinitions = [new AttributeDefinition("pk", ScalarAttributeType.S)],
                KeySchema = [new KeySchemaElement("pk", KeyType.HASH)],
                BillingMode = BillingMode.PAY_PER_REQUEST,
            });

            // Warm the engine on the exact request shapes the store sends, so the first test is not the
            // one that pays for JIT compilation.
            var key = new Dictionary<string, AttributeValue> { ["pk"] = new() { S = "warmup" } };
            for (var i = 0; i < 20; i++)
            {
                await setup.GetItemAsync(new GetItemRequest { TableName = TableName, Key = key, ConsistentRead = true });
                await setup.UpdateItemAsync(new UpdateItemRequest
                {
                    TableName = TableName,
                    Key = key,
                    UpdateExpression = "ADD #c :one",
                    ConditionExpression = "attribute_not_exists(#c) OR #c < :max",
                    ExpressionAttributeNames = new Dictionary<string, string> { ["#c"] = "w0" },
                    ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                    {
                        [":one"] = new() { N = "1" },
                        [":max"] = new() { N = "1000" },
                    },
                });
            }

            await setup.DeleteItemAsync(new DeleteItemRequest { TableName = TableName, Key = key });
        }

        Client = CreateClient(_container.GetConnectionString());
    }

    /// <summary>A client for DynamoDB Local (any static credentials are accepted) with the production policy.</summary>
    public static IAmazonDynamoDB CreateClient(string serviceUrl) =>
        new AmazonDynamoDBClient(
            new BasicAWSCredentials("local", "local"),
            new AmazonDynamoDBConfig
            {
                ServiceURL = serviceUrl,
                AuthenticationRegion = "us-west-2",
                Timeout = TimeSpan.FromMilliseconds(DynamoDbRateLimitStore.TimeoutMs),
                MaxErrorRetry = 0,
            });

    public DynamoDbRateLimitStore StoreAt(long nowMs) => new(Client, TableName, () => nowMs);

    public DynamoDbRateLimitStore Store() => new(Client, TableName);

    public async Task<Dictionary<string, AttributeValue>?> ItemAsync(string partitionKey)
    {
        var response = await Client.GetItemAsync(new GetItemRequest
        {
            TableName = TableName,
            Key = new Dictionary<string, AttributeValue> { ["pk"] = new() { S = partitionKey } },
            ConsistentRead = true,
        });
        return response.Item is { Count: > 0 } item ? item : null;
    }

    public async Task PutItemAsync(Dictionary<string, AttributeValue> item) =>
        await Client.PutItemAsync(new PutItemRequest { TableName = TableName, Item = item });

    public async Task DisposeAsync()
    {
        Client?.Dispose();
        await _container.DisposeAsync();
    }
}
