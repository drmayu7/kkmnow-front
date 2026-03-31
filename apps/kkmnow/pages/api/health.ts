import { NextApiRequest, NextApiResponse } from "next";

type HealthData = {
  status: string;
  timestamp: number;
};

/**
 * GET endpoint for ALB health checks and CI/CD smoke tests.
 * Must NOT call external APIs to avoid cascading failures.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse<HealthData>) {
  res.status(200).json({
    status: "ok",
    timestamp: Date.now(),
  });
}
