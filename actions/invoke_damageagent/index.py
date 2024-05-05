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


def lambda_handler(event, context):
    logger.info('Lambda Event Request:')
    logger.info(json.dumps(event))
    logger.info(context)
    result = ''
    response_code = 200
    action_group = event['actionGroup']
    api_path = event['apiPath']
    http_method = event['httpMethod']
    print("api_path: ", api_path )
    
    # Agent Alias Id of the DamageAnalysis_Agent
    agent_id = os.environ['DamageAnalysis_Agent_ID']
    agent_alias_id = 'TSTALIASID'
    
    enable_trace = False
    end_session = False
    
    if api_path == '/invokeDamageAnalysisAgent':
        data = {
        "claim_id":"",
        "image_path": ""
        }
        
        # Extracting details from the parsed JSON
        print(event['requestBody']['content']['application/json']['properties'])
        for damage_request in event['requestBody']['content']['application/json']['properties']:
            if damage_request['type'] == 'string':
                data[damage_request['name']] = damage_request['value']
            else:
                data[damage_request['name']] = json.loads(damage_request['value'])
        
        claim_id = data['claim_id']           
        image_path = data['image_path']
      
        # At this point we have all the data needed to call DamageAnalysis_Agent 
        # Define your additional session attributes if needed
        promptSessionAttributes = { 
            "claim_id": claim_id,
            "image_path": image_path
        }
        
        request_body = {
            "inputText": json.dumps({
                "parameters": {
                    "claim_id": claim_id, # These will be sent to the action group. 
                    "image_path": image_path
                }
            }),
            "agentId": agent_id,
            "agentAliasId": agent_alias_id,
            "sessionId": event['sessionId'], #this will be used by BA2's context
            "enableTrace": enable_trace,
            "endSession": end_session,
            "sessionState": {
                "promptSessionAttributes": promptSessionAttributes
            }
        } 
        
        try:
            # Invoke the agent API
            print(f"Invoking DamageAnalysis_Agent for Session:: {event['sessionId']}...................")
            print(request_body)
            agent_response = bedrock_agent_runtime_client.invoke_agent(**request_body)
            # print("agent_response ::::.......")
            # logger.info(pprint.pprint(agent_response))
    
            # Process the response
            event_stream = agent_response['completion']
            for event in event_stream:
                if 'chunk' in event:
                    print("in chunk....")
                    data = event['chunk']['bytes']
                    logger.info(f"Final answer ->\n{data.decode('utf8')}")
                    agent_answer = data.decode('utf8')
                    end_event_received = True
                elif 'trace' in event:
                    print("in trace...")
                    logger.info(json.dumps(event['trace'], indent=2))
                else:
                    raise Exception("Unexpected event.", event)
        except Exception as e:
            logger.error("An error occurred: {}".format(str(e)))
                
        body = {
            "status": agent_answer
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

