import json
import logging
import random
import string
import boto3
import uuid
import time
import pprint
import json
import botocore
import os

#This was initially being invoked by Bedrock agent
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize the Bedrock agent runtime client
config = botocore.config.Config(
    read_timeout=900,
    connect_timeout=900,
    retries={"max_attempts": 0}
)
# Initialize the Bedrock agent runtime client
bedrock_agent_runtime_client = boto3.client('bedrock-agent-runtime',config=config)

model_id = "anthropic.claude-v2:1" 
region_id = os.environ['REGION'] 
kb_id = os.environ['KB_ID'] # replace it with the Knowledge base id.

def retrieveAndGenerate(question, policytype, policynumber, kbId, modelId, regionId, sessionId = None):
    model_arn = f'arn:aws:bedrock:{regionId}::foundation-model/{modelId}'
    if sessionId:
        return bedrock_agent_runtime_client.retrieve_and_generate(
            input={
                'text': question
            },
            retrieveAndGenerateConfiguration={
                'type': 'KNOWLEDGE_BASE',
                'knowledgeBaseConfiguration': {
                    'knowledgeBaseId': kbId,
                    'modelArn': model_arn,
                    'retrievalConfiguration': {
                        'vectorSearchConfiguration': {
                            'filter': {
                                "andAll": [
                                    {
                                        "equals": {
                                            "key": "type",
                                            "value": policytype
                                        }
                                    },
                                    {
                                        "startsWith": {
                                            "key": "policynumber",
                                            "value": policynumber
                                        }
                                    }
                                ]
                            },
                            'numberOfResults': 10,  # Assuming a number of results
                        }
                    }
                }
            },
            sessionId=sessionId
        )
    else:
        return bedrock_agent_runtime_client.retrieve_and_generate(
            input={
                'text': question
            },
            retrieveAndGenerateConfiguration={
                'type': 'KNOWLEDGE_BASE',
                'knowledgeBaseConfiguration': {
                    'knowledgeBaseId': kbId,
                    'modelArn': model_arn,
                    'retrievalConfiguration': {
                        'vectorSearchConfiguration': {
                            'filter': {
                                "andAll": [
                                    {
                                        "equals": {
                                            "key": "type",
                                            "value": policytype
                                        }
                                    },
                                    {
                                        "startsWith": {
                                            "key": "policynumber",
                                            "value": policynumber
                                        }
                                    }
                                ]
                            },
                            'numberOfResults': 10,  # Assuming a number of results
                        }
                    }
                }
            }
        )

def lambda_handler(event, context):
    logger.info('Lambda Event Request:')
    logger.info(json.dumps(event))
    logger.info(context)
    result = ''
    response_code = 200
    action_group = event['actionGroup']
    api_path = event['apiPath']
    http_method = event['httpMethod']
    # sessionId =  event['sessionId'] #this will be used by BA2's context
    
    
    if api_path == '/retrievePolicyDetails':
        data = {
        "question":"",
        "policytype": "",
        "policynumber": ""
        }
        # Extracting claim details from the parsed JSON
        logger.info(event['requestBody']['content']['application/json']['properties'])
        for policy_details in event['requestBody']['content']['application/json']['properties']:
            if policy_details['type'] == 'string':
                data[policy_details['name']] = policy_details['value']
            else:
                data[policy_details['name']] = json.loads(policy_details['value'])
        policytype = data['policytype']           
        policynumber = data['policynumber']
        question = data['question']
        # question = event['inputText']
        
        
        try:
            response = retrieveAndGenerate(question,policytype,policynumber,kb_id,model_id,region_id)
            generated_text = response['output']['text']
            logger.info(generated_text)
            citations = response["citations"]
            contexts = []
            for citation in citations:
                retrievedReferences = citation["retrievedReferences"]
                for reference in retrievedReferences:
                     contexts.append(reference["content"]["text"])
            logger.info(contexts)
        except Exception as e:
            logger.error("An error occurred: {}".format(str(e)))
            generated_text = None
            contexts = None
                
        body = {
            "results": generated_text,
            "contexts": contexts
        }
        
    else:
        response_code = 404
        result = f"Unrecognized api path: {action_group}::{api_path}"
        
    response_body = {
        'application/json': {
            'body': json.dumps(body)
        }
    }
        
    action_response = {
        'actionGroup': action_group,
        'apiPath': api_path,
        'httpMethod': http_method,
        'httpStatusCode': response_code,
        'responseBody': response_body
    }

    api_response = {'messageVersion': '1.0', 'response': action_response}
    return api_response

