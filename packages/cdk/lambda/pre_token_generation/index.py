import json

def handler(event, context):
    """
    Cognito Pre Token Generation trigger (V2) to add tenant ID to JWT claims.
    This enables Principal Tag mapping in Identity Pool for tag-based ABAC.
    """
    try:
        print(f"Pre Token Generation Event: {json.dumps(event, indent=2)}")
        
        user_attributes = event["request"]["userAttributes"]
        tenant_id = user_attributes.get("custom:tenant_id", "default")
        
        # Add tenant ID as a custom claim for application use
        # Identity Pool Role Mapping will map this to Principal Tags
        event["response"]["claimsAndScopeOverrideDetails"] = {
            "idTokenGeneration": {
                "claimsToAddOrOverride": {
                    # Add tenant ID as a regular claim for application use
                    "custom:tenant_id": tenant_id
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