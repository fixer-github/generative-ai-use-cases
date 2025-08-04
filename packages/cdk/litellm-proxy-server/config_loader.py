#!/usr/bin/env python3
"""
Dynamic configuration loader for LiteLLM Proxy Server with KMS/Secrets Manager integration.
"""

import os
import json
import yaml
import boto3
from typing import Dict, Any, Optional, List


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
        
        # Load provider configuration from LITELLM_CONFIG
        if self.litellm_config:
            config_data = json.loads(self.litellm_config)
            
            # Process providers and their models
            providers = config_data.get('providers', {})
            model_list = []
            
            for provider_name, provider_config in providers.items():
                if not provider_config.get('enabled', False):
                    continue
                
                # Get models configuration from provider config
                models = provider_config.get('models', [])
                
                # Get API key from Secrets Manager if needed
                api_key = None
                if provider_config.get('useSecretKey', False) and provider_name != 'bedrock':
                    secret_key = provider_config.get('secretKey', f"{self.secrets_prefix}{provider_name}/api-key")
                    api_key = self._get_secret(secret_key)
                
                # Process each model configuration
                for model in models:
                    model_config = self._process_model_config(model, provider_name, api_key, provider_config)
                    if model_config:
                        model_list.append(model_config)
            
            config['model_list'] = model_list
            
            # Load general settings if provided
            if 'general_settings' in config_data:
                config['general_settings'].update(config_data['general_settings'])
            
            # Load litellm settings if provided
            if 'litellm_settings' in config_data:
                config['litellm_settings'].update(config_data['litellm_settings'])
            
            # Load router settings if provided
            if 'router_settings' in config_data:
                config['router_settings'] = config_data['router_settings']
            
            # Load model aliases if provided
            if 'model_alias' in config_data:
                config['model_alias'] = config_data['model_alias']
        
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
    
    def _process_model_config(
        self, 
        model: Dict[str, Any], 
        provider_name: str, 
        api_key: Optional[str],
        provider_config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Process a single model configuration."""
        model_config = {
            'model_name': model.get('name'),
            'litellm_params': {}
        }
        
        # Copy litellm_params if provided
        if 'litellm_params' in model:
            model_config['litellm_params'].update(model['litellm_params'])
        
        # Set model if not already set
        if 'model' not in model_config['litellm_params']:
            model_config['litellm_params']['model'] = model.get('model', model.get('name'))
        
        # Add API key for non-bedrock providers
        if api_key and provider_name != 'bedrock':
            model_config['litellm_params']['api_key'] = api_key
        
        # Add provider-specific settings
        if provider_name == 'bedrock':
            # Bedrock uses IAM authentication
            model_config['litellm_params'].update({
                'aws_region_name': provider_config.get('region', self.region),
                'aws_access_key_id': None,
                'aws_secret_access_key': None,
            })
        elif provider_name == 'azure':
            # Azure needs endpoint
            if 'endpoint' in provider_config:
                model_config['litellm_params']['api_base'] = provider_config['endpoint']
            if 'api_version' in provider_config:
                model_config['litellm_params']['api_version'] = provider_config['api_version']
        elif provider_name == 'google' and 'vertex_config' in provider_config:
            # Google Vertex AI configuration
            vertex_config = provider_config['vertex_config']
            model_config['litellm_params'].update({
                'vertex_project': vertex_config.get('project'),
                'vertex_location': vertex_config.get('location', 'us-central1'),
            })
        
        # Copy any additional parameters from model config
        for key, value in model.items():
            if key not in ['name', 'model', 'litellm_params']:
                model_config[key] = value
        
        return model_config
    
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