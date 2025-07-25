def handler(event, context):
    user_attributes = event["request"]["userAttributes"]
    tenant_id = user_attributes.get("custom:tenant_id")
    
    if tenant_id:
        event["response"]["claimsAndScopeOverrideDetails"] = {
            "idTokenGeneration": {
                "claimsToAddOrOverride": {
                    "https://aws.amazon.com/tags": {
                        "principal_tags": {"TenantID": [tenant_id]}
                    }
                }
            }
        }
    return event
