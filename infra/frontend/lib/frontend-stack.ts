import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as appautoscaling from "aws-cdk-lib/aws-applicationautoscaling";

// ─── Environment configuration ───────────────────────────────────────────────
// All environment-specific values are passed via FrontendStackProps.
// Staging and production share the same VPC and ECR repo; everything else
// (ALB, cluster, secrets, scaling limits) is environment-specific.
export interface FrontendEnvironmentConfig {
  /** Used for resource naming and tagging throughout the stack. */
  envName: "staging" | "production";
  vpcId: string;
  albArn: string;
  albDnsName: string;
  albSgId: string;
  ecsClusterName: string;
  /** Full ARN including the 6-char random suffix, e.g. "…/kkmnow/staging/app-config-xNnjS6" */
  appConfigSecretArn: string;
  /** Initial desired task count (auto-scaling takes over after steady state). */
  desiredCount: number;
  minCapacity: number;
  maxCapacity: number;
}

export interface FrontendStackProps extends cdk.StackProps {
  config: FrontendEnvironmentConfig;
}

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { config } = props;
    const { envName } = config;

    // CloudFront cache policy names are account-global and immutable once created.
    // Strategy: keep existing staging names unchanged to avoid resource replacement,
    // use a "-prod" prefix only for production to guarantee uniqueness.
    const policyPrefix = envName === "staging" ? "kkmnow-frontend" : "kkmnow-frontend-prod";

    // ─── Import existing resources ────────────────────────────────────────
    const vpc = ec2.Vpc.fromLookup(this, "Vpc", { vpcId: config.vpcId });

    const alb = elbv2.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(this, "Alb", {
      loadBalancerArn: config.albArn,
      securityGroupId: config.albSgId,
      loadBalancerDnsName: config.albDnsName,
    });

    const albSg = ec2.SecurityGroup.fromSecurityGroupId(this, "AlbSg", config.albSgId);

    const cluster = ecs.Cluster.fromClusterAttributes(this, "Cluster", {
      clusterName: config.ecsClusterName,
      vpc,
      securityGroups: [],
    });

    const appConfigSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "AppConfigSecret",
      config.appConfigSecretArn
    );

    // ─── ECR Repository (shared across environments — import by name) ────
    const repo = ecr.Repository.fromRepositoryName(this, "FrontendRepo", "kkmnow-frontend");

    // ─── Security Group for frontend ECS tasks ───────────────────────────
    // NOTE: GroupDescription is immutable on AWS — changing it forces SG replacement.
    // Keep the original description to avoid replacing the existing staging SG.
    const frontendSg = new ec2.SecurityGroup(this, "SgFrontend", {
      vpc,
      description: "Frontend ECS tasks - allow port 3000 from ALB",
      allowAllOutbound: true,
    });
    frontendSg.addIngressRule(albSg, ec2.Port.tcp(3000), "Allow ALB to frontend on port 3000");

    // ─── ALB: Allow inbound on port 3000 (for CloudFront origin) ─────────
    // CloudFront connects to ALB on port 3000 via custom origin port.
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3000), "Allow CloudFront to ALB on 3000");

    // ─── ALB Listener on port 3000 → Frontend Target Group ───────────────
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "FrontendTg", {
      targetGroupName: `kkmnow-frontend-${envName}`,
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/api/health",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: "200",
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    const listener = new elbv2.ApplicationListener(this, "FrontendListener", {
      loadBalancer: alb,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // ─── CloudWatch Logs ─────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, "FrontendLogs", {
      logGroupName: `/ecs/kkmnow-frontend-${envName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── IAM Roles ───────────────────────────────────────────────────────
    const executionRole = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
      ],
    });
    appConfigSecret.grantRead(executionRole);

    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    // Task role: allow reading secrets at runtime (for on-demand secret access)
    appConfigSecret.grantRead(taskRole);

    // ─── ECS Task Definition ─────────────────────────────────────────────
    // 1 vCPU + 2 GB — doubles per-task capacity for Node.js single-threaded workload.
    // Image tag convention: "staging" branch pushes :staging, "main" branch pushes :main.
    // Using the env-named tag ensures each environment only picks up its own build.
    const imageTag = envName === "staging" ? "staging" : "main";

    const taskDef = new ecs.FargateTaskDefinition(this, "FrontendTask", {
      family: `kkmnow-frontend-${envName}`,
      cpu: 1024,
      memoryLimitMiB: 2048,
      executionRole,
      taskRole,
    });

    const container = taskDef.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromEcrRepository(repo, imageTag),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "frontend",
        logGroup,
      }),
      environment: {
        NODE_ENV: "production",
        PORT: "3000",
        HOSTNAME: "0.0.0.0",
      },
      secrets: {
        REVALIDATE_TOKEN: ecs.Secret.fromSecretsManager(appConfigSecret, "REVALIDATE_TOKEN"),
        AUTH_TOKEN: ecs.Secret.fromSecretsManager(appConfigSecret, "AUTH_TOKEN_SECRET"),
        ROLLING_TOKEN: ecs.Secret.fromSecretsManager(appConfigSecret, "ROLLING_TOKEN"),
      },
      healthCheck: {
        command: ["CMD-SHELL", "wget -qO- http://localhost:3000/api/health || exit 1"],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(120),
      },
    });

    container.addPortMappings({ containerPort: 3000, protocol: ecs.Protocol.TCP });

    // ─── ECS Service ─────────────────────────────────────────────────────
    const service = new ecs.FargateService(this, "FrontendService", {
      serviceName: `kkmnow-frontend-${envName}`,
      cluster,
      taskDefinition: taskDef,
      desiredCount: config.desiredCount,
      securityGroups: [frontendSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    service.attachToApplicationTargetGroup(targetGroup);

    // ─── Auto-Scaling ────────────────────────────────────────────────────
    const scaling = service.autoScaleTaskCount({
      minCapacity: config.minCapacity,
      maxCapacity: config.maxCapacity,
    });

    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scaling.scaleOnRequestCount("RequestScaling", {
      targetGroup,
      requestsPerTarget: 300,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // ─── CloudFront Distribution ─────────────────────────────────────────
    const albOrigin = new origins.HttpOrigin(config.albDnsName, {
      httpPort: 3000,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      connectionAttempts: 3,
      connectionTimeout: cdk.Duration.seconds(10),
    });

    const distribution = new cloudfront.Distribution(this, "FrontendCdn", {
      comment: `KKMNow Frontend (${envName})`,
      defaultBehavior: {
        origin: albOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: new cloudfront.CachePolicy(this, "DefaultCachePolicy", {
          cachePolicyName: `${policyPrefix}-default`,
          comment: "ISR/SSR pages - respect origin Cache-Control headers",
          defaultTtl: cdk.Duration.seconds(0),
          minTtl: cdk.Duration.seconds(0),
          maxTtl: cdk.Duration.days(1),
          headerBehavior: cloudfront.CacheHeaderBehavior.allowList("Accept-Language"),
          queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
          cookieBehavior: cloudfront.CacheCookieBehavior.none(),
          enableAcceptEncodingGzip: true,
          enableAcceptEncodingBrotli: true,
        }),
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      },
      additionalBehaviors: {
        // Static assets — immutable, content-hashed, cache forever
        "/_next/static/*": {
          origin: albOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
        // Public static files
        "/static/*": {
          origin: albOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: new cloudfront.CachePolicy(this, "StaticCachePolicy", {
            cachePolicyName: `${policyPrefix}-static`,
            comment: "Public static files - 24h cache",
            defaultTtl: cdk.Duration.hours(24),
            minTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.days(7),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
          }),
          compress: true,
        },
        // Data catalogue — SSR, short default TTL to absorb traffic spikes
        "/data-catalogue*": {
          origin: albOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: new cloudfront.CachePolicy(this, "SsrCachePolicy", {
            cachePolicyName: `${policyPrefix}-ssr`,
            comment: "SSR pages - 60s default TTL to absorb traffic spikes, origin can override",
            defaultTtl: cdk.Duration.seconds(60),
            minTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.hours(6),
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList("Accept-Language"),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
          }),
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    // ─── Outputs ─────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "EcrRepoUri", {
      value: repo.repositoryUri,
      exportName: `kkmnow-${envName}-frontend-ecr-uri`,
    });

    new cdk.CfnOutput(this, "ServiceName", {
      value: service.serviceName,
      exportName: `kkmnow-${envName}-frontend-service-name`,
    });

    new cdk.CfnOutput(this, "CloudFrontDomain", {
      value: distribution.distributionDomainName,
      description: "CloudFront distribution domain — use this as HEALTH_CHECK_URL in GitLab CI",
      exportName: `kkmnow-${envName}-frontend-cf-domain`,
    });

    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
      description: "CloudFront distribution ID — use this as CF_DISTRIBUTION_ID in GitLab CI",
      exportName: `kkmnow-${envName}-frontend-cf-id`,
    });

    new cdk.CfnOutput(this, "TargetGroupArn", {
      value: targetGroup.targetGroupArn,
      exportName: `kkmnow-${envName}-frontend-tg-arn`,
    });
  }
}
