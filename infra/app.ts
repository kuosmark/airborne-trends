import { App } from 'aws-cdk-lib';
import { AirborneTrendsStack } from './stack.ts';
import { DeploymentStack } from './deployment-stack.ts';

const app = new App();
const application = new AirborneTrendsStack(app, 'AirlineRanking', {
  env: { account: process.env['CDK_DEFAULT_ACCOUNT'], region: 'eu-north-1' },
  terminationProtection: true,
});
new DeploymentStack(app, 'AirlineRankingDeployment', {
  env: application.env,
  website: application.website,
  distribution: application.distribution,
  refresh: application.refresh,
  historyBuilder: application.historyBuilder,
});
