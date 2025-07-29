import json
import os
import boto3
from datetime import datetime

sts_client = boto3.client('sts')

def handler(event, context):
    user_attributes = event["request"]["userAttributes"]
    tenant_id = user_attributes.get("custom:tenant_id")
    
    if tenant_id:
        # マルチテナントロールARNを環境変数から取得
        multi_tenant_role_arn = os.environ.get('MULTI_TENANT_ROLE_ARN')
        
        if multi_tenant_role_arn:
            try:
                # STSを使用してマルチテナントロールを引き受ける
                assumed_role_response = sts_client.assume_role(
                    RoleArn=multi_tenant_role_arn,
                    RoleSessionName=f'tenant-{tenant_id}-session-{datetime.now().timestamp()}',
                    ExternalId='multi-tenant-access',
                    Tags=[
                        {
                            'Key': 'TenantID',
                            'Value': tenant_id
                        }
                    ],
                    DurationSeconds=3600  # 1時間
                )
                
                # 取得した一時的な認証情報をカスタムクレームとして追加
                credentials = assumed_role_response['Credentials']
                
                event["response"]["claimsAndScopeOverrideDetails"] = {
                    "idTokenGeneration": {
                        "claimsToAddOrOverride": {
                            "https://aws.amazon.com/tags": {
                                "principal_tags": {"TenantID": [tenant_id]}
                            },
                            # STS認証情報をカスタムクレームとして追加
                            "custom:sts_credentials": json.dumps({
                                "AccessKeyId": credentials['AccessKeyId'],
                                "SecretAccessKey": credentials['SecretAccessKey'],
                                "SessionToken": credentials['SessionToken'],
                                "Expiration": credentials['Expiration'].isoformat()
                            })
                        }
                    }
                }
            except Exception as e:
                print(f"Error assuming role for tenant {tenant_id}: {str(e)}")
                # エラーが発生した場合でも、principal_tagsは設定する
                event["response"]["claimsAndScopeOverrideDetails"] = {
                    "idTokenGeneration": {
                        "claimsToAddOrOverride": {
                            "https://aws.amazon.com/tags": {
                                "principal_tags": {"TenantID": [tenant_id]}
                            }
                        }
                    }
                }
        else:
            # ロールARNが設定されていない場合は、principal_tagsのみ設定
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
