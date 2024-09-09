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
import { readFileSync } from "fs";


export class WorkflowOrchestrationBedrockAgentChainingStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

      const damageAnalysisAndNotificationAgentInstruction = 
        `You are a helpful virtual assistant whose goal is to do a preliminary analysis on the images uploaded by users for their insurance claims and send notifications to claims adjusters about your initial analysis.
Here are the steps you should follow in exact order for preliminary analysis of the images:
Step 1: Analyze the uploaded images for damages. 
Step 2: Send a notification of the analysis of these damages to the claims adjusters.`

    // Create S3 buckets
    const damageImagesBucket = new s3.Bucket(this, 'DamageImagesBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const uiHtmlBucket = new s3.Bucket(this, 'HtmlBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const policyDocsBucket = new s3.Bucket(this, 'PolicyDocsBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });
    
    new cdk.CfnOutput(this, 'PolicyDocumentsBucketName', { value: policyDocsBucket.bucketName });

    // Lambda Roles
    const damageAnalysisLambdaFunctionRole = new Role(this, 'DamageAnalysisLambdaFunctionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });

    const damageNotificationLambdaFunctionRole = new Role(this, 'NotificationLambdaFunctionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });

    const policyRetrievalLambdaFunctionRole = new Role(this, 'PolicyRetrievalLambdaFunctionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });
    
    const createClaimsLambdaFunctionRole = new Role(this, 'CreateClaimsLambdaFunctionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });
    
    const invokeDamageAgentlambdaFunctionRole = new Role(this, 'InvokeDamageAgentlambdaFunctionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });
    
    
    const invokePolicyAgentlambdaFunctionRole = new Role(this, 'InvokePolicyAgentlambdaFunctionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });

    // Damage Analysis Lambda function
    const damageAnalysisLambdaFunction = new lambda.Function(this, 'damageAnalysisLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_10,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'actions', 'damage_analysis')),
      timeout: Duration.seconds(600),
      role: damageAnalysisLambdaFunctionRole,
      environment: {
        'CLAIMIMAGE_SUBMITTED_BUCKET': damageImagesBucket.bucketName,
      }
    });
    
    // Output the Lambda function name and ARN
    new cdk.CfnOutput(this, 'DamageAnalysisLambdaFunction', {
      value: damageAnalysisLambdaFunction.functionName,
      description: 'The name of the Damage Analysis Lambda function',
    });

    // SQS Queue for Damage Notifications
    const queue = new sqs.Queue(this, 'ClaimsAdjustersQueue', {
      visibilityTimeout: Duration.seconds(300)
    });

    // Damage Notification Lambda function
    const damageNotificationLambdaFunction = new lambda.Function(this, 'notificationLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_10,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'actions', 'damage_notification')),
      timeout: Duration.seconds(600),
      role: damageNotificationLambdaFunctionRole,
      environment: {
        'NOTIFICATION_QUEUE_URL': queue.queueUrl,
      }
    });
    
    // Output the Lambda function name and ARN
    new cdk.CfnOutput(this, 'DamageNotificationLambdaFunction', {
      value: damageNotificationLambdaFunction.functionName,
      description: 'The name of the Damage Notification Lambda function',
    });
    

    queue.grantSendMessages(damageNotificationLambdaFunction);

    // Create the Damage Analysis and Notification Agent
    const DamageAnalysisNotificationAgent = new bedrock.Agent(this, "DamageAnalysisNotificationBedrockAgent", {
      name: 'DamageAnalysisNotificationBedrockAgent',
      instruction: damageAnalysisAndNotificationAgentInstruction,
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_HAIKU_V1_0,
      description: 'DamageAnalysisNotificationBedrockAgent',
      idleSessionTTL: Duration.minutes(60),
      shouldPrepareAgent: true
    });

    // Damage Analysis Action Group
    const damageAnalysisActionGroup = new bedrock.AgentActionGroup(this, 'DamageAnalysisActionGroup', {
      actionGroupName: 'DamageAnalysisActionGroup',
      description: 'Action group for damage analysis',
      actionGroupExecutor: {
        lambda: damageAnalysisLambdaFunction,
      },
      actionGroupState: 'ENABLED',
      apiSchema: bedrock.ApiSchema.fromAsset(
        path.join(__dirname, '..', './actions/damage_analysis/damageanalysis_spec.json')
      ),
    });

    DamageAnalysisNotificationAgent.addActionGroup(damageAnalysisActionGroup);

    // Notification Action Group
    const notificationActionGroup = new bedrock.AgentActionGroup(this, 'NotificationActionGroup', {
      actionGroupName: 'NotificationActionGroup',
      description: 'Action group for sending notifications',
      actionGroupExecutor: {
        lambda: damageNotificationLambdaFunction,
      },
      actionGroupState: 'ENABLED',
      apiSchema: bedrock.ApiSchema.fromAsset(
        path.join(__dirname, '..', './actions/damage_notification/notification_spec.json')
      ),
    });

    DamageAnalysisNotificationAgent.addActionGroup(notificationActionGroup);

    // Store Agent ID in SSM
    new ssm.StringParameter(this, 'DamageAnalysisNotificationAgentId', {
      parameterName: '/insureassist/damageAnalysisNotificationAgentId',
      stringValue: DamageAnalysisNotificationAgent.agentId,
    });
    
    //Output 
    new cdk.CfnOutput(this, 'DamageAnalysisAndNotificationAgentId', { value: DamageAnalysisNotificationAgent.agentId });

    // Bedrock Knowledge Base
    const kb = new bedrock.KnowledgeBase(this, 'BedrockKnowledgeBase', {
      embeddingsModel: bedrock.BedrockFoundationModel.COHERE_EMBED_ENGLISH_V3
    });

    new ssm.StringParameter(this, 'KnowledgeBaseId', {
      parameterName: '/insureassist/knowledgeBaseId',
      stringValue: kb.knowledgeBaseId,
    });
    
    // set the data source of the s3 bucket for the knowledge base
    const dataSource = new bedrock.S3DataSource(this, 'DataSource', {
      bucket: policyDocsBucket,
      knowledgeBase: kb,
      dataSourceName: 'policy-data',
      chunkingStrategy: bedrock.ChunkingStrategy.DEFAULT
    });

    //Output
    new cdk.CfnOutput(this, 'KnowledgeBaseIdOutput', { value: kb.knowledgeBaseId });
    
    
    // Policy Retrieval Lambda function
    const policyRetrieveLambdaFunction = new lambda.Function(this, 'PolicyRetrievalLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_10,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'actions', 'policylookup'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_10.bundlingImage,
          command: [
            'bash', '-c',
            `pip install -r requirements.txt -t /asset-output && cp -r . /asset-output`
          ],
        },
      }),
      timeout: Duration.seconds(600),
      role: policyRetrievalLambdaFunctionRole,
      environment: {
        'KB_ID': kb.knowledgeBaseId,
        'REGION': this.region
      }
    });
    
    // Output the Lambda function name
    new cdk.CfnOutput(this, 'PolicyRetrievalFromKBLambdaFunction', {
        value: policyRetrieveLambdaFunction.functionName,
        description: 'The name of the Policy Retrieve Lambda Function',
    });

    // Policy Retrieval Action Group
    const policyRetrieveActionGroup = new bedrock.AgentActionGroup(this, 'PolicyRetrievalActionGroup', {
      actionGroupName: 'PolicyRetrievalActionGroup',
      description: 'Action group for policy retrieval',
      actionGroupExecutor: {
        lambda: policyRetrieveLambdaFunction,
      },
      actionGroupState: 'ENABLED',
      apiSchema: bedrock.ApiSchema.fromAsset(
        path.join(__dirname, '..', './actions/policylookup/policylookup_spec.json')
      ),
    });
    
    // Define the Policy  Agent
    const policyorchestration = readFileSync("prompts/policyorchestration.txt", "utf-8");
    const PolicyAgent = new bedrock.Agent(this, "PolicyBedrockAgent", {
        name: "PolicyBedrockAgent",
        instruction: "You are a knowledgeable and helpful virtual assistant for insurance policy questions. ",
        foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_HAIKU_V1_0,
        description: 'PolicyBedrockAgent',
        idleSessionTTL: cdk.Duration.minutes(60),
        shouldPrepareAgent: true,
        enableUserInput: true,
        promptOverrideConfiguration: {
          promptConfigurations:[
            {
               promptType: bedrock.PromptType.ORCHESTRATION,
               basePromptTemplate: policyorchestration,
               promptState: bedrock.PromptState.ENABLED,
               promptCreationMode: bedrock.PromptCreationMode.OVERRIDDEN,
               inferenceConfiguration: {
                  temperature: 0.0,
                  topP: 0.44,
                  topK: 250,
                  maximumLength: 4096,
                  stopSequences: ["</invoke>", "</answer>", "</error>"],
                },
            },
          ]
        }
        
    });
    
    PolicyAgent.addActionGroup(policyRetrieveActionGroup);
    
    //Output 
    new cdk.CfnOutput(this, 'PolicyBedrockAgentId', { value: PolicyAgent.agentId });
    
    
    // Create "Create Claims and Fraud Detection APIs" Lambda function
    const createClaimsLambdaFunction = new lambda.Function(this, 'createClaimsLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_10,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'actions', 'createclaims_detectfraud')),
      timeout: Duration.seconds(600),
      role: createClaimsLambdaFunctionRole,
    });
    
    // Output the Lambda function name
    new cdk.CfnOutput(this, 'CreateClaimsLambdaFunction', {
        value: createClaimsLambdaFunction.functionName,
        description: 'The name of the Create Claims and Fraud detection Lambda Function',
    });
    
    // Create Claims and Fraud Detection Action Group
    const claimCreationFraudDetectionActionGroup = new bedrock.AgentActionGroup(this, 'ClaimCreateDetectFraudActionGroup', {
      actionGroupName: 'ClaimCreateDetectFraudActionGroup',
      description: 'Action group for creating claims and  fraud detection',
      actionGroupExecutor: {
        lambda: createClaimsLambdaFunction,
      },
      actionGroupState: 'ENABLED',
      apiSchema: bedrock.ApiSchema.fromAsset(
        path.join(__dirname, '..' , './actions/createclaims_detectfraud/claimsfrauddetection_spec.json')
      ),
    });
    
    
     // "Invoke Damage Agent" Lambda function from Insurance Orchestrator
    const invokeDamageAgentLambdaFunction = new lambda.Function(this, 'invokeDamageAgentLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_10,
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'actions', 'invoke_damageagent')),
      handler: 'index.lambda_handler',
      timeout: Duration.seconds(600),
      role: invokeDamageAgentlambdaFunctionRole,
      environment: {
        'DamageAnalysis_Agent_ID': DamageAnalysisNotificationAgent.agentId 
      }
    });
    
    // Output the Lambda function name
    new cdk.CfnOutput(this, 'InvokeDamageAgentLambdaFunction', {
        value: invokeDamageAgentLambdaFunction.functionName,
        description: 'The name of the Invoke Damage agent Lambda Function',
    });
    
    // add the action group for invoking the DamageNotification Agent from the InsuranceOrchestrator Agent
    const invokeDamageAgentActionGroup = new bedrock.AgentActionGroup(this, 'InvokeDamageAgentActionGroup', {
      actionGroupName: 'InvokeDamageAgentActionGroup',
      description: 'Action to Invoke Damage Analysis Agent',
      actionGroupExecutor: {
        lambda: invokeDamageAgentLambdaFunction,
      },
      actionGroupState: 'ENABLED',
      apiSchema: bedrock.ApiSchema.fromAsset(
        path.join(__dirname, '..' , './actions/invoke_damageagent/invokedamageagent_spec.json')
      ),
    });
    
    
    
    // "Invoke Policy Agent" Lambda function from Insurance Orchestrator
    const invokePolicyAgentLambdaFunction = new lambda.Function(this, 'invokePolicyAgentLambdaFunction', {
      runtime: lambda.Runtime.PYTHON_3_10,
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'actions', 'invoke_policyagent')),
      handler: 'index.lambda_handler',
      timeout: Duration.seconds(600),
      role: invokePolicyAgentlambdaFunctionRole,
      environment: {
        'Policy_Agent_ID': PolicyAgent.agentId
      }
    });
    
    // Output the Lambda function name
    new cdk.CfnOutput(this, 'InvokePolicyAgentLambdaFunction', {
        value: invokePolicyAgentLambdaFunction.functionName,
        description: 'The name of the Invoke Policy agent Lambda Function',
    });
    
    // add the action group for invoking the Policy Agent from the InsuranceOrchestrator Agent
    const invokePolicyAgentActionGroup = new bedrock.AgentActionGroup(this, 'InvokePolicyAgentActionGroup', {
      actionGroupName: 'InvokePolicyAgentActionGroup',
      description: 'Action to Invoke Policy Agent',
      actionGroupExecutor: {
        lambda: invokePolicyAgentLambdaFunction,
      },
      actionGroupState: 'ENABLED',
      apiSchema: bedrock.ApiSchema.fromAsset(
        path.join(__dirname, '..' , './actions/invoke_policyagent/invokepolicyagent_spec.json')
      ),
    });
    
    // Define the Insurance Orchestrator Agent
    const orchestration = readFileSync("prompts/insuranceorchestration.txt", "utf-8");
    const InsuranceOrchestratorAgent = new bedrock.Agent(this, "InsuranceOrchestratorBedrockAgent", {
      name: "InsuranceOrchestratorBedrockAgent",
      instruction: "You are a helpful virtual assistant whose goal is to provide courteous and human-like responses while helping customers file insurance claims, detect fraud before filing claims, assess damages, and to answer questions related to the customer’s insurance policy. ",
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_HAIKU_V1_0,
      description: 'Insurance Orchestrator Bedrock Agent',
      idleSessionTTL: Duration.minutes(60),
      shouldPrepareAgent: true,
      enableUserInput: true,
      promptOverrideConfiguration: {
        promptConfigurations:[
          {
             promptType: bedrock.PromptType.ORCHESTRATION,
             basePromptTemplate: orchestration,
             promptState: bedrock.PromptState.ENABLED,
             promptCreationMode: bedrock.PromptCreationMode.OVERRIDDEN,
             inferenceConfiguration: {
                temperature: 0.0,
                topP: 0.44,
                topK: 250,
                maximumLength: 4096,
                stopSequences: ["</invoke>", "</answer>", "</error>"],
              },
          },
        ]
      }
        
    });

    InsuranceOrchestratorAgent.addActionGroup(claimCreationFraudDetectionActionGroup);
    InsuranceOrchestratorAgent.addActionGroup(invokeDamageAgentActionGroup);
    InsuranceOrchestratorAgent.addActionGroup(invokePolicyAgentActionGroup);

    new ssm.StringParameter(this, 'OrchestratorAgent', {
      parameterName: '/insureassist/insuranceOrchestratorAgentId',
      stringValue: InsuranceOrchestratorAgent.agentId,
    });

    // Output values
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
      destinationBucket: uiHtmlBucket,
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
        HTML_BUCKET_NAME: uiHtmlBucket.bucketName,
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

  }
}
