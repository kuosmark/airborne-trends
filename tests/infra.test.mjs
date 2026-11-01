import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AirlineRankingStack } from '../infra/stack.ts';

const output = mkdtempSync(join(tmpdir(), 'airline-infra-'));
after(() => rmSync(output, { recursive: true, force: true }));
const app = new App({ outdir: output });
const stack = new AirlineRankingStack(app, 'Test', { env: { region: 'eu-north-1' } });
const template = Template.fromStack(stack);

test('polling starts disabled with bounded concurrency, execution time and no automatic retries', () => {
  template.hasResourceProperties('AWS::Scheduler::Schedule', {
    State: 'DISABLED', ScheduleExpression: 'rate(15 minutes)',
    FlexibleTimeWindow: { Mode: 'OFF' },
    Target: Match.objectLike({
      Input: '{"scheduledAt":"<aws.scheduler.scheduled-time>"}',
      RetryPolicy: { MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 },
    }),
  });
  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs22.x', Architectures: ['arm64'], MemorySize: 512,
    Timeout: 120, ReservedConcurrentExecutions: 1,
    Environment: { Variables: Match.objectLike({ SKYLINK_KEY_PARAMETER: '/airline-ranking/skylink-api-key' }) },
  });
  template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
    MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 60,
  });
  template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
});

test('state stays private and survives stack removal with bounded version history', () => {
  const buckets = Object.values(template.findResources('AWS::S3::Bucket'));
  assert.equal(buckets.length, 2);
  for (const bucket of buckets) {
    assert.equal(bucket.DeletionPolicy, 'Retain');
    assert.equal(bucket.UpdateReplacePolicy, 'Retain');
    assert.deepEqual(bucket.Properties.PublicAccessBlockConfiguration, {
      BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
    });
  }
  template.hasResourceProperties('AWS::S3::Bucket', {
    VersioningConfiguration: { Status: 'Enabled' },
    LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ NoncurrentVersionExpiration: { NoncurrentDays: 7 } })]) },
  });
});

test('CloudFront uses authenticated S3 access and honors freshness headers without an HTML error fallback', () => {
  template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: Match.objectLike({ SigningBehavior: 'always', SigningProtocol: 'sigv4' }),
  });
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      DefaultRootObject: 'index.html', PriceClass: 'PriceClass_100',
      DefaultCacheBehavior: Match.objectLike({ AllowedMethods: ['GET', 'HEAD'], ViewerProtocolPolicy: 'redirect-to-https' }),
      CustomErrorResponses: [{ ErrorCode: 403, ErrorCachingMinTTL: 0 }, { ErrorCode: 404, ErrorCachingMinTTL: 0 }],
    }),
  });
  template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
    CachePolicyConfig: Match.objectLike({ MinTTL: 0, DefaultTTL: 30, MaxTTL: 31536000 }),
  });
});

test('custom domain reuses the existing zone and certificate with a CloudFront alias and SNI HTTPS', () => {
  template.resourceCountIs('AWS::Route53::HostedZone', 0);
  template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
  template.resourceCountIs('AWS::Route53::RecordSet', 1);
  template.hasResourceProperties('AWS::Route53::RecordSet', {
    HostedZoneId: { Ref: 'HostedZoneId' }, Name: 'airlines.markuskuosmanen.com.', Type: 'A',
    AliasTarget: Match.objectLike({ DNSName: { 'Fn::GetAtt': [Match.stringLikeRegexp('^Distribution'), 'DomainName'] } }),
  });
  assert.match(JSON.stringify(template.toJSON().Mappings), /Z2FDTNDATAQYW2/);
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      Aliases: ['airlines.markuskuosmanen.com'],
      ViewerCertificate: {
        AcmCertificateArn: { Ref: 'CertificateArn' }, MinimumProtocolVersion: 'TLSv1.2_2021', SslSupportMethod: 'sni-only',
      },
    }),
  });
});

