#!/usr/bin/env python3
"""
Test script for the flexible configuration loader
"""

import os
import json
import sys

# Mock boto3 for testing
sys.modules['boto3'] = type(sys)('boto3')
sys.modules['boto3'].client = lambda *args, **kwargs: None

from config_loader import ConfigLoader


def test_static_config():
    """Test loading static configuration from config.yaml"""
    print("Testing static configuration loading...")
    os.environ['USE_DYNAMIC_CONFIG'] = 'false'
    
    loader = ConfigLoader()
    config = loader.load_config()
    
    print(f"Loaded {len(config.get('model_list', []))} models from static config")
    for model in config.get('model_list', []):
        print(f"  - {model['model_name']}")
    
    print("✓ Static configuration test passed\n")


def test_dynamic_config():
    """Test loading dynamic configuration"""
    print("Testing dynamic configuration loading...")
    
    # Set up environment
    os.environ['USE_DYNAMIC_CONFIG'] = 'true'
    
    # Example configuration with flexible model definitions
    test_config = {
        "providers": {
            "bedrock": {
                "enabled": True,
                "region": "us-west-2",
                "models": [
                    {
                        "name": "claude-3-5-sonnet",
                        "model": "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0"
                    },
                    {
                        "name": "nova-pro",
                        "model": "bedrock/amazon.nova-pro-v1:0"
                    },
                    {
                        "name": "llama3-70b",
                        "model": "bedrock/meta.llama3-70b-instruct-v1:0"
                    }
                ]
            },
            "openai": {
                "enabled": True,
                "useSecretKey": True,
                "models": [
                    {
                        "name": "gpt-4-turbo",
                        "model": "gpt-4-turbo-preview"
                    },
                    {
                        "name": "gpt-4o",
                        "model": "gpt-4o"
                    },
                    {
                        "name": "custom-model",
                        "model": "ft:gpt-3.5-turbo:org:custom:12345",
                        "litellm_params": {
                            "temperature": 0.7,
                            "max_tokens": 2000
                        }
                    }
                ]
            }
        },
        "general_settings": {
            "database_url": "postgresql://user:pass@localhost/litellm"
        },
        "router_settings": {
            "routing_strategy": "simple-shuffle",
            "cooldown_time": 30
        },
        "model_alias": {
            "gpt-4": "claude-3-5-sonnet",
            "default": "gpt-4-turbo"
        }
    }
    
    os.environ['LITELLM_CONFIG'] = json.dumps(test_config)
    
    # Mock the secrets retrieval
    loader = ConfigLoader()
    
    # Override _get_secret to return test values
    def mock_get_secret(secret_id):
        if 'openai' in secret_id:
            return 'sk-test-openai-key'
        elif 'master-key' in secret_id:
            return 'sk-test-master-key'
        return None
    
    loader._get_secret = mock_get_secret
    
    # Load configuration
    config = loader.load_config()
    
    # Verify results
    print(f"Loaded {len(config.get('model_list', []))} models from dynamic config")
    for model in config.get('model_list', []):
        print(f"  - {model['model_name']} -> {model['litellm_params']['model']}")
    
    # Check general settings
    assert config['general_settings']['database_url'] == "postgresql://user:pass@localhost/litellm"
    print("✓ General settings loaded correctly")
    
    # Check router settings
    assert config.get('router_settings', {}).get('routing_strategy') == 'simple-shuffle'
    print("✓ Router settings loaded correctly")
    
    # Check model aliases
    assert config.get('model_alias', {}).get('gpt-4') == 'claude-3-5-sonnet'
    print("✓ Model aliases loaded correctly")
    
    # Check API key injection
    openai_models = [m for m in config['model_list'] if 'gpt' in m['model_name']]
    if openai_models:
        assert openai_models[0]['litellm_params'].get('api_key') == 'sk-test-openai-key'
        print("✓ API keys injected correctly")
    
    print("✓ Dynamic configuration test passed\n")


def test_edge_cases():
    """Test edge cases and error handling"""
    print("Testing edge cases...")
    
    # Test with empty provider list
    os.environ['USE_DYNAMIC_CONFIG'] = 'true'
    os.environ['LITELLM_CONFIG'] = json.dumps({"providers": {}})
    
    loader = ConfigLoader()
    config = loader.load_config()
    
    assert len(config.get('model_list', [])) == 0
    print("✓ Empty provider list handled correctly")
    
    # Test with disabled providers
    os.environ['LITELLM_CONFIG'] = json.dumps({
        "providers": {
            "openai": {
                "enabled": False,
                "models": [{"name": "gpt-4", "model": "gpt-4"}]
            }
        }
    })
    
    config = loader.load_config()
    assert len(config.get('model_list', [])) == 0
    print("✓ Disabled providers ignored correctly")
    
    print("✓ Edge case tests passed\n")


if __name__ == "__main__":
    try:
        test_static_config()
        test_dynamic_config()
        test_edge_cases()
        print("All tests passed! ✨")
    except Exception as e:
        print(f"Test failed: {e}")
        sys.exit(1)