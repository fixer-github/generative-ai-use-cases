def lambda_handler(event, context):
    event["response"]["claimsAndScopeOverrideDetails"] = {
        "idTokenGeneration": {
            "claimsToAddOrOverride": {
                "https://aws.amazon.com/tags": {
                    "principal_tags": {"TenantID": ["<TENANT_ID>"]}
                }
            }
        }
    }
    return event
