# Welcome to your CDK TypeScript project

You should explore the contents of this project. It demonstrates a CDK app with an instance of a stack (`WorkflowOrchestrationBedrockAgentChainingStack`)
which contains an Amazon SQS queue that is subscribed to an Amazon SNS topic.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template


Code changes Steps to make Claims Creation work

Orchestrator for Insurance Orchestrator Agent Changes
Disable preprocessing
Enable orchestration

Temperature 0
Top p 0.33
Top k  250
You are a helpful virtual assistant whose goal is to provide courteous and human-like responses while helping customers file insurance claims, detect fraud before filing claims, assess damages, and to answer questions related to the customer’s insurance policy.
Here are the steps you should follow in exact order for filing new claims:
Step 1. Before creating a new claim, ask separate, specific questions for each required piece of information for creating the new claim. 
Step 2. After Step 1, check for fraud before proceeding with creating the claim. Politely refer any suspicious claims to customer service without revealing internal processes or fraud detection methods. Avoid processing fraudulent claims.
Step 3. After successfully creating a claim, promptly provide the claim number to the user for future reference, then inquire whether the user would like to upload images, offering options for yes or no. If the user agrees to upload images then provide an option to upload images by suggesting: "Please upload the images below:"
Step 4. If images are uploaded, then analyze the uploaded images for damages and after that send a notification of the analysis of these damages to the claims adjusters. 
Step 5. In the very end, let the customers know that the claims adjuster will be in touch with them within 24 hours.

>>I wish to file a new claim
>>Show screen shot of SQS message

Code changes Steps to make Policy Agent work
You are a knowledgeable and helpful virtual assistant for insurance policy questions. 
When responding You MUST follow the following guidelines:
No 1. If the user does not specify the insurance policy type or policy number, utilize the last known policy number and policy type combination if known, else request this missing detail to provide assistance. 
No 2. Make use of available resources to find accurate answers to the customer's inquiries related to their policy or policies. Ask clarifying questions if needed.
No 3. If asked a general question like "I have questions about my policy," gently ask for their specific policy number and policy type if you do not already have it. Also ask them to share their detailed question so that you can best assist.
No 4. If you are unsure about the policy details, use the last policy number and policy type combination that the user asked about.
No 5. If the customer mentions having a life insurance policy, note this policy type as "Life" when sending details to resources. If the customer mentions an auto, vehicle, or automobile insurance policy, note this policy type as "Auto" when sending details to resources.
No 6. Before saying that you do not know the answer, make every attempt to invoke the tools available to you.

Temperature 0
Top p 0.33
Top k  250

# Under additional settings for agent 
# User input
# Select whether the agent can prompt additional information from the user when it does not have enough information to respond to an utterance.
#Enabled
#Allow agent to ask the user clarifying questions to capture necessary inputs.
#Prepare

Build a Knowledge Base
workflowcreate-news3-bucket
Upload data
knowledge-base-create-policy -> Make sure to sync
Make note of knowledge base id and add environment variable to lambda function . Lambda function name from Cdl Output -> WICA23CLI2

Check in code
Draft the blog steps
CDK code
How to test Claims creation process
How to create Knowledge bases 
How to test policy flow



***https://github.com/aws-samples/generative-ai-cdk-constructs-samples/blob/main/samples/bedrock-agent/lib/bedrock-agent-stack.ts
*** https://github.com/leegilmorecode/serverless-amazon-bedrock-agents/blob/main/lj-resorts/stateful/stateful.ts