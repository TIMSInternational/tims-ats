# Phase 4 Slice 1 — container image for Tims.Workers (the single-replica scheduler host).
# Multi-stage: SDK builds/publishes, aspnet runs. Build context = services/Tims.Platform
# (so the project graph + lockfiles are present).
#   docker build -f src/Tims.Workers/Dockerfile -t tims-platform-workers .
#
# Deploy topology: replica = 1 (a recurring job must fire exactly once, not once per replica) — ECS Fargate,
# see docs/runbooks/workers-deploy.md and scripts/deploy/create-workers-service.sh.
# The worker emits no OpenAPI, so there are no OpenAPI build flags.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first (better layer caching): copy the project graph Tims.Workers needs.
COPY Directory.Build.props ./
COPY src/Tims.Workers/ src/Tims.Workers/
COPY src/Tims.Application/ src/Tims.Application/
COPY src/Tims.Domain/ src/Tims.Domain/
COPY src/Tims.Infrastructure/ src/Tims.Infrastructure/

RUN dotnet restore src/Tims.Workers/Tims.Workers.csproj
RUN dotnet publish src/Tims.Workers/Tims.Workers.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish ./

# Non-root runtime user (the aspnet image ships an `app` user).
USER app
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
# Liveness for `docker run` / local compose. The ECS task definition declares the SAME command itself
# (ECS ignores an image HEALTHCHECK): the aspnet image has no curl/wget, so the binary probes its own
# loopback /health and exits 0/1 (ContainerHealthProbe). /health runs no DB check by design.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["dotnet", "Tims.Workers.dll", "--healthcheck"]
ENTRYPOINT ["dotnet", "Tims.Workers.dll"]
