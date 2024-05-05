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

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Function to detect fraud
def detect_fraud(description):
    # Placeholder for fraud detection logic
    # Here, we randomly decide whether fraud is detected or not
    is_fraud = random.choice([False, False])
    if is_fraud:
        logger.info("Fraudulent claim detected.")
    else:
        logger.info("No fraud detected.")
    return is_fraud
    
# Function to create a new insurance claim
def create_claim(customer_name, city, zip_code, state, street_address, claim_type, description):

    # Placeholder for claim creation logic
    # This is where you would insert the claim details into the database
    claim_id = 'CLM' + str(random.randint(10000, 99999))  # Generating a random claim ID as an example
    
    # Assuming an agent will contact the customer within 24 hours
    acknowledgment_message = "Your new claim (ID: {}) has been created. An agent will contact you within 24 hours. We assure you that you will be taken care of.".format(claim_id)
    
    # Return the response object with claimId and status
    return {"claimId": claim_id, "status": acknowledgment_message}



def lambda_handler(event, context):
    # create_claim
    # detect_fraud

    
    api_path = event['apiPath']
    logger.info('API Path')
    logger.info(api_path)
    logger.info('Lambda Event Request:')
    logger.info(json.dumps(event))
    
    if api_path == '/create_claim':
        # Parse the JSON string stored in the requestBody field of the event
        
        data = {
        "zipCode": "",
        "description": "",
        "customerName": "",
        "streetAddress": "",
        "claimType" : "",
        "state": "",
        "city":""
        }
        # Extracting claim details from the parsed JSON
        print(event['requestBody']['content']['application/json']['properties'])
        for claim_request in event['requestBody']['content']['application/json']['properties']:
            if claim_request['type'] == 'string':
                data[claim_request['name']] = claim_request['value']
            else:
                data[claim_request['name']] = json.loads(claim_request['value'])
        customer_name = data['customerName']           
        zip_code = data['zipCode']
        state = data['state']
        street_address = data['streetAddress']
        claim_type = data['claimType']
        description = data['description']
        city = data['city']
        
        # Create the claim
        body = create_claim(customer_name, city, zip_code, state, street_address, claim_type, description)

    elif api_path == '/detect_fraud':
            print(event['requestBody']['content']['application/json']['properties'])
            # Placeholder for fraud detection logic
            # For now, returning a random boolean value, but you get the idea.
            data = {
                "zipCode": "",
                "description": "",
                "customerName": "",
                "streetAddress": "",
                "claimType" : "",
                "state": "",
                "city":""
            }
            # Extracting claim details from the parsed JSON
            print(event['requestBody']['content']['application/json']['properties'])
            for claim_request in event['requestBody']['content']['application/json']['properties']:
                if claim_request['type'] == 'string':
                    data[claim_request['name']] = claim_request['value']
                else:
                    data[claim_request['name']] = json.loads(claim_request['value'])
            customer_name = data['customerName']           
            zip_code = data['zipCode']
            state = data['state']
            street_address = data['streetAddress']
            claim_type = data['claimType']
            description = data['description']
            city = data['city']
            is_fraud = detect_fraud(claim_request)
            body = {"isFraud": is_fraud , "zipCode":zip_code,"customerName":customer_name,
                    "state":zip_code,"streetAddress": street_address,"claimType":claim_type,
                    "description":description}
    else:
        body = {"message": "{} is not a valid API. Please try another one.".format(api_path)}
    
    response_body = {
        'application/json': {
            'body': json.dumps(body)
        }
    }

    action_response = {
        'actionGroup': event['actionGroup'],
        'apiPath': event['apiPath'],
        'httpMethod': event['httpMethod'],
        'httpStatusCode': 200,
        'responseBody': response_body
    }

    api_response = {
        'messageVersion': '1.0', 
        'response': action_response
    }
    
    return api_response
