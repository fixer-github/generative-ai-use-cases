import json

def handler(event, context):
    """
    Cognito Pre Token Generation trigger (V2) to add tenant ID to session tags.
    This enables tag-based ABAC with IAM policies using PrincipalTag.
    """
    print(f"Pre Token Generation Event: {json.dumps(event, indent=2)}")
    
    user_attributes = event["request"]["userAttributes"]
    tenant_id = user_attributes.get("custom:tenant_id", "default")
    
    # The response structure for V2_0 triggers
    event["response"]["claimsAndScopeOverrideDetails"] = {
        "idTokenGeneration": {
            "claimsToAddOrOverride": {
                # Add tenant ID as a regular claim for application use
                "custom:tenant_id": tenant_id,
                # Add AWS session tags claim for ABAC
                # This must be a JSON string, not an object
                "https://aws.amazon.com/tags": json.dumps({
                    "principal_tags": {
                        "TenantID": [tenant_id]
                    },
                    "transitive_tag_keys": ["TenantID"]
                })
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
