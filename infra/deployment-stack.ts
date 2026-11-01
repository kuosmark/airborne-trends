import { ArnFormat, CfnParameter, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import type { IDistribution } from 'aws-cdk-lib/aws-cloudfront';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';

interface DeploymentProps extends StackProps {
  website: s3.IBucket;
  distribution: IDistribution;
  refresh: IFunction;
  historyBuilder: IFunction;
}

export class DeploymentStack extends Stack {
  constructor(scope: Construct, id: string, props: DeploymentProps) {
    super(scope, id, props);
    if (props.env?.region !== 'eu-north-1') { throw new Error('Deploy only in eu-north-1'); }
    const connection = new CfnParameter(this, 'ConnectionArn', {
      type: 'String',
      description: 'Authorized GitHub CodeConnections connection in Stockholm.',
      allowedPattern: 'arn:aws:codeconnections:eu-north-1:[0-9]{12}:connection/[a-zA-Z0-9-]+',
    });
    const artifacts = new s3.Bucket(this, 'Artifacts', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: Duration.days(7) }],
    });
    const build = this.createReleaseBuild(props);
    const pipeline = this.createPipeline(artifacts, build, connection.valueAsString);
    this.restrictSourceConnection(pipeline.role, connection.valueAsString);
    this.createFailureNotification(pipeline);
  }

  private createFailureNotification(pipeline: codepipeline.Pipeline): void {
    const email = new CfnParameter(this, 'AlertEmail', {
      type: 'String',
      description: 'Email address for failed deployment notifications.',
    });
    const alerts = new sns.Topic(this, 'DeploymentAlerts');
    alerts.addSubscription(new subscriptions.EmailSubscription(email.valueAsString));
    pipeline.onStateChange('DeploymentFailed', {
      eventPattern: { detail: { state: ['FAILED'] } },
      target: new targets.SnsTopic(alerts),
    });
  }

  private createReleaseBuild(props: DeploymentProps): codebuild.PipelineProject {
    const buildLogs = new logs.LogGroup(this, 'BuildLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const projectName = 'airline-ranking-release';
    const buildRole = new iam.Role(this, 'ReleaseRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnEquals: {
            'aws:SourceArn': this.formatArn({
              service: 'codebuild',
              resource: 'project',
              resourceName: projectName,
              arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
            }),
          },
        },
      }),
    });
    const build = new codebuild.PipelineProject(this, 'Deploy', {
      projectName,
      role: buildRole,
      grantReportGroupPermissions: false,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      timeout: Duration.minutes(30),
      concurrentBuildLimit: 1,
      logging: { cloudWatch: { logGroup: buildLogs } },
      environmentVariables: {
        WEBSITE_BUCKET: { value: props.website.bucketName },
        DISTRIBUTION_ID: { value: props.distribution.distributionId },
        REFRESH_FUNCTION: { value: props.refresh.functionArn },
        HISTORY_FUNCTION: { value: props.historyBuilder.functionArn },
      },
      buildSpec: this.createReleaseBuildSpec(),
    });
    this.grantReleasePermissions(build, props);
    return build;
  }

  private createReleaseBuildSpec(): codebuild.BuildSpec {
    return codebuild.BuildSpec.fromObject({
      version: '0.2',
      phases: {
        install: {
          'runtime-versions': { nodejs: 22 },
          commands: ['npm ci'],
        },
        build: {
          commands: [
            'npm run check',
            'npm run infra:release -- "$WEBSITE_BUCKET" "$DISTRIBUTION_ID" "$REFRESH_FUNCTION" "$HISTORY_FUNCTION"',
            'npm run infra:verify',
          ],
        },
      },
    });
  }


  private grantReleasePermissions(build: codebuild.PipelineProject, props: DeploymentProps): void {
    build.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:GetFunctionConfiguration', 'lambda:UpdateFunctionCode'],
      resources: [props.refresh.functionArn, props.historyBuilder.functionArn],
    }));
    build.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: ['*.html', '*.js', '*.css'].map(key => props.website.arnForObjects(key)),
    }));
    build.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
      resources: [this.formatArn({
        service: 'cloudfront',
        region: '',
        resource: 'distribution',
        resourceName: props.distribution.distributionId,
        arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
      })],
    }));
  }

  private createPipeline(
    artifacts: s3.Bucket,
    build: codebuild.PipelineProject,
    connectionArn: string,
  ): codepipeline.Pipeline {
    const source = new codepipeline.Artifact();
    return new codepipeline.Pipeline(this, 'Pipeline', {
      artifactBucket: artifacts,
      crossAccountKeys: false,
      usePipelineRoleForActions: true,
      pipelineType: codepipeline.PipelineType.V2,
      executionMode: codepipeline.ExecutionMode.QUEUED,
      stages: [
        {
          stageName: 'Source',
          actions: [new actions.CodeStarConnectionsSourceAction({
            actionName: 'GitHub',
            owner: 'kuosmark',
            repo: 'airline-ranking',
            branch: 'main',
            connectionArn,
            output: source,
          })],
        },
        {
          stageName: 'Deploy',
          actions: [new actions.CodeBuildAction({
            actionName: 'CheckAndDeploy',
            project: build,
            input: source,
          })],
        },
      ],
    });
  }

  private restrictSourceConnection(role: iam.IRole, connectionArn: string): void {
    // Restrict the connection to this repository and branch, even if the GitHub installation expands.
    for (const prefix of ['codeconnections', 'codestar-connections']) {
      role.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: [`${prefix}:UseConnection`],
        resources: [connectionArn],
        conditions: { StringEquals: { [`${prefix}:FullRepositoryId`]: 'kuosmark/airline-ranking' } },
      }));
      for (const [key, value] of [['FullRepositoryId', 'kuosmark/airline-ranking'], ['BranchName', 'main']]) {
        role.addToPrincipalPolicy(new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: [`${prefix}:UseConnection`],
          resources: [connectionArn],
          conditions: {
            StringNotEquals: { [`${prefix}:${key}`]: value },
            Null: { [`${prefix}:${key}`]: 'false' },
          },
        }));
      }
    }
  }
}
