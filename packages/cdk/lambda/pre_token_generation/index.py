import json

def handler(event, context):
    """
    Cognito Pre Token Generation trigger (V2) to add tenant ID to session tags.
    This enables tag-based ABAC with IAM policies using PrincipalTag.
    """
    try:
        print(f"Pre Token Generation Event: {json.dumps(event, indent=2)}")
        
        user_attributes = event["request"]["userAttributes"]
        tenant_id = user_attributes.get("custom:tenant_id", "default")
        
        # AWS expects the tags as a properly formatted object, not a JSON string
        # Based on AWS documentation, the structure should be directly in the claim
        event["response"]["claimsAndScopeOverrideDetails"] = {
            "idTokenGeneration": {
                "claimsToAddOrOverride": {
                    # Add tenant ID as a regular claim for application use
                    "custom:tenant_id": tenant_id,
                    # Add AWS session tags claim for ABAC
                    # AWS Cognito handles the serialization automatically
                    "https://aws.amazon.com/tags": {
                        "principal_tags": {
                            "TenantID": [tenant_id]
                        },
                        "transitive_tag_keys": ["TenantID"]
                    }
                }
            },
            "accessTokenGeneration": {
                "claimsToAddOrOverride": {
                    "custom:tenant_id": tenant_id
                }
            }
        }
        
        print(f"Token generation response: {json.dumps(event['response'], indent=2)}")
        return event
        
    except Exception as e:
        print(f"Error in pre-token generation: {str(e)}")
        # Return the event unchanged to avoid breaking authentication
        return event
