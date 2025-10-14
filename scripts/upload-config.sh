#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script to encode and upload configuration files to GitHub Secrets

show_usage() {
    cat << EOF
Usage: $0 [OPTIONS] [config-file-path]

Upload CDK or LiteLLM configuration to GitHub Secrets as base64-encoded string.

Arguments:
    [config-file-path]  Path to configuration file
                        - For CDK: packages/cdk/cdk.json (default)
                        - For LiteLLM: packages/cdk/litellm-proxy-server/config.yaml (default)

Options:
    -h, --help          Show this help message
    -t, --type TYPE     Configuration type: 'cdk' or 'litellm' (default: cdk)
    -o, --output        Output base64 string to stdout instead of uploading
    -s, --secret-name   GitHub secret name (overrides default)
                        - CDK default: CDK_CONFIG_BASE64
                        - LiteLLM default: LITELLM_CONFIG_BASE64

Examples:
    # Upload cdk.json from default location
    $0
    $0 --type cdk

    # Upload LiteLLM config.yaml from default location
    $0 --type litellm

    # Upload custom cdk.json file
    $0 --type cdk /path/to/custom-cdk.json

    # Upload custom LiteLLM config
    $0 --type litellm /path/to/custom-config.yaml

    # Output base64 without uploading
    $0 --type cdk --output
    $0 --type litellm --output

    # Use custom secret name
    $0 --type cdk --secret-name MY_CDK_CONFIG

Requirements:
    - GitHub CLI (gh) must be installed and authenticated
    - base64 command must be available
    - jq for JSON validation (optional but recommended)

Notes:
    - LiteLLM configuration is only needed when litellmProxyEnabled: true in cdk.json
    - Keep config files secure and never commit them to version control

EOF
}

# Default values
CONFIG_TYPE="cdk"
CONFIG_PATH=""
SECRET_NAME=""
OUTPUT_ONLY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            show_usage
            exit 0
            ;;
        -t|--type)
            CONFIG_TYPE="$2"
            if [[ "$CONFIG_TYPE" != "cdk" && "$CONFIG_TYPE" != "litellm" ]]; then
                echo -e "${RED}Error: Invalid type '$CONFIG_TYPE'. Must be 'cdk' or 'litellm'${NC}"
                exit 1
            fi
            shift 2
            ;;
        -o|--output)
            OUTPUT_ONLY=true
            shift
            ;;
        -s|--secret-name)
            SECRET_NAME="$2"
            shift 2
            ;;
        -*)
            echo -e "${RED}Error: Unknown option $1${NC}"
            show_usage
            exit 1
            ;;
        *)
            CONFIG_PATH="$1"
            shift
            ;;
    esac
done

# Set defaults based on type
if [[ -z "$CONFIG_PATH" ]]; then
    if [[ "$CONFIG_TYPE" == "cdk" ]]; then
        CONFIG_PATH="packages/cdk/cdk.json"
    else
        CONFIG_PATH="packages/cdk/litellm-proxy-server/config.yaml"
    fi
fi

if [[ -z "$SECRET_NAME" ]]; then
    if [[ "$CONFIG_TYPE" == "cdk" ]]; then
        SECRET_NAME="CDK_CONFIG_BASE64"
    else
        SECRET_NAME="LITELLM_CONFIG_BASE64"
    fi
fi

# Check if config file exists
if [[ ! -f "$CONFIG_PATH" ]]; then
    echo -e "${RED}Error: File not found: $CONFIG_PATH${NC}"
    exit 1
fi

# Check if gh is installed (only if not output-only mode)
if [[ "$OUTPUT_ONLY" == false ]] && ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is not installed${NC}"
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

# Check if base64 is available
if ! command -v base64 &> /dev/null; then
    echo -e "${RED}Error: base64 command not found${NC}"
    exit 1
fi

# Validate file syntax based on type
if [[ "$CONFIG_TYPE" == "cdk" ]]; then
    # Validate JSON syntax
    if ! jq empty "$CONFIG_PATH" 2>/dev/null; then
        echo -e "${YELLOW}Warning: Could not validate JSON syntax (jq not installed or invalid JSON)${NC}"
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
else
    # Validate YAML syntax for LiteLLM
    if command -v yq &> /dev/null; then
        if ! yq eval "$CONFIG_PATH" > /dev/null 2>&1; then
            echo -e "${RED}Error: Invalid YAML syntax in $CONFIG_PATH${NC}"
            exit 1
        fi
    elif command -v python3 &> /dev/null; then
        if ! python3 -c "import yaml; yaml.safe_load(open('$CONFIG_PATH'))" 2>/dev/null; then
            echo -e "${YELLOW}Warning: Could not validate YAML syntax${NC}"
            read -p "Continue anyway? (y/N) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
        fi
    else
        echo -e "${YELLOW}Warning: Cannot validate YAML (yq or python3 not available)${NC}"
    fi

    # Additional note for LiteLLM
    echo -e "${YELLOW}Note: LiteLLM config is only needed when litellmProxyEnabled: true in cdk.json${NC}"
fi

# Encode to base64
echo -e "${GREEN}Encoding $CONFIG_PATH to base64...${NC}"
BASE64_CONTENT=$(base64 -w 0 < "$CONFIG_PATH")

if [[ -z "$BASE64_CONTENT" ]]; then
    echo -e "${RED}Error: Failed to encode file${NC}"
    exit 1
fi

# Output mode
if [[ "$OUTPUT_ONLY" == true ]]; then
    echo "$BASE64_CONTENT"
    exit 0
fi

# Check GitHub CLI authentication
if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI is not authenticated${NC}"
    echo "Run: gh auth login"
    exit 1
fi

# Get repository info
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
if [[ -z "$REPO" ]]; then
    echo -e "${RED}Error: Not in a GitHub repository or could not detect repository${NC}"
    exit 1
fi

echo -e "${GREEN}Repository: $REPO${NC}"
echo -e "${GREEN}Config type: $CONFIG_TYPE${NC}"
echo -e "${YELLOW}Secret name: $SECRET_NAME${NC}"

# Confirm upload
FILE_DESC="configuration"
if [[ "$CONFIG_TYPE" == "cdk" ]]; then
    FILE_DESC="CDK configuration (cdk.json)"
else
    FILE_DESC="LiteLLM configuration (config.yaml)"
fi

read -p "Upload base64-encoded $FILE_DESC to GitHub Secrets? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled"
    exit 0
fi

# Upload to GitHub Secrets
echo -e "${GREEN}Uploading to GitHub Secrets...${NC}"
echo "$BASE64_CONTENT" | gh secret set "$SECRET_NAME" -R "$REPO"

if [[ $? -eq 0 ]]; then
    echo -e "${GREEN}✓ Successfully uploaded $SECRET_NAME to $REPO${NC}"
    echo ""
    echo "Next steps:"
    if [[ "$CONFIG_TYPE" == "cdk" ]]; then
        echo "1. Ensure AWS_DEPLOY_ROLE_ARN is set in GitHub Variables"
        echo "2. Ensure AWS_DEFAULT_REGION is set in GitHub Variables"
        echo "3. Push to main branch or create a tag to trigger deployment"
    else
        echo "1. Ensure litellmProxyEnabled: true is set in cdk.json"
        echo "2. Upload cdk.json if not already done: ./scripts/upload-config.sh --type cdk"
        echo "3. Push to main branch or create a tag to trigger deployment"
    fi
else
    echo -e "${RED}✗ Failed to upload secret${NC}"
    exit 1
fi
