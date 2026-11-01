import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { App, ArnFormat } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AirlineRankingStack } from '../infra/stack.ts';
import { DeploymentStack } from '../infra/deployment-stack.ts';

const output = mkdtempSync(join(tmpdir(), 'airline-deployment-'));
after(() => rmSync(output, { recursive: true, force: true }));
const app = new App({ outdir: output, context: { '@aws-cdk/core:defaultCrossStackReferences': 'strong' } });
const env = { region: 'eu-north-1' };
const application = new AirlineRankingStack(app, 'Application', { env });
const deployment = new DeploymentStack(app, 'Deployment', {
  env, website: application.website, distribution: application.distribution, refresh: application.refresh, historyBuilder: application.historyBuilder,
});
const template = Template.fromStack(deployment);

test('deployments queue and use only main from the project repository', () => {
  template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
    PipelineType: 'V2', ExecutionMode: 'QUEUED',
    Stages: [Match.objectLike({ Name: 'Source', Actions: [Match.objectLike({
      Configuration: Match.objectLike({ FullRepositoryId: 'kuosmark/airline-ranking', BranchName: 'main' }),
    })] }), Match.objectLike({ Name: 'Deploy' })],
  });
});

test('builds check and release application code without deploying infrastructure', () => {
  const [project] = Object.values(template.findResources('AWS::CodeBuild::Project'));
  assert.equal(project.Properties.TimeoutInMinutes, 30);
  assert.equal(project.Properties.ConcurrentBuildLimit, 1);
  const spec = JSON.parse(project.Properties.Source.BuildSpec);
  assert.deepEqual(spec.phases.install.commands, ['npm ci']);
  assert.equal(spec.phases.install['runtime-versions'].nodejs, 22);
  const commands = spec.phases.build.commands;
  const required = ['npm run check', 'npm run infra:release -- "$WEBSITE_BUCKET" "$DISTRIBUTION_ID" "$REFRESH_FUNCTION" "$HISTORY_FUNCTION"', 'npm run infra:verify'];
  let previousIndex = -1;
  for (const command of required) {
    const index = commands.indexOf(command);
    assert.ok(index > previousIndex, `Missing or out-of-order command: ${command}`);
    assert.equal(commands.lastIndexOf(command), index, `Repeated command: ${command}`);
    previousIndex = index;
  }
  const allCommands = Object.values(spec.phases).flatMap(phase => [...(phase.commands ?? []), ...(phase.finally ?? [])]);
  assert.doesNotMatch(allCommands.join('\n'), /\bcdk\s+(?:deploy|destroy)|infra:deploy|\baws\s+cloudformation\b/);
  assert.deepEqual(Object.keys(template.toJSON().Parameters).sort(), ['AlertEmail', 'BootstrapVersion', 'ConnectionArn']);
  assert.deepEqual(project.Properties.Environment.EnvironmentVariables.map(variable => variable.Name).sort(),
    ['DISTRIBUTION_ID', 'HISTORY_FUNCTION', 'REFRESH_FUNCTION', 'WEBSITE_BUCKET']);
});

test('only failed executions of this pipeline send an email notification', () => {
  const pipelineArn = deployment.resolve(deployment.node.findChild('Pipeline').pipelineArn);
  const [topicId] = Object.keys(template.findResources('AWS::SNS::Topic'));
  template.hasResourceProperties('AWS::SNS::Subscription', {
    Protocol: 'email', Endpoint: { Ref: 'AlertEmail' }, TopicArn: { Ref: topicId },
  });
  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: {
      source: ['aws.codepipeline'],
      'detail-type': ['CodePipeline Pipeline Execution State Change'],
      resources: [pipelineArn],
      detail: { state: ['FAILED'] },
    },
    Targets: [Match.objectLike({ Arn: { Ref: topicId } })],
  });
});

test('artifacts and build logs expire after seven days without public bucket access', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    LifecycleConfiguration: { Rules: [Match.objectLike({ ExpirationInDays: 7 })] },
  });
  template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
});

test('only this CodeBuild project may assume the release role', () => {
  const [project] = Object.values(template.findResources('AWS::CodeBuild::Project'));
  const projectArn = deployment.resolve(deployment.formatArn({ service: 'codebuild', resource: 'project',
    resourceName: project.Properties.Name, arnFormat: ArnFormat.SLASH_RESOURCE_NAME }));
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: { Statement: [Match.objectLike({
      Principal: { Service: 'codebuild.amazonaws.com' },
      Condition: {
        StringEquals: { 'aws:SourceAccount': { Ref: 'AWS::AccountId' } },
        ArnEquals: { 'aws:SourceArn': projectArn },
      },
    })], Version: '2012-10-17' },
  });
  template.hasResourceProperties('AWS::CodeBuild::Project', { Name: 'airline-ranking-release' });
});

test('deployment roles do not read secrets and direct website writes exclude backend objects', () => {
  const policies = Object.values(template.findResources('AWS::IAM::Policy'));
  const statements = policies.flatMap(policy => policy.Properties.PolicyDocument.Statement);
  assert.equal(JSON.stringify(statements).includes('ssm:GetParameter'), false);
  const allowedActions = statements.filter(statement => statement.Effect === 'Allow')
    .flatMap(statement => Array.isArray(statement.Action) ? statement.Action : [statement.Action]);
  for (const action of allowedActions) {
    assert.equal(/^(sts:|iam:|cloudformation:|ssm:|scheduler:|freetier:)/.test(action), false, action);
    assert.equal(action === '*' || action.endsWith(':*'), false, action);
  }
  const lambda = statements.find(statement => [].concat(statement.Action).includes('lambda:UpdateFunctionCode'));
  assert.ok(lambda);
  assert.deepEqual([].concat(lambda.Action).sort(), ['lambda:GetFunctionConfiguration', 'lambda:UpdateFunctionCode']);
  assert.deepEqual(lambda.Resource, [deployment.resolve(application.refresh.functionArn), deployment.resolve(application.historyBuilder.functionArn)]);
  for (const statement of statements.filter(statement => statement.Effect === 'Allow')) {
    assert.equal([].concat(statement.Resource).includes('*'), false);
  }
  const upload = statements.find(statement => statement.Action === 's3:PutObject');
  assert.ok(upload);
  assert.equal(upload.Resource.length, 3);
  for (const extension of ['html', 'js', 'css']) assert.match(JSON.stringify(upload.Resource), new RegExp(`/\\*\\.${extension}`));
  for (const prefix of ['codeconnections', 'codestar-connections']) {
    for (const [key, value] of [['FullRepositoryId', 'kuosmark/airline-ranking'], ['BranchName', 'main']]) {
      const restriction = statements.find(statement => statement.Effect === 'Deny' && statement.Action === `${prefix}:UseConnection` && statement.Condition.StringNotEquals[`${prefix}:${key}`] === value);
      assert.ok(restriction);
      assert.equal(restriction.Condition.Null[`${prefix}:${key}`], 'false');
    }
  }
});
