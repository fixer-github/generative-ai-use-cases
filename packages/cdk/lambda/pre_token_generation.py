def lambda_handler(event, context):
    tenant_id: str = event["request"]["user_attributes"]["custom:tenant_id"]

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
