import { Duration, Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source} from 'aws-cdk-lib/aws-s3-deployment';
import { PythonFunction} from '@aws-cdk/aws-lambda-python-alpha';
import {Code, Function, Runtime} from 'aws-cdk-lib/aws-lambda';
import { Role, ServicePrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';



export class WorkflowOrchestrationBedrockAgentChainingStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const damageAnalysisAndNotificationAgentInstruction =
    `You are a helpful virtual assistant whose goal is to do a preliminary analysis on the images uploaded by users for their insurance claims and send notifications to claims adjusters about your initial analysis.
Here are the steps you should follow in exact order for preliminary analysis of the images:
Step 1: Analyze the uploaded images for damages. 
Step 2: Send a notification of the analysis of these damages to the claims adjusters.`
    
    //Create the S3 bucket to store the html file , uploading the image data for damages as well as the bucket that will hold policy documents
    const damageImagesBucket = new s3.Bucket(this, 'DamageImagesBucket', {
      removalPolicy: RemovalPolicy.DESTROY, // This is for demo purposes, use a proper removal policy in production
      autoDeleteObjects: true // This is for demo purposes, use a proper removal policy in production
    });
    
    const uiHtmlbucket = new s3.Bucket(this, 'HtmlBucket',{
      removalPolicy: RemovalPolicy.DESTROY, // This is for demo purposes, use a proper removal policy in production
      autoDeleteObjects: true // This is for demo purposes, use a proper removal policy in production
    });
    
    const policyDocsBucket = new s3.Bucket(this, 'PolicyDocsBucket',{
      removalPolicy: RemovalPolicy.DESTROY, // This is for demo purposes, use a proper removal policy in production
      autoDeleteObjects: true // This is for demo purposes, use a proper removal policy in production
    });
    
    
    //Create Damage Analysis Lambda function role 
    const damageAnalsyislambdaFunctionRole = new Role(this, 'DamageAnalysisLambdaFunctionRole', {
        roleName: 'DamageAnalysisLambdaFunctionRole',
        assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });


    const damageAnalysisActionGroupExecutor = new Function (this, 'DamageAnalysisAgentActionGroup', {
        runtime: Runtime.PYTHON_3_10,
        handler: 'index.lambda_handler',
        code: Code.fromAsset(path.join(__dirname, '..', 'actions', 'damage_analysis')),
        timeout: Duration.seconds(600),
        role: damageAnalsyislambdaFunctionRole,
        environment: {
          'CLAIMIMAGE_SUBMITTED_BUCKET': damageImagesBucket.bucketName, // Pass the S3 bucket name for images as an environment variable
        }
    }); 
    
    // Output the Lambda function name
    new cdk.CfnOutput(this, 'DamageAnalysisLambdaFunction', {
        value: damageAnalysisActionGroupExecutor.functionName,
    });
    

    //Queue for sending the Damage Analysis Notifications out to the Claims Adjusters
    const queue = new sqs.Queue(this, 'ClaimsAdjustersQueue', {
      visibilityTimeout: Duration.seconds(300)
    });
    

    //Create Damage Analysis Lambda function role 
    const notificationlambdaFunctionRole = new Role(this, 'NotificationLambdaFunctionRole', {
        roleName: 'NotificationLambdaFunctionRole',
        assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });
    
    // Create an AWS Lambda function for Sending Notification of Preliminary Analysis to Claims Adjusters
    const damageNotificationActionGroupExecutor = new Function(this, 'NotificationActionGroupFunction', {
      runtime: Runtime.PYTHON_3_10,
      code: Code.fromAsset(path.join(__dirname, '..', 'actions', 'damage_notification')),
      handler: 'index.lambda_handler',
      timeout: Duration.seconds(600),
      environment: {
        'NOTIFICATION_QUEUE_URL': queue.queueUrl // Pass the SQS queue URL as an environment variable
      }
    });
    
    new cdk.CfnOutput(this, 'DamageNotificationLambdaFunction', {
        value: damageNotificationActionGroupExecutor.functionName,
    });
    
    // Grant permission to the Lambda function to receive messages from the SQS queue
    queue.grantSendMessages(damageNotificationActionGroupExecutor);
    
    const DamageAnalysisNotificationAgent = new bedrock.Agent(this, "DamageAnalyisBedrockAgentStack", {
      name: 'DamageAnalysisNotificationBedrockAgent',
      instruction: damageAnalysisAndNotificationAgentInstruction,
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_V2_1,
      description: 'DamageAnalysis_Agent',
      idleSessionTTL: cdk.Duration.minutes(60),
    })
    
    // add the action group for analyzing damages
    new bedrock.AgentActionGroup(this, 'DamageAnalysisActionGroup', {
      actionGroupName: 'DamageAnalysisActionGroup',
      description: 'The action group for Damage analysis',
      agent: DamageAnalysisNotificationAgent,
      apiSchema: bedrock.ApiSchema.fromAsset(
        path.join(__dirname, '..' , './actions/damage_analysis/damageanalysis_spec.json')
      ),
      actionGroupState: 'ENABLED',
      actionGroupExecutor: damageAnalysisActionGroupExecutor,
      shouldPrepareAgent: true,
    });
    
    
    // add the action group for sending notifications about the summary of damages to the Claim Adjuster's SQS queue 
    new bedrock.AgentActionGroup(this, 'NotificationActionGroup', {
      actionGroupName: 'NotificationActionGroup',
      description: 'The action group for sending notifications',
      agent: DamageAnalysisNotificationAgent,
      apiSchema: bedrock.ApiSchema.fromAsset(
        path.join(__dirname, '..' , './actions/damage_notification/notification_spec.json')
      ),
      actionGroupState: 'ENABLED',
      actionGroupExecutor: damageNotificationActionGroupExecutor,
      shouldPrepareAgent: true,
    });
    
    // Store the Damage Analysis Notification Agent Id as a parameter in Parameter Store
    new ssm.StringParameter(this, 'DamageAnalysisNotfnAgentId', {
      parameterName: '/insureassist/damageAnalysisNotfnAgentId',
      stringValue: DamageAnalysisNotificationAgent.agentId,
    });
    
    //Output DamageAnalysisNotificationAgentID
    new cdk.CfnOutput(this, 'DamageAnalysisAndNotificationAgentId', {value: DamageAnalysisNotificationAgent.agentId});


    // create the bedrock knowledge base for policy documents
    const kb = new bedrock.KnowledgeBase(this, 'BedrockKnowledgeBase', {
      embeddingsModel: bedrock.BedrockFoundationModel.COHERE_EMBED_ENGLISH_V3
    });
    
    // Output the Knowledge Base ID
    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: kb.knowledgeBaseId,
    });
    
    // set the data source of the s3 bucket for the knowledge base
    const dataSource = new bedrock.S3DataSource(this, 'DataSource', {
      bucket: policyDocsBucket,
      knowledgeBase: kb,
      dataSourceName: 'policy-data',
      chunkingStrategy: bedrock.ChunkingStrategy.DEFAULT
    });
    
   //Create Policy  Retrieval Lambda function role 
    const policylambdaFunctionRole = new Role(this, 'PolicyRetrievalLambdaFunctionRole', {
      roleName: 'PolicyRetrievalLambdaFunctionRole',
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });

    const policyRetrieveActionGroupExecutor = new Function (this, 'PolicyRetrievalAgentActionGroup', {
      runtime: Runtime.PYTHON_3_10,
      handler: 'index.lambda_handler',
      code: Code.fromAsset(path.join(__dirname, '..', 'actions', 'policylookup'),{
      bundling: {
            image: lambda.Runtime.PYTHON_3_10.bundlingImage,
            command: [
                'bash', '-c',
                `pip install -r requirements.txt -t /asset-output && cp -r . /asset-output`
            ],
        },
      
      }),
      timeout: Duration.seconds(600),
      role: policylambdaFunctionRole,
      environment: {
          'KB_ID': kb.knowledgeBaseId, 
          'REGION': this.region
      }
    }); 
    
    // Output the Lambda function name
    new cdk.CfnOutput(this, 'PolicyRetrievalFromKBLambdaFunction', {
        value: policyRetrieveActionGroupExecutor.functionName,
    });
    
    const PolicyAgent = new bedrock.Agent(this, "PolicyBedrockAgentStack", {
        name: "PolicyBedrockAgent",
        instruction: "You are a knowledgeable and helpful virtual assistant for insurance policy questions. ",
        foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_V2_1,
        description: 'PolicyAnalysis_Agent',
        idleSessionTTL: cdk.Duration.minutes(60),
    });
    
    // add the action group for analyzing damages
    new bedrock.AgentActionGroup(this, 'PolicyBedrockAgentActionGroup', {
      actionGroupName: 'PolicyBedrockAgentActionGroup',
      description: 'Insurance policy retrieval action',
      agent: PolicyAgent,
      apiSchema: bedrock.ApiSchema.fromAsset(
        path.join(__dirname, '..' , './actions/policylookup/policylookup_spec.json')
      ),
      actionGroupState: 'ENABLED',
      actionGroupExecutor: policyRetrieveActionGroupExecutor,
      shouldPrepareAgent: true,
    });
    
    
    // Store the Policy Analysis Agent Id as a parameter in Parameter Store
    new ssm.StringParameter(this, 'PolicyAgentId', {
      parameterName: '/insureassist/policyBedrockAgentId',
      stringValue: PolicyAgent.agentId,
    });
    
    //Output DamageAnalysisNotificationAgentID
    new cdk.CfnOutput(this, 'PolicyBedrockAgentId', {value: PolicyAgent.agentId});


    //start preparing the Action Groups and Actions that will be invoked by the Insure Assist Orchestrator Agent
    
    //Create "Invoke Damage Agent" Lambda function role 
    const invokeDamageAgentlambdaFunctionRole = new Role(this, 'InvokeDamageAgentLambdaFunctionRole', {
        roleName: 'InvokeDamageAgentLambdaFunctionRole',
        assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });
    
    // Create "Invoke Damage Agent" Lambda function
    const invokeDamageAgentActionGroupExecutor = new Function(this, 'InvokeDamageAgentActionGroupFunction', {
      runtime: Runtime.PYTHON_3_10,
      code: Code.fromAsset(path.join(__dirname, '..', 'actions', 'invoke_damageagent')),
      handler: 'index.lambda_handler',
      timeout: Duration.seconds(600),
      role: invokeDamageAgentlambdaFunctionRole,
      environment: {
        'DamageAnalysis_Agent_ID': DamageAnalysisNotificationAgent.agentId 
      }
    });
    
    //Create "Invoke Policy Agent" Lambda function role 
    const invokePolicyAgentlambdaFunctionRole = new Role(this, 'InvokePolicyAgentLambdaFunctionRole', {
        roleName: 'InvokePolicyAgentLambdaFunctionRole',
        assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });
    
    // Create "Invoke Policy Agent" Lambda function
    const invokePolicyAgentActionGroupExecutor = new Function(this, 'InvokePolicyAgentActionGroupFunction', {
      runtime: Runtime.PYTHON_3_10,
      code: Code.fromAsset(path.join(__dirname, '..', 'actions', 'invoke_policyagent')),
      handler: 'index.lambda_handler',
      timeout: Duration.seconds(600),
      role: invokePolicyAgentlambdaFunctionRole,
      environment: {
        'Policy_Agent_ID': PolicyAgent.agentId // Pass the SQS queue URL as an environment variable
      }
    });
    
    new cdk.CfnOutput(this, 'InvokePolicyAgentLambdafunction', {
      value: invokePolicyAgentActionGroupExecutor.functionName,
    });
    
    //Create "Create Claims and Draud Detection APIs" Lambda function role 
    const createclaimslambdaFunctionRole = new Role(this, 'CreateClaimsLambdaFunctionRole', {
        roleName: 'CreateClaimsLambdaFunctionRole',
        assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });
    
    // Create "Create Claims and Fraud Detection APIs" Lambda function
    const createClaimsActionGroupExecutor = new Function(this, 'CreateClaimsActionGroupFunction', {
      runtime: Runtime.PYTHON_3_10,
      code: Code.fromAsset(path.join(__dirname, '..', 'actions', 'createclaims_detectfraud')),
      handler: 'index.lambda_handler',
      timeout: Duration.seconds(600),
      role: createclaimslambdaFunctionRole,
    });
    
    //Create the Insurance Orchestrator Bedrock agent
    const InsuranceOrchestratorAgent = new bedrock.Agent(this, "InsuranceOrchestratorBedrockAgentStack", {
        name: "InsuranceOrchestratorBedrockAgent",
        instruction: "You are a helpful virtual assistant whose goal is to provide courteous and human-like responses while helping customers file insurance claims, detect fraud before filing claims, assess damages, and to answer questions related to the customer’s insurance policy. ",
        foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_V2_1,
        description: 'InsuranceOrchestrator_Agent',
        idleSessionTTL: cdk.Duration.minutes(60)
    })
    
    // add the action group for invoking the DamageNotification Agent from the InsuranceOrchestrator Agent
    new bedrock.AgentActionGroup(this, 'InvokeDamageAgentActionGroup', {
      actionGroupName: 'InvokeDamageAgentActionGroup',
      description: 'Action to Invoke Damage Analysis Agent',
      agent: InsuranceOrchestratorAgent,
      apiSchema: bedrock.ApiSchema.fromAsset(
        path.join(__dirname, '..' , './actions/invoke_damageagent/invokedamageagent_spec.json')
      ),
      actionGroupState: 'ENABLED',
      actionGroupExecutor: invokeDamageAgentActionGroupExecutor,
      shouldPrepareAgent: true,
    });
    
    // add the action group for invoking the Policy Agent from the InsuranceOrchestrator Agent
    new bedrock.AgentActionGroup(this, 'InvokePolicyAgentActionGroup', {
      actionGroupName: 'InvokePolicyAgentActionGroup',
      description: 'Action to Invoke Policy Analysis Agent',
      agent: InsuranceOrchestratorAgent,
      apiSchema: bedrock.ApiSchema.fromAsset(
        path.join(__dirname, '..' , './actions/invoke_policyagent/invokepolicyagent_spec.json')
      ),
      actionGroupState: 'ENABLED',
      actionGroupExecutor: invokePolicyAgentActionGroupExecutor,
      shouldPrepareAgent: true,
    });
    
        
    new bedrock.AgentActionGroup(this, 'ClaimCreationFraudDetectionActionGroup', {
      actionGroupName: 'ClaimCreationFraudDetectionActionGroup',
      description: 'Action to Create Claims , Detect Frauds',
      agent: InsuranceOrchestratorAgent,
      apiSchema: bedrock.ApiSchema.fromAsset(
        path.join(__dirname, '..' , './actions/createclaims_detectfraud/claimsfrauddetection_spec.json')
      ),
      actionGroupState: 'ENABLED',
      actionGroupExecutor: createClaimsActionGroupExecutor,
      shouldPrepareAgent: true,
    });
    
    
    // Store the Insurance Agent Orchestrator as a parameter in Parameter Store
    new ssm.StringParameter(this, 'OrchestratorAgentId', {
      parameterName: '/insureassist/insuranceOrchestratorAgentId',
      stringValue: InsuranceOrchestratorAgent.agentId,
    });
    
    //Output DamageAnalysisNotificationAgentID
    new cdk.CfnOutput(this, 'InsuranceOrchestratorAgentId', {value: InsuranceOrchestratorAgent.agentId});
    
    
    //User interface constructs and code
    
    // Retrieve default VPC associated with Cloud9
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', {
      isDefault: true
    });
    
    
    //Define the Lambda function Role 
    const apiForInsureAssistAgentRole = new Role(this, 'ApiForInsureAssistAgentRole', {
      roleName: 'ApiForInsureAssistAgentRole',
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });
    
    //Define the Lambda function for invoking the Insure Assist Bedrock Agent
    const lambdaFunctionApiCallingInsureAssistAgent = new lambda.Function(this, 'ApiForInsureAssistAgent', {
      runtime: lambda.Runtime.PYTHON_3_10,
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas', 'lambda_for_insureassist_agent')), // Provide the path to your Lambda function code
      handler: 'lambda_function.lambda_handler', // Assuming your handler function is named 'lambda_handler' in a file named 'index.py'
      memorySize: 512, // Memory allocation for the function in MB
      timeout: cdk.Duration.seconds(900), // Maximum execution time for the function in seconds
      role: apiForInsureAssistAgentRole,
      environment: {
          'INSUREASSIST_AGENTID': InsuranceOrchestratorAgent.agentId, 
      }
    });
    
    //Create an ALB for the Insure Assist Lambda which will invoke the  Insure Assist Bedrock Agent 
    const albApiCallingInsureAssistAgent = new elbv2.ApplicationLoadBalancer(this, 'InsureAssistApiLoadBalancer', {
      vpc,
      internetFacing: true, // This will create a publicly accessible ALB
    });
    
    // Create a listener for the ALB
    const insureAssistApiListener = albApiCallingInsureAssistAgent.addListener('insureAssistApiListener', {
      port: 80,
      open: true,
    });

    // Add a default target group for the Lambda function
    const insureAssistApitargetGroup = insureAssistApiListener.addTargets('InsureAssistAPIGroup', {
      targets: [new targets.LambdaTarget(lambdaFunctionApiCallingInsureAssistAgent)]
    });
    
    // Define CDK output for ALB DNS name
    new cdk.CfnOutput(this, 'InsureAssistApiAlbDnsName', {
      value: albApiCallingInsureAssistAgent.loadBalancerDnsName
    });
    
    
    // Create the UI stack ###########################
    
    // Upload the updated index.html to the S3 bucket
    new s3deploy.BucketDeployment(this, 'DeployIndexHtml', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', 'lambdas', 'ui_chatbot'))],
      destinationBucket: uiHtmlbucket,
      destinationKeyPrefix: '', // Set destinationKeyPrefix to empty string for root of bucket
    });

    

    //Define the Lambda function Role  for the UI Lambda
    const insureAssistUiLambdaRole = new Role(this, 'insureAssistUiLambdaRole', {
      roleName: 'insureAssistUiLambdaRole',
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });
    
    // Define a Lambda function for the UI
    const lambdaFunctionInsureAssistUI = new lambda.Function(this, 'InsureAssistUILambda', {
      runtime: lambda.Runtime.PYTHON_3_10,
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambdas', 'ui_chatbot')), // Provide the path to your Lambda function code
      handler: 'lambda_function.lambda_handler', // Assuming your handler function is named 'lambda_handler' in a file named 'index.py'
      memorySize: 512, // Memory allocation for the function in MB
      timeout: cdk.Duration.seconds(900), // Maximum execution time for the function in seconds
      environment: {
        HTML_BUCKET_NAME: uiHtmlbucket.bucketName,
        IMAGE_BUCKET_SUBMITTED_BY_UI: damageImagesBucket.bucketName,
        INSURE_ASSIST_API_ALB_DNS_NAME: albApiCallingInsureAssistAgent.loadBalancerDnsName
      },
      role: insureAssistUiLambdaRole
    });
    
    // Create an ALB for the Insure Assist UI
    const InsureAssistUIalb = new elbv2.ApplicationLoadBalancer(this, 'InsureAssistUILoadBalancer', {
      vpc,
      internetFacing: true, // This will create a publicly accessible ALB
    });

    // Create a listener for the ALB
    const listener = InsureAssistUIalb.addListener('InsureAssistUIListener', {
      port: 80,
      open: true,
    });

    // Add a default target group for the Lambda function
    const targetGroup = listener.addTargets('InsureAssistUIGroup', {
      targets: [new targets.LambdaTarget(lambdaFunctionInsureAssistUI)]
    });
    


    // Store the ALB DNS name as a parameter in Parameter Store
    new ssm.StringParameter(this, 'InsureAssistALBDnsNameParameter', {
      parameterName: '/insureassist/ui_alb_dns_name',
      stringValue: InsureAssistUIalb.loadBalancerDnsName,
    });
    
    // Define CDK output for ALB DNS name
    new cdk.CfnOutput(this, 'InsureAssistUIAlbDnsName', {
      value: InsureAssistUIalb.loadBalancerDnsName
    });
    
    // Output the bucket name
    new cdk.CfnOutput(this, 'ImageBucketName', {
      value: damageImagesBucket.bucketName,
    });
    
    //
    new cdk.CfnOutput(this, 'PolicyDocumentsBucketName', {
      value: policyDocsBucket.bucketName,
    });
    

  }
}
