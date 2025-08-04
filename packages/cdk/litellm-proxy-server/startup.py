#!/usr/bin/env python3

import os
import subprocess
import sys
from config_loader import ConfigLoader


def main():
    """Main startup function"""
    print("Starting LiteLLM Proxy Server...")
    
    # Load configuration dynamically if KMS is enabled
    use_dynamic_config = os.environ.get("USE_DYNAMIC_CONFIG", "false").lower() == "true"
    
    if use_dynamic_config:
        print("Loading dynamic configuration from KMS/Secrets Manager...")
        loader = ConfigLoader()
        config = loader.load_config()
        loader.save_config(config)
        print("Dynamic configuration loaded successfully")
    else:
        print("Using static configuration from config.yaml")
    
    # Set environment variables for LiteLLM
    os.environ["LITELLM_LOG"] = os.environ.get("LITELLM_LOG", "INFO")
    
    # Get port from Lambda Web Adapter
    port = os.environ.get("AWS_LWA_PORT", "8000")
    host = os.environ.get("HOST", "0.0.0.0")
    
    print(f"Starting LiteLLM server on {host}:{port}")
    print(f"Using config file: ./config.yaml")
    
    # Start LiteLLM proxy server using the CLI command
    cmd = [
        "litellm",
        "--port", port,
        "--host", host,
        "--config", "./config.yaml"
    ]
    
    print(f"Running command: {' '.join(cmd)}")
    
    # Run the command
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error starting LiteLLM proxy server: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()