#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { FrontendStack, FrontendEnvironmentConfig } from "../lib/frontend-stack";

const app = new cdk.App();

const env = {
  account: "624693141495",
  region: "ap-southeast-5",
};

// ─── Staging environment ──────────────────────────────────────────────────────
// Resources imported from: KkmnowNetwork, KkmnowStagingCompute, KkmnowSecrets
const STAGING: FrontendEnvironmentConfig = {
  envName: "staging",
  vpcId: "vpc-0605bf6e50eafcec9",
  albArn: "arn:aws:elasticloadbalancing:ap-southeast-5:624693141495:loadbalancer/app/kkmnow-staging-alb/72409aaffa96e94b",
  albDnsName: "kkmnow-staging-alb-1708157029.ap-southeast-5.elb.amazonaws.com",
  albSgId: "sg-0078f4022352a1317",
  ecsClusterName: "kkmnow-staging",
  appConfigSecretArn: "arn:aws:secretsmanager:ap-southeast-5:624693141495:secret:kkmnow/staging/app-config-xNnjS6",
  desiredCount: 2,
  minCapacity: 2,
  maxCapacity: 6,
};

// ─── Production environment ───────────────────────────────────────────────────
// Resources imported from: KkmnowNetwork, KkmnowProductionCompute, KkmnowSecrets
const PRODUCTION: FrontendEnvironmentConfig = {
  envName: "production",
  vpcId: "vpc-0605bf6e50eafcec9",
  albArn: "arn:aws:elasticloadbalancing:ap-southeast-5:624693141495:loadbalancer/app/kkmnow-production-alb/dfeb17e09ad9472b",
  albDnsName: "kkmnow-production-alb-209280241.ap-southeast-5.elb.amazonaws.com",
  albSgId: "sg-0078f4022352a1317",
  ecsClusterName: "kkmnow-production",
  appConfigSecretArn: "arn:aws:secretsmanager:ap-southeast-5:624693141495:secret:kkmnow/production/app-config-CrD0sg",
  desiredCount: 2,
  minCapacity: 2,
  maxCapacity: 10,
};

new FrontendStack(app, "KkmnowStagingFrontend", {
  env,
  config: STAGING,
  description: "KKMNow frontend - ECS Fargate + CloudFront (staging)",
});

new FrontendStack(app, "KkmnowProductionFrontend", {
  env,
  config: PRODUCTION,
  description: "KKMNow frontend - ECS Fargate + CloudFront (production)",
});
