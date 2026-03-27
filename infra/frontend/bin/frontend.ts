#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { FrontendStack } from "../lib/frontend-stack";

const app = new cdk.App();

const env = {
  account: "624693141495",
  region: "ap-southeast-5",
};

new FrontendStack(app, "KkmnowStagingFrontend", {
  env,
  description: "KKMNow frontend - ECS Fargate + CloudFront (staging)",
});
