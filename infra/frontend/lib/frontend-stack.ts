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

// ─── Existing resource IDs (from KkmnowNetwork + KkmnowStagingCompute stacks) ─
const EXISTING = {
  vpcId: "vpc-0605bf6e50eafcec9",
  albArn:
    "arn:aws:elasticloadbalancing:ap-southeast-5:624693141495:loadbalancer/app/kkmnow-staging-alb/72409aaffa96e94b",
  albSgId: "sg-0078f4022352a1317",
  ecsClusterName: "kkmnow-staging",
  appConfigSecretArn:
    "arn:aws:secretsmanager:ap-southeast-5:624693141495:secret:kkmnow/staging/app-config-xNnjS6",
};

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── Import existing resources ────────────────────────────────────────
    const vpc = ec2.Vpc.fromLookup(this, "Vpc", { vpcId: EXISTING.vpcId });

    const alb = elbv2.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(this, "Alb", {
      loadBalancerArn: EXISTING.albArn,
      securityGroupId: EXISTING.albSgId,
      loadBalancerDnsName: "kkmnow-staging-alb-1708157029.ap-southeast-5.elb.amazonaws.com",
    });

    const albSg = ec2.SecurityGroup.fromSecurityGroupId(this, "AlbSg", EXISTING.albSgId);

    const cluster = ecs.Cluster.fromClusterAttributes(this, "Cluster", {
      clusterName: EXISTING.ecsClusterName,
      vpc,
      securityGroups: [],
    });

    const appConfigSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "AppConfigSecret",
      EXISTING.appConfigSecretArn
    );

    // ─── ECR Repository ──────────────────────────────────────────────────
    const repo = new ecr.Repository(this, "FrontendRepo", {
      repositoryName: "kkmnow-frontend",
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: "Keep last 10 images",
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─── Security Group for frontend ECS tasks ───────────────────────────
    const frontendSg = new ec2.SecurityGroup(this, "SgFrontend", {
      vpc,
      description: "Frontend ECS tasks - allow port 3000 from ALB",
      allowAllOutbound: true,
    });
    frontendSg.addIngressRule(albSg, ec2.Port.tcp(3000), "Allow ALB to frontend on port 3000");

    // ─── ALB: Allow inbound on port 3000 (for CloudFront origin) ─────────
    // CloudFront connects to ALB on port 3000 via custom origin port
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3000), "Allow CloudFront to ALB on 3000");

    // ─── ALB Listener on port 3000 → Frontend Target Group ───────────────
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "FrontendTg", {
      targetGroupName: "kkmnow-frontend-staging",
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
      logGroupName: "/ecs/kkmnow-frontend-staging",
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
    const taskDef = new ecs.FargateTaskDefinition(this, "FrontendTask", {
      family: "kkmnow-frontend-staging",
      cpu: 512,
      memoryLimitMiB: 1024,
      executionRole,
      taskRole,
    });

    const container = taskDef.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromEcrRepository(repo, "latest"),
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
        command: ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    container.addPortMappings({ containerPort: 3000, protocol: ecs.Protocol.TCP });

    // ─── ECS Service ─────────────────────────────────────────────────────
    const service = new ecs.FargateService(this, "FrontendService", {
      serviceName: "kkmnow-frontend-staging",
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
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
      minCapacity: 2,
      maxCapacity: 6,
    });

    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 60,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(120),
    });

    scaling.scaleOnRequestCount("RequestScaling", {
      targetGroup,
      requestsPerTarget: 500,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(120),
    });

    // ─── CloudFront Distribution ─────────────────────────────────────────
    const albOrigin = new origins.HttpOrigin(
      "kkmnow-staging-alb-1708157029.ap-southeast-5.elb.amazonaws.com",
      {
        httpPort: 3000,
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        connectionAttempts: 3,
        connectionTimeout: cdk.Duration.seconds(10),
      }
    );

    const distribution = new cloudfront.Distribution(this, "FrontendCdn", {
      comment: "KKMNow Frontend (staging)",
      defaultBehavior: {
        origin: albOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: new cloudfront.CachePolicy(this, "DefaultCachePolicy", {
          cachePolicyName: "kkmnow-frontend-default",
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
            cachePolicyName: "kkmnow-frontend-static",
            comment: "Public static files - 24h cache",
            defaultTtl: cdk.Duration.hours(24),
            minTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.days(7),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
          }),
          compress: true,
        },
        // Data catalogue — SSR, forward query strings + Accept-Language
        "/data-catalogue*": {
          origin: albOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: new cloudfront.CachePolicy(this, "SsrCachePolicy", {
            cachePolicyName: "kkmnow-frontend-ssr",
            comment: "SSR pages - respect origin s-maxage, cache by Accept-Language + query",
            defaultTtl: cdk.Duration.seconds(0),
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
      exportName: "kkmnow-staging-frontend-ecr-uri",
    });

    new cdk.CfnOutput(this, "ServiceName", {
      value: service.serviceName,
      exportName: "kkmnow-staging-frontend-service-name",
    });

    new cdk.CfnOutput(this, "CloudFrontDomain", {
      value: distribution.distributionDomainName,
      description: "CloudFront distribution domain for the frontend",
      exportName: "kkmnow-staging-frontend-cf-domain",
    });

    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
      description: "CloudFront distribution ID (for CI/CD invalidation)",
      exportName: "kkmnow-staging-frontend-cf-id",
    });

    new cdk.CfnOutput(this, "TargetGroupArn", {
      value: targetGroup.targetGroupArn,
      exportName: "kkmnow-staging-frontend-tg-arn",
    });
  }
}
