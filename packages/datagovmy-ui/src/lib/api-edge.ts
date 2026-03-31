import { NextResponse } from "next/server";

export const config = {
  runtime: "edge",
};

/**
 * Returns the rolling token from the environment variable.
 * Previously used Vercel Edge Config — replaced for AWS deployment.
 * The token is injected via ECS task definition (from SSM Parameter Store).
 */
export const getRollingToken = async () => {
  const rollingToken = process.env.ROLLING_TOKEN;

  if (!rollingToken) {
    return false;
  }
  return NextResponse.json({
    token: rollingToken,
  });
};
