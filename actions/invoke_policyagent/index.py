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
    
    # Extract the agentAliasId from the response
    agent_id = os.environ['Policy_Agent_ID']
    agent_alias_id = 'TSTALIASID'
    
    enable_trace = False
    end_session = False
    
    if api_path == '/invokePolicyInformationAgent':
        data = {
            "user_info":""
        }
        
        # Extracting the conversation/question input by the end user from the parsed JSON
        print(event['requestBody']['content']['application/json']['properties'])
        for info in event['requestBody']['content']['application/json']['properties']:
            if info['type'] == 'string':
                data[info['name']] = info['value']
            else:
                data[info['name']] = json.loads(info['value'])
                
        user_info = data['user_info']           

        request_body = {
            "inputText": user_info,
            "agentId": agent_id,
            "agentAliasId": agent_alias_id,
            "sessionId": event['sessionId'], #this will be used by BA2's context
            "enableTrace": enable_trace,
            "endSession": end_session
        } #end of requestbody sent to BA2
        
        try:
            # Invoke the agent API
            print(f"Invoking The Policy Info Agent for Session:: {event['sessionId']}...................")
            print(request_body)
            agent_response = bedrock_agent_runtime_client.invoke_agent(**request_body)
    
            logger.info(pprint.pprint(agent_response))
    
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
            "results": agent_answer
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