test('the refresh role can access only its state objects, published ranking and API-key parameter', () => {
  const policies = Object.values(template.findResources('AWS::IAM::Policy'));
  const role = JSON.stringify(stack.resolve(stack.refresh.role.roleName));
  const refreshPolicies = policies.filter(resource => resource.Properties.Roles.some(name => JSON.stringify(name) === role));
  assert.ok(refreshPolicies.length > 0);
  const statements = refreshPolicies.flatMap(resource => resource.Properties.PolicyDocument.Statement);
  const state = stack.node.findChild('State');
  const key = stack.node.findChild('ApiKey');
  const historyCondition = { StringEquals: { 's3:if-none-match': '*' } };
  const expectedGrants = [
    ...['operator-names.json', 'refresh-state.json'].flatMap(object =>
      ['s3:GetObject', 's3:PutObject'].map(action => [action, state.arnForObjects(object), {}])),
    ...['api/ranking', 'api/ranking-v2'].map(object => ['s3:PutObject', stack.website.arnForObjects(object), {}]),
    ['ssm:GetParameter', key.parameterArn, {}],
    ['s3:PutObject', state.arnForObjects('history/counts/v1/*'), historyCondition],
  ].map(grant => JSON.stringify(stack.resolve(grant)));
  // Compare effective grants, allowing equivalent statements to be split or combined.
  const actualGrants = statements.flatMap(statement => {
    assert.equal(statement.Effect, 'Allow');
    assert.equal(statement.NotAction, undefined);
    assert.equal(statement.NotResource, undefined);
    return [].concat(statement.Action).flatMap(action =>
      [].concat(statement.Resource).map(resource => JSON.stringify([action, resource, statement.Condition ?? {}])));
  });
  assert.deepEqual(new Set(actualGrants), new Set(expectedGrants));
});

test('three consecutive failing periods notify the deployment-supplied email', () => {
  template.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: { Ref: 'AlertEmail' } });
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    Namespace: 'AWS/Lambda', MetricName: 'Errors', Period: 900, Threshold: 1,
    EvaluationPeriods: 3, DatapointsToAlarm: 3,
    TreatMissingData: 'notBreaching', AlarmActions: [Match.anyValue()],
    OKActions: Match.absent(), InsufficientDataActions: Match.absent(),
  });
});

test('polling must be explicitly enabled and other Regions are rejected', () => {
  const enabledApp = new App({ outdir: join(output, 'enabled'), context: { isPollingEnabled: 'true' } });
  const enabled = new AirlineRankingStack(enabledApp, 'Enabled', { env: { region: 'eu-north-1' } });
  Template.fromStack(enabled).hasResourceProperties('AWS::Scheduler::Schedule', { State: 'ENABLED' });
  assert.throws(() => new AirlineRankingStack(new App(), 'WrongRegion', { env: { region: 'eu-west-1' } }), /eu-north-1/);
  const invalidApp = new App({ context: { isPollingEnabled: 'yes' } });
  assert.throws(() => new AirlineRankingStack(invalidApp, 'Invalid', { env: { region: 'eu-north-1' } }), /true or false/);
});


test('counts archives remain retained without exposing them through CloudFront', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    VersioningConfiguration: { Status: 'Enabled' },
    LifecycleConfiguration: { Rules: [
      { NoncurrentVersionExpiration: { NoncurrentDays: 7 }, Status: 'Enabled' },
    ] },
  });
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: { Variables: Match.objectLike({ IS_HISTORY_ENABLED: 'true' }) },
  });
  const distribution = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0];
  assert.doesNotMatch(JSON.stringify(distribution), /State|history\/counts/);
});

test('history builder is separately scheduled with archive-only reads and chart-only writes', () => {
  template.hasResourceProperties('AWS::Scheduler::Schedule', {
    State: 'DISABLED', ScheduleExpression: 'rate(1 hour)',
  });
  template.hasResourceProperties('AWS::Lambda::Function', {
    Timeout: 300, MemorySize: 512, ReservedConcurrentExecutions: 1,
    Environment: { Variables: { STATE_BUCKET: Match.anyValue(), WEBSITE_BUCKET: Match.anyValue() } },
  });
  const policies = Object.values(template.findResources('AWS::IAM::Policy'));
  const history = policies.find(resource => resource.Properties.PolicyDocument.Statement.some(statement =>
    JSON.stringify(statement.Resource).includes('/api/history/v1/')));
  assert.ok(history);
  const statements = history.Properties.PolicyDocument.Statement;
  assert.equal(statements.length, 4);
  assert.equal(JSON.stringify(statements).includes('ssm:'), false);
  assert.equal(JSON.stringify(statements).includes('DeleteObject'), false);
  const writes = statements.filter(statement => [].concat(statement.Action).includes('s3:PutObject'));
  assert.equal(writes.length, 1);
  assert.match(JSON.stringify(writes[0].Resource), /api\/history\/v1/);
});
