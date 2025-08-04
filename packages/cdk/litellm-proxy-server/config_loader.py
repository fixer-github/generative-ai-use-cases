#!/usr/bin/env python3
"""
Dynamic configuration loader for LiteLLM Proxy Server with KMS/Secrets Manager integration.
"""

import os
import json
import yaml
import boto3
from typing import Dict, Any, Optional


class ConfigLoader:
    """Loads LiteLLM configuration dynamically from KMS-encrypted secrets."""
    
    def __init__(self):
        self.use_dynamic_config = os.environ.get('USE_DYNAMIC_CONFIG', 'false').lower() == 'true'
        self.kms_key_arn = os.environ.get('KMS_KEY_ARN', '')
        self.secrets_prefix = os.environ.get('SECRETS_PREFIX', 'litellm/')
        self.litellm_config = os.environ.get('LITELLM_CONFIG', '')
        self.region = os.environ.get('AWS_REGION', 'us-east-1')
        
        if self.use_dynamic_config:
            self.secrets_client = boto3.client('secretsmanager', region_name=self.region)
    
    def load_config(self) -> Dict[str, Any]:
        """Load configuration from either static file or dynamic secrets."""
        if not self.use_dynamic_config:
            # Load static configuration from config.yaml
            with open('config.yaml', 'r') as f:
                return yaml.safe_load(f)
        
        # Load dynamic configuration
        config = self._get_base_config()
        
        # Load provider secrets and update model list
        model_list = []
        providers = self._get_enabled_providers()
        
        for provider_name, provider_config in providers.items():
            if not provider_config.get('enabled', False):
                continue
            
            # Get API key from Secrets Manager if needed
            api_key = None
            if 'secretKey' in provider_config and provider_name != 'bedrock':
                api_key = self._get_secret(f"{self.secrets_prefix}{provider_name}/api-key")
            
            # Add models for this provider
            models = self._get_provider_models(provider_name, provider_config, api_key)
            model_list.extend(models)
        
        config['model_list'] = model_list
        
        # Get master key from Secrets Manager
        master_key = self._get_secret(f"{self.secrets_prefix}master-key")
        if master_key:
            config['general_settings']['master_key'] = master_key
        
        return config
    
    def _get_base_config(self) -> Dict[str, Any]:
        """Get base configuration structure."""
        return {
            'model_list': [],
            'general_settings': {
                'master_key': 'sk-litellm-master-key',  # Default, will be overridden
                'database_url': None,
            },
            'litellm_settings': {
                'success_callback': [],
                'failure_callback': [],
                'cache': False,
                'cache_params': None,
                'default_team_settings': None,
            },
            'health_check': True,
        }
    
    def _get_enabled_providers(self) -> Dict[str, Any]:
        """Get enabled providers from environment configuration."""
        if self.litellm_config:
            config = json.loads(self.litellm_config)
            return config.get('providers', {})
        return {}
    
    def _get_provider_models(self, provider_name: str, provider_config: Dict[str, Any], api_key: Optional[str]) -> list:
        """Generate model configurations for a provider."""
        models = []
        
        if provider_name == 'openai' and api_key:
            models.extend([
                {
                    'model_name': 'gpt-4',
                    'litellm_params': {
                        'model': 'gpt-4',
                        'api_key': api_key,
                    }
                },
                {
                    'model_name': 'gpt-3.5-turbo',
                    'litellm_params': {
                        'model': 'gpt-3.5-turbo',
                        'api_key': api_key,
                    }
                }
            ])
        
        elif provider_name == 'anthropic' and api_key:
            models.extend([
                {
                    'model_name': 'claude-3-opus',
                    'litellm_params': {
                        'model': 'claude-3-opus-20240229',
                        'api_key': api_key,
                    }
                },
                {
                    'model_name': 'claude-3-sonnet',
                    'litellm_params': {
                        'model': 'claude-3-sonnet-20240229',
                        'api_key': api_key,
                    }
                }
            ])
        
        elif provider_name == 'bedrock':
            # Bedrock uses IAM authentication
            models.extend([
                {
                    'model_name': 'claude-3-5-sonnet',
                    'litellm_params': {
                        'model': 'bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0',
                        'aws_region_name': self.region,
                        'aws_access_key_id': None,
                        'aws_secret_access_key': None,
                    }
                },
                {
                    'model_name': 'claude-3-5-haiku',
                    'litellm_params': {
                        'model': 'bedrock/anthropic.claude-3-5-haiku-20241022-v1:0',
                        'aws_region_name': self.region,
                        'aws_access_key_id': None,
                        'aws_secret_access_key': None,
                    }
                },
                {
                    'model_name': 'nova-pro',
                    'litellm_params': {
                        'model': 'bedrock/amazon.nova-pro-v1:0',
                        'aws_region_name': self.region,
                        'aws_access_key_id': None,
                        'aws_secret_access_key': None,
                    }
                }
            ])
        
        elif provider_name == 'azure' and api_key:
            endpoint = provider_config.get('endpoint', '')
            if endpoint:
                models.append({
                    'model_name': 'azure-gpt-4',
                    'litellm_params': {
                        'model': 'azure/gpt-4',
                        'api_base': endpoint,
                        'api_key': api_key,
                        'api_version': '2023-05-15',
                    }
                })
        
        elif provider_name == 'google' and api_key:
            models.append({
                'model_name': 'gemini-pro',
                'litellm_params': {
                    'model': 'gemini-pro',
                    'api_key': api_key,
                }
            })
        
        elif provider_name == 'cohere' and api_key:
            models.append({
                'model_name': 'command-r-plus',
                'litellm_params': {
                    'model': 'cohere/command-r-plus',
                    'api_key': api_key,
                }
            })
        
        return models
    
    def _get_secret(self, secret_id: str) -> Optional[str]:
        """Retrieve a secret from AWS Secrets Manager."""
        try:
            response = self.secrets_client.get_secret_value(SecretId=secret_id)
            return response.get('SecretString', '')
        except Exception as e:
            print(f"Warning: Could not retrieve secret {secret_id}: {e}")
            return None
    
    def save_config(self, config: Dict[str, Any], filepath: str = 'config.yaml'):
        """Save configuration to file."""
        with open(filepath, 'w') as f:
            yaml.dump(config, f, default_flow_style=False)
        print(f"Configuration saved to {filepath}")


if __name__ == "__main__":
    # Load and save configuration
    loader = ConfigLoader()
    config = loader.load_config()
    
    if loader.use_dynamic_config:
        # Save the dynamically loaded configuration
        loader.save_config(config)
        print("Dynamic configuration loaded and saved successfully")
    else:
        print("Using static configuration")